// Step 4 — Evaporate. The fridge cover lifts back to its parking spot
// above; after a pause, the glass arcs up out of the fridge partway
// toward the dish, then tips (pivoting around its bottom-right corner)
// the rest of the way over the dish to pour. It pauses tipped while the
// liquid spills, then rotates back upright, pauses again, and arcs back
// up to its step 2 resting spot. The poured liquid gradually evaporates
// into "." residue in the dish, with steam rising as it does; the fan
// starts a beat after the glass lands, and spins until the liquid is gone.

import { type PropGroupMember } from "../ascii-compositor";
import { arcLerp } from "../ascii-sprites";
import { rand } from "../rng";
import {
    DISH_LIQUID_POSITIONS,
    DISH_POINTS,
    DISH_RESIDUE_PARTICLE,
    DISH_WIDTH,
    GLASS_PIVOT,
    GLASS_POINTS,
    GLASS_POWDER_POSITIONS,
    INITIAL_LAYOUT,
    LIQUID_PARTICLE,
    PANE_WIDTH,
    POWDER_PARTICLE,
    PROP_PARK_Y,
    type ObjectLayout,
} from "../stahl-props";
import { GLASS_FRIDGE_REST } from "./step3-fridge";
import { type Step, type StepEffect } from "../stahl-timeline";
import { type SceneAnimator } from "../stahl-animator";
import { PourTransfer } from "../pour-transfer";

const TAU = Math.PI * 2;
const STEP2_GLASS_X = 7.5 + 2 * PANE_WIDTH;

// Step 4 plays as a sequence of non-overlapping phases: the fridge cover
// lifts to its parked spot above, a pause, then the glass arcs up out of the
// fridge partway toward the dish (stopping near the arc's peak), tips
// (pivoting around its bottom-right corner) the rest of the way over the dish
// to pour, pauses while it spills, then rotates back upright, pauses again,
// and arcs back up to its step 2 resting spot.

// How long the fridge cover takes to lift from the walls back up to
// PROP_PARK_Y, and how long the pause after that is before the glass moves.
export const STEP4_COVER_LIFT_DURATION = 500;
export const STEP4_PRE_POUR_PAUSE = 1000;

// World y the glass arcs up to before tipping, high enough to clear the
// fridge walls (FRIDGE_TOP_Y) and the dish on its way over. While
// lifted/pouring, the glass's z is raised above the fridge cover's so it
// draws on top of the fridge.
export const STEP4_GLASS_LIFT_Y = 2;
export const STEP4_GLASS_RAISED_Z = 4;

// How long the glass takes to arc up out of the fridge toward the dish, and
// how high that arc rises. The arc is cut short at its peak (span 0.5, i.e.
// STEP4_ARC_PEAK) — the glass ends up partway between the fridge and the
// dish, elevated, and the tip rotation (pivoting around its bottom-right
// corner) swings it the rest of the way over the dish to pour.
export const STEP4_GLASS_ARC_DURATION = 1600;
export const STEP4_GLASS_ARC_HEIGHT = 2.5;

// World x/y the glass's arc out of the fridge is aimed at (its pour position,
// upright); the angle it then tips to (pivoting around its bottom-right
// corner) and how long that tip takes; and how long the pour itself takes
// once tipped (during which liquid transfers from the glass into the dish).
export const STEP4_POUR_X = 7.5 + 4 * PANE_WIDTH - DISH_WIDTH / 2 + 1.5 - 7;
export const STEP4_POUR_Y = 5 - 3;
export const STEP4_POUR_ROTATION = TAU * (110 / 360);
export const STEP4_GLASS_TIP_DURATION = 4800;
// The pour starts partway through the tip (once tilted enough) and finishes
// at STEP4_POUR_DURATION after STEP4_POUR_START. Particles release in small
// batches spread across this window for a gradual stream.
export const STEP4_POUR_START_FRACTION = 0.15;
export const STEP4_POUR_DURATION = 4000;
const POUR_RELEASE_FRACTION = 0.8;
const POUR_FLIGHT_DURATION = 1500;

