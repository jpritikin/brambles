// Generic ASCII compositor: objects are defined once with continuous-space
// geometry and rendered onto a character grid. Rotation happens in continuous
// space before projection, so a sprite can spin smoothly and have its glyphs
// (e.g. a glass wall switching between - / | \) update to match the angle of
// each segment after rotation.

export type GlyphResolver = (rotation: number, cell: SpriteCell) => string;

// A cell's character is determined by its `role` (and the object's current
// rotation), not hardcoded — this is what lets a rotating wall segment pick
// between - / | \ automatically.
export interface SpriteCell {
    // Position relative to the object's origin, in grid units (can be
    // fractional — rotation is applied before snapping to the grid).
    dx: number;
    dy: number;
    role: string;
    alpha: number;
    // For roles like "wall" whose glyph depends on orientation: the local
    // tangent direction of this cell's edge (radians, in the sprite's
    // unrotated frame). Rotated by the object's current rotation to pick the
    // glyph — independent of the cell's position relative to the origin.
    edgeAngle?: number;
}

export interface Sprite {
    cells: SpriteCell[];
    // An optional outline (local dx/dy units), rasterized fresh each render at
    // the object's current rotation via Bresenham line-drawing (see
    // rasterizePolygon) instead of being baked into `cells` ahead of time. Used
    // for shapes (e.g. the grinder bowl, shot glass) that need to rotate to
    // arbitrary angles without the per-cell sampling gaps/overlaps a static
    // cells array would produce.
    polygon?: Array<[number, number]>;
    // If false, `polygon` is rasterized as an open polyline (no edge from the
    // last point back to the first) — e.g. an open-topped shot glass. Defaults
    // to true (a closed outline).
    polygonClosed?: boolean;
    // Point (local dx/dy units, relative to the sprite's origin) that rotation
    // pivots around. Defaults to [0, 0] (the origin itself, i.e. the sprite
    // doesn't shift on screen as it rotates). `x`/`y` continue to mean the
    // sprite's own origin; callers that want a different point (e.g. a
    // glass's bottom-right corner) to stay fixed on screen as rotation
    // changes must move `x`/`y` themselves each frame.
    pivot?: [number, number];
}

export interface SceneObject {
    id: string;
    sprite: Sprite;
    x: number;
    y: number;
    z: number;
    rotation: number; // radians
    visible: boolean;
}

interface GridCell {
    char: string;
    alpha: number;
    z: number;
}

const GLYPH_RESOLVERS = new Map<string, GlyphResolver>();

// Registers how a role's character is chosen given the object's rotation.
export function registerGlyphResolver(role: string, resolver: GlyphResolver): void {
    GLYPH_RESOLVERS.set(role, resolver);
}

// A role whose glyph never changes regardless of rotation.
export function staticGlyph(char: string): GlyphResolver {
    return () => char;
}

// Resolves a cell's character for the given object rotation, using whatever
// resolver is registered for the cell's role (or "?" if none is).
export function resolveGlyph(rotation: number, cell: SpriteCell): string {
    const resolver = GLYPH_RESOLVERS.get(cell.role) ?? staticGlyph("?");
    return resolver(rotation, cell);
}

// Ratio of a monospace cell's height to its width (1.4em line-height over a
// ~0.6em character width). Rotating dx/dy directly would treat cells as
// square, badly distorting shapes; squashing dy by this ratio before
// rotating and stretching it back after keeps rotated sprites' proportions
// close to their unrotated ones.
const CELL_ASPECT = 1.4 / 0.6;

// Picks among `-`, `|`, `/`, `\` for a line whose on-screen angle (radians,
// already CELL_ASPECT-corrected) is `onScreenAngle`.
function glyphForOnScreenAngle(onScreenAngle: number): string {
    // Normalize to [0, PI) since a line and its opposite direction look the same.
    let normalized = onScreenAngle % Math.PI;
    if (normalized < 0) normalized += Math.PI;
    const deg = (normalized * 180) / Math.PI;
    if (deg < 22.5 || deg >= 157.5) return "-";
    if (deg < 67.5) return "\\";
    if (deg < 112.5) return "|";
    return "/";
}

// Picks among `-`, `|`, `/`, `\` based on the cell's edge tangent direction
// after the object's rotation is applied. The angle is first warped through
// CELL_ASPECT so the classification reflects the line's apparent on-screen
// slope rather than its slope on a square grid.
export function wallGlyph(rotation: number, cell: SpriteCell): string {
    const angle = (cell.edgeAngle ?? 0) + rotation;
    const onScreenAngle = Math.atan2(Math.sin(angle) * CELL_ASPECT, Math.cos(angle));
    return glyphForOnScreenAngle(onScreenAngle);
}

