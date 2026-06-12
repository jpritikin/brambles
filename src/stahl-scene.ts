// Scene objects and animation timeline for the Stahl Shrine recipe
// slideshow. Every prop (seeds, grinder, shot glass, stir rod, fan, etc.) is
// defined once as a SceneObject with continuous position/rotation, and the
// Compositor renders/diffs the grid each frame.
//
// Steps live in an unbounded world space, one PANE_WIDTH-wide "pane" per
// step (step N occupies world x in [N*PANE_WIDTH, (N+1)*PANE_WIDTH)). All
// coordinates below (initial layouts and keyframes) are authored directly in
// this world space. Selecting step `index` rests the viewport at
// viewOffsetX = (index-1)*PANE_WIDTH, panning from the previous step's
// resting offset, so both the previous and new resting frames stay visible
// and an object can lift, slide across the seam, rotate, and land in its new
// spot in one continuous move.

import { type PropGroupMember, type SceneObject, type Sprite, Compositor, PropGroup, rotateOffset } from "./ascii-compositor";
import { rand } from "./rng";
import {
    applyBladeRadius,
    arcLerp,
    bladePulseRadius,
    bladeSprite,
    cell,
    GroupArcTransfer,
    MemberFlight,
    ouStep,
    polygonSprite,
    runFrames,
    seedGrindRole,
    staticRole,
    textSprite,
    wallCell,
} from "./ascii-sprites";

export const PANE_WIDTH = 15;
export const GRID_WIDTH = PANE_WIDTH * 2;
export const GRID_HEIGHT = 9;

// ---------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------

const SEED = staticRole("o");
const ICE = staticRole("*");

const TAU = Math.PI * 2;

// Each [dx, dy] is one seed's offset from the pile's origin. Rendered as a
// PropGroup of individual "O" seeds (see SceneAnimator.seedGroup).
export const SEED_PILE_POSITIONS: Array<[number, number]> = [
    [-1, -1], [1, -1], [3, -1],
    [-2, 0], [0, 0], [2, 0], [4, 0],
    [-1, 1], [1, 1], [3, 1],
];

const SEED_SPRITE: Sprite = { cells: [cell(0, 0, seedGrindRole(0))] };

// How long the seed pile takes to arc from its starting position into the
// grinder body.
export const SEED_FLIGHT_DURATION = 1400;

// How long to pause after the viewport settles on a step's pane before that
// step's transition animation begins.
export const STEP_PAUSE_DURATION = 1000;

// Rest offsets (relative to the glass's center) where the ground seed dust
// settles at the bottom of the glass interior after step 2's pour, one per
// SEED_PILE_POSITIONS entry. The glass floor is a single row at dy =
// GLASS_HEIGHT / 2 = 2, so the dust settles just above it.
export const GLASS_POWDER_POSITIONS: Array<[number, number]> = [
    [-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1],
    [-2, 1.5], [-1, 1.5], [0, 1.5], [1, 1.5], [2, 1.5],
];

// Rest offsets (relative to the glass's center) where individual "~" liquid
// particles settle once the bottle's ethanol pour lands, filling the glass
// interior above the powder layer (dy 1, 1.5).
export const LIQUID_POSITIONS: Array<[number, number]> = [
    [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1],
    [-2, -0.5], [-1, -0.5], [0, -0.5], [1, -0.5], [2, -0.5],
    [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0],
    [-2, 0.5], [-1, 0.5], [0, 0.5], [1, 0.5], [2, 0.5],
];

// Radius (relative to the glass center) liquid particles swirl out toward
// while the stir rod is active.
export const LIQUID_VORTEX_RADIUS = 2.5;

// Angular velocity (radians/sec) of the liquid vortex while stirring.
export const LIQUID_VORTEX_SPEED = TAU * 0.6;

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

// How long the stir rod takes to descend from above the viewport into the
// bottom of the glass after the grinder returns to its resting position.
export const STIR_ROD_DESCEND_DURATION = 600;

// World y the stir rod starts at, above the viewport, before descending into
// the glass.
export const STIR_ROD_START_Y = -2;

// World y props (bottle, measuring stick) are parked at, above the viewport,
// before descending to pour and after ascending back off-screen.
export const PROP_PARK_Y = -5;

// World y the bottle/stick descend to, just above the glass rim, to pour.
export const POUR_PROP_Y = 3;

// Phase durations for the bottle's (ethanol) and stick's (tartaric acid)
// pour sequences: descend above the glass, pause while pouring drops, then
// ascend (bottle) or right itself and ascend (stick) back off-screen.
export const BOTTLE_DESCEND_DURATION = 500;
export const BOTTLE_POUR_DURATION = 800;
export const BOTTLE_ASCEND_DURATION = 500;
export const BOTTLE_DROP_COUNT = 3;
export const BOTTLE_DROP_FALL_DURATION = 500;

export const STICK_DESCEND_DURATION = 500;
export const STICK_POUR_DURATION = 700;
export const STICK_ASCEND_DURATION = 500;
export const STICK_TIP_ROTATION = TAU * (30 / 360);
export const STICK_DROP_FALL_DURATION = 500;

// World y the stir rod rests at once it reaches the bottom of the glass
// interior (matches the liquid surface).
export const STIR_ROD_REST_Y = 7;

// Stir rod blade pulse period once it starts stirring, in ms.
export const STIR_ROD_PULSE_PERIOD = 400;

// The grinder runs for a random duration in this range once the seeds arrive.
const GRIND_DURATION_MIN = 8000;
const GRIND_DURATION_MAX = 10000;

// Bounds (relative to the grinder body's origin) of the top interior rows
// the seeds scatter within while being ground, between the rim and the blade.
const GRIND_SCATTER_X = 5;
const GRIND_SCATTER_Y_MIN = -0.5;
const GRIND_SCATTER_Y_MAX = 0.5;

