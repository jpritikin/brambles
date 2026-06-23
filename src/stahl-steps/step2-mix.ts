// Step 2 — Mix & stir. The grinder lifts and tips ~110° clockwise above the
// waiting shot glass, pauses, then pours its ground seed dust in and rights
// itself; once it's back at rest, the stir rod descends from above into the
// glass and starts pulsing continuously.
//
// The three pours (grinder, bottle, stick) are each a self-contained
// Sequence, shuffled into a random order once at module load and concatenated
// with the stir rod's descent (see `concatSequences`). The shuffled offsets
// feed both this step's transitionKeyframes and its per-frame effects, so the
// pour-fall and drop-particle effects fire at the same point in the timeline
// where each sequence's grinder/bottle/stick keyframes place it.

import { type PropGroupMember } from "../ascii-compositor";
import { GroupArcTransfer } from "../ascii-sprites";
import { rand } from "../rng";
import {
    ACID_DROP,
    BOTTLE_REST_ROTATION,
    GLASS_POWDER_POSITIONS,
    INITIAL_LAYOUT,
    LIQUID_PARTICLE,
    PANE_WIDTH,
    POUR_PROP_Y,
    PROP_PARK_Y,
    STICK_BOWL_BASE_CELL_INDICES,
    STIR_ROD_DESCEND_DURATION,
    STIR_ROD_PULSE_PERIOD,
    STIR_ROD_RADIUS,
    STIR_ROD_REST_Y,
    STIR_ROD_START_Y,
    TAU,
    travelDuration,
    type ObjectLayout,
} from "../stahl-props";
import { concatSequences, type Sequence, type Step, type StepEffect } from "../stahl-timeline";
import { type SceneAnimator } from "../stahl-animator";

// How long the ground seed dust takes to fall from the tipped grinder into
// the glass during step 2's pour.
export const POUR_FLIGHT_DURATION = 1000;

// How far (radians) the grinder rotates clockwise while pouring, and how
// long the lift/rotate and rotate-back/descend phases each take.
export const POUR_TIP_ROTATION = TAU * (110 / 360);
export const POUR_TIP_DURATION = 500;
export const POUR_RETURN_DURATION = 500;

// How long the grinder pauses, tipped over the glass, before the seed
// fragments fall.
export const POUR_PAUSE_DURATION = 1200;

// Phase durations for the bottle's (ethanol) and stick's (tartaric acid)
// pour sequences: descend above the glass, pause while pouring drops, then
// ascend (bottle) or right itself and ascend (stick) back off-screen. The
// bottle's descend/ascend durations are computed from travel distance (see
// bottlePourTravelDuration).
// The bottle's pause/pour phase (BOTTLE_POUR_DURATION) is split into: a brief
// pause at rest, rotating to the tip angle, a pause while tipped, then
// rotating back to rest. Ethanol drops fall throughout this whole window
// (see BottlePourEffect).
export const BOTTLE_PRE_TIP_PAUSE_DURATION = 400;
export const BOTTLE_ROTATE_DURATION = 350;
export const BOTTLE_TIPPED_PAUSE_DURATION = 3000;
export const BOTTLE_POUR_DURATION =
    BOTTLE_PRE_TIP_PAUSE_DURATION + BOTTLE_ROTATE_DURATION + BOTTLE_TIPPED_PAUSE_DURATION + BOTTLE_ROTATE_DURATION;
// A final pause at rest, back over the glass, before ascending off-screen.
export const BOTTLE_POST_POUR_PAUSE_DURATION = 500;

// How long the ethanol particles take to arc from the bottle into the glass
// once the pour begins (see BottlePourEffect).
export const BOTTLE_POUR_FLIGHT_DURATION = 1000;

// The stick sits still over the glass for STICK_PRE_POUR_PAUSE_DURATION
// before its bowl tips to dump (STICK_DUMP_DURATION). Its descend/ascend
// durations are computed from travel distance (see tipPourTravelDuration).
export const STICK_PRE_POUR_PAUSE_DURATION = 1400;
export const STICK_DUMP_DURATION = 1400;
export const STICK_POUR_DURATION = STICK_PRE_POUR_PAUSE_DURATION + STICK_DUMP_DURATION;
export const STICK_DROP_FALL_DURATION = 500;

// How far the bottle tips while pouring, beyond its resting tilt
// (BOTTLE_REST_ROTATION), clockwise.
export const BOTTLE_TIP_ROTATION = BOTTLE_REST_ROTATION + TAU * (65 / 360);

