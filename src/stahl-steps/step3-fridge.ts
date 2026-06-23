// Step 3 — Refrigerate. The stir rod lifts up and out of frame to be put
// away; once it's clear, the glass arcs into the waiting fridge, the
// fridge's top cover drops into place, and the 20-minute countdown begins.
// While the fridge runs, ice particles occasionally drift out of its vents
// and settle on the floor.

import { type SceneObject } from "../ascii-compositor";
import { arcLerp } from "../ascii-sprites";
import { rand } from "../rng";
import {
    FRIDGE_FLOOR_Y,
    FRIDGE_LEFT_X,
    FRIDGE_RIGHT_X,
    FRIDGE_TOP_Y,
    FRIDGE_VENT_Y,
    ICE_PARTICLE,
    PROP_PARK_Y,
    type ObjectLayout,
} from "../stahl-props";
import { type Step, type StepEffect } from "../stahl-timeline";
import { type SceneAnimator } from "../stahl-animator";

// How long the stir rod takes to lift out of the glass and up to its parked
// spot above the scene at the start of step 3, before the glass starts
// arcing into the fridge.
export const STIR_ROD_PARK_DURATION = 500;

// How long the glass takes to arc from its step 2 resting spot into the
// fridge interior, and how high that arc rises (high enough to clear the
// left wall along the way).
export const GLASS_FRIDGE_ARC_DURATION = 800;
export const GLASS_FRIDGE_ARC_HEIGHT = 5;

export const GLASS_FRIDGE_REST: ObjectLayout = {
    x: (FRIDGE_LEFT_X + FRIDGE_RIGHT_X) / 2,
    y: FRIDGE_TOP_Y + 3,
    z: 1,
    rotation: 0,
};

// How long the cover waits after the glass lands before it starts
// descending, how long the descent itself takes, and the world y it rests at
// (flush on top of the walls).
export const FRIDGE_COVER_DROP_DELAY = 500;
export const FRIDGE_COVER_DESCEND_DURATION = 500;
export const FRIDGE_COVER_REST_Y = FRIDGE_TOP_Y - 1;

// Ice particles spawn from a random vent roughly every
// [ICE_SPAWN_INTERVAL_MIN, ICE_SPAWN_INTERVAL_MAX) ms, each with a
// ICE_SPAWN_CHANCE probability of actually appearing. A falling particle has
// an ICE_VANISH_CHANCE_PER_TICK chance per check of disappearing mid-flight
// (checked every ICE_VANISH_CHECK_INTERVAL ms); a landed particle always
// disappears after ICE_REST_DURATION ms.
export const ICE_SPAWN_INTERVAL_MIN = 1000;
export const ICE_SPAWN_INTERVAL_MAX = 3000;
export const ICE_SPAWN_CHANCE = 0.4;
export const ICE_FALL_DURATION = 1400;
export const ICE_FALL_ARC_HEIGHT = 1;
// Horizontal drift toward the pane's center as a particle falls from its vent.
export const ICE_DRIFT_X = 3;
export const ICE_VANISH_CHECK_INTERVAL = 150;
export const ICE_VANISH_CHANCE_PER_TICK = 0.08;
export const ICE_REST_DURATION = 2000;

// ---------------------------------------------------------------------------
// Per-frame effects
// ---------------------------------------------------------------------------

// Carries the glass (and its riding powder/liquid groups) along a parabolic
// arc from its step 2 resting spot into the fridge interior. Runs first;
// `CoverDropEffect` waits for `isLanded` before starting its descent.
export class GlassFridgeArcEffect implements StepEffect {
    private landed = false;
    private readonly from: ObjectLayout;

    constructor(anim: SceneAnimator) {
        const glass = anim.getObject("glass");
        this.from = { x: glass.x, y: glass.y, z: glass.z, rotation: glass.rotation };
    }

    get isLanded(): boolean {
        return this.landed;
    }

    tick(t: number, anim: SceneAnimator): void {
        if (this.landed) return;
        if (t < STIR_ROD_PARK_DURATION) return;
        const span = Math.min(1, (t - STIR_ROD_PARK_DURATION) / GLASS_FRIDGE_ARC_DURATION);
        const layout = arcLerp(this.from, GLASS_FRIDGE_REST, span, GLASS_FRIDGE_ARC_HEIGHT);
        const glass = anim.getObject("glass");
        Object.assign(glass, layout);
        anim.glassGroup.setOrigin(glass.x, glass.y, glass.z, glass.rotation);
        anim.liquidGroup.setOrigin(glass.x, glass.y, glass.z, glass.rotation);
        if (span >= 1) this.landed = true;
    }
}

// Drops the fridge's top cover from off-screen onto the walls
// FRIDGE_COVER_DROP_DELAY after the glass has landed (see
// GlassFridgeArcEffect).
export class CoverDropEffect implements StepEffect {
    private landedT: number | null = null;
    private landed = false;

    constructor(private glassArc: GlassFridgeArcEffect) {}

    get isLanded(): boolean {
        return this.landed;
    }

