// Animated explorer for the "Inward perspective" axis of the Psychological
// Characterization scale. See docs/inward-primer.txt for architecture.

import { DRUGS, DRUG_BY_KEY, sampleDoseCurve, type DrugEffect } from "./inward/drugData";
import { CX, H, VERTEX_BY_NAME, VERTICES, W, clampPartPosition, lerp, sigmoid, svgEl } from "./inward/geometry";
import { PARTS_PALETTE, type Part, type PartForce } from "./inward/part";
import { BLEND_FORCE_SCALE, EMOJI_VERTICAL_CENTER_OFFSET, buildAttnPerimeterPath, buildCircles, buildConnectorCapsules, computeTargetShrinkWrap, fieldAt, thresholdFor, type Circle, type Capsule } from "./inward/attnPerimeter";
import { blendIntensityWord, focusPhrase, READOUT_MAX_LISTED_PARTS, selfQualitiesFor, SLEEP_SELF_ENERGY_MAX, wrapCommaList } from "./inward/readoutText";
import { DrugWheel } from "./inward/drugWheel";
import { SelfEnergyKnob } from "./inward/selfEnergyKnob";
import { DoseController } from "./inward/doseController";

// Legend colors for the per-part force breakdown popup, keyed by force name (part.ts's
// PartForce.name). One entry per named force pushed in the tick loop below.

// Broader emoji choices for the manual part-add picker, beyond PARTS_PALETTE's small
// spontaneous-spawn set - the user isn't restricted to a handful of preset feelings.
// Kept in sync with PARTS_PALETTE (part.ts) - every choice here must have a matching
// feeling there, so the manual-add picker never produces a part with an empty feeling.
// Deliberately pruned from a much larger face-emoji set: many visually-similar faces
// (sad/afraid/uncomfortable variants) would only muddy the readout with duplicate or
// indistinguishable feelings, so each choice here is a genuinely distinct emotion.
const MANUAL_PART_EMOJI_CHOICES: string[] = PARTS_PALETTE.map((p) => p.emoji);

// Small burst of these drifts off a part while its conflict ring is showing (see
// maybeSpawnConflictEmoji below) - a pained reaction to being pulled toward Self and
// blended at once. Non-face emoji deliberately, since PARTS_PALETTE/
// MANUAL_PART_EMOJI_CHOICES are already all pained faces - a face here would blend into
// the part's own emoji instead of reading as a distinct effect.
const CONFLICT_EMOJIS = ["🗡️", "💥", "⛓️", "🩸"];
const CONFLICT_EMOJI_SPEED = 20;
const CONFLICT_EMOJI_DURATION_MS = 1600;
// Fraction of the transit spent at full opacity before fading out.
const CONFLICT_EMOJI_HOLD_FRAC = 0.35;
// Minimum gap between bursts on the same part - much sparser than urbb-web's confirm
// burst, since this plays continuously while conflict is high rather than once on click.
const CONFLICT_EMOJI_SPAWN_INTERVAL_MS = 900;

const FORCE_COLORS: Record<string, string> = {
    selfUnblend: "#e74c3c",
    selfProximity: "#2980b9",
    blendUrgency: "#27ae60",
    partRepulsion: "#f39c12",
};

class InwardPerspectiveExplorer {
    private root: HTMLElement;
    private svg: SVGSVGElement;
    private attnPerimeterPath: SVGPathElement;
    // Latent shrink-wrap tendency of the boundary, 0..1 (0 = loose, 1 = tight).
    private shrinkWrap = 0;
    private targetShrinkWrap = 0;
    private selfEnergyKnob!: SelfEnergyKnob;
    private get selfEnergy(): number {
        return this.selfEnergyKnob.energy;
    }
    private parts: Part[] = [];
    private wobblePhase = [0, 1.7, 3.1];
    private readoutTitle!: SVGTextElement;
    private readoutBody!: SVGTextElement;
    private readoutFeelings!: SVGTextElement;
    private doseController!: DoseController;
    private selectedDrugKey: string = "thh";
    private drugWheel!: DrugWheel;
    private drugWheelCenterX = 0;
    private drugWheelCenterY = 0;
    private cannabisPart: Part | null = null;
    // Circle count backing the readout's focusPhrase, updated once per tick.
    private currentCircleCount = 1;
    private lastTs = 0;

    // Debug overlay, enabled via ?debug=1 in the URL.
    private debugEnabled = false;
    private debugPanel!: HTMLElement;
    private debugCircles!: SVGGElement;
    private partsLayer!: SVGGElement;
    private doseLayer!: SVGGElement;
    private contraindicatedModalBackdrop!: HTMLElement;
    private contraindicatedModalText!: HTMLElement;
    private debugField!: SVGGElement;
    // Non-null while the debug shrink-wrap slider is being used, overriding
    // computeTargetShrinkWrap() for manual inspection of the perimeter's tightness.
    private debugShrinkWrapOverride: number | null = null;

    // Force-breakdown popup (hover, or click-to-lock) and per-part conflict ring.
    private forcePopupGroup!: SVGGElement;
    private forcePopupBg!: SVGRectElement;
    private forcePopupPin!: SVGGElement;
    private forcePopupPinBg!: SVGCircleElement;
    private hoveredPart: Part | null = null;
    private lockedPart: Part | null = null;
    private forcePopupHideTimer: ReturnType<typeof setTimeout> | null = null;
    private forcePopupVisiblePart: Part | null = null;
    private conflictRings = new Map<Part, SVGCircleElement>();
    // Last time (ms) each conflicted part spawned a pain-emoji burst - throttles spawns to
    // an occasional pulse rather than one every frame.
    private lastConflictEmojiSpawn = new Map<Part, number>();

    // Manual part-add panel
    private simulatePartsEnabled = true;
    private manualEmoji: string = MANUAL_PART_EMOJI_CHOICES[0];
    private manualEmojiTriggerBtn!: HTMLButtonElement;
    private manualEmojiPopup!: HTMLElement;
    private manualUrgencyInput!: HTMLInputElement;
    private manualUrgencyValue!: HTMLElement;

