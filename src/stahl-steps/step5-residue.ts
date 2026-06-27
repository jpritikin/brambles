// Step 5 — Final prep. The dish's dried residue is scraped into glass2 along
// with a fresh dose of tartaric acid, a scoop of barley grass powder, and tap
// water; once all four land, the second stir rod descends into glass2 and
// starts pulsing continuously.
//
// The four additions (scraped residue, tartaric acid, barley grass powder,
// tap water) are each a self-contained Sequence, shuffled into a random order
// once at module load and concatenated with stirRod2's descent (see
// `concatSequences`), the same pattern as step 2's pours.

import { arcLerp, GroupArcTransfer } from "../ascii-sprites";
import { rand } from "../rng";
import { type PropGroupMember } from "../ascii-compositor";
import {
    BARLEY_BOWL_BASE_CELL_INDICES,
    BARLEY_POWDER_DROP,
    BARLEY_POWDER_POSITIONS,
    DISH_LIQUID_POSITIONS,
    DISH_RESIDUE_PARTICLE,
    GLASS2_POWDER_POSITIONS,
    INITIAL_LAYOUT,
    PANE_WIDTH,
    PROP_PARK_Y,
    RESIDUE_CLUMP_PARTICLE,
    STIR_ROD_DESCEND_DURATION,
    STIR_ROD_PULSE_PERIOD,
    STIR_ROD_RADIUS,
    STIR_ROD_REST_Y,
    STIR_ROD_START_Y,
    LIQUID_PARTICLE,
    travelDuration,
    type ObjectLayout,
} from "../stahl-props";
import {
    buildStickPourSequence,
    buildTipPourSequence,
    tipPourTravelDuration,
    BowlTipEffect,
    StickPourEffect,
    buildStickBowlTipEffect,
    STICK_DUMP_DURATION,
    STICK_PRE_POUR_PAUSE_DURATION,
} from "./step2-mix";
import { concatSequences, type Sequence, type Step, type StepEffect, type SubstepRange } from "../stahl-timeline";
import { type SceneAnimator } from "../stahl-animator";

const STEP5_GLASS2_X = 7.5 + 5 * PANE_WIDTH;
const STEP5_DISH_X = INITIAL_LAYOUT.dish.x;

// Phase durations for the barley grass scoop's pour sequence: descend above
// glass2 (duration from travel distance, see tipPourTravelDuration), sit for
// BARLEY_SCOOP_PRE_POUR_PAUSE_DURATION, dump its load over
// BARLEY_SCOOP_DUMP_DURATION, then ascend back off-screen, mirroring the
// stick's tartaric-acid pour.
export const BARLEY_SCOOP_PRE_POUR_PAUSE_DURATION = 1400;
export const BARLEY_SCOOP_DUMP_DURATION = 1400;
export const BARLEY_SCOOP_POUR_DURATION = BARLEY_SCOOP_PRE_POUR_PAUSE_DURATION + BARLEY_SCOOP_DUMP_DURATION;

// How long the dumped barley grass powder takes to fall into glass2, and the
// spacing between each of its particles.
export const BARLEY_POWDER_DROP_SPACING = 150;
export const BARLEY_POWDER_FALL_DURATION = 500;

// How long the scraper takes to sweep across the dish (during which the
// dish's residue particles disappear one at a time, left to right) and, once
// positioned above glass2, to pause while the gathered "@" clump arcs down
// into it. Descend/travel/ascend durations are computed from travel distance
// (see SCRAPER_TRAVEL_DURATION / SCRAPER_TO_GLASS2_DURATION).
export const SCRAPER_SWEEP_DURATION = 1200;
export const SCRAPER_TRANSFER_DURATION = 800;

