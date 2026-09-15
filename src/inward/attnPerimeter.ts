import { VERTEX_BY_NAME, lerp } from "./geometry";
import type { Part } from "./part";

// Converts the normalized [0,1] blending-force scale (blendUrgency, selfPushFactor)
// to actual velocity units, preserving prior motion scale (was 10-14 unnormalized).
export const BLEND_FORCE_SCALE = 12;

export interface Circle {
    x: number;
    y: number;
    r: number;
}

const PART_CIRCLE_RADIUS = 15.6; // half of .ipe-part's 26px font-size, +20% so tight shrinkWrap doesn't clip the glyph
const SELF_CIRCLE_MIN_RADIUS = 24;
const SELF_CIRCLE_MAX_RADIUS = SELF_CIRCLE_MIN_RADIUS * 2;

// Part emoji are drawn as SVG <text> with y as the baseline, not the glyph's visual center;
// every circle built from a part's (x, y) must shift up by this much to center on the glyph
// instead of its baseline, or the perimeter reads as offset below the emoji it's wrapping.
export const EMOJI_VERTICAL_CENTER_OFFSET = 9;

export function selfCircleRadius(selfEnergy: number): number {
    return lerp(SELF_CIRCLE_MIN_RADIUS, SELF_CIRCLE_MAX_RADIUS, selfEnergy);
}

// One circle for Self (radius grows with ambient Self energy) plus one fixed-radius
// circle per drifting part. The attention perimeter wraps around all of them.
//
// When focusedParts is non-empty ("Private reverie" - N,N-DMT's high-blend-pressure focus
// lock, see InwardPerspectiveExplorer.updateFocusLock), Self is excluded entirely and the
// perimeter wraps only those parts, so circles[0] is not guaranteed to be Self - callers
// needing the Self circle specifically (buildConnectorCapsules's star hub) must check for
// focus mode first via buildFocusCapsules instead.
export function buildCircles(selfEnergy: number, parts: Part[], focusedParts: Part[] = []): Circle[] {
    if (focusedParts.length > 0) {
        return focusedParts.map((p) => ({ x: p.x, y: p.y - EMOJI_VERTICAL_CENTER_OFFSET, r: PART_CIRCLE_RADIUS * p.opacity }));
    }
    const circles: Circle[] = [{ x: VERTEX_BY_NAME.self.x, y: VERTEX_BY_NAME.self.y, r: selfCircleRadius(selfEnergy) }];
    for (const p of parts) {
        // Scaled by opacity so a fading-in/out part's circle ramps in/out smoothly
        // instead of popping to full size.
        circles.push({ x: p.x, y: p.y - EMOJI_VERTICAL_CENTER_OFFSET, r: PART_CIRCLE_RADIUS * p.opacity });
    }
    return circles;
}

// Baseline with no drug pushing on it: higher when Self energy is low (a depleted Self
// lets the boundary go loose/soft) and 0 once Self energy is maxed (nothing left to widen
// it). N,N-DMT's blendPressure (0-1+ scale, see InwardPerspectiveExplorer.blendPressure)
// then adds on top linearly, clamped to 1 - the same pressure that drives the "Private
// reverie" single-part focus lock also tightens the perimeter's shrink-wrap in the
// ordinary (non-focus-locked) case.
const BASELINE_TARGET_SHRINK_WRAP_MAX = 0.3;

// extraShrinkWrapEffect sums every other drug's direct shrinkWrap contribution - THH's
// dose-gated sigmoid effect plus any drug's linear shrinkWrapBoostMax (cannabis).
export function computeTargetShrinkWrap(selfEnergy: number, blendPressure: number, extraShrinkWrapEffect: number = 0): number {
    const baseline = BASELINE_TARGET_SHRINK_WRAP_MAX * (1 - selfEnergy);
    return Math.min(1, baseline + 0.5 * blendPressure + extraShrinkWrapEffect);
}