// ---------------------------------------------------------------------------
// Pour sequences
// ---------------------------------------------------------------------------
// `parkX` is the prop's own resting x (off-screen above the viewport);
// `glassX` is the glass's world x for this step.

// The grinder's existing tip/pause/pour/return motion, expressed as a
// Sequence relative to its own start. The pour-fall (seed dust falling into
// the glass) is handled separately via the SeedPourEffect below, computed
// from this sequence's offset in the concatenated order.
function buildGrinderPourSequence(parkX: number, glassX: number): Sequence {
    const duration = POUR_TIP_DURATION + POUR_PAUSE_DURATION + POUR_FLIGHT_DURATION + POUR_RETURN_DURATION;
    const pauseEnd = POUR_TIP_DURATION + POUR_PAUSE_DURATION + POUR_FLIGHT_DURATION;
    return {
        duration,
        keyframes: [
            { t: 0, objects: { grinderBody: { x: parkX, y: 6, rotation: 0 } } },
            { t: POUR_TIP_DURATION, objects: { grinderBody: { x: glassX - 2, y: 0, rotation: POUR_TIP_ROTATION } } },
            // Holds the tipped pose through the pause and pour-fall, so it doesn't
            // start rotating back until the seed dust has landed.
            { t: pauseEnd, objects: { grinderBody: { x: glassX - 2, y: 0, rotation: POUR_TIP_ROTATION } } },
            { t: duration, objects: { grinderBody: { x: parkX, y: 6, rotation: 0 } } },
        ],
    };
}

// How long the bottle takes to descend from its parked position to its pour
// spot above the glass (and, symmetrically, to ascend back), at
// PROP_TRAVEL_SPEED.
export function bottlePourTravelDuration(parkX: number, glassX: number): number {
    return travelDuration(parkX, PROP_PARK_Y, glassX, POUR_PROP_Y - 2);
}

// The bottle descends above the glass, pauses, rotates to pour while ethanol
// drops fall, rotates back, pauses again, then ascends back off-screen.
function buildBottlePourSequence(parkX: number, glassX: number): Sequence {
    const travelDur = bottlePourTravelDuration(parkX, glassX);
    const duration = travelDur + BOTTLE_POUR_DURATION + BOTTLE_POST_POUR_PAUSE_DURATION + travelDur;
    const arrive = travelDur;
    const preTipPauseEnd = arrive + BOTTLE_PRE_TIP_PAUSE_DURATION;
    const tippedStart = preTipPauseEnd + BOTTLE_ROTATE_DURATION;
    const tippedPauseEnd = tippedStart + BOTTLE_TIPPED_PAUSE_DURATION;
    const pourEnd = tippedPauseEnd + BOTTLE_ROTATE_DURATION;
    const postPourPauseEnd = pourEnd + BOTTLE_POST_POUR_PAUSE_DURATION;
    const pourY = POUR_PROP_Y - 2;
    return {
        duration,
        keyframes: [
            { t: 0, objects: { bottle: { x: parkX, y: PROP_PARK_Y, rotation: BOTTLE_REST_ROTATION } } },
            { t: arrive, objects: { bottle: { x: glassX, y: pourY, rotation: BOTTLE_REST_ROTATION } } },
            { t: preTipPauseEnd, objects: { bottle: { x: glassX, y: pourY, rotation: BOTTLE_REST_ROTATION } } },
            { t: tippedStart, objects: { bottle: { x: glassX, y: pourY, rotation: BOTTLE_TIP_ROTATION } } },
            { t: tippedPauseEnd, objects: { bottle: { x: glassX, y: pourY, rotation: BOTTLE_TIP_ROTATION } } },
            { t: pourEnd, objects: { bottle: { x: glassX, y: pourY, rotation: BOTTLE_REST_ROTATION } } },
            { t: postPourPauseEnd, objects: { bottle: { x: glassX, y: pourY, rotation: BOTTLE_REST_ROTATION } } },
            { t: duration, objects: { bottle: { x: parkX, y: PROP_PARK_Y, rotation: BOTTLE_REST_ROTATION } } },
        ],
    };
}

// How long a prop takes to descend from its parked position to POUR_PROP_Y
// above the glass (and, symmetrically, to ascend back), at PROP_TRAVEL_SPEED.
// Not private: used by step 5's barley grass scoop and by callers computing
// effect offsets relative to the descend phase.
export function tipPourTravelDuration(parkX: number, glassX: number): number {
    return travelDuration(parkX, PROP_PARK_Y, glassX, POUR_PROP_Y);
}