// How long the glass pauses tipped over the dish (after the last drop lands)
// before rotating back upright, and how long that rotation back takes (also
// pivoting around the bottom-right corner).
export const STEP4_POUR_TO_RETURN_PAUSE = 500;
export const STEP4_GLASS_RIGHT_DURATION = 500;

// How long the glass pauses upright over the dish before starting its return
// trip, and how long it takes to arc back up to its step 2 resting spot, and
// how high that arc rises.
export const STEP4_RIGHT_TO_RETURN_PAUSE = 500;
export const STEP4_GLASS_RETURN_DURATION = 1800;
export const STEP4_GLASS_RETURN_ARC_HEIGHT = 2.5;

// How long after the glass arrives back at its step 2 resting spot before the
// fan starts spinning.
export const STEP4_FAN_START_DELAY = 1000;

// Cumulative elapsed time (ms) at the end of each step 4 phase, shared by
// transitionKeyframes and the per-frame effects below so they stay in sync.
const STEP4_COVER_LIFT_END = STEP4_COVER_LIFT_DURATION;
const STEP4_PRE_POUR_PAUSE_END = STEP4_COVER_LIFT_END + STEP4_PRE_POUR_PAUSE;
const STEP4_GLASS_ARC_END = STEP4_PRE_POUR_PAUSE_END + STEP4_GLASS_ARC_DURATION;
const STEP4_POUR_START = STEP4_GLASS_ARC_END + STEP4_GLASS_TIP_DURATION * STEP4_POUR_START_FRACTION;
const STEP4_GLASS_TIP_END = STEP4_GLASS_ARC_END + STEP4_GLASS_TIP_DURATION;
const STEP4_POUR_END = Math.max(STEP4_GLASS_TIP_END, STEP4_POUR_START + STEP4_POUR_DURATION * POUR_RELEASE_FRACTION + POUR_FLIGHT_DURATION);
const STEP4_POUR_TO_RETURN_PAUSE_END = STEP4_POUR_END + STEP4_POUR_TO_RETURN_PAUSE;
const STEP4_GLASS_RIGHT_END = STEP4_POUR_TO_RETURN_PAUSE_END + STEP4_GLASS_RIGHT_DURATION;
const STEP4_RIGHT_TO_RETURN_PAUSE_END = STEP4_GLASS_RIGHT_END + STEP4_RIGHT_TO_RETURN_PAUSE;
const STEP4_GLASS_RETURN_END = STEP4_RIGHT_TO_RETURN_PAUSE_END + STEP4_GLASS_RETURN_DURATION;
export const STEP4_TRANSITION_DURATION = STEP4_GLASS_RETURN_END;

// How long, after a liquid particle lands in the dish, before it starts
// evaporating, and how long each phase of evaporation takes: first rising 1-2
// rows, then drifting diagonally up and to the left until it fades away.
export const EVAPORATE_DELAY_MIN = 1000;
export const EVAPORATE_DELAY_MAX = 4000;
export const EVAPORATE_RISE_DURATION = 600;
export const EVAPORATE_RISE_MIN = 1;
export const EVAPORATE_RISE_MAX = 2;
export const EVAPORATE_DRIFT_DURATION = 1200;
export const EVAPORATE_DRIFT_DISTANCE = 6;

// Where the glass would land if its step 4 arc out of the fridge (see
// GlassLiftArcEffect) ran the full span 0..1, upright above the dish.
const STEP4_ARC_TARGET: ObjectLayout = { x: STEP4_POUR_X, y: STEP4_GLASS_LIFT_Y, z: STEP4_GLASS_RAISED_Z, rotation: 0 };

// World x/y/z the glass arcs up out of the fridge to (its position at
// STEP4_GLASS_ARC_END) — the arc's peak, cut short at span 0.5, partway
// between the fridge and the dish. The tip rotation (pivoting around the
// glass's bottom-right corner) then swings it the rest of the way over the
// dish to pour.
export const STEP4_ARC_PEAK: ObjectLayout = arcLerp(GLASS_FRIDGE_REST, STEP4_ARC_TARGET, 0.5, STEP4_GLASS_ARC_HEIGHT);

