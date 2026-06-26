// Prop sprites, geometry, and shared layout types for the Stahl Shrine
// recipe slideshow. Recipe-agnostic engine code lives in
// ascii-compositor.ts/ascii-sprites.ts; this module defines what the props
// look like and where they start. Per-step timing/behavior lives in
// stahl-timeline.ts and src/stahl-steps/*.

import { type Sprite, type SpriteCell } from "./ascii-compositor";
import {
    bladeSprite,
    cell,
    fillRegion,
    polygonSprite,
    staticRole,
    wallCell,
} from "./ascii-sprites";

export const PANE_WIDTH = 15;
export const GRID_WIDTH = PANE_WIDTH * 2;
export const GRID_HEIGHT = 9;

export const TAU = Math.PI * 2;

// World y props (bottle, measuring stick, etc.) are parked at, above the
// viewport, before descending to pour and after ascending back off-screen.
export const PROP_PARK_Y = -5;

// Pause between the viewport settling on a new step's pane and that step's
// transition starting.
export const STEP_PAUSE_DURATION = 1000;

// Speed (grid units per ms) used for a prop's straight-line travel (e.g. the
// stick/scoop descending to and ascending from the glass), so travel time
// scales with distance instead of being a guessed fixed duration.
export const PROP_TRAVEL_SPEED = 0.01;

// Duration (ms) for a prop to travel in a straight line between two points at
// PROP_TRAVEL_SPEED.
export function travelDuration(x1: number, y1: number, x2: number, y2: number): number {
    return Math.hypot(x2 - x1, y2 - y1) / PROP_TRAVEL_SPEED;
}

// ---------------------------------------------------------------------------
// Layout types
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

// ---------------------------------------------------------------------------
// Seed pile / grinder (step 1)
// ---------------------------------------------------------------------------

const SEED = staticRole("o");

// Each [dx, dy] is one seed's offset from the pile's origin. Rendered as a
// PropGroup of individual "O" seeds (see SceneAnimator.seedGroup).
export const SEED_PILE_POSITIONS: Array<[number, number]> = [
    [-1, -1], [1, -1], [3, -1],
    [-2, 0], [0, 0], [2, 0], [4, 0],
    [-1, 1], [1, 1], [3, 1],
];

export const SEED_SPRITE: Sprite = { cells: [cell(0, 0, SEED)] };

// How long the seed pile takes to arc from its starting position into the
// grinder body.
export const SEED_FLIGHT_DURATION = 1400;

// The grinder runs for a random duration in this range once the seeds arrive.
export const GRIND_DURATION_MIN = 8000;
export const GRIND_DURATION_MAX = 10000;

// Bounds (relative to the grinder body's origin) of the top interior rows
// the seeds scatter within while being ground, between the rim and the blade.
export const GRIND_SCATTER_X = 5;
export const GRIND_SCATTER_Y_MIN = -0.5;
export const GRIND_SCATTER_Y_MAX = 0.5;

// Amplitude of the grinder body's rotational shake while running.
export const GRIND_SHAKE_AMPLITUDE = 0.12;
export const GRIND_SHAKE_PERIOD = 200;

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

export const GRINDER_INTERIOR_POINTS: Array<[number, number]> = [...GRINDER_BOWL_POINTS.slice(1), GRINDER_BOWL_POINTS[0]];

// ---------------------------------------------------------------------------
// Shot glass + contents (powder/liquid, steps 2-4)
// ---------------------------------------------------------------------------

// Rest offsets (relative to the glass's center) where the ground seed dust
// settles at the bottom of the glass interior after step 2's pour, one per
// SEED_PILE_POSITIONS entry. The glass floor is a single row at dy =
// GLASS_HEIGHT / 2 = 2, so the dust settles just above it.
export const GLASS_POWDER_POSITIONS: Array<[number, number]> = [
    [-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1],
    [-2, 1.5], [-1, 1.5], [0, 1.5], [1, 1.5], [2, 1.5],
];

// Rest offsets (relative to glass2's center) where the scraped dish residue
// settles at the bottom of glass2's interior in step 5, one per
// DISH_LIQUID_POSITIONS entry (the dish can hold up to that many residue
// particles).
export const GLASS2_POWDER_POSITIONS: Array<[number, number]> = [
    [-2, 0.5], [-1, 0.5], [0, 0.5], [1, 0.5], [2, 0.5],
    [-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1],
    [-2, 1.5], [-1, 1.5], [0, 1.5], [1, 1.5], [2, 1.5],
    [-2, 2], [-1, 2], [0, 2], [1, 2], [2, 2],
];

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
export const GLASS: Sprite = { ...polygonSprite(GLASS_POINTS, false), pivot: GLASS_PIVOT };