// A prop descends above the glass, pauses while pouring (its cup cell swaps
// glyphs via a CupTipEffect rather than the whole prop rotating), then
// ascends back off-screen at the same constant speed. Not private: used for
// the stick's tartaric-acid pour (step 2 and step 5) and step 5's barley
// grass scoop.
export function buildTipPourSequence(
    objectId: string,
    parkX: number,
    glassX: number,
    pourDuration: number,
): Sequence {
    const travelDur = tipPourTravelDuration(parkX, glassX);
    const duration = travelDur + pourDuration + travelDur;
    return {
        duration,
        keyframes: [
            { t: 0, objects: { [objectId]: { x: parkX, y: PROP_PARK_Y, rotation: 0 } } },
            { t: travelDur, objects: { [objectId]: { x: glassX, y: POUR_PROP_Y, rotation: 0 } } },
            { t: travelDur + pourDuration, objects: { [objectId]: { x: glassX, y: POUR_PROP_Y, rotation: 0 } } },
            { t: duration, objects: { [objectId]: { x: parkX, y: PROP_PARK_Y, rotation: 0 } } },
        ],
    };
}

// The stick descends above the glass, pauses while pouring a single tartaric
// acid drop, then ascends back off-screen. Not private: reused by step 5's
// own tartaric-acid stick ("stick2") pouring into glass2.
export function buildStickPourSequence(objectId: string, parkX: number, glassX: number): Sequence {
    return buildTipPourSequence(objectId, parkX, glassX, STICK_POUR_DURATION);
}

// Tips `objectId`'s "(_)" bowl to dump: after sitting still through a pause
// (`dumpStart`..`dumpEnd`), the bowl's "_" cell(s) (at `baseCellIndices`) move
// from dy=0 (carrying) to dy=-1 (tipped open), then move back. Not private:
// shared by the stick's tartaric-acid pour (step 2 and step 5) and step 5's
// barley grass scoop.
export class BowlTipEffect implements StepEffect {
    constructor(
        private objectId: string,
        private baseCellIndices: number[],
        private dumpStart: number,
        private dumpEnd: number,
    ) { }

    tick(t: number, anim: SceneAnimator): void {
        const obj = anim.getObject(this.objectId);
        const dy = t >= this.dumpStart && t < this.dumpEnd ? -1 : 0;
        for (const i of this.baseCellIndices) obj.sprite.cells[i].dy = dy;
    }
}

// The stick's bowl-tip during its pour pause: sits still for
// STICK_PRE_POUR_PAUSE_DURATION, then tips for STICK_DUMP_DURATION. Not
// private: reused by step 5's own tartaric-acid stick ("stick2") pouring
// into glass2.
export function buildStickBowlTipEffect(objectId: string, stickOffset: number, parkX: number, glassX: number): BowlTipEffect {
    const dumpStart = stickOffset + tipPourTravelDuration(parkX, glassX) + STICK_PRE_POUR_PAUSE_DURATION;
    return new BowlTipEffect(objectId, STICK_BOWL_BASE_CELL_INDICES, dumpStart, dumpStart + STICK_DUMP_DURATION);
}

// The stir rod descends from above the viewport into the bottom of the glass,
// played after all three pours land. The `t: 0` keyframe pins it at
// STIR_ROD_START_Y so it doesn't start drifting downward during the earlier
// pour sequences (whose keyframes don't otherwise constrain stirRod).
function buildStirRodSequence(): Sequence {
    return {
        duration: STIR_ROD_DESCEND_DURATION,
        keyframes: [
            { t: 0, objects: { stirRod: { y: STIR_ROD_START_Y } } },
            { t: STIR_ROD_DESCEND_DURATION, objects: { stirRod: { y: STIR_ROD_REST_Y } } },
        ],
    };
}

