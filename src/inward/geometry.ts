export interface Vertex {
    name: "self" | "blended" | "unblended";
    emoji: string;
    label: string;
    x: number;
    y: number;
}

// A weighted point contribution toward the region's target centroid, plus how much it
// should narrow (vs. diffuse) the boundary's shrink-wrap and radius. Region-placement
// code (computeTargetCentroid/computeTargetShrinkWrap/computeRadius) only ever consumes
// a flat list of these — it has no knowledge of drugs, parts, or any other source.
export interface RegionPressure {
    x: number;
    y: number;
    weight: number;
    // 0 (pull spread evenly across all three vertices) .. 1 (pull concentrated on one).
    narrowness: number;
}

export const W = 480;
export const H = 420;
export const CX = W / 2;

export const VERTICES: Vertex[] = [
    { name: "self", emoji: "1️⃣", label: "Self", x: CX, y: 60 },
    { name: "blended", emoji: "2️⃣", label: "blended", x: 90, y: 360 },
    { name: "unblended", emoji: "3️⃣", label: "unblended", x: W - 90, y: 360 },
];

export const VERTEX_BY_NAME = Object.fromEntries(VERTICES.map((v) => [v.name, v])) as Record<
    Vertex["name"],
    Vertex
>;

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

// Logistic sigmoid centered at `midpoint` with `steepness` controlling how sharp the
// transition is. Used to turn a linear 0..1 latent into a "not much happens, then a
// transition, then near-max" response curve.
export function sigmoid(x: number, midpoint: number, steepness: number): number {
    return 1 / (1 + Math.exp(-steepness * (x - midpoint)));
}

// Parts live in the lower half of the triangle, from the vertical midpoint down to the
// blended/unblended corners, and can drift horizontally all the way out to those corners.
// The two axes can't be clamped independently: at a given height the triangle's left/right
// edges (self-blended, self-unblended) are narrower than the full corner-to-corner width,
// so clamping x and y separately let points escape the triangle up near its slanted edges.
export function clampPartPosition(x: number, y: number): { x: number; y: number } {
    const midY = (VERTEX_BY_NAME.self.y + VERTEX_BY_NAME.blended.y) / 2;
    const bottomY = VERTEX_BY_NAME.blended.y;
    const clampedY = Math.min(bottomY, Math.max(midY, y));

    // At clampedY, interpolate how far the self-blended and self-unblended edges
    // have widened from a point at Self out to the full corners at the bottom.
    const t = (clampedY - VERTEX_BY_NAME.self.y) / (bottomY - VERTEX_BY_NAME.self.y);
    const leftX = lerp(VERTEX_BY_NAME.self.x, VERTEX_BY_NAME.blended.x, t);
    const rightX = lerp(VERTEX_BY_NAME.self.x, VERTEX_BY_NAME.unblended.x, t);

    return { x: Math.min(rightX, Math.max(leftX, x)), y: clampedY };
}

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
    return document.createElementNS("http://www.w3.org/2000/svg", tag);
}