// Amplitude of the grinder body's rotational shake while running.
const GRIND_SHAKE_AMPLITUDE = 0.12;
const GRIND_SHAKE_PERIOD = 200;

// Spinning grinder blade: pulses between a hub and a line extending up to 3
// cells either side, sitting inside the grinder body's bowl.
export const GRINDER_BLADE_RADIUS = 3;
export const GRINDER_BLADE = bladeSprite(GRINDER_BLADE_RADIUS);

// Bowl-shaped grinder body: a closed quadrilateral outline (rim, two
// straight sides, base), drawn with "wall" cells so it auto-picks - | / \
// based on each edge's tangent direction after the object's rotation is
// applied (see polylineSprite). The base corners are inset from the rim
// corners for a slightly rounded look, matching the original ASCII art.
export const GRINDER_BOWL_POINTS: Array<[number, number]> = [
    [-7, -1], // top-left rim
    [6, -1], // top-right rim
    [5, 2], // bottom-right base
    [-6, 2], // bottom-left base
];
export const GRINDER_BODY = polygonSprite(GRINDER_BOWL_POINTS);

// Shot glass: an open-topped polygon (left wall, floor, right wall) so it can
// rotate as a rigid shape during step 4's lift/pour into the baking dish. The
// floor is a single row at the bottom (dy = height/2); the top (dy =
// -height/2) is left open.
export const GLASS_WIDTH = 6;
export const GLASS_HEIGHT = 4;
export const GLASS_POINTS: Array<[number, number]> = [
    [-GLASS_WIDTH / 2, -GLASS_HEIGHT / 2],
    [-GLASS_WIDTH / 2, GLASS_HEIGHT / 2],
    [GLASS_WIDTH / 2, GLASS_HEIGHT / 2],
    [GLASS_WIDTH / 2, -GLASS_HEIGHT / 2],
];
// Bottom-right corner, relative to the glass's own origin/center — the point
// step 4's pour tip rotates around: both the glass body (via Sprite.pivot)
// and its powder/liquid PropGroups (via the pivot passed to their
// constructors) rotate around this same on-screen point, so they tip
// together.
export const GLASS_PIVOT: [number, number] = [GLASS_WIDTH / 2, GLASS_HEIGHT / 2];
const GLASS: Sprite = { ...polygonSprite(GLASS_POINTS, false), pivot: GLASS_PIVOT };

// A single "~" liquid particle (see LIQUID_POSITIONS).
const LIQUID_PARTICLE: Sprite = { cells: [cell(0, 0, staticRole("~"))] };

// Stir rod: the same pulsing blade sprite as the grinder (a hub that grows
// arms out to either side while stirring), parked as a single "o" when at
// rest.
export const STIR_ROD_RADIUS = 2;
const STIR_ROD: Sprite = bladeSprite(STIR_ROD_RADIUS);

// Wine bottle (ethanol): a long-neck outline, drawn as a closed polygon so it
// rasterizes cleanly. Origin (0,0) sits at the base of the neck, just above
// the shoulder, so descending the bottle to a y places its spout near that
// point.
export const BOTTLE_POINTS: Array<[number, number]> = [
    [-1, -3], // top of neck
    [1, -3], // top of neck
    [1, 0], // neck-shoulder right
    [2, 1], // shoulder
    [2, 3], // body bottom-right
    [-2, 3], // body bottom-left
    [-2, 1], // shoulder
    [-1, 0], // neck-shoulder left
];
const BOTTLE: Sprite = polygonSprite(BOTTLE_POINTS);

// Ethanol drop particle: a single "~" falling from the bottle's neck.
const ETHANOL_DROP: Sprite = { cells: [cell(0, 0, staticRole("~"))] };

// Measuring stick (tartaric acid): a vertical line with a small cup at the
// tip, built from wallCells (like STIR_ROD used to be) so it can tilt to
// "pour". Origin (0,0) sits at the cup.
const STICK: Sprite = {
    cells: [wallCell(0, -2, Math.PI / 2), wallCell(0, -1, Math.PI / 2), wallCell(0, 0, Math.PI / 2), cell(0, 1, staticRole("u"))],
};

// Tartaric acid drop particle: a single "." falling from the stick's cup.
const ACID_DROP: Sprite = { cells: [cell(0, 0, staticRole("."))] };

// Fan: four blades radiating from a hub, rotating continuously. Each blade
// is a wall-role line so it shows as - | / \ depending on current angle.
// Horizontal blades (along x) have edgeAngle 0; vertical blades (along y)
// have edgeAngle PI/2.
function fanSprite(length: number): Sprite {
    const cells = [cell(0, 0, staticRole("+"))];
    for (let i = 1; i <= length; i++) {
        cells.push(wallCell(i, 0, 0));
        cells.push(wallCell(-i, 0, 0));
        cells.push(wallCell(0, i, Math.PI / 2));
        cells.push(wallCell(0, -i, Math.PI / 2));
    }
    return { cells };
}

const FAN = fanSprite(2);

// Baking dish: an open-topped polygon (left wall, floor, right wall), like
// the shot glass, so the poured liquid visibly sits inside it.
export const DISH_WIDTH = 10;
export const DISH_HEIGHT = 2;
export const DISH_POINTS: Array<[number, number]> = [
    [-DISH_WIDTH / 2, -DISH_HEIGHT / 2],
    [-DISH_WIDTH / 2, DISH_HEIGHT / 2],
    [DISH_WIDTH / 2, DISH_HEIGHT / 2],
    [DISH_WIDTH / 2, -DISH_HEIGHT / 2],
];
const DISH = polygonSprite(DISH_POINTS, false);

// A single "~" liquid particle poured into the dish (see DISH_LIQUID_POSITIONS).
const DISH_LIQUID_PARTICLE: Sprite = { cells: [cell(0, 0, staticRole("~"))] };

// A single "." residue particle left behind in the dish once a liquid
// particle evaporates.
const DISH_RESIDUE_PARTICLE: Sprite = { cells: [cell(0, 0, staticRole("."))] };

