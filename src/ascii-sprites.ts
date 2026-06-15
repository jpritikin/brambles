// Sprite-building helpers and additional glyph-role resolvers shared by
// scene objects.

import { type PropGroup, type PropGroupMember, type Sprite, type SpriteCell, registerGlyphResolver, staticGlyph } from "./ascii-compositor";
import { rand } from "./rng";

export function cell(dx: number, dy: number, role: string, alpha = 1): SpriteCell {
  return { dx, dy, role, alpha };
}

// A wall-role cell with an explicit edge tangent direction (radians, in the
// sprite's unrotated frame). 0 = horizontal (-), PI/2 = vertical (|).
export function wallCell(dx: number, dy: number, edgeAngle: number): SpriteCell {
  return { dx, dy, role: "wall", alpha: 1, edgeAngle };
}

// A static role for a single fixed character (registers the role once).
const staticRoles = new Map<string, string>();
export function staticRole(char: string): string {
  let role = staticRoles.get(char);
  if (!role) {
    role = `char-${char.charCodeAt(0)}-${staticRoles.size}`;
    registerGlyphResolver(role, staticGlyph(char));
    staticRoles.set(char, role);
  }
  return role;
}

// Builds cells for a rectangular outline (e.g. shot glass, baking dish) using
// the "wall" role, which auto-picks - | / \ based on each edge's tangent
// direction after rotation. `width`/`height` are the outline's full extent
// in grid units; the origin (0,0) is the rectangle's center.
export function ringSprite(width: number, height: number): Sprite {
  const cells: SpriteCell[] = [];
  const halfW = width / 2;
  const halfH = height / 2;
  // Top/bottom edges run horizontally (edgeAngle 0 -> "-").
  for (let dx = -halfW; dx <= halfW; dx++) {
    cells.push(wallCell(dx, -halfH, 0));
    cells.push(wallCell(dx, halfH, 0));
  }
  // Left/right edges run vertically (edgeAngle PI/2 -> "|").
  for (let dy = -halfH + 1; dy < halfH; dy++) {
    cells.push(wallCell(-halfW, dy, Math.PI / 2));
    cells.push(wallCell(halfW, dy, Math.PI / 2));
  }
  return { cells };
}

// An outline through `points` (local dx/dy units), rasterized fresh each
// render at the object's current rotation (see rasterizePolygon in
// ascii-compositor) so it stays gap-free and proportionally correct at any
// rotation angle, unlike a static cells array sampled in local space. If
// `closed` is false, the edge from the last point back to the first is
// omitted (e.g. an open-topped shot glass).
export function polygonSprite(points: Array<[number, number]>, closed = true): Sprite {
  return { cells: [], polygon: points, polygonClosed: closed };
}