registerGlyphResolver("wall", wallGlyph);

// One rasterized cell of a polygon outline: grid-relative position (rx, ry
// rounded) and the glyph to draw there.
export interface RasterCell {
    col: number;
    row: number;
    char: string;
}

// Rasterizes a polygon (local dx/dy units) rotated by `rotation`, producing
// one RasterCell per grid cell each edge passes through, via Bresenham
// line-drawing in (rounded) grid space — unlike sampling along each edge in
// local space, this guarantees no gaps or piled-up duplicate cells regardless
// of the edge's on-screen angle after rotation. If `closed` is false (e.g. an
// open-topped shot glass), the edge from the last point back to the first is
// omitted, leaving that side open.
export function rasterizePolygon(points: Array<[number, number]>, rotation: number, closed = true, pivot: [number, number] = [0, 0]): RasterCell[] {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const [pivotX, pivotY] = pivot;
    const rotated = points.map(([dx, dy]) => rotateOffset(dx - pivotX, dy - pivotY, cos, sin));

    const edges: RasterCell[] = [];
    const edgeCount = closed ? rotated.length : rotated.length - 1;
    const edgeAngles: number[] = [];
    for (let i = 0; i < edgeCount; i++) {
        const a = rotated[i];
        const b = rotated[(i + 1) % rotated.length];
        const onScreenAngle = Math.atan2(b.ry - a.ry, b.rx - a.rx);
        edgeAngles.push(onScreenAngle);
        const char = glyphForOnScreenAngle(onScreenAngle);
        for (const [col, row] of bresenhamLine(Math.round(a.rx), Math.round(a.ry), Math.round(b.rx), Math.round(b.ry))) {
            edges.push({ col, row, char });
        }
    }

    // At each interior vertex where the incoming and outgoing edges fall into
    // different glyph classes (e.g. a "-" side meeting a "|" side), draw a "+"
    // corner instead of letting one edge's glyph silently overwrite the
    // other's at that cell. Ordered before `edges` so the render loop's
    // first-write-wins rule lets these corners take priority.
    const corners: RasterCell[] = [];
    for (let i = 0; i < edgeCount; i++) {
        const prevEdge = (i - 1 + edgeCount) % edgeCount;
        if (!closed && i === 0) continue;
        const prevChar = glyphForOnScreenAngle(edgeAngles[prevEdge]);
        const nextChar = glyphForOnScreenAngle(edgeAngles[i]);
        if (prevChar === nextChar) continue;
        const v = rotated[i];
        corners.push({ col: Math.round(v.rx), row: Math.round(v.ry), char: "+" });
    }

    return [...corners, ...edges];
}

// Classic Bresenham line algorithm: yields every grid cell from (x0,y0) to
// (x1,y1) inclusive, with no gaps or repeats regardless of slope.
function bresenhamLine(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
    const points: Array<[number, number]> = [];
    let x = x0;
    let y = y0;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (; ;) {
        points.push([x, y]);
        if (x === x1 && y === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
            err += dy;
            x += sx;
        }
        if (e2 <= dx) {
            err += dx;
            y += sy;
        }
    }
    return points;
}

// Rotates a sprite cell's offset by `rotation`, correcting for the grid's
// non-square cells (see CELL_ASPECT). dy is in row units, taller than dx's
// column units, so it's scaled up to the same physical units as dx before
// rotating, then the rotated result is scaled back down to row units.
export function rotateOffset(dx: number, dy: number, cos: number, sin: number): { rx: number; ry: number } {
    const dyPhysical = dy * CELL_ASPECT;
    const rx = dx * cos - dyPhysical * sin;
    const ryPhysical = dx * sin + dyPhysical * cos;
    return { rx, ry: ryPhysical / CELL_ASPECT };
}

