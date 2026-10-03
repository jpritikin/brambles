// Interactive pharmacokinetics simulator for the Stahl Shrine's
// "Pharmacokinetics" section (content/docs/psychoactive/stahl-shrine/_index.md).
// This is speculation dressed as a model: nobody has run assays on any of
// this. It exists to make the ergine/kykeon conversion theory concrete enough
// to poke at, not to claim it's measured.
//
// Three compartments: pre-barrier pool (ergine + barley grass aldehydes), barrier
// (converts ergine to kykeon 1:1 by mass whenever any aldehyde is present,
// otherwise passes ergine through untouched; ALDH degrades the barrier's
// aldehyde pool at a diet-dependent rate), and brain (kykeon decays on a
// short half-life; ergine barely decays on its own and is instead knocked
// down by discrete urination events, a Poisson process whose rate is itself
// suppressed by how much ergine is currently in the brain).

const T_END = 8 * 60; // minutes, session horizon
const DT = 0.5; // minute step
const KYKEON_HALF_LIFE = 15; // min
const ERGINE_HALF_LIFE = 24 * 60; // min
const PEE_FRACTION = 0.33;
const PEE_RATE_SIPPING = 1 / 30;
const PEE_RATE_BASELINE = 1 / 120; // ordinary incidental water intake, no deliberate sipping
const PEE_INTERVAL_SIPPING_LABEL = `~1 pee / ${Math.round(1 / PEE_RATE_SIPPING)} min`;
const SIPPING_KYKEON_THRESHOLD_MG = 1; // sipping only boosts pee rate while kykeon hasn't built up
const ERGINE_KIDNEY_SLOWDOWN = 1 / 40; // higher brain ergine suppresses the urge to pee
const ALDH_RATE_DIET = 0.02; // g/min, zero-order (saturated) ALDH clearance, preserving diet
const ALDH_RATE_NORMAL = 0.03; // g/min, zero-order (saturated) ALDH clearance, normal diet
// Glutathione conjugation, AKR/ADH reduction, protein adduction, and pulmonary
// loss are all first-order (or pseudo-first-order) in aldehyde concentration,
// unlike ALDH which saturates. Lumped into one fractional rate constant so the
// barrier aldehyde pool actually reaches zero instead of tailing off forever
// under the zero-order term alone. Magnitude is a guess, not a measurement.
const ALDEHYDE_OTHER_CLEARANCE_RATE = 0.006; // per-minute fractional clearance
const BARLEY_TRANSIT_TAU = 1.2; // min, pre-barrier pool -> barrier time constant for aldehydes
const ERGINE_NO_ALDEHYDE_RATIO = 0.5; // pre-barrier pool -> brain mass ratio for ergine when no aldehydes are present to convert it

const ERGINE_ONSET = 30;
const ERGINE_K = 4;
const ERGINE_THETA = 40;

function gammaPdf(t: number, k: number, theta: number): number {
    if (t <= 0) return 0;
    return Math.exp((k - 1) * Math.log(t) - t / theta);
}

function buildErgineReleaseFrac(): (t: number) => number {
    let norm = 0;
    for (let t = 0; t <= T_END; t += DT) norm += gammaPdf(t - ERGINE_ONSET, ERGINE_K, ERGINE_THETA) * DT;
    return (t: number) => {
        const tt = t - ERGINE_ONSET;
        return tt <= 0 ? 0 : gammaPdf(tt, ERGINE_K, ERGINE_THETA) / norm;
    };
}
const ergineReleaseFrac = buildErgineReleaseFrac();

interface BarleyDose {
    t: number;
    amount: number; // grams
}

interface SimPoint {
    t: number;
    preBarrierErgineMg: number;
    preBarrierAldG: number;
    barrierAldG: number;
    brainErgineMg: number;
    brainKykeonMg: number;
}

interface SimResult {
    series: SimPoint[];
    peeEvents: number[];
}