// Rest offsets (relative to the dish's center) where individual "~" liquid
// particles settle once the glass pours into the dish, one per
// LIQUID_POSITIONS entry. The dish floor is a single row at dy = DISH_HEIGHT
// / 2 = 1, so the liquid settles just above it.
export const DISH_LIQUID_POSITIONS: Array<[number, number]> = [
    [-4, 0.5], [-2.5, 0.5], [-1, 0.5], [0.5, 0.5], [2, 0.5], [3.5, 0.5],
    [-4.5, 0], [-3, 0], [-1.5, 0], [0, 0], [1.5, 0], [3, 0], [4.5, 0],
    [-4, -0.5], [-2.5, -0.5], [-1, -0.5], [0.5, -0.5], [2, -0.5], [3.5, -0.5], [-3.5, 0.5],
];

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
// how high that arc rises. The arc is cut short at its peak (span 0.5) — the
// glass ends up partway between the fridge and the dish, elevated, and the
// tip rotation (pivoting around its bottom-right corner) swings it the rest
// of the way over the dish to pour.
export const STEP4_GLASS_ARC_DURATION = 800;
export const STEP4_GLASS_ARC_HEIGHT = 2.5;

// World x/y the glass's arc out of the fridge is aimed at (its pour position,
// upright); the angle it then tips to (pivoting around its bottom-right
// corner) and how long that tip takes; and how long the pour itself takes
// once tipped (during which liquid transfers from the glass into the dish).
export const STEP4_POUR_X = 7.5 + 4 * PANE_WIDTH - DISH_WIDTH / 2 + 1.5;
export const STEP4_POUR_Y = 5;
export const STEP4_POUR_ROTATION = TAU * (110 / 360);
export const STEP4_GLASS_TIP_DURATION = 500;
export const STEP4_POUR_DURATION = 800;

// How long the glass pauses tipped over the dish (after the last drop lands)
// before rotating back upright, and how long that rotation back takes (also
// pivoting around the bottom-right corner).
export const STEP4_POUR_TO_RETURN_PAUSE = 600;
export const STEP4_GLASS_RIGHT_DURATION = 500;

// How long the glass pauses upright over the dish before starting its return
// trip, and how long it takes to arc back up to its step 2 resting spot, and
// how high that arc rises.
export const STEP4_RIGHT_TO_RETURN_PAUSE = 500;
export const STEP4_GLASS_RETURN_DURATION = 900;
export const STEP4_GLASS_RETURN_ARC_HEIGHT = 2.5;

// How long after the glass arrives back at its step 2 resting spot before the
// fan starts spinning.
export const STEP4_FAN_START_DELAY = 1000;

// Cumulative elapsed time (ms) at the end of each step 4 phase, shared by
// transitionKeyframes and the per-frame effects below so they stay in sync.
const STEP4_COVER_LIFT_END = STEP4_COVER_LIFT_DURATION;
const STEP4_PRE_POUR_PAUSE_END = STEP4_COVER_LIFT_END + STEP4_PRE_POUR_PAUSE;
const STEP4_GLASS_ARC_END = STEP4_PRE_POUR_PAUSE_END + STEP4_GLASS_ARC_DURATION;
const STEP4_GLASS_TIP_END = STEP4_GLASS_ARC_END + STEP4_GLASS_TIP_DURATION;
const STEP4_POUR_END = STEP4_GLASS_TIP_END + STEP4_POUR_DURATION;
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

// ---------------------------------------------------------------------------
// Refrigerator (step 3)
// ---------------------------------------------------------------------------
// The fridge sits in the right half of step 3's pane: a left wall ">", a
// right wall "<" (each with a vent "=" embedded in its top cell), and a top
// cover "V" that drops in from above once the glass has arrived. Each part is
// its own SceneObject so the cover can animate independently of the (static)
// walls. The walls stop short of the grid's top edge, leaving headroom for
// the glass to be lifted back out over them in step 4.

const FRIDGE_WALL = staticRole(">");
const FRIDGE_WALL_RIGHT = staticRole("<");
const FRIDGE_VENT = staticRole("=");
const FRIDGE_COVER_GLYPH = staticRole("V");

// World x of the fridge's left/right walls, occupying the right half of step
// 4's pane (one pane right of where the glass arrives from in step 2/3).
export const FRIDGE_LEFT_X = 3 * PANE_WIDTH;
export const FRIDGE_RIGHT_X = 4 * PANE_WIDTH - 1;
// World y of each wall's top cell and the fridge floor (where ice particles
// come to rest).
export const FRIDGE_TOP_Y = 3;
export const FRIDGE_FLOOR_Y = GRID_HEIGHT - 1;
export const FRIDGE_HEIGHT = FRIDGE_FLOOR_Y - FRIDGE_TOP_Y + 1;
// World y of the vent cell embedded in each wall, 2 rows below the wall's top.
export const FRIDGE_VENT_Y = FRIDGE_TOP_Y + 2;
const FRIDGE_VENT_DY = FRIDGE_VENT_Y - FRIDGE_TOP_Y;

// The vent glyph is embedded FRIDGE_VENT_DY rows down; the rest of the wall
// runs from the top to the floor.
function fridgeWallSprite(wallRole: string): Sprite {
    return {
        cells: Array.from({ length: FRIDGE_HEIGHT }, (_, dy) => cell(0, dy, dy === FRIDGE_VENT_DY ? FRIDGE_VENT : wallRole)),
    };
}

const FRIDGE_LEFT_WALL = fridgeWallSprite(FRIDGE_WALL);
const FRIDGE_RIGHT_WALL = fridgeWallSprite(FRIDGE_WALL_RIGHT);