export class Compositor {
    readonly width: number;
    readonly height: number;
    // World-space x subtracted from each object's x before placing it on the
    // grid, allowing the visible window to pan across an unbounded world
    // without moving any DOM elements.
    viewOffsetX = 0;
    private objects = new Map<string, SceneObject>();
    private spans: HTMLElement[][] | null = null;
    private prevGrid: (string | null)[][] | null = null;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
    }

    // Builds the DOM grid of <span> elements inside `container`, one per cell.
    mount(container: HTMLElement): void {
        container.innerHTML = "";
        const spans: HTMLElement[][] = [];
        const prevGrid: (string | null)[][] = [];
        for (let row = 0; row < this.height; row++) {
            const spanRow: HTMLElement[] = [];
            const prevRow: (string | null)[] = [];
            for (let col = 0; col < this.width; col++) {
                const span = document.createElement("span");
                span.className = "ascii-cell";
                span.style.gridRow = String(row + 1);
                span.style.gridColumn = String(col + 1);
                span.textContent = " ";
                container.appendChild(span);
                spanRow.push(span);
                prevRow.push(null);
            }
            spans.push(spanRow);
            prevGrid.push(prevRow);
        }
        this.spans = spans;
        this.prevGrid = prevGrid;
    }

    setObject(obj: SceneObject): void {
        this.objects.set(obj.id, obj);
    }

    getObject(id: string): SceneObject | undefined {
        return this.objects.get(id);
    }

    // The mounted <span> for a given grid cell, or null if out of bounds or
    // not yet mounted.
    getCellElement(row: number, col: number): HTMLElement | null {
        if (!this.spans || row < 0 || row >= this.height || col < 0 || col >= this.width) return null;
        return this.spans[row][col];
    }

    removeObject(id: string): void {
        this.objects.delete(id);
    }

    // Composites all visible objects onto the grid, then writes only the
    // cells whose resulting character changed since the last render.
    render(): void {
        if (!this.spans || !this.prevGrid) return;

        const grid: (GridCell | null)[][] = [];
        for (let row = 0; row < this.height; row++) {
            grid.push(new Array(this.width).fill(null));
        }

        const ordered = Array.from(this.objects.values())
            .filter((obj) => obj.visible)
            .sort((a, b) => a.z - b.z);

        for (const obj of ordered) {
            if (Number.isNaN(obj.x) || Number.isNaN(obj.y) || Number.isNaN(obj.rotation)) {
                throw new Error(`NaN layout for object "${obj.id}": x=${obj.x} y=${obj.y} rotation=${obj.rotation}`);
            }
            const cos = Math.cos(obj.rotation);
            const sin = Math.sin(obj.rotation);
            const [pivotX, pivotY] = obj.sprite.pivot ?? [0, 0];
            for (const cell of obj.sprite.cells) {
                if (cell.alpha <= 0) continue;
                // Rotate the cell's offset (relative to the pivot) in continuous
                // space, then translate by the pivot and the object's position
                // (which is the pivot's world position), then snap to the grid.
                const { rx, ry } = rotateOffset(cell.dx - pivotX, cell.dy - pivotY, cos, sin);
                const col = Math.round(obj.x - this.viewOffsetX + pivotX + rx);
                const row = Math.round(obj.y + pivotY + ry);
                if (row < 0 || row >= this.height || col < 0 || col >= this.width) continue;

                const resolver = GLYPH_RESOLVERS.get(cell.role) ?? staticGlyph("?");
                const char = resolver(obj.rotation, cell);

                const existing = grid[row][col];
                if (existing && existing.z > obj.z) continue;
                if (existing && existing.z === obj.z && existing.alpha >= cell.alpha) continue;
                grid[row][col] = { char, alpha: cell.alpha, z: obj.z };
            }

            if (obj.sprite.polygon) {
                for (const { col: localCol, row: localRow, char } of rasterizePolygon(obj.sprite.polygon, obj.rotation, obj.sprite.polygonClosed ?? true, obj.sprite.pivot)) {
                    const col = Math.round(obj.x - this.viewOffsetX + pivotX) + localCol;
                    const row = Math.round(obj.y + pivotY) + localRow;
                    if (row < 0 || row >= this.height || col < 0 || col >= this.width) continue;

                    const existing = grid[row][col];
                    if (existing && existing.z > obj.z) continue;
                    if (existing && existing.z === obj.z && existing.alpha >= 1) continue;
                    grid[row][col] = { char, alpha: 1, z: obj.z };
                }
            }
        }

        for (let row = 0; row < this.height; row++) {
            for (let col = 0; col < this.width; col++) {
                const cell = grid[row][col];
                const char = cell ? cell.char : " ";
                if (this.prevGrid[row][col] !== char) {
                    this.spans[row][col].textContent = char;
                    this.prevGrid[row][col] = char;
                }
            }
        }

    }
}

// A member of a PropGroup: an independently-rendered SceneObject plus its
// offset from the group's origin (in the group's unrotated local frame).
// While attached, the member's x/y/rotation track `origin` + this offset;
// once `released`, the group no longer touches it, so callers can animate it
// independently (e.g. a seed peeling off to fall into a glass).
export interface PropGroupMember {
    obj: SceneObject;
    relX: number;
    relY: number;
    // Offset from the group's z, preserving each member's stacking order
    // (e.g. a blade drawn in front of the body it sits in).
    relZ: number;
    released: boolean;
}

export interface PropGroupMemberSpec {
    sprite: Sprite;
    relX: number;
    relY: number;
    relZ?: number;
}