// ---------------------------------------------------------------------------
// Per-frame effects
// ---------------------------------------------------------------------------

// Once the pre-pour pause ends (t >= STEP4_PRE_POUR_PAUSE_END), carries the
// glass (and its riding powder/liquid groups) along a parabolic arc out of
// the fridge, cut short at the arc's peak (span 0.5, i.e. STEP4_ARC_PEAK) —
// partway between the fridge and the dish, elevated. The tip rotation
// (pivoting around the glass's bottom-right corner) then swings it the rest
// of the way over the dish. z jumps to STEP4_GLASS_RAISED_Z immediately, so
// the glass draws on top of the fridge cover for the whole arc.
class GlassLiftArcEffect implements StepEffect {
    private landed = false;

    get isLanded(): boolean {
        return this.landed;
    }

    tick(t: number, anim: SceneAnimator): void {
        if (this.landed) return;
        if (t < STEP4_PRE_POUR_PAUSE_END) return;
        const span = Math.min(1, (t - STEP4_PRE_POUR_PAUSE_END) / STEP4_GLASS_ARC_DURATION) * 0.5;
        const layout = arcLerp(GLASS_FRIDGE_REST, STEP4_ARC_TARGET, span, STEP4_GLASS_ARC_HEIGHT);
        layout.z = STEP4_GLASS_RAISED_Z;
        const glass = anim.getObject("glass");
        Object.assign(glass, layout);
        anim.glassGroup.setOrigin(glass.x, glass.y, glass.z, glass.rotation);
        anim.liquidGroup.setOrigin(glass.x, glass.y, glass.z, glass.rotation);
        if (span >= 0.5) this.landed = true;
    }
}

const LIQUID_ROLE = LIQUID_PARTICLE.cells[0].role;
const POWDER_ROLE = POWDER_PARTICLE.cells[0].role;
function isLiquid(m: PropGroupMember): boolean { return m.obj.sprite.cells[0]?.role === LIQUID_ROLE; }
function isPowder(m: PropGroupMember): boolean { return m.obj.sprite.cells[0]?.role === POWDER_ROLE; }

function buildLiquidPourTransfer(): PourTransfer {
    let nextDestAdd = 0;
    return new PourTransfer({
        label: "glass→dish",
        initT: STEP4_COVER_LIFT_END,
        simConfig: {
            sourcePoints: GLASS_POINTS,
            sourceClosed: false,
            sourcePivot: GLASS_PIVOT,
            targetPoints: DISH_POINTS,
            targetClosed: false,
        },
        visualIdPrefix: "pour-liquid",
        visualZ: STEP4_GLASS_RAISED_Z - 1,
        visualSprite: LIQUID_PARTICLE,
        onPreInit: (anim) => {
            anim.disableFluidSim("glass");
            const existing = anim.liquidGroup.members.filter(isPowder);
            for (const m of existing) anim.removeLiquidParticle(m);
            for (const [relX, relY] of GLASS_POWDER_POSITIONS) {
                anim.liquidGroup.addMember({ sprite: POWDER_PARTICLE, relX, relY, relZ: 1 });
            }
        },
        getSourceMembers: (anim) => anim.liquidGroup.members.filter(isLiquid),
        getBackgroundMembers: (anim) => anim.liquidGroup.members.filter(isPowder),
        backgroundKind: "powder",
        getSourceState: (anim) => { const g = anim.getObject("glass"); return { x: g.x, y: g.y, rotation: g.rotation }; },
        getTargetState: (anim) => { const d = anim.getObject("dish"); return { x: d.x, y: d.y, rotation: d.rotation }; },
        destTotal: (n) => Math.min(n, DISH_LIQUID_POSITIONS.length),
        onDrain: (count, members, nextIdx, anim) => {
            for (let j = 0; j < count && nextIdx < members.length; j++) {
                const member = members[nextIdx++];
                anim.liquidGroup.release(member);
                member.obj.visible = false;
            }
            return nextIdx;
        },
        onFill: (count, anim) => {
            for (let j = 0; j < count && nextDestAdd < DISH_LIQUID_POSITIONS.length; j++) {
                const [relX, relY] = DISH_LIQUID_POSITIONS[nextDestAdd++];
                anim.dishLiquidGroup.addMember({ sprite: LIQUID_PARTICLE, relX, relY, relZ: -1 });
            }
        },
        deadline: STEP4_RIGHT_TO_RETURN_PAUSE_END,
        onSnapshotRemaining: (x, y, anim) => {
            const glass = anim.getObject("glass");
            anim.liquidGroup.addMember({ sprite: LIQUID_PARTICLE, relX: x - glass.x, relY: y - glass.y, relZ: 2 });
        },
        onAllLanded: (anim) => {
            anim.dishLiquidGroup.setOrigin(
                anim.dishLiquidGroup.x, anim.dishLiquidGroup.y,
                anim.dishLiquidGroup.z, anim.dishLiquidGroup.rotation,
            );
        },
    });
}

