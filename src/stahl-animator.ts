// SceneAnimator: builds the initial object set, plays transitions between
// steps, and pans the viewport. Owns the shared PropGroups (seed pile,
// grinder, glass contents, dish contents) that steps' StepEffects (see
// src/stahl-steps/*) read and mutate via its public methods.

import { type PropGroupMember, type SceneObject, type Sprite, Compositor, PropGroup } from "./ascii-compositor";
import { rand } from "./rng";
import { applyBladeRadius, arcLerp, bladePulseRadius, MemberFlight, ouStep, runFrames, seedGrindRole, textSprite } from "./ascii-sprites";
import {
    GLASS_HEIGHT,
    GLASS_PIVOT,
    GLASS_WIDTH,
    GRIND_DURATION_MAX,
    GRIND_DURATION_MIN,
    GRIND_SCATTER_X,
    GRIND_SCATTER_Y_MAX,
    GRIND_SCATTER_Y_MIN,
    GRIND_SHAKE_AMPLITUDE,
    GRIND_SHAKE_PERIOD,
    GRINDER_BLADE,
    GRINDER_BLADE_RADIUS,
    GRINDER_BODY,
    INITIAL_LAYOUT,
    LIQUID_PARTICLE,
    LIQUID_POSITIONS,
    LIQUID_VORTEX_RADIUS,
    LIQUID_VORTEX_SPEED,
    PANE_WIDTH,
    SEED_PILE_POSITIONS,
    SEED_SPRITE,
    SPRITES,
    STEP_PAUSE_DURATION,
    TAU,
    type ObjectLayout,
} from "./stahl-props";
import {
    COUNTDOWN_TIMER_ID,
    COUNTDOWN_TIMER_Y,
    COUNTDOWN_TIMER_Z,
    formatCountdown,
    type CountdownConfig,
    type DropAnimation,
    type Loop,
    type Step,
    type TransitionKeyframe,
} from "./stahl-timeline";
import { STEPS } from "./stahl-scene";

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function shortestAngleLerp(a: number, b: number, t: number): number {
    let diff = (b - a) % TAU;
    if (diff > Math.PI) diff -= TAU;
    if (diff < -Math.PI) diff += TAU;
    return a + diff * t;
}

export class SceneAnimator {
    private compositor: Compositor;
    // Not private: read by StepEffects (via getObject) to look up other
    // props' current layouts during a transition.
    private objects: Map<string, SceneObject>;
    private rafHandle: number | null = null;
    // World x of the left edge of the currently-displayed window.
    private currentViewOffset = 0;
    // The seed pile, rendered as individual "O" seeds. Its shared transform is
    // driven by the "seedPile" entry in `objects` (a non-rendered proxy used
    // only as an interpolation target for the keyframe timeline). During
    // grinding, members transfer into `grinderGroup`.
    private seedGroup: PropGroup;
    // The grinder body and blade, sharing one origin/rotation so the grind
    // shake rotates the whole assembly together. Seeds join this group once
    // they arrive (see `startGrinding`). Not private: step 2's SeedPourEffect
    // transfers the ground seed members out of this group into `glassGroup`.
    grinderGroup: PropGroup;
    private grinderBladeMember: PropGroupMember;
    // Drives the seed pile's parabolic arc + per-seed jitter while it flies
    // into the grinder.
    private seedFlight: MemberFlight;
    private grindRafHandle: number | null = null;
    // Holds the ground seed dust once step 2's pour transfers it from
    // `grinderGroup` into the glass; tracks the "glass" object's
    // position/rotation each frame so the powder moves with the glass. Not
    // private: step 2's SeedPourEffect transfers members into this group.
    glassGroup: PropGroup;
    // Holds the individual "~" liquid particles once step 2's bottle pour
    // lands; empty until then. Tracks the "glass" object's
    // position/rotation each frame, like `glassGroup`. While the stir rod is
    // active, particles swirl outward toward the glass walls (see
    // `updateLiquidVortex`). Not private: step 2's BottlePourEffect checks
    // `members.length` to know whether the liquid has already been filled.
    liquidGroup: PropGroup;
    // Per-particle vortex state, parallel to `liquidGroup.members`, used to
    // swirl liquid particles around the glass center while stirring.
    private liquidVortex: Array<{ angle: number; radius: number }> = [];
    // Holds the individual "~" liquid particles once step 4's pour transfers
    // them from `liquidGroup` into the dish; empty until then. Tracks the
    // "dish" object's position each frame, like `liquidGroup` tracks "glass".
    // Not private: step 4's LiquidPourEffect transfers members into this
    // group, and EvaporationEffect releases/animates them as they evaporate.
    dishLiquidGroup: PropGroup;
    // Holds "." residue particles left behind in the dish as each liquid
    // particle in `dishLiquidGroup` evaporates. Not private: step 4's
    // EvaporationEffect adds members here.
    dishResidueGroup: PropGroup;
    // 1-based index of the step last brought to rest (0 = INITIAL_LAYOUT,
    // before any step has been selected). Used so that selecting step N can
    // first fast-forward steps `currentStepIndex+1 .. N-1` to their resting
    // states before animating step N normally.
    private currentStepIndex = 0;
    // Pending STEP_PAUSE_DURATION pause between the viewport settling and the
    // step's transition starting, set by `playStep` and cleared by `stop`.
    private pauseTimeout: number | null = null;
    // Short-lived particles (e.g. ethanol/acid drops) currently falling from a
    // prop's spout into the glass during the current transition. Advanced each
    // frame by `updateDrops`, which removes each one from the compositor once
    // it lands.
    private dropAnimations: DropAnimation[] = [];
    private nextDropId = 0;
    // Ids of objects registered via `addTransient` (e.g. step 3's ice
    // particles) that haven't been removed yet. Cleared from the compositor
    // by `stop` if a step change interrupts them mid-animation.
    private transientIds = new Set<string>();
    // requestAnimationFrame handle for the active countdown timer, if any;
    // cancelled by `stop`.
    private countdownRafHandle: number | null = null;

