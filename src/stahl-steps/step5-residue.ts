// Step 5 — Final prep. The dish's dried residue is scraped into glass2 along
// with a fresh dose of tartaric acid, a scoop of barley grass powder, and tap
// water; once all four land, the second stir rod descends into glass2 and
// starts pulsing continuously.
//
// The four additions (scraped residue, tartaric acid, barley grass powder,
// tap water) are each a self-contained Sequence, shuffled into a random order
// once at module load and concatenated with stirRod2's descent (see
// `concatSequences`), the same pattern as step 2's pours.

import { GroupArcTransfer } from "../ascii-sprites";
import { rand } from "../rng";
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
    STIR_ROD_DESCEND_DURATION,
    STIR_ROD_PULSE_PERIOD,
    STIR_ROD_RADIUS,
    STIR_ROD_REST_Y,
    STIR_ROD_START_Y,
    TAP_WATER_DROP,
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
import { concatSequences, type Sequence, type Step, type StepEffect } from "../stahl-timeline";
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

// How long the scraper takes to scrape (a short up-and-right motion), pause
// while the residue arcs into glass2, and ascend back off-screen. Its
// descend/ascend durations are computed from travel distance (see
// SCRAPER_TRAVEL_DURATION).
export const SCRAPER_SCRAPE_DURATION = 400;
export const SCRAPER_TRANSFER_DURATION = 800;

// How far the scraper moves up and to the right while scraping.
export const SCRAPER_SCRAPE_DX = 3;
export const SCRAPER_SCRAPE_DY = -1;

// World y the scraper descends to, level with the dish's residue.
export const SCRAPER_REST_Y = 6;

// How long the scraper takes to descend from its parked position to the
// dish (and, symmetrically, to ascend back), at PROP_TRAVEL_SPEED.
const SCRAPER_TRAVEL_DURATION = travelDuration(INITIAL_LAYOUT.scraper.x, PROP_PARK_Y, STEP5_DISH_X, SCRAPER_REST_Y);

// How long the tap water takes to fall into glass2 and fill it, once its
// phase begins.
export const TAP_WATER_DROP_COUNT = 3;
export const TAP_WATER_DROP_SPACING = 300;
export const TAP_WATER_FALL_DURATION = 500;
export const TAP_WATER_PHASE_DURATION = 1200;

// ---------------------------------------------------------------------------
// Phase sequences
// ---------------------------------------------------------------------------
// `parkX` is the prop's own resting x (off-screen above the viewport).