    tick(t: number, anim: SceneAnimator): void {
        if (this.landed) return;
        if (this.landedT === null) {
            if (!this.glassArc.isLanded) return;
            // Use the arc's nominal end time rather than the (possibly
            // overshot) frame time `t`, so `startT + FRIDGE_COVER_DESCEND_DURATION`
            // lands exactly at `transitionDuration` and `span` reaches 1.
            this.landedT = STIR_ROD_PARK_DURATION + GLASS_FRIDGE_ARC_DURATION;
        }
        const startT = this.landedT + FRIDGE_COVER_DROP_DELAY;
        if (t < startT) return;
        const span = Math.min(1, (t - startT) / FRIDGE_COVER_DESCEND_DURATION);
        const cover = anim.getObject("fridgeCover");
        cover.y = lerp(PROP_PARK_Y, FRIDGE_COVER_REST_Y, span);
        if (span >= 1) this.landed = true;
    }
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

// While the fridge runs (once the cover has landed), occasionally ejects an
// ice particle from a random vent that falls in a parabolic arc to the
// fridge floor, sometimes vanishing mid-flight, and always vanishing after
// resting on the floor for ICE_REST_DURATION ms.
interface FallingIce {
    obj: SceneObject;
    from: ObjectLayout;
    to: ObjectLayout;
    startT: number;
    landedAt: number | null;
    nextVanishCheck: number;
}

export class IceParticleEffect implements StepEffect {
    private particles: FallingIce[] = [];
    private nextSpawnAt: number;
    private nextId = 0;

    constructor(private coverDrop: CoverDropEffect) {
        this.nextSpawnAt = ICE_SPAWN_INTERVAL_MIN + rand() * (ICE_SPAWN_INTERVAL_MAX - ICE_SPAWN_INTERVAL_MIN);
    }

    tick(t: number, anim: SceneAnimator): void {
        if (!this.coverDrop.isLanded) return;

        if (t >= this.nextSpawnAt) {
            this.nextSpawnAt = t + ICE_SPAWN_INTERVAL_MIN + rand() * (ICE_SPAWN_INTERVAL_MAX - ICE_SPAWN_INTERVAL_MIN);
            const roll = rand();
            if (roll < ICE_SPAWN_CHANCE) this.spawn(t, anim);
        }

        this.particles = this.particles.filter((ice) => this.tickParticle(ice, t, anim));
    }

    private spawn(t: number, anim: SceneAnimator): void {
        const fromLeft = rand() < 0.5;
        const ventX = fromLeft ? FRIDGE_LEFT_X : FRIDGE_RIGHT_X;
        // Drift toward the pane's center as the particle falls, away from
        // its vent's wall.
        const toX = fromLeft ? ventX + ICE_DRIFT_X : ventX - ICE_DRIFT_X;
        // z=2 (in front of the glass at z=1) so falling ice passes over it.
        const from: ObjectLayout = { x: ventX + (fromLeft ? 1 : -1), y: FRIDGE_VENT_Y, z: 2, rotation: 0 };
        const to: ObjectLayout = { x: toX, y: FRIDGE_FLOOR_Y, z: 2, rotation: 0 };
        const obj: SceneObject = { id: `ice-${this.nextId++}`, sprite: ICE_PARTICLE, ...from, visible: true };
        anim.addTransient(obj);
        this.particles.push({ obj, from, to, startT: t, landedAt: null, nextVanishCheck: t + ICE_VANISH_CHECK_INTERVAL });
    }

    // Advances one particle; returns false once it should be removed.
    private tickParticle(ice: FallingIce, t: number, anim: SceneAnimator): boolean {
        if (ice.landedAt !== null) {
            if (t - ice.landedAt >= ICE_REST_DURATION) {
                anim.removeTransient(ice.obj.id);
                return false;
            }
            return true;
        }

        const span = Math.min(1, (t - ice.startT) / ICE_FALL_DURATION);
        Object.assign(ice.obj, arcLerp(ice.from, ice.to, span, ICE_FALL_ARC_HEIGHT));

        if (span >= 1) {
            ice.landedAt = t;
            return true;
        }

        if (t >= ice.nextVanishCheck) {
            ice.nextVanishCheck = t + ICE_VANISH_CHECK_INTERVAL;
            if (rand() < ICE_VANISH_CHANCE_PER_TICK) {
                anim.removeTransient(ice.obj.id);
                return false;
            }
        }
        return true;
    }
}

class FluidSettleEffect implements StepEffect {
    private lastT: number | null = null;

    constructor(private coverDrop: CoverDropEffect) {}

    tick(t: number, anim: SceneAnimator): void {
        if (!this.coverDrop.isLanded) { this.lastT = t; return; }
        const dt = this.lastT !== null ? Math.max(0, t - this.lastT) / 1000 : 0;
        this.lastT = t;
        if (dt > 0) anim.stepFluidSettling("glass", dt);
    }
}

function buildStep3Effects(anim: SceneAnimator): StepEffect[] {
    anim.stopStirring("stirRod");
    const glassArc = new GlassFridgeArcEffect(anim);
    const coverDrop = new CoverDropEffect(glassArc);
    return [glassArc, coverDrop, new IceParticleEffect(coverDrop), new FluidSettleEffect(coverDrop)];
}

export const STEP3: Step = {
    transitionDuration:
        STIR_ROD_PARK_DURATION + GLASS_FRIDGE_ARC_DURATION + FRIDGE_COVER_DROP_DELAY + FRIDGE_COVER_DESCEND_DURATION,
    transitionKeyframes: [
        { t: STIR_ROD_PARK_DURATION, objects: { stirRod: { y: PROP_PARK_Y, rotation: 0 } } },
    ],
    effects: buildStep3Effects,
    // Keeps spawning ice particles for as long as step 3 is shown, well
    // beyond the transition's own duration.
    loops: (effects) => {
        const loops: Array<{ kind: "effect"; effect: StepEffect }> = [];
        for (const e of effects) {
            if (e instanceof IceParticleEffect || e instanceof FluidSettleEffect)
                loops.push({ kind: "effect", effect: e });
        }
        return loops;
    },
    // The "refrigerate for 20 minutes" countdown appears 5s after the
    // cover has finished dropping into place, already showing 5s elapsed.
    countdown: { totalSeconds: 20 * 60, startDelay: 5000, preElapsed: 5 },
};
