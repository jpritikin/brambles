import type { Vertex } from "./geometry";

export interface DrugEffect {
    key: string;
    name: string;
    emoji: string;
    // Dose fractions the slider snaps to. Omit for a free continuous 0-100 slider.
    doseSteps?: number[];
    doseStepLabels?: string[]; // parallel to doseSteps
    // Real-world unit range the free 0-100% slider maps onto for display (linear).
    doseUnitRange?: { min: number; max: number; unit: string };
    // Like doseUnitRange but exponential (min * (max/min)^fraction), for a range
    // spanning orders of magnitude (e.g. THH: 1mg-1000mg).
    doseUnitLogRange?: { min: number; max: number; unit: string };
    // Self energy boost at each dose step, parallel to doseSteps.
    selfEnergyBoostSteps?: number[];
    // Self energy boost at full dose for a free-slider drug, scaled linearly below that.
    selfEnergyBoostMax?: number;
    // Direct push away from blended applied to every part (0..1 blend-force scale,
    // may exceed 1), scaled linearly by dose fraction.
    unblendPushMax?: number;
    // Direct push toward blended applied to every part (0..1 blend-force scale, may exceed
    // 1), scaled linearly by dose fraction - the blended-side mirror of unblendPushMax.
    blendPushMax?: number;
    // Renders as a standalone drifting part near a vertex instead of pulling the region.
    rendersAsPart?: Vertex["name"];
    // Divides every part's blend urgency by this factor while active (5-MAPB: quiets
    // the pull toward blended, independent of unblendPushMax/blendPushMax).
    blendUrgencyDivisor?: number;
    // Divides only the cannabis part's blend urgency by this factor while active (THH:
    // quiets cannabis's blend pull specifically, on top of THH's general unblendPushMax).
    cannabisBlendUrgencyDivisor?: number;
    // Attention-perimeter shrinkWrap contribution at full dose, scaled linearly by dose
    // fraction (cannabis). Distinct from THH's dose-gated thhShrinkWrapEffect, which ramps
    // in via a sigmoid rather than linearly.
    shrinkWrapBoostMax?: number;
    // Non-monotonic alternative to selfEnergyBoostMax/blendPushMax: a piecewise-linear curve
    // over dose fraction (0..1), each point {frac, selfEnergyBoost, blendPush}. Used instead
    // of the flat *Max fields when a drug's effect doesn't just ramp linearly to a single peak
    // (psilomethoxin: blendPush rises then falls back down as dose keeps climbing).
    doseCurve?: { frac: number; selfEnergyBoost: number; blendPush: number }[];
}

// Every entry is a hard block - there's no separate "caution" tier, just allowed or not.
export interface Interaction {
    a: string;
    b: string;
    note: string;
}