// The scraper's descend/scrape/pause/ascend motion, expressed as a Sequence
// relative to its own start. The residue transfer itself is handled
// separately by ResidueScrapeEffect, computed from this sequence's offset in
// the concatenated order.
function buildScraperSequence(): Sequence {
    const scrapeEnd = SCRAPER_TRAVEL_DURATION + SCRAPER_SCRAPE_DURATION;
    const transferEnd = scrapeEnd + SCRAPER_TRANSFER_DURATION;
    const duration = transferEnd + SCRAPER_TRAVEL_DURATION;
    const parkX = INITIAL_LAYOUT.scraper.x;
    const scrapeX = STEP5_DISH_X + SCRAPER_SCRAPE_DX;
    const scrapeY = SCRAPER_REST_Y + SCRAPER_SCRAPE_DY;
    return {
        duration,
        keyframes: [
            { t: 0, objects: { scraper: { x: parkX, y: PROP_PARK_Y, rotation: 0 } } },
            { t: SCRAPER_TRAVEL_DURATION, objects: { scraper: { x: STEP5_DISH_X, y: SCRAPER_REST_Y, rotation: 0 } } },
            { t: scrapeEnd, objects: { scraper: { x: scrapeX, y: scrapeY, rotation: 0 } } },
            // Holds the scraped pose through the residue transfer, so it
            // doesn't start ascending until the residue has landed.
            { t: transferEnd, objects: { scraper: { x: scrapeX, y: scrapeY, rotation: 0 } } },
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

// The dish's dried residue arcing from `anim.dishResidueGroup` into
// `anim.glass2Group`, once the scraper has scraped (STEP5_SCRAPER_OFFSET +
// SCRAPER_TRAVEL_DURATION + SCRAPER_SCRAPE_DURATION). By the time step 5
// plays, step 4's evaporation effect won't have run (its loop only starts
// after step 4's transition completes), so `dishResidueGroup` is seeded here
// with a full dish of residue if it's still empty.
class ResidueScrapeEffect implements StepEffect {
    private transfer: GroupArcTransfer | null = null;

    tick(t: number, anim: SceneAnimator): void {
        if (!this.transfer) {
            const releaseT = STEP5_SCRAPER_OFFSET + SCRAPER_TRAVEL_DURATION + SCRAPER_SCRAPE_DURATION;
            if (t < releaseT) return;
            if (anim.dishResidueGroup.members.length === 0) {
                for (const [relX, relY] of DISH_LIQUID_POSITIONS) {
                    anim.dishResidueGroup.addMember({ sprite: DISH_RESIDUE_PARTICLE, relX, relY, relZ: 0 });
                }
            }
            const count = anim.dishResidueGroup.members.length;
            this.transfer = new GroupArcTransfer(
                anim.dishResidueGroup,
                anim.glass2Group,
                releaseT,
                SCRAPER_TRANSFER_DURATION,
                GLASS2_POWDER_POSITIONS.slice(0, count),
            );
        }
        this.transfer.tick(t);
    }
}

// Drops a few tap water particles from above glass2 once its phase begins
// (STEP5_WATER_OFFSET), and fills glass2 with liquid particles once the last
// drop lands.
class TapWaterEffect implements StepEffect {
    private spawned = false;
    private filled: boolean;
    private readonly dropStart = STEP5_WATER_OFFSET;
    private readonly fillT =
        this.dropStart + ((TAP_WATER_DROP_COUNT - 1) * TAP_WATER_DROP_SPACING) + TAP_WATER_FALL_DURATION;

    constructor(anim: SceneAnimator) {
        this.filled = anim.liquid2Group.members.length > 0;
    }

    tick(t: number, anim: SceneAnimator): void {
        if (!this.spawned && t >= this.dropStart) {
            const glass2 = anim.getObject("glass2");
            for (let i = 0; i < TAP_WATER_DROP_COUNT; i++) {
                const from: ObjectLayout = { x: glass2.x + (i - 1), y: PROP_PARK_Y, z: glass2.z - 1, rotation: 0 };
                const to: ObjectLayout = { x: glass2.x + (i - 1), y: glass2.y + 1, z: glass2.z - 1, rotation: 0 };
                const dropStart = t + i * TAP_WATER_DROP_SPACING;
                anim.spawnDrop(TAP_WATER_DROP, from, to, dropStart, TAP_WATER_FALL_DURATION);
            }
            this.spawned = true;
        }
        if (!this.filled && t >= this.fillT) {
            anim.fillLiquid2();
            this.filled = true;
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
        this.landed = anim.glass2Group.members.some((m) => m.obj.sprite === BARLEY_POWDER_DROP);
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
            for (const [relX, relY] of BARLEY_POWDER_POSITIONS) {
                anim.glass2Group.addMember({ sprite: BARLEY_POWDER_DROP, relX, relY, relZ: 0 });
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
        new StickPourEffect(stickDropStart, "glass2", "stick2"),
        buildStickBowlTipEffect("stick2", STEP5_STICK_OFFSET, INITIAL_LAYOUT.stick2.x, STEP5_GLASS2_X),
        new BarleyScoopEffect(anim),
        buildBarleyBowlTipEffect(STEP5_BARLEY_OFFSET, barleyTravelDuration),
        new TapWaterEffect(anim),
    ];
}

export const STEP5: Step = {
    transitionDuration: STEP5_TIMELINE.duration,
    transitionKeyframes: STEP5_TIMELINE.keyframes,
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