// The cover spans from just inside the left wall to just inside the right
// wall, resting flush on top of both once it lands.
const FRIDGE_COVER_WIDTH = FRIDGE_RIGHT_X - FRIDGE_LEFT_X + 1;
const FRIDGE_COVER: Sprite = {
    cells: Array.from({ length: FRIDGE_COVER_WIDTH }, (_, dx) => cell(dx, 0, FRIDGE_COVER_GLYPH)),
};

// A single ice particle ejected from a vent.
const ICE_PARTICLE: Sprite = { cells: [cell(0, 0, ICE)] };

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

// Where the glass would land if its step 4 arc out of the fridge (see
// GlassLiftArcEffect) ran the full span 0..1, upright above the dish.
const STEP4_ARC_TARGET: ObjectLayout = { x: STEP4_POUR_X, y: STEP4_GLASS_LIFT_Y, z: STEP4_GLASS_RAISED_Z, rotation: 0 };

// World x/y/z the glass arcs up out of the fridge to (its position at
// STEP4_GLASS_ARC_END) — the arc's peak, cut short at span 0.5, partway
// between the fridge and the dish. The tip rotation (pivoting around the
// glass's bottom-right corner) then swings it the rest of the way over the
// dish to pour.
const STEP4_ARC_PEAK: ObjectLayout = arcLerp(GLASS_FRIDGE_REST, STEP4_ARC_TARGET, 0.5, STEP4_GLASS_ARC_HEIGHT);

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

const SPRITES: Record<string, Sprite> = {
    glass: GLASS,
    glass2: GLASS,
    stirRod: STIR_ROD,
    bottle: BOTTLE,
    stick: STICK,
    dish: DISH,
    fan: FAN,
    fridgeLeftWall: FRIDGE_LEFT_WALL,
    fridgeRightWall: FRIDGE_RIGHT_WALL,
    fridgeCover: FRIDGE_COVER,
};

// ---------------------------------------------------------------------------
// Layout / animation types
// ---------------------------------------------------------------------------

export interface ObjectLayout {
    x: number;
    y: number;
    z: number;
    rotation: number;
}

// A complete snapshot of every prop's layout. All props are always visible;
// props not yet "in use" or already "retired" simply sit at a parked
// position, often outside the currently-visible pane.
export type FullLayout = Record<string, ObjectLayout>;

export interface TransitionKeyframe {
    // Time offset from the start of the transition, in ms.
    t: number;
    objects: Partial<Record<string, Partial<ObjectLayout>>>;
}

// A self-contained chunk of a step's transition timeline: `keyframes[].t` are
// relative to this sequence's own start (0..duration). Used to compose a
// step's transitionKeyframes/transitionDuration out of pieces that can be
// concatenated in a runtime-chosen order (e.g. step 2's three pour
// sequences, randomly reordered, followed by the stir rod's descent).
export interface Sequence {
    duration: number;
    keyframes: TransitionKeyframe[];
}

// Concatenates `sequences` in order into a single keyframe list (with each
// sequence's `t` shifted by its cumulative start offset) plus the total
// duration.
export function concatSequences(sequences: Sequence[]): { keyframes: TransitionKeyframe[]; duration: number } {
    let offset = 0;
    const keyframes: TransitionKeyframe[] = [];
    for (const seq of sequences) {
        for (const kf of seq.keyframes) {
            keyframes.push({ t: kf.t + offset, objects: kf.objects });
        }
        offset += seq.duration;
    }
    return { keyframes, duration: offset };
}

export interface ContinuousSpin {
    kind: "spin";
    id: string;
    // Radians per second, applied once the transition finishes.
    angularVelocity: number;
}

// Pulses a bladeSprite's arms in and out (e.g. o, -o-, --o--, ---o---, --o--,
// -o-, repeat) once the transition finishes.
export interface BladePulse {
    kind: "pulse";
    id: string;
    maxRadius: number;
    // Time, in ms, for the radius to go 0 -> maxRadius -> 0 (one full cycle).
    period: number;
}

// Continues ticking a transition's StepEffect after the transition finishes,
// with `t` continuing to increase from where the transition left off (e.g.
// step 3's IceParticleEffect, which keeps spawning ice for as long as the
// fridge is shown).
export interface EffectLoop {
    kind: "effect";
    effect: StepEffect;
}

export type Loop = ContinuousSpin | BladePulse | EffectLoop;

// A short-lived particle (e.g. an ethanol or tartaric-acid drop) falling from
// a prop's spout into the glass. `startT`/`duration` are relative to the
// transition's elapsed time; `SceneAnimator.updateDrops` advances `obj` along
// `arcLerp(from, to, ...)` while `startT <= elapsed < startT + duration`, then
// removes it from the compositor once it lands.
interface DropAnimation {
    obj: SceneObject;
    from: ObjectLayout;
    to: ObjectLayout;
    startT: number;
    duration: number;
}

// A self-contained per-frame side effect for a step's transition, beyond the
// generic keyframe interpolation `playTransition` already applies to every
// object's timeline. Each effect is constructed fresh per `playTransition`
// call (so any internal state, e.g. GroupArcTransfer's released/landed flags,
// starts clean) and `tick` is called once per frame with the transition's
// elapsed time (ms), in declaration order. Used for things keyframes can't
// express directly: particles transferring between PropGroups (pours,
// drops), or one-shot state changes triggered partway through a transition
// (e.g. the liquid filling the glass once the bottle's pour lands).
export interface StepEffect {
    tick(t: number, anim: SceneAnimator): void;
}

// A countdown timer shown once a step settles (e.g. "stir for 10 minutes",
// "refrigerate for 20 minutes"). `startDelay` is how long after the
// transition finishes the timer appears; `preElapsed` is how much time it
// shows as already elapsed at that moment (e.g. step 2's timer appears 5s
// into the stir, so it starts at 9:55 rather than 10:00). The timer is
// hidden as soon as a different step is selected, regardless of whether it
// reached 0.
export interface CountdownConfig {
    totalSeconds: number;
    startDelay: number;
    preElapsed?: number;
    // Called once when the countdown reaches 0 (not called if interrupted by
    // a step change).
    onComplete?: (anim: SceneAnimator) => void;
}