// A cluster of independently-rendered SceneObjects (e.g. a grinder body, its
// blade, and a handful of seeds) that normally move together as a rigid
// group via a shared origin, but can have members animated or released
// individually for effects like jitter, glyph changes, or peeling off to
// move on their own. Members can also be moved between groups (e.g. a seed
// flying from a "pile" group into a "grinder" group) via `adopt`.
export class PropGroup {
    x = 0;
    y = 0;
    z = 0;
    rotation = 0;
    members: PropGroupMember[];
    private compositor: Compositor;
    private nextMemberIndex: number;
    // Point (relX/relY units, in the group's unrotated frame) that rotation
    // pivots around, matching the prop it tracks (e.g. the glass's
    // GLASS_PIVOT) so members rotate around the same on-screen point as the
    // prop itself rather than around the prop's origin. Defaults to [0, 0].
    private pivot: [number, number];

    constructor(
        compositor: Compositor,
        private idPrefix: string,
        members: PropGroupMemberSpec[],
        origin: { x: number; y: number; z: number; rotation?: number },
        pivot: [number, number] = [0, 0],
    ) {
        this.pivot = pivot;
        this.compositor = compositor;
        this.x = origin.x;
        this.y = origin.y;
        this.z = origin.z;
        this.rotation = origin.rotation ?? 0;
        this.nextMemberIndex = members.length;
        this.members = members.map(({ sprite, relX, relY, relZ }, i) => {
            const obj: SceneObject = {
                id: `${idPrefix}-${i}`,
                sprite: { cells: sprite.cells.map((c) => ({ ...c })), polygon: sprite.polygon },
                x: 0,
                y: 0,
                z: this.z,
                rotation: this.rotation,
                visible: true,
            };
            compositor.setObject(obj);
            return { obj, relX, relY, relZ: relZ ?? 0, released: false };
        });
        this.applyOrigin();
    }

    // Adds a new member to the group at the given relative offset, registering
    // its SceneObject with the compositor and immediately positioning it
    // relative to the group's current origin.
    addMember(spec: PropGroupMemberSpec): PropGroupMember {
        const obj: SceneObject = {
            id: `${this.idPrefix}-${this.nextMemberIndex++}`,
            sprite: { cells: spec.sprite.cells.map((c) => ({ ...c })), polygon: spec.sprite.polygon },
            x: 0,
            y: 0,
            z: this.z,
            rotation: this.rotation,
            visible: true,
        };
        this.compositor.setObject(obj);
        const member: PropGroupMember = { obj, relX: spec.relX, relY: spec.relY, relZ: spec.relZ ?? 0, released: false };
        this.members.push(member);
        this.applyOrigin();
        return member;
    }

    // Repositions all attached members relative to the new origin. Released
    // members are left untouched.
    setOrigin(x: number, y: number, z?: number, rotation?: number): void {
        this.x = x;
        this.y = y;
        if (z !== undefined) this.z = z;
        if (rotation !== undefined) this.rotation = rotation;
        this.applyOrigin();
    }

    applyOrigin(): void {
        const cos = Math.cos(this.rotation);
        const sin = Math.sin(this.rotation);
        const [pivotX, pivotY] = this.pivot;
        for (const member of this.members) {
            if (member.released) continue;
            const relX = member.relX - pivotX;
            const relY = member.relY - pivotY;
            member.obj.x = this.x + pivotX + relX * cos - relY * sin;
            member.obj.y = this.y + pivotY + relX * sin + relY * cos;
            member.obj.z = this.z + member.relZ;
            member.obj.rotation = this.rotation;
        }
    }

    // Detaches `member` from the group's shared transform so it can be
    // animated independently (e.g. falling into a glass). Its current
    // x/y/z/rotation are left as-is as the starting point for that animation.
    release(member: PropGroupMember): void {
        member.released = true;
    }

    // Moves `member` from this group into `target`, with new offsets relative
    // to `target`'s origin. The underlying SceneObject is re-registered with
    // the compositor under a new id reflecting its new group.
    transferTo(member: PropGroupMember, target: PropGroup, relX: number, relY: number, relZ = 0): void {
        const idx = this.members.indexOf(member);
        if (idx !== -1) this.members.splice(idx, 1);
        this.compositor.removeObject(member.obj.id);
        member.relX = relX;
        member.relY = relY;
        member.relZ = relZ;
        member.released = false;
        member.obj.id = `${target.idPrefix}-${target.nextMemberIndex++}`;
        this.compositor.setObject(member.obj);
        target.members.push(member);
    }

    // Removes every member's SceneObject from the compositor.
    destroy(): void {
        for (const member of this.members) {
            this.compositor.removeObject(member.obj.id);
        }
    }
}