    constructor(compositor: Compositor) {
        this.compositor = compositor;
        this.objects = new Map();

        for (const [id, sprite] of Object.entries(SPRITES)) {
            const layout = INITIAL_LAYOUT[id];
            const obj: SceneObject = { id, sprite, ...layout, visible: true };
            this.objects.set(id, obj);
            compositor.setObject(obj);
        }

        // Proxy object: not registered with the compositor, so it doesn't
        // render itself, but participates in the keyframe timeline so
        // `seedGroup`'s shared origin can be animated like any other prop.
        const seedLayout = INITIAL_LAYOUT.seedPile;
        this.objects.set("seedPile", { id: "seedPile", sprite: SEED_SPRITE, ...seedLayout, visible: true });
        this.seedGroup = new PropGroup(
            compositor,
            "seed",
            SEED_PILE_POSITIONS.map(([relX, relY]) => ({ sprite: SEED_SPRITE, relX, relY })),
            seedLayout,
        );
        // Wider, more energetic wobble than MemberFlight's defaults so the seeds
        // visibly tumble during the arc into the grinder.
        this.seedFlight = new MemberFlight(this.seedGroup, SEED_PILE_POSITIONS, 2, 4, 16);

        // Proxy object: not registered with the compositor, so it doesn't render
        // itself, but participates in the keyframe timeline so `grinderGroup`'s
        // shared origin can be animated like any other prop (e.g. step 2's pour).
        const grinderLayout = INITIAL_LAYOUT.grinderBody;
        this.objects.set("grinderBody", { id: "grinderBody", sprite: SEED_SPRITE, ...grinderLayout, visible: true });
        this.grinderGroup = new PropGroup(
            compositor,
            "grinder",
            [
                { sprite: GRINDER_BODY, relX: 0, relY: 0, relZ: 0 },
                { sprite: GRINDER_BLADE, relX: 0, relY: 1, relZ: -1 },
            ],
            grinderLayout,
        );
        this.grinderBladeMember = this.grinderGroup.members[1];

        const glassLayout = INITIAL_LAYOUT.glass;
        this.glassGroup = new PropGroup(compositor, "powder", [], glassLayout, GLASS_PIVOT);
        this.liquidGroup = new PropGroup(compositor, "liquid", [], glassLayout, GLASS_PIVOT);

        const dishLayout = INITIAL_LAYOUT.dish;
        this.dishLiquidGroup = new PropGroup(compositor, "dish-liquid", [], dishLayout);
        this.dishResidueGroup = new PropGroup(compositor, "dish-residue", [], dishLayout);

        compositor.viewOffsetX = this.currentViewOffset;
        compositor.render();
    }