// --- Connectivity: explicit capsule corridors -------------------------------
//
// Relying on the field alone to stay connected at any distance means either an
// arbitrarily thin (eventually invisible) neck, or a background bias strong enough to
// distort the shape everywhere just to bridge one far-away part. Instead, every part is
// explicitly connected to Self (a star topology, guaranteeing connectivity regardless of
// how far a part drifts), plus each part optionally carries one extra link to another
// part rolled once at spawn time (Part.extraLinkTo) - occasional part-to-part corridors
// on top of the guaranteed star. Each edge gets its own capsule-shaped field
// contribution, its width following shrinkWrap the same way the isoline threshold does:
// loose (0) gives a fat, generous neck, tight (1) narrows it toward a thin thread.
export interface Capsule {
    ax: number;
    ay: number;
    bx: number;
    by: number;
    r: number;
}

const CONNECTOR_RADIUS_LOOSE = 10;
const CONNECTOR_RADIUS_TIGHT = 3;

export function connectorRadiusFor(shrinkWrap: number): number {
    return lerp(CONNECTOR_RADIUS_LOOSE, CONNECTOR_RADIUS_TIGHT, shrinkWrap);
}

export function buildConnectorCapsules(selfCircle: Circle, parts: Part[], shrinkWrap: number): Capsule[] {
    const r = connectorRadiusFor(shrinkWrap);
    const capsules: Capsule[] = [];
    for (const p of parts) {
        capsules.push({ ax: selfCircle.x, ay: selfCircle.y, bx: p.x, by: p.y - EMOJI_VERTICAL_CENTER_OFFSET, r });
        if (p.extraLinkTo) {
            capsules.push({
                ax: p.x,
                ay: p.y - EMOJI_VERTICAL_CENTER_OFFSET,
                bx: p.extraLinkTo.x,
                by: p.extraLinkTo.y - EMOJI_VERTICAL_CENTER_OFFSET,
                r,
            });
        }
    }
    return capsules;
}

// "Private reverie" capsules: no Self hub to fan out from, so connect focused parts along
// their actual extraLinkTo edges (treated as undirected - see
// InwardPerspectiveExplorer.linkedGroup) rather than a star from the first part, since the
// group can be a transitive chain (A links to B, B links to C) where A and C aren't
// directly connected.
export function buildFocusCapsules(focusedParts: Part[], shrinkWrap: number): Capsule[] {
    const r = connectorRadiusFor(shrinkWrap);
    const capsules: Capsule[] = [];
    const group = new Set(focusedParts);
    for (const p of focusedParts) {
        if (p.extraLinkTo && group.has(p.extraLinkTo)) {
            capsules.push({
                ax: p.x,
                ay: p.y - EMOJI_VERTICAL_CENTER_OFFSET,
                bx: p.extraLinkTo.x,
                by: p.extraLinkTo.y - EMOJI_VERTICAL_CENTER_OFFSET,
                r,
            });
        }
    }
    return capsules;
}

// --- Metaball field --------------------------------------------------------
//
// Each circle contributes an inverse-square influence field that is 1 at its own edge
// and falls toward 0 with distance. Each MST connector capsule contributes the same
// falloff from the nearest point on its segment, guaranteeing the field clears
// `threshold` in a corridor of width ~CONNECTOR_RADIUS between every circle and its
// nearest neighbor, regardless of distance. The perimeter is the isoline where the
// summed field crosses `threshold`. Loose shrink-wrap lowers the threshold, producing
// one big soft oval well outside the circles' true edges. Tight shrink-wrap raises the
// threshold toward each circle's own edge value, so the perimeter hugs the circles and
// pinches down to just the connector corridors across gaps - never splitting into
// separate blobs, because BACKGROUND_FIELD keeps the field everywhere strictly positive.
const BACKGROUND_FIELD = 0.02;

function nearestPointOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): { x: number; y: number } {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return { x: ax, y: ay };
    const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    return { x: ax + t * dx, y: ay + t * dy };
}

