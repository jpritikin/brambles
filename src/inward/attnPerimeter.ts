import { VERTEX_BY_NAME, lerp } from "./geometry";
import type { Part } from "./part";

// Converts the normalized [0,1] blending-force scale (blendPropensity, selfPushFactor)
// to actual velocity units, preserving prior motion scale (was 10-14 unnormalized).
export const BLEND_FORCE_SCALE = 12;

export interface Circle {
    x: number;
    y: number;
    r: number;
}

const PART_CIRCLE_RADIUS = 13; // half of .ipe-part's 26px font-size
const SELF_CIRCLE_MIN_RADIUS = 24;
const SELF_CIRCLE_MAX_RADIUS = SELF_CIRCLE_MIN_RADIUS * 2;

export function selfCircleRadius(selfEnergy: number): number {
    return lerp(SELF_CIRCLE_MIN_RADIUS, SELF_CIRCLE_MAX_RADIUS, selfEnergy);
}

// One circle for Self (radius grows with ambient Self energy) plus one fixed-radius
// circle per drifting part. The attention perimeter wraps around all of them.
export function buildCircles(selfEnergy: number, parts: Part[]): Circle[] {
    const circles: Circle[] = [{ x: VERTEX_BY_NAME.self.x, y: VERTEX_BY_NAME.self.y, r: selfCircleRadius(selfEnergy) }];
    for (const p of parts) {
        // Scaled by opacity so a fading-in/out part's circle ramps in/out smoothly
        // instead of popping to full size.
        circles.push({ x: p.x, y: p.y, r: PART_CIRCLE_RADIUS * p.opacity });
    }
    return circles;
}

// Fixed for now; drug effects will drive this later (see docs/inward-primer.txt).
const FIXED_TARGET_SHRINK_WRAP = 0.3;

export function computeTargetShrinkWrap(): number {
    return FIXED_TARGET_SHRINK_WRAP;
}

// A rough "how big/diffuse does this feel" scalar for the readout text, derived from
// the circles' bounding extent rather than a single radius (there's no one radius
// anymore now that the perimeter wraps a variable number of circles).
export function approximateExtentRadius(circles: Circle[]): number {
    if (circles.length === 0) return 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of circles) {
        minX = Math.min(minX, c.x - c.r);
        minY = Math.min(minY, c.y - c.r);
        maxX = Math.max(maxX, c.x + c.r);
        maxY = Math.max(maxY, c.y + c.r);
    }
    return Math.max(maxX - minX, maxY - minY) / 2;
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
        capsules.push({ ax: selfCircle.x, ay: selfCircle.y, bx: p.x, by: p.y, r });
        if (p.extraLinkTo) {
            capsules.push({ ax: p.x, ay: p.y, bx: p.extraLinkTo.x, by: p.extraLinkTo.y, r });
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
// (soft padded oval). Tight: threshold approaches 1, the circles' own edge value.
export function thresholdFor(shrinkWrap: number): number {
    return lerp(0.12, 0.92, shrinkWrap);
}

interface GridPoint {
    x: number;
    y: number;
    inside: boolean;
}

// Marching squares over a uniform grid spanning the circles' (and connector capsules')
// bounding box (plus margin for the loose/padded case), producing an ordered polygon
// approximating the isoline.
function marchingSquaresContour(circles: Circle[], capsules: Capsule[], threshold: number): { x: number; y: number }[] {
    const margin = 60;
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
    // box size (capped) so the corridor connecting it stays resolvable by the grid
    // instead of being thinner than one cell and slipping through undetected.
    const spanX = maxX - minX, spanY = maxY - minY;
    const cols = Math.min(160, Math.max(48, Math.round(spanX / 12)));
    const rows = Math.min(140, Math.max(42, Math.round(spanY / 12)));
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

    const segments: [{ x: number; y: number }, { x: number; y: number }][] = [];
    for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
            const tl = grid[j][i], tr = grid[j][i + 1], br = grid[j + 1][i + 1], bl = grid[j + 1][i];
            const idx = (tl.inside ? 8 : 0) | (tr.inside ? 4 : 0) | (br.inside ? 2 : 0) | (bl.inside ? 1 : 0);
            if (idx === 0 || idx === 15) continue;

            const top = () => interp(tl, tr);
            const right = () => interp(tr, br);
            const bottom = () => interp(bl, br);
            const left = () => interp(tl, bl);

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

    // Chain segments into a single closed loop by nearest-endpoint matching. The field is
    // built so its isoline is always one connected component (BACKGROUND_FIELD keeps it
    // from ever splitting), so a greedy walk suffices.
    const used = new Array(segments.length).fill(false);
    const loop: { x: number; y: number }[] = [];
    let current = segments[0][0];
    loop.push(current);
    let currentSegIdx = 0;
    used[0] = true;
    let next = segments[0][1];
    loop.push(next);
    current = next;

    const snapDist = Math.max(cellW, cellH) * 1.5;
    for (let iter = 0; iter < segments.length * 2; iter++) {
        let bestIdx = -1;
        let bestDist = Infinity;
        let bestEnd: { x: number; y: number } | null = null;
        for (let k = 0; k < segments.length; k++) {
            if (used[k]) continue;
            const [a, b] = segments[k];
            const dA = Math.hypot(a.x - current.x, a.y - current.y);
            const dB = Math.hypot(b.x - current.x, b.y - current.y);
            if (dA < bestDist) { bestDist = dA; bestIdx = k; bestEnd = b; }
            if (dB < bestDist) { bestDist = dB; bestIdx = k; bestEnd = a; }
        }
        if (bestIdx === -1 || bestDist > snapDist) break;
        used[bestIdx] = true;
        loop.push(bestEnd!);
        current = bestEnd!;
        currentSegIdx = bestIdx;
    }
    void currentSegIdx;

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

export function buildAttnPerimeterPath(circles: Circle[], parts: Part[], shrinkWrap: number, wobblePhase: number[]): string {
    const threshold = thresholdFor(shrinkWrap);
    const capsules = buildConnectorCapsules(circles[0], parts, shrinkWrap);
    const rawContour = marchingSquaresContour(circles, capsules, threshold);
    if (rawContour.length < 3) return "";

    const N = 48;
    const pts = resampleClosed(rawContour, N);

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
