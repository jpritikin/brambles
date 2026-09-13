// Animated explorer for the "Inward perspective" axis of the Psychological
// Characterization scale. See docs/inward-primer.txt for architecture.

import { DRUGS, type DrugEffect } from "./inward/drugData";
import { CX, H, VERTEX_BY_NAME, VERTICES, W, clampPartPosition, lerp, sigmoid, svgEl } from "./inward/geometry";
import { PARTS_PALETTE, type Part, type PartForce } from "./inward/part";
import { BLEND_FORCE_SCALE, EMOJI_VERTICAL_CENTER_OFFSET, buildAttnPerimeterPath, buildCircles, buildConnectorCapsules, computeTargetShrinkWrap, fieldAt, thresholdFor, type Circle, type Capsule } from "./inward/attnPerimeter";
import { blendIntensityWord, focusPhrase, selfQualitiesFor } from "./inward/readoutText";
import { DrugWheel } from "./inward/drugWheel";
import { SelfEnergyKnob } from "./inward/selfEnergyKnob";
import { DoseController } from "./inward/doseController";

// Legend colors for the per-part force breakdown popup, keyed by force name (part.ts's
// PartForce.name). One entry per named force pushed in the tick loop below.

// Broader emoji choices for the manual part-add picker, beyond PARTS_PALETTE's small
// spontaneous-spawn set - the user isn't restricted to a handful of preset feelings.
const MANUAL_PART_EMOJI_CHOICES: string[] = [
    "😠", "😢", "😨", "😳", "💭", "🧐", "😔", "😤", "😰", "🥺",
    "😞", "😖", "😣", "😩", "😫", "🥶", "😶", "🙄", "😑", "😒",
    "🤔", "😬", "😕", "🙁", "😟", "😥", "😓", "🥱", "😴", "🤐",
];