// Step 2's three ingredient pours (grinder, bottle, stick), shuffled into a
// random order once at module load and concatenated with the stir rod's
// descent. The shuffled offsets feed both STEP2_TIMELINE (the keyframes
// below) and the per-frame effects built by buildStep2Effects, so the
// pour-fall and drop-particle effects fire at the same point in the timeline
// where each sequence's grinder/bottle/stick keyframes place it.
const STEP2_GLASS_X = 7.5 + 2 * PANE_WIDTH;
// The bottle's tipped pour rotation swings its spout to the left of its
// origin, so its pour position is offset left to land the spout above the
// glass.
const BOTTLE_POUR_X_OFFSET = -7;
const STEP2_POUR_SEQUENCES: Array<{ id: "grinder" | "bottle" | "stick"; sequence: Sequence }> = [
    { id: "grinder", sequence: buildGrinderPourSequence(7.5 + PANE_WIDTH, STEP2_GLASS_X) },
    { id: "bottle", sequence: buildBottlePourSequence(INITIAL_LAYOUT.bottle.x, STEP2_GLASS_X + BOTTLE_POUR_X_OFFSET) },
    { id: "stick", sequence: buildStickPourSequence("stick", INITIAL_LAYOUT.stick.x, STEP2_GLASS_X) },
];
for (let i = STEP2_POUR_SEQUENCES.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [STEP2_POUR_SEQUENCES[i], STEP2_POUR_SEQUENCES[j]] = [STEP2_POUR_SEQUENCES[j], STEP2_POUR_SEQUENCES[i]];
}
const STEP2_POUR_OFFSETS = new Map<string, number>();
{
    let offset = 0;
    for (const { id, sequence } of STEP2_POUR_SEQUENCES) {
        STEP2_POUR_OFFSETS.set(id, offset);
        offset += sequence.duration;
    }
}
const STEP2_GRINDER_OFFSET = STEP2_POUR_OFFSETS.get("grinder")!;
const STEP2_BOTTLE_OFFSET = STEP2_POUR_OFFSETS.get("bottle")!;
const STEP2_STICK_OFFSET = STEP2_POUR_OFFSETS.get("stick")!;
const STEP2_TIMELINE = concatSequences([...STEP2_POUR_SEQUENCES.map((p) => p.sequence), buildStirRodSequence()]);

// ---------------------------------------------------------------------------
// Per-frame effects
// ---------------------------------------------------------------------------

// The ground seed dust falling from the tipped grinder into the glass, once
// it's done pausing above the glass. Wraps a `GroupArcTransfer` from
// `anim.grinderPowderGroup` (the seeds, ground to powder and transferred there
// at the end of step 1's grind) to `anim.glassGroup`, releasing/landing
// relative to `STEP2_GRINDER_OFFSET`'s position in the shuffled timeline.
class SeedPourEffect implements StepEffect {
    private transfer: GroupArcTransfer | null = null;

    tick(t: number, anim: SceneAnimator): void {
        if (!this.transfer) {
            const releaseT = STEP2_GRINDER_OFFSET + POUR_TIP_DURATION + POUR_PAUSE_DURATION;
            const seedCount = anim.grinderPowderGroup.members.length;
            this.transfer = new GroupArcTransfer(
                anim.grinderPowderGroup,
                anim.glassGroup,
                releaseT,
                POUR_FLIGHT_DURATION,
                GLASS_POWDER_POSITIONS.slice(0, seedCount),
            );
        }
        this.transfer.tick(t);
    }
}

// Drains the bottle's ethanol particles one by one (top-to-bottom) once the
// bottle has tipped, spawning a cosmetic "~" drop from the spout for each.
// Initializes an empty fluid sim at pour start; injects particles at a steady
// rate so the liquid fills and sloshes gradually.
class BottlePourEffect implements StepEffect {
    private sorted: PropGroupMember[] | null = null;
    private nextDrain = 0;
    private simInitialized: boolean;
    private lastT: number | null = null;
    private particlesAdded = 0;
    private readonly pourStart =
        STEP2_BOTTLE_OFFSET +
        bottlePourTravelDuration(INITIAL_LAYOUT.bottle.x, STEP2_GLASS_X + BOTTLE_POUR_X_OFFSET) +
        BOTTLE_PRE_TIP_PAUSE_DURATION +
        BOTTLE_ROTATE_DURATION;
    private readonly dropFlight = BOTTLE_POUR_FLIGHT_DURATION;
    private readonly pourDuration = BOTTLE_TIPPED_PAUSE_DURATION + BOTTLE_POUR_FLIGHT_DURATION;

    constructor(anim: SceneAnimator) {
        this.simInitialized = anim.liquidGroup.members.length > 0;
    }