    // Cancels any in-progress animation/loop/pause. Returns true if step 1's
    // grind was interrupted mid-run, meaning it hasn't reached its resting
    // state yet (the caller should fast-forward step 1 to completion rather
    // than treat it as already resolved).
    private stop(): boolean {
        if (this.pauseTimeout !== null) {
            clearTimeout(this.pauseTimeout);
            this.pauseTimeout = null;
        }
        if (this.rafHandle !== null) {
            cancelAnimationFrame(this.rafHandle);
            this.rafHandle = null;
        }
        if (this.countdownRafHandle !== null) {
            cancelAnimationFrame(this.countdownRafHandle);
            this.countdownRafHandle = null;
        }
        for (const id of this.transientIds) this.compositor.removeObject(id);
        this.transientIds.clear();
        if (this.grindRafHandle !== null) {
            cancelAnimationFrame(this.grindRafHandle);
            this.grindRafHandle = null;
            return true;
        }
        for (const drop of this.dropAnimations) this.compositor.removeObject(drop.obj.id);
        this.dropAnimations = [];
        return false;
    }

    // Discards every seed-related object (in the pile, mid-grind in the
    // grinder, or poured into the glass) and recreates `seedGroup`,
    // `seedFlight`, and `glassGroup` fresh, exactly as the constructor does.
    // Called whenever a step change needs to restart the seed pile from
    // scratch (re-entering step 1, or interrupting an in-progress grind),
    // so step 1's flight/grind always starts from the same known-good state
    // regardless of where the seeds ended up before.
    private rebuildSeedState(): void {
        for (const seed of this.grinderGroup.members.slice(2)) {
            this.compositor.removeObject(seed.obj.id);
        }
        this.grinderGroup.members.length = 2;
        this.glassGroup.destroy();
        this.liquidGroup.destroy();
        this.liquidVortex = [];
        this.dishLiquidGroup.destroy();
        this.dishResidueGroup.destroy();

        const seedLayout = INITIAL_LAYOUT.seedPile;
        this.objects.set("seedPile", { id: "seedPile", sprite: SEED_SPRITE, ...seedLayout, visible: true });
        this.seedGroup = new PropGroup(
            this.compositor,
            "seed",
            SEED_PILE_POSITIONS.map(([relX, relY]) => ({ sprite: SEED_SPRITE, relX, relY })),
            seedLayout,
        );
        this.seedFlight = new MemberFlight(this.seedGroup, SEED_PILE_POSITIONS, 2, 4, 16);

        const glassLayout = this.objects.get("glass")!;
        this.glassGroup = new PropGroup(this.compositor, "powder", [], glassLayout);
        this.liquidGroup = new PropGroup(this.compositor, "liquid", [], glassLayout);

        const dishLayout = this.objects.get("dish")!;
        this.dishLiquidGroup = new PropGroup(this.compositor, "dish-liquid", [], dishLayout);
        this.dishResidueGroup = new PropGroup(this.compositor, "dish-residue", [], dishLayout);
    }

    // Populates `liquidGroup` with one "~" particle per `LIQUID_POSITIONS`
    // entry, settled at rest (no vortex), and initializes `liquidVortex` from
    // each particle's rest offset. Not private: called by step 2's
    // BottlePourEffect once the bottle's last ethanol drop lands.
    fillLiquid(): void {
        for (const [relX, relY] of LIQUID_POSITIONS) {
            this.liquidGroup.addMember({ sprite: LIQUID_PARTICLE, relX, relY, relZ: 0 });
        }
        this.liquidVortex = LIQUID_POSITIONS.map(([relX, relY]) => ({
            angle: Math.atan2(relY, relX),
            radius: Math.hypot(relX, relY),
        }));
    }

    // Removes a fully-evaporated particle from `dishLiquidGroup` and the
    // compositor. Not private: called by step 4's EvaporationEffect once a
    // particle finishes drifting away.
    removeDishLiquidParticle(member: PropGroupMember): void {
        this.compositor.removeObject(member.obj.id);
        const idx = this.dishLiquidGroup.members.indexOf(member);
        if (idx !== -1) this.dishLiquidGroup.members.splice(idx, 1);
    }

    // Debug helper: overrides the viewport's world-x offset so out-of-frame
    // props can be inspected. Stops any running animation/loop first, since
    // those would otherwise overwrite viewOffsetX on the next frame.
    setDebugViewOffset(x: number): void {
        this.stop();
        this.compositor.viewOffsetX = x;
        this.compositor.render();
    }

    // Debug helper: restores the viewport to the last step's resting offset.
    resetViewOffset(): void {
        this.setDebugViewOffset(this.currentViewOffset);
    }

    // Debug helper: the world-x offset the viewport rests at for the active step.
    getRestingViewOffset(): number {
        return this.currentViewOffset;
    }