export function fieldAt(x: number, y: number, circles: Circle[], capsules: Capsule[] = []): number {
    let sum = BACKGROUND_FIELD;
    for (const c of circles) {
        const dx = x - c.x;
        const dy = y - c.y;
        const d2 = dx * dx + dy * dy;
        sum += (c.r * c.r) / Math.max(d2, 1);
    }
    for (const cap of capsules) {
        const nearest = nearestPointOnSegment(x, y, cap.ax, cap.ay, cap.bx, cap.by);
        const dx = x - nearest.x;
        const dy = y - nearest.y;
        const d2 = dx * dx + dy * dy;
        sum += (cap.r * cap.r) / Math.max(d2, 1);
    }
    return sum;
}

// Loose: threshold well below 1, so the isoline sits far outside every circle's edge
// (soft padded oval). Tight: threshold high enough that the isoline hugs each circle
// closely, but capped at 0.78 rather than approaching 1 - at 1 the isoline sits almost
// exactly at each circle's nominal radius, which (for a part) is smaller than the emoji
// glyph's visual size, so the dashed ring reads as clipping through the emoji instead of
// wrapping outside it. 0.78 keeps a ~15% radius margin at the tightest setting.
export function thresholdFor(shrinkWrap: number): number {
    return lerp(0.12, 0.78, shrinkWrap);
}

interface GridPoint {
    x: number;
    y: number;
    inside: boolean;
}