// World y the scraper descends to, level with the dish's residue, and the
// world x of the sweep's start/end points: the leftmost/rightmost residue
// positions in DISH_LIQUID_POSITIONS (one column inside the dish's outer
// walls, where the residue actually sits).
export const SCRAPER_REST_Y = 6;
const DISH_RESIDUE_MIN_X = Math.min(...DISH_LIQUID_POSITIONS.map(([relX]) => relX));
const DISH_RESIDUE_MAX_X = Math.max(...DISH_LIQUID_POSITIONS.map(([relX]) => relX));
const SCRAPER_SWEEP_START_X = STEP5_DISH_X + DISH_RESIDUE_MIN_X;
// Stops 1 column short of the rightmost residue position; any residue left
// there is swept up in ResidueScrapeEffect's end-of-sweep cleanup.
const SCRAPER_SWEEP_END_X = STEP5_DISH_X + DISH_RESIDUE_MAX_X - 1;

// World x/y the scraper holds at, above glass2, while the gathered clump
// falls.
const SCRAPER_GLASS2_X = STEP5_GLASS2_X;
const SCRAPER_GLASS2_Y = SCRAPER_REST_Y - 4;

// After sweeping across the dish, the scraper arcs up and to the left of the
// dish's right edge, then curves back to the right and down toward
// SCRAPER_GLASS2_X/Y above glass2 (see ScraperArcEffect) — a two-hop
// parabolic path (via arcLerp) through this peak point, rather than a
// straight line. Pushed further left/up than a direct path would need, so the
// arc clears the fan (INITIAL_LAYOUT.fan) rather than cutting through it.
const SCRAPER_ARC_PEAK_X = SCRAPER_SWEEP_END_X - 5;
const SCRAPER_ARC_PEAK_Y = SCRAPER_REST_Y - 5;
const SCRAPER_ARC_RISE_HEIGHT = 1.5;
const SCRAPER_ARC_DESCENT_HEIGHT = 1.5;

// Pause at the arc's peak between the rise (rightward sweep -> leftward rise)
// and the descent (back rightward toward glass2), so the direction reversal
// reads as a deliberate beat rather than a jerky snap.
const SCRAPER_ARC_PAUSE_DURATION = 500;

// How long the scraper takes to descend from its parked position to the
// dish's left edge, to travel (via ScraperArcEffect's two-hop arc) from the
// dish's right edge to above glass2, and (symmetrically, from above glass2)
// to ascend back to its parked position, at PROP_TRAVEL_SPEED.
const SCRAPER_TRAVEL_DURATION = travelDuration(INITIAL_LAYOUT.scraper.x, PROP_PARK_Y, SCRAPER_SWEEP_START_X, SCRAPER_REST_Y);
const SCRAPER_TO_GLASS2_DURATION =
    travelDuration(SCRAPER_SWEEP_END_X, SCRAPER_REST_Y, SCRAPER_ARC_PEAK_X, SCRAPER_ARC_PEAK_Y) +
    SCRAPER_ARC_PAUSE_DURATION +
    travelDuration(SCRAPER_ARC_PEAK_X, SCRAPER_ARC_PEAK_Y, SCRAPER_GLASS2_X, SCRAPER_GLASS2_Y);
const SCRAPER_RETURN_DURATION = travelDuration(SCRAPER_GLASS2_X, SCRAPER_GLASS2_Y, INITIAL_LAYOUT.scraper.x, PROP_PARK_Y);

// How long the tap water takes to fall into glass2 and fill it, once its
// phase begins.
export const TAP_WATER_DROP_COUNT = 12;
export const TAP_WATER_DROP_SPACING = 200;
export const TAP_WATER_FALL_DURATION = 400;
export const TAP_WATER_PHASE_DURATION = (TAP_WATER_DROP_COUNT - 1) * TAP_WATER_DROP_SPACING + TAP_WATER_FALL_DURATION + 500;

// ---------------------------------------------------------------------------
// Phase sequences
// ---------------------------------------------------------------------------
// `parkX` is the prop's own resting x (off-screen above the viewport).

