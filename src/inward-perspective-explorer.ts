// Animated explorer for the "Inward perspective" axis of the Psychological
// Characterization scale (see data/psychScale.json and psych-scale.ts).
// Three vertices — Self (1st), blended (2nd), unblended (3rd) — form a
// triangle. A dashed, wobbling boundary (visual language borrowed from
// urbb-web's StarBorder) encloses a "focus region" whose area and position
// are pulled by emoji "parts" that drift in and out on their own — a new one
// every 5-10s, stochastically reaped back down to a single part every 1-2s
// once more than one is present, so there's typically 1-2 around and almost
// always at least one. Parts can still be dragged by hand. No parts →
// the region collapses to a small diffuse halo centered on Self. Dose
// sliders apply continuous forces to the region's drift, echoing the
// psych-scale data-pattern already assigned to each substance on this page
// (see content/docs/psychoactive/_index.md). Each substance dials in on its
// own scale — some (5-MAPB, 5-MeO-DMT) only have a couple of meaningfully
// distinct doses (5-MAPB has no inactive/0 step — it's either 80mg or 100mg,
// and cancelling is done via the applied list's ✕), others are closer to
// continuous. INTERACTIONS lists named
// substance pairs explicitly, each as either "contraindicated" (hard-blocked,
// e.g. 5-MAPB + 5-MeO-DMT: serotonin syndrome risk) or "caution" (shown as a
// soft warning but not blocked). A pair with no entry, like DMT + THH inside
// a Daime brew, gets no warning at all. Cannabis doesn't pull the region
// directly — dosing it spawns its own drifting part near the blended (2nd)
// vertex.

interface Vertex {
    name: "self" | "blended" | "unblended";
    emoji: string;
    label: string;
    x: number;
    y: number;
}

interface Part {
    emoji: string;
    feeling: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    opacity: number;
    fadingOut: boolean;
    el: SVGTextElement;
    // Sampled once at creation from uniform [0, 1): this part's own propensity to blend,
    // independent of ambient Self energy. Drives a steady pull toward the blended corner
    // and the intensity word ("slightly"/"very"/etc.) shown before its feeling in the readout.
    blendPropensity: number;
}

interface DrugEffect {
    key: string;
    name: string;
    emoji: string;
    // Omit for a drug with no direct opinion on the region's location — one that only
    // acts on individual parts (e.g. THH's unblendPushMax) and lets the centroid emerge
    // from wherever those parts end up plus ambient Self energy.
    pull?: { self: number; blended: number; unblended: number };
    // Dose fractions [0, ...1] the slider snaps to. Omit for a free continuous 0-100 slider.
    // e.g. 5-MAPB is only meaningfully dosed at 0, 80mg, or 100mg -> steps [0, 0.8, 1].
    doseSteps?: number[];
    doseStepLabels?: string[]; // parallel to doseSteps, e.g. ["0", "80mg", "100mg"]
    // Real-world unit range the free 0-100% slider maps onto for display, e.g. cannabis's
    // 4-12mg delta-9 THC. Omit to show the raw 0-100% fraction.
    doseUnitRange?: { min: number; max: number; unit: string };
    // Like doseUnitRange but mapped exponentially (min * (max/min)^fraction) instead of
    // linearly, for a substance whose meaningful range spans orders of magnitude
    // (e.g. THH: 1mg-1000mg) — most of the slider's travel covers the low end.
    doseUnitLogRange?: { min: number; max: number; unit: string };
    // Direct contribution to ambient Self energy at each dose step, parallel to doseSteps
    // (index-matched). e.g. 5-MAPB: +0.25 at the 80mg step, +0.3 at the 100mg step.
    selfEnergyBoostSteps?: number[];
    // For a free-slider (non-stepped) drug: Self energy boost at full dose (fraction 1),
    // scaled linearly by dose fraction below that. THH: capped well under 5-MAPB's
    // 0.25-0.3, since its Self-opening effect is more modest.
    selfEnergyBoostMax?: number;
    // Direct push away from the blended corner applied to every part (on the same
    // normalized [0,1] blending-force scale as blendPropensity, but allowed to exceed
    // 1), scaled linearly by dose fraction. Lets a substance override parts' own
    // blending pull without going through ambient Self energy at all.
    unblendPushMax?: number;
    // Cannabis-style substances render as a standalone drifting part near a vertex
    // instead of pulling the region centroid directly.
    rendersAsPart?: Vertex["name"];
}

// A weighted point contribution toward the region's target centroid, plus how much it
// should narrow (vs. diffuse) the boundary's shrink-wrap and radius. Region-placement
// code (computeTargetCentroid/computeTargetShrinkWrap/computeRadius) only ever consumes
// a flat list of these — it has no knowledge of drugs, parts, or any other source.
interface RegionPressure {
    x: number;
    y: number;
    weight: number;
    // 0 (pull spread evenly across all three vertices) .. 1 (pull concentrated on one).
    narrowness: number;
}

type InteractionSeverity = "contraindicated" | "caution";

interface Interaction {
    a: string;
    b: string;
    severity: InteractionSeverity;
    note: string;
}

const W = 480;
const H = 420;
const CX = W / 2;

const VERTICES: Vertex[] = [
    { name: "self", emoji: "1️⃣", label: "Self", x: CX, y: 60 },
    { name: "blended", emoji: "2️⃣", label: "blended", x: 90, y: 360 },
    { name: "unblended", emoji: "3️⃣", label: "unblended", x: W - 90, y: 360 },
];

const VERTEX_BY_NAME = Object.fromEntries(VERTICES.map((v) => [v.name, v])) as Record<
    Vertex["name"],
    Vertex
>;