// Marching squares over a uniform grid spanning the circles' (and connector capsules')
// bounding box (plus margin for the loose/padded case), producing an ordered polygon
// approximating the isoline.
export function marchingSquaresContour(circles: Circle[], capsules: Capsule[], threshold: number): { x: number; y: number }[] {
    // The isoline around a lone circle of radius r sits at distance r/sqrt(threshold -
    // BACKGROUND_FIELD) from its center (solving fieldAt's inverse-square term for where it
    // crosses threshold) - a fixed margin big enough for a tight threshold clips the isoline
    // at low (loose) thresholds instead, where it sits much farther out, leaving the grid's
    // boundary cutting through the true contour and the marching-squares/greedy-chaining step
    // stitching the resulting fragments into a malformed path. Deriving margin from the actual
    // threshold and the largest circle present keeps the isoline inside the grid at any
    // shrinkWrap setting - but every OTHER circle/capsule also contributes a small amount of
    // field at that distance (fieldAt sums them all), so with many circles present (e.g. 7+
    // parts) their combined leftover pushes the true isoline slightly farther out than the
    // single-largest-circle estimate accounts for, clipping the tip and leaving the
    // marching-squares walk to stitch a small spurious loop out of the severed fragment
    // instead of the one true contour. Approximating every other circle's contribution at its
    // own edge value (its maximum possible, since fieldAt only decreases with distance) as an
    // inflated effective background corrects for this without having to solve the summed
    // field exactly.
    const maxRadius = Math.max(0, ...circles.map((c) => c.r), ...capsules.map((c) => c.r));
    const maxCircle = circles.reduce((best, c) => (c.r > best.r ? c : best), circles[0] ?? { x: 0, y: 0, r: 0 });
    const naiveFieldAboveBackground = Math.max(0.005, threshold - BACKGROUND_FIELD);
    const naiveIsolineDistance = maxRadius / Math.sqrt(naiveFieldAboveBackground);
    // Every other circle also contributes field at the largest circle's isoline tip -
    // approximated here (a safe upper bound, since fieldAt only decreases with distance) by
    // evaluating each other circle at that same distance from its own center, then folding
    // that combined leftover into the effective background before re-solving for the margin.
    // Without this, many circles' small individual contributions stack up beyond what any
    // single circle's isolated isoline estimate accounts for, clipping the true contour's tip
    // at the grid boundary and leaving the marching-squares walk to stitch a small spurious
    // loop out of the severed fragment instead of tracing the one true contour (see the
    // ?debug=1 7+-part disappearing/glitchy perimeter this was fixed for).
    const othersFieldAtTip = circles
        .filter((c) => c !== maxCircle)
        .reduce((sum, c) => sum + (c.r * c.r) / Math.max(naiveIsolineDistance * naiveIsolineDistance, 1), 0);
    const effectiveBackground = BACKGROUND_FIELD + othersFieldAtTip;
    const fieldAboveBackground = Math.max(0.005, threshold - effectiveBackground);
    const isolineDistance = maxRadius / Math.sqrt(fieldAboveBackground);
    const margin = Math.max(60, isolineDistance - maxRadius + 20);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of circles) {
        minX = Math.min(minX, c.x - c.r);
        minY = Math.min(minY, c.y - c.r);
        maxX = Math.max(maxX, c.x + c.r);
        maxY = Math.max(maxY, c.y + c.r);
    }
    for (const cap of capsules) {
        minX = Math.min(minX, cap.ax - cap.r, cap.bx - cap.r);
        minY = Math.min(minY, cap.ay - cap.r, cap.by - cap.r);
        maxX = Math.max(maxX, cap.ax + cap.r, cap.bx + cap.r);
        maxY = Math.max(maxY, cap.ay + cap.r, cap.by + cap.r);
    }
    minX -= margin; minY -= margin; maxX += margin; maxY += margin;

    // A far-flung part stretches the bounding box a lot; scale sample density with the
    // box size (capped) so the corridor connecting it stays resolvable by the grid instead
    // of being thinner than one cell and slipping through undetected. A thin connector
    // (tight shrinkWrap, CONNECTOR_RADIUS_TIGHT=3) between two widely-spaced circles is the
    // narrowest thing the grid ever needs to resolve - size cells off the smaller of the
    // span-based estimate and the thinnest capsule present, not span alone, or the corridor
    // can be narrower than a cell and the marching-squares/greedy-chaining step mis-stitches
    // the two circles' isolines into one malformed loop instead of a proper closed contour
    // wrapping both.
    const minCapsuleRadius = capsules.length > 0 ? Math.min(...capsules.map((c) => c.r)) : Infinity;
    const targetCellSize = Math.min(12, minCapsuleRadius / 2.5);
    const spanX = maxX - minX, spanY = maxY - minY;
    const cols = Math.min(220, Math.max(48, Math.round(spanX / targetCellSize)));
    const rows = Math.min(200, Math.max(42, Math.round(spanY / targetCellSize)));
    const cellW = spanX / cols;
    const cellH = spanY / rows;

    const grid: GridPoint[][] = [];
    for (let j = 0; j <= rows; j++) {
        const row: GridPoint[] = [];
        for (let i = 0; i <= cols; i++) {
            const x = minX + i * cellW;
            const y = minY + j * cellH;
            row.push({ x, y, inside: fieldAt(x, y, circles, capsules) >= threshold });
        }
        grid.push(row);
    }

    // Collect one line segment per ambiguous cell edge crossing, via the standard 16-case
    // marching-squares lookup (case index from the 4 corners' inside/outside state).
    function interp(pA: GridPoint, pB: GridPoint): { x: number; y: number } {
        const fA = fieldAt(pA.x, pA.y, circles, capsules);
        const fB = fieldAt(pB.x, pB.y, circles, capsules);
        const t = fB === fA ? 0.5 : (threshold - fA) / (fB - fA);
        const ct = Math.min(1, Math.max(0, t));
        return { x: lerp(pA.x, pB.x, ct), y: lerp(pA.y, pB.y, ct) };
    }

    // Each endpoint is tagged with the grid edge it was interpolated on ("h:i,j" for the
    // horizontal edge between column i/i+1 at row j, "v:i,j" for the vertical edge between
    // row j/j+1 at column i) so segments from neighboring cells that share a crossing point
    // carry an identical key, letting the walk below chain them by exact edge identity
    // instead of nearest-distance search.
    interface TaggedPoint {
        x: number;
        y: number;
        edgeKey: string;
    }
    const segments: [TaggedPoint, TaggedPoint][] = [];
    for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
            const tl = grid[j][i], tr = grid[j][i + 1], br = grid[j + 1][i + 1], bl = grid[j + 1][i];
            const idx = (tl.inside ? 8 : 0) | (tr.inside ? 4 : 0) | (br.inside ? 2 : 0) | (bl.inside ? 1 : 0);
            if (idx === 0 || idx === 15) continue;

            const top = (): TaggedPoint => ({ ...interp(tl, tr), edgeKey: `h:${i},${j}` });
            const right = (): TaggedPoint => ({ ...interp(tr, br), edgeKey: `v:${i + 1},${j}` });
            const bottom = (): TaggedPoint => ({ ...interp(bl, br), edgeKey: `h:${i},${j + 1}` });
            const left = (): TaggedPoint => ({ ...interp(tl, bl), edgeKey: `v:${i},${j}` });

            // Each case lists edge-to-edge segments walking with "inside" on the left,
            // so segments chain head-to-tail consistently around the contour.
            switch (idx) {
                case 1: segments.push([left(), bottom()]); break;
                case 2: segments.push([bottom(), right()]); break;
                case 3: segments.push([left(), right()]); break;
                case 4: segments.push([top(), right()]); break;
                case 5: segments.push([top(), bottom()]); segments.push([left(), bottom()]); break; // ambiguous, split
                case 6: segments.push([top(), bottom()]); break;
                case 7: segments.push([top(), left()]); break;
                case 8: segments.push([top(), left()]); break;
                case 9: segments.push([top(), bottom()]); break;
                case 10: segments.push([top(), right()]); segments.push([left(), bottom()]); break; // ambiguous, split
                case 11: segments.push([top(), right()]); break;
                case 12: segments.push([left(), right()]); break;
                case 13: segments.push([bottom(), right()]); break;
                case 14: segments.push([left(), bottom()]); break;
            }
        }
    }

    if (segments.length === 0) return [];

    // Chain segments into a single closed loop. Primary match is exact edgeKey identity
    // (the true adjacency guaranteed by marching squares - two segments from neighboring
    // cells that cross the same grid edge always interpolate to the same point). Nearest-
    // distance matching is only a fallback for the rare case with no exact match (e.g. a
    // case-5/10 saddle split ambiguity resolved differently by the two involved cells).
    // Falling back to nearest-distance as the *primary* strategy (as this used to) lets the
    // walk jump onto a closer-but-unrelated segment in a dense/branchy region (many
    // overlapping circles), prematurely closing a small spurious loop instead of tracing the
    // one true contour around every circle - see the "?debug=1" 7+-part disappearing/glitchy
    // perimeter this was fixed for.
    const edgeKeyToSegments = new Map<string, number[]>();
    segments.forEach(([a, b], k) => {
        for (const key of [a.edgeKey, b.edgeKey]) {
            const list = edgeKeyToSegments.get(key);
            if (list) list.push(k);
            else edgeKeyToSegments.set(key, [k]);
        }
    });

    const used = new Array(segments.length).fill(false);
    const loop: { x: number; y: number }[] = [];
    let current: TaggedPoint = segments[0][0];
    loop.push(current);
    used[0] = true;
    let next: TaggedPoint = segments[0][1];
    loop.push(next);
    current = next;

    const snapDist = Math.max(cellW, cellH) * 1.5;
    for (let iter = 0; iter < segments.length * 2; iter++) {
        // Exact edge-identity match first.
        let foundIdx = -1;
        let foundEnd: TaggedPoint | null = null;
        for (const k of edgeKeyToSegments.get(current.edgeKey) ?? []) {
            if (used[k]) continue;
            const [a, b] = segments[k];
            foundIdx = k;
            foundEnd = a.edgeKey === current.edgeKey ? b : a;
            break;
        }
        // Fallback: nearest unused endpoint within snapDist.
        if (foundIdx === -1) {
            let bestDist = Infinity;
            for (let k = 0; k < segments.length; k++) {
                if (used[k]) continue;
                const [a, b] = segments[k];
                const dA = Math.hypot(a.x - current.x, a.y - current.y);
                const dB = Math.hypot(b.x - current.x, b.y - current.y);
                if (dA < bestDist) { bestDist = dA; foundIdx = k; foundEnd = b; }
                if (dB < bestDist) { bestDist = dB; foundIdx = k; foundEnd = a; }
            }
            if (foundIdx === -1 || bestDist > snapDist) break;
        }
        used[foundIdx] = true;
        loop.push(foundEnd!);
        current = foundEnd!;
    }

    return loop;
}