// The scraper's descend/sweep/travel/drop/ascend motion, expressed as a
// Sequence relative to its own start:
//   1. descends from its parked position to the dish's left edge
//   2. sweeps across the full width of the dish's floor, during which
//      ResidueScrapeEffect removes the dish's residue particles one at a
//      time as the scraper passes over them
//   3. travels from the dish's right edge to above glass2
//   4. holds there while ResidueScrapeEffect arcs the gathered "@" clump
//      down into glass2
//   5. ascends back to its parked position
function buildScraperSequence(): Sequence {
    const sweepEnd = SCRAPER_TRAVEL_DURATION + SCRAPER_SWEEP_DURATION;
    const glass2End = sweepEnd + SCRAPER_TO_GLASS2_DURATION;
    const dropEnd = glass2End + SCRAPER_TRANSFER_DURATION;
    const duration = dropEnd + SCRAPER_RETURN_DURATION;
    const parkX = INITIAL_LAYOUT.scraper.x;
    return {
        duration,
        keyframes: [
            { t: 0, objects: { scraper: { x: parkX, y: PROP_PARK_Y, rotation: 0 } } },
            { t: SCRAPER_TRAVEL_DURATION, objects: { scraper: { x: SCRAPER_SWEEP_START_X, y: SCRAPER_REST_Y, rotation: 0 } } },
            { t: sweepEnd, objects: { scraper: { x: SCRAPER_SWEEP_END_X, y: SCRAPER_REST_Y, rotation: 0 } } },
            // ScraperArcEffect takes over x/y for the two-hop parabolic arc
            // up-and-left then over-and-down to above glass2; this keyframe
            // just holds the scraper's final position so it doesn't snap
            // once the effect stops driving it.
            { t: glass2End, objects: { scraper: { x: SCRAPER_GLASS2_X, y: SCRAPER_GLASS2_Y, rotation: 0 } } },
            // Holds above glass2 while the clump falls, so the scraper
            // doesn't start ascending until it's landed.
            { t: dropEnd, objects: { scraper: { x: SCRAPER_GLASS2_X, y: SCRAPER_GLASS2_Y, rotation: 0 } } },
            { t: duration, objects: { scraper: { x: parkX, y: PROP_PARK_Y, rotation: 0 } } },
        ],
    };
}

// The tap water has no prop of its own; this just reserves a span in the
// concatenated timeline for TapWaterEffect to fire within.
function buildTapWaterSequence(): Sequence {
    return { duration: TAP_WATER_PHASE_DURATION, keyframes: [] };
}

// The barley grass scoop's descend/dump/ascend motion, mirroring the stick's
// tartaric-acid pour but into glass2.
function buildBarleyScoopSequence(): Sequence {
    return buildTipPourSequence(
        "barleyScoop",
        INITIAL_LAYOUT.barleyScoop.x,
        STEP5_GLASS2_X,
        BARLEY_SCOOP_POUR_DURATION,
    );
}

// stirRod2 descends from above the viewport into the bottom of glass2, played
// after all three additions land. The `t: 0` keyframe pins it at
// STIR_ROD_START_Y so it doesn't start drifting downward during the earlier
// phases (whose keyframes don't otherwise constrain stirRod2).
function buildStirRod2Sequence(): Sequence {
    return {
        duration: STIR_ROD_DESCEND_DURATION,
        keyframes: [
            { t: 0, objects: { stirRod2: { y: STIR_ROD_START_Y } } },
            { t: STIR_ROD_DESCEND_DURATION, objects: { stirRod2: { y: STIR_ROD_REST_Y } } },
        ],
    };
}

// Step 5's four additions (scraped residue, tartaric acid, barley grass
// powder, tap water), shuffled into a random order once at module load and
// concatenated with stirRod2's descent. The shuffled offsets feed both
// STEP5_TIMELINE (the keyframes below) and the per-frame effects built by
// buildStep5Effects, so each addition's effect fires at the same point in the
// timeline where its sequence's keyframes (if any) place it.
const STEP5_PHASES: Array<{ id: "scraper" | "stick" | "barley" | "water"; sequence: Sequence }> = [
    { id: "scraper", sequence: buildScraperSequence() },
    { id: "stick", sequence: buildStickPourSequence("stick2", INITIAL_LAYOUT.stick2.x, STEP5_GLASS2_X) },
    { id: "barley", sequence: buildBarleyScoopSequence() },
    { id: "water", sequence: buildTapWaterSequence() },
];
for (let i = STEP5_PHASES.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [STEP5_PHASES[i], STEP5_PHASES[j]] = [STEP5_PHASES[j], STEP5_PHASES[i]];
}
const STEP5_PHASE_OFFSETS = new Map<string, number>();
{
    let offset = 0;
    for (const { id, sequence } of STEP5_PHASES) {
        STEP5_PHASE_OFFSETS.set(id, offset);
        offset += sequence.duration;
    }
}
const STEP5_SCRAPER_OFFSET = STEP5_PHASE_OFFSETS.get("scraper")!;
const STEP5_STICK_OFFSET = STEP5_PHASE_OFFSETS.get("stick")!;
const STEP5_BARLEY_OFFSET = STEP5_PHASE_OFFSETS.get("barley")!;
const STEP5_WATER_OFFSET = STEP5_PHASE_OFFSETS.get("water")!;
const STEP5_TIMELINE = concatSequences([...STEP5_PHASES.map((p) => p.sequence), buildStirRod2Sequence()]);