// Height/width ratio of a polygon's bounding box, e.g. for correcting
// circular motion to an ellipse matching a container's proportions.
export function boundingAspectRatio(polygon: Array<[number, number]>): number {
  const xs = polygon.map(([x]) => x);
  const ys = polygon.map(([, y]) => y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  return height / width;
}

// Shortest distance from (x, y) to the segment a-b.
function distToSegment(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((x - ax) * dx + (y - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

// True if (x, y) is inside `polygon` (standard ray-casting test).
function pointInPolygon(x: number, y: number, polygon: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Scan-fills the interior of a closed polygon (local dx/dy units) with a grid
// of points spacingX/spacingY apart, keeping only points at least `margin`
// away from every edge so generated particles don't render on top of the
// container's walls. Used to derive a fluid container's particle positions
// from its outline (e.g. GLASS_POINTS, DISH_POINTS) instead of hardcoding
// them separately.
export function fillRegion(
  polygon: Array<[number, number]>,
  margin: number,
  spacingX: number,
  spacingY: number,
): Array<[number, number]> {
  const xs = polygon.map(([x]) => x);
  const ys = polygon.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const points: Array<[number, number]> = [];
  for (let y = minY; y <= maxY + 1e-9; y += spacingY) {
    for (let x = minX; x <= maxX + 1e-9; x += spacingX) {
      if (!pointInPolygon(x, y, polygon)) continue;
      let minDist = Infinity;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        minDist = Math.min(minDist, distToSegment(x, y, polygon[i][0], polygon[i][1], polygon[j][0], polygon[j][1]));
      }
      if (minDist >= margin - 1e-9) points.push([x, y]);
    }
  }
  return points;
}

// Builds a sprite from a multi-line ASCII art string. `originCol`/`originRow`
// mark which character sits at local (0,0). Spaces are treated as
// transparent (alpha 0) and skipped.
export function artSprite(art: string, originCol: number, originRow: number): Sprite {
  const lines = art.replace(/^\n/, "").split("\n");
  const cells: SpriteCell[] = [];
  lines.forEach((line, row) => {
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      if (ch === " ") continue;
      cells.push(cell(col - originCol, row - originRow, staticRole(ch)));
    }
  });
  return { cells };
}

export function mergeSprites(...sprites: Sprite[]): Sprite {
  return { cells: sprites.flatMap((s) => s.cells) };
}

// Builds a single-line text sprite (e.g. a countdown readout), with
// `originCol` marking which character sits at local dx=0. Spaces are
// transparent and skipped.
export function textSprite(text: string, originCol: number): Sprite {
  const cells: SpriteCell[] = [];
  for (let col = 0; col < text.length; col++) {
    const ch = text[col];
    if (ch === " ") continue;
    cells.push(cell(col - originCol, 0, staticRole(ch)));
  }
  return { cells };
}

// A horizontal "blade" that pulses between a single hub glyph and a line
// extending `maxRadius` cells either side, e.g. for maxRadius 3:
// o, =o=, ==o==, ===o===, ==o==, =o=, (repeat). The hub cell (dx 0) always
// stays visible; side cells fade in/out by alpha as the animator's pulse
// radius grows and shrinks. `dx` is recorded on each cell so the animator
// can compute alpha from the current radius.
export interface BladeCell extends SpriteCell {
  dx: number;
}

const HUB_ROLE = staticRole("o");
const ARM_ROLE = staticRole("=");

export function bladeSprite(maxRadius: number): Sprite {
  const cells: BladeCell[] = [{ dx: 0, dy: 0, role: HUB_ROLE, alpha: 1 }];
  for (let r = 1; r <= maxRadius; r++) {
    cells.push({ dx: -r, dy: 0, role: ARM_ROLE, alpha: 0 });
    cells.push({ dx: r, dy: 0, role: ARM_ROLE, alpha: 0 });
  }
  return { cells };
}

// The pulse radius at time `t` (ms) for a blade of `maxRadius`, cycling
// 0..maxRadius..0 over `period` ms (e.g. 0,1,2,3,2,1 for maxRadius 3).
export function bladePulseRadius(t: number, maxRadius: number, period: number): number {
  const cycle = (2 * maxRadius) || 1;
  const step = (t / period) * cycle;
  const phase = ((step % cycle) + cycle) % cycle;
  return phase <= maxRadius ? phase : cycle - phase;
}

// Updates a blade sprite's arm cells in place to match `radius` (a value in
// [0, maxRadius]); arm cells with |dx| <= radius become visible.
export function applyBladeRadius(sprite: Sprite, radius: number): void {
  for (const c of sprite.cells as BladeCell[]) {
    if (c.dx === 0) continue;
    c.alpha = Math.abs(c.dx) <= radius ? 1 : 0;
  }
}

// Glyph stages a seed cycles through while being ground: a whole seed "O",
// a fragment "o", then dust ".".
export const SEED_GLYPHS = ["O", "o", "."] as const;
export const SEED_ROLES = SEED_GLYPHS.map(staticRole);

// The seed glyph stage at grind progress `t` in [0, 1]: stays "O" for the
// first third, "o" for the middle third, and "." for the rest.
export function seedGrindRole(t: number): string {
  const stage = Math.min(SEED_ROLES.length - 1, Math.floor(t * SEED_ROLES.length));
  return SEED_ROLES[stage];
}

// Ornstein-Uhlenbeck step: nudges `v` with random turbulence while pulling it
// back toward zero, so a value wanders unpredictably but stays bounded.
export function ouStep(v: number, dt: number, revertRate: number, volatility: number): number {
  const noise = (rand() - 0.5) * 2;
  return v - revertRate * v * dt + volatility * noise * Math.sqrt(dt);
}

export interface FlightLayout {
  x: number;
  y: number;
  z: number;
  rotation: number;
}

// Position/rotation along a parabolic arc from `from` to `to` as `span` goes
// 0 -> 1: x, rotation, and the straight-line y are lerped, then `arcHeight`
// is added to lift y partway through, peaking at span 0.5. `z` switches from
// `from.z` to `to.z` only once the arc completes (span >= 1), so an object
// stays above/below other props until it actually lands.
export function arcLerp(from: FlightLayout, to: FlightLayout, span: number, arcHeight: number): FlightLayout {
  const x = lerp(from.x, to.x, span);
  const straightY = lerp(from.y, to.y, span);
  const y = straightY - arcHeight * 4 * span * (1 - span);
  const z = span < 1 ? from.z : to.z;
  const rotation = shortestAngleLerp(from.rotation, to.rotation, span);
  return { x, y, z, rotation };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function shortestAngleLerp(a: number, b: number, t: number): number {
  const TAU = Math.PI * 2;
  let diff = (b - a) % TAU;
  if (diff > Math.PI) diff -= TAU;
  if (diff < -Math.PI) diff += TAU;
  return a + diff * t;
}

// Animates a `PropGroup`'s shared origin along a parabolic arc from `from` to
// `to`, while each member wobbles around its rest offset via independent
// Ornstein-Uhlenbeck jitter (e.g. a pile of seeds arcing into a grinder, each
// jittering slightly so they don't move in lockstep). Call `update` each
// frame during the flight, then `land` once it arrives to transfer every
// member into its destination group.
export class MemberFlight {
  private jitter: Array<{ vx: number; vy: number }>;

  constructor(
    private group: PropGroup,
    private restPositions: Array<[number, number]>,
    private revertRate = 2,
    private volatility = 1.5,
    private jitterScale = 10,
  ) {
    this.jitter = restPositions.map(() => ({ vx: 0, vy: 0 }));
  }

  // Advances jitter and repositions the group's origin and each member's
  // rel offset for the current point in the arc.
  update(span: number, dt: number, from: FlightLayout, to: FlightLayout, arcHeight = 3): void {
    for (const [i, member] of this.group.members.entries()) {
      const j = this.jitter[i];
      j.vx = ouStep(j.vx, dt, this.revertRate, this.volatility);
      j.vy = ouStep(j.vy, dt, this.revertRate, this.volatility);
      member.relX = this.restPositions[i][0] + j.vx * dt * this.jitterScale;
      member.relY = this.restPositions[i][1] + j.vy * dt * this.jitterScale;
    }
    const layout = arcLerp(from, to, span, arcHeight);
    this.group.setOrigin(layout.x, layout.y, layout.z, layout.rotation);
  }

  // Resets jitter to rest, e.g. when an in-progress flight is interrupted and
  // members are returned to their starting group.
  reset(): void {
    for (const j of this.jitter) {
      j.vx = 0;
      j.vy = 0;
    }
  }

  // Transfers every member into `target`, placing each at `place(restX,
  // restY, index)` relative to the target's origin.
  land(target: PropGroup, place: (restX: number, restY: number, index: number) => [number, number, number?]): void {
    for (const [i, member] of [...this.group.members].entries()) {
      const [relX, relY, relZ] = place(this.restPositions[i][0], this.restPositions[i][1], i);
      this.group.transferTo(member, target, relX, relY, relZ);
    }
  }
}

// A one-shot transfer of a fixed set of members from one PropGroup to another
// along an arc, triggered by elapsed transition time crossing `releaseT`
// (release) and `releaseT + flightDuration` (land). Used for e.g. step 2's
// ground seed dust falling from the tipped grinder into the glass: while
// `tick` is called each frame with the transition's elapsed time, members are
// released from `from` at their current world positions, arc-lerp toward
// per-member offsets from `to`'s current origin, and land in `to` once the
// arc completes. `tick` is a no-op once landed.
export class GroupArcTransfer {
  private released = false;
  private landed = false;
  private flightFrom: FlightLayout[] = [];
  private members: PropGroupMember[] = [];

  constructor(
    private from: PropGroup,
    private to: PropGroup,
    private releaseT: number,
    private flightDuration: number,
    // Offsets (relative to `to`'s origin) each released member arcs toward,
    // and the relZ it lands at, in member order.
    private targetOffsets: Array<[number, number, number?]>,
    private arcHeight = 2,
  ) {}

  get isLanded(): boolean {
    return this.landed;
  }

  // Advances the transfer for transition-elapsed time `t` (ms): releases
  // `from`'s members (the last `targetOffsets.length` of them) at `releaseT`,
  // arcs them toward `to`'s current origin between `releaseT` and `releaseT +
  // flightDuration`, and transfers them into `to` once the arc completes.
  tick(t: number): void {
    if (this.landed) return;

    if (!this.released) {
      if (t < this.releaseT) return;
      this.members = this.from.members.slice(this.from.members.length - this.targetOffsets.length);
      for (const member of this.members) {
        this.from.release(member);
        this.flightFrom.push({ x: member.obj.x, y: member.obj.y, z: member.obj.z, rotation: member.obj.rotation });
      }
      this.released = true;
    }

    const flightEnd = this.releaseT + this.flightDuration;
    const span = this.flightDuration > 0 ? Math.min(1, Math.max(0, (t - this.releaseT) / this.flightDuration)) : 1;
    for (const [i, member] of this.members.entries()) {
      const [relX, relY] = this.targetOffsets[i];
      const target: FlightLayout = { x: this.to.x + relX, y: this.to.y + relY, z: this.to.z - 1, rotation: 0 };
      Object.assign(member.obj, arcLerp(this.flightFrom[i], target, span, this.arcHeight));
    }

    if (t >= flightEnd) {
      for (const [i, member] of this.members.entries()) {
        const [relX, relY, relZ] = this.targetOffsets[i];
        this.from.transferTo(member, this.to, relX, relY, relZ ?? -1);
      }
      this.to.setOrigin(this.to.x, this.to.y, this.to.z, this.to.rotation);
      this.landed = true;
    }
  }
}

// Iterates `frame(elapsed, dt)` in fixed `dtMs` steps from 0 to `duration`,
// either synchronously (if `instant`) or via `requestAnimationFrame`,
// invoking `onDone` once `duration` is reached. The animated path also calls
// `render` after each frame. Shared by `playTransition` and `startGrinding`
// so each only needs to define its own `frame`/`onDone`.
export function runFrames(
  duration: number,
  frame: (elapsed: number, dt: number) => void,
  onDone: () => void,
  options: {
    instant: boolean;
    render?: () => void;
    setRafHandle?: (handle: number | null) => void;
    // If false, the animated path's terminal tick skips `frame`/`render` and
    // calls `onDone` directly (e.g. `startGrinding`, whose `onDone` applies
    // its own final-state reset instead of running one more grind frame at
    // elapsed === duration). The instant path always calls `frame` at
    // elapsed === duration regardless. Defaults to true.
    callFrameAtEnd?: boolean;
  },
): void {
  if (options.instant) {
    const dtMs = 16;
    let elapsed = 0;
    let last = 0;
    while (elapsed < duration) {
      elapsed = Math.min(elapsed + dtMs, duration);
      frame(elapsed, (elapsed - last) / 1000);
      last = elapsed;
    }
    onDone();
    return;
  }

  const callFrameAtEnd = options.callFrameAtEnd ?? true;
  const start = performance.now();
  let last = start;
  const tick = (now: number): void => {
    const elapsed = Math.max(0, now - start);
    const dt = Math.max(0, now - last) / 1000;
    last = now;

    if (elapsed >= duration) {
      if (callFrameAtEnd) {
        frame(duration, dt);
        options.render?.();
      }
      options.setRafHandle?.(null);
      onDone();
      return;
    }

    frame(elapsed, dt);
    options.render?.();
    options.setRafHandle?.(requestAnimationFrame(tick));
  };
  options.setRafHandle?.(requestAnimationFrame(tick));
}
