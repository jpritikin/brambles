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

// Spectrum of focus words from a small, narrow, hyper-concentrated attention perimeter to
// a large, diffuse, broad one. Indexed by a score combining how many circles (Self/parts)
// the perimeter currently encloses (more = more diffuse) and how tightly it's shrink-wrapped
// around them (tighter = more focused) - not a geometric radius estimate, since there's no
// single radius once the perimeter wraps a variable number of circles.
const FOCUS_SCORE_MIN = 1 - 1; // sqrt(1 circle) - shrinkWrap=1 (tightest single-circle case)
const FOCUS_SCORE_MAX = Math.sqrt(8) - 0; // sqrt(8 circles) - shrinkWrap=0 (loosest many-circle case)
const FOCUS_WORDS = ["hyper-focused", "narrow", "concentrated", "settled", "open", "spacious", "diffuse"];

// Below this Self energy (matching SELF_ENERGY_QUALITIES' lowest "depleted" tier), a
// hyper-focused reading isn't concentration - it's the attention region collapsing in on
// itself for lack of any ambient Self energy to hold it open, which reads as sleep
// rather than focus.
const SLEEP_SELF_ENERGY_MAX = 0.2;

export function focusPhrase(circleCount: number, shrinkWrap: number, selfEnergy: number): string {
    const score = Math.sqrt(Math.max(1, circleCount)) - shrinkWrap;
    const t = Math.min(1, Math.max(0, (score - FOCUS_SCORE_MIN) / (FOCUS_SCORE_MAX - FOCUS_SCORE_MIN)));
    const idx = Math.min(FOCUS_WORDS.length - 1, Math.floor(t * FOCUS_WORDS.length));
    if (idx === 0 && selfEnergy <= SLEEP_SELF_ENERGY_MAX) return "sleep";
    return FOCUS_WORDS[idx];
}

// Wraps a drug name into stacked lines for the small wheel button/slice labels: splits
// on spaces, and on a soft hyphen (­) for a long single word with no space to wrap
// on (e.g. DRUGS' "Psilo­methoxin" breaks after "Psilo", not at an arbitrary midpoint).
export function wrapWheelLabel(name: string): string[] {
    return name.split(/[ ­]/);
}