const SUBSTEP5_IDS: Record<string, string> = { scraper: "residue", stick: "tartaric-acid", barley: "barley-grass", water: "water" };
const STEP5_SUBSTEPS: SubstepRange[] = STEP5_PHASES.map(({ id, sequence }) => ({
    id: SUBSTEP5_IDS[id],
    start: STEP5_PHASE_OFFSETS.get(id)!,
    end: STEP5_PHASE_OFFSETS.get(id)! + sequence.duration,
}));

// ---------------------------------------------------------------------------
// Per-frame effects
// ---------------------------------------------------------------------------

// The barley scoop's bowl-tip during its pour pause: sits still for
// BARLEY_SCOOP_PRE_POUR_PAUSE_DURATION, then tips for
// BARLEY_SCOOP_DUMP_DURATION.
function buildBarleyBowlTipEffect(barleyOffset: number, barleyTravelDuration: number): BowlTipEffect {
    const dumpStart = barleyOffset + barleyTravelDuration + BARLEY_SCOOP_PRE_POUR_PAUSE_DURATION;
    return new BowlTipEffect("barleyScoop", BARLEY_BOWL_BASE_CELL_INDICES, dumpStart, dumpStart + BARLEY_SCOOP_DUMP_DURATION);
}

// Offset (relative to the scraper's origin) of its tip, the end nearer
// glass2 — where the gathered "@" clump rides once it's picked up (see
// ResidueScrapeEffect).
const SCRAPER_TIP_OFFSET: [number, number] = [1, 1];

// The dish's scattered "." residue particles vanishing one at a time, left to
// right, as the scraper sweeps across the dish floor
// (STEP5_SCRAPER_OFFSET + SCRAPER_TRAVEL_DURATION ..
// + SCRAPER_SWEEP_DURATION). Once the sweep finishes, the gathered residue
// becomes a single "@" clump added to `anim.scraperGroup` at
// SCRAPER_TIP_OFFSET, riding rigidly on the scraper's tip as it arcs to above
// glass2, then arcs from `anim.scraperGroup` into `anim.glass2Group` once the
// scraper pauses there (+ SCRAPER_TO_GLASS2_DURATION). Before any of this, clears
// `dishLiquidGroup` and seeds `dishResidueGroup` with a full dish of residue
// if it's still empty — by the time step 5 plays, step 4's evaporation effect
// won't have run (its loop only starts after step 4's transition completes),
// so the dish would otherwise still show liquid instead of residue.
class ResidueScrapeEffect implements StepEffect {
    private sortedMembers: PropGroupMember[] | null = null;
    private nextToRemove = 0;
    private clump: PropGroupMember | null = null;
    private transfer: GroupArcTransfer | null = null;

    private readonly sweepStart = STEP5_SCRAPER_OFFSET + SCRAPER_TRAVEL_DURATION;
    private readonly sweepEnd = this.sweepStart + SCRAPER_SWEEP_DURATION;
    private readonly dropStart = this.sweepEnd + SCRAPER_TO_GLASS2_DURATION;