    // Resets to step 1's initial layout and fast-forwards through steps
    // 1..index-1 (see below), establishing the t=0 anchor every prop in
    // `step` animates forward from via `transitionKeyframes`, then pans the
    // view across by one pane so both the previous and new resting frames
    // stay visible. This is fully deterministic regardless of which step was
    // previously shown, so it works the same whether `index` is greater or
    // less than the previously selected step.
    //
    // Going backward (target pane is to the left), the viewport pans to its
    // destination *first*, with props left at their current layout, and only
    // once that pan completes does the reset/fast-forward run and the
    // keyframe animation begin — so the pan and the prop animation never show
    // mismatched positions relative to each other.
    //
    // If `index` skips ahead of the step last brought to rest, the
    // intermediate steps are first played to completion instantly (no render,
    // no delays) so every prop — including stochastic ones like the
    // grinding seeds — ends up exactly where it would have after watching
    // each step play out in full.
    playStep(step: Step, index: number): void {
        const grindInterrupted = this.stop();

        // Fast-forward from a known-good starting point up to (but not
        // including) `index`, instantly and without rendering, so step `index`
        // always begins from the same state regardless of what was shown
        // before. Re-entering the current step or going backward restarts the
        // fast-forward from step 1, since steps 2+ depend on state (e.g. ground
        // seed dust) that only step 1's fast-forward rebuilds from scratch. If
        // step 1's grind was interrupted mid-run, it hasn't reached its resting
        // state yet, so it's included in the fast-forward too (finishing the
        // grind in place rather than resetting it).
        const fastForwardFrom =
            index <= this.currentStepIndex
                ? 1
                : grindInterrupted
                    ? this.currentStepIndex
                    : this.currentStepIndex + 1;
        for (let i = fastForwardFrom; i < index; i++) {
            if (i === this.currentStepIndex && grindInterrupted) {
                // Step 1's grind was already running from its current state; finish
                // it in place rather than snapping back to step 1's initial layout
                // and replaying the seed flight from scratch.
                this.startGrinding(true);
            } else {
                this.playTransition(STEPS[i - 1], i, true);
            }
        }
        this.currentStepIndex = index;

        const startTransition = (): void => {
            const snapped = this.snapToInitial(step, index);
            this.compositor.render();
            this.pauseTimeout = window.setTimeout(() => {
                this.pauseTimeout = null;
                this.playTransition(step, index, false, snapped);
            }, STEP_PAUSE_DURATION);
        };

        const endViewOffset = (index - 1) * PANE_WIDTH;
        this.panViewport(endViewOffset, startTransition);
    }

    // Headless equivalent of `playStep` for tracing/debugging (see
    // scripts/trace-step.ts): runs the same fast-forward through steps
    // `1..index-1` and then step `index`'s transition, but entirely via
    // `playTransition(..., true)` (no pan, no pause, no rendering, no
    // continuous loops). `onFrame`, if given, is called with step `index`'s
    // elapsed time (ms) and `this` after every frame of its transition,
    // including the final frame at `transitionDuration`.
    runStepInstant(index: number, onFrame?: (elapsed: number, anim: SceneAnimator) => void): void {
        const grindInterrupted = this.stop();
        const fastForwardFrom =
            index <= this.currentStepIndex
                ? 1
                : grindInterrupted
                    ? this.currentStepIndex
                    : this.currentStepIndex + 1;
        for (let i = fastForwardFrom; i < index; i++) {
            if (i === this.currentStepIndex && grindInterrupted) {
                this.startGrinding(true);
            } else {
                this.playTransition(STEPS[i - 1], i, true);
            }
        }
        this.currentStepIndex = index;
        this.currentViewOffset = (index - 1) * PANE_WIDTH;
        this.playTransition(STEPS[index - 1], index, true, undefined, onFrame);
    }

    // Pans the viewport from its current offset to `endViewOffset` over
    // `step.transitionDuration`, without touching any object's layout, then
    // calls `onDone`.
    private panViewport(endViewOffset: number, onDone: () => void): void {
        const startViewOffset = this.currentViewOffset;
        if (startViewOffset === endViewOffset) {
            onDone();
            return;
        }
        const duration = 800;
        const start = performance.now();
        const tick = (now: number): void => {
            const elapsed = now - start;
            const t = Math.min(elapsed, duration);
            const span = duration > 0 ? t / duration : 1;

            this.compositor.viewOffsetX = lerp(startViewOffset, endViewOffset, span);
            this.compositor.render();

            if (elapsed < duration) {
                this.rafHandle = requestAnimationFrame(tick);
            } else {
                this.rafHandle = null;
                this.currentViewOffset = endViewOffset;
                onDone();
            }
        };
        this.rafHandle = requestAnimationFrame(tick);
    }