// Per-particle evaporation state: `pending` until `evaporateAt`, then `rising`
// straight up for EVAPORATE_RISE_DURATION, then `drifting` diagonally toward
// the upper-left for EVAPORATE_DRIFT_DURATION before vanishing and leaving a
// "." residue particle behind at its original rest offset.
interface EvaporatingParticle {
    member: PropGroupMember;
    restX: number;
    restY: number;
    evaporateAt: number;
    phase: "pending" | "rising" | "drifting" | "done";
    phaseStart: number;
    from: ObjectLayout;
    to: ObjectLayout;
}

// Once `pour.isLanded` and `fanSpin.startedAt` is known (the fan has started
// spinning), schedules each of `anim.dishLiquidGroup`'s particles to evaporate
// at a random offset: it rises 1-2 rows, then drifts diagonally up and to the
// left until it vanishes, leaving "." residue behind in
// `anim.dishResidueGroup` at its original spot in the dish.
class EvaporationEffect implements StepEffect {
    private particles: EvaporatingParticle[] | null = null;

    constructor(private pour: PourTransfer, private fanSpin: FanSpinEffect) { }

    // True once every poured particle has finished evaporating.
    get allEvaporated(): boolean {
        return this.particles !== null && this.particles.every((p) => p.phase === "done");
    }

    tick(t: number, anim: SceneAnimator): void {
        if (!this.pour.isLanded || this.fanSpin.startedAt === null) return;

        if (!this.particles) {
            this.particles = anim.dishLiquidGroup.members.map((member) => ({
                member,
                restX: member.relX,
                restY: member.relY,
                evaporateAt: this.fanSpin.startedAt! + EVAPORATE_DELAY_MIN + rand() * (EVAPORATE_DELAY_MAX - EVAPORATE_DELAY_MIN),
                phase: "pending",
                phaseStart: t,
                from: { x: 0, y: 0, z: 0, rotation: 0 },
                to: { x: 0, y: 0, z: 0, rotation: 0 },
            }));
        }

        for (const particle of this.particles) {
            this.tickParticle(particle, t, anim);
        }
    }

    private tickParticle(particle: EvaporatingParticle, t: number, anim: SceneAnimator): void {
        if (particle.phase === "done") return;

        if (particle.phase === "pending") {
            if (t < particle.evaporateAt) return;
            anim.dishLiquidGroup.release(particle.member);
            anim.dishResidueGroup.addMember({ sprite: DISH_RESIDUE_PARTICLE, relX: particle.restX, relY: particle.restY, relZ: 0 });
            const obj = particle.member.obj;
            const rise = EVAPORATE_RISE_MIN + rand() * (EVAPORATE_RISE_MAX - EVAPORATE_RISE_MIN);
            particle.from = { x: obj.x, y: obj.y, z: obj.z, rotation: obj.rotation };
            particle.to = { x: obj.x, y: obj.y - rise, z: obj.z, rotation: obj.rotation };
            particle.phase = "rising";
            particle.phaseStart = t;
        }

        if (particle.phase === "rising") {
            const span = Math.min(1, (t - particle.phaseStart) / EVAPORATE_RISE_DURATION);
            Object.assign(particle.member.obj, arcLerp(particle.from, particle.to, span, 0));
            if (span >= 1) {
                const obj = particle.member.obj;
                particle.from = { x: obj.x, y: obj.y, z: obj.z, rotation: obj.rotation };
                particle.to = { x: obj.x - EVAPORATE_DRIFT_DISTANCE, y: obj.y - EVAPORATE_DRIFT_DISTANCE / 2, z: obj.z, rotation: obj.rotation };
                particle.phase = "drifting";
                particle.phaseStart = t;
            }
        }

        if (particle.phase === "drifting") {
            const span = Math.min(1, (t - particle.phaseStart) / EVAPORATE_DRIFT_DURATION);
            Object.assign(particle.member.obj, arcLerp(particle.from, particle.to, span, 0));
            if (span >= 1) {
                anim.removeDishLiquidParticle(particle.member);
                particle.phase = "done";
            }
        }
    }
}