const DRUGS: DrugEffect[] = [
    {
        key: "mapb",
        name: "5-MAPB",
        emoji: "💗",
        pull: { self: 0.15, blended: 0, unblended: 0.85 },
        // Real-world dosing here is effectively binary: the reference 80mg
        // single-occasion dose from this page, or a full 100mg. No inactive/0 step —
        // cancelling is done via the ✕ in the applied list, not the dose slider.
        doseSteps: [0.8, 1],
        doseStepLabels: ["80mg", "100mg"],
        selfEnergyBoostSteps: [0.25, 0.3],
    },
    {
        key: "thh",
        name: "THH",
        emoji: "🌙",
        // No `pull`: THH has no direct opinion on the region's location. Its unblending
        // effect (unblendPushMax below) acts on individual parts; the region centroid
        // then emerges from wherever those parts end up, same as with no drug at all.
        // 1mg-1000mg, exponential: dose fraction is the log-position in that range, so
        // scaling unblendPushMax by dose fraction gives a log-linear ramp of unblending
        // force with mg. Combinable with other substances — no INTERACTIONS entry, like
        // the DMT+THH Daime combination.
        doseUnitLogRange: { min: 1, max: 1000, unit: "mg" },
        // Modest ambient Self-energy boost, well under 5-MAPB's 0.25-0.3.
        selfEnergyBoostMax: 0.15,
        // THH's real unblending strength isn't routed through ambient Self energy at
        // all: it applies its own direct push on the blended axis (see the animation
        // loop), reaching 0.9 on the normalized [0,1] blending-force scale at full
        // dose — enough to override the ~90% of parts whose randomly sampled
        // blendPropensity falls below 0.9. Unlike an ordinary part's blendPropensity,
        // this is allowed to exceed the natural 0-1 max for parts.
        unblendPushMax: 0.9,
    },
    {
        key: "dmt",
        name: "5-MeO-DMT",
        emoji: "🌀",
        pull: { self: 0.9, blended: 0.05, unblended: 0.05 },
        // Not much finesse in between: it's either a faint threshold dose or a full
        // breakthrough. No inactive/0 step, like 5-MAPB — cancelling is done via the
        // applied list's ✕.
        doseSteps: [0.3, 1],
        doseStepLabels: ["3mg", "10mg"],
        // 3mg raises the baseline to 15% Self energy; 10mg raises it to 90%, leaving
        // only the top 10% of the knob's travel adjustable by hand.
        selfEnergyBoostSteps: [0.15, 0.9],
    },
    {
        key: "nndmt",
        name: "N,N-DMT",
        emoji: "🌪️",
        pull: { self: 0.55, blended: 0.35, unblended: 0.1 },
        // Same off/half/breakthrough shape as 5-MeO-DMT.
        doseSteps: [0, 0.5, 1],
        doseStepLabels: ["0", "50%", "100%"],
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

const DRUG_BY_KEY = Object.fromEntries(DRUGS.map((d) => [d.key, d]));

// Explicit named pairs only — no substance is assumed risky with "anything else."
// A pair absent from this table (e.g. dmt + thh, the Daime combination) gets no warning.
const INTERACTIONS: Interaction[] = [
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

const PARTS_PALETTE: { emoji: string; feeling: string }[] = [
    { emoji: "😠", feeling: "angry" },
    { emoji: "😢", feeling: "sad" },
    { emoji: "😨", feeling: "afraid" },
    { emoji: "😳", feeling: "ashamed" },
    { emoji: "💭", feeling: "pensive" },
    { emoji: "🧐", feeling: "critical" },
];

// Self-related words scaled by how much ambient Self energy is dialed in (the Self knob).
// Low energy reads as thin/depleted rather than the full calm-curious-spacious set.
const SELF_ENERGY_QUALITIES: { max: number; words: string[] }[] = [
    { max: 0.2, words: ["depleted", "faint", "hard to access"] },
    { max: 0.45, words: ["thin", "flickering", "half-present"] },
    { max: 0.7, words: ["calm", "steady", "present"] },
    { max: 1.01, words: ["calm", "curious", "spacious", "unhurried", "clear"] },
];

function selfQualitiesFor(energy: number): string[] {
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

function blendIntensityWord(propensity: number): string {
    return (BLEND_INTENSITY_WORDS.find((tier) => propensity <= tier.max) ?? BLEND_INTENSITY_WORDS[BLEND_INTENSITY_WORDS.length - 1]).word;
}

// Spectrum of focus words from a small, narrow, hyper-concentrated region to a
// large, diffuse, broad one. Indexed by how the current radius sits between
// FOCUS_MIN_RADIUS (narrowest) and FOCUS_MAX_RADIUS (most diffuse).
// Converts the normalized [0,1] blending-force scale (blendPropensity, selfPushFactor)
// to actual velocity units, preserving prior motion scale (was 10-14 unnormalized).
const BLEND_FORCE_SCALE = 12;

const FOCUS_MIN_RADIUS = 42;
const FOCUS_MAX_RADIUS = 340;
const FOCUS_WORDS = ["hyper-focused", "narrow", "concentrated", "settled", "open", "spacious", "diffuse"];

function focusPhrase(radius: number): string {
    const t = Math.min(1, Math.max(0, (radius - FOCUS_MIN_RADIUS) / (FOCUS_MAX_RADIUS - FOCUS_MIN_RADIUS)));
    const idx = Math.min(FOCUS_WORDS.length - 1, Math.floor(t * FOCUS_WORDS.length));
    return FOCUS_WORDS[idx];
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

// Logistic sigmoid centered at `midpoint` with `steepness` controlling how sharp the
// transition is. Used to turn a linear 0..1 latent into a "not much happens, then a
// transition, then near-max" response curve.
function sigmoid(x: number, midpoint: number, steepness: number): number {
    return 1 / (1 + Math.exp(-steepness * (x - midpoint)));
}

// Wraps a drug name into stacked lines for the small wheel button/slice labels: splits
// on spaces, and on a soft hyphen (­) for a long single word with no space to wrap
// on (e.g. DRUGS' "Psilo­methoxin" breaks after "Psilo", not at an arbitrary midpoint).
function wrapWheelLabel(name: string): string[] {
    return name.split(/[ ­]/);
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
    return document.createElementNS("http://www.w3.org/2000/svg", tag);
}

class InwardPerspectiveExplorer {
    private root: HTMLElement;
    private svg: SVGSVGElement;
    private regionPath: SVGPathElement;
    private centroid = { x: CX, y: 170 };
    private targetCentroid = { x: CX, y: 170 };
    private baseRadius = 70; // diffuse-Self default
    // Latent shrink-wrap tendency of the boundary, 0..1. At 0 the boundary stays loose
    // and padded around whatever it encloses; at 1 it hugs tightly, shrink-wrapping to
    // just the parts/pull present. Eased toward its target each frame like everything else.
    private shrinkWrap = 0;
    private targetShrinkWrap = 0;
    // Ambient Self energy, 0..1. A drug-set baseline floor (e.g. 5-MAPB) plus the user's
    // knob adjustment on top of it. Low Self energy lets the boundary collapse toward
    // blended even with no parts present.
    // Knob position as a 0..1 *fraction of the range above the current baseline* — not an
    // absolute value. With no drug baseline the range is [0, 0.5], same as before; with
    // 5-MAPB's baseline at e.g. 0.25, the range becomes [0.25, 0.75] and this fraction
    // picks a point within it. Reinterpreted (not reset) whenever the baseline changes,
    // so administering/cancelling a drug shifts the knob's *range*, not silently its position.
    private selfEnergyUserFraction = 0.6;
    // Drug-set floor for Self energy, 0..1 (e.g. 5-MAPB: 0.25 at 80mg, 0.3 at 100mg).
    // Recomputed from doses whenever they change.
    private selfEnergyBaseline = 0;
    // Width of the knob's adjustment range above the baseline.
    private static readonly SELF_ENERGY_USER_RANGE = 0.5;

    private get selfEnergy(): number {
        const range = Math.min(InwardPerspectiveExplorer.SELF_ENERGY_USER_RANGE, 1 - this.selfEnergyBaseline);
        return Math.min(1, Math.max(0, this.selfEnergyBaseline + this.selfEnergyUserFraction * range));
    }
    private parts: Part[] = [];
    private wobblePhase = [0, 1.7, 3.1];
    private readoutTitle!: SVGTextElement;
    private readoutBody!: SVGTextElement;
    private readoutFeelings!: SVGTextElement;
    private selfKnobRing!: SVGCircleElement;
    private selfKnobWedge!: SVGPathElement;
    private selfKnobValueBg!: SVGRectElement;
    private selfKnobValueLabel!: SVGTextElement;
    // Raw drag angle (degrees, unwrapped, unbounded) tracked since the current drag
    // started — the knob's actual physical rotation, before mapping to energy or
    // clamping to its travel limits. Lets us measure the *change* in angle each move
    // instead of re-deriving an absolute position from a discontinuous atan2 result.
    private selfKnobDragAngle = 0;
    private selfKnobLastRawAngle = 0;
    private appliedListEl!: SVGGElement;
    private appliedListX = 0;
    private appliedListY = 0;
    private warningEl!: HTMLElement;
    private doses: Record<string, number> = {};
    // Which drugs are currently administered, independent of whether their dose fraction
    // happens to be 0 — needed because cannabis's 0 fraction is a real 4mg dose (its
    // doseUnitRange floor), not "inactive". Cancelling removes a key from here.
    private administeredKeys = new Set<string>();
    private doseSlider!: HTMLInputElement;
    private doseValueLabel!: HTMLElement;
    private administerBtn!: HTMLButtonElement;
    private pickerRow!: HTMLElement;
    private selectedDrugKey: string = "thh";
    // Pie-menu drug picker (see urbb-web's src/menu/pieMenu.ts for the pattern this
    // borrows from): a small button left of Self that expands into a ring of drug
    // slices around itself when clicked, collapsing again on a selection or on
    // clicking the center.
    private drugWheelGroup!: SVGGElement;
    private drugWheelBtn!: SVGGElement;
    private drugWheelBtnLabel!: SVGTextElement;
    private drugWheelRing!: SVGGElement;
    private drugWheelOpen = false;
    private drugWheelCenterX = 0;
    private drugWheelCenterY = 0;
    private drugWheelOuterR = 0;
    // The dose value currently dialed into the slider but not yet administered —
    // separate from this.doses[key], which only updates once Administer is clicked.
    private pendingDose = 0;
    private cannabisPart: Part | null = null;
    private currentRadius = 70;
    private lastTs = 0;

    // Debug overlay, enabled via ?debug=1 in the URL — shows what's currently
    // controlling the boundary's placement: centroid pull sources, shrink-wrap,
    // and the Self-inclusion constraint.
    private debugEnabled = false;
    private debugPanel!: HTMLElement;
    private debugTargetDot!: SVGCircleElement;
    private debugCentroidDot!: SVGCircleElement;
    private debugPartLines!: SVGGElement;
    private debugSelfLine!: SVGLineElement;

    constructor(container: HTMLElement) {
        this.root = container;
        this.root.classList.add("ipe-root");

        this.debugEnabled = new URLSearchParams(window.location.search).get("debug") === "1";

        const style = document.createElement("style");
        style.textContent = `
      .ipe-root { max-width: 560px; margin: 1.5em auto; font-family: inherit; position: relative; }
      .ipe-svg { width: 100%; height: auto; touch-action: none; display: block; position: relative; z-index: 1; }
      /* While the drug wheel is open, the svg (and its opaque wheel backdrop) must sit
         above the html dose-picker so the wheel isn't see-through to the picker's
         controls beneath it; otherwise the picker (appended after the svg) stacks on
         top and its administer button would be unclickable-looking but actually just
         hidden under the picker's own invisible box. */
      .ipe-picker { z-index: 2; }
      .ipe-root.ipe-wheel-open .ipe-svg { z-index: 3; }
      .ipe-vertex-label { font-size: 13px; fill: currentColor; opacity: 0.75; text-anchor: middle; user-select: none; }
      .ipe-vertex-emoji { font-size: 22px; text-anchor: middle; cursor: default; user-select: none; }
      .ipe-vertex-emoji.ipe-self-knob { cursor: grab; touch-action: none; pointer-events: none; }
      .ipe-self-knob-hit { fill: transparent; cursor: grab; touch-action: none; }
      .ipe-self-knob-hit:active { cursor: grabbing; }
      .ipe-self-knob-ring { fill: none; stroke: currentColor; stroke-opacity: 0.35; stroke-width: 3; }
      .ipe-self-knob-ring-fill { fill: none; stroke: #f400d7; stroke-width: 3; stroke-linecap: round; }
      /* Filled wedge swept from the knob center out to the cursor, the main drag feedback. */
      .ipe-self-knob-wedge { fill: #ffe600; fill-opacity: 0.9; stroke: #000; stroke-width: 2; display: none; pointer-events: none; }
      .ipe-self-knob-value-bg { fill: #f400d7; display: none; pointer-events: none; }
      .ipe-self-knob-value { font-size: 14px; font-weight: 700; fill: #fff; text-anchor: middle; display: none; user-select: none; pointer-events: none; }
      .ipe-region { fill: #f400d7; fill-opacity: 0.08; stroke: #f400d7; stroke-width: 1.5; stroke-dasharray: 4,3; }
      .ipe-part { font-size: 26px; text-anchor: middle; cursor: grab; user-select: none; }
      .ipe-part:active { cursor: grabbing; }
      .ipe-control-group { fill: none; stroke: rgba(128,128,128,0.35); stroke-width: 1; }
      .ipe-picker { position: absolute; display: flex; flex-direction: column; align-items: center; gap: 0.25em; font-size: 0.78em; }
      .ipe-picker input[type=range] { width: 6em; }
      .ipe-picker .ipe-dose-value { text-align: center; opacity: 0.75; }
      .ipe-picker.ipe-disabled { opacity: 0.4; }
      .ipe-drug-wheel-btn { cursor: pointer; touch-action: none; }
      .ipe-drug-wheel-btn-ring { fill: rgba(244,0,215,0.08); stroke: #f400d7; stroke-width: 1.5; }
      .ipe-drug-wheel-btn-label { font-size: 9px; text-anchor: middle; dominant-baseline: central; pointer-events: none; user-select: none; }
      .ipe-drug-wheel { pointer-events: none; opacity: 0; transition: opacity 0.12s ease; }
      .ipe-drug-wheel.ipe-open { pointer-events: auto; opacity: 1; }
      .ipe-drug-wheel-backdrop { fill: var(--body-background, #fff); }
      .ipe-drug-wheel-slice { cursor: pointer; }
      .ipe-drug-wheel-slice-bg { fill: var(--body-background, #fff); stroke: #f400d7; stroke-opacity: 0.6; stroke-width: 1.5; }
      .ipe-drug-wheel-slice:hover .ipe-drug-wheel-slice-bg, .ipe-drug-wheel-slice.ipe-selected .ipe-drug-wheel-slice-bg { fill: rgba(244,0,215,0.2); stroke-opacity: 1; stroke-width: 2; }
      .ipe-drug-wheel-slice-label { font-size: 9px; text-anchor: middle; dominant-baseline: central; pointer-events: none; user-select: none; }
      .ipe-drug-wheel-center { fill: rgba(255,255,255,0.95); stroke: #f400d7; stroke-width: 2; cursor: pointer; }
      .ipe-drug-wheel-close { font-size: 13px; fill: #f400d7; text-anchor: middle; dominant-baseline: central; pointer-events: none; user-select: none; }
      .ipe-administer-btn { border: 1px solid currentColor; background: transparent; border-radius: 999px; padding: 0.25em 0.9em; font-size: 0.9em; cursor: pointer; }
      .ipe-administer-btn:disabled { opacity: 0.4; cursor: default; }
      .ipe-applied-x { font-size: 11px; fill: currentColor; opacity: 0.5; cursor: pointer; }
      .ipe-applied-x:hover { opacity: 1; }
      .ipe-warning { text-align: center; font-size: 0.8em; color: #c0392b; margin-top: 0.4em; min-height: 1.2em; }
      .ipe-applied-list { font-size: 11px; fill: currentColor; }
      .ipe-applied-list .ipe-applied-title { opacity: 0.6; }
      .ipe-readout { font-size: 11px; fill: currentColor; text-anchor: middle; }
      .ipe-readout-heading { font-size: 9px; opacity: 0.55; letter-spacing: 0.03em; text-transform: uppercase; }
      .ipe-readout-title { font-size: 12px; font-weight: 600; }
      .ipe-readout-feelings { opacity: 0.85; }
      .ipe-debug-panel { margin-top: 0.75em; padding: 0.6em 0.8em; border: 1px dashed #f400d7; border-radius: 6px; font: 11px/1.5 ui-monospace, monospace; white-space: pre-wrap; background: rgba(244,0,215,0.05); }
      .ipe-debug-target-dot { fill: #00b894; stroke: #000; stroke-width: 0.5; }
      .ipe-debug-centroid-dot { fill: #f400d7; stroke: #000; stroke-width: 0.5; }
      .ipe-debug-part-line { stroke: #00b894; stroke-width: 1; stroke-dasharray: 2,2; opacity: 0.7; }
      .ipe-debug-self-line { stroke: #ff5722; stroke-width: 1.5; stroke-dasharray: 3,2; }
    `;
        this.root.appendChild(style);

        this.svg = svgEl("svg");
        this.svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
        this.svg.classList.add("ipe-svg");

        for (const v of VERTICES) {
            const label = svgEl("text");
            label.classList.add("ipe-vertex-label");
            label.setAttribute("x", String(v.x));
            label.setAttribute("y", String(v.y + (v.name === "self" ? 34 : -14)));
            label.textContent = v.label;
            this.svg.appendChild(label);

            if (v.name === "self") {
                const KNOB_R = 20;
                const ring = svgEl("circle");
                ring.classList.add("ipe-self-knob-ring");
                ring.setAttribute("cx", String(v.x));
                ring.setAttribute("cy", String(v.y));
                ring.setAttribute("r", String(KNOB_R));
                this.svg.appendChild(ring);

                this.selfKnobRing = svgEl("circle");
                this.selfKnobRing.classList.add("ipe-self-knob-ring-fill");
                this.selfKnobRing.setAttribute("cx", String(v.x));
                this.selfKnobRing.setAttribute("cy", String(v.y));
                this.selfKnobRing.setAttribute("r", String(KNOB_R));
                this.svg.appendChild(this.selfKnobRing);

                // Filled wedge swept from the knob center out to the cursor's current angle —
                // the main drag feedback, plus a numeric readout pill, shown only while dragging.
                this.selfKnobWedge = svgEl("path");
                this.selfKnobWedge.classList.add("ipe-self-knob-wedge");
                this.svg.appendChild(this.selfKnobWedge);

                this.selfKnobValueBg = svgEl("rect");
                this.selfKnobValueBg.classList.add("ipe-self-knob-value-bg");
                this.selfKnobValueBg.setAttribute("x", String(v.x - 22));
                this.selfKnobValueBg.setAttribute("y", String(v.y - KNOB_R - 34));
                this.selfKnobValueBg.setAttribute("width", "44");
                this.selfKnobValueBg.setAttribute("height", "20");
                this.selfKnobValueBg.setAttribute("rx", "10");
                this.svg.appendChild(this.selfKnobValueBg);

                this.selfKnobValueLabel = svgEl("text");
                this.selfKnobValueLabel.classList.add("ipe-self-knob-value");
                this.selfKnobValueLabel.setAttribute("x", String(v.x));
                this.selfKnobValueLabel.setAttribute("y", String(v.y - KNOB_R - 19));
                this.svg.appendChild(this.selfKnobValueLabel);

                // Larger invisible hit area covering the whole knob disc (ring + center),
                // so mouse-down anywhere on the knob — not just exactly on the emoji glyph
                // — starts the drag.
                const hitArea = svgEl("circle");
                hitArea.classList.add("ipe-self-knob-hit");
                hitArea.setAttribute("cx", String(v.x));
                hitArea.setAttribute("cy", String(v.y));
                hitArea.setAttribute("r", String(KNOB_R + 6));
                hitArea.addEventListener("pointerdown", (e) => this.startSelfKnobDrag(e));
                this.svg.appendChild(hitArea);
            }

            const emoji = svgEl("text");
            emoji.classList.add("ipe-vertex-emoji");
            if (v.name === "self") emoji.classList.add("ipe-self-knob");
            emoji.setAttribute("x", String(v.x));
            emoji.setAttribute("y", String(v.y + 8));
            emoji.textContent = v.emoji;
            this.svg.appendChild(emoji);
        }
        this.updateSelfKnobRing();

        this.regionPath = svgEl("path");
        this.regionPath.classList.add("ipe-region");
        this.svg.insertBefore(this.regionPath, this.svg.firstChild);

        // Debug overlay markers: line from centroid to Self (drawn only when the Self-inclusion
        // constraint is actually active), lines from centroid to each part, a dot at the eased
        // (actual) centroid, and a dot at the raw target centroid computeTargetCentroid produced.
        this.debugSelfLine = svgEl("line");
        this.debugSelfLine.classList.add("ipe-debug-self-line");
        this.debugPartLines = svgEl("g");
        this.debugTargetDot = svgEl("circle");
        this.debugTargetDot.classList.add("ipe-debug-target-dot");
        this.debugTargetDot.setAttribute("r", "3");
        this.debugCentroidDot = svgEl("circle");
        this.debugCentroidDot.classList.add("ipe-debug-centroid-dot");
        this.debugCentroidDot.setAttribute("r", "4");
        if (this.debugEnabled) {
            this.svg.appendChild(this.debugSelfLine);
            this.svg.appendChild(this.debugPartLines);
            this.svg.appendChild(this.debugTargetDot);
            this.svg.appendChild(this.debugCentroidDot);
        }

        this.appliedListX = VERTEX_BY_NAME.self.x + 40;
        this.appliedListY = VERTEX_BY_NAME.self.y - 4;
        this.appliedListEl = svgEl("g");
        this.appliedListEl.classList.add("ipe-applied-list");
        this.svg.appendChild(this.appliedListEl);

        this.drugWheelCenterX = VERTEX_BY_NAME.self.x - 115;
        this.drugWheelCenterY = VERTEX_BY_NAME.self.y + 78;

        // Subtle rectangle grouping the pie-menu button and the dose picker beneath it
        // into one visual cluster. Sized around the collapsed button (BTN_R = 22, see
        // buildDrugWheel) down through the picker's approximate height; appended before
        // buildDrugWheel so the wheel (and its opaque backdrop) paints on top of it
        // instead of the rectangle's stroke cutting across the open slices.
        const groupRect = svgEl("rect");
        groupRect.classList.add("ipe-control-group");
        const GROUP_BTN_R = 22;
        const GROUP_PAD = 12;
        const GROUP_HALF_WIDTH = 75;
        const GROUP_LEFT = this.drugWheelCenterX - GROUP_HALF_WIDTH;
        const GROUP_TOP = this.drugWheelCenterY - GROUP_BTN_R - GROUP_PAD;
        const GROUP_WIDTH = GROUP_HALF_WIDTH * 2;
        const GROUP_HEIGHT = 145;
        groupRect.setAttribute("x", String(GROUP_LEFT));
        groupRect.setAttribute("y", String(GROUP_TOP));
        groupRect.setAttribute("width", String(GROUP_WIDTH));
        groupRect.setAttribute("height", String(GROUP_HEIGHT));
        groupRect.setAttribute("rx", "10");
        this.svg.appendChild(groupRect);

        this.buildDrugWheel();

        // Subjective-effects readout, centered inside the triangle, underneath the applied list.
        // Heading, then three stacked lines so it never has to run wide: focus word,
        // base/Self qualities, then part-related emotions on their own line.
        // Shifted right of true center so the drug-wheel/picker cluster (left of Self)
        // has clear space beneath it without overlapping this text.
        const READOUT_X = CX + 100;

        const readoutGroupRect = svgEl("rect");
        readoutGroupRect.classList.add("ipe-control-group");
        const READOUT_GROUP_HALF_WIDTH = 75;
        readoutGroupRect.setAttribute("x", String(READOUT_X - READOUT_GROUP_HALF_WIDTH));
        readoutGroupRect.setAttribute("y", "138");
        readoutGroupRect.setAttribute("width", String(READOUT_GROUP_HALF_WIDTH * 2));
        readoutGroupRect.setAttribute("height", "80");
        readoutGroupRect.setAttribute("rx", "10");
        this.svg.appendChild(readoutGroupRect);

        const readoutHeading = svgEl("text");
        readoutHeading.classList.add("ipe-readout", "ipe-readout-heading");
        readoutHeading.setAttribute("x", String(READOUT_X));
        readoutHeading.setAttribute("y", "153");
        readoutHeading.textContent = "Subjective read-out";
        this.svg.appendChild(readoutHeading);

        this.readoutTitle = svgEl("text");
        this.readoutTitle.classList.add("ipe-readout", "ipe-readout-title");
        this.readoutTitle.setAttribute("x", String(READOUT_X));
        this.readoutTitle.setAttribute("y", String(172));
        this.svg.appendChild(this.readoutTitle);

        this.readoutBody = svgEl("text");
        this.readoutBody.classList.add("ipe-readout");
        this.readoutBody.setAttribute("x", String(READOUT_X));
        this.readoutBody.setAttribute("y", String(191));
        this.svg.appendChild(this.readoutBody);

        this.readoutFeelings = svgEl("text");
        this.readoutFeelings.classList.add("ipe-readout", "ipe-readout-feelings");
        this.readoutFeelings.setAttribute("x", String(READOUT_X));
        this.readoutFeelings.setAttribute("y", String(207));
        this.svg.appendChild(this.readoutFeelings);

        this.root.appendChild(this.svg);

        for (const drug of DRUGS) this.doses[drug.key] = 0;

        const picker = document.createElement("div");
        picker.className = "ipe-picker";
        this.pickerRow = picker;
        // Positioned in constructor-relative-% terms just below the drug wheel's collapsed
        // button (BTN_R = 22, see buildDrugWheel), inside the ipe-control-group rectangle
        // that visually encloses both the pie-menu button and this picker.
        picker.style.left = `${(this.drugWheelCenterX / W) * 100}%`;
        picker.style.top = `${((this.drugWheelCenterY + 40) / H) * 100}%`;
        picker.style.transform = "translateX(-50%)";

        this.doseValueLabel = document.createElement("span");
        this.doseValueLabel.className = "ipe-dose-value";
        picker.appendChild(this.doseValueLabel);

        const controlRow = document.createElement("div");
        controlRow.style.display = "flex";
        controlRow.style.alignItems = "center";
        controlRow.style.gap = "0.5em";
        picker.appendChild(controlRow);

        this.doseSlider = document.createElement("input");
        this.doseSlider.type = "range";
        this.doseSlider.addEventListener("input", () => this.onSliderInput());
        controlRow.appendChild(this.doseSlider);

        this.administerBtn = document.createElement("button");
        this.administerBtn.type = "button";
        this.administerBtn.className = "ipe-administer-btn";
        this.administerBtn.textContent = "🚀";
        this.administerBtn.title = "Administer";
        this.administerBtn.setAttribute("aria-label", "Administer");
        this.administerBtn.addEventListener("click", () => this.onAdminister());
        controlRow.appendChild(this.administerBtn);

        this.root.appendChild(picker);

        this.configureSliderFor(DRUG_BY_KEY[this.selectedDrugKey]);

        this.warningEl = document.createElement("div");
        this.warningEl.className = "ipe-warning";
        this.root.appendChild(this.warningEl);

        if (this.debugEnabled) {
            this.debugPanel = document.createElement("div");
            this.debugPanel.className = "ipe-debug-panel";
            this.root.appendChild(this.debugPanel);
        }

        this.svg.addEventListener("pointerdown", (e) => this.onPointerDown(e));

        requestAnimationFrame((ts) => this.tick(ts));
        this.updateReadout();
        this.updateAppliedList();
        this.addRandomPart(); // at least one part present on load, rather than waiting 5-10s
        this.scheduleSpawn();
        this.scheduleReap();
    }

    // Spontaneous parts (i.e. not the cannabis part, which tracks its own dose slider)
    // in the order they appeared, oldest first — so reaping can remove the oldest.
    private spontaneousParts: Part[] = [];

    // Above this Self energy (e.g. a full-breakthrough 5-MeO-DMT dose, which floors
    // Self energy at 0.9), parts stop spawning entirely and the reap floor of "always
    // keep at least one" lifts, so the region can clear down to zero parts.
    private static readonly HIGH_SELF_ENERGY_THRESHOLD = 0.85;

    private scheduleSpawn(): void {
        const delay = 10000 + Math.random() * 10000;
        window.setTimeout(() => {
            const proposed = this.spontaneousParts.length + 1;
            if (this.selfEnergy < InwardPerspectiveExplorer.HIGH_SELF_ENERGY_THRESHOLD && Math.random() < 1 / proposed) {
                this.addRandomPart();
            }
            this.scheduleSpawn();
        }, delay);
    }

    private scheduleReap(): void {
        const delay = 1000 + Math.random() * 1000;
        window.setTimeout(() => {
            const highSelfEnergy = this.selfEnergy >= InwardPerspectiveExplorer.HIGH_SELF_ENERGY_THRESHOLD;
            const canReap = this.spontaneousParts.length > (highSelfEnergy ? 0 : 1);
            if (canReap && (highSelfEnergy || Math.random() < 0.1)) {
                const oldest = this.spontaneousParts.shift()!;
                oldest.fadingOut = true;
            }
            this.scheduleReap();
        }, delay);
    }

    private addRandomPart(): void {
        const { emoji, feeling } = PARTS_PALETTE[Math.floor(Math.random() * PARTS_PALETTE.length)];
        const angle = Math.random() * Math.PI * 2;
        const r = 30 + Math.random() * 20;
        const { x, y } = this.clampPartPosition(this.centroid.x + Math.cos(angle) * r, this.centroid.y + Math.sin(angle) * r);
        const el = svgEl("text");
        el.classList.add("ipe-part");
        el.setAttribute("x", String(x));
        el.setAttribute("y", String(y));
        el.style.opacity = "0";
        el.textContent = emoji;
        el.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            this.startDrag(part, e);
        });
        this.svg.appendChild(el);
        const part: Part = { emoji, feeling, x, y, vx: 0, vy: 0, opacity: 0, fadingOut: false, el, blendPropensity: Math.random() };
        this.parts.push(part);
        this.spontaneousParts.push(part);
    }

    // Parts live in the lower half of the triangle, from the vertical midpoint down to the
    // blended/unblended corners, and can drift horizontally all the way out to those corners.
    // The two axes can't be clamped independently: at a given height the triangle's left/right
    // edges (self-blended, self-unblended) are narrower than the full corner-to-corner width,
    // so clamping x and y separately let points escape the triangle up near its slanted edges.
    private clampPartPosition(x: number, y: number): { x: number; y: number } {
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

    private draggingPart: Part | null = null;

    private onPointerDown(_e: PointerEvent): void {
        if (this.drugWheelOpen) this.closeDrugWheel();
    }

    private startDrag(part: Part, e: PointerEvent): void {
        this.draggingPart = part;
        const move = (ev: PointerEvent) => {
            const rect = this.svg.getBoundingClientRect();
            const scale = W / rect.width;
            part.x = (ev.clientX - rect.left) * scale;
            part.y = (ev.clientY - rect.top) * scale;
            part.vx = 0;
            part.vy = 0;
            part.el.setAttribute("x", String(part.x));
            part.el.setAttribute("y", String(part.y));
        };
        const up = () => {
            this.draggingPart = null;
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        move(e);
    }

    // Drag the Self corner chip like a rotary volume knob: the mouse's angle around the
    // Self vertex sets ambient Self energy. Standard 270° sweep — 0% at bottom-left
    // (7:30), through straight up (50%, 12 o'clock), to 100% at bottom-right (4:30),
    // with a dead zone across the bottom that clamps to whichever end is closer.
    private startSelfKnobDrag(e: PointerEvent): void {
        e.stopPropagation();
        e.preventDefault();
        const rect = this.svg.getBoundingClientRect();
        const scale = W / rect.width;
        const selfV = VERTEX_BY_NAME.self;
        const KNOB_R = 20;

        this.selfKnobWedge.style.display = "block";
        this.selfKnobValueBg.style.display = "block";
        this.selfKnobValueLabel.style.display = "block";

        // rawAngle: atan2 in [-180, 180], 0 = straight up, positive = clockwise. This
        // wraps discontinuously when the cursor crosses straight down (±180), which is
        // exactly the case that caused the old approach to jump — recomputing an
        // absolute position from this value each move let a single frame cross the
        // wrap and land on the opposite end. Instead we track *relative* rotation:
        // each move adds the short-way-round delta from the previous raw angle to a
        // free-running, unwrapped travel value, then clamp that to the knob's real
        // 0-270 physical range. A delta can never exceed 180 by construction, and the
        // clamp only ever trims from whichever end the travel is already approaching,
        // so the rendered angle/energy always passes through every value in between.
        const angleAt = (ev: PointerEvent): number => {
            const ex = (ev.clientX - rect.left) * scale;
            const ey = (ev.clientY - rect.top) * scale;
            return (Math.atan2(ex - selfV.x, -(ey - selfV.y)) * 180) / Math.PI;
        };

        this.selfKnobLastRawAngle = angleAt(e);
        // Dial travel spans the full 0-270deg = 0-100% of the *fraction*, not of absolute
        // Self energy — the fraction picks a point within [baseline, baseline+range], so
        // dragging fully clockwise always reaches the top of whatever range currently
        // applies (0.5 with no drug baseline, less if the baseline is already high).
        this.selfKnobDragAngle = this.selfEnergyUserFraction * 270;

        const render = () => {
            const travel = Math.max(0, Math.min(270, this.selfKnobDragAngle));
            this.selfEnergyUserFraction = travel / 270;
            this.updateSelfKnobRing();

            // The wedge always draws across the *absolute* Self-energy dial — from the
            // baseline's own position (not from 0%) out to the current value — so with a
            // 0.25 floor it visibly sweeps the 25%-75% band available to the user, not a
            // 0-50% band starting at the knob's physical zero.
            const wedgeR = KNOB_R + 40;
            const angleForEnergy = (energy: number) => ((energy * 270 - 135) * Math.PI) / 180;
            const startRad = angleForEnergy(this.selfEnergyBaseline);
            const rad = angleForEnergy(this.selfEnergy);
            const sweepDeg = (this.selfEnergy - this.selfEnergyBaseline) * 270;
            const large = sweepDeg > 180 ? 1 : 0; // SVG large-arc-flag: sweep exceeds 180°
            const sx = selfV.x + Math.sin(startRad) * wedgeR;
            const sy = selfV.y - Math.cos(startRad) * wedgeR;
            const ex2 = selfV.x + Math.sin(rad) * wedgeR;
            const ey2 = selfV.y - Math.cos(rad) * wedgeR;
            this.selfKnobWedge.setAttribute(
                "d",
                `M ${selfV.x} ${selfV.y} L ${sx.toFixed(1)} ${sy.toFixed(1)} A ${wedgeR} ${wedgeR} 0 ${large} 1 ${ex2.toFixed(1)} ${ey2.toFixed(1)} Z`,
            );
            // Show the resulting absolute Self energy percentage, not the raw fraction —
            // that's what actually reads meaningfully with a nonzero drug baseline.
            this.selfKnobValueLabel.textContent = `${Math.round(this.selfEnergy * 100)}%`;
        };

        const move = (ev: PointerEvent) => {
            const raw = angleAt(ev);
            let delta = raw - this.selfKnobLastRawAngle;
            if (delta > 180) delta -= 360;
            if (delta < -180) delta += 360;
            this.selfKnobLastRawAngle = raw;
            this.selfKnobDragAngle += delta;
            render();
        };
        const up = () => {
            this.selfKnobWedge.style.display = "none";
            this.selfKnobValueBg.style.display = "none";
            this.selfKnobValueLabel.style.display = "none";
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        render();
    }

    private updateSelfKnobRing(): void {
        const KNOB_R = 20;
        const circumference = 2 * Math.PI * KNOB_R;
        // Ring fill mirrors the knob's physical 270° sweep (starts at -135° from up, i.e.
        // bottom-left, same convention as the drag wedge) rather than an arbitrary fill.
        const arcFraction = 270 / 360;
        const arcLength = circumference * arcFraction;
        const filled = arcLength * this.selfEnergy;
        this.selfKnobRing.setAttribute("stroke-dasharray", `${filled} ${circumference - filled}`);
        // An SVG <circle>'s dash pattern starts at its own 0° point, which is due right
        // (3 o'clock) — i.e. 90° clockwise from "up". To land the dash-start at -135°
        // from up (bottom-left, matching the drag wedge's start), rotate by -135 - 90 = -225,
        // equivalently +135.
        this.selfKnobRing.setAttribute("transform", `rotate(135 ${VERTEX_BY_NAME.self.x} ${VERTEX_BY_NAME.self.y})`);
    }

    // Configures the single shared dose slider for whichever drug is selected
    // in the picker: stepped snapping for drugs with doseSteps, else a free 0-100 slider.
    // Initializes the shared slider from whichever drug is picked, showing its currently
    // *administered* dose (this.doses[key]) as the starting pending value — the slider
    // only stages a new value until Administer is clicked.
    private configureSliderFor(drug: DrugEffect): void {
        const currentDose = this.doses[drug.key];
        if (drug.doseSteps) {
            const labels = drug.doseStepLabels ?? drug.doseSteps.map((f) => `${Math.round(f * 100)}%`);
            this.doseSlider.min = "0";
            this.doseSlider.max = String(drug.doseSteps.length - 1);
            this.doseSlider.step = "1";
            const idx = Math.max(0, drug.doseSteps.indexOf(currentDose));
            this.doseSlider.value = String(idx);
            // pendingDose must come from the same snapped step the slider/label show,
            // not the raw stored dose, since currentDose may not be an exact step value
            // (e.g. the 0 default doesn't match any of 5-MAPB's [0.8, 1] steps).
            this.pendingDose = drug.doseSteps[idx];
            this.doseValueLabel.textContent = labels[idx];
        } else {
            this.pendingDose = currentDose;
            this.doseSlider.min = "0";
            this.doseSlider.max = "100";
            this.doseSlider.step = "1";
            this.doseSlider.value = String(Math.round(currentDose * 100));
            this.doseValueLabel.textContent = this.formatFreeDose(drug, currentDose);
        }
        this.syncContraindications();
        this.updateAdministerBtn();
    }

    // Free-slider (non-stepped) drugs show their raw 0-100% fraction, unless they declare
    // a doseUnitRange (e.g. cannabis's 4-12mg delta-9 THC) to map onto instead.
    private formatFreeDose(drug: DrugEffect, fraction: number): string {
        if (drug.doseUnitRange) {
            const { min, max, unit } = drug.doseUnitRange;
            return `${lerp(min, max, fraction).toFixed(1)}${unit}`;
        }
        if (drug.doseUnitLogRange) {
            const { min, max, unit } = drug.doseUnitLogRange;
            const mg = min * Math.pow(max / min, fraction);
            return `${mg < 10 ? mg.toFixed(1) : Math.round(mg)}${unit}`;
        }
        return `${Math.round(fraction * 100)}%`;
    }

    private onSelectDrug(key: string): void {
        this.selectedDrugKey = key;
        this.configureSliderFor(DRUG_BY_KEY[key]);
        this.updateDrugWheelBtn();
    }

    private updateDrugWheelBtn(): void {
        this.setDrugWheelBtnLabelText(DRUG_BY_KEY[this.selectedDrugKey].name, this.drugWheelCenterX);
    }

    // Wraps the selected drug's name into up to two stacked tspans so it fits inside
    // the small always-visible button circle, same wrapping approach as the slices.
    private setDrugWheelBtnLabelText(name: string, x: number): void {
        this.drugWheelBtnLabel.textContent = "";
        const lines = wrapWheelLabel(name);
        lines.forEach((line, wi) => {
            const tspan = svgEl("tspan");
            tspan.setAttribute("x", String(x));
            tspan.setAttribute("dy", wi === 0 ? `${-(lines.length - 1) * 5.5}` : "11");
            tspan.textContent = line;
            this.drugWheelBtnLabel.appendChild(tspan);
        });
    }

    // Builds the button (always visible, left of Self) and the ring of drug slices
    // (hidden until the button is clicked) around the same center point.
    private buildDrugWheel(): void {
        const cx = this.drugWheelCenterX;
        const cy = this.drugWheelCenterY;
        const BTN_R = 22;

        this.drugWheelGroup = svgEl("g");

        this.drugWheelRing = svgEl("g");
        this.drugWheelRing.classList.add("ipe-drug-wheel");

        const backdrop = svgEl("circle");
        backdrop.classList.add("ipe-drug-wheel-backdrop");
        backdrop.setAttribute("cx", String(cx));
        backdrop.setAttribute("cy", String(cy));
        backdrop.setAttribute("r", "0");
        this.drugWheelRing.appendChild(backdrop);

        const itemCount = DRUGS.length;
        const angleStep = (2 * Math.PI) / itemCount;
        const thhIndex = DRUGS.findIndex((d) => d.key === "thh");
        const startAngle = -Math.PI / 2 - thhIndex * angleStep;
        const outerR = BTN_R + 100;
        const innerR = BTN_R + 6;
        this.drugWheelOuterR = outerR;
        // Half the gap's radial width in px, held constant across the wedge's radius —
        // the angular trim that produces this gap therefore shrinks as r grows
        // (arc length = angle * r), so the gap looks the same width at the rim as near
        // the center instead of flaring outward.
        const GAP_HALF_PX = 4;

        DRUGS.forEach((drug, i) => {
            const angle = startAngle + i * angleStep;
            const slice = svgEl("g");
            slice.classList.add("ipe-drug-wheel-slice");
            slice.dataset.key = drug.key;

            const bg = svgEl("path");
            bg.classList.add("ipe-drug-wheel-slice-bg");
            const halfStep = angleStep / 2;
            const innerHalfStep = Math.max(0, halfStep - GAP_HALF_PX / innerR);
            const outerHalfStep = Math.max(0, halfStep - GAP_HALF_PX / outerR);
            const p = (r: number, a: number) => ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
            const i0 = p(innerR, angle - innerHalfStep);
            const i1 = p(innerR, angle + innerHalfStep);
            const o0 = p(outerR, angle - outerHalfStep);
            const o1 = p(outerR, angle + outerHalfStep);
            const largeArc = outerHalfStep * 2 > Math.PI ? 1 : 0;
            bg.setAttribute(
                "d",
                `M ${i0.x} ${i0.y} L ${o0.x} ${o0.y} A ${outerR} ${outerR} 0 ${largeArc} 1 ${o1.x} ${o1.y} L ${i1.x} ${i1.y} A ${innerR} ${innerR} 0 ${largeArc} 0 ${i0.x} ${i0.y} Z`,
            );
            slice.appendChild(bg);

            const textR = (innerR + outerR) / 2;
            const tp = p(textR, angle);
            const label = svgEl("text");
            label.classList.add("ipe-drug-wheel-slice-label");
            label.setAttribute("x", String(tp.x));
            label.setAttribute("y", String(tp.y));
            const lines = wrapWheelLabel(drug.name);
            lines.forEach((line, wi) => {
                const tspan = svgEl("tspan");
                tspan.setAttribute("x", String(tp.x));
                tspan.setAttribute("dy", wi === 0 ? `${-(lines.length - 1) * 5.5}` : "11");
                tspan.textContent = line;
                label.appendChild(tspan);
            });
            slice.appendChild(label);

            // pointerdown must also be stopped here, not just click: the global
            // svg pointerdown listener (onPointerDown) closes the wheel on outside
            // clicks, and pointerdown fires before click — without this, clicking a
            // slice closes the wheel first and the click that follows lands on
            // nothing, silently swallowing the selection.
            slice.addEventListener("pointerdown", (e) => e.stopPropagation());
            slice.addEventListener("click", (e) => {
                e.stopPropagation();
                this.onSelectDrug(drug.key);
                this.closeDrugWheel();
            });
            this.drugWheelRing.appendChild(slice);
        });

        const center = svgEl("circle");
        center.classList.add("ipe-drug-wheel-center");
        center.setAttribute("cx", String(cx));
        center.setAttribute("cy", String(cy));
        center.setAttribute("r", String(BTN_R));
        center.addEventListener("pointerdown", (e) => e.stopPropagation());
        center.addEventListener("click", (e) => {
            e.stopPropagation();
            this.closeDrugWheel();
        });
        this.drugWheelRing.appendChild(center);

        const closeX = svgEl("text");
        closeX.classList.add("ipe-drug-wheel-close");
        closeX.setAttribute("x", String(cx));
        closeX.setAttribute("y", String(cy));
        closeX.textContent = "✕";
        this.drugWheelRing.appendChild(closeX);

        this.drugWheelGroup.appendChild(this.drugWheelRing);

        // The always-visible trigger button, drawn on top so it stays clickable
        // whether or not the ring is open.
        this.drugWheelBtn = svgEl("g");
        this.drugWheelBtn.classList.add("ipe-drug-wheel-btn");
        const btnRing = svgEl("circle");
        btnRing.classList.add("ipe-drug-wheel-btn-ring");
        btnRing.setAttribute("cx", String(cx));
        btnRing.setAttribute("cy", String(cy));
        btnRing.setAttribute("r", String(BTN_R));
        this.drugWheelBtn.appendChild(btnRing);

        this.drugWheelBtnLabel = svgEl("text");
        this.drugWheelBtnLabel.classList.add("ipe-drug-wheel-btn-label");
        this.drugWheelBtnLabel.setAttribute("x", String(cx));
        this.drugWheelBtnLabel.setAttribute("y", String(cy));
        this.setDrugWheelBtnLabelText(DRUG_BY_KEY[this.selectedDrugKey].name, cx);
        this.drugWheelBtn.appendChild(this.drugWheelBtnLabel);

        this.drugWheelBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
        this.drugWheelBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (this.drugWheelOpen) this.closeDrugWheel();
            else this.openDrugWheel();
        });

        this.drugWheelGroup.appendChild(this.drugWheelBtn);
        this.svg.appendChild(this.drugWheelGroup);
    }

    private openDrugWheel(): void {
        this.drugWheelOpen = true;
        this.root.classList.add("ipe-wheel-open");
        this.drugWheelRing.classList.add("ipe-open");
        // Hide the always-visible trigger button while open: it sits on top of the
        // ring's own center circle + close X, and its selected-drug label would
        // otherwise overlap and be unreadable against the X.
        this.drugWheelBtn.style.visibility = "hidden";
        for (const slice of Array.from(this.drugWheelRing.querySelectorAll<SVGGElement>(".ipe-drug-wheel-slice"))) {
            slice.classList.toggle("ipe-selected", slice.dataset.key === this.selectedDrugKey);
        }
        const backdrop = this.drugWheelRing.querySelector<SVGCircleElement>(".ipe-drug-wheel-backdrop")!;
        backdrop.setAttribute("r", String(this.drugWheelOuterR));
    }

    private closeDrugWheel(): void {
        this.drugWheelOpen = false;
        this.root.classList.remove("ipe-wheel-open");
        this.drugWheelRing.classList.remove("ipe-open");
        this.drugWheelBtn.style.visibility = "visible";
        const backdrop = this.drugWheelRing.querySelector<SVGCircleElement>(".ipe-drug-wheel-backdrop")!;
        backdrop.setAttribute("r", "0");
    }

    // Moving the slider only stages a pending value and updates its label — it does not
    // take effect (pull the region, spawn the cannabis part, boost Self energy, etc.)
    // until Administer is clicked.
    private onSliderInput(): void {
        const drug = DRUG_BY_KEY[this.selectedDrugKey];
        if (drug.doseSteps) {
            const idx = Number(this.doseSlider.value);
            this.pendingDose = drug.doseSteps[idx];
            const labels = drug.doseStepLabels ?? drug.doseSteps.map((f) => `${Math.round(f * 100)}%`);
            this.doseValueLabel.textContent = labels[idx];
        } else {
            this.pendingDose = Number(this.doseSlider.value) / 100;
            this.doseValueLabel.textContent = this.formatFreeDose(drug, this.pendingDose);
        }
        this.updateAdministerBtn();
    }

    private updateAdministerBtn(): void {
        // Always clickable (re-administering the same dose is allowed) except when the
        // slider itself is disabled, e.g. a hard contraindication with another drug.
        this.administerBtn.disabled = this.doseSlider.disabled;
    }

    private onAdminister(): void {
        const drug = DRUG_BY_KEY[this.selectedDrugKey];
        const error = this.mapbExclusivityError(drug);
        if (error) {
            this.warningEl.textContent = error;
            return;
        }
        this.administeredKeys.add(drug.key);
        this.onDoseChange(drug, this.pendingDose);
        this.updateAdministerBtn();
    }

    // 5-MAPB is exclusive: it cannot be combined with anything else, in either direction —
    // administering it while another drug is active, or administering another drug while
    // it's active. Returns the error message to show, or null if the administer is fine.
    private mapbExclusivityError(drug: DrugEffect): string | null {
        const otherActive = DRUGS.some((d) => d.key !== "mapb" && this.isActive(d.key));
        if (drug.key === "mapb" && otherActive) {
            return "Should not combine 5-MAPB with another drug";
        }
        if (drug.key !== "mapb" && this.isActive("mapb")) {
            return "Should not combine with 5-MAPB";
        }
        return null;
    }

    private onDoseChange(drug: DrugEffect, value: number): void {
        this.doses[drug.key] = value;

        if (drug.rendersAsPart) {
            this.syncCannabisPart(drug);
        }

        this.updateSelfEnergyBaseline();
        this.syncContraindications();
        this.updateWarning();
        this.updateAppliedList();
    }

    // Recomputes the drug-set Self energy baseline from every currently administered
    // dose's selfEnergyBoostSteps (summed across substances). Only the baseline changes
    // here — selfEnergyUserFraction is left alone, so the knob keeps its relative
    // position within the (possibly now different) range above the new baseline.
    private updateSelfEnergyBaseline(): void {
        let baseline = 0;
        for (const drug of DRUGS) {
            if (drug.selfEnergyBoostSteps && drug.doseSteps) {
                const idx = drug.doseSteps.indexOf(this.doses[drug.key]);
                if (idx >= 0) baseline += drug.selfEnergyBoostSteps[idx] ?? 0;
            } else if (drug.selfEnergyBoostMax !== undefined) {
                baseline += drug.selfEnergyBoostMax * this.doses[drug.key];
            }
        }
        this.selfEnergyBaseline = baseline;
        this.updateSelfKnobRing();
    }

    private cancelDrug(drug: DrugEffect): void {
        this.administeredKeys.delete(drug.key);
        this.onDoseChange(drug, 0);
        if (this.selectedDrugKey === drug.key) {
            this.configureSliderFor(drug);
        }
    }

    private isActive(key: string): boolean {
        return this.administeredKeys.has(key);
    }

    // Disables the picker (for the currently selected drug only) when it's hard-contraindicated
    // with one already administered. Caution-level interactions are never blocked, only warned.
    private syncContraindications(): void {
        const blocked = new Set<string>();
        for (const interaction of INTERACTIONS) {
            if (interaction.severity !== "contraindicated") continue;
            if (this.isActive(interaction.a)) blocked.add(interaction.b);
            if (this.isActive(interaction.b)) blocked.add(interaction.a);
        }
        const disabled = blocked.has(this.selectedDrugKey) && !this.isActive(this.selectedDrugKey);
        this.doseSlider.disabled = disabled;
        this.pickerRow.classList.toggle("ipe-disabled", disabled);
        this.updateAdministerBtn();
    }

    private updateWarning(): void {
        const messages: string[] = [];
        for (const interaction of INTERACTIONS) {
            if (this.isActive(interaction.a) && this.isActive(interaction.b)) {
                const nameA = DRUG_BY_KEY[interaction.a].name;
                const nameB = DRUG_BY_KEY[interaction.b].name;
                const icon = interaction.severity === "contraindicated" ? "⚠" : "⚑";
                messages.push(`${icon} ${nameA} + ${nameB}: ${interaction.note}.`);
            }
        }
        this.warningEl.textContent = messages.join(" ");
    }

    private updateAppliedList(): void {
        this.appliedListEl.textContent = ""; // clear all child rows
        const applied = DRUGS.filter((d) => this.isActive(d.key));

        applied.forEach((d, i) => {
            const dose = this.doses[d.key];
            const label = d.doseStepLabels
                ? (d.doseStepLabels[d.doseSteps!.indexOf(dose)] ?? `${Math.round(dose * 100)}%`)
                : this.formatFreeDose(d, dose);
            const y = this.appliedListY + i * 14;
            const unitSuffix = d.doseUnitRange ? " Δ9-THC" : "";

            const label_ = svgEl("text");
            label_.classList.add("ipe-applied-list");
            label_.setAttribute("x", String(this.appliedListX));
            label_.setAttribute("y", String(y));
            label_.textContent = `${d.emoji} ${d.name} ${label}${unitSuffix}`;
            this.appliedListEl.appendChild(label_);

            // Rough estimate of the label's rendered width so the X sits right after it —
            // SVG has no reliable measured-width-before-layout API without getBBox, which
            // would force a synchronous reflow every update; a per-char estimate is fine here.
            const estWidth = label_.textContent.length * 6.2;
            const x = svgEl("text");
            x.classList.add("ipe-applied-x");
            x.setAttribute("x", String(this.appliedListX + estWidth + 4));
            x.setAttribute("y", String(y));
            x.textContent = "✕";
            x.addEventListener("pointerdown", (e) => e.stopPropagation());
            x.addEventListener("click", () => this.cancelDrug(d));
            this.appliedListEl.appendChild(x);
        });
    }

    private syncCannabisPart(drug: DrugEffect): void {
        if (!this.isActive(drug.key)) {
            if (this.cannabisPart) {
                this.cannabisPart.fadingOut = true;
                this.cannabisPart = null;
            }
            return;
        }
        const target = VERTEX_BY_NAME.blended;
        if (!this.cannabisPart) {
            const spawnX = target.x;
            const spawnY = target.y - 40;
            const el = svgEl("text");
            el.classList.add("ipe-part");
            el.setAttribute("x", String(spawnX));
            el.setAttribute("y", String(spawnY));
            el.style.opacity = "0";
            el.textContent = "🌿";
            const part: Part = {
                emoji: "🌿",
                feeling: "mellow",
                x: spawnX,
                y: spawnY,
                vx: 0,
                vy: 0,
                opacity: 0,
                fadingOut: false,
                el,
                // Cannabis's blend propensity is set by its dose fraction rather than
                // sampled randomly, and kept in sync below as the dose changes.
                blendPropensity: this.doses.cannabis,
            };
            el.addEventListener("pointerdown", (e) => {
                e.stopPropagation();
                this.startDrag(part, e);
            });
            this.svg.appendChild(el);
            this.cannabisPart = part;
            this.parts.push(part);
        } else {
            this.cannabisPart.blendPropensity = this.doses.cannabis;
        }
    }

    // Every RegionPressure currently in play, from every source — presently just
    // drugs that declare `pull` (excludes cannabis, which renders as its own part
    // instead, and THH, which only acts on individual parts; see the tick() loop's
    // unblendPush). Region-placement code below consumes this flat list without
    // knowing anything about drugs.
    private collectRegionPressures(): RegionPressure[] {
        const pressures: RegionPressure[] = [];
        for (const drug of DRUGS) {
            if (!drug.pull || drug.rendersAsPart || !this.isActive(drug.key)) continue;
            const dose = this.doses[drug.key];
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

    private computeTargetCentroid(): { x: number; y: number } {
        // Base weight: no parts -> pinned near Self, scaled by ambient Self energy (the
        // Self knob). Low Self energy weakens this anchor and adds a drift toward blended,
        // so the boundary collapses that way even with no parts or drug pull present.
        const wSelf = 1.0 * this.selfEnergy;
        const wBlendedDrift = 0.9 * (1 - this.selfEnergy);
        let sumX = wSelf * VERTEX_BY_NAME.self.x + wBlendedDrift * VERTEX_BY_NAME.blended.x;
        let sumY = wSelf * VERTEX_BY_NAME.self.y + wBlendedDrift * VERTEX_BY_NAME.blended.y;
        let sumW = wSelf + wBlendedDrift;

        for (const p of this.parts) {
            // Weight contribution is the part's own position, not the vertex — so a part
            // sitting anywhere in the field pulls the boundary to it. Weighted heavily so
            // it's easy for even one part to stretch the region out toward a corner.
            // Scaled by the part's own fade-in/out opacity so it only starts pulling the
            // boundary as it becomes visible, and releases its pull as it fades away,
            // instead of jumping to full influence the instant it spawns or is reaped.
            const w = 2.2 * p.opacity;
            sumX += w * p.x;
            sumY += w * p.y;
            sumW += w;
        }

        for (const pressure of this.collectRegionPressures()) {
            sumX += pressure.weight * pressure.x;
            sumY += pressure.weight * pressure.y;
            sumW += pressure.weight;
        }

        return { x: sumX / sumW, y: sumY / sumW };
    }

    // How tightly the boundary should hug its contents right now: driven by how
    // concentrated the active region pressure is (a single vertex = narrow, focused; an
    // even/absent pull = diffuse, relaxed) and by how few parts are present.
    private computeTargetShrinkWrap(): number {
        const pressures = this.collectRegionPressures();
        if (pressures.length === 0) {
            // No substance dictating focus: more parts present reads as more diffuse
            // (attention spread across several things), fewer/none as more relaxed.
            // Weighted by opacity so a part fading in/out ramps this smoothly rather
            // than stepping the instant it's added to/removed from the array.
            const weightedCount = this.parts.reduce((sum, p) => sum + p.opacity, 0);
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

    private computeRadius(): number {
        const pressures = this.collectRegionPressures();
        if (this.parts.length === 0 && pressures.length === 0) {
            // Relaxed default breathes a bit looser than a fully shrink-wrapped empty field.
            return lerp(this.baseRadius * 1.15, this.baseRadius * 0.8, this.shrinkWrap);
        }
        // Farthest part's distance from centroid, or a small floor if there are none
        // (e.g. drug pull alone with no parts on the field). Each part's reach is scaled
        // by its own opacity so a spawning/fading part only stretches the boundary out to
        // its full distance once it's actually visible.
        let farthest = this.baseRadius * 0.5;
        for (const p of this.parts) {
            const dist = lerp(farthest, Math.hypot(p.x - this.centroid.x, p.y - this.centroid.y), p.opacity);
            farthest = Math.max(farthest, dist);
        }
        // Loose: generous padding beyond the farthest content, boundary hangs slack.
        // Tight: boundary shrink-wraps right up against it, almost no padding.
        const loosePadding = 90;
        const tightPadding = 18;
        const padding = lerp(loosePadding, tightPadding, this.shrinkWrap);
        let spread = farthest + padding;

        for (const pressure of pressures) {
            // Pressure concentrated on one vertex narrows focus; a balanced one diffuses it.
            const factor = lerp(1.3, 0.75, (pressure.narrowness - 0.33) / 0.67);
            spread *= lerp(1, factor, pressure.weight / 1.8);
        }

        // Self energy continuously weighs how much the boundary is pulled to fully encompass
        // Self, however far the centroid has drifted toward the parts: at full energy the
        // boundary is required to reach Self outright; as energy drops that requirement
        // fades smoothly, freeing the boundary to shrink-wrap tightly around just the parts
        // and increasingly fail to reach Self.
        const distToSelf = Math.hypot(this.centroid.x - VERTEX_BY_NAME.self.x, this.centroid.y - VERTEX_BY_NAME.self.y);
        const selfInclusionRadius = (distToSelf + 24) * this.selfEnergy;
        spread = Math.max(spread, selfInclusionRadius);

        return spread;
    }

    private updateReadout(): void {
        // Self energy is always a live, relevant quantity — not just when the boundary
        // happens to be nearest the Self vertex — so its words always show.
        const qualities = selfQualitiesFor(this.selfEnergy);

        const activeFeelings = Array.from(
            new Set(
                this.parts
                    .filter((p) => !p.fadingOut)
                    .map((p) => {
                        const word = blendIntensityWord(p.blendPropensity);
                        return word ? `${word} ${p.feeling}` : p.feeling;
                    }),
            ),
        );

        this.readoutTitle.textContent = focusPhrase(this.currentRadius);
        this.readoutBody.textContent = `${qualities.join(", ")}.`;
        this.readoutFeelings.textContent = activeFeelings.length ? `parts: ${activeFeelings.join(", ")}` : "";
    }

    private tick(ts: number): void {
        const dt = this.lastTs ? Math.min(0.05, (ts - this.lastTs) / 1000) : 0;
        this.lastTs = ts;

        // Parts wander freely in their band (no pull back toward the centroid — that's
        // what lets them drift all the way out to the blended/unblended corners and
        // stretch the boundary), pushed away from blended (scaled by Self energy) and
        // from each other, unless dragged. The triangle-shaped clamp (clampPartPosition)
        // already keeps them out of the Self zone, so there's no separate Self-repulsion force.
        const AVOID_PART_RADIUS = 40;
        // Summed once per frame (not per-part): total direct push away from blended
        // contributed by active drugs' unblendPushMax (e.g. THH), scaled by dose fraction.
        let unblendPush = 0;
        for (const drug of DRUGS) {
            if (drug.unblendPushMax === undefined) continue;
            unblendPush += drug.unblendPushMax * this.doses[drug.key];
        }
        for (const p of this.parts) {
            if (p === this.draggingPart) continue;
            // Gentle random wander so idle parts still meander instead of sitting frozen.
            p.vx += (Math.random() - 0.5) * 12 * dt;
            p.vy += (Math.random() - 0.5) * 12 * dt;

            // Ambient Self energy pushes each part directly away from the blended corner —
            // more Self energy, more pressure away from blending, with no preference for
            // Self, unblended, or the midpoint between them. Routed through a sigmoid rather
            // than scaling linearly: little force from 0-0.25 energy, a transition through
            // the middle, and near-max force by about 0.4 and up.
            // selfPushFactor and blendPropensity below are both normalized to a 0-1
            // "blending force" scale, so blendPropensity directly says what ambient Self
            // energy it takes to override that part: at selfPushFactor approaching 0.9,
            // ambient Self energy overrides the ~90% of parts whose blendPropensity is
            // below 0.9. BLEND_FORCE_SCALE converts that normalized force to velocity units.
            const selfPushFactor = sigmoid(this.selfEnergy, 0.325, 28);
            const selfPush = selfPushFactor * BLEND_FORCE_SCALE;
            const bdx = p.x - VERTEX_BY_NAME.blended.x;
            const bdy = p.y - VERTEX_BY_NAME.blended.y;
            const bDist = Math.hypot(bdx, bdy);
            let pushDirX = 0;
            let pushDirY = 0;
            if (bDist > 0.01) {
                pushDirX = bdx / bDist;
                pushDirY = bdy / bDist;
                p.vx += pushDirX * (selfPush + unblendPush * BLEND_FORCE_SCALE) * dt;
                p.vy += pushDirY * (selfPush + unblendPush * BLEND_FORCE_SCALE) * dt;
            }

            // Gentle "unblending"-style force from Self: pushes each part further along
            // the line from Self through the part's own current position — no bias toward
            // blended or unblended — linear in Self energy, unlike the sigmoid-shaped
            // blended-push above.
            const sdx = p.x - VERTEX_BY_NAME.self.x;
            const sdy = p.y - VERTEX_BY_NAME.self.y;
            const sDist = Math.hypot(sdx, sdy);
            if (sDist > 0.01) {
                const selfEdgePush = this.selfEnergy * 6;
                p.vx += (sdx / sDist) * selfEdgePush * dt;
                p.vy += (sdy / sDist) * selfEdgePush * dt;
            }

            // Each part's own blendPropensity applies a steady pull toward the blended
            // corner, independent of ambient Self energy — the opposite direction from the
            // selfPush force above, so a high-propensity part drifts toward blended even
            // while Self energy is also pushing it away. Sampled once at creation for
            // ordinary parts; for cannabis's leaf part it instead tracks the administered
            // dose fraction directly (see syncCannabisPart), so THC dose sets its pull.
            if (p.blendPropensity > 0 && bDist > 0.01) {
                // blendPropensity (already 0-1) is directly the part's own maximum
                // blending force on the same normalized scale as selfPushFactor above.
                const blendPull = p.blendPropensity * BLEND_FORCE_SCALE;
                p.vx += -pushDirX * blendPull * dt;
                p.vy += -pushDirY * blendPull * dt;
            }

            for (const other of this.parts) {
                if (other === p) continue;
                const odx = p.x - other.x;
                const ody = p.y - other.y;
                const oDist = Math.hypot(odx, ody);
                if (oDist < AVOID_PART_RADIUS && oDist > 0.01) {
                    const push = (1 - oDist / AVOID_PART_RADIUS) * 50;
                    p.vx += (odx / oDist) * push * dt;
                    p.vy += (ody / oDist) * push * dt;
                }
            }

            p.vx *= 0.95;
            p.vy *= 0.95;
            const clamped = this.clampPartPosition(p.x + p.vx, p.y + p.vy);
            p.x = clamped.x;
            p.y = clamped.y;
            p.el.setAttribute("x", String(p.x));
            p.el.setAttribute("y", String(p.y));

            const targetOpacity = p.fadingOut ? 0 : 1;
            p.opacity = lerp(p.opacity, targetOpacity, 1 - Math.exp(-6 * dt));
            p.el.style.opacity = String(p.opacity);
        }

        if (this.parts.some((p) => p.fadingOut && p.opacity < 0.02)) {
            for (const p of this.parts) {
                if (p.fadingOut && p.opacity < 0.02) p.el.remove();
            }
            this.parts = this.parts.filter((p) => !(p.fadingOut && p.opacity < 0.02));
        }

        this.targetCentroid = this.computeTargetCentroid();
        this.centroid.x = lerp(this.centroid.x, this.targetCentroid.x, 1 - Math.exp(-3.5 * dt));
        this.centroid.y = lerp(this.centroid.y, this.targetCentroid.y, 1 - Math.exp(-3.5 * dt));

        this.targetShrinkWrap = this.computeTargetShrinkWrap();
        this.shrinkWrap = lerp(this.shrinkWrap, this.targetShrinkWrap, 1 - Math.exp(-1.5 * dt));

        const radius = this.computeRadius();
        this.currentRadius = radius;
        this.wobblePhase = this.wobblePhase.map((ph, i) => ph + dt * (0.6 + i * 0.23));

        this.regionPath.setAttribute("d", this.buildRegionPath(radius));
        this.updateReadout();

        if (this.debugEnabled) this.updateDebugOverlay();

        requestAnimationFrame((next) => this.tick(next));
    }

    // Renders exactly what's driving the boundary's current placement: the target vs.
    // eased centroid, each contribution's weight, the shrink-wrap latent, and whether
    // (and how far) the Self-inclusion constraint is currently stretching the radius.
    private updateDebugOverlay(): void {
        this.debugTargetDot.setAttribute("cx", String(this.targetCentroid.x));
        this.debugTargetDot.setAttribute("cy", String(this.targetCentroid.y));
        this.debugCentroidDot.setAttribute("cx", String(this.centroid.x));
        this.debugCentroidDot.setAttribute("cy", String(this.centroid.y));

        this.debugPartLines.textContent = "";
        for (const p of this.parts) {
            const line = svgEl("line");
            line.classList.add("ipe-debug-part-line");
            line.setAttribute("x1", String(this.centroid.x));
            line.setAttribute("y1", String(this.centroid.y));
            line.setAttribute("x2", String(p.x));
            line.setAttribute("y2", String(p.y));
            this.debugPartLines.appendChild(line);
        }

        const wSelf = 1.0 * this.selfEnergy;
        const wBlendedDrift = 0.9 * (1 - this.selfEnergy);
        const pullDrugs = DRUGS.filter((d) => d.pull && !d.rendersAsPart && this.isActive(d.key));
        const distToSelf = Math.hypot(this.centroid.x - VERTEX_BY_NAME.self.x, this.centroid.y - VERTEX_BY_NAME.self.y);
        const selfInclusionRadius = (distToSelf + 24) * this.selfEnergy;
        const selfConstraintActive = selfInclusionRadius > this.currentRadius - 0.5;

        this.debugSelfLine.setAttribute("x1", String(this.centroid.x));
        this.debugSelfLine.setAttribute("y1", String(this.centroid.y));
        this.debugSelfLine.setAttribute("x2", String(VERTEX_BY_NAME.self.x));
        this.debugSelfLine.setAttribute("y2", String(VERTEX_BY_NAME.self.y));
        this.debugSelfLine.style.display = selfConstraintActive ? "" : "none";

        const lines: string[] = [];
        lines.push(`selfEnergy: ${this.selfEnergy.toFixed(2)} (baseline ${this.selfEnergyBaseline.toFixed(2)} + fraction ${this.selfEnergyUserFraction.toFixed(2)})`);
        lines.push(`centroid weights: self=${wSelf.toFixed(2)} blendedDrift=${wBlendedDrift.toFixed(2)}`);
        lines.push(`parts: ${this.parts.length} (weight 2.2 each)${this.parts.length ? " @ " + this.parts.map((p) => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(", ") : ""}`);
        if (pullDrugs.length) {
            lines.push(
                "drug pull: " +
                pullDrugs
                    .map((drug) => `${drug.name} dose=${this.doses[drug.key].toFixed(2)} pull=(self ${drug.pull!.self}, blended ${drug.pull!.blended}, unblended ${drug.pull!.unblended})`)
                    .join("; "),
            );
        } else {
            lines.push("drug pull: none");
        }
        lines.push(`target centroid: (${this.targetCentroid.x.toFixed(1)}, ${this.targetCentroid.y.toFixed(1)})  actual: (${this.centroid.x.toFixed(1)}, ${this.centroid.y.toFixed(1)})`);
        lines.push(`shrinkWrap: ${this.shrinkWrap.toFixed(2)} (target ${this.targetShrinkWrap.toFixed(2)})`);
        lines.push(`radius: ${this.currentRadius.toFixed(1)}  selfInclusionRadius: ${selfInclusionRadius.toFixed(1)}${selfConstraintActive ? " <- ACTIVE, setting the floor" : ""}`);
        lines.push(`distToSelf: ${distToSelf.toFixed(1)}`);

        this.debugPanel.textContent = lines.join("\n");
    }

    private buildRegionPath(radius: number): string {
        const N = 24;
        // A loose boundary has slack and wobbles more; a shrink-wrapped one is taut and crisp.
        const wobbleScale = lerp(1, 0.35, this.shrinkWrap);
        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i < N; i++) {
            const a = (i / N) * Math.PI * 2;
            const wobble =
                wobbleScale *
                (6 * Math.sin(a * 3 + this.wobblePhase[0]) +
                    4 * Math.sin(a * 5 - this.wobblePhase[1]) +
                    3 * Math.sin(a * 2 + this.wobblePhase[2]));
            const r = radius + wobble;
            pts.push({ x: this.centroid.x + Math.cos(a) * r, y: this.centroid.y + Math.sin(a) * r });
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
}

const container = document.getElementById("inward-perspective-explorer");
if (container) new InwardPerspectiveExplorer(container);