// Resamples a polygon to N evenly-spaced-by-arclength points, so the wobble sine terms
// (indexed by angle-like parameter i/N) apply smoothly regardless of the source
// marching-squares polygon's uneven point density.
function resampleClosed(poly: { x: number; y: number }[], n: number): { x: number; y: number }[] {
    if (poly.length < 3) return poly;
    const closed = [...poly, poly[0]];
    const cum: number[] = [0];
    for (let i = 1; i < closed.length; i++) {
        cum.push(cum[i - 1] + Math.hypot(closed[i].x - closed[i - 1].x, closed[i].y - closed[i - 1].y));
    }
    const total = cum[cum.length - 1];
    if (total === 0) return poly;

    const out: { x: number; y: number }[] = [];
    for (let k = 0; k < n; k++) {
        const target = (k / n) * total;
        let i = 1;
        while (i < cum.length && cum[i] < target) i++;
        const segStart = cum[i - 1];
        const segLen = cum[i] - segStart || 1;
        const t = (target - segStart) / segLen;
        out.push({
            x: lerp(closed[i - 1].x, closed[i].x, t),
            y: lerp(closed[i - 1].y, closed[i].y, t),
        });
    }
    return out;
}

// At tight shrinkWrap, three-plus mutually-nearby circles' overlapping metaball fields
// still sum above threshold across their whole convex hull's interior (e.g. the middle of
// a Self+2-parts triangle), even though the isoline hugs each circle's own edge closely -
// summing fields doesn't erode a shape the way intersecting/subtracting them would. Rather
// than reshaping the field itself (which would also have to keep every connector corridor
// intact), this pulls each already-extracted contour point inward toward its nearest
// feature (a circle's edge, or a capsule's own radius from its segment) by up to that
// point's "slack" - how far past the nearest feature's true edge it currently sits - scaled
// by erosion strength (0 below EROSION_START_SHRINK_WRAP, ramping to full over the rest of
// the range, so a loose boundary still reads as one soft padded oval rather than pinching in
// early). A point already sitting right on some circle or capsule edge has ~0 slack and
// doesn't move, so the erosion can never pull a point past a feature it's supposed to still
// enclose; only the puffed-out middle, which is slack everywhere, erodes.
const EROSION_MAX = 40;