    tick(t: number, anim: SceneAnimator): void {
        if (!this.sortedMembers) {
            if (anim.dishResidueGroup.members.length === 0) {
                // Reaching step 5 directly skips step 4's real-time
                // evaporation loop, so the dish's liquid hasn't turned into
                // residue yet. Clear it and seed a full dish of residue, as
                // if the fan had already finished evaporating it.
                anim.emptyDishLiquid();
                for (const [relX, relY] of DISH_LIQUID_POSITIONS) {
                    anim.dishResidueGroup.addMember({ sprite: DISH_RESIDUE_PARTICLE, relX, relY, relZ: 0 });
                }
            }
            this.sortedMembers = [...anim.dishResidueGroup.members].sort((a, b) => a.relX - b.relX);
        }

        if (t < this.sweepStart) return;

        if (!this.clump) {
            // The scraper sweeps linearly from the dish's left edge to its
            // right edge; remove each residue particle, left to right, once
            // the scraper's current x reaches its position in the dish.
            const span = Math.min(1, Math.max(0, (t - this.sweepStart) / SCRAPER_SWEEP_DURATION));
            const scraperX = SCRAPER_SWEEP_START_X + span * (SCRAPER_SWEEP_END_X - SCRAPER_SWEEP_START_X);
            while (this.nextToRemove < this.sortedMembers.length) {
                const member = this.sortedMembers[this.nextToRemove];
                if (anim.dishResidueGroup.x + member.relX > scraperX) break;
                anim.removeDishResidueParticle(member);
                this.nextToRemove++;
            }

            if (t >= this.sweepEnd) {
                // Sweep over: remove anything left behind and gather the
                // residue into a single "@" clump riding on the scraper's
                // tip, as a member of `scraperGroup` so it tracks the
                // scraper's position/rotation as one rigid unit.
                while (this.nextToRemove < this.sortedMembers.length) {
                    anim.removeDishResidueParticle(this.sortedMembers[this.nextToRemove]);
                    this.nextToRemove++;
                }
                this.clump = anim.scraperGroup.addMember({
                    sprite: RESIDUE_CLUMP_PARTICLE,
                    relX: SCRAPER_TIP_OFFSET[0],
                    relY: SCRAPER_TIP_OFFSET[1],
                    // +1 over the scraper's own z so the "@" renders in front
                    // of it rather than being hidden by a same-z tie.
                    relZ: 1,
                });
            }
        }

        if (this.clump && !this.transfer && t >= this.dropStart) {
            this.transfer = new GroupArcTransfer(
                anim.scraperGroup,
                anim.glass2Group,
                this.dropStart,
                SCRAPER_TRANSFER_DURATION,
                [GLASS2_POWDER_POSITIONS[0]],
            );
        }
        this.transfer?.tick(t);
    }
}

// Once the scraper finishes sweeping the dish (STEP5_SCRAPER_OFFSET +
// SCRAPER_TRAVEL_DURATION + SCRAPER_SWEEP_DURATION), carries it from the
// dish's right edge to above glass2 along a two-hop parabolic path: first up
// and to the left to SCRAPER_ARC_PEAK_X/Y, then curving back to the right and
// down to SCRAPER_GLASS2_X/Y, landing with its tip over the glass.
class ScraperArcEffect implements StepEffect {
    private landed = false;
    private readonly arcStart = STEP5_SCRAPER_OFFSET + SCRAPER_TRAVEL_DURATION + SCRAPER_SWEEP_DURATION;
    private readonly riseDuration = travelDuration(SCRAPER_SWEEP_END_X, SCRAPER_REST_Y, SCRAPER_ARC_PEAK_X, SCRAPER_ARC_PEAK_Y);
    private readonly from: ObjectLayout = { x: SCRAPER_SWEEP_END_X, y: SCRAPER_REST_Y, z: INITIAL_LAYOUT.scraper.z, rotation: 0 };
    private readonly peak: ObjectLayout = { x: SCRAPER_ARC_PEAK_X, y: SCRAPER_ARC_PEAK_Y, z: INITIAL_LAYOUT.scraper.z, rotation: 0 };
    private readonly to: ObjectLayout = { x: SCRAPER_GLASS2_X, y: SCRAPER_GLASS2_Y, z: INITIAL_LAYOUT.scraper.z, rotation: 0 };

