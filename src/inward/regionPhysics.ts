import { DRUGS } from "./drugData";
import { VERTEX_BY_NAME, lerp, type RegionPressure } from "./geometry";
import type { Part } from "./part";

// Constant BLEND_FORCE_SCALE converts the normalized [0,1] blending-force scale
// (blendPropensity, selfPushFactor) to actual velocity units, preserving prior
// motion scale (was 10-14 unnormalized).
export const BLEND_FORCE_SCALE = 12;

// Pressures from drugs that declare `pull` (excludes cannabis and THH, which
// act elsewhere). Region-placement code below only consumes this flat list.
export function collectRegionPressures(doses: Record<string, number>, isActive: (key: string) => boolean): RegionPressure[] {
    const pressures: RegionPressure[] = [];
    for (const drug of DRUGS) {
        if (!drug.pull || drug.rendersAsPart || !isActive(drug.key)) continue;
        const dose = doses[drug.key];
        const d = drug.pull;
        pressures.push({
            x: d.self * VERTEX_BY_NAME.self.x + d.blended * VERTEX_BY_NAME.blended.x + d.unblended * VERTEX_BY_NAME.unblended.x,
            y: d.self * VERTEX_BY_NAME.self.y + d.blended * VERTEX_BY_NAME.blended.y + d.unblended * VERTEX_BY_NAME.unblended.y,
            weight: 1.8 * dose,
            narrowness: Math.max(d.self, d.blended, d.unblended),
        });
    }
    return pressures;
}

export function computeTargetCentroid(selfEnergy: number, parts: Part[], pressures: RegionPressure[]): { x: number; y: number } {
    // No parts -> pinned near Self scaled by ambient Self energy; low Self energy
    // weakens that anchor and drifts toward blended instead.
    const wSelf = 1.0 * selfEnergy;
    const wBlendedDrift = 0.9 * (1 - selfEnergy);
    let sumX = wSelf * VERTEX_BY_NAME.self.x + wBlendedDrift * VERTEX_BY_NAME.blended.x;
    let sumY = wSelf * VERTEX_BY_NAME.self.y + wBlendedDrift * VERTEX_BY_NAME.blended.y;
    let sumW = wSelf + wBlendedDrift;

    for (const p of parts) {
        // Scaled by opacity so a fading-in/out part ramps its pull smoothly.
        const w = 2.2 * p.opacity;
        sumX += w * p.x;
        sumY += w * p.y;
        sumW += w;
    }

    for (const pressure of pressures) {
        sumX += pressure.weight * pressure.x;
        sumY += pressure.weight * pressure.y;
        sumW += pressure.weight;
    }

    return { x: sumX / sumW, y: sumY / sumW };
}

// How tightly the boundary hugs its contents: driven by how concentrated the
// active pressure is, and by how many parts are present.
export function computeTargetShrinkWrap(parts: Part[], pressures: RegionPressure[]): number {
    if (pressures.length === 0) {
        const weightedCount = parts.reduce((sum, p) => sum + p.opacity, 0);
        return weightedCount <= 1 ? 0.15 : Math.max(0, 0.15 - (weightedCount - 1) * 0.05);
    }
    let weightedNarrowness = 0;
    let weightTotal = 0;
    for (const pressure of pressures) {
        const narrowness = Math.min(1, Math.max(0, (pressure.narrowness - 0.33) / 0.67)); // 0 even .. 1 single-vertex
        weightedNarrowness += narrowness * pressure.weight;
        weightTotal += pressure.weight;
    }
    return weightTotal > 0 ? weightedNarrowness / weightTotal : 0;
}

export function computeRadius(
    baseRadius: number,
    shrinkWrap: number,
    selfEnergy: number,
    centroid: { x: number; y: number },
    parts: Part[],
    pressures: RegionPressure[],
): number {
    if (parts.length === 0 && pressures.length === 0) {
        return lerp(baseRadius * 1.15, baseRadius * 0.8, shrinkWrap);
    }
    let farthest = baseRadius * 0.5;
    for (const p of parts) {
        const dist = lerp(farthest, Math.hypot(p.x - centroid.x, p.y - centroid.y), p.opacity);
        farthest = Math.max(farthest, dist);
    }
    // Loose: generous padding beyond the farthest content, boundary hangs slack.
    // Tight: boundary shrink-wraps right up against it, almost no padding.
    const loosePadding = 90;
    const tightPadding = 18;
    const padding = lerp(loosePadding, tightPadding, shrinkWrap);
    let spread = farthest + padding;

    for (const pressure of pressures) {
        // Pressure concentrated on one vertex narrows focus; a balanced one diffuses it.
        const factor = lerp(1.3, 0.75, (pressure.narrowness - 0.33) / 0.67);
        spread *= lerp(1, factor, pressure.weight / 1.8);
    }

    // At full Self energy the boundary must reach Self outright; that requirement
    // fades smoothly as energy drops.
    const distToSelf = Math.hypot(centroid.x - VERTEX_BY_NAME.self.x, centroid.y - VERTEX_BY_NAME.self.y);
    const selfInclusionRadius = (distToSelf + 24) * selfEnergy;
    spread = Math.max(spread, selfInclusionRadius);

    return spread;
}

export function buildRegionPath(centroid: { x: number; y: number }, radius: number, shrinkWrap: number, wobblePhase: number[]): string {
    const N = 24;
    // A loose boundary has slack and wobbles more; a shrink-wrapped one is taut and crisp.
    const wobbleScale = lerp(1, 0.35, shrinkWrap);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const wobble =
            wobbleScale *
            (6 * Math.sin(a * 3 + wobblePhase[0]) +
                4 * Math.sin(a * 5 - wobblePhase[1]) +
                3 * Math.sin(a * 2 + wobblePhase[2]));
        const r = radius + wobble;
        pts.push({ x: centroid.x + Math.cos(a) * r, y: centroid.y + Math.sin(a) * r });
    }
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < N; i++) {
        const p0 = pts[(i - 1 + N) % N];
        const p1 = pts[i];
        const p2 = pts[(i + 1) % N];
        const p3 = pts[(i + 2) % N];
        const cp1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
        const cp2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
        d += ` C ${cp1.x.toFixed(1)} ${cp1.y.toFixed(1)} ${cp2.x.toFixed(1)} ${cp2.y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d + " Z";
}