function mulberry32(seed: number): () => number {
    let a = seed | 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Ergine suppresses the urge to pee, so the Poisson rate isn't constant: it's
// diluted by however much ergine is sitting in the brain right now. This
// means pee events have to be drawn step-by-step alongside the main
// simulation (a time-inhomogeneous Poisson process) instead of precomputed
// up front.
function peeRateAt(baseRate: number, brainErgineMg: number): number {
    return baseRate / (1 + brainErgineMg * ERGINE_KIDNEY_SLOWDOWN);
}

function runSimulation(ergineMg: number, dietOn: boolean, sippingWater: boolean, doses: BarleyDose[], rngSeed: number): SimResult {
    const rand = mulberry32(rngSeed);
    const peeEvents: number[] = [];

    const aldhRate = dietOn ? ALDH_RATE_DIET : ALDH_RATE_NORMAL;
    const kykeonDecay = Math.log(2) / KYKEON_HALF_LIFE;
    const ergineDecay = Math.log(2) / ERGINE_HALF_LIFE;

    let preBarrierErgineRemaining = ergineMg;
    let preBarrierAld = 0;
    let barrierAld = 0;
    let brainErgine = 0;
    let brainKykeon = 0;

    const sortedDoses = doses.slice().sort((a, b) => a.t - b.t);
    let doseIdx = 0;
    const series: SimPoint[] = [];

    for (let t = 0; t <= T_END; t += DT) {
        while (doseIdx < sortedDoses.length && sortedDoses[doseIdx].t <= t) {
            preBarrierAld += sortedDoses[doseIdx].amount;
            doseIdx++;
        }

        const ergineOutRate = ergineReleaseFrac(t) * ergineMg;
        const ergineOut = Math.min(preBarrierErgineRemaining, ergineOutRate * DT);
        preBarrierErgineRemaining -= ergineOut;

        const aldOutRate = preBarrierAld / BARLEY_TRANSIT_TAU;
        const aldOut = Math.min(preBarrierAld, aldOutRate * DT);
        preBarrierAld -= aldOut;
        barrierAld += aldOut;

        const aldhLoss = Math.min(barrierAld, aldhRate * DT);
        barrierAld -= aldhLoss;

        const otherLoss = Math.min(barrierAld, barrierAld * ALDEHYDE_OTHER_CLEARANCE_RATE * DT);
        barrierAld -= otherLoss;

        const gateOpen = barrierAld > 1e-6;
        const kykeonIn = gateOpen ? ergineOut : 0; // 1:1 mass conversion
        const ergineThrough = gateOpen ? 0 : ergineOut * ERGINE_NO_ALDEHYDE_RATIO;

        brainKykeon = (brainKykeon + kykeonIn) * Math.exp(-kykeonDecay * DT);
        brainErgine = (brainErgine + ergineThrough) * Math.exp(-ergineDecay * DT);

        const baseRate = sippingWater && brainKykeon < SIPPING_KYKEON_THRESHOLD_MG ? PEE_RATE_SIPPING : PEE_RATE_BASELINE;
        if (rand() < peeRateAt(baseRate, brainErgine) * DT) {
            brainErgine *= 1 - PEE_FRACTION;
            peeEvents.push(t);
        }

        series.push({ t, preBarrierErgineMg: preBarrierErgineRemaining, preBarrierAldG: preBarrierAld, barrierAldG: barrierAld, brainErgineMg: brainErgine, brainKykeonMg: brainKykeon });
    }

    return { series, peeEvents };
}

const CHART_ERGINE_MG_MAX = 20;
const CHART_KYKEON_MG_MAX = 20;

// Effects are linear in brain mg, scaled to the chart's y-axis ceilings.
function effectFraction(amountMg: number, chartMaxMg: number): number {
    return Math.min(1, amountMg / chartMaxMg);
}

const TIER_FROM = { mild: 0.02, moderate: 0.25, high: 0.5, strong: 0.75 };
type Bucket = "none" | keyof typeof TIER_FROM;
interface Tier {
    from: number;
    text: string;
}

function bucket(v: number): Bucket {
    const reached = (Object.keys(TIER_FROM) as (keyof typeof TIER_FROM)[]).filter((k) => v >= TIER_FROM[k]);
    return reached.pop() ?? "none";
}

const ERGINE_TIERS: Tier[] = [
    { from: TIER_FROM.mild, text: "Mild ergine heaviness." },
    { from: TIER_FROM.moderate, text: "Relaxing heaviness (not unpleasant)." },
    { from: TIER_FROM.high, text: "Heavy sedation with dysphoric undertow." },
    { from: TIER_FROM.strong, text: "Heavy ergine dysphoria: sedation, nausea, crushing weight." },
];
const KYKEON_TIERS: Tier[] = [
    { from: TIER_FROM.mild, text: "Pleasant buzzing stimulation, open hearted fearlessness, enhanced empathy, huge smile." },
    { from: TIER_FROM.moderate, text: "Waves of love and bliss, deep connection with everyone, gratitude welling up, old burdens falling away." },
    { from: TIER_FROM.high, text: "Rapturous euphoria, boundless love for everything, ecstatic tears, the sense of self dissolving into joy." },
    { from: TIER_FROM.strong, text: "Unbelievable mindboggling euphoria." },
];
const OVERLAP_TIERS: Tier[] = [
    { from: TIER_FROM.mild, text: "The conflict drags on the experience a bit." },
    { from: TIER_FROM.moderate, text: "Like rowing a boat with one oar in the water and the other one pulling backward." },
    { from: TIER_FROM.high, text: "A tug of war, and you're the rope." },
    { from: TIER_FROM.strong, text: "You're doing the splits and it's not great." },
];

function describeEffect(v: number, tiers: Tier[]): string {
    return tiers.filter((t) => v >= t.from).pop()?.text ?? "";
}

function blendDescription(ergineEff: number, kykeonEff: number): string {
    const [strongerText, weakerText] = ergineEff > kykeonEff
        ? [describeEffect(ergineEff, ERGINE_TIERS), describeEffect(kykeonEff, KYKEON_TIERS)]
        : [describeEffect(kykeonEff, KYKEON_TIERS), describeEffect(ergineEff, ERGINE_TIERS)];
    const parts = [strongerText, weakerText, describeEffect(Math.min(ergineEff, kykeonEff), OVERLAP_TIERS)].filter(Boolean);
    return parts.length ? parts.join(" ") : "Nothing active yet. The body is still processing what you swallowed.";
}

function fmtTime(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return `${h}:${String(m).padStart(2, "0")}`;
}

// Parses times like "10:30am", "10:30 AM", "22:30" into minutes since midnight.
// Returns null if the string doesn't parse.
function parseClockTime(raw: string): number | null {
    const s = raw.trim().toLowerCase();
    if (s === "noon") return 12 * 60;
    if (s === "midnight") return 0;
    const m = s.match(/^(\d{1,2})(?:[:.]?(\d{2}))?\s*(?:([ap])\.?m?\.?)?$/);
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    const suffix = m[3] && `${m[3]}m`;
    if (min > 59) return null;
    if (suffix) {
        if (h < 1 || h > 12) return null;
        if (suffix === "am") h = h % 12;
        else h = (h % 12) + 12;
    } else if (h > 23) {
        return null;
    }
    return h * 60 + min;
}

// Formats an elapsed-minutes value as a wall-clock label given a start time
// (minutes since midnight), wrapping past midnight if needed.
function fmtClock(startMins: number, elapsedMins: number): string {
    let total = Math.round(startMins + elapsedMins) % (24 * 60);
    if (total < 0) total += 24 * 60;
    const h24 = Math.floor(total / 60);
    const m = total % 60;
    const suffix = h24 < 12 ? "am" : "pm";
    let h12 = h24 % 12;
    if (h12 === 0) h12 = 12;
    return `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

function fmtDuration(mins: number): string {
    const total = Math.round(mins);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) return `${m} min`;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function describeParams(state: SimState): string {
    const startMins = state.startTime ? parseClockTime(state.startTime) : null;
    const clock = (t: number) => (startMins !== null ? fmtClock(startMins, t) : `T+${fmtTime(t)}`);
    const doses = [...state.doses].sort((a, b) => a.t - b.t);
    const lines = [
        `Ergine: ${state.ergineMg} mg${startMins !== null ? ` at ${fmtClock(startMins, 0)}` : ""}`,
        `Diet: ${state.dietOn ? "on" : "off"}`,
        `Sipping water: ${state.sippingWater ? "yes" : "no"}`,
        "Barley grass doses:",
        ...doses.map((d, i) => {
            const gap = i === 0 ? `${fmtDuration(d.t)} after ergine` : `${fmtDuration(d.t - doses[i - 1].t)} after previous dose`;
            return `  ${i + 1}. ${d.amount.toFixed(d.amount % 1 === 0 ? 0 : 2)} g at ${clock(d.t)} (${gap})`;
        }),
    ];
    return lines.join("\n");
}

const SVG_NS = "http://www.w3.org/2000/svg";
const PAD = { l: 46, r: 16, t: 16, b: 34 };
const VB_W = 900;
const VB_H = 420;
const PLOT_W = VB_W - PAD.l - PAD.r;
const PLOT_H = VB_H - PAD.t - PAD.b;
const DOSE_MARKER_R = 14;
const DOSE_MARKER_HIT_R = 22;
const DOUBLE_TAP_MS = 400;
const COPY_PLAN_LABEL = "Copy plan";
const DOSE_ZONE_HALF_HEIGHT = DOSE_MARKER_HIT_R; // band around y=0 reserved for dose-marker interaction
const DOSE_AMOUNT_MIN = 0;
const DOSE_AMOUNT_MAX = 6;
const DOSE_DRAG_PX_PER_FULL_RANGE = PLOT_H / 2; // half the chart height of vertical drag sweeps the full amount range
const DOSE_DRAG_DEBOUNCE_MS = 20;

function xScale(t: number): number {
    return PAD.l + (t / T_END) * PLOT_W;
}
// v is a signed mg value: negative = ergine (below zero), positive = kykeon
// (above zero). Each half of the axis has its own scale, since ergine and
// kykeon have very different natural brain-mg ceilings.
function yScale(vMg: number): number {
    const half = PLOT_H / 2 - 8;
    const max = vMg >= 0 ? CHART_KYKEON_MG_MAX : CHART_ERGINE_MG_MAX;
    return PAD.t + PLOT_H / 2 - (vMg / max) * half;
}
function xToT(clientX: number, rect: DOMRect): number {
    const relX = ((clientX - rect.left) / rect.width) * VB_W;
    const frac = Math.min(1, Math.max(0, (relX - PAD.l) / PLOT_W));
    return frac * T_END;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
    return document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
}

interface SimState {
    ergineMg: number;
    dietOn: boolean;
    sippingWater: boolean;
    doses: BarleyDose[];
    rngSeed: number;
    startTime: string; // e.g. "10:30am"; empty means show t=0:00 style relative labels
}

function buildSimUI(container: HTMLElement): void {
    let state: SimState = { ergineMg: 100, dietOn: true, sippingWater: true, doses: [{ t: 30, amount: 3 }, { t: 140, amount: 3 }, { t: 250, amount: 1.5 }], rngSeed: 1, startTime: "" };
    let dragging: { dose: BarleyDose; pointerId: number; startClientY: number; startAmount: number } | null = null;
    let dragDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    container.classList.add("pk-sim");

    // ---- single combined panel ----
    const panel = el("div", "pk-panel");
    container.appendChild(panel);

    // ---- dosing section ----
    const grid = el("div", "pk-controls-grid");
    panel.appendChild(grid);

    const ergineField = el("div", "pk-field");
    const ergineLabelRow = el("label");
    ergineLabelRow.textContent = "Ergine weight incl. inert oils ";
    const ergineVal = el("span", "pk-val");
    ergineLabelRow.appendChild(ergineVal);
    const ergineInput = el("input");
    ergineInput.type = "range";
    ergineInput.min = "100";
    ergineInput.max = "300";
    ergineInput.step = "4";
    ergineField.append(ergineLabelRow, ergineInput);
    grid.appendChild(ergineField);

    const dietField = el("div", "pk-field");
    const dietLabelRow = el("label");
    dietLabelRow.textContent = "Aldehyde-preserving diet";
    const dietToggleRow = el("div", "pk-toggle-row");
    const dietSwitch = el("label", "pk-switch");
    const dietInput = el("input");
    dietInput.type = "checkbox";
    const dietTrack = el("span", "pk-track");
    const dietKnob = el("span", "pk-knob");
    dietSwitch.append(dietInput, dietTrack, dietKnob);
    const dietText = el("span");
    dietToggleRow.append(dietSwitch, dietText);
    dietField.append(dietLabelRow, dietToggleRow);
    grid.appendChild(dietField);

    const waterField = el("div", "pk-field");
    const waterLabelRow = el("label");
    waterLabelRow.textContent = "Sipping extra water";
    const waterToggleRow = el("div", "pk-toggle-row");
    const waterSwitch = el("label", "pk-switch");
    const waterInput = el("input");
    waterInput.type = "checkbox";
    const waterTrack = el("span", "pk-track");
    const waterKnob = el("span", "pk-knob");
    waterSwitch.append(waterInput, waterTrack, waterKnob);
    const waterText = el("span");
    waterToggleRow.append(waterSwitch, waterText);
    waterField.append(waterLabelRow, waterToggleRow);
    grid.appendChild(waterField);

    const dosesHint = el("p", "pk-hint");
    dosesHint.textContent = "Barley grass doses are the gold circles on the timeline below: drag left/right to change timing, up/down to change the amount, double-click the timeline to add one, or set amount to zero to remove it.";
    panel.appendChild(dosesHint);

    // ---- chart section ----
    const chartSection = el("div", "pk-section");
    const chartHeadingRow = el("div", "pk-chart-heading-row");
    const chartHeading = el("h3");
    chartHeading.textContent = "Brain effect timeline";

    const startTimeField = el("div", "pk-start-time-field");
    const startTimeLabel = el("label");
    startTimeLabel.textContent = "Ergine admin. time ";
    const startTimeInput = el("input");
    startTimeInput.type = "text";
    startTimeInput.className = "pk-start-time-input";
    startTimeInput.placeholder = "10:30am";
    startTimeLabel.appendChild(startTimeInput);
    startTimeField.appendChild(startTimeLabel);

    const copyParamsBtn = el("button", "pk-copy-params-btn");
    copyParamsBtn.type = "button";
    copyParamsBtn.textContent = COPY_PLAN_LABEL;

    chartHeadingRow.append(chartHeading, startTimeField, copyParamsBtn);

    const chartWrap = el("div", "pk-chart-wrap");
    const svg = svgEl("svg");
    svg.setAttribute("viewBox", `0 0 ${VB_W} ${VB_H}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.classList.add("pk-chart");
    chartWrap.appendChild(svg);
    const dragTooltip = el("div", "pk-dose-drag-tooltip");
    dragTooltip.hidden = true;
    chartWrap.appendChild(dragTooltip);
    chartSection.append(chartHeadingRow, chartWrap);
    panel.appendChild(chartSection);

    // ---- readout section ----
    const readoutSection = el("div", "pk-section");
    const readout = el("div", "pk-readout");

    const compartmentBlock = el("div", "pk-readout-block");
    const compartmentHeading = el("h4");
    compartmentHeading.textContent = "Body compartments (all measurements in fantasy units)";
    compartmentBlock.appendChild(compartmentHeading);

    function makeCompartmentRow(labelText: string): HTMLSpanElement {
        const row = el("div", "pk-compartment");
        const label = el("span");
        label.textContent = labelText;
        const amt = el("span", "pk-amt");
        row.append(label, amt);
        compartmentBlock.appendChild(row);
        return amt;
    }
    const cPreBarrierErgine = makeCompartmentRow("Pre-barrier · ergine");
    const cPreBarrierAld = makeCompartmentRow("Pre-barrier · aldehydes");
    const cBarrierAld = makeCompartmentRow("Barrier · aldehyde pool");
    const cBrainErgine = makeCompartmentRow("Brain · ergine");
    const cBrainKykeon = makeCompartmentRow("Brain · kykeon");

    const subjectiveBlock = el("div", "pk-readout-block");
    const subjectiveHeading = el("h4");
    subjectiveHeading.textContent = "Subjective state";
    subjectiveBlock.appendChild(subjectiveHeading);

    function makeBarRow(labelText: string, swatchClass: string): { fill: HTMLDivElement; maxed: HTMLDivElement; lbl: HTMLSpanElement } {
        const row = el("div", "pk-bar-row");
        const labelRow = el("div", "pk-bar-label");
        const label = el("span");
        label.textContent = labelText;
        const lbl = el("span");
        labelRow.append(label, lbl);
        const track = el("div", "pk-bar-track");
        const fill = el("div", `pk-bar-fill ${swatchClass}`);
        const maxed = el("div", "pk-bar-maxed");
        maxed.hidden = true;
        track.append(fill, maxed);
        row.append(labelRow, track);
        subjectiveBlock.appendChild(row);
        return { fill, maxed, lbl };
    }
    const ergineBar = makeBarRow("Ergine effect", "pk-bar-ergine");
    const kykeonBar = makeBarRow("Kykeon effect", "pk-bar-kykeon");
    const blendText = el("p", "pk-blend-text");
    blendText.textContent = "Run the simulation to see a readout.";
    subjectiveBlock.appendChild(blendText);

    readout.append(compartmentBlock, subjectiveBlock);
    readoutSection.append(readout);
    panel.appendChild(readoutSection);

    // ---- wiring ----
    function syncControls(): void {
        ergineInput.value = String(state.ergineMg);
        ergineVal.textContent = `${state.ergineMg}mg`;
        dietInput.checked = state.dietOn;
        dietText.textContent = state.dietOn ? "On — ALDH runs slow" : "Off — ALDH runs fast";
        waterInput.checked = state.sippingWater;
        waterText.textContent = state.sippingWater ? `Yes — ${PEE_INTERVAL_SIPPING_LABEL}` : "No — ordinary incidental sipping only";
    }

    ergineInput.addEventListener("input", () => {
        state.ergineMg = Number(ergineInput.value);
        ergineVal.textContent = `${state.ergineMg}mg`;
        run();
    });
    dietInput.addEventListener("change", () => {
        state.dietOn = dietInput.checked;
        dietText.textContent = state.dietOn ? "On — ALDH runs slow" : "Off — ALDH runs fast";
        run();
    });
    waterInput.addEventListener("change", () => {
        state.sippingWater = waterInput.checked;
        waterText.textContent = state.sippingWater ? `Yes — ${PEE_INTERVAL_SIPPING_LABEL}` : "No — ordinary incidental sipping only";
        run();
    });

    startTimeInput.addEventListener("change", () => {
        const raw = startTimeInput.value.trim();
        if (raw === "") {
            state.startTime = "";
            run();
            return;
        }
        const parsed = parseClockTime(raw);
        if (parsed === null) {
            startTimeInput.classList.add("pk-input-invalid");
            return;
        }
        startTimeInput.classList.remove("pk-input-invalid");
        state.startTime = raw;
        run();
    });

    copyParamsBtn.addEventListener("click", () => {
        const text = describeParams(state);
        navigator.clipboard?.writeText(text).then(
            () => {
                copyParamsBtn.textContent = "Copied!";
                setTimeout(() => {
                    copyParamsBtn.textContent = COPY_PLAN_LABEL;
                }, 1200);
            },
            () => {
                copyParamsBtn.textContent = "Copy failed";
                setTimeout(() => {
                    copyParamsBtn.textContent = COPY_PLAN_LABEL;
                }, 1200);
            }
        );
    });

    function updateBar(bar: ReturnType<typeof makeBarRow>, mg: number, chartMaxMg: number): number {
        const eff = effectFraction(mg, chartMaxMg);
        bar.fill.style.width = `${(eff * 100).toFixed(0)}%`;
        bar.maxed.hidden = mg <= chartMaxMg;
        bar.lbl.textContent = `${bucket(eff)} (${eff.toFixed(2)})`;
        return eff;
    }

    function updateReadout(point: SimPoint): void {
        const startMins = state.startTime ? parseClockTime(state.startTime) : null;
        const timeLabel = startMins !== null ? fmtClock(startMins, point.t) : fmtTime(point.t);
        subjectiveHeading.textContent = `Subjective state @ ${timeLabel}`;

        cPreBarrierErgine.textContent = `${point.preBarrierErgineMg.toFixed(0)} mg`;
        cPreBarrierAld.textContent = `${point.preBarrierAldG.toFixed(2)} g`;
        cBarrierAld.textContent = `${point.barrierAldG.toFixed(2)} g`;
        cBrainErgine.textContent = `${point.brainErgineMg.toFixed(0)} mg`;
        cBrainKykeon.textContent = `${point.brainKykeonMg.toFixed(0)} mg`;

        const eEff = updateBar(ergineBar, point.brainErgineMg, CHART_ERGINE_MG_MAX);
        const kEff = updateBar(kykeonBar, point.brainKykeonMg, CHART_KYKEON_MG_MAX);
        blendText.textContent = blendDescription(eEff, kEff);
    }

    function drawChart(result: SimResult): void {
        const { series, peeEvents } = result;
        svg.innerHTML = "";

        // horizontal mg gridlines: negative half scaled to ergine's ceiling,
        // positive half to kykeon's
        const gridSteps = [-20, -15, -10, -5, 0, 5, 10, 15, 20];
        gridSteps.forEach((mg) => {
            if (mg < -CHART_ERGINE_MG_MAX || mg > CHART_KYKEON_MG_MAX) return;
            const y = yScale(mg);
            const line = svgEl("line");
            line.setAttribute("x1", String(PAD.l));
            line.setAttribute("x2", String(VB_W - PAD.r));
            line.setAttribute("y1", String(y));
            line.setAttribute("y2", String(y));
            line.setAttribute("class", mg === 0 ? "pk-zero-line" : "pk-grid-line");
            svg.appendChild(line);

            if (mg !== 0) {
                const label = svgEl("text");
                label.setAttribute("x", String(PAD.l - 8));
                label.setAttribute("y", String(y + 4));
                label.setAttribute("text-anchor", "end");
                label.setAttribute("class", "pk-axis-label");
                label.textContent = `${Math.abs(mg)}`;
                svg.appendChild(label);
            }
        });

        for (let h = 0; h <= T_END / 60; h++) {
            const t = h * 60;
            const x = xScale(t);
            const line = svgEl("line");
            line.setAttribute("x1", String(x));
            line.setAttribute("x2", String(x));
            line.setAttribute("y1", String(PAD.t));
            line.setAttribute("y2", String(VB_H - PAD.b));
            line.setAttribute("class", "pk-grid-line");
            line.setAttribute("opacity", "0.5");
            svg.appendChild(line);

            const label = svgEl("text");
            label.setAttribute("x", String(x));
            label.setAttribute("y", String(VB_H - PAD.b + 18));
            label.setAttribute("text-anchor", "middle");
            label.setAttribute("class", "pk-axis-label");
            const startMins = state.startTime ? parseClockTime(state.startTime) : null;
            label.textContent = startMins !== null ? fmtClock(startMins, t) : `${h}h`;
            svg.appendChild(label);
        }

        const ergineVals = series.map((s) => -s.brainErgineMg);
        const kykeonVals = series.map((s) => s.brainKykeonMg);

        function pathFor(vals: number[]): string {
            return series.map((s, i) => `${i === 0 ? "M" : "L"}${xScale(s.t).toFixed(1)} ${yScale(vals[i]).toFixed(1)}`).join(" ");
        }
        function areaFor(vals: number[]): string {
            const start = `M${xScale(series[0].t).toFixed(1)} ${yScale(0).toFixed(1)} `;
            const mid = series.map((s, i) => `L${xScale(s.t).toFixed(1)} ${yScale(vals[i]).toFixed(1)}`).join(" ");
            const end = ` L${xScale(series[series.length - 1].t).toFixed(1)} ${yScale(0).toFixed(1)} Z`;
            return start + mid + end;
        }

        const ergineArea = svgEl("path");
        ergineArea.setAttribute("d", areaFor(ergineVals));
        ergineArea.setAttribute("class", "pk-ergine-fill");
        svg.appendChild(ergineArea);

        const kykeonArea = svgEl("path");
        kykeonArea.setAttribute("d", areaFor(kykeonVals));
        kykeonArea.setAttribute("class", "pk-kykeon-fill");
        svg.appendChild(kykeonArea);

        const erginePath = svgEl("path");
        erginePath.setAttribute("d", pathFor(ergineVals));
        erginePath.setAttribute("class", "pk-ergine-line");
        svg.appendChild(erginePath);

        const kykeonPath = svgEl("path");
        kykeonPath.setAttribute("d", pathFor(kykeonVals));
        kykeonPath.setAttribute("class", "pk-kykeon-line");
        svg.appendChild(kykeonPath);

        const mdmaEquivalentKykeonMg = 1;
        const mdmaY = yScale(mdmaEquivalentKykeonMg);
        const mdmaLine = svgEl("line");
        mdmaLine.setAttribute("x1", String(PAD.l));
        mdmaLine.setAttribute("x2", String(VB_W - PAD.r));
        mdmaLine.setAttribute("y1", String(mdmaY));
        mdmaLine.setAttribute("y2", String(mdmaY));
        mdmaLine.setAttribute("class", "pk-mdma-line");
        svg.appendChild(mdmaLine);
        const mdmaLabel = svgEl("text");
        mdmaLabel.setAttribute("x", String(VB_W - PAD.r - 6));
        mdmaLabel.setAttribute("y", String(mdmaY - 5));
        mdmaLabel.setAttribute("text-anchor", "end");
        mdmaLabel.setAttribute("class", "pk-axis-label pk-mdma-label");
        mdmaLabel.textContent = "MDMA 120mg (equivalent)";
        svg.appendChild(mdmaLabel);

        peeEvents.forEach((t) => {
            if (t > T_END) return;
            const x = xScale(t);
            const line = svgEl("line");
            line.setAttribute("x1", String(x));
            line.setAttribute("x2", String(x));
            line.setAttribute("y1", String(PAD.t));
            line.setAttribute("y2", String(VB_H - PAD.b));
            line.setAttribute("class", "pk-pee-mark");
            svg.appendChild(line);
        });

        const axisZeroY = yScale(0);
        const topHalfMidY = PAD.t + (axisZeroY - PAD.t) / 2;
        const yLabTop = svgEl("text");
        yLabTop.setAttribute("x", "14");
        yLabTop.setAttribute("y", String(topHalfMidY));
        yLabTop.setAttribute("text-anchor", "middle");
        yLabTop.setAttribute("class", "pk-axis-label");
        yLabTop.setAttribute("transform", `rotate(-90, 14, ${topHalfMidY})`);
        yLabTop.textContent = "kykeon mg";
        svg.appendChild(yLabTop);

        const bottomHalfMidY = axisZeroY + (VB_H - PAD.b - axisZeroY) / 2;
        const yLabBottom = svgEl("text");
        yLabBottom.setAttribute("x", "14");
        yLabBottom.setAttribute("y", String(bottomHalfMidY));
        yLabBottom.setAttribute("text-anchor", "middle");
        yLabBottom.setAttribute("class", "pk-axis-label");
        yLabBottom.setAttribute("transform", `rotate(-90, 14, ${bottomHalfMidY})`);
        yLabBottom.textContent = "ergine mg";
        svg.appendChild(yLabBottom);

        // dose markers: draggable circles that sit on the y=0 line. Dragging
        // left/right changes the dose time; dragging up/down changes its amount.
        // Created now (so zeroY is available below) but appended to the SVG
        // later, after the inspection/dose-zone overlay rects, so the circles
        // sit on top in hit-test order and actually receive pointer events.
        const doseGroup = svgEl("g");
        const zeroY = yScale(0);

        function renderDoseMarkers(): void {
            doseGroup.innerHTML = "";
            state.doses.forEach((dose) => {
                const x = xScale(dose.t);
                const g = svgEl("g");
                g.setAttribute("class", "pk-dose-marker");
                g.style.cursor = "grab";

                const circle = svgEl("circle");
                circle.setAttribute("cx", String(x));
                circle.setAttribute("cy", String(zeroY));
                circle.setAttribute("r", String(DOSE_MARKER_R));
                circle.setAttribute("class", "pk-dose-circle");
                const hitArea = svgEl("circle");
                hitArea.setAttribute("cx", String(x));
                hitArea.setAttribute("cy", String(zeroY));
                hitArea.setAttribute("r", String(DOSE_MARKER_HIT_R));
                hitArea.setAttribute("fill", "transparent");
                g.appendChild(hitArea);
                g.appendChild(circle);

                const label = svgEl("text");
                label.setAttribute("x", String(x));
                label.setAttribute("y", String(zeroY + 4));
                label.setAttribute("text-anchor", "middle");
                label.setAttribute("class", "pk-dose-label");
                label.textContent = dose.amount.toFixed(dose.amount % 1 === 0 ? 0 : 2);
                g.appendChild(label);

                g.addEventListener("pointerdown", (e: PointerEvent) => {
                    dragging = { dose, pointerId: e.pointerId, startClientY: e.clientY, startAmount: dose.amount };
                    showDragTooltip(dose, e.clientX, e.clientY);
                    svg.setPointerCapture(e.pointerId);
                    e.stopPropagation();
                });

                doseGroup.appendChild(g);
            });
        }
        renderDoseMarkers();
        buildChart_renderDoseMarkers = renderDoseMarkers;

        const cursorLine = svgEl("line");
        cursorLine.setAttribute("class", "pk-cursor-line");
        cursorLine.setAttribute("y1", String(PAD.t));
        cursorLine.setAttribute("y2", String(VB_H - PAD.b));
        cursorLine.setAttribute("visibility", "hidden");
        svg.appendChild(cursorLine);

        const dotErgine = svgEl("circle");
        dotErgine.setAttribute("r", "5");
        dotErgine.setAttribute("class", "pk-cursor-dot pk-cursor-dot-ergine");
        dotErgine.setAttribute("visibility", "hidden");
        svg.appendChild(dotErgine);

        const dotKykeon = svgEl("circle");
        dotKykeon.setAttribute("r", "5");
        dotKykeon.setAttribute("class", "pk-cursor-dot pk-cursor-dot-kykeon");
        dotKykeon.setAttribute("visibility", "hidden");
        svg.appendChild(dotKykeon);

        // The cursor-inspection overlay is split top/bottom around a band at
        // y=0, so that band is left free for dose-marker dragging instead of
        // fighting the timeline-inspection click/drag.
        const doseZoneTop = zeroY - DOSE_ZONE_HALF_HEIGHT;
        const doseZoneBottom = zeroY + DOSE_ZONE_HALF_HEIGHT;

        const overlayTop = svgEl("rect");
        overlayTop.setAttribute("x", String(PAD.l));
        overlayTop.setAttribute("y", String(PAD.t));
        overlayTop.setAttribute("width", String(PLOT_W));
        overlayTop.setAttribute("height", String(Math.max(0, doseZoneTop - PAD.t)));
        overlayTop.setAttribute("fill", "transparent");
        overlayTop.style.cursor = "crosshair";
        svg.appendChild(overlayTop);

        const overlayBottom = svgEl("rect");
        overlayBottom.setAttribute("x", String(PAD.l));
        overlayBottom.setAttribute("y", String(doseZoneBottom));
        overlayBottom.setAttribute("width", String(PLOT_W));
        overlayBottom.setAttribute("height", String(Math.max(0, VB_H - PAD.b - doseZoneBottom)));
        overlayBottom.setAttribute("fill", "transparent");
        overlayBottom.style.cursor = "crosshair";
        svg.appendChild(overlayBottom);

        // The dose zone itself: empty space here can still be double-clicked to
        // add a new dose, but it does not drive timeline inspection.
        const doseZoneRect = svgEl("rect");
        doseZoneRect.setAttribute("x", String(PAD.l));
        doseZoneRect.setAttribute("y", String(doseZoneTop));
        doseZoneRect.setAttribute("width", String(PLOT_W));
        doseZoneRect.setAttribute("height", String(doseZoneBottom - doseZoneTop));
        doseZoneRect.setAttribute("fill", "transparent");
        doseZoneRect.style.cursor = "copy";
        doseZoneRect.style.touchAction = "none";
        svg.appendChild(doseZoneRect);
        svg.appendChild(doseGroup);

        function setCursor(idx: number): void {
            const point = series[idx];
            const x = xScale(point.t);
            const yE = yScale(-point.brainErgineMg);
            const yK = yScale(point.brainKykeonMg);
            cursorLine.setAttribute("x1", String(x));
            cursorLine.setAttribute("x2", String(x));
            cursorLine.setAttribute("visibility", "visible");
            dotErgine.setAttribute("cx", String(x));
            dotErgine.setAttribute("cy", String(yE));
            dotErgine.setAttribute("visibility", "visible");
            dotKykeon.setAttribute("cx", String(x));
            dotKykeon.setAttribute("cy", String(yK));
            dotKykeon.setAttribute("visibility", "visible");
            updateReadout(point);
        }

        function handlePointer(evt: MouseEvent | TouchEvent): void {
            const rect = svg.getBoundingClientRect();
            const clientX = "touches" in evt ? evt.touches[0].clientX : evt.clientX;
            const t = xToT(clientX, rect);
            const idx = Math.round(t / DT);
            setCursor(Math.min(series.length - 1, Math.max(0, idx)));
        }

        const onMove = (e: MouseEvent) => handlePointer(e);
        [overlayTop, overlayBottom].forEach((zone) => {
            zone.addEventListener("mousedown", (e) => {
                handlePointer(e);
                zone.addEventListener("mousemove", onMove);
            });
            window.addEventListener("mouseup", () => zone.removeEventListener("mousemove", onMove));
            zone.addEventListener("click", handlePointer as EventListener);
            zone.addEventListener("touchstart", handlePointer as EventListener, { passive: true });
            zone.addEventListener("touchmove", handlePointer as EventListener, { passive: true });
        });

        let lastZoneTapMs = 0;
        doseZoneRect.addEventListener("pointerdown", (e: PointerEvent) => {
            const now = e.timeStamp;
            const isDoubleTap = now - lastZoneTapMs < DOUBLE_TAP_MS;
            lastZoneTapMs = isDoubleTap ? 0 : now;
            if (!isDoubleTap) return;
            const rect = svg.getBoundingClientRect();
            const t = Math.round(xToT(e.clientX, rect) / 5) * 5;
            state.doses.push({ t, amount: 1.5 });
            run();
        });

        let peakIdx = 0;
        let peakVal = -Infinity;
        kykeonVals.forEach((v, i) => {
            if (v > peakVal) {
                peakVal = v;
                peakIdx = i;
            }
        });
        setCursor(peakIdx);
    }

    let buildChart_renderDoseMarkers: (() => void) | null = null;

    // Pointer-drag handling for dose markers lives at the document level so
    // dragging still works if the pointer briefly leaves the small circle.
    // Horizontal movement sets time; vertical movement (relative to where the
    // drag started) sets amount, since the marker itself always renders on the
    // y=0 line regardless of amount.
    document.addEventListener("pointermove", (e: PointerEvent) => {
        if (!dragging || e.pointerId !== dragging.pointerId) return;
        const rect = svg.getBoundingClientRect();

        const t = Math.max(0, Math.min(T_END, Math.round(xToT(e.clientX, rect) / 5) * 5));
        dragging.dose.t = t;

        const pxScale = VB_H / rect.height; // account for viewBox scaling vs rendered size
        const deltaPx = (e.clientY - dragging.startClientY) * pxScale;
        const deltaAmount = (-deltaPx / DOSE_DRAG_PX_PER_FULL_RANGE) * (DOSE_AMOUNT_MAX - DOSE_AMOUNT_MIN);
        dragging.dose.amount = Math.max(DOSE_AMOUNT_MIN, Math.min(DOSE_AMOUNT_MAX, dragging.startAmount + deltaAmount));

        buildChart_renderDoseMarkers?.();
        showDragTooltip(dragging.dose, e.clientX, e.clientY);

        if (dragDebounceTimer !== null) clearTimeout(dragDebounceTimer);
        dragDebounceTimer = setTimeout(() => {
            dragDebounceTimer = null;
            run();
        }, DOSE_DRAG_DEBOUNCE_MS);
    });
    document.addEventListener("pointerup", (e: PointerEvent) => {
        if (!dragging || e.pointerId !== dragging.pointerId) return;
        if (dragging.dose.amount <= 0) {
            state.doses = state.doses.filter((d) => d !== dragging!.dose);
        }
        dragging = null;
        dragTooltip.hidden = true;
        if (dragDebounceTimer !== null) {
            clearTimeout(dragDebounceTimer);
            dragDebounceTimer = null;
        }
        run();
    });

    function showDragTooltip(dose: BarleyDose, clientX: number, clientY: number): void {
        const wrapRect = chartWrap.getBoundingClientRect();
        const startMins = state.startTime ? parseClockTime(state.startTime) : null;
        const timeLabel = startMins !== null ? fmtClock(startMins, dose.t) : fmtTime(dose.t);
        dragTooltip.textContent = `${dose.amount.toFixed(2)}g @ ${timeLabel}`;
        dragTooltip.style.left = `${clientX - wrapRect.left}px`;
        dragTooltip.style.top = `${clientY - wrapRect.top}px`;
        dragTooltip.hidden = false;
    }

    function run(): void {
        const result = runSimulation(state.ergineMg, state.dietOn, state.sippingWater, state.doses, state.rngSeed);
        drawChart(result);
    }

    syncControls();
    run();
}

function init(): void {
    const container = document.getElementById("pk-sim");
    if (!container) return;
    buildSimUI(container);
}

init();

export { };
