import { lerp, svgEl } from "./geometry";
import { buildConnectorCapsules, fieldAt, thresholdFor, type Circle } from "./attnPerimeter";
import type { Part } from "./part";

export interface DebugOverlayState {
    selfEnergy: number;
    selfEnergyBaseline: number;
    selfEnergyUserFraction: number;
    parts: Part[];
    focusedParts: Part[];
    shrinkWrap: number;
    targetShrinkWrap: number;
    blendPressure: number;
    unblendPressure: number;
    thhShrinkWrapEffect: number;
}

// Debug overlay enabled via ?debug=1: outlines of the actual Self/part circles the
// perimeter wraps, a sampled metaball field grid, a text readout of live physics values,
// and a shrinkWrap override slider for manually inspecting perimeter tightness.
export class DebugOverlay {
    private debugCircles: SVGGElement;
    private debugField: SVGGElement;
    private debugPanel: HTMLElement;
    // Non-null while the shrinkWrap override slider is in use, overriding
    // computeTargetShrinkWrap() for manual inspection of the perimeter's tightness.
    private shrinkWrapOverride: number | null = null;

    constructor(svg: SVGSVGElement, root: HTMLElement) {
        this.debugField = svgEl("g");
        this.debugCircles = svgEl("g");
        svg.appendChild(this.debugField);
        svg.appendChild(this.debugCircles);

        this.debugPanel = document.createElement("div");
        this.debugPanel.className = "ipe-debug-panel";
        root.appendChild(this.debugPanel);

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
            this.shrinkWrapOverride = shrinkWrapCheckbox.checked ? Number(shrinkWrapSlider.value) : null;
        });
        shrinkWrapSlider.addEventListener("input", () => {
            if (shrinkWrapCheckbox.checked) this.shrinkWrapOverride = Number(shrinkWrapSlider.value);
        });
        shrinkWrapLabel.appendChild(shrinkWrapCheckbox);
        shrinkWrapRow.appendChild(shrinkWrapLabel);
        shrinkWrapRow.appendChild(shrinkWrapSlider);
        root.appendChild(shrinkWrapRow);
    }

    // Non-null while the override slider is checked; the host should use this in place of
    // computeTargetShrinkWrap()'s result when present.
    get targetShrinkWrapOverride(): number | null {
        return this.shrinkWrapOverride;
    }

    update(circles: Circle[], state: DebugOverlayState): void {
        const capsules = buildConnectorCapsules(circles[0], state.parts, state.shrinkWrap);

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
        const threshold = thresholdFor(state.shrinkWrap);
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
        lines.push(`selfEnergy: ${state.selfEnergy.toFixed(2)} (baseline ${state.selfEnergyBaseline.toFixed(2)} + fraction ${state.selfEnergyUserFraction.toFixed(2)})`);
        lines.push(`currentUserFraction: ${state.selfEnergyUserFraction.toFixed(3)}`);
        const focusNote = state.focusedParts.length > 0 ? ` [Private reverie: ${state.focusedParts.length} part(s), Self excluded]` : "";
        lines.push(`circles: ${circles.length}${focusNote}${state.parts.length ? " parts @ " + state.parts.map((p) => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(", ") : ""}`);
        lines.push(`shrinkWrap: ${state.shrinkWrap.toFixed(2)} (target ${state.targetShrinkWrap.toFixed(2)})  threshold: ${threshold.toFixed(3)}`);
        lines.push(`blendPressure: ${state.blendPressure.toFixed(2)}  unblendPressure: ${state.unblendPressure.toFixed(2)}  thhShrinkWrapEffect: ${state.thhShrinkWrapEffect.toFixed(2)}`);
        lines.push(`field grid: red dot = inside (field >= threshold), gray = outside`);

        this.debugPanel.textContent = lines.join("\n");
    }
}