function nearestFeatureDistance(x: number, y: number, circles: Circle[], capsules: Capsule[]): { dist: number; toX: number; toY: number } {
    let best = Infinity, bestX = x, bestY = y;
    for (const c of circles) {
        const dx = x - c.x, dy = y - c.y;
        const distToCenter = Math.max(Math.hypot(dx, dy), 0.001);
        const d = distToCenter - c.r;
        if (d < best) {
            best = d;
            bestX = c.x + dx * (c.r / distToCenter);
            bestY = c.y + dy * (c.r / distToCenter);
        }
    }
    for (const cap of capsules) {
        const nearest = nearestPointOnSegment(x, y, cap.ax, cap.ay, cap.bx, cap.by);
        const dx = x - nearest.x, dy = y - nearest.y;
        const segDist = Math.hypot(dx, dy) - cap.r;
        if (segDist < best) {
            best = segDist;
            const distToSeg = Math.max(Math.hypot(dx, dy), 0.001);
            bestX = nearest.x + dx * (cap.r / distToSeg);
            bestY = nearest.y + dy * (cap.r / distToSeg);
        }
    }
    return { dist: Math.max(0, best), toX: bestX, toY: bestY };
}

// No erosion below this shrinkWrap - a loose boundary is supposed to look like one soft
// padded oval, not start pinching in early. Above it, erosion strength ramps 0..1 over the
// remaining range instead of starting from shrinkWrap itself.
const EROSION_START_SHRINK_WRAP = 0.5;

