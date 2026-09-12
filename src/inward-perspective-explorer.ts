// Animated explorer for the "Inward perspective" axis of the Psychological
// Characterization scale. See docs/inward-primer.txt for architecture.

import { DRUGS, type DrugEffect } from "./inward/drugData";
import { CX, H, VERTEX_BY_NAME, VERTICES, W, clampPartPosition, lerp, sigmoid, svgEl } from "./inward/geometry";
import { PARTS_PALETTE, type Part } from "./inward/part";
import { BLEND_FORCE_SCALE, buildRegionPath, collectRegionPressures, computeRadius, computeTargetCentroid, computeTargetShrinkWrap } from "./inward/regionPhysics";
import { blendIntensityWord, focusPhrase, selfQualitiesFor } from "./inward/readoutText";
import { DrugWheel } from "./inward/drugWheel";
import { SelfEnergyKnob } from "./inward/selfEnergyKnob";
import { DoseController } from "./inward/doseController";

class InwardPerspectiveExplorer {
    private root: HTMLElement;
    private svg: SVGSVGElement;
    private regionPath: SVGPathElement;
    private centroid = { x: CX, y: 170 };
    private targetCentroid = { x: CX, y: 170 };
    private baseRadius = 70; // diffuse-Self default
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
    private currentRadius = 70;
    private lastTs = 0;

    // Debug overlay, enabled via ?debug=1 in the URL.
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