    // Establishes the t=0 anchor every prop animates forward from for `step`
    // (step `index`, 1-based), then returns the per-object keyframe timelines
    // and seed-flight endpoints `playTransition` needs.
    //
    // For step 1, every prop is snapped (instant, not lerped) to
    // `INITIAL_LAYOUT` — re-entering step 1 always restarts from the same
    // known state, including re-flying the seed pile from scratch. For steps
    // 2+, props are left exactly where `playStep`'s fast-forward through
    // steps 1..index-1 already put them; that state is read directly as the
    // t=0 anchor, with no snap.
    private snapToInitial(step: Step, index: number): {
        timelines: Map<string, Array<{ t: number; layout: Partial<ObjectLayout> }>>;
        isSeedFlight: boolean;
        flightStart: ObjectLayout;
        flightEnd: ObjectLayout;
    } {
        const isSeedFlight = index === 1;
        if (isSeedFlight) {
            for (const [id, layout] of Object.entries(INITIAL_LAYOUT)) {
                const obj = this.objects.get(id);
                if (obj) Object.assign(obj, layout);
            }
            this.rebuildSeedState();
            this.seedGroup.setOrigin(INITIAL_LAYOUT.seedPile.x, INITIAL_LAYOUT.seedPile.y, INITIAL_LAYOUT.seedPile.z, INITIAL_LAYOUT.seedPile.rotation);
            this.grinderGroup.setOrigin(
                INITIAL_LAYOUT.grinderBody.x,
                INITIAL_LAYOUT.grinderBody.y,
                INITIAL_LAYOUT.grinderBody.z,
                INITIAL_LAYOUT.grinderBody.rotation,
            );
        }

        // Build a sorted keyframe timeline per object that has at least one
        // explicit waypoint this step: entry at t=0 (the object's current
        // layout, established above for step 1 or left by fast-forward for
        // steps 2+), plus those waypoints. A prop's final layout is whatever
        // its last waypoint leaves it at. Objects with no waypoints this step
        // are left out of `timelines` entirely (and thus untouched by
        // `applyAt`), so a step's effects (e.g. step 3's GlassFridgeArcEffect)
        // can freely own an object's position without it being reset back to
        // its t=0 anchor every frame.
        const timelines = new Map<string, Array<{ t: number; layout: Partial<ObjectLayout> }>>();
        const ids = new Set<string>();
        for (const kf of step.transitionKeyframes ?? []) {
            for (const id of Object.keys(kf.objects)) ids.add(id);
        }

        for (const id of ids) {
            const obj = this.objects.get(id);
            if (!obj) continue;
            const points: Array<{ t: number; layout: Partial<ObjectLayout> }> = [];
            points.push({ t: 0, layout: { x: obj.x, y: obj.y, z: obj.z, rotation: obj.rotation } });
            for (const kf of step.transitionKeyframes ?? []) {
                const partial = kf.objects[id];
                if (partial) points.push({ t: kf.t, layout: partial });
            }
            points.sort((a, b) => a.t - b.t);
            timelines.set(id, points);
        }

        const seedPile = this.objects.get("seedPile")!;
        const grinderBody = this.objects.get("grinderBody")!;
        const flightStart: ObjectLayout = { x: seedPile.x, y: seedPile.y, z: seedPile.z, rotation: seedPile.rotation };
        const flightEnd: ObjectLayout = { x: grinderBody.x, y: grinderBody.y, z: 0, rotation: grinderBody.rotation };
        return { timelines, isSeedFlight, flightStart, flightEnd };
    }

