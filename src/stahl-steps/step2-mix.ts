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

import { rand } from "../rng";
import {
    ACID_DROP,
    BOTTLE_INTERIOR_POINTS,
    BOTTLE_REST_ROTATION,
    GLASS_POINTS,
    GLASS_PIVOT,
    GLASS_POWDER_POSITIONS,
    GRINDER_INTERIOR_POINTS,
    INITIAL_LAYOUT,
    LIQUID_PARTICLE,
    PANE_WIDTH,
    POUR_PROP_Y,
    POWDER_PARTICLE,
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
import { concatSequences, DynamicTimeline, type Sequence, type Step, type StepEffect, type SubstepRange, type TimelineSegment, type WaitCondition } from "../stahl-timeline";
import { type SceneAnimator } from "../stahl-animator";
import { PourTransfer } from "../pour-transfer";

// How long the ground seed dust takes to fall from the tipped grinder into
// the glass during step 2's pour.
export const POUR_FLIGHT_DURATION = 1000;

// How far (radians) the grinder rotates clockwise while pouring, and how
// long the lift/rotate and rotate-back/descend phases each take.
export const POUR_TIP_ROTATION = TAU * (135 / 360);
export const POUR_TIP_DURATION = 750;
export const POUR_RETURN_DURATION = 1000;

// How long the grinder pauses, tipped over the glass, before the seed
// fragments fall.
export const POUR_PAUSE_DURATION = 2400;

// Phase durations for the bottle's (ethanol) and stick's (tartaric acid)
// pour sequences: descend above the glass, pause while pouring drops, then
// ascend (bottle) or right itself and ascend (stick) back off-screen. The
// bottle's descend/ascend durations are computed from travel distance (see
// bottlePourTravelDuration).
export const BOTTLE_PRE_TIP_PAUSE_DURATION = 400;
export const BOTTLE_ROTATE_DURATION = 800;
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

// Step 2 uses a longer pause before dumping and a shorter dump.
const STEP2_STICK_PRE_POUR_PAUSE = 2200;
const STEP2_STICK_DUMP = 800;
const STEP2_STICK_POUR = STEP2_STICK_PRE_POUR_PAUSE + STEP2_STICK_DUMP;
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
            { t: POUR_TIP_DURATION, objects: { grinderBody: { x: glassX, y: 0, rotation: POUR_TIP_ROTATION } } },
            { t: pauseEnd, objects: { grinderBody: { x: glassX, y: 0, rotation: POUR_TIP_ROTATION } } },
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

// The bottle descends above the glass, pauses, rotates to pour, waits for
// enough ethanol to exit, rotates back, pauses, then ascends off-screen.
// Returns sub-sequences with a WaitCondition between tip and return.
let bottlePourWait: WaitCondition | null = null;
export function getBottlePourWait(): WaitCondition | null { return bottlePourWait; }

function buildBottlePourSegments(parkX: number, glassX: number): TimelineSegment[] {
    const travelDur = bottlePourTravelDuration(parkX, glassX);
    const pourY = POUR_PROP_Y - 2;

    const approachDur = travelDur + BOTTLE_PRE_TIP_PAUSE_DURATION + BOTTLE_ROTATE_DURATION;
    const approach: Sequence = {
        duration: approachDur,
        keyframes: [
            { t: 0, objects: { bottle: { x: parkX, y: PROP_PARK_Y, rotation: BOTTLE_REST_ROTATION } } },
            { t: travelDur, objects: { bottle: { x: glassX, y: pourY, rotation: BOTTLE_REST_ROTATION } } },
            { t: travelDur + BOTTLE_PRE_TIP_PAUSE_DURATION, objects: { bottle: { x: glassX, y: pourY, rotation: BOTTLE_REST_ROTATION } } },
            { t: approachDur, objects: { bottle: { x: glassX, y: pourY, rotation: BOTTLE_TIP_ROTATION } } },
        ],
    };

    const wait: WaitCondition = { kind: "wait", predicate: () => false };
    bottlePourWait = wait;

    const returnDur = BOTTLE_ROTATE_DURATION + BOTTLE_POST_POUR_PAUSE_DURATION + travelDur;
    const returnSeq: Sequence = {
        duration: returnDur,
        keyframes: [
            { t: 0, objects: { bottle: { x: glassX, y: pourY, rotation: BOTTLE_TIP_ROTATION } } },
            { t: BOTTLE_ROTATE_DURATION, objects: { bottle: { x: glassX, y: pourY, rotation: BOTTLE_REST_ROTATION } } },
            { t: BOTTLE_ROTATE_DURATION + BOTTLE_POST_POUR_PAUSE_DURATION, objects: { bottle: { x: glassX, y: pourY, rotation: BOTTLE_REST_ROTATION } } },
            { t: returnDur, objects: { bottle: { x: parkX, y: PROP_PARK_Y, rotation: BOTTLE_REST_ROTATION } } },
        ],
    };

    return [approach, wait, returnSeq];
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
const STEP2_POUR_ENTRIES: Array<{ id: "grinder" | "bottle" | "stick"; segments: TimelineSegment[] }> = [
    { id: "grinder", segments: [buildGrinderPourSequence(7.5 + PANE_WIDTH, STEP2_GLASS_X)] },
    { id: "bottle", segments: buildBottlePourSegments(INITIAL_LAYOUT.bottle.x, STEP2_GLASS_X + BOTTLE_POUR_X_OFFSET) },
    { id: "stick", segments: [buildTipPourSequence("stick", INITIAL_LAYOUT.stick.x, STEP2_GLASS_X, STEP2_STICK_POUR)] },
];
for (let i = STEP2_POUR_ENTRIES.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [STEP2_POUR_ENTRIES[i], STEP2_POUR_ENTRIES[j]] = [STEP2_POUR_ENTRIES[j], STEP2_POUR_ENTRIES[i]];
}
function segmentMinDuration(segs: TimelineSegment[]): number {
    let dur = 0;
    for (const s of segs) if (!("kind" in s)) dur += s.duration;
    return dur;
}
const STEP2_POUR_OFFSETS = new Map<string, number>();
{
    let offset = 0;
    for (const { id, segments } of STEP2_POUR_ENTRIES) {
        STEP2_POUR_OFFSETS.set(id, offset);
        offset += segmentMinDuration(segments);
    }
}
const STEP2_GRINDER_OFFSET = STEP2_POUR_OFFSETS.get("grinder")!;
const STEP2_BOTTLE_OFFSET = STEP2_POUR_OFFSETS.get("bottle")!;
const STEP2_STICK_OFFSET = STEP2_POUR_OFFSETS.get("stick")!;
const STEP2_POUR_DURATIONS = new Map<string, number>();
for (const { id, segments } of STEP2_POUR_ENTRIES) {
    STEP2_POUR_DURATIONS.set(id, segmentMinDuration(segments));
}
const STEP2_ALL_SEGMENTS: TimelineSegment[] = [
    ...STEP2_POUR_ENTRIES.flatMap(p => p.segments),
    buildStirRodSequence(),
];
const STEP2_TIMELINE = new DynamicTimeline(STEP2_ALL_SEGMENTS);

const SUBSTEP_IDS: Record<string, string> = { grinder: "seed-powder", bottle: "ethanol", stick: "tartaric-acid" };
const STEP2_SUBSTEPS: SubstepRange[] = STEP2_POUR_ENTRIES.map(({ id }) => ({
    id: SUBSTEP_IDS[id],
    start: STEP2_POUR_OFFSETS.get(id)!,
    end: STEP2_POUR_OFFSETS.get(id)! + STEP2_POUR_DURATIONS.get(id)!,
}));

// ---------------------------------------------------------------------------
// Per-frame effects
// ---------------------------------------------------------------------------

function buildSeedPourTransfer(): PourTransfer {
    let nextDestAdd = 0;
    return new PourTransfer({
        label: "seed→glass",
        initT: STEP2_GRINDER_OFFSET,
        simConfig: {
            sourcePoints: GRINDER_INTERIOR_POINTS,
            sourceClosed: false,
            targetPoints: GLASS_POINTS,
            targetClosed: false,
            targetPivot: GLASS_PIVOT,
        },
        visualIdPrefix: "pour-seed",
        visualZ: INITIAL_LAYOUT.grinderBody.z + 1,
        getSourceMembers: (anim) => [...anim.grinderPowderGroup.members],
        getSourceState: (anim) => { const g = anim.getObject("grinderBody"); return { x: g.x, y: g.y, rotation: g.rotation }; },
        getTargetState: (anim) => { const g = anim.getObject("glass"); return { x: g.x, y: g.y, rotation: g.rotation }; },
        destTotal: (n) => Math.min(n, GLASS_POWDER_POSITIONS.length),
        onDrain: (count, members, nextIdx, anim) => {
            for (let j = 0; j < count && nextIdx < members.length; j++) {
                const member = members[nextIdx++];
                anim.grinderPowderGroup.release(member);
                member.obj.visible = false;
            }
            return nextIdx;
        },
        onFill: (count, anim) => {
            for (let j = 0; j < count && nextDestAdd < GLASS_POWDER_POSITIONS.length; j++) {
                const [relX, relY] = GLASS_POWDER_POSITIONS[nextDestAdd++];
                anim.glassGroup.addMember({ sprite: POWDER_PARTICLE, relX, relY, relZ: 0 });
            }
        },
    });
}

const BOTTLE_MIN_EXITED = 4;

function buildBottlePourTransfer(anim: SceneAnimator): PourTransfer {
    let simInitialized = anim.liquidGroup.members.length > 0;
    const wait = getBottlePourWait();
    return new PourTransfer({
        label: "bottle→glass",
        initT: STEP2_BOTTLE_OFFSET +
            bottlePourTravelDuration(INITIAL_LAYOUT.bottle.x, STEP2_GLASS_X + BOTTLE_POUR_X_OFFSET) +
            BOTTLE_PRE_TIP_PAUSE_DURATION,
        minExited: BOTTLE_MIN_EXITED,
        onMinExited: () => {
            if (wait) wait.predicate = () => true;
        },
        doneWhen: () => {
            const b = anim.getObject("bottle");
            return Math.abs(b.rotation - BOTTLE_REST_ROTATION) < 0.01;
        },
        simConfig: {
            sourcePoints: BOTTLE_INTERIOR_POINTS,
            sourceClosed: false,
            targetPoints: GLASS_POINTS,
            targetClosed: false,
            targetPivot: GLASS_PIVOT,
        },
        simParticleCount: BOTTLE_MIN_EXITED,
        visualIdPrefix: "pour-ethanol",
        visualZ: INITIAL_LAYOUT.bottle.z - 1,
        visualSprite: LIQUID_PARTICLE,
        sourceTotal: BOTTLE_MIN_EXITED,
        sortMembers: (a, b) => a.relY - b.relY,
        getSourceMembers: (anim) => [...anim.bottleLiquidGroup.members],
        getSourceState: (anim) => { const b = anim.getObject("bottle"); return { x: b.x, y: b.y, rotation: b.rotation }; },
        getTargetState: (anim) => { const g = anim.getObject("glass"); return { x: g.x, y: g.y, rotation: g.rotation }; },
        destTotal: (_n, anim) => anim.getFluidTargetCount("glass"),
        onPreInit: (anim) => {
            if (!simInitialized) {
                anim.initEmptyFluidSim("glass");
                simInitialized = true;
            }
        },
        onDrain: (count, members, nextIdx, anim) => {
            for (let j = 0; j < count && nextIdx < members.length; j++) {
                anim.removeBottleLiquidParticle(members[nextIdx++]);
            }
            return nextIdx;
        },
        onFill: (count, anim) => {
            for (let j = 0; j < count; j++) anim.addFluidParticle("glass");
        },
    });
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

class GlassSettleEffect implements StepEffect {
    private lastT: number | null = null;

    tick(t: number, anim: SceneAnimator): void {
        if (!anim.hasFluidSim("glass")) return;
        const dt = this.lastT !== null ? Math.max(0, t - this.lastT) / 1000 : 0;
        this.lastT = t;
        if (dt > 0) anim.stepFluidSettling("glass", dt);
    }
}

function buildStep2Effects(anim: SceneAnimator): StepEffect[] {
    const stickTravelDuration = tipPourTravelDuration(INITIAL_LAYOUT.stick.x, STEP2_GLASS_X);
    const stickDumpStart = STEP2_STICK_OFFSET + stickTravelDuration + STEP2_STICK_PRE_POUR_PAUSE;
    const stickDropStart = stickDumpStart + STEP2_STICK_DUMP / 2;
    return [
        buildSeedPourTransfer(),
        buildBottlePourTransfer(anim),
        new StickPourEffect(stickDropStart),
        new BowlTipEffect("stick", STICK_BOWL_BASE_CELL_INDICES, stickDumpStart, stickDumpStart + STEP2_STICK_DUMP),
        new GlassSettleEffect(),
    ];
}

export const STEP2: Step = {
    transitionDuration: STEP2_TIMELINE.minDuration,
    timeline: STEP2_TIMELINE,
    substeps: STEP2_SUBSTEPS,
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
