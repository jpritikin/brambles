// Self-related words scaled by how much ambient Self energy is dialed in (the Self knob).
// Low energy reads as thin/depleted rather than the full calm-curious-spacious set.
const SELF_ENERGY_QUALITIES: { max: number; words: string[] }[] = [
    { max: 0.2, words: ["depleted", "faint", "hard to access"] },
    { max: 0.45, words: ["thin", "flickering", "half-present"] },
    { max: 0.7, words: ["calm", "steady", "present"] },
    { max: 1.01, words: ["calm", "curious", "spacious", "unhurried", "clear"] },
];

export function selfQualitiesFor(energy: number): string[] {
    return (SELF_ENERGY_QUALITIES.find((tier) => energy <= tier.max) ?? SELF_ENERGY_QUALITIES[SELF_ENERGY_QUALITIES.length - 1]).words;
}

// Intensity word prefixed to a part's feeling in the readout, keyed by its blendPropensity.
const BLEND_INTENSITY_WORDS: { max: number; word: string }[] = [
    { max: 0.2, word: "slightly" },
    { max: 0.4, word: "somewhat" },
    { max: 0.6, word: "" },
    { max: 0.8, word: "quite" },
    { max: 1.01, word: "very" },
];

export function blendIntensityWord(propensity: number): string {
    return (BLEND_INTENSITY_WORDS.find((tier) => propensity <= tier.max) ?? BLEND_INTENSITY_WORDS[BLEND_INTENSITY_WORDS.length - 1]).word;
}

// Spectrum of focus words from a small, narrow, hyper-concentrated region to a
// large, diffuse, broad one. Indexed by how the current radius sits between
// FOCUS_MIN_RADIUS (narrowest) and FOCUS_MAX_RADIUS (most diffuse).
export const FOCUS_MIN_RADIUS = 42;
export const FOCUS_MAX_RADIUS = 340;
const FOCUS_WORDS = ["hyper-focused", "narrow", "concentrated", "settled", "open", "spacious", "diffuse"];

export function focusPhrase(radius: number): string {
    const t = Math.min(1, Math.max(0, (radius - FOCUS_MIN_RADIUS) / (FOCUS_MAX_RADIUS - FOCUS_MIN_RADIUS)));
    const idx = Math.min(FOCUS_WORDS.length - 1, Math.floor(t * FOCUS_WORDS.length));
    return FOCUS_WORDS[idx];
}

// Wraps a drug name into stacked lines for the small wheel button/slice labels: splits
// on spaces, and on a soft hyphen (­) for a long single word with no space to wrap
// on (e.g. DRUGS' "Psilo­methoxin" breaks after "Psilo", not at an arbitrary midpoint).
export function wrapWheelLabel(name: string): string[] {
    return name.split(/[ ­]/);
}