    // If `instant` is true, the whole transition (and, for step 1, the
    // subsequent grind) is advanced to completion synchronously in fixed-size
    // steps with no rendering and no continuous loops started, instead of
    // animating frame-by-frame via requestAnimationFrame.
    //
    // `snapped`, if provided, is a previously-computed `snapToInitial` result
    // (e.g. one already rendered before a pause) reused instead of snapping
    // again.
    private playTransition(
        step: Step,
        index: number,
        instant: boolean,
        snapped?: ReturnType<SceneAnimator["snapToInitial"]>,
        onFrame?: (elapsed: number, anim: SceneAnimator) => void,
    ): void {
        const { timelines, isSeedFlight, flightStart, flightEnd } = snapped ?? this.snapToInitial(step, index);
        const endViewOffset = (index - 1) * PANE_WIDTH;
        const effects = step.effects?.(this) ?? [];

        // Applies one frame of the transition at elapsed time `elapsed` (ms)
        // with frame delta `dt` (s).
        const frame = (elapsed: number, dt: number): void => {
            const t = Math.min(elapsed, step.transitionDuration);
            const span = step.transitionDuration > 0 ? t / step.transitionDuration : 1;

            for (const [id, points] of timelines) {
                const obj = this.objects.get(id);
                if (!obj) continue;
                applyAt(obj, points, t);
            }

            if (isSeedFlight) {
                this.seedFlight.update(span, dt, flightStart, flightEnd);
            } else {
                const seedPile = this.objects.get("seedPile")!;
                this.seedGroup.setOrigin(seedPile.x, seedPile.y, seedPile.z, seedPile.rotation);
            }

            const grinderBody = this.objects.get("grinderBody")!;
            this.grinderGroup.setOrigin(grinderBody.x, grinderBody.y, grinderBody.z, grinderBody.rotation);

            // Keep the powder/liquid groups tracking the glass's current
            // position every frame, regardless of step: empty groups (steps
            // before their contents exist) are unaffected, and groups
            // populated by an earlier step's effects (e.g. step 2's pours)
            // continue riding along with the glass in later steps.
            const glass = this.objects.get("glass")!;
            this.glassGroup.setOrigin(glass.x, glass.y, glass.z, glass.rotation);
            this.liquidGroup.setOrigin(glass.x, glass.y, glass.z, glass.rotation);

            // Keep the dish liquid/residue groups tracking the dish's
            // position every frame, same as glassGroup/liquidGroup above.
            const dish = this.objects.get("dish")!;
            this.dishLiquidGroup.setOrigin(dish.x, dish.y, dish.z, dish.rotation);
            this.dishResidueGroup.setOrigin(dish.x, dish.y, dish.z, dish.rotation);

            for (const effect of effects) effect.tick(t, this);

            this.updateDrops(t);

            onFrame?.(t, this);
        };

        runFrames(
            step.transitionDuration,
            frame,
            () => {
                if (instant) {
                    if (isSeedFlight) this.startGrinding(true);
                } else {
                    this.currentViewOffset = endViewOffset;
                    const loops = step.loops?.(effects) ?? [];
                    if (loops.length > 0) this.startLoops(loops, step.transitionDuration);
                    if (isSeedFlight) this.startGrinding(false);
                    if (step.countdown) this.startCountdown(step.countdown, index);
                }
            },
            {
                instant,
                render: () => this.compositor.render(),
                setRafHandle: (handle) => {
                    this.rafHandle = handle;
                },
            },
        );
    }

    // Starts `step.countdown` after its `startDelay`, showing an "mm:ss"
    // timer sprite centered on the top row of step `index`'s pane until it
    // reaches 0. Cancelled by `stop` (which also removes the timer sprite).
    private startCountdown(countdown: CountdownConfig, index: number): void {
        const { totalSeconds, startDelay, preElapsed = 0, onComplete } = countdown;
        const start = performance.now() + startDelay;
        const paneCenterX = Math.round(index * PANE_WIDTH + PANE_WIDTH / 2);
        const tick = (now: number): void => {
            const elapsedSinceStart = Math.max(0, now - start) / 1000;
            const remaining = Math.max(0, totalSeconds - preElapsed - elapsedSinceStart);
            if (now >= start) {
                const text = formatCountdown(remaining);
                const sprite = textSprite(text, Math.floor(text.length / 2));
                const obj: SceneObject = {
                    id: COUNTDOWN_TIMER_ID,
                    sprite,
                    x: paneCenterX,
                    y: COUNTDOWN_TIMER_Y,
                    z: COUNTDOWN_TIMER_Z,
                    rotation: 0,
                    visible: true,
                };
                this.compositor.setObject(obj);
                this.transientIds.add(obj.id);
                this.compositor.render();
            }
            if (remaining > 0) {
                this.countdownRafHandle = requestAnimationFrame(tick);
            } else {
                this.countdownRafHandle = null;
                this.compositor.removeObject(COUNTDOWN_TIMER_ID);
                this.transientIds.delete(COUNTDOWN_TIMER_ID);
                onComplete?.(this);
                this.compositor.render();
            }
        };
        this.countdownRafHandle = requestAnimationFrame(tick);
    }

    // Returns the current layout/sprite of the named scene object (e.g.
    // "glass", "bottle"). Used by StepEffects to read other props' positions
    // during a transition. Throws if `id` isn't a known object, since every
    // id an effect looks up is expected to exist for the lifetime of the
    // scene.
    getObject(id: string): SceneObject {
        const obj = this.objects.get(id);
        if (!obj) throw new Error(`Unknown scene object "${id}"`);
        return obj;
    }

