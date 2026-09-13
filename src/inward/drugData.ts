import type { Vertex } from "./geometry";

export interface DrugEffect {
    key: string;
    name: string;
    emoji: string;
    // Omit for a drug with no direct opinion on region location (e.g. THH: acts on
    // parts via unblendPushMax instead).
    pull?: { self: number; blended: number; unblended: number };
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
}

export type InteractionSeverity = "contraindicated" | "caution";

export interface Interaction {
    a: string;
    b: string;
    severity: InteractionSeverity;
    note: string;
}

export const DRUGS: DrugEffect[] = [
    {
        key: "mapb",
        name: "5-MAPB",
        emoji: "💗",
        pull: { self: 0.15, blended: 0, unblended: 0.85 },
        // Binary dosing: 80mg or 100mg, no inactive/0 step.
        doseSteps: [0.8, 1],
        doseStepLabels: ["80mg", "100mg"],
        selfEnergyBoostSteps: [0.25, 0.3],
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
    },
    {
        key: "dmt",
        name: "5-MeO-DMT",
        emoji: "🌀",
        pull: { self: 0.9, blended: 0.05, unblended: 0.05 },
        // Threshold-or-breakthrough, no inactive/0 step.
        doseSteps: [0.3, 1],
        doseStepLabels: ["3mg", "10mg"],
        selfEnergyBoostSteps: [0.15, 0.9],
    },
    {
        key: "nndmt",
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
        pull: { self: 0.1, blended: 0.75, unblended: 0.15 },
    },
    {
        key: "psilomethoxin",
        name: "Psilo­methoxin",
        emoji: "✨",
        pull: { self: 0.5, blended: 0, unblended: 0.5 },
    },
    {
        key: "cannabis",
        name: "Cannabis",
        emoji: "🌿",
        pull: { self: 0, blended: 1, unblended: 0 },
        rendersAsPart: "blended",
        doseUnitRange: { min: 4, max: 12, unit: "mg" },
    },
];

export const DRUG_BY_KEY = Object.fromEntries(DRUGS.map((d) => [d.key, d]));

// Explicit named pairs only — no substance is assumed risky with "anything else."
// A pair absent from this table (e.g. dmt + thh, the Daime combination) gets no warning.
export const INTERACTIONS: Interaction[] = [
    {
        a: "mapb",
        b: "dmt",
        severity: "contraindicated",
        note: "don't combine, serotonin syndrome risk",
    },
    {
        a: "mapb",
        b: "nndmt",
        severity: "contraindicated",
        note: "don't combine, serotonin syndrome risk",
    },
    {
        a: "psilomethoxin",
        b: "mapb",
        severity: "caution",
        note: "both push hard toward unblended; stacking can be more than the sum of parts",
    },
];