    tick(t: number, anim: SceneAnimator): void {
        if (this.landed) return;
        if (t < this.arcStart) return;
        const elapsed = t - this.arcStart;
        const scraper = anim.getObject("scraper");
        const descentStart = this.riseDuration + SCRAPER_ARC_PAUSE_DURATION;
        if (elapsed < this.riseDuration) {
            const span = Math.min(1, elapsed / this.riseDuration);
            Object.assign(scraper, arcLerp(this.from, this.peak, span, SCRAPER_ARC_RISE_HEIGHT));
        } else if (elapsed < descentStart) {
            // Hold at the peak for SCRAPER_ARC_PAUSE_DURATION before reversing
            // direction toward glass2.
            Object.assign(scraper, this.peak);
        } else {
            const descentDuration = SCRAPER_TO_GLASS2_DURATION - descentStart;
            const span = descentDuration > 0 ? Math.min(1, (elapsed - descentStart) / descentDuration) : 1;
            Object.assign(scraper, arcLerp(this.peak, this.to, span, SCRAPER_ARC_DESCENT_HEIGHT));
            if (span >= 1) this.landed = true;
        }
    }
}

// Drops a few tap water particles from above glass2 once its phase begins
// Fills glass2 with a stream of tap water drops falling in a single column.
// Initializes an empty fluid sim at pour start; injects particles at a steady
// rate so the liquid fills and sloshes gradually. Cosmetic drops are visual only.
class TapWaterEffect implements StepEffect {
    private nextDrop = 0;
    private simInitialized = false;
    private lastT: number | null = null;
    private particlesAdded = 0;
    private readonly dropStart = STEP5_WATER_OFFSET;
    private readonly pourDuration = (TAP_WATER_DROP_COUNT - 1) * TAP_WATER_DROP_SPACING + TAP_WATER_FALL_DURATION;

    constructor(anim: SceneAnimator) {
        this.simInitialized = anim.liquid2Group.members.length > 0;
    }

    tick(t: number, anim: SceneAnimator): void {
        if (t < this.dropStart) return;
        if (!this.simInitialized) {
            anim.initEmptyFluidSim("glass2");
            this.simInitialized = true;
        }
        const dt = this.lastT !== null ? Math.max(0, t - this.lastT) / 1000 : 0;
        this.lastT = t;
        if (dt > 0) anim.stepFluidSettling("glass2", dt);
        if (this.nextDrop < TAP_WATER_DROP_COUNT) {
            const glass2 = anim.getObject("glass2");
            while (this.nextDrop < TAP_WATER_DROP_COUNT) {
                const dropT = this.dropStart + this.nextDrop * TAP_WATER_DROP_SPACING;
                if (dropT > t) break;
                const from: ObjectLayout = { x: glass2.x, y: PROP_PARK_Y, z: glass2.z - 1, rotation: 0 };
                const to: ObjectLayout = { x: glass2.x, y: glass2.y + 1, z: glass2.z - 1, rotation: 0 };
                anim.spawnDrop(LIQUID_PARTICLE, from, to, dropT, TAP_WATER_FALL_DURATION);
                this.nextDrop++;
            }
        }
        const targetParticles = anim.getFluidTargetCount("glass2");
        const elapsed = t - this.dropStart;
        const fraction = Math.min(1, elapsed / this.pourDuration);
        const target = Math.floor(fraction * targetParticles);
        while (this.particlesAdded < target) {
            anim.addFluidParticle("glass2");
            this.particlesAdded++;
        }
    }
}

// Dumps the barley grass scoop's load into glass2 once its pour phase begins
// (STEP5_BARLEY_OFFSET + descend + half of pour), as a few "," particles
// falling from the scoop's cup, landing as new `glass2Group` members at
// BARLEY_POWDER_POSITIONS once the last one lands.
class BarleyScoopEffect implements StepEffect {
    private spawned = false;
    private landed: boolean;
    private readonly dropStart =
        STEP5_BARLEY_OFFSET +
        tipPourTravelDuration(INITIAL_LAYOUT.barleyScoop.x, STEP5_GLASS2_X) +
        BARLEY_SCOOP_PRE_POUR_PAUSE_DURATION +
        BARLEY_SCOOP_DUMP_DURATION / 2;
    private readonly landT =
        this.dropStart + ((BARLEY_POWDER_POSITIONS.length - 1) * BARLEY_POWDER_DROP_SPACING) + BARLEY_POWDER_FALL_DURATION;