    // Registers a self-managed transient object (e.g. one of step 3's ice
    // particles) with the compositor. Tracked so `stop` can remove any that
    // are still pending if the step changes mid-animation.
    addTransient(obj: SceneObject): void {
        this.compositor.setObject(obj);
        this.transientIds.add(obj.id);
    }

    // Removes a transient object registered via `addTransient`.
    removeTransient(id: string): void {
        this.compositor.removeObject(id);
        this.transientIds.delete(id);
    }

    // Registers a new particle (e.g. an ethanol or tartaric-acid drop) that
    // falls from `from` to `to` via `arcLerp` between transition-elapsed times
    // `startT` and `startT + duration`. The particle is rendered with `sprite`
    // until it lands, at which point `updateDrops` removes it from the
    // compositor. Not private: called by step 2's BottlePourEffect/
    // StickPourEffect to spawn ethanol/acid drops.
    spawnDrop(sprite: Sprite, from: ObjectLayout, to: ObjectLayout, startT: number, duration: number): void {
        const obj: SceneObject = { id: `drop-${this.nextDropId++}`, sprite, ...from, visible: true };
        this.compositor.setObject(obj);
        this.dropAnimations.push({ obj, from, to, startT, duration });
    }

    // Advances every pending/active drop particle for transition-elapsed time
    // `t` (ms): before `startT` a drop stays at `from`; between `startT` and
    // `startT + duration` it follows `arcLerp`; once landed it's removed from
    // the compositor and `dropAnimations`.
    private updateDrops(t: number): void {
        this.dropAnimations = this.dropAnimations.filter((drop) => {
            if (t < drop.startT) return true;
            const span = drop.duration > 0 ? Math.min(1, (t - drop.startT) / drop.duration) : 1;
            Object.assign(drop.obj, arcLerp(drop.from, drop.to, span, 2));
            if (span >= 1) {
                this.compositor.removeObject(drop.obj.id);
                return false;
            }
            return true;
        });
    }

    // Transfers the seeds from the pile into the grinder, then runs the blade
    // and body shake for a random 8-10s while the seeds scatter around the top
    // interior rows and gradually crumble from "O" to "o" to ".".
    //
    // If `instant` is true, the whole grind is advanced to completion
    // synchronously in fixed-size steps with no rendering, leaving the seeds
    // in their final crumbled state immediately.
    private startGrinding(instant: boolean): void {
        const seeds: PropGroupMember[] = [];
        this.seedFlight.land(this.grinderGroup, () => {
            const relX = (rand() * 2 - 1) * GRIND_SCATTER_X;
            const relY = GRIND_SCATTER_Y_MIN + rand() * (GRIND_SCATTER_Y_MAX - GRIND_SCATTER_Y_MIN);
            return [relX, relY, -2];
        });
        seeds.push(...this.grinderGroup.members.slice(2));
        const seedJitter = seeds.map(() => ({ vx: 0, vy: 0 }));

        const duration = GRIND_DURATION_MIN + rand() * (GRIND_DURATION_MAX - GRIND_DURATION_MIN);
        const baseRotation = this.grinderGroup.rotation;

        // Applies one frame of the grind at elapsed time `elapsed` (ms) with
        // frame delta `dt` (s).
        const frame = (elapsed: number, dt: number): void => {
            const shake = Math.sin((elapsed / GRIND_SHAKE_PERIOD) * TAU) * GRIND_SHAKE_AMPLITUDE;
            this.grinderGroup.setOrigin(
                this.grinderGroup.x,
                this.grinderGroup.y,
                this.grinderGroup.z,
                baseRotation + shake,
            );

            const bladeRadius = bladePulseRadius(elapsed, GRINDER_BLADE_RADIUS, 300);
            applyBladeRadius(this.grinderBladeMember.obj.sprite, bladeRadius);

            const grindProgress = elapsed / duration;
            for (const [i, seed] of seeds.entries()) {
                const jitter = seedJitter[i];
                jitter.vx = ouStep(jitter.vx, dt, 3, 2);
                jitter.vy = ouStep(jitter.vy, dt, 3, 2);
                seed.relX = Math.max(-GRIND_SCATTER_X, Math.min(GRIND_SCATTER_X, seed.relX + jitter.vx * dt));
                seed.relY = Math.max(GRIND_SCATTER_Y_MIN, Math.min(GRIND_SCATTER_Y_MAX, seed.relY + jitter.vy * dt));

                // Stagger each seed's crumble slightly so they don't all change in lockstep.
                const seedProgress = Math.min(1, grindProgress * 1.2 + i * 0.015);
                seed.obj.sprite.cells[0].role = seedGrindRole(seedProgress);
            }

            this.grinderGroup.applyOrigin();
        };

        const finish = (): void => {
            this.grinderGroup.setOrigin(this.grinderGroup.x, this.grinderGroup.y, this.grinderGroup.z, baseRotation);
            applyBladeRadius(this.grinderBladeMember.obj.sprite, 0);
            for (const seed of seeds) seed.obj.sprite.cells[0].role = seedGrindRole(1);
            if (!instant) this.compositor.render();
        };

        runFrames(duration, frame, finish, {
            instant,
            render: () => this.compositor.render(),
            setRafHandle: (handle) => {
                this.grindRafHandle = handle;
            },
            callFrameAtEnd: false,
        });
    }