// Rest offsets (relative to the glass's center) where individual "~" liquid
// particles settle once the bottle's ethanol pour lands, filling the glass
// interior above the powder layer (dy 1, 1.5), derived from the glass's own
// outline so the fill region tracks GLASS_POINTS if it changes.
export const LIQUID_POSITIONS: Array<[number, number]> = fillRegion(GLASS_POINTS, 1, 1, 0.5).filter(
    ([, relY]) => relY < GLASS_HEIGHT / 2 - 1,
);

// Radius (relative to the glass center) liquid particles swirl out toward
// while the stir rod is active.
export const LIQUID_VORTEX_RADIUS = 2.5;

// Angular velocity (radians/sec) of the liquid vortex while stirring.
export const LIQUID_VORTEX_SPEED = TAU * 0.6;

// A single "~" liquid particle (see LIQUID_POSITIONS).
export const LIQUID_PARTICLE: Sprite = { cells: [cell(0, 0, staticRole("~"))] };
export const POWDER_PARTICLE: Sprite = { cells: [cell(0, 0, staticRole("."))] };

// 3D fluid sim grid resolution for the glass interior.
// radius = grid cells from center to wall; height = total vertical cells.
// The grid is (2*radius+1) × height × (2*radius+1), revolved from the profile.
export const GLASS_FLUID_DIMS = { radius: 5, height: 10 };
export const GLASS_FLUID_FILL = 0.95;

// Interior polygon for the glass's fluid sim boundary (GLASS_POINTS inset by
// the same 1-unit margin LIQUID_POSITIONS uses).
export const GLASS_INTERIOR_MARGIN = 0;

// Stir impulse constants (replacements for LIQUID_VORTEX_RADIUS/_SPEED in the
// fluid sim's coordinate space).
export const STIR_IMPULSE_RADIUS = 2;
export const STIR_IMPULSE_STRENGTH = 140;

// ---------------------------------------------------------------------------
// Stir rod (steps 2, 5)
// ---------------------------------------------------------------------------

export const STIR_ROD_RADIUS = 2;
export const STIR_ROD: Sprite = bladeSprite(STIR_ROD_RADIUS);

// Stir rod blade pulse period once it starts stirring, in ms.
export const STIR_ROD_PULSE_PERIOD = 400;

// World y the stir rod starts at, above the viewport, before descending into
// the glass.
export const STIR_ROD_START_Y = -2;

// World y the stir rod rests at once it reaches the bottom of the glass
// interior (matches the liquid surface).
export const STIR_ROD_REST_Y = 7;

// How long the stir rod takes to descend from above the viewport into the
// bottom of the glass after the grinder returns to its resting position.
export const STIR_ROD_DESCEND_DURATION = 600;

// ---------------------------------------------------------------------------
// Bottle (ethanol) and stick (tartaric acid), step 2
// ---------------------------------------------------------------------------

// Wine bottle (ethanol): a long-neck outline, drawn as a closed polygon so it
// rasterizes cleanly. Origin (0,0) sits at the base of the neck, just above
// the shoulder, so descending the bottle to a y places its spout near that
// point.
export const BOTTLE_POINTS: Array<[number, number]> = [
    [-1, -3],
    [1, -3],
    [1, 0],
    [2.5, 1],
    [2.5, 3],
    [-2.5, 3],
    [-2.5, 1],
    [-1, 0],
];
export const BOTTLE: Sprite = polygonSprite(BOTTLE_POINTS);

// Same shape reordered so the neck opening is the gap in an open polygon.
export const BOTTLE_INTERIOR_POINTS: Array<[number, number]> = [...BOTTLE_POINTS.slice(1), BOTTLE_POINTS[0]];

// Fill positions for the bottle's "~" ethanol particles (19 points spanning
// the neck and shoulder/body), derived from the bottle's own outline so the
// fill region tracks BOTTLE_POINTS if it changes. See LIQUID_POSITIONS for
// the glass's equivalent.
export const BOTTLE_LIQUID_POSITIONS: Array<[number, number]> = fillRegion(BOTTLE_POINTS, 0.3, 0.7, 0.7);