    constructor(anim: SceneAnimator) {
        this.landed = anim.glass2Group.members.some((m) => m.obj.sprite.cells[0]?.role === BARLEY_POWDER_DROP.cells[0].role);
    }

    tick(t: number, anim: SceneAnimator): void {
        if (!this.spawned && t >= this.dropStart) {
            const scoop = anim.getObject("barleyScoop");
            const glass2 = anim.getObject("glass2");
            for (const [i, [relX]] of BARLEY_POWDER_POSITIONS.entries()) {
                const from: ObjectLayout = { x: scoop.x, y: scoop.y, z: scoop.z - 1, rotation: 0 };
                const to: ObjectLayout = { x: glass2.x + relX, y: glass2.y, z: glass2.z - 1, rotation: 0 };
                const dropStart = t + i * BARLEY_POWDER_DROP_SPACING;
                anim.spawnDrop(BARLEY_POWDER_DROP, from, to, dropStart, BARLEY_POWDER_FALL_DURATION);
            }
            this.spawned = true;
        }
        if (!this.landed && t >= this.landT) {
            if (anim.hasFluidSim("glass2")) {
                anim.addBarleyToFluidSim("glass2");
            } else {
                for (const [relX, relY] of BARLEY_POWDER_POSITIONS) {
                    anim.glass2Group.addMember({ sprite: BARLEY_POWDER_DROP, relX, relY, relZ: 0 });
                }
            }
            this.landed = true;
        }
    }
}

function buildStep5Effects(anim: SceneAnimator): StepEffect[] {
    const stickTravelDuration = tipPourTravelDuration(INITIAL_LAYOUT.stick2.x, STEP5_GLASS2_X);
    const stickDropStart = STEP5_STICK_OFFSET + stickTravelDuration + STICK_PRE_POUR_PAUSE_DURATION + STICK_DUMP_DURATION / 2;
    const barleyTravelDuration = tipPourTravelDuration(INITIAL_LAYOUT.barleyScoop.x, STEP5_GLASS2_X);
    return [
        new ResidueScrapeEffect(),
        new ScraperArcEffect(),
        new StickPourEffect(stickDropStart, "glass2", "stick2"),
        buildStickBowlTipEffect("stick2", STEP5_STICK_OFFSET, INITIAL_LAYOUT.stick2.x, STEP5_GLASS2_X),
        new BarleyScoopEffect(anim),
        buildBarleyBowlTipEffect(STEP5_BARLEY_OFFSET, barleyTravelDuration),
        new TapWaterEffect(anim),
    ];
}

export const STEP5: Step = {
    transitionDuration: STEP5_TIMELINE.duration,
    substeps: STEP5_SUBSTEPS,
    transitionKeyframes: [
        // If step 4 was interrupted mid-pour (glass tipped over the dish),
        // snap it back to its upright step 2 resting spot before step 5
        // starts, since step 5 takes place in a different pane and otherwise
        // leaves the glass wherever step 4 left it.
        { t: 0, objects: { glass: { ...INITIAL_LAYOUT.glass } } },
        ...STEP5_TIMELINE.keyframes,
    ],
    loops: () => [{ kind: "pulse", id: "stirRod2", maxRadius: STIR_ROD_RADIUS, period: STIR_ROD_PULSE_PERIOD }],
    effects: buildStep5Effects,
    // The recipe's "stir for ten minutes" countdown appears 5s after
    // stirring starts, already showing 5s elapsed, mirroring step 2's. Once
    // it finishes, the stir rod stops pulsing and the liquid settles, but
    // both stay put.
    countdown: {
        totalSeconds: 10 * 60,
        startDelay: 5000,
        preElapsed: 5,
        onComplete: (anim) => {
            anim.stopStirring("stirRod2");
        },
    },
};