export const DRUGS: DrugEffect[] = [
    {
        key: "mapb",
        name: "5-MAPB",
        emoji: "💗",
        // Binary dosing: 80mg or 100mg, no inactive/0 step.
        doseSteps: [0.8, 1],
        doseStepLabels: ["80mg", "100mg"],
        selfEnergyBoostSteps: [0.25, 0.3],
        blendUrgencyDivisor: 2,
    },
    {
        key: "thh",
        name: "THH",
        emoji: "🌙",
        // No `pull`: acts on parts directly via unblendPushMax, not the region.
        // 1mg-1000mg exponential range; combinable (no INTERACTIONS entry).
        doseUnitLogRange: { min: 1, max: 1000, unit: "mg" },
        selfEnergyBoostMax: 0.15,
        unblendPushMax: 0.9,
        cannabisBlendUrgencyDivisor: 2,
    },
    {
        key: "meodmt",
        name: "5-MeO-DMT",
        emoji: "🌀",
        // Threshold-or-breakthrough, no inactive/0 step.
        doseSteps: [0.3, 1],
        doseStepLabels: ["3mg", "10mg"],
        selfEnergyBoostSteps: [0.15, 0.9],
    },
    {
        key: "dmt",
        name: "N,N-DMT",
        emoji: "🌪️",
        // 1mg-60mg linear range; combinable (no INTERACTIONS entry).
        doseUnitRange: { min: 1, max: 60, unit: "mg" },
        // Modest Self-energy lift, but a strong direct push toward blended (mirroring THH's
        // unblendPushMax) - past a high-dose threshold this is what lets the attention
        // perimeter collapse onto a single part alone ("Private reverie"), Self excluded.
        selfEnergyBoostMax: 0.15,
        blendPushMax: 0.9,
    },
    {
        key: "psilocybin",
        name: "Psilocybin",
        emoji: "🍄",
        // 5-40mg linear range; combinable (no INTERACTIONS entry).
        doseUnitRange: { min: 5, max: 40, unit: "mg" },
        selfEnergyBoostMax: 0.3,
        blendPushMax: 0.6,
    },
    {
        key: "psilomethoxin",
        name: "Psilo­methoxin",
        emoji: "✨",
        // 0-3g linear range: 0-1g ramps blendPush up toward 0.2 alongside +0.2 Self energy,
        // then 1-3g ramps blendPush back down toward 0 while Self energy keeps climbing
        // toward +0.5 - a non-monotonic curve, so doseCurve is used instead of the flat
        // selfEnergyBoostMax/blendPushMax fields.
        doseUnitRange: { min: 0, max: 3, unit: "g" },
        doseCurve: [
            { frac: 0, selfEnergyBoost: 0, blendPush: 0 },
            { frac: 1 / 3, selfEnergyBoost: 0.2, blendPush: 0.2 },
            { frac: 1, selfEnergyBoost: 0.5, blendPush: 0 },
        ],
    },
    {
        key: "cannabis",
        name: "Cannabis",
        emoji: "🌿",
        rendersAsPart: "blended",
        doseUnitRange: { min: 4, max: 12, unit: "mg" },
        selfEnergyBoostMax: 0.1,
        shrinkWrapBoostMax: 0.3,
    },
];

export const DRUG_BY_KEY = Object.fromEntries(DRUGS.map((d) => [d.key, d]));

// Piecewise-linear interpolation of a drug's doseCurve at a given dose fraction (0..1),
// for drugs whose effect isn't a straight ramp to a single peak (see doseCurve above).
export function sampleDoseCurve(
    curve: { frac: number; selfEnergyBoost: number; blendPush: number }[],
    fraction: number,
): { selfEnergyBoost: number; blendPush: number } {
    if (fraction <= curve[0].frac) return curve[0];
    for (let i = 1; i < curve.length; i++) {
        const prev = curve[i - 1];
        const cur = curve[i];
        if (fraction <= cur.frac) {
            const t = (fraction - prev.frac) / (cur.frac - prev.frac);
            return {
                selfEnergyBoost: prev.selfEnergyBoost + (cur.selfEnergyBoost - prev.selfEnergyBoost) * t,
                blendPush: prev.blendPush + (cur.blendPush - prev.blendPush) * t,
            };
        }
    }
    return curve[curve.length - 1];
}

// Explicit named pairs only — no substance is assumed risky with "anything else."
// A pair absent from this table (e.g. dmt + thh, the Daime combination) is allowed.
export const INTERACTIONS: Interaction[] = [
    {
        a: "mapb",
        b: "meodmt",
        note: "don't combine, serotonin syndrome risk",
    },
    {
        a: "mapb",
        b: "dmt",
        note: "don't combine, serotonin syndrome risk",
    },
    {
        a: "meodmt",
        b: "dmt",
        note: "don't stack two potent tryptamines, serotonin syndrome risk",
    },
    {
        a: "meodmt",
        b: "psilocybin",
        note: "don't stack two potent psychedelics",
    },
    {
        a: "meodmt",
        b: "psilomethoxin",
        note: "don't stack two potent psychedelics",
    },
];