// A "(_)"-shaped bowl (carrying a scoop's contents) attached to the near end
// of a horizontal stick that extends to the right. The bowl's "_" cell(s)
// sit at dy=0 while carrying and move to dy=-1 while dumping, tipping the
// load out without rotating the stick itself. `bowlHalfWidth` controls the
// bowl's size: 1 for a small "(_)`, 2 for a wider "(___)`.
const BOWL_LEFT_ROLE = staticRole("(");
const BOWL_RIGHT_ROLE = staticRole(")");
const BOWL_BASE_ROLE = staticRole("_");
export interface ScoopSprite {
    sprite: Sprite;
    baseCellIndices: number[];
}
function buildScoopSprite(bowlHalfWidth: number): ScoopSprite {
    const cells: SpriteCell[] = [cell(-bowlHalfWidth, 0, BOWL_LEFT_ROLE)];
    const baseCellIndices: number[] = [];
    for (let dx = -bowlHalfWidth + 1; dx <= bowlHalfWidth - 1; dx++) {
        baseCellIndices.push(cells.length);
        cells.push(cell(dx, 0, BOWL_BASE_ROLE));
    }
    cells.push(cell(bowlHalfWidth, 0, BOWL_RIGHT_ROLE));
    for (let dx = bowlHalfWidth + 1; dx <= bowlHalfWidth + 3; dx++) {
        cells.push(wallCell(dx, 0, 0));
    }
    return { sprite: { cells }, baseCellIndices };
}

// Measuring stick (tartaric acid): a small "(_)" bowl at the near end of a
// horizontal stick. Origin (0,0) sits at the bowl's center.
export const { sprite: STICK, baseCellIndices: STICK_BOWL_BASE_CELL_INDICES } = buildScoopSprite(1);

// Tartaric acid drop particle: a single "." falling from the stick's cup.
export const ACID_DROP: Sprite = { cells: [cell(0, 0, staticRole("."))] };

// World y the bottle/stick descend to, just above the glass rim, to pour.
export const POUR_PROP_Y = 3;

// The bottle's resting tilt (parked/descended/ascended), clockwise.
export const BOTTLE_REST_ROTATION = TAU * (45 / 360);

// ---------------------------------------------------------------------------
// Scraper (step 5)
// ---------------------------------------------------------------------------

// Scraper: a short "\"-angled blade for working dried residue out of the
// baking dish, built from wallCells so it shows as "\" at rest.
export const SCRAPER: Sprite = {
    cells: [wallCell(-1, -1, Math.PI / 4), wallCell(0, 0, Math.PI / 4), wallCell(1, 1, Math.PI / 4)],
};

// A single "~" tap water particle poured into glass2 (see LIQUID_POSITIONS).
export const TAP_WATER_DROP: Sprite = { cells: [cell(0, 0, staticRole("~"))] };

// Barley grass powder scoop: like STICK but with a slightly wider "(___)"
// bowl. Origin (0,0) sits at the bowl's center.
export const { sprite: BARLEY_SCOOP, baseCellIndices: BARLEY_BOWL_BASE_CELL_INDICES } = buildScoopSprite(2);

// A single barley grass powder particle dumped from the scoop's cup.
export const BARLEY_POWDER_DROP: Sprite = { cells: [cell(0, 0, staticRole(","))] };

// Rest offsets (relative to glass2's center) where the dumped barley grass
// powder settles, in the top interior row (above the residue/water layers at
// dy >= 0.5) so it doesn't overlap GLASS2_POWDER_POSITIONS.
export const BARLEY_POWDER_POSITIONS: Array<[number, number]> = [
    [-1.5, 0], [-0.5, 0], [0.5, 0], [1.5, 0],
];

// ---------------------------------------------------------------------------
// Fan (step 4)
// ---------------------------------------------------------------------------

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

export const FAN = fanSprite(2);

// ---------------------------------------------------------------------------
// Baking dish + contents (step 4)
// ---------------------------------------------------------------------------

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
export const DISH = polygonSprite(DISH_POINTS, false);

// A single "~" liquid particle poured into the dish (see DISH_LIQUID_POSITIONS).
export const DISH_LIQUID_PARTICLE: Sprite = { cells: [cell(0, 0, staticRole("~"))] };

// A single "." residue particle left behind in the dish once a liquid
// particle evaporates.
export const DISH_RESIDUE_PARTICLE: Sprite = { cells: [cell(0, 0, staticRole("."))] };

// The dish's scattered "." residue, gathered by the scraper into a single "@"
// clump (step 5) before falling into glass2.
export const RESIDUE_CLUMP_PARTICLE: Sprite = { cells: [cell(0, 0, staticRole("@"))] };

// Rest offsets (relative to the dish's center) where individual "~" liquid
// particles settle once the glass pours into the dish, one per
// LIQUID_POSITIONS entry (GroupArcTransfer requires exactly that many
// targets), derived from the dish's own outline so the fill region tracks
// DISH_POINTS if it changes.
export const DISH_LIQUID_POSITIONS: Array<[number, number]> = fillRegion(DISH_POINTS, 0.5, 1.25, 0.5).slice(
    0,
    LIQUID_POSITIONS.length,
);

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