const FORCE_COLORS: Record<string, string> = {
    selfUnblend: "#e74c3c",
    selfProximity: "#2980b9",
    blendPropensity: "#27ae60",
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
    private debugField!: SVGGElement;
    // Non-null while the debug shrink-wrap slider is being used, overriding
    // computeTargetShrinkWrap() for manual inspection of the perimeter's tightness.
    private debugShrinkWrapOverride: number | null = null;

    // Force-breakdown popup (hover, or click-to-lock) and per-part conflict ring.
    private forcePopupGroup!: SVGGElement;
    private forcePopupBg!: SVGRectElement;
    private hoveredPart: Part | null = null;
    private lockedPart: Part | null = null;
    private conflictRings = new Map<Part, SVGCircleElement>();

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
      .ipe-attn-perimeter { fill: #f400d7; fill-opacity: 0.08; stroke: #f400d7; stroke-width: 1.5; stroke-dasharray: 4,3; }
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
      .ipe-debug-shrinkwrap-row { margin-top: 0.4em; display: flex; align-items: center; gap: 0.5em; font: 11px/1.5 ui-monospace, monospace; }
      .ipe-debug-shrinkwrap-row input[type=range] { flex: 1; }
      .ipe-debug-circle { fill: none; stroke: #00b894; stroke-width: 1; stroke-dasharray: 2,2; opacity: 0.7; }
      .ipe-debug-capsule { stroke: #0984e3; stroke-width: 1; stroke-dasharray: 3,2; opacity: 0.6; }
      .ipe-debug-field-dot { opacity: 0.55; }
      .ipe-conflict-ring { fill: none; stroke-width: 2.5; pointer-events: none; opacity: 0; transition: opacity 0.2s ease; }
      .ipe-force-popup { pointer-events: none; }
      .ipe-force-popup-bg { fill: var(--body-background, #fff); stroke: #888; stroke-width: 1; opacity: 0.95; }
      .ipe-force-popup-row { font-size: 9.5px; fill: currentColor; }
      .ipe-force-popup-swatch { stroke-width: 3; stroke-linecap: round; }
      .ipe-manual-part-panel { margin-top: 0.75em; display: flex; flex-direction: column; gap: 0.5em; font-size: 0.85em; }
      .ipe-manual-part-panel label.ipe-sim-toggle { display: flex; align-items: center; gap: 0.4em; cursor: pointer; }
      .ipe-manual-part-row { display: flex; align-items: center; gap: 0.6em; flex-wrap: wrap; }
      .ipe-manual-part-row.ipe-disabled { opacity: 0.4; pointer-events: none; }
      .ipe-manual-part-row input[type=range] { width: 8em; }
      .ipe-manual-part-add-btn { border: 1px solid currentColor; background: transparent; border-radius: 999px; padding: 0.2em 0.8em; font-size: 0.9em; cursor: pointer; }
      .ipe-manual-emoji-picker-wrap { position: relative; }
      .ipe-manual-emoji-trigger { border: 1px solid currentColor; background: transparent; border-radius: 6px; font-size: 1.3em; line-height: 1; padding: 0.15em 0.4em; cursor: pointer; }
      .ipe-manual-emoji-popup { display: none; position: absolute; z-index: 10; top: calc(100% + 4px); left: 0; grid-template-columns: repeat(6, 2.2em); gap: 0.1em; padding: 0.4em; background: var(--body-background, #fff); border: 1px solid rgba(128,128,128,0.4); border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.25); }
      .ipe-manual-emoji-popup.ipe-open { display: grid; }
      .ipe-manual-emoji-btn { border: 1px solid transparent; background: transparent; border-radius: 6px; font-size: 1.7em; line-height: 2.2em; padding: 0; cursor: pointer; text-align: center; }
      .ipe-manual-emoji-btn:hover { background: rgba(128,128,128,0.2); }
      .ipe-manual-urgency-value { font-variant-numeric: tabular-nums; opacity: 0.75; min-width: 2.5em; }
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

        // Force-breakdown popup, appended last so it renders above every part.
        this.forcePopupGroup = svgEl("g");
        this.forcePopupGroup.classList.add("ipe-force-popup");
        this.forcePopupGroup.style.display = "none";
        this.forcePopupBg = svgEl("rect");
        this.forcePopupBg.classList.add("ipe-force-popup-bg");
        this.forcePopupBg.setAttribute("rx", "6");
        this.forcePopupGroup.appendChild(this.forcePopupBg);
        this.svg.appendChild(this.forcePopupGroup);

        this.root.appendChild(this.svg);

        this.doseController = new DoseController(
            this.root,
            this.svg,
            W,
            H,
            this.drugWheelCenterX,
            this.drugWheelCenterY,
            this.selectedDrugKey,
            {
                onDoseChange: (drug, value) => this.onDoseChange(drug, value),
            },
        );

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
    private static readonly WANDER_KICK_CHANCE_PER_SEC = 0.25;
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
            if (
                this.simulatePartsEnabled &&
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
            const target = candidates.reduce((best, p) => (p.blendPropensity > best.blendPropensity ? p : best));
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
            if (drug.blendPushMax === undefined) continue;
            pressure += drug.blendPushMax * this.doseController.doses[drug.key];
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
        this.svg.appendChild(el);
        const part: Part = { emoji, feeling, x, y, vx: 0, vy: 0, opacity: 0, fadingOut: false, el, blendPropensity: Math.random(), forces: [], extraLinkTo: this.rollExtraLink(), hyperFocused: false };
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

    // Removes the least-recently-added part (this.parts is in insertion order), skipping the
    // cannabis part since its lifecycle is dose-driven, not manually removable.
    private sweepOldestPart(): void {
        const oldest = this.parts.find((p) => p !== this.cannabisPart && !p.fadingOut);
        if (!oldest) return;
        oldest.fadingOut = true;
        const spontaneousIdx = this.spontaneousParts.indexOf(oldest);
        if (spontaneousIdx !== -1) this.spontaneousParts.splice(spontaneousIdx, 1);
    }

    // Adds a part the user placed by hand via the manual-add panel, bypassing spontaneous
    // spawn/reap bookkeeping (spontaneousParts) since it isn't subject to auto-reaping.
    private addManualPart(emoji: string, blendPropensity: number): void {
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
        const part: Part = { emoji, feeling, x, y, vx: 0, vy: 0, opacity: 0, fadingOut: false, el, blendPropensity, forces: [], extraLinkTo: this.rollExtraLink(), hyperFocused: false };
        el.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            this.startDrag(part, e);
        });
        this.svg.appendChild(el);
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
        addBtn.className = "ipe-manual-part-add-btn";
        addBtn.textContent = "Add part";
        addBtn.addEventListener("click", () => {
            const urgency = Number(this.manualUrgencyInput.value);
            this.addManualPart(this.manualEmoji, urgency);
        });
        row.appendChild(addBtn);

        const sweepBtn = document.createElement("button");
        sweepBtn.type = "button";
        sweepBtn.className = "ipe-manual-part-sweep-btn";
        sweepBtn.textContent = "🧹 Sweep";
        sweepBtn.title = "Remove the least recently added part";
        sweepBtn.addEventListener("click", () => this.sweepOldestPart());
        row.appendChild(sweepBtn);

        panel.appendChild(row);
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
            this.hoveredPart = part;
            if (!this.lockedPart) this.showForcePopup(part);
        });
        part.el.addEventListener("pointerleave", () => {
            if (this.hoveredPart === part) this.hoveredPart = null;
            if (!this.lockedPart) this.hideForcePopup();
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
        const rows = part.forces;

        while (this.forcePopupGroup.children.length > 1) {
            this.forcePopupGroup.removeChild(this.forcePopupGroup.lastChild!);
        }

        // Part repulsion is purely a display/anti-overlap mechanic with no psychological
        // meaning, so it's omitted from the legend (it still participates in the vector plot
        // and computeConflict above, since it does affect the part's actual motion).
        const legendRows = rows.filter((f) => f.name !== "Part repulsion");

        const rowHeight = 13;
        const width = 150;
        const plotSize = 90;
        const plotTop = 6;
        const legendTop = plotTop + plotSize + 10;
        const height = legendTop + rowHeight * Math.max(legendRows.length, 1);

        // Vector plot: each force as an arrow from the plot's center, scaled so the
        // largest-magnitude force (across all of this part's forces) reaches the edge.
        const plotCx = width / 2;
        const plotCy = plotTop + plotSize / 2;
        const maxMag = Math.max(0.01, ...rows.map((f) => Math.hypot(f.x, f.y)));
        const plotScale = plotSize / 2 - 10;

        const plotBorder = svgEl("rect");
        plotBorder.setAttribute("x", "4");
        plotBorder.setAttribute("y", String(plotTop));
        plotBorder.setAttribute("width", String(width - 8));
        plotBorder.setAttribute("height", String(plotSize));
        plotBorder.setAttribute("rx", "4");
        plotBorder.setAttribute("fill", "none");
        plotBorder.setAttribute("stroke", "currentColor");
        plotBorder.setAttribute("stroke-opacity", "0.2");
        this.forcePopupGroup.appendChild(plotBorder);

        const center = svgEl("circle");
        center.setAttribute("cx", String(plotCx));
        center.setAttribute("cy", String(plotCy));
        center.setAttribute("r", "2.5");
        center.setAttribute("fill", "currentColor");
        center.setAttribute("fill-opacity", "0.5");
        this.forcePopupGroup.appendChild(center);

        for (const f of rows) {
            const mag = Math.hypot(f.x, f.y);
            if (mag < 0.01) continue;
            const ex = plotCx + (f.x / maxMag) * plotScale;
            const ey = plotCy + (f.y / maxMag) * plotScale;

            const arrow = svgEl("line");
            arrow.setAttribute("x1", String(plotCx));
            arrow.setAttribute("y1", String(plotCy));
            arrow.setAttribute("x2", String(ex));
            arrow.setAttribute("y2", String(ey));
            arrow.setAttribute("stroke", f.color);
            arrow.setAttribute("stroke-width", "2");
            this.forcePopupGroup.appendChild(arrow);

            const angle = Math.atan2(f.y, f.x);
            const headLen = 5;
            for (const spread of [Math.PI * 0.8, -Math.PI * 0.8]) {
                const hx = ex + Math.cos(angle + spread) * headLen;
                const hy = ey + Math.sin(angle + spread) * headLen;
                const head = svgEl("line");
                head.setAttribute("x1", String(ex));
                head.setAttribute("y1", String(ey));
                head.setAttribute("x2", String(hx));
                head.setAttribute("y2", String(hy));
                head.setAttribute("stroke", f.color);
                head.setAttribute("stroke-width", "2");
                this.forcePopupGroup.appendChild(head);
            }
        }

        // Net (summed) vector, drawn on top in the current text color so it stands out
        // from the individual per-force colors.
        let netX = 0;
        let netY = 0;
        for (const f of rows) {
            netX += f.x;
            netY += f.y;
        }
        const netMag = Math.hypot(netX, netY);
        if (netMag > 0.01) {
            const nx = plotCx + (netX / maxMag) * plotScale;
            const ny = plotCy + (netY / maxMag) * plotScale;
            const netLine = svgEl("line");
            netLine.setAttribute("x1", String(plotCx));
            netLine.setAttribute("y1", String(plotCy));
            netLine.setAttribute("x2", String(nx));
            netLine.setAttribute("y2", String(ny));
            netLine.setAttribute("stroke", "currentColor");
            netLine.setAttribute("stroke-width", "1.5");
            netLine.setAttribute("stroke-dasharray", "3,2");
            this.forcePopupGroup.appendChild(netLine);
        }

        legendRows.forEach((f, i) => {
            const y = legendTop + i * rowHeight;
            const swatch = svgEl("line");
            swatch.classList.add("ipe-force-popup-swatch");
            swatch.setAttribute("x1", "6");
            swatch.setAttribute("x2", "18");
            swatch.setAttribute("y1", String(y - 3));
            swatch.setAttribute("y2", String(y - 3));
            swatch.style.stroke = f.color;
            this.forcePopupGroup.appendChild(swatch);

            const displayMag = f.displayMag ?? Math.hypot(f.x, f.y);
            const label = svgEl("text");
            label.classList.add("ipe-force-popup-row");
            label.setAttribute("x", "23");
            label.setAttribute("y", String(y));
            label.textContent = `${f.name} (${displayMag.toFixed(2)})`;
            this.forcePopupGroup.appendChild(label);
        });

        this.forcePopupBg.setAttribute("width", String(width));
        this.forcePopupBg.setAttribute("height", String(height));

        const partCy = part.y - EMOJI_VERTICAL_CENTER_OFFSET;
        let px = part.x + 18;
        let py = partCy - height - 10;
        if (px + width > W) px = part.x - width - 18;
        if (py < 0) py = partCy + 18;
        this.forcePopupGroup.setAttribute("transform", `translate(${px}, ${py})`);
    }

    private hideForcePopup(): void {
        this.forcePopupGroup.style.display = "none";
    }

    private updateForceOverlay(part: Part): void {
        const ring = this.conflictRings.get(part);
        if (ring) {
            const conflict = InwardPerspectiveExplorer.computeConflict(part.forces);
            ring.setAttribute("cx", String(part.x));
            ring.setAttribute("cy", String(part.y - EMOJI_VERTICAL_CENTER_OFFSET));
            ring.setAttribute("r", "17");
            // Fixed red hue; opacity itself conveys the degree of conflict.
            ring.style.stroke = "hsl(0, 85%, 50%)";
            ring.style.opacity = conflict > 0.75 ? String(Math.min(1, (conflict - 0.75) / 0.25)) : "0";
        }
        if (this.lockedPart === part || (!this.lockedPart && this.hoveredPart === part)) {
            this.showForcePopup(part);
        }
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
                blendPropensity: this.doseController.doses.cannabis,
                forces: [],
                extraLinkTo: this.rollExtraLink(),
                hyperFocused: false,
            };
            el.addEventListener("pointerdown", (e) => {
                e.stopPropagation();
                this.startDrag(part, e);
            });
            this.svg.appendChild(el);
            this.cannabisPart = part;
            this.parts.push(part);
            this.wireForcePopup(part);
        } else {
            this.cannabisPart.blendPropensity = this.doseController.doses.cannabis;
        }
    }

    private updateReadout(): void {
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

        this.readoutTitle.textContent =
            this.focusedParts.length > 0
                ? "Private reverie"
                : focusPhrase(this.currentCircleCount, this.shrinkWrap, this.selfEnergy);
        this.readoutBody.textContent = `${qualities.join(", ")}.`;
        this.readoutFeelings.textContent = activeFeelings.length ? `parts: ${activeFeelings.join(", ")}` : "";
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
            // event, not a rate) rather than smoothed-out jitter that reads as nervous.
            if (Math.random() < InwardPerspectiveExplorer.WANDER_KICK_CHANCE_PER_SEC * dt) {
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
                { name: "Blend urgency", color: FORCE_COLORS.blendPropensity, x: 0, y: 0 },
                { name: "Part repulsion", color: FORCE_COLORS.partRepulsion, x: 0, y: 0 },
            ];
            const [fSelfUnblend, fSelfProximity, fBlendPropensity, fPartRepulsion] = forces;

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

            // Each part's own blendPropensity pulls it steadily toward blended, plus any
            // direct drug-driven blendPush (N,N-DMT's mechanism, mirroring unblendPush above -
            // bypasses ambient Self energy the same way THH's unblend push does).
            {
                const blendPull = (p.blendPropensity + blendPush) * BLEND_FORCE_SCALE;
                fBlendPropensity.x = -pushDirX * blendPull;
                fBlendPropensity.y = -pushDirY * blendPull;
                fBlendPropensity.displayMag = p.blendPropensity + blendPush;
                p.vx += fBlendPropensity.x * dt;
                p.vy += fBlendPropensity.y * dt;
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
                    if (this.hoveredPart === p) this.hoveredPart = null;
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

        this.targetShrinkWrap = this.debugShrinkWrapOverride ?? computeTargetShrinkWrap(this.selfEnergy, this.blendPressure());
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
        const focusNote = this.focusedParts.length > 0 ? ` [Private reverie: ${this.focusedParts.length} part(s), Self excluded]` : "";
        lines.push(`circles: ${circles.length}${focusNote}${this.parts.length ? " parts @ " + this.parts.map((p) => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(", ") : ""}`);
        lines.push(`shrinkWrap: ${this.shrinkWrap.toFixed(2)} (target ${this.targetShrinkWrap.toFixed(2)})  threshold: ${threshold.toFixed(3)}`);
        lines.push(`blendPressure: ${this.blendPressure().toFixed(2)}  unblendPressure: ${this.unblendPressure().toFixed(2)}`);
        lines.push(`field grid: red dot = inside (field >= threshold), gray = outside`);

        this.debugPanel.textContent = lines.join("\n");
    }
}

const container = document.getElementById("inward-perspective-explorer");
if (container) new InwardPerspectiveExplorer(container);