// Once the glass has righted itself and paused (t >= STEP4_RIGHT_TO_RETURN_PAUSE_END),
// carries it (and its riding powder/liquid groups) along a parabolic arc up
// to its step 2 resting spot over STEP4_GLASS_RETURN_DURATION. The glass's
// x/y/z/rotation don't change during the tip/right/pause phases (only
// rotation does, pivoting around GLASS_PIVOT), so `from` is just its arc-peak
// position with rotation back at 0.
class GlassReturnArcEffect implements StepEffect {
    private landed = false;
    private readonly from: ObjectLayout = { ...STEP4_ARC_PEAK, z: STEP4_GLASS_RAISED_Z, rotation: 0 };
    private readonly to: ObjectLayout = {
        x: STEP2_GLASS_X,
        y: INITIAL_LAYOUT.glass.y,
        z: INITIAL_LAYOUT.glass.z,
        rotation: 0,
    };

    get isLanded(): boolean {
        return this.landed;
    }

    tick(t: number, anim: SceneAnimator): void {
        if (this.landed) return;
        if (t < STEP4_RIGHT_TO_RETURN_PAUSE_END) return;
        const span = Math.min(1, (t - STEP4_RIGHT_TO_RETURN_PAUSE_END) / STEP4_GLASS_RETURN_DURATION);
        const layout = arcLerp(this.from, this.to, span, STEP4_GLASS_RETURN_ARC_HEIGHT);
        const glass = anim.getObject("glass");
        Object.assign(glass, layout);
        anim.glassGroup.setOrigin(glass.x, glass.y, glass.z, glass.rotation);
        anim.liquidGroup.setOrigin(glass.x, glass.y, glass.z, glass.rotation);
        if (span >= 1) this.landed = true;
    }
}

// Spins the fan continuously once the glass has landed back at its step 2
// resting spot (see GlassReturnArcEffect) and STEP4_FAN_START_DELAY has
// elapsed since, while liquid remains in the dish, stopping once
// `evaporation.allEvaporated`.
class FanSpinEffect implements StepEffect {
    private lastT = 0;
    private landedT: number | null = null;
    private evaporation: EvaporationEffect | null = null;

    constructor(private glassReturn: GlassReturnArcEffect) { }

    // Lets EvaporationEffect know once `allEvaporated` is meaningful.
    setEvaporation(evaporation: EvaporationEffect): void {
        this.evaporation = evaporation;
    }

    // The t at which the fan started spinning, or null if it hasn't yet.
    get startedAt(): number | null {
        if (this.landedT === null) return null;
        const start = this.landedT + STEP4_FAN_START_DELAY;
        return start <= this.lastT ? start : null;
    }

    tick(t: number, anim: SceneAnimator): void {
        const dt = Math.max(0, t - this.lastT) / 1000;
        this.lastT = t;
        if (this.landedT === null) {
            if (!this.glassReturn.isLanded) return;
            this.landedT = t;
        }
        if (t < this.landedT + STEP4_FAN_START_DELAY || this.evaporation?.allEvaporated) return;
        const fan = anim.getObject("fan");
        fan.rotation += TAU * 1.2 * dt;
    }
}