    constructor(container: HTMLElement) {
        this.root = container;
        this.root.classList.add("ipe-root");

        this.debugEnabled = new URLSearchParams(window.location.search).get("debug") === "1";

        const style = document.createElement("style");
        style.textContent = `
      .ipe-root { max-width: 560px; margin: 1.5em auto; font-family: inherit; position: relative; border: 1px solid rgba(128,128,128,0.35); border-radius: 10px; padding: 1em; }
      .ipe-svg { width: 100%; height: auto; touch-action: none; display: block; position: relative; z-index: 1; user-select: none; }
      .ipe-vertex-label { font-size: 13px; fill: currentColor; opacity: 0.75; text-anchor: middle; user-select: none; }
      .ipe-vertex-emoji { font-size: 22px; text-anchor: middle; cursor: default; user-select: none; }
      .ipe-vertex-emoji.ipe-self-knob { cursor: grab; touch-action: none; pointer-events: none; }
      .ipe-self-knob-hit { fill: transparent; cursor: grab; touch-action: none; }
      .ipe-self-knob-hit:active { cursor: grabbing; }
      .ipe-self-knob-ring { fill: none; stroke: currentColor; stroke-opacity: 0.35; stroke-width: 3; }
      .ipe-self-knob-ring-fill { fill: none; stroke: #f400d7; stroke-width: 3; stroke-linecap: round; }
      .ipe-self-knob-group:hover .ipe-self-knob-ring { stroke-opacity: 0.6; }
      .ipe-self-knob-group:hover .ipe-self-knob-ring-fill { stroke-width: 4; }
      /* Filled wedge swept from the knob center out to the cursor, the main drag feedback. */
      .ipe-self-knob-wedge { fill: #ffe600; fill-opacity: 0.9; stroke: #000; stroke-width: 2; display: none; pointer-events: none; }
      .ipe-self-knob-value-bg { fill: #f400d7; display: none; pointer-events: none; }
      .ipe-self-knob-value { font-size: 14px; font-weight: 700; fill: #fff; text-anchor: middle; display: none; user-select: none; pointer-events: none; }
      .ipe-attn-perimeter { fill: #f400d7; fill-opacity: 0.08; stroke: #f400d7; stroke-width: 1.5; stroke-dasharray: 4,3; pointer-events: none; }
      .ipe-part { font-size: 26px; text-anchor: middle; cursor: grab; user-select: none; }
      .ipe-part:active { cursor: grabbing; }
      .ipe-control-group { fill: none; stroke: rgba(128,128,128,0.35); stroke-width: 1; }
      .ipe-dose-value { font-size: 11px; fill: currentColor; opacity: 0.75; text-anchor: middle; user-select: none; }
      .ipe-dose-track { stroke: rgba(128,128,128,0.5); stroke-width: 8; stroke-linecap: round; cursor: pointer; touch-action: none; user-select: none; }
      .ipe-dose-handle { fill: #f400d7; stroke: #fff; stroke-width: 1.5; cursor: grab; touch-action: none; user-select: none; }
      .ipe-dose-handle:active { cursor: grabbing; }
      .ipe-drug-wheel-btn { cursor: pointer; touch-action: none; }
      .ipe-drug-wheel-btn-ring { fill: rgba(244,0,215,0.08); stroke: #f400d7; stroke-width: 1.5; }
      .ipe-drug-wheel-btn:hover .ipe-drug-wheel-btn-ring { fill: rgba(244,0,215,0.18); stroke-width: 2; }
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
      .ipe-administer-btn { cursor: pointer; touch-action: none; }
      .ipe-administer-btn circle { fill: rgba(244,0,215,0.08); stroke: #f400d7; stroke-width: 1.5; }
      .ipe-administer-btn:hover circle { fill: rgba(244,0,215,0.2); }
      .ipe-administer-btn-label { font-size: 15px; text-anchor: middle; dominant-baseline: central; pointer-events: none; user-select: none; }
      .ipe-applied-x { font-size: 11px; fill: currentColor; opacity: 0.5; cursor: pointer; }
      .ipe-applied-x:hover { opacity: 1; }
      .ipe-applied-list { font-size: 11px; fill: currentColor; }
      .ipe-applied-list .ipe-applied-title { opacity: 0.6; }
      .ipe-readout { font-size: 11px; fill: currentColor; text-anchor: middle; }
      .ipe-readout-heading { font-size: 12px; opacity: 0.55; letter-spacing: 0.03em; text-transform: uppercase; }
      .ipe-readout-feelings { opacity: 0.85; }
      .ipe-debug-panel { margin-top: 0.75em; padding: 0.6em 0.8em; border: 1px dashed #f400d7; border-radius: 6px; font: 11px/1.5 ui-monospace, monospace; white-space: pre-wrap; background: rgba(244,0,215,0.05); }
      .ipe-debug-shrinkwrap-row { margin-top: 0.4em; display: flex; align-items: center; gap: 0.5em; font: 11px/1.5 ui-monospace, monospace; }
      .ipe-debug-shrinkwrap-row input[type=range] { flex: 1; }
      .ipe-debug-circle { fill: none; stroke: #00b894; stroke-width: 1; stroke-dasharray: 2,2; opacity: 0.7; }
      .ipe-debug-capsule { stroke: #0984e3; stroke-width: 1; stroke-dasharray: 3,2; opacity: 0.6; }
      .ipe-debug-field-dot { opacity: 0.55; }
      .ipe-conflict-ring { fill: none; stroke-width: 2.5; pointer-events: none; opacity: 0; transition: opacity 0.2s ease; }
      .ipe-conflict-emoji { font-size: 12px; pointer-events: none; text-anchor: middle; }
      .ipe-force-popup { pointer-events: auto; }
      .ipe-force-popup-bg { fill: var(--body-background, #fff); stroke: #888; stroke-width: 1; opacity: 0.95; }
      .ipe-force-popup-row { font-size: 9.5px; fill: currentColor; }
      .ipe-force-popup-title { font-size: 10px; font-weight: 600; fill: currentColor; opacity: 0.7; }
      .ipe-force-popup-bar-bg { fill: currentColor; fill-opacity: 0.08; }
      .ipe-force-popup-pin { pointer-events: auto; cursor: pointer; }
      .ipe-force-popup-pin-bg { fill: transparent; stroke: currentColor; stroke-opacity: 0.3; }
      .ipe-force-popup-pin:hover .ipe-force-popup-pin-bg { fill: #2ecc71; fill-opacity: 0.5; stroke-opacity: 0; }
      .ipe-force-popup-pin.ipe-pinned .ipe-force-popup-pin-bg { fill: #f4d000; fill-opacity: 0.9; stroke-opacity: 0; }
      .ipe-force-popup-pin.ipe-pinned:hover .ipe-force-popup-pin-bg { fill: #2ecc71; fill-opacity: 0.9; }
      .ipe-force-popup-pin-glyph { font-size: 11px; opacity: 0.55; }
      .ipe-force-popup-pin:hover .ipe-force-popup-pin-glyph { opacity: 1; }
      .ipe-force-popup-pin.ipe-pinned .ipe-force-popup-pin-glyph { opacity: 1; }
      .ipe-manual-part-panel { margin-top: 0.75em; display: flex; flex-direction: column; gap: 0.5em; font-size: 0.85em; border: 1px solid rgba(128,128,128,0.35); border-radius: 8px; padding: 0.75em; }
      .ipe-manual-part-panel label.ipe-sim-toggle { display: flex; align-items: center; gap: 0.4em; cursor: pointer; }
      .ipe-manual-part-row { display: flex; align-items: center; gap: 0.6em; flex-wrap: wrap; }
      .ipe-manual-part-row.ipe-disabled { opacity: 0.4; pointer-events: none; }
      .ipe-manual-part-row input[type=range] { width: 8em; }
      .ipe-manual-part-btn { border: 1px solid currentColor; background: transparent; border-radius: 999px; padding: 0.2em 0.8em; font-size: 0.9em; cursor: pointer; }
      .ipe-manual-emoji-picker-wrap { position: relative; }
      .ipe-manual-emoji-trigger { border: 1px solid currentColor; background: transparent; border-radius: 6px; font-size: 1.3em; line-height: 1; padding: 0.15em 0.4em; cursor: pointer; }
      .ipe-manual-emoji-popup { display: none; position: absolute; z-index: 10; bottom: calc(100% + 4px); left: 0; grid-template-columns: repeat(6, 2.2em); gap: 0.1em; padding: 0.4em; background: var(--body-background, #fff); border: 1px solid rgba(128,128,128,0.4); border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.25); }
      .ipe-manual-emoji-popup.ipe-open { display: grid; }
      .ipe-manual-emoji-btn { border: 1px solid transparent; background: transparent; border-radius: 6px; font-size: 1.7em; line-height: 2.2em; padding: 0; cursor: pointer; text-align: center; }
      .ipe-manual-emoji-btn:hover { background: rgba(128,128,128,0.2); }
      .ipe-manual-urgency-value { font-variant-numeric: tabular-nums; opacity: 0.75; min-width: 2.5em; }
      .ipe-manual-part-msg { font-size: 0.9em; opacity: 0.8; font-style: italic; }
      .ipe-contraindicated-modal-backdrop { display: none; position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,0.5); align-items: center; justify-content: center; }
      .ipe-contraindicated-modal-backdrop.ipe-open { display: flex; }
      .ipe-contraindicated-modal { max-width: 22em; background: var(--body-background, #fff); border-radius: 12px; padding: 1.2em 1.4em; box-shadow: 0 8px 32px rgba(0,0,0,0.35); text-align: center; }
      .ipe-contraindicated-modal-emoji { font-size: 2.2em; line-height: 1; }
      .ipe-contraindicated-modal-text { margin: 0.6em 0 1em; font-size: 0.95em; line-height: 1.4; }
      .ipe-contraindicated-modal-btn { border: 1px solid currentColor; background: transparent; border-radius: 999px; padding: 0.4em 1.2em; font-size: 0.9em; cursor: pointer; }
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

            const emoji = svgEl("text");
            emoji.classList.add("ipe-vertex-emoji");
            if (v.name === "self") emoji.classList.add("ipe-self-knob");
            emoji.setAttribute("x", String(v.x));
            emoji.setAttribute("y", String(v.y + 8));
            emoji.textContent = v.emoji;
            this.svg.appendChild(emoji);
        }
        this.selfEnergyKnob = new SelfEnergyKnob(this.svg, W);

        this.attnPerimeterPath = svgEl("path");
        this.attnPerimeterPath.classList.add("ipe-attn-perimeter");
        this.svg.insertBefore(this.attnPerimeterPath, this.svg.firstChild);

        // Debug overlay: outlines of the actual Self/part circles the perimeter wraps,
        // plus a sampled-field grid so the marching-squares input is directly visible.
        this.debugField = svgEl("g");
        this.debugCircles = svgEl("g");
        if (this.debugEnabled) {
            this.svg.appendChild(this.debugField);
            this.svg.appendChild(this.debugCircles);
        }

        // Parts layer is created here but appended after the readout below, so parts
        // paint over the stationary readout panel while still staying under the
        // top-layer overlay UI (drug wheel, force popup) appended after it.
        this.partsLayer = svgEl("g");

        // Dose picker (slider + administer button) lives in its own layer, appended
        // before the drug wheel below, so the wheel's open pie menu paints over it.
        this.doseLayer = svgEl("g");
        this.svg.appendChild(this.doseLayer);

        this.drugWheelCenterX = VERTEX_BY_NAME.self.x - 115;
        this.drugWheelCenterY = VERTEX_BY_NAME.self.y + 78;

        // Visual cluster rectangle behind the pie-menu button + dose picker.
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

        this.drugWheel = new DrugWheel(
            this.drugWheelCenterX,
            this.drugWheelCenterY,
            this.selectedDrugKey,
            (key) => this.onSelectDrug(key),
            (open) => this.root.classList.toggle("ipe-wheel-open", open),
        );
        this.svg.appendChild(this.drugWheel.group);

        // Subjective-effects readout, centered inside the triangle.
        const READOUT_X = CX + 100;

        const readoutGroupRect = svgEl("rect");
        readoutGroupRect.classList.add("ipe-control-group");
        const READOUT_GROUP_HALF_WIDTH = 90;
        readoutGroupRect.setAttribute("x", String(READOUT_X - READOUT_GROUP_HALF_WIDTH));
        readoutGroupRect.setAttribute("y", "132");
        readoutGroupRect.setAttribute("width", String(READOUT_GROUP_HALF_WIDTH * 2));
        readoutGroupRect.setAttribute("height", "144");
        readoutGroupRect.setAttribute("rx", "10");
        this.svg.appendChild(readoutGroupRect);

        const readoutHeading = svgEl("text");
        readoutHeading.classList.add("ipe-readout", "ipe-readout-heading");
        readoutHeading.setAttribute("x", String(READOUT_X));
        readoutHeading.setAttribute("y", "153");
        readoutHeading.textContent = "Subjective read-out";
        this.svg.appendChild(readoutHeading);

        this.readoutTitle = svgEl("text");
        this.readoutTitle.classList.add("ipe-readout");
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
        this.readoutFeelings.setAttribute("y", String(210));
        this.svg.appendChild(this.readoutFeelings);

        this.svg.appendChild(this.partsLayer);

        // Force-breakdown popup, appended last so it renders above every part.
        this.forcePopupGroup = svgEl("g");
        this.forcePopupGroup.classList.add("ipe-force-popup");
        this.forcePopupGroup.style.display = "none";
        this.forcePopupGroup.addEventListener("pointerenter", () => this.cancelForcePopupHide());
        this.forcePopupGroup.addEventListener("pointerleave", () => {
            if (!this.lockedPart) this.scheduleForcePopupHide();
        });
        this.forcePopupBg = svgEl("rect");
        this.forcePopupBg.classList.add("ipe-force-popup-bg");
        this.forcePopupBg.setAttribute("rx", "6");
        this.forcePopupGroup.appendChild(this.forcePopupBg);

        this.forcePopupPin = svgEl("g");
        this.forcePopupPin.classList.add("ipe-force-popup-pin");
        this.forcePopupPinBg = svgEl("circle");
        this.forcePopupPinBg.classList.add("ipe-force-popup-pin-bg");
        this.forcePopupPinBg.setAttribute("r", "8");
        this.forcePopupPin.appendChild(this.forcePopupPinBg);
        const pinGlyph = svgEl("text");
        pinGlyph.classList.add("ipe-force-popup-pin-glyph");
        pinGlyph.textContent = "📌";
        pinGlyph.setAttribute("text-anchor", "middle");
        pinGlyph.setAttribute("dy", "3.5");
        this.forcePopupPin.appendChild(pinGlyph);
        this.forcePopupPin.addEventListener("click", (e) => {
            e.stopPropagation();
            if (this.lockedPart) {
                this.lockedPart = null;
                if (this.hoveredPart) this.showForcePopup(this.hoveredPart);
                else this.hideForcePopup();
            } else if (this.forcePopupVisiblePart) {
                this.lockedPart = this.forcePopupVisiblePart;
                this.showForcePopup(this.lockedPart);
            }
        });
        this.forcePopupGroup.appendChild(this.forcePopupPin);

        this.svg.appendChild(this.forcePopupGroup);

        this.root.appendChild(this.svg);

        this.doseController = new DoseController(
            this.svg,
            this.doseLayer,
            W,
            this.drugWheelCenterX,
            this.drugWheelCenterY,
            this.selectedDrugKey,
            {
                onDoseChange: (drug, value) => this.onDoseChange(drug, value),
                onContraindicated: (drug, other, note) => this.showContraindicatedModal(drug, other, note),
            },
        );

        this.contraindicatedModalBackdrop = document.createElement("div");
        this.contraindicatedModalBackdrop.className = "ipe-contraindicated-modal-backdrop";
        this.contraindicatedModalBackdrop.addEventListener("click", (e) => {
            if (e.target === this.contraindicatedModalBackdrop) this.hideContraindicatedModal();
        });
        const contraindicatedModal = document.createElement("div");
        contraindicatedModal.className = "ipe-contraindicated-modal";
        const contraindicatedModalEmoji = document.createElement("div");
        contraindicatedModalEmoji.className = "ipe-contraindicated-modal-emoji";
        contraindicatedModalEmoji.textContent = "🚫";
        contraindicatedModal.appendChild(contraindicatedModalEmoji);
        this.contraindicatedModalText = document.createElement("p");
        this.contraindicatedModalText.className = "ipe-contraindicated-modal-text";
        contraindicatedModal.appendChild(this.contraindicatedModalText);
        const contraindicatedModalBtn = document.createElement("button");
        contraindicatedModalBtn.type = "button";
        contraindicatedModalBtn.className = "ipe-contraindicated-modal-btn";
        contraindicatedModalBtn.textContent = "Got it";
        contraindicatedModalBtn.addEventListener("click", () => this.hideContraindicatedModal());
        contraindicatedModal.appendChild(contraindicatedModalBtn);
        this.contraindicatedModalBackdrop.appendChild(contraindicatedModal);
        this.root.appendChild(this.contraindicatedModalBackdrop);

        if (this.debugEnabled) {
            this.debugPanel = document.createElement("div");
            this.debugPanel.className = "ipe-debug-panel";
            this.root.appendChild(this.debugPanel);

            const shrinkWrapRow = document.createElement("div");
            shrinkWrapRow.className = "ipe-debug-shrinkwrap-row";
            const shrinkWrapLabel = document.createElement("label");
            shrinkWrapLabel.textContent = "shrinkWrap override: ";
            const shrinkWrapCheckbox = document.createElement("input");
            shrinkWrapCheckbox.type = "checkbox";
            const shrinkWrapSlider = document.createElement("input");
            shrinkWrapSlider.type = "range";
            shrinkWrapSlider.min = "0";
            shrinkWrapSlider.max = "1";
            shrinkWrapSlider.step = "0.01";
            shrinkWrapSlider.value = "0.5";
            shrinkWrapSlider.disabled = true;
            shrinkWrapCheckbox.addEventListener("change", () => {
                shrinkWrapSlider.disabled = !shrinkWrapCheckbox.checked;
                this.debugShrinkWrapOverride = shrinkWrapCheckbox.checked ? Number(shrinkWrapSlider.value) : null;
            });
            shrinkWrapSlider.addEventListener("input", () => {
                if (shrinkWrapCheckbox.checked) this.debugShrinkWrapOverride = Number(shrinkWrapSlider.value);
            });
            shrinkWrapLabel.appendChild(shrinkWrapCheckbox);
            shrinkWrapRow.appendChild(shrinkWrapLabel);
            shrinkWrapRow.appendChild(shrinkWrapSlider);
            this.root.appendChild(shrinkWrapRow);
        }

        this.buildManualPartPanel();

        this.svg.addEventListener("pointerdown", (e) => this.onPointerDown(e));

        requestAnimationFrame((ts) => this.tick(ts));
        this.updateReadout();
        this.addRandomPart(); // at least one part present on load, rather than waiting 5-10s
        this.scheduleSpawn();
        this.scheduleReap();
    }

    // Spontaneous parts, oldest first (excludes the cannabis part).
    private spontaneousParts: Part[] = [];

    // Centered on the Self energy where spawning stops and parts start getting reaped to
    // zero; the sigmoid's output (rather than a hard >= cutoff) is used as a per-check
    // probability, so the transition is gradual instead of abrupt.
    private static readonly HIGH_SELF_ENERGY_CENTER = 0.9;
    private static readonly HIGH_SELF_ENERGY_STEEPNESS = 20;
    private static highSelfEnergyOdds(selfEnergy: number): number {
        return sigmoid(
            selfEnergy,
            InwardPerspectiveExplorer.HIGH_SELF_ENERGY_CENTER,
            InwardPerspectiveExplorer.HIGH_SELF_ENERGY_STEEPNESS,
        );
    }
    // Tuned so that at selfEnergy=1 and dy=300 (the triangle's bottom vertices' y-level),
    // the push is ~0.03 units - negligible next to the other forces (order 1-24).
    private static readonly SELF_GRAVITY_CONSTANT = 3000;
    // Random wander: an occasional single-direction impulse rather than continuous jitter.
    // Doubled for a conflicted part (see the tick loop below) - discomfort/restlessness
    // from being pulled toward Self and blended at once.
    private static readonly WANDER_KICK_CHANCE_PER_SEC = 0.2;
    private static readonly WANDER_KICK_CHANCE_PER_SEC_CONFLICTED = 0.4;
    private static readonly WANDER_KICK_STRENGTH = 2;
    // Fixed unit direction from blended toward unblended, used for the unblend/blend-
    // propensity forces so their direction never depends on a part's own position.
    private static readonly BLEND_TO_UNBLEND_DIR = (() => {
        const dx = VERTEX_BY_NAME.unblended.x - VERTEX_BY_NAME.blended.x;
        const dy = VERTEX_BY_NAME.unblended.y - VERTEX_BY_NAME.blended.y;
        const dist = Math.hypot(dx, dy);
        return { x: dx / dist, y: dy / dist };
    })();

    private scheduleSpawn(): void {
        const delay = 10000 + Math.random() * 10000;
        window.setTimeout(() => {
            const proposed = this.spontaneousParts.length + 1;
            const highSelfEnergyOdds = InwardPerspectiveExplorer.highSelfEnergyOdds(this.selfEnergy);
            // Sleeping (no parts, Self energy at/below the sleep threshold) admits no new
            // parts - nothing is drifting into view of someone who isn't attending at all.
            const sleeping = this.spontaneousParts.length === 0 && this.selfEnergy <= SLEEP_SELF_ENERGY_MAX;
            if (
                this.simulatePartsEnabled &&
                !sleeping &&
                Math.random() >= highSelfEnergyOdds &&
                Math.random() < 1 / proposed
            ) {
                this.addRandomPart();
            }
            this.scheduleSpawn();
        }, delay);
    }

    private scheduleReap(): void {
        const delay = 1000;
        window.setTimeout(() => {
            // Hyper-focused parts (Private reverie's sole target, or its linked partner) are
            // exempt from reaping - they're currently the entire object of attention.
            const reapable = this.spontaneousParts.filter((p) => !p.hyperFocused);
            const highSelfEnergyOdds = InwardPerspectiveExplorer.highSelfEnergyOdds(this.selfEnergy);
            const forceReap = Math.random() < highSelfEnergyOdds;
            const canReap =
                (this.simulatePartsEnabled || forceReap) &&
                reapable.length > (forceReap ? 0 : 1);
            if (canReap && (forceReap || Math.random() < 0.1)) {
                const oldest = reapable[0];
                oldest.fadingOut = true;
                this.spontaneousParts.splice(this.spontaneousParts.indexOf(oldest), 1);
            }
            this.updateFocusLock();
            this.scheduleReap();
        }, delay);
    }

    // "Private reverie": while N,N-DMT's blending pressure is high enough, the attention
    // perimeter can collapse onto a single part (plus its extraLinkTo partner, if any),
    // excluding Self entirely - checked once a second, alongside reap. Hysteresis
    // (FOCUS_LOCK_ENTER_ODDS > FOCUS_LOCK_EXIT_ODDS) keeps it from flickering in/out right at
    // the threshold: entering takes a decisive push, exiting takes a real drop in dose.
    private static readonly FOCUS_LOCK_ENTER_ODDS = 0.8;
    private static readonly FOCUS_LOCK_EXIT_ODDS = 0.3;
    private focusedParts: Part[] = [];

    // extraLinkTo is stored directionally (A.extraLinkTo = B) but represents an undirected
    // attention-perimeter connector - the capsule it produces has no direction, and for
    // Private reverie's purposes "linked to" must be checked both ways, transitively (if A
    // links to B and B links to C, all three belong in the same reverie group).
    private linkedGroup(start: Part): Part[] {
        const group: Part[] = [start];
        const seen = new Set<Part>([start]);
        for (let i = 0; i < group.length; i++) {
            const p = group[i];
            const neighbors = [
                p.extraLinkTo,
                ...this.parts.filter((other) => other.extraLinkTo === p),
            ];
            for (const n of neighbors) {
                if (n && !n.fadingOut && !seen.has(n)) {
                    seen.add(n);
                    group.push(n);
                }
            }
        }
        return group;
    }

    private updateFocusLock(): void {
        // Opposing drugs' pressures cancel before the sigmoid - e.g. enough THH
        // (unblendPressure) can prevent N,N-DMT's blendPressure alone from reaching
        // hyper-focus, and vice versa. Generalizes to any drug with blendPushMax/
        // unblendPushMax set, not just THH/DMT specifically.
        const netBlendPressure = Math.max(0, this.blendPressure() - this.unblendPressure());
        const blendPushOdds = sigmoid(netBlendPressure, 0.7, 20);
        if (this.focusedParts.length === 0) {
            if (blendPushOdds < InwardPerspectiveExplorer.FOCUS_LOCK_ENTER_ODDS) return;
            const candidates = this.parts.filter((p) => p !== this.cannabisPart && !p.fadingOut);
            if (candidates.length === 0) return;
            const target = candidates.reduce((best, p) =>
                (this.effectiveBlendUrgency(p) > this.effectiveBlendUrgency(best) ? p : best),
            );
            this.focusedParts = this.linkedGroup(target);
            // Cannabis always stays part of the attention perimeter, reverie or not - it
            // joins the focus group (but isn't itself reap-protected/hyperFocused, since its
            // own lifecycle is dose-driven, not focus-lock-driven).
            if (this.cannabisPart && !this.cannabisPart.fadingOut && !this.focusedParts.includes(this.cannabisPart)) {
                this.focusedParts.push(this.cannabisPart);
            }
            for (const p of this.focusedParts) {
                if (p !== this.cannabisPart) p.hyperFocused = true;
            }
            // Private reverie is about just these parts - anything else fades out rather
            // than sitting unseen outside the now Self-excluding perimeter.
            const focusedSet = new Set(this.focusedParts);
            for (const p of this.parts) {
                if (!focusedSet.has(p) && !p.fadingOut) {
                    p.fadingOut = true;
                    const spontaneousIdx = this.spontaneousParts.indexOf(p);
                    if (spontaneousIdx !== -1) this.spontaneousParts.splice(spontaneousIdx, 1);
                }
            }
        } else if (blendPushOdds < InwardPerspectiveExplorer.FOCUS_LOCK_EXIT_ODDS) {
            for (const p of this.focusedParts) p.hyperFocused = false;
            this.focusedParts = [];
        }
    }

    // Total direct push toward blended contributed by active drugs' blendPushMax (0..1
    // blend-force scale, may exceed 1) - N,N-DMT's mechanism, mirroring unblendPressure.
    private blendPressure(): number {
        let pressure = 0;
        for (const drug of DRUGS) {
            if (drug.doseCurve) {
                pressure += sampleDoseCurve(drug.doseCurve, this.doseController.doses[drug.key]).blendPush;
            } else if (drug.blendPushMax !== undefined) {
                pressure += drug.blendPushMax * this.doseController.doses[drug.key];
            }
        }
        return pressure;
    }

    // Total direct push away from blended contributed by active drugs' unblendPushMax (0..1
    // blend-force scale, may exceed 1) - THH's mechanism, mirroring blendPressure above.
    private unblendPressure(): number {
        let pressure = 0;
        for (const drug of DRUGS) {
            if (drug.unblendPushMax === undefined) continue;
            pressure += drug.unblendPushMax * this.doseController.doses[drug.key];
        }
        return pressure;
    }

    // Midpoint (mg) of the sigmoid gating THH's dose-dependent effects (cannabis-quieting,
    // shrinkWrap tightening) - below this, mostly absent; above it, mostly full strength.
    private static readonly THH_DOSE_GATE_MIDPOINT_MG = 5;

    // 0..1 dose-fraction to mg (via a drug's doseUnitLogRange), then through a sigmoid
    // centered at THH_DOSE_GATE_MIDPOINT_MG - shared by every THH effect that should ramp
    // in with dose rather than flip on/off with `isActive`.
    private doseGate(drug: DrugEffect): number {
        if (!drug.doseUnitLogRange) return 0;
        const fraction = this.doseController.doses[drug.key];
        const { min, max } = drug.doseUnitLogRange;
        const mg = min * Math.pow(max / min, fraction);
        return sigmoid(mg, InwardPerspectiveExplorer.THH_DOSE_GATE_MIDPOINT_MG, 0.5);
    }

    // A part's baseline blendUrgency divided by every active drug's quieting effect on it:
    // blendUrgencyDivisor (5-MAPB, all parts) and, for the cannabis part specifically,
    // cannabisBlendUrgencyDivisor (THH, gated by doseGate rather than a flat on/off, so a
    // trace THH dose doesn't fully quiet cannabis). Every reader of a part's blend urgency
    // (physics pull, focus-lock target selection, the readout's intensity word) should call
    // this rather than reading `part.blendUrgency` directly, so drug effects apply
    // everywhere consistently rather than only in the tick loop's force calc.
    private effectiveBlendUrgency(part: Part): number {
        let divisor = 1;
        for (const drug of DRUGS) {
            if (!this.doseController.isActive(drug.key)) continue;
            if (drug.blendUrgencyDivisor !== undefined) divisor *= drug.blendUrgencyDivisor;
            if (part === this.cannabisPart && drug.cannabisBlendUrgencyDivisor !== undefined) {
                divisor *= lerp(1, drug.cannabisBlendUrgencyDivisor, this.doseGate(drug));
            }
        }
        return part.blendUrgency / divisor;
    }

    // Max shrinkWrap contribution from THH at full dose-gate - THH tightens the perimeter
    // a bit on its own on top of N,N-DMT's blendPressure-driven tightening, gated by the
    // same dose sigmoid as cannabisBlendUrgencyDivisor rather than flat on/off.
    private static readonly THH_SHRINK_WRAP_MAX = 0.2;

    private thhShrinkWrapEffect(): number {
        const thh = DRUG_BY_KEY.thh;
        if (!this.doseController.isActive(thh.key)) return 0;
        return InwardPerspectiveExplorer.THH_SHRINK_WRAP_MAX * this.doseGate(thh);
    }

    private addRandomPart(): void {
        const { emoji, feeling } = PARTS_PALETTE[Math.floor(Math.random() * PARTS_PALETTE.length)];
        const angle = Math.random() * Math.PI * 2;
        const r = 30 + Math.random() * 20;
        const { x, y } = clampPartPosition(VERTEX_BY_NAME.self.x + Math.cos(angle) * r, VERTEX_BY_NAME.self.y + Math.sin(angle) * r);
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
        this.partsLayer.appendChild(el);
        const part: Part = { emoji, feeling, x, y, vx: 0, vy: 0, opacity: 0, fadingOut: false, el, blendUrgency: Math.random(), forces: [], extraLinkTo: this.rollExtraLink(), hyperFocused: false };
        this.parts.push(part);
        this.spontaneousParts.push(part);
        this.wireForcePopup(part);
    }

    // Rolled once per new part: on top of its always-present link to Self, a 50% chance
    // of one extra attention-perimeter connector to a part already present, so the
    // perimeter occasionally links parts directly to each other rather than only fanning
    // out from Self.
    private rollExtraLink(): Part | null {
        if (this.parts.length === 0 || Math.random() >= 0.5) return null;
        return this.parts[Math.floor(Math.random() * this.parts.length)];
    }

    // Playful messages when Remove part is clicked with nothing removable - varied rather
    // than a single static line, and each one suggests what to do instead.
    private static readonly NO_PARTS_TO_REMOVE_MESSAGES: string[] = [
        "Nothing to remove - your mind is already quiet. Try Add part.",
        "No parts here. Peace, for now. Add one to get started.",
        "Nobody home. Click Add part to invite someone in.",
        "All clear! Add a part if you'd like company.",
    ];
    // Playful messages when Add part is clicked at the readout's max listed-parts count -
    // reuses READOUT_MAX_LISTED_PARTS as the single source of truth for the cap, so the
    // limit here always matches what the readout can actually list without overflowing.
    private static readonly TOO_MANY_PARTS_MESSAGES: string[] = [
        "Full house! Try Remove part to make room for someone new.",
        "That's a lot of feelings at once. Remove one first?",
        "No more room on the perimeter - remove a part to add another.",
        "Every seat's taken. Remove part before adding.",
    ];
    // Playful messages for the contraindicated-combo modal - {a}/{b}/{note} get substituted.
    // Suggests removing the other drug first rather than just refusing the dose.
    private static readonly CONTRAINDICATED_MESSAGES: string[] = [
        "{a} and {b} really don't want to meet each other ({note}). Remove {b} first?",
        "Whoa there - {a} + {b} is a bad scene ({note}). Try clearing {b} before administering {a}.",
        "Your body called and said no to {a} + {b} ({note}). Remove {b} and try again.",
        "That combo's a hard pass: {a} + {b} ({note}). Clear {b} first, then go for it.",
    ];

    private showContraindicatedModal(drug: DrugEffect, other: DrugEffect, note: string): void {
        const template =
            InwardPerspectiveExplorer.CONTRAINDICATED_MESSAGES[
                Math.floor(Math.random() * InwardPerspectiveExplorer.CONTRAINDICATED_MESSAGES.length)
            ];
        this.contraindicatedModalText.textContent = template
            .replace(/{a}/g, drug.name)
            .replace(/{b}/g, other.name)
            .replace(/{note}/g, note);
        this.contraindicatedModalBackdrop.classList.add("ipe-open");
    }

    private hideContraindicatedModal(): void {
        this.contraindicatedModalBackdrop.classList.remove("ipe-open");
    }

    private manualPartMsgEl!: HTMLElement;
    private manualPartMsgTimer: ReturnType<typeof setTimeout> | null = null;

    private showManualPartMessage(text: string): void {
        if (this.manualPartMsgTimer !== null) clearTimeout(this.manualPartMsgTimer);
        this.manualPartMsgEl.textContent = text;
        this.manualPartMsgEl.style.display = "block";
        this.manualPartMsgTimer = setTimeout(() => {
            this.manualPartMsgEl.style.display = "none";
            this.manualPartMsgTimer = null;
        }, 3000);
    }

    // After adding a manual part, rolls a fresh emoji for the picker so the next Add part
    // click doesn't just repeat the same feeling - excludes the just-used emoji and every
    // emoji currently on screen (spontaneous, manual, or cannabis parts alike).
    private pickRandomManualEmoji(): void {
        const taken = new Set(this.parts.filter((p) => !p.fadingOut).map((p) => p.emoji));
        taken.add(this.manualEmoji);
        const available = MANUAL_PART_EMOJI_CHOICES.filter((e) => !taken.has(e));
        const pool = available.length > 0 ? available : MANUAL_PART_EMOJI_CHOICES;
        this.manualEmoji = pool[Math.floor(Math.random() * pool.length)];
        this.manualEmojiTriggerBtn.textContent = this.manualEmoji;
    }

    // Removes the least-recently-added part (this.parts is in insertion order), skipping the
    // cannabis part since its lifecycle is dose-driven, not manually removable.
    private sweepOldestPart(): void {
        const oldest = this.parts.find((p) => p !== this.cannabisPart && !p.fadingOut);
        if (!oldest) {
            const messages = InwardPerspectiveExplorer.NO_PARTS_TO_REMOVE_MESSAGES;
            this.showManualPartMessage(messages[Math.floor(Math.random() * messages.length)]);
            return;
        }
        oldest.fadingOut = true;
        const spontaneousIdx = this.spontaneousParts.indexOf(oldest);
        if (spontaneousIdx !== -1) this.spontaneousParts.splice(spontaneousIdx, 1);
    }

    // Adds a part the user placed by hand via the manual-add panel, bypassing spontaneous
    // spawn/reap bookkeeping (spontaneousParts) since it isn't subject to auto-reaping.
    private addManualPart(emoji: string, blendUrgency: number): void {
        const angle = Math.random() * Math.PI * 2;
        const r = 30 + Math.random() * 20;
        const { x, y } = clampPartPosition(VERTEX_BY_NAME.self.x + Math.cos(angle) * r, VERTEX_BY_NAME.self.y + Math.sin(angle) * r);
        const el = svgEl("text");
        el.classList.add("ipe-part");
        el.setAttribute("x", String(x));
        el.setAttribute("y", String(y));
        el.style.opacity = "0";
        el.textContent = emoji;
        const feeling = PARTS_PALETTE.find((p) => p.emoji === emoji)?.feeling ?? "";
        const part: Part = { emoji, feeling, x, y, vx: 0, vy: 0, opacity: 0, fadingOut: false, el, blendUrgency, forces: [], extraLinkTo: this.rollExtraLink(), hyperFocused: false };
        el.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            this.startDrag(part, e);
        });
        this.partsLayer.appendChild(el);
        this.parts.push(part);
        this.wireForcePopup(part);
    }

    private buildManualPartPanel(): void {
        const panel = document.createElement("div");
        panel.className = "ipe-manual-part-panel";

        const toggleLabel = document.createElement("label");
        toggleLabel.className = "ipe-sim-toggle";
        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.checked = this.simulatePartsEnabled;
        toggleLabel.appendChild(toggle);
        toggleLabel.appendChild(document.createTextNode("Let parts appear and disappear on their own schedule"));
        panel.appendChild(toggleLabel);

        const row = document.createElement("div");
        row.className = "ipe-manual-part-row ipe-disabled";

        const emojiPickerWrap = document.createElement("div");
        emojiPickerWrap.className = "ipe-manual-emoji-picker-wrap";

        this.manualEmojiTriggerBtn = document.createElement("button");
        this.manualEmojiTriggerBtn.type = "button";
        this.manualEmojiTriggerBtn.className = "ipe-manual-emoji-trigger";
        this.manualEmojiTriggerBtn.textContent = this.manualEmoji;
        this.manualEmojiTriggerBtn.addEventListener("click", () => {
            this.manualEmojiPopup.classList.toggle("ipe-open");
        });
        emojiPickerWrap.appendChild(this.manualEmojiTriggerBtn);

        this.manualEmojiPopup = document.createElement("div");
        this.manualEmojiPopup.className = "ipe-manual-emoji-popup";
        for (const emoji of MANUAL_PART_EMOJI_CHOICES) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "ipe-manual-emoji-btn";
            btn.textContent = emoji;
            btn.addEventListener("click", () => {
                this.manualEmoji = emoji;
                this.manualEmojiTriggerBtn.textContent = emoji;
                this.manualEmojiPopup.classList.remove("ipe-open");
            });
            this.manualEmojiPopup.appendChild(btn);
        }
        emojiPickerWrap.appendChild(this.manualEmojiPopup);
        document.addEventListener("click", (e) => {
            if (!emojiPickerWrap.contains(e.target as Node)) this.manualEmojiPopup.classList.remove("ipe-open");
        });
        row.appendChild(emojiPickerWrap);

        const urgencyLabel = document.createElement("span");
        urgencyLabel.textContent = "Blending urgency";
        row.appendChild(urgencyLabel);

        this.manualUrgencyInput = document.createElement("input");
        this.manualUrgencyInput.type = "range";
        this.manualUrgencyInput.min = "0";
        this.manualUrgencyInput.max = "1";
        this.manualUrgencyInput.step = "0.01";
        this.manualUrgencyInput.value = "0.5";
        row.appendChild(this.manualUrgencyInput);

        this.manualUrgencyValue = document.createElement("span");
        this.manualUrgencyValue.className = "ipe-manual-urgency-value";
        this.manualUrgencyValue.textContent = Number(this.manualUrgencyInput.value).toFixed(2);
        row.appendChild(this.manualUrgencyValue);
        this.manualUrgencyInput.addEventListener("input", () => {
            this.manualUrgencyValue.textContent = Number(this.manualUrgencyInput.value).toFixed(2);
        });

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "ipe-manual-part-btn";
        addBtn.textContent = "Add part";
        addBtn.addEventListener("click", () => {
            const nonCannabisCount = this.parts.filter((p) => p !== this.cannabisPart && !p.fadingOut).length;
            if (nonCannabisCount >= READOUT_MAX_LISTED_PARTS) {
                const messages = InwardPerspectiveExplorer.TOO_MANY_PARTS_MESSAGES;
                this.showManualPartMessage(messages[Math.floor(Math.random() * messages.length)]);
                return;
            }
            const urgency = Number(this.manualUrgencyInput.value);
            this.addManualPart(this.manualEmoji, urgency);
            this.pickRandomManualEmoji();
        });
        row.appendChild(addBtn);

        const sweepBtn = document.createElement("button");
        sweepBtn.type = "button";
        sweepBtn.className = "ipe-manual-part-btn";
        sweepBtn.textContent = "Remove part";
        sweepBtn.title = "Remove the least recently added part";
        sweepBtn.addEventListener("click", () => this.sweepOldestPart());
        row.appendChild(sweepBtn);

        panel.appendChild(row);

        this.manualPartMsgEl = document.createElement("div");
        this.manualPartMsgEl.className = "ipe-manual-part-msg";
        this.manualPartMsgEl.style.display = "none";
        panel.appendChild(this.manualPartMsgEl);

        this.root.appendChild(panel);

        toggle.addEventListener("change", () => {
            this.simulatePartsEnabled = toggle.checked;
            row.classList.toggle("ipe-disabled", this.simulatePartsEnabled);
        });
    }

    // Self-unblend and blend-urgency are the only two forces on the shared 0-1 psychological
    // blending-force scale (PartForce.displayMag), and always point exactly opposite along the
    // fixed blended<->unblended axis - so unlike the general force list (which also mixes in
    // Self differentiation and part repulsion, neither on that scale, the latter with no
    // psychological meaning at all), their conflict is just how much they overlap as opposing
    // scalars: min(a, b). Un-normalized deliberately - two strongly opposed forces (e.g. 0.8
    // vs 0.9) read as more conflicted than two weakly opposed ones (0.1 vs 0.2), unlike a
    // sum-of-magnitudes ratio which would call both "fully conflicted."
    private static computeConflict(forces: PartForce[]): number {
        const selfUnblend = forces.find((f) => f.name === "Self-energy unblend")?.displayMag ?? 0;
        const blendUrgency = forces.find((f) => f.name === "Blend urgency")?.displayMag ?? 0;
        return Math.min(selfUnblend, blendUrgency);
    }

    private wireForcePopup(part: Part): void {
        part.el.addEventListener("pointerenter", () => {
            this.cancelForcePopupHide();
            this.hoveredPart = part;
            if (!this.lockedPart) this.showForcePopup(part);
        });
        part.el.addEventListener("pointerleave", () => {
            if (this.hoveredPart === part) this.hoveredPart = null;
            if (!this.lockedPart) this.scheduleForcePopupHide();
        });
        part.el.addEventListener("click", (e) => {
            e.stopPropagation();
            if (this.lockedPart === part) {
                this.lockedPart = null;
                if (this.hoveredPart) this.showForcePopup(this.hoveredPart);
                else this.hideForcePopup();
            } else {
                this.lockedPart = part;
                this.showForcePopup(part);
            }
        });

        const ring = svgEl("circle");
        ring.classList.add("ipe-conflict-ring");
        this.svg.insertBefore(ring, this.forcePopupGroup);
        this.conflictRings.set(part, ring);
    }

    private showForcePopup(part: Part): void {
        this.forcePopupGroup.style.display = "";
        this.forcePopupVisiblePart = part;
        const rows = part.forces;

        while (this.forcePopupGroup.children.length > 2) {
            this.forcePopupGroup.removeChild(this.forcePopupGroup.lastChild!);
        }

        // Part repulsion is purely a display/anti-overlap mechanic with no psychological
        // meaning, so it's omitted from the legend.
        const legendRows = rows.filter((f) => f.name !== "Part repulsion");

        const rowHeight = 16;
        const width = 150;
        const barTop = 22;
        const barX = 6;
        const barWidth = width - 12;
        const barHeight = 10;
        const height = barTop + rowHeight * Math.max(legendRows.length, 1);

        // Bars are normalized against 1.0, not the largest force present - most forces on
        // this scale stay within 0..1, but THH/N,N,-DMT's direct pushes can exceed it (see
        // drugData.ts's unblendPushMax/blendPushMax), signaled by a fixed-width overflow cap
        // instead of a magnitude-proportional overshoot (which would fight the bar's own
        // fixed width and mislead about how far over 1 the value actually is).
        const overflowWidth = 6;

        legendRows.forEach((f, i) => {
            const y = barTop + i * rowHeight;
            const displayMag = f.displayMag ?? Math.hypot(f.x, f.y);
            const overflowing = displayMag > 1;
            const fraction = Math.max(0, Math.min(1, displayMag));
            const fillWidth = overflowing ? barWidth - overflowWidth : barWidth * fraction;
            // Blend urgency pulls toward blended (opposite of the other rows' unblend-ward
            // pull), so its bar grows from the right instead of the left to echo that.
            const fromRight = f.name === "Blend urgency";

            const barBg = svgEl("rect");
            barBg.classList.add("ipe-force-popup-bar-bg");
            barBg.setAttribute("x", String(barX));
            barBg.setAttribute("y", String(y));
            barBg.setAttribute("width", String(barWidth));
            barBg.setAttribute("height", String(barHeight));
            barBg.setAttribute("rx", "3");
            this.forcePopupGroup.appendChild(barBg);

            const barFill = svgEl("rect");
            barFill.setAttribute("x", String(fromRight ? barX + barWidth - fillWidth : barX));
            barFill.setAttribute("y", String(y));
            barFill.setAttribute("width", String(fillWidth));
            barFill.setAttribute("height", String(barHeight));
            barFill.setAttribute("rx", "3");
            barFill.setAttribute("fill", f.color);
            barFill.setAttribute("fill-opacity", "0.35");
            barFill.setAttribute("stroke", f.color);
            barFill.setAttribute("stroke-width", "1");
            this.forcePopupGroup.appendChild(barFill);

            if (overflowing) {
                const overflowBar = svgEl("rect");
                overflowBar.setAttribute("x", String(fromRight ? barX : barX + barWidth - overflowWidth));
                overflowBar.setAttribute("y", String(y));
                overflowBar.setAttribute("width", String(overflowWidth));
                overflowBar.setAttribute("height", String(barHeight));
                overflowBar.setAttribute("fill", "#8b0000");
                this.forcePopupGroup.appendChild(overflowBar);
            }

            const label = svgEl("text");
            label.classList.add("ipe-force-popup-row");
            label.setAttribute("x", String(barX + 4));
            label.setAttribute("y", String(y + barHeight - 2));
            label.textContent = `${f.name} (${displayMag.toFixed(2)})`;
            this.forcePopupGroup.appendChild(label);
        });

        this.forcePopupBg.setAttribute("width", String(width));
        this.forcePopupBg.setAttribute("height", String(height));

        const title = svgEl("text");
        title.classList.add("ipe-force-popup-title");
        title.setAttribute("x", String(barX + 4));
        title.setAttribute("y", "13");
        title.textContent = "Forces";
        this.forcePopupGroup.appendChild(title);

        this.forcePopupPin.classList.toggle("ipe-pinned", this.lockedPart === part);
        this.forcePopupPin.setAttribute("transform", `translate(${width - 14}, 12)`);

        const partCy = part.y - EMOJI_VERTICAL_CENTER_OFFSET;
        let px = part.x + 18;
        let py = partCy - height - 10;
        if (px + width > W) px = part.x - width - 18;
        if (py < 0) py = partCy + 18;
        this.forcePopupGroup.setAttribute("transform", `translate(${px}, ${py})`);
    }

    private hideForcePopup(): void {
        this.cancelForcePopupHide();
        this.forcePopupGroup.style.display = "none";
        this.forcePopupVisiblePart = null;
    }

    // Grace period between leaving the hovered part and hiding the popup, so the user can
    // cross the gap onto the popup itself (e.g. to click the pin) without it vanishing first.
    private scheduleForcePopupHide(): void {
        this.cancelForcePopupHide();
        this.forcePopupHideTimer = setTimeout(() => {
            this.forcePopupHideTimer = null;
            if (!this.lockedPart) this.forcePopupGroup.style.display = "none";
        }, 400);
    }

    private cancelForcePopupHide(): void {
        if (this.forcePopupHideTimer !== null) {
            clearTimeout(this.forcePopupHideTimer);
            this.forcePopupHideTimer = null;
        }
    }

    private updateForceOverlay(part: Part): void {
        const ring = this.conflictRings.get(part);
        if (ring) {
            // Private reverie's target/group (hyperFocused) is, by definition, no longer torn
            // between Self and blended - it's the sole object of a Self-excluding perimeter,
            // fully blended rather than in conflict - so the ring never shows for it even if
            // its underlying forces still read as opposed.
            const conflict = part.hyperFocused ? 0 : InwardPerspectiveExplorer.computeConflict(part.forces);
            ring.setAttribute("cx", String(part.x));
            ring.setAttribute("cy", String(part.y - EMOJI_VERTICAL_CENTER_OFFSET));
            ring.setAttribute("r", "17");
            // Fixed red hue; opacity itself conveys the degree of conflict.
            ring.style.stroke = "hsl(0, 85%, 50%)";
            ring.style.opacity = conflict > 0.75 ? String(Math.min(1, (conflict - 0.75) / 0.25)) : "0";
            if (conflict > 0.75) this.maybeSpawnConflictEmoji(part);
        }
        if (this.lockedPart === part || (!this.lockedPart && this.hoveredPart === part)) {
            this.showForcePopup(part);
        }
    }

    // Occasional single pain-emoji drifting off a conflicted part, echoing urbb-web's
    // review-pledge confirm burst (spawnConfirmWave/spawnConfirmBurst) but much sparser -
    // one small drift per throttle interval instead of multi-wave bursts, since this plays
    // continuously while conflict is high rather than once on a click.
    private maybeSpawnConflictEmoji(part: Part): void {
        const now = performance.now();
        const last = this.lastConflictEmojiSpawn.get(part) ?? -Infinity;
        if (now - last < CONFLICT_EMOJI_SPAWN_INTERVAL_MS) return;
        this.lastConflictEmojiSpawn.set(part, now);

        const emoji = CONFLICT_EMOJIS[Math.floor(Math.random() * CONFLICT_EMOJIS.length)];
        const angle = Math.random() * Math.PI * 2;
        const originX = part.x;
        const originY = part.y - EMOJI_VERTICAL_CENTER_OFFSET;

        const el = svgEl("text");
        el.classList.add("ipe-conflict-emoji");
        el.textContent = emoji;
        this.svg.insertBefore(el, this.forcePopupGroup);

        const start = performance.now();
        const animate = (t: number) => {
            const age = t - start;
            const frac = Math.min(1, age / CONFLICT_EMOJI_DURATION_MS);
            const dist = CONFLICT_EMOJI_SPEED * (age / 1000);
            const x = originX + Math.cos(angle) * dist;
            const y = originY + Math.sin(angle) * dist - dist * 0.5; // slight upward drift
            el.setAttribute("x", String(x));
            el.setAttribute("y", String(y));
            // Holds at full opacity through CONFLICT_EMOJI_HOLD_FRAC of the transit before
            // fading, so it's actually visible rather than starting to fade the instant it
            // spawns.
            const fadeFrac = Math.max(0, (frac - CONFLICT_EMOJI_HOLD_FRAC) / (1 - CONFLICT_EMOJI_HOLD_FRAC));
            el.style.opacity = String(1 - fadeFrac);
            if (frac < 1) {
                requestAnimationFrame(animate);
            } else {
                el.remove();
            }
        };
        requestAnimationFrame(animate);
    }

    private draggingPart: Part | null = null;

    private onPointerDown(_e: PointerEvent): void {
        if (this.drugWheel.isOpen()) this.drugWheel.close();
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

    private onSelectDrug(key: string): void {
        this.selectedDrugKey = key;
        this.doseController.selectDrug(key);
        this.drugWheel.setSelected(key);
    }

    // Fired by DoseController on administer/cancel.
    private onDoseChange(drug: DrugEffect, _value: number): void {
        if (drug.rendersAsPart) {
            this.syncCannabisPart(drug);
        }
        this.selfEnergyKnob.setBaseline(this.doseController.computeSelfEnergyBaseline());
    }

    private syncCannabisPart(drug: DrugEffect): void {
        if (!this.doseController.isActive(drug.key)) {
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
                // Tracks THC dose fraction rather than being randomly sampled.
                blendUrgency: this.doseController.doses.cannabis,
                forces: [],
                extraLinkTo: this.rollExtraLink(),
                hyperFocused: false,
            };
            el.addEventListener("pointerdown", (e) => {
                e.stopPropagation();
                this.startDrag(part, e);
            });
            this.partsLayer.appendChild(el);
            this.cannabisPart = part;
            this.parts.push(part);
            this.wireForcePopup(part);
        } else {
            this.cannabisPart.blendUrgency = this.doseController.doses.cannabis;
        }
    }

    private updateReadout(): void {
        const qualities = selfQualitiesFor(this.selfEnergy);

        const activeFeelings = Array.from(
            new Set(
                this.parts
                    .filter((p) => !p.fadingOut)
                    .map((p) => {
                        const word = blendIntensityWord(this.effectiveBlendUrgency(p));
                        return word ? `${word} ${p.feeling}` : p.feeling;
                    }),
            ),
        );

        this.readoutTitle.textContent = this.focusedParts.length > 0 ? "Private reverie" : `Self: ${qualities.join(", ")}`;
        this.readoutBody.textContent =
            this.focusedParts.length > 0 ? "" : `focus: ${focusPhrase(this.currentCircleCount, this.shrinkWrap, this.selfEnergy)}`;

        while (this.readoutFeelings.firstChild) this.readoutFeelings.removeChild(this.readoutFeelings.firstChild);
        if (activeFeelings.length) {
            const overflow = activeFeelings.length - READOUT_MAX_LISTED_PARTS;
            const listed = overflow > 0 ? activeFeelings.slice(0, READOUT_MAX_LISTED_PARTS) : activeFeelings;
            const items = overflow > 0 ? [...listed, `+${overflow} more`] : listed;
            const lines = wrapCommaList(items, 34);
            lines.forEach((line, i) => {
                const tspan = svgEl("tspan");
                tspan.setAttribute("x", this.readoutFeelings.getAttribute("x")!);
                tspan.setAttribute("dy", i === 0 ? "0" : "13");
                tspan.textContent = i === 0 ? `parts: ${line}` : line;
                this.readoutFeelings.appendChild(tspan);
            });
        }
    }

    private tick(ts: number): void {
        const dt = this.lastTs ? Math.min(0.05, (ts - this.lastTs) / 1000) : 0;
        this.lastTs = ts;

        const AVOID_PART_RADIUS = 40;
        const unblendPush = this.unblendPressure();
        const blendPush = this.blendPressure();
        for (const p of this.parts) {
            if (p === this.draggingPart) continue;
            // Wander as occasional larger impulses rather than continuous per-frame noise -
            // WANDER_KICK_CHANCE_PER_SEC tuned so a kick lands roughly every couple of seconds
            // per part, each one a single discrete nudge (not scaled by dt, since it's an
            // event, not a rate) rather than smoothed-out jitter that reads as nervous. Doubled
            // when the part is currently conflicted (last frame's forces, since this frame's
            // haven't been computed yet), reading as restlessness under the pull both ways.
            const conflicted = !p.hyperFocused && InwardPerspectiveExplorer.computeConflict(p.forces) > 0.75;
            const wanderChance = conflicted
                ? InwardPerspectiveExplorer.WANDER_KICK_CHANCE_PER_SEC_CONFLICTED
                : InwardPerspectiveExplorer.WANDER_KICK_CHANCE_PER_SEC;
            if (Math.random() < wanderChance * dt) {
                const angle = Math.random() * Math.PI * 2;
                p.vx += Math.cos(angle) * InwardPerspectiveExplorer.WANDER_KICK_STRENGTH;
                p.vy += Math.sin(angle) * InwardPerspectiveExplorer.WANDER_KICK_STRENGTH;
            }

            // Every named force is always recorded, even at zero magnitude, so the
            // force-breakdown popup's legend/vectors stay stable frame to frame instead of
            // rows appearing and disappearing as a part sits at a boundary or between others.
            const forces: PartForce[] = [
                { name: "Self-energy unblend", color: FORCE_COLORS.selfUnblend, x: 0, y: 0 },
                { name: "Self differentiation", color: FORCE_COLORS.selfProximity, x: 0, y: 0 },
                { name: "Blend urgency", color: FORCE_COLORS.blendUrgency, x: 0, y: 0 },
                { name: "Part repulsion", color: FORCE_COLORS.partRepulsion, x: 0, y: 0 },
            ];
            const [fSelfUnblend, fSelfProximity, fBlendUrgency, fPartRepulsion] = forces;

            // Ambient Self energy pushes parts away from blended, linearly.
            const selfPushFactor = this.selfEnergy;
            const selfPush = selfPushFactor * BLEND_FORCE_SCALE;
            // Fixed blended-to-unblended direction, independent of the part's own position -
            // using a per-part direction here would make the force's direction depend on the
            // part's y coordinate, which isn't a meaningful psychological distinction.
            const pushDirX = InwardPerspectiveExplorer.BLEND_TO_UNBLEND_DIR.x;
            const pushDirY = InwardPerspectiveExplorer.BLEND_TO_UNBLEND_DIR.y;
            {
                fSelfUnblend.x = pushDirX * (selfPush + unblendPush * BLEND_FORCE_SCALE);
                fSelfUnblend.y = pushDirY * (selfPush + unblendPush * BLEND_FORCE_SCALE);
                fSelfUnblend.displayMag = selfPushFactor + unblendPush;
                p.vx += fSelfUnblend.x * dt;
                p.vy += fSelfUnblend.y * dt;
            }

            // Self-energy "gravity": a downward-only push along y, falling off with the
            // square of vertical distance from Self, like inverse-square gravity pointed
            // away from Self. SELF_GRAVITY_CONSTANT is chosen so that even at 100% Self
            // energy this is barely perceptible down at the blended/unblended vertices'
            // y-level (~300px below Self), but noticeably stronger for a part near Self.
            const dy = Math.max(30, p.y - VERTEX_BY_NAME.self.y);
            fSelfProximity.y = (this.selfEnergy * InwardPerspectiveExplorer.SELF_GRAVITY_CONSTANT) / (dy * dy);
            p.vy += fSelfProximity.y * dt;

            // Each part's own effective blend urgency (baseline, quieted by active drugs -
            // see effectiveBlendUrgency) pulls it steadily toward blended, plus any direct
            // drug-driven blendPush (N,N-DMT's mechanism, mirroring unblendPush above -
            // bypasses ambient Self energy the same way THH's unblend push does).
            {
                const blendUrgency = this.effectiveBlendUrgency(p);
                const blendPull = (blendUrgency + blendPush) * BLEND_FORCE_SCALE;
                fBlendUrgency.x = -pushDirX * blendPull;
                fBlendUrgency.y = -pushDirY * blendPull;
                fBlendUrgency.displayMag = blendUrgency + blendPush;
                p.vx += fBlendUrgency.x * dt;
                p.vy += fBlendUrgency.y * dt;
            }

            for (const other of this.parts) {
                if (other === p) continue;
                const odx = p.x - other.x;
                const ody = p.y - other.y;
                const oDist = Math.hypot(odx, ody);
                if (oDist < AVOID_PART_RADIUS && oDist > 0.01) {
                    const push = (1 - oDist / AVOID_PART_RADIUS) * 50;
                    fPartRepulsion.x += (odx / oDist) * push;
                    fPartRepulsion.y += (ody / oDist) * push;
                }
            }
            p.vx += fPartRepulsion.x * dt;
            p.vy += fPartRepulsion.y * dt;

            p.forces = forces;

            p.vx *= 0.95;
            p.vy *= 0.95;
            const clamped = clampPartPosition(p.x + p.vx, p.y + p.vy);
            p.x = clamped.x;
            p.y = clamped.y;

            p.el.setAttribute("x", String(p.x));
            p.el.setAttribute("y", String(p.y));

            const targetOpacity = p.fadingOut ? 0 : 1;
            p.opacity = lerp(p.opacity, targetOpacity, 1 - Math.exp(-6 * dt));
            p.el.style.opacity = String(p.opacity);

            this.updateForceOverlay(p);
        }

        if (this.parts.some((p) => p.fadingOut && p.opacity < 0.02)) {
            for (const p of this.parts) {
                if (p.fadingOut && p.opacity < 0.02) {
                    p.el.remove();
                    this.conflictRings.get(p)?.remove();
                    this.conflictRings.delete(p);
                    this.lastConflictEmojiSpawn.delete(p);
                    if (this.hoveredPart === p) {
                        this.hoveredPart = null;
                        if (!this.lockedPart) this.hideForcePopup();
                    }
                    if (this.lockedPart === p) {
                        this.lockedPart = null;
                        this.hideForcePopup();
                    }
                    // Any other part's extra attention-perimeter link may point at this
                    // one; left dangling, its connector capsule would keep enclosing the
                    // now-gone part's last position forever.
                    for (const other of this.parts) {
                        if (other.extraLinkTo === p) other.extraLinkTo = null;
                    }
                    // Removed by some other path (Sweep, cannabis cancel) while still the
                    // Private reverie focus target - drop it so focus-lock re-evaluates
                    // cleanly next check instead of referencing a removed part.
                    if (this.focusedParts.includes(p)) {
                        this.focusedParts = this.focusedParts.filter((f) => f !== p);
                        for (const f of this.focusedParts) f.hyperFocused = false;
                        this.focusedParts = [];
                    }
                }
            }
            this.parts = this.parts.filter((p) => !(p.fadingOut && p.opacity < 0.02));
        }

        const circles = buildCircles(this.selfEnergy, this.parts, this.focusedParts);

        this.targetShrinkWrap = this.debugShrinkWrapOverride ?? computeTargetShrinkWrap(this.selfEnergy, this.blendPressure(), this.thhShrinkWrapEffect());
        this.shrinkWrap = lerp(this.shrinkWrap, this.targetShrinkWrap, 1 - Math.exp(-1.5 * dt));

        this.currentCircleCount = circles.length;
        this.wobblePhase = this.wobblePhase.map((ph, i) => ph + dt * (0.6 + i * 0.23));

        this.attnPerimeterPath.setAttribute(
            "d",
            buildAttnPerimeterPath(circles, this.parts, this.shrinkWrap, this.wobblePhase, this.focusedParts),
        );
        this.updateReadout();

        if (this.debugEnabled) this.updateDebugOverlay(circles);

        requestAnimationFrame((next) => this.tick(next));
    }

    private updateDebugOverlay(circles: Circle[]): void {
        const capsules = buildConnectorCapsules(circles[0], this.parts, this.shrinkWrap);

        this.debugCircles.textContent = "";
        for (const c of circles) {
            const el = svgEl("circle");
            el.classList.add("ipe-debug-circle");
            el.setAttribute("cx", String(c.x));
            el.setAttribute("cy", String(c.y));
            el.setAttribute("r", String(c.r));
            this.debugCircles.appendChild(el);
        }
        for (const cap of capsules) {
            const el = svgEl("line");
            el.classList.add("ipe-debug-capsule");
            el.setAttribute("x1", String(cap.ax));
            el.setAttribute("y1", String(cap.ay));
            el.setAttribute("x2", String(cap.bx));
            el.setAttribute("y2", String(cap.by));
            this.debugCircles.appendChild(el);
        }

        // Coarse sampled-field grid: each dot's fill/size shows the raw metaball field
        // value at that point, red once it crosses the current threshold (i.e. "inside"
        // the perimeter marching squares would draw) - this is the actual scalar field
        // the isoline-extraction algorithm walks, made visible directly instead of only
        // showing its end result (the perimeter path).
        this.debugField.textContent = "";
        const threshold = thresholdFor(this.shrinkWrap);
        const cols = 24, rows = 20;
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
        const margin = 60;
        minX -= margin; minY -= margin; maxX += margin; maxY += margin;
        for (let j = 0; j <= rows; j++) {
            for (let i = 0; i <= cols; i++) {
                const x = lerp(minX, maxX, i / cols);
                const y = lerp(minY, maxY, j / rows);
                const f = fieldAt(x, y, circles, capsules);
                const inside = f >= threshold;
                const dot = svgEl("circle");
                dot.classList.add("ipe-debug-field-dot");
                dot.setAttribute("cx", String(x));
                dot.setAttribute("cy", String(y));
                dot.setAttribute("r", inside ? "2.2" : "1");
                dot.setAttribute("fill", inside ? "#e74c3c" : "#7f8c8d");
                this.debugField.appendChild(dot);
            }
        }

        const lines: string[] = [];
        lines.push(`selfEnergy: ${this.selfEnergy.toFixed(2)} (baseline ${this.selfEnergyKnob.currentBaseline.toFixed(2)} + fraction ${this.selfEnergyKnob.currentUserFraction.toFixed(2)})`);
        lines.push(`currentUserFraction: ${this.selfEnergyKnob.currentUserFraction.toFixed(3)}`);
        const focusNote = this.focusedParts.length > 0 ? ` [Private reverie: ${this.focusedParts.length} part(s), Self excluded]` : "";
        lines.push(`circles: ${circles.length}${focusNote}${this.parts.length ? " parts @ " + this.parts.map((p) => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(", ") : ""}`);
        lines.push(`shrinkWrap: ${this.shrinkWrap.toFixed(2)} (target ${this.targetShrinkWrap.toFixed(2)})  threshold: ${threshold.toFixed(3)}`);
        lines.push(`blendPressure: ${this.blendPressure().toFixed(2)}  unblendPressure: ${this.unblendPressure().toFixed(2)}  thhShrinkWrapEffect: ${this.thhShrinkWrapEffect().toFixed(2)}`);
        lines.push(`field grid: red dot = inside (field >= threshold), gray = outside`);

        this.debugPanel.textContent = lines.join("\n");
    }
}

// Rotary knob + small draggable parts need a mouse and real screen space -
// below this width, decline rather than serve an unusable widget.
const MOBILE_WIDTH_THRESHOLD = 600;

const container = document.getElementById("inward-perspective-explorer-widget");
if (container) {
    if (window.innerWidth < MOBILE_WIDTH_THRESHOLD) {
        const notice = document.createElement("p");
        notice.style.cssText = "max-width: 480px; margin: 1.5em auto; padding: 1em; text-align: center; opacity: 0.75; font-style: italic;";
        notice.textContent =
            "🖥️ This little world of Self and parts wants a bigger screen and a mouse to fidget with. Come back on desktop!";
        container.appendChild(notice);
    } else {
        new InwardPerspectiveExplorer(container);
    }
}