// Formats a remaining-seconds count as "mm:ss" for the countdown timer.
function formatCountdown(seconds: number): string {
    const total = Math.ceil(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

const COUNTDOWN_TIMER_ID = "countdownTimer";
const COUNTDOWN_TIMER_Y = 0;
const COUNTDOWN_TIMER_Z = 10;

export interface Step {
    // How long the pan/transition animation takes, in ms.
    transitionDuration: number;
    // Sparse waypoints during the transition, authored in world-space
    // coordinates (see PANE_WIDTH comment below). t=0 is implicitly wherever
    // each prop was left by the previous step (or, for step 1, by
    // `INITIAL_LAYOUT`) — `playStep` always gets there first by resetting to
    // `INITIAL_LAYOUT` and fast-forwarding steps 1..index-1, so a step's
    // keyframes are deterministic regardless of which step was previously
    // shown. A prop's final layout (at `transitionDuration`) is whatever its
    // last keyframe leaves it at, or unchanged if it has no keyframes.
    // Properties not specified at a waypoint carry forward from the previous
    // waypoint that defined them.
    transitionKeyframes?: TransitionKeyframe[];
    // Continuous animations that start once the transition finishes. Given
    // this transition's `effects` (see below) so an EffectLoop can continue
    // ticking the same effect instance used during the transition.
    loops?: (effects: StepEffect[]) => Loop[];
    // Factory for this step's per-frame effects (see StepEffect), called once
    // per `playTransition` invocation so each effect's internal state starts
    // fresh.
    effects?: (anim: SceneAnimator) => StepEffect[];
    // Countdown timer to show once the transition (plus `startDelay`)
    // finishes; see CountdownConfig.
    countdown?: CountdownConfig;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
// Coordinates below are world-space x positions directly (see PANE_WIDTH
// comment above). For step N (1-based), the resting/parked position of a
// prop in pane P is P*PANE_WIDTH + <on-screen offset within that pane>.

// Step 0 — the layout shown before any step is selected. Seeds sit beside
// the grinder; everything else is parked in its eventual home pane.
export const INITIAL_LAYOUT: FullLayout = {
    seedPile: { x: 4, y: 6, z: 5, rotation: 0 },
    grinderBody: { x: 7.5 + PANE_WIDTH, y: 6, z: 2, rotation: 0 },
    grinderBlade: { x: 7.5 + PANE_WIDTH, y: 7, z: 3, rotation: 0 },
    glass: { x: 7.5 + 2 * PANE_WIDTH, y: 6, z: 1, rotation: 0 },
    glass2: { x: 7.5 + 5 * PANE_WIDTH, y: PROP_PARK_Y, z: 1, rotation: 0 },
    stirRod: { x: 7.5 + 2 * PANE_WIDTH, y: 4.5, z: 3, rotation: 0 },
    bottle: { x: 7.5 + PANE_WIDTH, y: PROP_PARK_Y, z: 3, rotation: 0 },
    stick: { x: 10 + PANE_WIDTH, y: PROP_PARK_Y, z: 3, rotation: 0 },
    dish: { x: 7.5 + 4 * PANE_WIDTH, y: 7, z: 1, rotation: 0 },
    fan: { x: 13 + 4 * PANE_WIDTH, y: 3, z: 4, rotation: 0 },
    fridgeLeftWall: { x: FRIDGE_LEFT_X, y: FRIDGE_TOP_Y, z: 0, rotation: 0 },
    fridgeRightWall: { x: FRIDGE_RIGHT_X, y: FRIDGE_TOP_Y, z: 0, rotation: 0 },
    // Parked off-screen above the fridge until step 3's transition drops it
    // onto the walls.
    fridgeCover: { x: FRIDGE_LEFT_X, y: PROP_PARK_Y, z: 3, rotation: 0 },
};

// ---------------------------------------------------------------------------
// Step 2 pour sequences
// ---------------------------------------------------------------------------
// Step 2 pours its three ingredients (ground seeds via the grinder, ethanol
// via the bottle, tartaric acid via the stick) into the glass in a randomly
// chosen order, each as a self-contained Sequence (see `concatSequences`).
// `parkX` is the prop's own resting x (off-screen above the viewport);
// `glassX` is the glass's world x for this step.

// The grinder's existing tip/pause/pour/return motion, expressed as a
// Sequence relative to its own start. The pour-fall (seed dust falling into
// the glass) is handled separately in `playTransition` via `pourFallStart`/
// `pourFallEnd`, computed from this sequence's offset in the concatenated
// order.
function buildGrinderPourSequence(parkX: number, glassX: number): Sequence {
    const duration = POUR_TIP_DURATION + POUR_PAUSE_DURATION + POUR_FLIGHT_DURATION + POUR_RETURN_DURATION;
    const pauseEnd = POUR_TIP_DURATION + POUR_PAUSE_DURATION + POUR_FLIGHT_DURATION;
    return {
        duration,
        keyframes: [
            { t: 0, objects: { grinderBody: { x: parkX, y: 6, rotation: 0 } } },
            { t: POUR_TIP_DURATION, objects: { grinderBody: { x: glassX, y: 1, rotation: POUR_TIP_ROTATION } } },
            // Holds the tipped pose through the pause and pour-fall, so it doesn't
            // start rotating back until the seed dust has landed.
            { t: pauseEnd, objects: { grinderBody: { x: glassX, y: 1, rotation: POUR_TIP_ROTATION } } },
            { t: duration, objects: { grinderBody: { x: parkX, y: 6, rotation: 0 } } },
        ],
    };
}

// The bottle descends above the glass, pauses while ethanol drops fall, then
// ascends back off-screen.
function buildBottlePourSequence(parkX: number, glassX: number): Sequence {
    const duration = BOTTLE_DESCEND_DURATION + BOTTLE_POUR_DURATION + BOTTLE_ASCEND_DURATION;
    return {
        duration,
        keyframes: [
            { t: 0, objects: { bottle: { x: parkX, y: PROP_PARK_Y, rotation: 0 } } },
            { t: BOTTLE_DESCEND_DURATION, objects: { bottle: { x: glassX, y: POUR_PROP_Y, rotation: 0 } } },
            { t: BOTTLE_DESCEND_DURATION + BOTTLE_POUR_DURATION, objects: { bottle: { x: glassX, y: POUR_PROP_Y, rotation: 0 } } },
            { t: duration, objects: { bottle: { x: parkX, y: PROP_PARK_Y, rotation: 0 } } },
        ],
    };
}

// The stick descends above the glass, tips to pour a single tartaric acid
// drop, rights itself, then ascends back off-screen.
function buildStickPourSequence(parkX: number, glassX: number): Sequence {
    const duration = STICK_DESCEND_DURATION + STICK_POUR_DURATION + STICK_ASCEND_DURATION;
    return {
        duration,
        keyframes: [
            { t: 0, objects: { stick: { x: parkX, y: PROP_PARK_Y, rotation: 0 } } },
            { t: STICK_DESCEND_DURATION, objects: { stick: { x: glassX, y: POUR_PROP_Y, rotation: 0 } } },
            { t: STICK_DESCEND_DURATION + STICK_POUR_DURATION, objects: { stick: { x: glassX, y: POUR_PROP_Y, rotation: STICK_TIP_ROTATION } } },
            { t: duration, objects: { stick: { x: parkX, y: PROP_PARK_Y, rotation: 0 } } },
        ],
    };
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
// descent. The shuffled offsets feed both `STEP2_TIMELINE` (the keyframes
// below) and the per-frame effects built by `buildStep2Effects`, so the
// pour-fall and drop-particle effects fire at the same point in the timeline
// where each sequence's grinder/bottle/stick keyframes place it.
const STEP2_GLASS_X = 7.5 + 2 * PANE_WIDTH;
const STEP2_POUR_SEQUENCES: Array<{ id: "grinder" | "bottle" | "stick"; sequence: Sequence }> = [
    { id: "grinder", sequence: buildGrinderPourSequence(7.5 + PANE_WIDTH, STEP2_GLASS_X) },
    { id: "bottle", sequence: buildBottlePourSequence(INITIAL_LAYOUT.bottle.x, STEP2_GLASS_X) },
    { id: "stick", sequence: buildStickPourSequence(INITIAL_LAYOUT.stick.x, STEP2_GLASS_X) },
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
// Step 2 per-frame effects
// ---------------------------------------------------------------------------

// The ground seed dust falling from the tipped grinder into the glass, once
// it's done pausing above the glass. Wraps a `GroupArcTransfer` from
// `anim.grinderGroup` (the seeds, attached since step 1's grind) to
// `anim.glassGroup`, releasing/landing relative to `STEP2_GRINDER_OFFSET`'s
// position in the shuffled timeline.
class SeedPourEffect implements StepEffect {
    private transfer: GroupArcTransfer | null = null;

    tick(t: number, anim: SceneAnimator): void {
        if (!this.transfer) {
            const releaseT = STEP2_GRINDER_OFFSET + POUR_TIP_DURATION + POUR_PAUSE_DURATION;
            const seedCount = anim.grinderGroup.members.length - 2;
            this.transfer = new GroupArcTransfer(
                anim.grinderGroup,
                anim.glassGroup,
                releaseT,
                POUR_FLIGHT_DURATION,
                GLASS_POWDER_POSITIONS.slice(0, seedCount),
            );
        }
        this.transfer.tick(t);
    }
}

// Drops a few ethanol particles from the bottle's spout into the glass once
// the bottle's pause/pour phase begins (STEP2_BOTTLE_OFFSET +
// BOTTLE_DESCEND_DURATION), and fills the glass with liquid particles once
// the last drop lands.
class BottlePourEffect implements StepEffect {
    private spawned = false;
    private filled: boolean;
    private readonly dropStart = STEP2_BOTTLE_OFFSET + BOTTLE_DESCEND_DURATION;
    private readonly fillT =
        this.dropStart + ((BOTTLE_DROP_COUNT - 1) * BOTTLE_POUR_DURATION) / BOTTLE_DROP_COUNT + BOTTLE_DROP_FALL_DURATION;

    constructor(anim: SceneAnimator) {
        this.filled = anim.liquidGroup.members.length > 0;
    }

    tick(t: number, anim: SceneAnimator): void {
        if (!this.spawned && t >= this.dropStart) {
            const bottle = anim.getObject("bottle");
            const glass = anim.getObject("glass");
            for (let i = 0; i < BOTTLE_DROP_COUNT; i++) {
                const from: ObjectLayout = { x: bottle.x, y: bottle.y, z: bottle.z - 1, rotation: 0 };
                const to: ObjectLayout = { x: glass.x + (i - 1), y: glass.y + 1, z: glass.z - 1, rotation: 0 };
                const dropStart = t + (i * BOTTLE_POUR_DURATION) / BOTTLE_DROP_COUNT;
                anim.spawnDrop(ETHANOL_DROP, from, to, dropStart, BOTTLE_DROP_FALL_DURATION);
            }
            this.spawned = true;
        }
        if (!this.filled && t >= this.fillT) {
            anim.fillLiquid();
            this.filled = true;
        }
    }
}

// Drops a single tartaric-acid particle from the stick's cup into the glass
// once the stick's pour phase begins (STEP2_STICK_OFFSET +
// STICK_DESCEND_DURATION + half of STICK_POUR_DURATION).
class StickPourEffect implements StepEffect {
    private spawned = false;
    private readonly dropStart = STEP2_STICK_OFFSET + STICK_DESCEND_DURATION + STICK_POUR_DURATION / 2;

    tick(t: number, anim: SceneAnimator): void {
        if (this.spawned || t < this.dropStart) return;
        const stick = anim.getObject("stick");
        const glass = anim.getObject("glass");
        const cos = Math.cos(stick.rotation);
        const sin = Math.sin(stick.rotation);
        const { rx, ry } = rotateOffset(0, 1, cos, sin);
        const from: ObjectLayout = { x: stick.x + rx, y: stick.y + ry, z: stick.z - 1, rotation: 0 };
        const to: ObjectLayout = { x: glass.x, y: glass.y + 1, z: glass.z - 1, rotation: 0 };
        anim.spawnDrop(ACID_DROP, from, to, t, STICK_DROP_FALL_DURATION);
        this.spawned = true;
    }
}

function buildStep2Effects(anim: SceneAnimator): StepEffect[] {
    return [new SeedPourEffect(), new BottlePourEffect(anim), new StickPourEffect()];
}

// ---------------------------------------------------------------------------
// Step 3 effects: glass arcing into the fridge, the cover dropping onto the
// walls once it lands, and ice particles drifting out of the vents while the
// fridge runs.
// ---------------------------------------------------------------------------

// Carries the glass (and its riding powder/liquid groups) along a parabolic
// arc from its step 2 resting spot into the fridge interior. Runs first;
// `CoverDropEffect` waits for `isLanded` before starting its descent.
class GlassFridgeArcEffect implements StepEffect {
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
class CoverDropEffect implements StepEffect {
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

class IceParticleEffect implements StepEffect {
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

function buildStep3Effects(anim: SceneAnimator): StepEffect[] {
    const glassArc = new GlassFridgeArcEffect(anim);
    const coverDrop = new CoverDropEffect(glassArc);
    return [glassArc, coverDrop, new IceParticleEffect(coverDrop)];
}

// ---------------------------------------------------------------------------
// Step 4 effects: the glass arcing out of the fridge and pouring its liquid
// into the dish, the poured liquid evaporating into "." residue, the glass
// arcing back to its step 2 spot, and the fan spinning until the liquid is
// gone.
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

// Transfers `anim.liquidGroup`'s particles into `anim.dishLiquidGroup` once
// the glass has tipped over the dish (after the cover lift, pre-pour pause,
// glass lift-arc, and tip phases), arcing each into its DISH_LIQUID_POSITIONS
// rest offset over STEP4_POUR_DURATION.
class LiquidPourEffect implements StepEffect {
    private transfer: GroupArcTransfer | null = null;

    get isLanded(): boolean {
        return this.transfer?.isLanded ?? false;
    }

    tick(t: number, anim: SceneAnimator): void {
        if (!this.transfer) {
            this.transfer = new GroupArcTransfer(
                anim.liquidGroup,
                anim.dishLiquidGroup,
                STEP4_GLASS_TIP_END,
                STEP4_POUR_DURATION,
                DISH_LIQUID_POSITIONS.map(([relX, relY]): [number, number, number] => [relX, relY, 0]),
            );
        }
        this.transfer.tick(t);
    }
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

    constructor(private pour: LiquidPourEffect, private fanSpin: FanSpinEffect) {}

    // True once every poured particle has finished evaporating.
    get allEvaporated(): boolean {
        return this.particles !== null && this.particles.every((p) => p.phase === "done");
    }

    tick(t: number, anim: SceneAnimator): void {
        if (!this.pour.isLanded || this.fanSpin.startedAt === null) return;

        if (!this.particles) {
            this.particles = anim.dishLiquidGroup.members.map((member, i) => ({
                member,
                restX: DISH_LIQUID_POSITIONS[i][0],
                restY: DISH_LIQUID_POSITIONS[i][1],
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
                anim.dishResidueGroup.addMember({ sprite: DISH_RESIDUE_PARTICLE, relX: particle.restX, relY: particle.restY, relZ: 0 });
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

    constructor(private glassReturn: GlassReturnArcEffect) {}

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

function buildStep4Effects(anim: SceneAnimator): StepEffect[] {
    const glassLift = new GlassLiftArcEffect();
    const pour = new LiquidPourEffect();
    const glassReturn = new GlassReturnArcEffect();
    const fanSpin = new FanSpinEffect(glassReturn);
    const evaporation = new EvaporationEffect(pour, fanSpin);
    fanSpin.setEvaporation(evaporation);
    return [glassLift, pour, glassReturn, fanSpin, evaporation];
}

export const STEPS: Step[] = [
    // Step 1 — Grind the seeds. The seed pile starts in the previous pane and
    // arcs across the seam into the grinder body; once it arrives, the blade
    // spins up and grinds for several seconds while the body shakes and the
    // seeds gradually crumble to dust.
    {
        transitionDuration: SEED_FLIGHT_DURATION,
        transitionKeyframes: [
            { t: SEED_FLIGHT_DURATION, objects: { seedPile: { x: 7.5 + PANE_WIDTH, y: 6, z: 1 } } },
        ],
    },
    // Step 2 — Mix & stir. The grinder lifts and tips ~110° clockwise above the
    // waiting shot glass, pauses, then pours its ground seed dust in and rights
    // itself; once it's back at rest, the stir rod descends from above into the
    // glass and starts pulsing continuously.
    {
        transitionDuration: STEP2_TIMELINE.duration,
        transitionKeyframes: STEP2_TIMELINE.keyframes,
        loops: () => [{ kind: "pulse", id: "stirRod", maxRadius: STIR_ROD_RADIUS, period: STIR_ROD_PULSE_PERIOD }],
        effects: buildStep2Effects,
        // The recipe's "stir for ten minutes" countdown appears 5s after
        // stirring starts, already showing 5s elapsed. Once it finishes, the
        // stir rod is lifted out and put away.
        countdown: {
            totalSeconds: 10 * 60,
            startDelay: 5000,
            preElapsed: 5,
            onComplete: (anim) => {
                const stirRod = anim.getObject("stirRod");
                stirRod.y = PROP_PARK_Y;
            },
        },
    },
    // Step 3 — Refrigerate. The stir rod lifts up and out of frame to be put
    // away; once it's clear, the glass arcs into the waiting fridge, the
    // fridge's top cover drops into place, and the 20-minute countdown
    // begins. While the fridge runs, ice particles occasionally drift out of
    // its vents and settle on the floor.
    {
        transitionDuration:
            STIR_ROD_PARK_DURATION + GLASS_FRIDGE_ARC_DURATION + FRIDGE_COVER_DROP_DELAY + FRIDGE_COVER_DESCEND_DURATION,
        transitionKeyframes: [
            { t: STIR_ROD_PARK_DURATION, objects: { stirRod: { y: PROP_PARK_Y, rotation: 0 } } },
        ],
        effects: buildStep3Effects,
        // Keeps spawning ice particles for as long as step 3 is shown, well
        // beyond the transition's own duration.
        loops: (effects) => {
            const iceEffect = effects.find((e): e is IceParticleEffect => e instanceof IceParticleEffect);
            return iceEffect ? [{ kind: "effect", effect: iceEffect }] : [];
        },
        // The "refrigerate for 20 minutes" countdown appears 5s after the
        // cover has finished dropping into place, already showing 5s elapsed.
        countdown: { totalSeconds: 20 * 60, startDelay: 5000, preElapsed: 5 },
    },
    // Step 4 — Evaporate. The fridge cover lifts back to its parking spot
    // above; after a pause, the glass arcs up out of the fridge partway
    // toward the dish, then tips (pivoting around its bottom-right corner)
    // the rest of the way over the dish to pour. It pauses tipped while the
    // liquid spills, then rotates back upright, pauses again, and arcs back
    // up to its step 2 resting spot. The poured liquid gradually evaporates
    // into "." residue in the dish, with steam rising as it does; the fan
    // starts a beat after the glass lands, and spins until the liquid is gone.
    {
        transitionDuration: STEP4_TRANSITION_DURATION,
        transitionKeyframes: [
            // The fridge cover lifts back off the walls to its parked spot
            // above.
            { t: STEP4_COVER_LIFT_END, objects: { fridgeCover: { y: PROP_PARK_Y } } },
            // The glass stays put at its fridge resting position until the
            // pre-pour pause ends, at which point GlassLiftArcEffect takes
            // over x/y/z/rotation for its arc out of the fridge.
            { t: STEP4_PRE_POUR_PAUSE_END, objects: { glass: { ...GLASS_FRIDGE_REST } } },
            // Holds at the arc's peak (STEP4_ARC_PEAK, set by
            // GlassLiftArcEffect) before tipping to pour, rotating around its
            // bottom-right corner (GLASS_PIVOT) so that corner stays put on
            // screen and swings the glass body the rest of the way over the
            // dish.
            { t: STEP4_GLASS_ARC_END, objects: {
                glass: { ...STEP4_ARC_PEAK, z: STEP4_GLASS_RAISED_Z, rotation: 0 },
            } },
            { t: STEP4_GLASS_TIP_END, objects: {
                glass: { ...STEP4_ARC_PEAK, z: STEP4_GLASS_RAISED_Z, rotation: STEP4_POUR_ROTATION },
            } },
            // Holds the tipped pose through the pour, so it doesn't start
            // rotating back until the liquid has landed in the dish.
            { t: STEP4_POUR_END, objects: {
                glass: { ...STEP4_ARC_PEAK, z: STEP4_GLASS_RAISED_Z, rotation: STEP4_POUR_ROTATION },
            } },
            // Holds the tipped pose a little longer after the pour lands
            // before rotating back upright.
            { t: STEP4_POUR_TO_RETURN_PAUSE_END, objects: {
                glass: { ...STEP4_ARC_PEAK, z: STEP4_GLASS_RAISED_Z, rotation: STEP4_POUR_ROTATION },
            } },
            // Rotates back upright, again pivoting around its bottom-right
            // corner, then pauses before GlassReturnArcEffect takes over
            // x/y/z/rotation for the arc back to the step 2 resting spot.
            { t: STEP4_GLASS_RIGHT_END, objects: {
                glass: { ...STEP4_ARC_PEAK, z: STEP4_GLASS_RAISED_Z, rotation: 0 },
            } },
            { t: STEP4_RIGHT_TO_RETURN_PAUSE_END, objects: {
                glass: { ...STEP4_ARC_PEAK, z: STEP4_GLASS_RAISED_Z, rotation: 0 },
            } },
        ],
        effects: buildStep4Effects,
        // Keeps the fan spinning and the dish's liquid evaporating for as
        // long as step 4 is shown, well beyond the transition's own duration.
        loops: (effects) => {
            const pour = effects.find((e): e is LiquidPourEffect => e instanceof LiquidPourEffect);
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
    },
    // Step 5 — Final draught. The dried residue is scraped into a fresh shot
    // glass with water; the stir rod returns for a final stir, then the glass
    // empties (drunk).
    {
        transitionDuration: 2400,
        transitionKeyframes: [
            {
                t: 500,
                objects: {
                    glass2: { x: 7.5 + 5 * PANE_WIDTH, y: 6, z: 1, rotation: 0 },
                    stirRod: { x: 7.5 + 5 * PANE_WIDTH, y: STIR_ROD_REST_Y, z: 3, rotation: 0 },
                },
            },
        ],
        loops: () => [{ kind: "pulse", id: "stirRod", maxRadius: STIR_ROD_RADIUS, period: STIR_ROD_PULSE_PERIOD }],
    },
];

// ---------------------------------------------------------------------------
// SceneAnimator: builds the initial object set, plays transitions between
// steps, and pans the viewport.
// ---------------------------------------------------------------------------

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