function buildStep4Effects(_anim: SceneAnimator): StepEffect[] {
    const glassLift = new GlassLiftArcEffect();
    const pour = buildLiquidPourTransfer();
    const glassReturn = new GlassReturnArcEffect();
    const fanSpin = new FanSpinEffect(glassReturn);
    const evaporation = new EvaporationEffect(pour, fanSpin);
    fanSpin.setEvaporation(evaporation);
    return [glassLift, pour, glassReturn, fanSpin, evaporation];
}

export const STEP4: Step = {
    transitionDuration: STEP4_TRANSITION_DURATION,
    transitionKeyframes: [
        // The fridge cover lifts back off the walls to its parked spot
        // above.
        { t: STEP4_COVER_LIFT_END, objects: {
            fridgeCover: { y: PROP_PARK_Y },
            glass: { ...GLASS_FRIDGE_REST, z: STEP4_GLASS_RAISED_Z },
        } },
        { t: STEP4_PRE_POUR_PAUSE_END, objects: { glass: { ...GLASS_FRIDGE_REST, z: STEP4_GLASS_RAISED_Z } } },
        // Holds at the arc's peak (STEP4_ARC_PEAK, set by
        // GlassLiftArcEffect) before tipping to pour, rotating around its
        // bottom-right corner (GLASS_PIVOT) so that corner stays put on
        // screen and swings the glass body the rest of the way over the
        // dish.
        {
            t: STEP4_GLASS_ARC_END, objects: {
                glass: { ...STEP4_ARC_PEAK, z: STEP4_GLASS_RAISED_Z, rotation: 0 },
            }
        },
        {
            t: STEP4_GLASS_TIP_END, objects: {
                glass: { ...STEP4_ARC_PEAK, z: STEP4_GLASS_RAISED_Z, rotation: STEP4_POUR_ROTATION },
            }
        },
        // Holds the tipped pose through the pour, so it doesn't start
        // rotating back until the liquid has landed in the dish.
        {
            t: STEP4_POUR_END, objects: {
                glass: { ...STEP4_ARC_PEAK, z: STEP4_GLASS_RAISED_Z, rotation: STEP4_POUR_ROTATION },
            }
        },
        // Holds the tipped pose a little longer after the pour lands
        // before rotating back upright.
        {
            t: STEP4_POUR_TO_RETURN_PAUSE_END, objects: {
                glass: { ...STEP4_ARC_PEAK, z: STEP4_GLASS_RAISED_Z, rotation: STEP4_POUR_ROTATION },
            }
        },
        // Rotates back upright, again pivoting around its bottom-right
        // corner, then pauses before GlassReturnArcEffect takes over
        // x/y/z/rotation for the arc back to the step 2 resting spot.
        {
            t: STEP4_GLASS_RIGHT_END, objects: {
                glass: { ...STEP4_ARC_PEAK, z: STEP4_GLASS_RAISED_Z, rotation: 0 },
            }
        },
        {
            t: STEP4_RIGHT_TO_RETURN_PAUSE_END, objects: {
                glass: { ...STEP4_ARC_PEAK, z: STEP4_GLASS_RAISED_Z, rotation: 0 },
            }
        },
    ],
    effects: buildStep4Effects,
    // Keeps the fan spinning and the dish's liquid evaporating for as
    // long as step 4 is shown, well beyond the transition's own duration.
    loops: (effects) => {
        const pour = effects.find((e): e is PourTransfer => e instanceof PourTransfer);
        const evaporation = effects.find((e): e is EvaporationEffect => e instanceof EvaporationEffect);
        const glassReturn = effects.find((e): e is GlassReturnArcEffect => e instanceof GlassReturnArcEffect);
        const fan = effects.find((e): e is FanSpinEffect => e instanceof FanSpinEffect);
        return pour && evaporation && glassReturn && fan
            ? [
                { kind: "effect", effect: pour },
                { kind: "effect", effect: evaporation },
                { kind: "effect", effect: glassReturn },
                { kind: "effect", effect: fan },
            ]
            : [];
    },
};
