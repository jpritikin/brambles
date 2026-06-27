// SceneAnimator: builds the initial object set, plays transitions between
// steps, and pans the viewport. Owns the shared PropGroups (seed pile,
// grinder, glass contents, dish contents) that steps' StepEffects (see
// src/stahl-steps/*) read and mutate via its public methods.

import { type PropGroupMember, type SceneObject, type Sprite, Compositor, PropGroup } from "./ascii-compositor";
import { rand } from "./rng";
import { applyBladeRadius, arcLerp, bladePulseRadius, boundingAspectRatio, MemberFlight, ouStep, runFrames, seedGrindRole, textSprite } from "./ascii-sprites";
import { type FluidSim, type StirImpulse, makeFluidSim, fillFluidSim, seedFluidFromPositions, seedPowderAtBottom, stepFluid, projectFluidSim, gridToRel, interiorBounds, fluidFillRatio } from "./fluid-sim";
import type { PourSim, ContainerState } from "./pour-sim";
import {
    BOTTLE_LIQUID_POSITIONS,
    GLASS_FLUID_DIMS,
    GLASS_FLUID_FILL,
    GLASS_INTERIOR_MARGIN,
    GLASS_PIVOT,
    GLASS_POINTS,
    GLASS2_POWDER_POSITIONS,
    GLASS_POWDER_POSITIONS,
    BARLEY_POWDER_DROP,
    BARLEY_POWDER_POSITIONS,
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
    POWDER_PARTICLE,
    LIQUID_VORTEX_RADIUS,
    LIQUID_VORTEX_SPEED,
    PANE_WIDTH,
    SEED_PILE_POSITIONS,
    SEED_SPRITE,
    STIR_IMPULSE_RADIUS,
    STIR_IMPULSE_STRENGTH,
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

// Height/width ratio of the glass's interior, used by updateVortex to make
// the liquid swirl in an ellipse matching the glass's proportions rather
// than a circle.
const GLASS_ASPECT_RATIO = boundingAspectRatio(GLASS_POINTS);
const GLASS_INTERIOR = interiorBounds(GLASS_POINTS, GLASS_INTERIOR_MARGIN);

// One container of "~" liquid particles (glass1, glass2, or the dish), plus
// its per-particle vortex state (parallel to `group.members`, unused/empty
// for the dish since its liquid never swirls).
interface FluidContainer {
    group: PropGroup;
    vortex: Array<{ angle: number; radius: number }>;
    sim?: FluidSim;
}

function makeFluidContainer(
    compositor: Compositor,
    idPrefix: string,
    origin: { x: number; y: number; z: number; rotation?: number },
    pivot?: [number, number],
): FluidContainer {
    return { group: new PropGroup(compositor, idPrefix, [], origin, pivot), vortex: [] };
}

export class SceneAnimator {
    private compositor: Compositor;
    // Not private: read by StepEffects (via getObject) to look up other
    // props' current layouts during a transition.
    private objects: Map<string, SceneObject>;
    private rafHandle: number | null = null;
    // World x of the left edge of the currently-displayed window.
    private currentViewOffset = 0;
    // Notified with the new viewOffsetX whenever it changes, so callers (e.g.
    // the viewport scroller) can stay in sync with panning/animation.
    onViewOffsetChange: ((x: number) => void) | null = null;
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
    // Holds the individual "~" liquid particles for glass1, glass2, and the
    // dish, plus each container's vortex state. While a stir rod is active,
    // the "glass"/"glass2" containers' particles swirl outward toward the
    // glass walls (see `updateVortex`); the "dish" container's particles
    // never swirl. Not private: step 2's BottlePourEffect checks
    // `fluidContainers.get("glass")!.group.members.length` to know whether
    // the liquid has already been filled, step 4's LiquidPourEffect/
    // EvaporationEffect transfer/release members into/from the "dish"
    // container, and step 5/6's effects populate/empty the "glass2"
    // container.
    private fluidContainers = new Map<"glass" | "glass2" | "dish" | "bottle" | "grinder", FluidContainer>();
    get liquidGroup(): PropGroup {
        return this.fluidContainers.get("glass")!.group;
    }
    get liquid2Group(): PropGroup {
        return this.fluidContainers.get("glass2")!.group;
    }
    get dishLiquidGroup(): PropGroup {
        return this.fluidContainers.get("dish")!.group;
    }
    get bottleLiquidGroup(): PropGroup {
        return this.fluidContainers.get("bottle")!.group;
    }
    // Holds the ground seed dust as uniform "." powder particles once
    // grinding finishes (see `startGrinding`'s `finish`), ready to be poured
    // out like the bottle's ethanol. Empty until grinding completes. Not
    // private: step 2's SeedPourEffect transfers members out of this group
    // into `glassGroup`.
    get grinderPowderGroup(): PropGroup {
        return this.fluidContainers.get("grinder")!.group;
    }
    getGlassFluidSim(): FluidSim | undefined {
        return this.fluidContainers.get("glass")?.sim;
    }
    getGlass2FluidSim(): FluidSim | undefined {
        return this.fluidContainers.get("glass2")?.sim;
    }
    hasFluidSim(id: string): boolean {
        return !!(this.fluidContainers.get(id as any)?.sim);
    }
    stirStrengthOverride: number | null = null;
    fillLevelOverride: number | null = null;
    // Stir rod ids ("stirRod"/"stirRod2") whose pulse/vortex loop has been
    // stopped via `stopStirring` (e.g. once their countdown completes), even
    // though the rod itself remains visible in place.
    private stoppedStirring = new Set<string>();
    // Holds "." residue particles left behind in the dish as each liquid
    // particle in the "dish" fluid container evaporates. Not private: step
    // 4's EvaporationEffect adds members here.
    dishResidueGroup: PropGroup;
    // Holds the scraped dish residue poured into glass2 during step 5,
    // analogous to `glassGroup` but tracking the "glass2" object's position
    // each frame. Not private: step 5's effects populate this, and step 6's
    // effects empty it.
    glass2Group: PropGroup;
    // Holds the gathered "@" residue clump so it rides along with the
    // scraper's position/rotation as a single rigid unit, rather than being
    // repositioned by hand each frame. Tracks the "scraper" object's position
    // each frame, like `dishLiquidGroup` tracks "dish". Empty except during
    // step 5's transfer of the clump from the dish to glass2. Not private:
    // step 5's ResidueScrapeEffect adds the clump member here.
    scraperGroup: PropGroup;
    // 1-based index of the step last brought to rest (0 = INITIAL_LAYOUT,
    // before any step has been selected). Used so that selecting step N can
    // first fast-forward steps `currentStepIndex+1 .. N-1` to their resting
    // states before animating step N normally.
    private currentStepIndex = 0;
    private _instant = false;
    get instant(): boolean { return this._instant; }
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
    // State of the active countdown timer, if any, kept in sync with the
    // closure in `startCountdown` so `skipCountdown` can fast-forward it.
    private activeCountdown: { start: number; totalSeconds: number; preElapsed: number; paneCenterX: number } | null = null;

    // Active PourSim instances registered by StepEffects for debug visualization.
    private activePourSims = new Map<string, { sim: PourSim; sourceState: () => ContainerState; targetState: () => ContainerState }>();
    // 0 = paused, otherwise scales real-time dt for runFrames.
    playbackSpeed = 1;

    registerPourSim(label: string, sim: PourSim, sourceState: () => ContainerState, targetState: () => ContainerState): void {
        this.activePourSims.set(label, { sim, sourceState, targetState });
    }

    unregisterPourSim(label: string): void {
        this.activePourSims.delete(label);
    }

    getActivePourSims(): Map<string, { sim: PourSim; sourceState: () => ContainerState; targetState: () => ContainerState }> {
        return this.activePourSims;
    }

    dumpAscii(): string {
        return this.compositor.dumpAscii();
    }

    onSubstepChange: ((stepIndex: number, substepId: string | null) => void) | null = null;
    onStepComplete: ((stepIndex: number) => void) | null = null;
    private activeSubstep: string | null = null;

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

        this.fluidContainers.set("grinder", makeFluidContainer(compositor, "grinder-powder", grinderLayout));

        const glassLayout = INITIAL_LAYOUT.glass;
        this.glassGroup = new PropGroup(compositor, "powder", [], glassLayout, GLASS_PIVOT);
        this.fluidContainers.set("glass", makeFluidContainer(compositor, "liquid", glassLayout, GLASS_PIVOT));

        const dishLayout = INITIAL_LAYOUT.dish;
        this.fluidContainers.set("dish", makeFluidContainer(compositor, "dish-liquid", dishLayout));
        this.dishResidueGroup = new PropGroup(compositor, "dish-residue", [], dishLayout);

        const glass2Layout = INITIAL_LAYOUT.glass2;
        this.glass2Group = new PropGroup(compositor, "powder2", [], glass2Layout, GLASS_PIVOT);
        this.fluidContainers.set("glass2", makeFluidContainer(compositor, "liquid2", glass2Layout, GLASS_PIVOT));

        const scraperLayout = INITIAL_LAYOUT.scraper;
        this.scraperGroup = new PropGroup(compositor, "scraper-clump", [], scraperLayout);

        const bottleLayout = { ...INITIAL_LAYOUT.bottle, z: INITIAL_LAYOUT.bottle.z - 1 };
        this.fluidContainers.set("bottle", makeFluidContainer(compositor, "bottle-liquid", bottleLayout));
        this.fillBottleLiquid();

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
        this.activeCountdown = null;
        this.activePourSims.clear();
        this.playbackSpeed = 1;
        this.stoppedStirring.clear();
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
        this.dishLiquidGroup.destroy();
        this.dishResidueGroup.destroy();
        this.glass2Group.destroy();
        this.liquid2Group.destroy();
        this.scraperGroup.destroy();
        this.bottleLiquidGroup.destroy();
        this.grinderPowderGroup.destroy();

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
        this.glassGroup = new PropGroup(this.compositor, "powder", [], glassLayout, GLASS_PIVOT);
        this.fluidContainers.set("glass", makeFluidContainer(this.compositor, "liquid", glassLayout, GLASS_PIVOT));

        const dishLayout = this.objects.get("dish")!;
        this.fluidContainers.set("dish", makeFluidContainer(this.compositor, "dish-liquid", dishLayout));
        this.dishResidueGroup = new PropGroup(this.compositor, "dish-residue", [], dishLayout);

        const glass2Layout = this.objects.get("glass2")!;
        this.glass2Group = new PropGroup(this.compositor, "powder2", [], glass2Layout, GLASS_PIVOT);
        this.fluidContainers.set("glass2", makeFluidContainer(this.compositor, "liquid2", glass2Layout, GLASS_PIVOT));

        const scraperLayout = this.objects.get("scraper")!;
        this.scraperGroup = new PropGroup(this.compositor, "scraper-clump", [], scraperLayout);

        const grinderBodyLayout = this.objects.get("grinderBody")!;
        this.fluidContainers.set("grinder", makeFluidContainer(this.compositor, "grinder-powder", grinderBodyLayout));

        const bottleObj = this.objects.get("bottle")!;
        const bottleLayout2 = { x: bottleObj.x, y: bottleObj.y, z: bottleObj.z - 1, rotation: bottleObj.rotation };
        this.fluidContainers.set("bottle", makeFluidContainer(this.compositor, "bottle-liquid", bottleLayout2));
        this.fillBottleLiquid();
    }

    // Populates the "glass"/"glass2" fluid container with one "~" particle
    // per `LIQUID_POSITIONS` entry, settled at rest, and initializes its
    // vortex state from each particle's rest offset. Not private: called by
    // step 2's BottlePourEffect (glass) once the bottle's last ethanol drop
    // lands, and step 5's TapWaterEffect (glass2) once the last water drop
    // lands.
    fillLiquidContainer(id: "glass" | "glass2"): void {
        const container = this.fluidContainers.get(id)!;
        const group = id === "glass" ? this.glassGroup : this.glass2Group;
        container.sim = makeFluidSim(GLASS_FLUID_DIMS, GLASS_POINTS);
        fillFluidSim(container.sim, this.fillLevelOverride ?? GLASS_FLUID_FILL);
        if (id === "glass") {
            seedPowderAtBottom(container.sim, GLASS_POWDER_POSITIONS.length);
        } else {
            seedPowderAtBottom(container.sim, GLASS2_POWDER_POSITIONS.length);
            seedPowderAtBottom(container.sim, BARLEY_POWDER_POSITIONS.length, "barley");
        }
        group.clear();
        this.syncLiquidParticles(container);
    }

    // Initializes the "glass" container's vortex state from its members'
    // current rest offsets. Not private: called by step 2's BottlePourEffect
    // once its GroupArcTransfer lands the bottle's ethanol particles in the
    // glass, so they swirl like a `fillLiquidContainer`-filled glass once the
    // stir rod starts.
    initLiquidVortex(id: "glass" | "glass2"): void {
        const container = this.fluidContainers.get(id)!;
        const group = id === "glass" ? this.glassGroup : this.glass2Group;
        container.sim = makeFluidSim(GLASS_FLUID_DIMS, GLASS_POINTS);
        fillFluidSim(container.sim, this.fillLevelOverride ?? GLASS_FLUID_FILL);
        if (id === "glass") {
            seedPowderAtBottom(container.sim, GLASS_POWDER_POSITIONS.length);
        } else {
            seedPowderAtBottom(container.sim, GLASS2_POWDER_POSITIONS.length);
            seedPowderAtBottom(container.sim, BARLEY_POWDER_POSITIONS.length, "barley");
        }
        group.clear();
    }

    // Populates the "bottle" fluid container with one "~" particle per
    // `BOTTLE_LIQUID_POSITIONS` entry, settled at rest. Called at construction
    // (and rebuild) so the bottle starts full; step 2's BottlePourEffect drains
    // it via GroupArcTransfer into the glass.
    private fillBottleLiquid(): void {
        const container = this.fluidContainers.get("bottle")!;
        for (const [relX, relY] of BOTTLE_LIQUID_POSITIONS) {
            container.group.addMember({ sprite: LIQUID_PARTICLE, relX, relY, relZ: 0 });
        }
    }

    // Removes every particle from `glass2Group`/`liquid2Group` (the scraped
    // residue and tap water added during step 5). Not private: called by step
    // 6's GlassEmptyEffect once glass2 is lifted off-screen.
    emptyGlass2(): void {
        this.glass2Group.destroy();
        this.glass2Group.members.length = 0;
        const container = this.fluidContainers.get("glass2")!;
        container.group.destroy();
        container.group.members.length = 0;
        container.vortex = [];
    }

    // Removes every remaining particle from `dishLiquidGroup`. Not private:
    // called by step 5's ResidueScrapeEffect when reaching step 5 directly
    // (skipping step 4's real-time evaporation loop), so the dish shows only
    // residue, as if the fan had already evaporated all its liquid.
    emptyDishLiquid(): void {
        this.dishLiquidGroup.destroy();
        this.dishLiquidGroup.members.length = 0;
    }

    disableFluidSim(id: "glass" | "glass2"): void {
        const container = this.fluidContainers.get(id)!;
        if (container.sim) {
            this.syncLiquidParticles(container);
            container.sim = undefined;
        }
    }

    removeLiquidParticle(member: PropGroupMember): void {
        this.compositor.removeObject(member.obj.id);
        const idx = this.liquidGroup.members.indexOf(member);
        if (idx !== -1) this.liquidGroup.members.splice(idx, 1);
    }

    removeDishLiquidParticle(member: PropGroupMember): void {
        this.compositor.removeObject(member.obj.id);
        const idx = this.dishLiquidGroup.members.indexOf(member);
        if (idx !== -1) this.dishLiquidGroup.members.splice(idx, 1);
    }

    // Removes a residue particle the scraper has just swept over from
    // `dishResidueGroup` and the compositor. Not private: called by step 5's
    // ResidueScrapeEffect as the scraper sweeps across the dish.
    removeBottleLiquidParticle(member: PropGroupMember): void {
        const container = this.fluidContainers.get("bottle")!;
        this.compositor.removeObject(member.obj.id);
        const idx = container.group.members.indexOf(member);
        if (idx !== -1) container.group.members.splice(idx, 1);
    }

    removeDishResidueParticle(member: PropGroupMember): void {
        this.compositor.removeObject(member.obj.id);
        const idx = this.dishResidueGroup.members.indexOf(member);
        if (idx !== -1) this.dishResidueGroup.members.splice(idx, 1);
    }

    // Manually overrides the viewport's world-x offset, e.g. so out-of-frame
    // props can be inspected. Does not stop any running animation/loop, so a
    // manual pan never interrupts an in-progress step transition; the next
    // animated frame (if any) will overwrite this offset again.
    setManualViewOffset(x: number): void {
        this.compositor.viewOffsetX = x;
        this.compositor.render();
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
            this.onViewOffsetChange?.(this.compositor.viewOffsetX);

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
        initials: Map<string, ObjectLayout>;
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
            // Re-entering step 1 ends any in-progress stir pulse (step 2/5's
            // `loops`), but that loop's `applyBladeRadius` mutation persists on
            // the sprite's cells, so reset both stir rods back to their
            // resting (unpulsed) glyph.
            applyBladeRadius(this.objects.get("stirRod")!.sprite, 0);
            applyBladeRadius(this.objects.get("stirRod2")!.sprite, 0);
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
        const keyframes = step.timeline?.keyframes ?? step.transitionKeyframes ?? [];
        const initials = new Map<string, ObjectLayout>();
        const ids = new Set<string>();
        for (const kf of keyframes) {
            for (const id of Object.keys(kf.objects)) ids.add(id);
        }
        for (const id of ids) {
            const obj = this.objects.get(id);
            if (obj) initials.set(id, { x: obj.x, y: obj.y, z: obj.z, rotation: obj.rotation });
        }

        const timelines = this.buildTimelines(keyframes, initials);

        const seedPile = this.objects.get("seedPile")!;
        const grinderBody = this.objects.get("grinderBody")!;
        const flightStart: ObjectLayout = { x: seedPile.x, y: seedPile.y, z: seedPile.z, rotation: seedPile.rotation };
        const flightEnd: ObjectLayout = { x: grinderBody.x, y: grinderBody.y, z: 0, rotation: grinderBody.rotation };
        return { timelines, initials, isSeedFlight, flightStart, flightEnd };
    }

    private buildTimelines(
        keyframes: TransitionKeyframe[],
        initials: Map<string, ObjectLayout>,
    ): Map<string, Array<{ t: number; layout: Partial<ObjectLayout> }>> {
        const timelines = new Map<string, Array<{ t: number; layout: Partial<ObjectLayout> }>>();
        const ids = new Set<string>();
        for (const kf of keyframes) {
            for (const id of Object.keys(kf.objects)) ids.add(id);
        }
        for (const id of ids) {
            const init = initials.get(id);
            if (!init) continue;
            const points: Array<{ t: number; layout: Partial<ObjectLayout> }> = [];
            points.push({ t: 0, layout: init });
            for (const kf of keyframes) {
                const partial = kf.objects[id];
                if (partial) points.push({ t: kf.t, layout: partial });
            }
            points.sort((a, b) => a.t - b.t);
            timelines.set(id, points);
        }
        return timelines;
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
        this._instant = instant;
        const snapResult = snapped ?? this.snapToInitial(step, index);
        let { timelines } = snapResult;
        const { initials, isSeedFlight, flightStart, flightEnd } = snapResult;
        const endViewOffset = (index - 1) * PANE_WIDTH;
        const effects = step.effects?.(this) ?? [];
        const tl = step.timeline ?? null;
        let tlVersion = tl?.version ?? 0;
        const getDuration = tl ? () => tl.duration : () => step.transitionDuration;

        const frame = (elapsed: number, dt: number): void => {
            if (tl) {
                tl.update(elapsed);
                if (tl.version !== tlVersion) {
                    tlVersion = tl.version;
                    for (const kf of tl.keyframes) {
                        for (const id of Object.keys(kf.objects)) {
                            if (!initials.has(id)) {
                                const obj = this.objects.get(id);
                                if (obj) initials.set(id, { x: obj.x, y: obj.y, z: obj.z, rotation: obj.rotation });
                            }
                        }
                    }
                    timelines = this.buildTimelines(tl.keyframes, initials);
                }
            }
            const dur = getDuration();
            const t = dur === Infinity ? elapsed : Math.min(elapsed, dur);
            const span = dur > 0 && dur !== Infinity ? t / dur : (dur === Infinity ? 0 : 1);

            for (const [id, points] of timelines) {
                const obj = this.objects.get(id);
                if (!obj) continue;
                applyAt(obj, points, t);
            }

            this.syncGroupOrigins();

            if (isSeedFlight) {
                this.seedFlight.update(span, dt, flightStart, flightEnd);
            }

            for (const effect of effects) effect.tick(t, this);

            this.syncGroupOrigins(isSeedFlight);

            this.updateDrops(t);

            if (!instant && step.substeps) {
                let current: string | null = null;
                for (const ss of step.substeps) {
                    if (t >= ss.start && t < ss.end) { current = ss.id; break; }
                }
                if (current !== this.activeSubstep) {
                    this.activeSubstep = current;
                    this.onSubstepChange?.(index, current);
                }
            }

            onFrame?.(t, this);
        };

        runFrames(
            getDuration,
            frame,
            () => {
                this._instant = false;
                this.instantFilled.clear();
                if (instant) {
                    if (isSeedFlight) this.startGrinding(true);
                } else {
                    this.currentViewOffset = endViewOffset;
                    this.activeSubstep = null;
                    this.onSubstepChange?.(index, null);
                    this.onStepComplete?.(index);
                    const loops = step.loops?.(effects) ?? [];
                    if (loops.length > 0) this.startLoops(loops, getDuration());
                    if (isSeedFlight) this.startGrinding(false);
                    if (step.countdown) this.startCountdown(step.countdown, index);
                    step.onSettle?.(this);
                }
            },
            {
                instant,
                render: () => this.compositor.render(),
                setRafHandle: (handle) => {
                    this.rafHandle = handle;
                },
                getPlaybackSpeed: () => this.playbackSpeed,
            },
        );
    }

    // Starts `step.countdown` after its `startDelay`, showing an "mm:ss"
    // timer sprite centered on the top row of step `index`'s pane until it
    // reaches 0. Cancelled by `stop` (which also removes the timer sprite).
    private startCountdown(countdown: CountdownConfig, index: number): void {
        const { totalSeconds, startDelay, preElapsed = 0, onComplete } = countdown;
        const paneCenterX = Math.round(index * PANE_WIDTH + PANE_WIDTH / 2);
        this.activeCountdown = { start: performance.now() + startDelay, totalSeconds, preElapsed, paneCenterX };
        const tick = (now: number): void => {
            const { start } = this.activeCountdown!;
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
                this.activeCountdown = null;
                this.compositor.removeObject(COUNTDOWN_TIMER_ID);
                this.transientIds.delete(COUNTDOWN_TIMER_ID);
                onComplete?.(this);
                this.compositor.render();
            }
        };
        this.countdownRafHandle = requestAnimationFrame(tick);
    }

    // Halts a stir rod's blade pulse and its glass's liquid vortex once
    // stirring finishes, leaving the rod resting (hub only) in place rather
    // than parking it out of view.
    initEmptyFluidSim(id: "glass" | "glass2"): void {
        const container = this.fluidContainers.get(id)!;
        const group = id === "glass" ? this.glassGroup : this.glass2Group;
        container.sim = makeFluidSim(GLASS_FLUID_DIMS, GLASS_POINTS);
        if (id === "glass") {
            seedPowderAtBottom(container.sim, group.members.length);
        } else {
            const barleyRole = BARLEY_POWDER_DROP.cells[0].role;
            const hasBarley = group.members.some(m => m.obj.sprite.cells[0]?.role === barleyRole);
            if (hasBarley) seedPowderAtBottom(container.sim, BARLEY_POWDER_POSITIONS.length, "barley");
        }
        group.clear();
        this.syncLiquidParticles(container);
    }


    getFluidTargetCount(id: "glass" | "glass2"): number {
        const container = this.fluidContainers.get(id)!;
        if (!container.sim) return 0;
        const { dims, solid } = container.sim;
        const fill = this.fillLevelOverride ?? GLASS_FLUID_FILL;
        const cutoff = Math.floor(dims.height * fill);
        let count = 0;
        for (let x = 0; x < dims.width; x++)
            for (let y = dims.height - cutoff; y < dims.height; y++)
                for (let z = 0; z < dims.depth; z++)
                    if (!solid[(x * dims.height + y) * dims.depth + z]) count++;
        return count;
    }

    private overfullWarned = new Set<string>();

    addFluidParticle(id: "glass" | "glass2"): void {
        const container = this.fluidContainers.get(id)!;
        if (!container.sim) return;
        const sim = container.sim;
        const { dims } = sim;
        const cx = Math.floor(dims.width / 2);
        const cz = Math.floor(dims.depth / 2);
        sim.particles.push({ x: cx, y: 0, z: cz, vx: 0, vy: 10, vz: 0, kind: "ethanol" });
        if (!this.overfullWarned.has(id) && fluidFillRatio(sim) >= 1) {
            console.warn(`FluidSim "${id}" is overfull (${sim.particles.length} particles)`);
            this.overfullWarned.add(id);
        }
    }

    addBarleyToFluidSim(id: "glass" | "glass2"): void {
        const container = this.fluidContainers.get(id)!;
        if (!container.sim) return;
        seedPowderAtBottom(container.sim, BARLEY_POWDER_POSITIONS.length, "barley");
    }

    private instantFilled = new Set<string>();
    stepFluidSettling(id: "glass" | "glass2", dt: number): void {
        if (this._instant) {
            if (!this.instantFilled.has(id)) {
                this.fillLiquidContainer(id);
                this.instantFilled.add(id);
            }
            return;
        }
        const container = this.fluidContainers.get(id)!;
        if (container.sim) this.updateFluid(container, dt, false);
    }

    stopStirring(rodId: "stirRod" | "stirRod2"): void {
        this.stoppedStirring.add(rodId);
        applyBladeRadius(this.objects.get(rodId)!.sprite, 0);
    }

    // Secret easter egg: fast-forwards the active countdown timer (if any and
    // already visible) by a random 1-3 minutes by shifting its start time
    // backward. Returns true if a countdown was skipped.
    skipCountdown(): boolean {
        const countdown = this.activeCountdown;
        if (!countdown || performance.now() < countdown.start) return false;
        const skipSeconds = (1 + Math.floor(rand() * 3)) * 60;
        countdown.start -= skipSeconds * 1000;
        return true;
    }

    // The grid row/columns the countdown timer currently occupies, or null if
    // it isn't shown. Used to hit-test clicks for `skipCountdown`.
    getCountdownCellRange(): { row: number; cols: number[] } | null {
        const obj = this.compositor.getObject(COUNTDOWN_TIMER_ID);
        if (!obj || !obj.visible) return null;
        const cols = obj.sprite.cells.map((cell) => Math.round(obj.x - this.compositor.viewOffsetX + cell.dx));
        return { row: Math.round(obj.y), cols };
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
    spawnDrop(sprite: Sprite, from: ObjectLayout, to: ObjectLayout, startT: number, duration: number, arcHeight = 2): void {
        const obj: SceneObject = { id: `drop-${this.nextDropId++}`, sprite, ...from, visible: true };
        this.compositor.setObject(obj);
        this.dropAnimations.push({ obj, from, to, startT, duration, arcHeight });
    }

    // Advances every pending/active drop particle for transition-elapsed time
    // `t` (ms): before `startT` a drop stays at `from`; between `startT` and
    // `startT + duration` it follows `arcLerp`; once landed it's removed from
    // the compositor and `dropAnimations`.
    private updateDrops(t: number): void {
        this.dropAnimations = this.dropAnimations.filter((drop) => {
            if (t < drop.startT) return true;
            const span = drop.duration > 0 ? Math.min(1, (t - drop.startT) / drop.duration) : 1;
            Object.assign(drop.obj, arcLerp(drop.from, drop.to, span, drop.arcHeight));
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
        const splitDone = new Set<number>();
        // Pre-roll which seeds will split so the result is deterministic.
        const splitChance = seeds.map(() => rand());
        const SPLIT_PROB = 0.4;

        const duration = GRIND_DURATION_MIN + rand() * (GRIND_DURATION_MAX - GRIND_DURATION_MIN);
        const baseRotation = this.grinderGroup.rotation;

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

                const seedProgress = Math.min(1, grindProgress * 1.2 + i * 0.015);
                seed.obj.sprite.cells[0].role = seedGrindRole(seedProgress);

                if (!splitDone.has(i) && seedProgress >= 1 / 3 && splitChance[i] < SPLIT_PROB) {
                    splitDone.add(i);
                    const fragX = seed.relX + (rand() - 0.5) * 2;
                    const fragY = Math.max(GRIND_SCATTER_Y_MIN, Math.min(GRIND_SCATTER_Y_MAX, seed.relY + (rand() - 0.5) * 1.5));
                    const frag = this.grinderGroup.addMember({ sprite: SEED_SPRITE, relX: fragX, relY: fragY, relZ: seed.relZ });
                    frag.obj.sprite.cells[0].role = seedGrindRole(seedProgress);
                    seeds.push(frag);
                    seedJitter.push({ vx: (rand() - 0.5) * 4, vy: (rand() - 0.5) * 4 });
                }
            }

            this.grinderGroup.applyOrigin();
        };

        const finish = (): void => {
            this.grinderGroup.setOrigin(this.grinderGroup.x, this.grinderGroup.y, this.grinderGroup.z, baseRotation);
            applyBladeRadius(this.grinderBladeMember.obj.sprite, 0);
            for (const seed of seeds) {
                seed.obj.sprite.cells[0].role = seedGrindRole(1);
                this.grinderGroup.transferTo(seed, this.grinderPowderGroup, seed.relX, seed.relY, seed.relZ);
            }
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

    private syncGroupOrigins(skipSeed = false): void {
        if (!skipSeed) {
            const seedPile = this.objects.get("seedPile")!;
            this.seedGroup.setOrigin(seedPile.x, seedPile.y, seedPile.z, seedPile.rotation);
        }
        const grinderBody = this.objects.get("grinderBody")!;
        this.grinderGroup.setOrigin(grinderBody.x, grinderBody.y, grinderBody.z, grinderBody.rotation);
        this.grinderPowderGroup.setOrigin(grinderBody.x, grinderBody.y, grinderBody.z, grinderBody.rotation);
        const glass = this.objects.get("glass")!;
        this.glassGroup.setOrigin(glass.x, glass.y, glass.z, glass.rotation);
        this.liquidGroup.setOrigin(glass.x, glass.y, glass.z, glass.rotation);
        const dish = this.objects.get("dish")!;
        this.dishLiquidGroup.setOrigin(dish.x, dish.y, dish.z, dish.rotation);
        this.dishResidueGroup.setOrigin(dish.x, dish.y, dish.z, dish.rotation);
        const glass2 = this.objects.get("glass2")!;
        this.glass2Group.setOrigin(glass2.x, glass2.y, glass2.z, glass2.rotation);
        this.liquid2Group.setOrigin(glass2.x, glass2.y, glass2.z, glass2.rotation);
        const bottle = this.objects.get("bottle")!;
        this.bottleLiquidGroup.setOrigin(bottle.x, bottle.y, bottle.z - 1, bottle.rotation);
        const scraper = this.objects.get("scraper")!;
        this.scraperGroup.setOrigin(scraper.x, scraper.y, scraper.z, scraper.rotation);
    }

    // `transitionDuration` seeds the elapsed-time counter passed to
    // EffectLoop.tick, so an effect that was ticking during the transition
    // (elapsed 0..transitionDuration) continues from where it left off.
    private startLoops(loops: Loop[], transitionDuration: number): void {
        const stirring = loops.some((loop) => loop.kind === "pulse" && loop.id === "stirRod");
        const stirring2 = loops.some((loop) => loop.kind === "pulse" && loop.id === "stirRod2");
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
                } else if (!this.stoppedStirring.has(loop.id)) {
                    const radius = bladePulseRadius(elapsed, loop.maxRadius, loop.period);
                    applyBladeRadius(obj.sprite, radius);
                }
            }
            this.syncGroupOrigins();
            if (stirring) this.updateFluid(this.fluidContainers.get("glass")!, dt, !this.stoppedStirring.has("stirRod"));
            if (stirring2) this.updateFluid(this.fluidContainers.get("glass2")!, dt, !this.stoppedStirring.has("stirRod2"));
            this.compositor.render();
            this.rafHandle = requestAnimationFrame(tick);
        };
        this.rafHandle = requestAnimationFrame(tick);
    }

    private updateFluid(container: FluidContainer, dt: number, stirring: boolean): void {
        // Cap dt to avoid explosive forces when the tab resumes after being hidden.
        dt = Math.min(dt, 0.1);
        if (!container.sim) { this.updateVortex(container, dt); return; }
        const sim = container.sim;
        const stir: StirImpulse | null = stirring && sim.bounds
            ? { cx: sim.bounds.cx, cz: sim.bounds.cz, cy: sim.dims.height - 3, yRadius: 3, radius: STIR_IMPULSE_RADIUS, strength: this.stirStrengthOverride ?? STIR_IMPULSE_STRENGTH }
            : null;
        stepFluid(sim, dt, stir);
        this.syncLiquidParticles(container);
    }

    private syncLiquidParticles(container: FluidContainer): void {
        const projected = projectFluidSim(container.sim!);
        const dims = container.sim!.dims;
        let memberIdx = 0;
        for (let x = 0; x < dims.width; x++) {
            for (let y = 0; y < dims.height; y++) {
                const cell = projected[x][y];
                if (!cell) continue;
                const sprite = cell.material === "powder" ? POWDER_PARTICLE : cell.material === "barley" ? BARLEY_POWDER_DROP : LIQUID_PARTICLE;
                const [relX, rawRelY] = gridToRel(x, y, dims, GLASS_INTERIOR);
                const relY = rawRelY - 0.5;
                if (memberIdx < container.group.members.length) {
                    const m = container.group.members[memberIdx];
                    m.relX = relX;
                    m.relY = relY;
                    m.obj.sprite = sprite;
                } else {
                    container.group.addMember({ sprite, relX, relY, relZ: 0 });
                }
                memberIdx++;
            }
        }
        while (container.group.members.length > memberIdx) {
            const m = container.group.members.pop()!;
            this.compositor.removeObject(m.obj.id);
        }
        container.group.applyOrigin();
    }

    // While a stir rod is active, swirls each of `container`'s liquid
    // particles around its glass's center: each particle's radius grows
    // toward LIQUID_VORTEX_RADIUS (pushing it out toward the glass walls)
    // while its angle advances at LIQUID_VORTEX_SPEED.
    private updateVortex(container: FluidContainer, dt: number): void {
        for (const [i, member] of container.group.members.entries()) {
            const state = container.vortex[i];
            if (!state) continue;
            state.angle += LIQUID_VORTEX_SPEED * dt;
            state.radius = Math.min(LIQUID_VORTEX_RADIUS, state.radius + LIQUID_VORTEX_RADIUS * dt);
            member.relX = Math.cos(state.angle) * state.radius;
            member.relY = Math.sin(state.angle) * state.radius * GLASS_ASPECT_RATIO;
        }
        container.group.applyOrigin();
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