export const FRIDGE_LEFT_WALL = fridgeWallSprite(FRIDGE_WALL);
export const FRIDGE_RIGHT_WALL = fridgeWallSprite(FRIDGE_WALL_RIGHT);

// The cover spans from just inside the left wall to just inside the right
// wall, resting flush on top of both once it lands.
const FRIDGE_COVER_WIDTH = FRIDGE_RIGHT_X - FRIDGE_LEFT_X + 1;
export const FRIDGE_COVER: Sprite = {
    cells: Array.from({ length: FRIDGE_COVER_WIDTH }, (_, dx) => cell(dx, 0, FRIDGE_COVER_GLYPH)),
};

// A single ice particle ejected from a vent.
export const ICE_PARTICLE: Sprite = { cells: [cell(0, 0, staticRole("*"))] };

// ---------------------------------------------------------------------------
// Sprite registry + initial layout
// ---------------------------------------------------------------------------

export const SPRITES: Record<string, Sprite> = {
    glass: GLASS,
    glass2: GLASS,
    stirRod: STIR_ROD,
    stirRod2: STIR_ROD,
    bottle: BOTTLE,
    stick: STICK,
    stick2: STICK,
    scraper: SCRAPER,
    barleyScoop: BARLEY_SCOOP,
    dish: DISH,
    fan: FAN,
    fridgeLeftWall: FRIDGE_LEFT_WALL,
    fridgeRightWall: FRIDGE_RIGHT_WALL,
    fridgeCover: FRIDGE_COVER,
};

// Step 0 — the layout shown before any step is selected. Seeds sit beside
// the grinder; everything else parked in its eventual home pane.
export const INITIAL_LAYOUT: FullLayout = {
    seedPile: { x: 4, y: 6, z: 5, rotation: 0 },
    grinderBody: { x: 7.5 + PANE_WIDTH, y: 6, z: 2, rotation: 0 },
    grinderBlade: { x: 7.5 + PANE_WIDTH, y: 7, z: 3, rotation: 0 },
    glass: { x: 7.5 + 2 * PANE_WIDTH, y: 6, z: 1, rotation: 0 },
    // Sits in step 6's pane, visible alongside step 5's, as step 5's "second
    // glass" before its own contents are added.
    glass2: { x: 7.5 + 5 * PANE_WIDTH, y: 6, z: 1, rotation: 0 },
    stirRod: { x: 7.5 + 2 * PANE_WIDTH, y: STIR_ROD_START_Y, z: 3, rotation: 0 },
    // Parked off-screen above until step 5's transition lowers it into glass2.
    stirRod2: { x: 7.5 + 5 * PANE_WIDTH, y: PROP_PARK_Y, z: 3, rotation: 0 },
    bottle: { x: 7.5 + PANE_WIDTH, y: PROP_PARK_Y, z: 3, rotation: BOTTLE_REST_ROTATION },
    stick: { x: 10 + PANE_WIDTH, y: PROP_PARK_Y, z: 3, rotation: 0 },
    // Step 5's own tartaric acid stick, parked off-screen above glass2 until
    // step 5's transition descends it to pour.
    stick2: { x: 5 + 5 * PANE_WIDTH, y: PROP_PARK_Y, z: 3, rotation: 0 },
    // Parked off-screen above the dish until step 5's transition descends it
    // to scrape the dish's residue into glass2.
    scraper: { x: 7.5 + 4 * PANE_WIDTH, y: PROP_PARK_Y, z: 3, rotation: 0 },
    // Parked off-screen above until step 5's transition descends it to dump
    // barley grass powder into glass2.
    barleyScoop: { x: 9 + 5 * PANE_WIDTH, y: PROP_PARK_Y, z: 3, rotation: 0 },
    dish: { x: 7.5 + 4 * PANE_WIDTH, y: 7, z: 1, rotation: 0 },
    fan: { x: 13 + 4 * PANE_WIDTH, y: 3, z: 4, rotation: 0 },
    fridgeLeftWall: { x: FRIDGE_LEFT_X, y: FRIDGE_TOP_Y, z: 0, rotation: 0 },
    fridgeRightWall: { x: FRIDGE_RIGHT_X, y: FRIDGE_TOP_Y, z: 0, rotation: 0 },
    // Parked off-screen above the fridge until step 3's transition drops it
    // onto the walls.
    fridgeCover: { x: FRIDGE_LEFT_X, y: PROP_PARK_Y, z: 3, rotation: 0 },
};