function erodeContour(pts: { x: number; y: number }[], circles: Circle[], capsules: Capsule[], shrinkWrap: number): { x: number; y: number }[] {
    const erosionStrength = Math.max(0, (shrinkWrap - EROSION_START_SHRINK_WRAP) / (1 - EROSION_START_SHRINK_WRAP));
    if (erosionStrength <= 0) return pts;
    return pts.map((p) => {
        const { dist, toX, toY } = nearestFeatureDistance(p.x, p.y, circles, capsules);
        const pull = Math.min(dist, EROSION_MAX) * erosionStrength;
        if (pull <= 0 || dist < 0.01) return p;
        const t = pull / dist;
        return { x: lerp(p.x, toX, t), y: lerp(p.y, toY, t) };
    });
}

export function buildAttnPerimeterPath(
    circles: Circle[],
    parts: Part[],
    shrinkWrap: number,
    wobblePhase: number[],
    focusedParts: Part[] = [],
): string {
    const threshold = thresholdFor(shrinkWrap);
    const capsules = focusedParts.length > 0
        ? buildFocusCapsules(focusedParts, shrinkWrap)
        : buildConnectorCapsules(circles[0], parts, shrinkWrap);
    const rawContour = marchingSquaresContour(circles, capsules, threshold);
    if (rawContour.length < 3) return "";

    const N = 48;
    const resampled = resampleClosed(rawContour, N);
    const pts = erodeContour(resampled, circles, capsules, shrinkWrap);

    // A loose boundary has slack and wobbles more; a shrink-wrapped one is taut and crisp.
    const wobbleScale = lerp(1, 0.35, shrinkWrap);
    const wobbled = pts.map((p, i) => {
        const a = (i / N) * Math.PI * 2;
        const wobble =
            wobbleScale *
            (2.5 * Math.sin(a * 3 + wobblePhase[0]) +
                1.8 * Math.sin(a * 5 - wobblePhase[1]) +
                1.2 * Math.sin(a * 2 + wobblePhase[2]));
        // Perturb outward along the local normal (approximated via the vector from the
        // circles' centroid, close enough for a small cosmetic wobble).
        const cx = circles.reduce((s, c) => s + c.x, 0) / circles.length;
        const cy = circles.reduce((s, c) => s + c.y, 0) / circles.length;
        const dx = p.x - cx, dy = p.y - cy;
        const d = Math.hypot(dx, dy) || 1;
        return { x: p.x + (dx / d) * wobble, y: p.y + (dy / d) * wobble };
    });

    let d = `M ${wobbled[0].x.toFixed(1)} ${wobbled[0].y.toFixed(1)}`;
    for (let i = 0; i < N; i++) {
        const p0 = wobbled[(i - 1 + N) % N];
        const p1 = wobbled[i];
        const p2 = wobbled[(i + 1) % N];
        const p3 = wobbled[(i + 2) % N];
        const cp1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
        const cp2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
        d += ` C ${cp1.x.toFixed(1)} ${cp1.y.toFixed(1)} ${cp2.x.toFixed(1)} ${cp2.y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d + " Z";
}