    tick(t: number, anim: SceneAnimator): void {
        if (t < this.pourStart) return;
        if (!this.simInitialized) {
            anim.initEmptyFluidSim("glass");
            this.simInitialized = true;
        }
        const dt = this.lastT !== null ? Math.max(0, t - this.lastT) / 1000 : 0;
        this.lastT = t;
        if (dt > 0) anim.stepFluidSettling("glass", dt);
        if (!this.sorted) {
            this.sorted = [...anim.bottleLiquidGroup.members].sort((a, b) => a.relY - b.relY);
        }
        const count = this.sorted.length;
        if (count > 0 && this.nextDrain < count) {
            const elapsed = t - this.pourStart;
            const drainUpTo = Math.min(count, Math.floor((elapsed / BOTTLE_TIPPED_PAUSE_DURATION) * count) + 1);
            const bottle = anim.getObject("bottle");
            const glass = anim.getObject("glass");
            const spoutAngle = bottle.rotation;
            const spoutDx = -3 * Math.sin(spoutAngle);
            const spoutDy = -3 * Math.cos(spoutAngle);
            while (this.nextDrain < drainUpTo) {
                const member = this.sorted[this.nextDrain];
                anim.removeBottleLiquidParticle(member);
                const from: ObjectLayout = {
                    x: bottle.x + spoutDx + 0,
                    y: bottle.y + spoutDy - 1,
                    z: bottle.z - 1,
                    rotation: 0,
                };
                const to: ObjectLayout = {
                    x: glass.x + 1 + (rand() - 0.5) * 2,
                    y: glass.y + 0,
                    z: glass.z - 1,
                    rotation: 0,
                };
                anim.spawnDrop(LIQUID_PARTICLE, from, to, t, this.dropFlight);
                this.nextDrain++;
            }
        }
        const targetParticles = anim.getFluidTargetCount("glass");
        const elapsed = t - this.pourStart;
        const fraction = Math.min(1, elapsed / this.pourDuration);
        const target = Math.floor(fraction * targetParticles);
        while (this.particlesAdded < target) {
            anim.addFluidParticle("glass");
            this.particlesAdded++;
        }
    }
}

// Drops a single tartaric-acid particle from the stick's cup into `glassId`
// once `dropStart` (transition-elapsed ms) is reached. Not private: reused by
// step 5's own tartaric-acid stick ("stick2") pouring into glass2.
export class StickPourEffect implements StepEffect {
    private spawned = false;

    constructor(private dropStart: number, private glassId: string = "glass", private objectId: string = "stick") { }

    tick(t: number, anim: SceneAnimator): void {
        if (this.spawned || t < this.dropStart) return;
        const stick = anim.getObject(this.objectId);
        const glass = anim.getObject(this.glassId);
        const from: ObjectLayout = { x: stick.x, y: stick.y, z: stick.z - 1, rotation: 0 };
        const to: ObjectLayout = { x: glass.x, y: glass.y + 1, z: glass.z - 1, rotation: 0 };
        anim.spawnDrop(ACID_DROP, from, to, t, STICK_DROP_FALL_DURATION);
        this.spawned = true;
    }
}

function buildStep2Effects(anim: SceneAnimator): StepEffect[] {
    const stickTravelDuration = tipPourTravelDuration(INITIAL_LAYOUT.stick.x, STEP2_GLASS_X);
    const stickDropStart = STEP2_STICK_OFFSET + stickTravelDuration + STICK_PRE_POUR_PAUSE_DURATION + STICK_DUMP_DURATION / 2;
    return [
        new SeedPourEffect(),
        new BottlePourEffect(anim),
        new StickPourEffect(stickDropStart),
        buildStickBowlTipEffect("stick", STEP2_STICK_OFFSET, INITIAL_LAYOUT.stick.x, STEP2_GLASS_X),
    ];
}

export const STEP2: Step = {
    transitionDuration: STEP2_TIMELINE.duration,
    transitionKeyframes: STEP2_TIMELINE.keyframes,
    loops: () => [{ kind: "pulse", id: "stirRod", maxRadius: STIR_ROD_RADIUS, period: STIR_ROD_PULSE_PERIOD }],
    effects: buildStep2Effects,
    // The recipe's "stir for ten minutes" countdown appears 5s after
    // stirring starts, already showing 5s elapsed. Once it finishes, the
    // stir rod stops pulsing and the liquid settles, but both stay put.
    countdown: {
        totalSeconds: 10 * 60,
        startDelay: 5000,
        preElapsed: 5,
        onComplete: (anim) => {
            anim.stopStirring("stirRod");
        },
    },
};