            const emoji = svgEl("text");
            emoji.classList.add("ipe-vertex-emoji");
            if (v.name === "self") emoji.classList.add("ipe-self-knob");
            emoji.setAttribute("x", String(v.x));
            emoji.setAttribute("y", String(v.y + 8));
            emoji.textContent = v.emoji;
            this.svg.appendChild(emoji);
        }
        this.selfEnergyKnob = new SelfEnergyKnob(this.svg, W);

        this.regionPath = svgEl("path");
        this.regionPath.classList.add("ipe-region");
        this.svg.insertBefore(this.regionPath, this.svg.firstChild);

        // Debug overlay markers.
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
        }

        this.svg.addEventListener("pointerdown", (e) => this.onPointerDown(e));

        requestAnimationFrame((ts) => this.tick(ts));
        this.updateReadout();
        this.addRandomPart(); // at least one part present on load, rather than waiting 5-10s
        this.scheduleSpawn();
        this.scheduleReap();
    }

    // Spontaneous parts, oldest first (excludes the cannabis part).
    private spontaneousParts: Part[] = [];

    // Above this Self energy, spawning stops and parts can be reaped to zero.
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
        const { x, y } = clampPartPosition(this.centroid.x + Math.cos(angle) * r, this.centroid.y + Math.sin(angle) * r);
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
            };
            el.addEventListener("pointerdown", (e) => {
                e.stopPropagation();
                this.startDrag(part, e);
            });
            this.svg.appendChild(el);
            this.cannabisPart = part;
            this.parts.push(part);
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

        this.readoutTitle.textContent = focusPhrase(this.currentRadius);
        this.readoutBody.textContent = `${qualities.join(", ")}.`;
        this.readoutFeelings.textContent = activeFeelings.length ? `parts: ${activeFeelings.join(", ")}` : "";
    }

    private tick(ts: number): void {
        const dt = this.lastTs ? Math.min(0.05, (ts - this.lastTs) / 1000) : 0;
        this.lastTs = ts;

        const AVOID_PART_RADIUS = 40;
        // Total direct push away from blended contributed by active drugs' unblendPushMax.
        let unblendPush = 0;
        for (const drug of DRUGS) {
            if (drug.unblendPushMax === undefined) continue;
            unblendPush += drug.unblendPushMax * this.doseController.doses[drug.key];
        }
        for (const p of this.parts) {
            if (p === this.draggingPart) continue;
            p.vx += (Math.random() - 0.5) * 12 * dt;
            p.vy += (Math.random() - 0.5) * 12 * dt;

            // Ambient Self energy pushes parts away from blended, via a sigmoid ramp.
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

            // Linear push from Self, along the Self-to-part line.
            const sdx = p.x - VERTEX_BY_NAME.self.x;
            const sdy = p.y - VERTEX_BY_NAME.self.y;
            const sDist = Math.hypot(sdx, sdy);
            if (sDist > 0.01) {
                const selfEdgePush = this.selfEnergy * 6;
                p.vx += (sdx / sDist) * selfEdgePush * dt;
                p.vy += (sdy / sDist) * selfEdgePush * dt;
            }

            // Each part's own blendPropensity pulls it steadily toward blended.
            if (p.blendPropensity > 0 && bDist > 0.01) {
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
            const clamped = clampPartPosition(p.x + p.vx, p.y + p.vy);
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

        const pressures = collectRegionPressures(this.doseController.doses, (key) => this.doseController.isActive(key));

        this.targetCentroid = computeTargetCentroid(this.selfEnergy, this.parts, pressures);
        this.centroid.x = lerp(this.centroid.x, this.targetCentroid.x, 1 - Math.exp(-3.5 * dt));
        this.centroid.y = lerp(this.centroid.y, this.targetCentroid.y, 1 - Math.exp(-3.5 * dt));

        this.targetShrinkWrap = computeTargetShrinkWrap(this.parts, pressures);
        this.shrinkWrap = lerp(this.shrinkWrap, this.targetShrinkWrap, 1 - Math.exp(-1.5 * dt));

        const radius = computeRadius(this.baseRadius, this.shrinkWrap, this.selfEnergy, this.centroid, this.parts, pressures);
        this.currentRadius = radius;
        this.wobblePhase = this.wobblePhase.map((ph, i) => ph + dt * (0.6 + i * 0.23));

        this.regionPath.setAttribute("d", buildRegionPath(this.centroid, radius, this.shrinkWrap, this.wobblePhase));
        this.updateReadout();

        if (this.debugEnabled) this.updateDebugOverlay(pressures);

        requestAnimationFrame((next) => this.tick(next));
    }

    private updateDebugOverlay(pressures: ReturnType<typeof collectRegionPressures>): void {
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
        const pullDrugs = DRUGS.filter((d) => d.pull && !d.rendersAsPart && this.doseController.isActive(d.key));
        const distToSelf = Math.hypot(this.centroid.x - VERTEX_BY_NAME.self.x, this.centroid.y - VERTEX_BY_NAME.self.y);
        const selfInclusionRadius = (distToSelf + 24) * this.selfEnergy;
        const selfConstraintActive = selfInclusionRadius > this.currentRadius - 0.5;

        this.debugSelfLine.setAttribute("x1", String(this.centroid.x));
        this.debugSelfLine.setAttribute("y1", String(this.centroid.y));
        this.debugSelfLine.setAttribute("x2", String(VERTEX_BY_NAME.self.x));
        this.debugSelfLine.setAttribute("y2", String(VERTEX_BY_NAME.self.y));
        this.debugSelfLine.style.display = selfConstraintActive ? "" : "none";

        const lines: string[] = [];
        lines.push(`selfEnergy: ${this.selfEnergy.toFixed(2)} (baseline ${this.selfEnergyKnob.currentBaseline.toFixed(2)} + fraction ${this.selfEnergyKnob.currentUserFraction.toFixed(2)})`);
        lines.push(`centroid weights: self=${wSelf.toFixed(2)} blendedDrift=${wBlendedDrift.toFixed(2)}`);
        lines.push(`parts: ${this.parts.length} (weight 2.2 each)${this.parts.length ? " @ " + this.parts.map((p) => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(", ") : ""}`);
        if (pullDrugs.length) {
            lines.push(
                "drug pull: " +
                pullDrugs
                    .map((drug) => `${drug.name} dose=${this.doseController.doses[drug.key].toFixed(2)} pull=(self ${drug.pull!.self}, blended ${drug.pull!.blended}, unblended ${drug.pull!.unblended})`)
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
}

const container = document.getElementById("inward-perspective-explorer");
if (container) new InwardPerspectiveExplorer(container);