    // `transitionDuration` seeds the elapsed-time counter passed to
    // EffectLoop.tick, so an effect that was ticking during the transition
    // (elapsed 0..transitionDuration) continues from where it left off.
    private startLoops(loops: Loop[], transitionDuration: number): void {
        const stirring = loops.some((loop) => loop.kind === "pulse" && loop.id === "stirRod");
        let last = performance.now();
        let elapsed = transitionDuration;
        const tick = (now: number): void => {
            const dt = Math.max(0, now - last) / 1000;
            last = now;
            elapsed += dt * 1000;
            for (const loop of loops) {
                if (loop.kind === "effect") {
                    loop.effect.tick(elapsed, this);
                    continue;
                }
                const obj = this.objects.get(loop.id);
                if (!obj) continue;
                if (loop.kind === "spin") {
                    obj.rotation += loop.angularVelocity * dt;
                } else {
                    const radius = bladePulseRadius(elapsed, loop.maxRadius, loop.period);
                    applyBladeRadius(obj.sprite, radius);
                }
            }
            if (stirring) this.updateLiquidVortex(dt);
            this.compositor.render();
            this.rafHandle = requestAnimationFrame(tick);
        };
        this.rafHandle = requestAnimationFrame(tick);
    }

    // While the stir rod is active, swirls each liquid particle around the
    // glass center: its radius grows toward LIQUID_VORTEX_RADIUS (pushing
    // particles out toward the glass walls) while its angle advances at
    // LIQUID_VORTEX_SPEED.
    private updateLiquidVortex(dt: number): void {
        for (const [i, member] of this.liquidGroup.members.entries()) {
            const state = this.liquidVortex[i];
            if (!state) continue;
            state.angle += LIQUID_VORTEX_SPEED * dt;
            state.radius = Math.min(LIQUID_VORTEX_RADIUS, state.radius + LIQUID_VORTEX_RADIUS * dt);
            member.relX = Math.cos(state.angle) * state.radius;
            member.relY = Math.sin(state.angle) * state.radius * (GLASS_HEIGHT / GLASS_WIDTH);
        }
        this.liquidGroup.applyOrigin();
    }
}

// Interpolates `obj`'s layout at time `t` across the sorted waypoints,
// holding the surrounding value for `z` (discrete) and lerping `x`/`y`/
// `rotation` (continuous). Each waypoint may specify only a subset of
// properties; unspecified properties carry forward from the previous
// waypoint that defined them.
function applyAt(obj: SceneObject, points: Array<{ t: number; layout: Partial<ObjectLayout> }>, t: number): void {
    // Resolve, for each property, the surrounding pair of waypoints that
    // define it.
    const props: Array<keyof ObjectLayout> = ["x", "y", "z", "rotation"];
    for (const prop of props) {
        const defined = points.filter((p) => p.layout[prop] !== undefined);
        if (defined.length === 0) continue;

        let prev = defined[0];
        let next = defined[defined.length - 1];
        for (const p of defined) {
            if (p.t <= t) prev = p;
            if (p.t >= t) {
                next = p;
                break;
            }
        }

        if (prop === "z") {
            obj.z = prev.layout.z as number;
            continue;
        }

        if (prev === next || next.t === prev.t) {
            obj[prop] = prev.layout[prop] as number;
            continue;
        }
        const span = (t - prev.t) / (next.t - prev.t);
        const a = prev.layout[prop] as number;
        const b = next.layout[prop] as number;
        obj[prop] = prop === "rotation" ? shortestAngleLerp(a, b, span) : lerp(a, b, span);
    }
}
