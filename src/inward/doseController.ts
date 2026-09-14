import { DRUGS, DRUG_BY_KEY, INTERACTIONS, sampleDoseCurve, type DrugEffect } from "./drugData";
import { VERTEX_BY_NAME, lerp, svgEl } from "./geometry";

export interface DoseControllerCallbacks {
    onDoseChange: (drug: DrugEffect, value: number) => void;
    // Fired instead of administering when the selected drug is contraindicated with an
    // already-active one - the parent shows a playful modal rather than blocking the button.
    onContraindicated: (drug: DrugEffect, other: DrugEffect, note: string) => void;
}

// Owns dosing state and the picker UI wired to it. See docs/inward-primer.txt.
// The picker is pure SVG (track + draggable handle + administer button), drawn
// inside the same svg/viewBox as everything else so it can't drift out of its
// control-group rectangle the way an HTML overlay would.
export class DoseController {
    doses: Record<string, number> = {};
    private administeredKeys = new Set<string>();
    // Staged slider value, not yet administered.
    private pendingDose = 0;
    private selectedDrugKey: string;

    private trackX0: number;
    private trackX1: number;
    private trackY: number;
    private trackEl: SVGLineElement;
    private handleEl: SVGCircleElement;
    private doseValueLabel: SVGTextElement;
    private administerBtn: SVGGElement;
    private administerBtnCircle: SVGCircleElement;

    private appliedListEl: SVGGElement;
    private appliedListX: number;
    private appliedListY: number;

    constructor(
        svg: SVGSVGElement,
        // Elements are appended here (a dedicated layer appended to `svg` before the
        // drug wheel/force popup) so those overlay UI elements stay painted on top
        // instead of getting covered by the picker.
        layer: SVGGElement,
        svgWidth: number,
        drugWheelCenterX: number,
        drugWheelCenterY: number,
        initialDrugKey: string,
        private callbacks: DoseControllerCallbacks,
    ) {
        this.selectedDrugKey = initialDrugKey;
        for (const drug of DRUGS) this.doses[drug.key] = 0;

        this.appliedListX = VERTEX_BY_NAME.self.x + 40;
        this.appliedListY = VERTEX_BY_NAME.self.y - 4;
        this.appliedListEl = svgEl("g");
        this.appliedListEl.classList.add("ipe-applied-list");
        layer.appendChild(this.appliedListEl);

        this.trackX0 = drugWheelCenterX - 42;
        this.trackX1 = drugWheelCenterX + 42;
        this.trackY = drugWheelCenterY + 62;

        this.doseValueLabel = svgEl("text");
        this.doseValueLabel.classList.add("ipe-dose-value");
        this.doseValueLabel.setAttribute("x", String(drugWheelCenterX));
        this.doseValueLabel.setAttribute("y", String(this.trackY - 14));
        layer.appendChild(this.doseValueLabel);

        this.trackEl = svgEl("line");
        this.trackEl.classList.add("ipe-dose-track");
        this.trackEl.setAttribute("x1", String(this.trackX0));
        this.trackEl.setAttribute("x2", String(this.trackX1));
        this.trackEl.setAttribute("y1", String(this.trackY));
        this.trackEl.setAttribute("y2", String(this.trackY));
        this.trackEl.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            this.setFractionFromClientX(e.clientX, svg, svgWidth);
            this.startDrag(svg, svgWidth);
        });
        layer.appendChild(this.trackEl);

        this.handleEl = svgEl("circle");
        this.handleEl.classList.add("ipe-dose-handle");
        this.handleEl.setAttribute("cy", String(this.trackY));
        this.handleEl.setAttribute("r", "7");
        this.handleEl.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            this.startDrag(svg, svgWidth);
        });
        layer.appendChild(this.handleEl);

        this.administerBtn = svgEl("g");
        this.administerBtn.classList.add("ipe-administer-btn");
        this.administerBtnCircle = svgEl("circle");
        this.administerBtnCircle.setAttribute("cx", String(drugWheelCenterX));
        this.administerBtnCircle.setAttribute("cy", String(this.trackY + 26));
        this.administerBtnCircle.setAttribute("r", "16");
        this.administerBtn.appendChild(this.administerBtnCircle);
        const administerLabel = svgEl("text");
        administerLabel.classList.add("ipe-administer-btn-label");
        administerLabel.setAttribute("x", String(drugWheelCenterX));
        administerLabel.setAttribute("y", String(this.trackY + 26));
        administerLabel.textContent = "🚀";
        this.administerBtn.appendChild(administerLabel);
        this.administerBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
        this.administerBtn.addEventListener("click", () => this.onAdminister());
        layer.appendChild(this.administerBtn);

        this.configureSliderFor(DRUG_BY_KEY[this.selectedDrugKey]);
    }

    isActive(key: string): boolean {
        return this.administeredKeys.has(key);
    }

    selectDrug(key: string): void {
        this.selectedDrugKey = key;
        this.configureSliderFor(DRUG_BY_KEY[key]);
    }

    computeSelfEnergyBaseline(): number {
        let baseline = 0;
        for (const drug of DRUGS) {
            if (drug.selfEnergyBoostSteps && drug.doseSteps) {
                const idx = drug.doseSteps.indexOf(this.doses[drug.key]);
                if (idx >= 0) baseline += drug.selfEnergyBoostSteps[idx] ?? 0;
            } else if (drug.doseCurve) {
                baseline += sampleDoseCurve(drug.doseCurve, this.doses[drug.key]).selfEnergyBoost;
            } else if (drug.selfEnergyBoostMax !== undefined) {
                baseline += drug.selfEnergyBoostMax * this.doses[drug.key];
            }
        }
        return baseline;
    }

    private currentStepCount(): number | null {
        const drug = DRUG_BY_KEY[this.selectedDrugKey];
        return drug.doseSteps ? drug.doseSteps.length : null;
    }

    // Stepped snapping for drugs with doseSteps, else a free 0-1 fraction.
    private configureSliderFor(drug: DrugEffect): void {
        const currentDose = this.doses[drug.key];
        if (drug.doseSteps) {
            const labels = drug.doseStepLabels ?? drug.doseSteps.map((f) => `${Math.round(f * 100)}%`);
            const idx = Math.max(0, drug.doseSteps.indexOf(currentDose));
            this.pendingDose = drug.doseSteps[idx];
            this.doseValueLabel.textContent = labels[idx];
            this.setHandleFraction(idx / (drug.doseSteps.length - 1));
        } else {
            this.pendingDose = currentDose;
            this.doseValueLabel.textContent = this.formatFreeDose(drug, currentDose);
            this.setHandleFraction(currentDose);
        }
    }

    private setHandleFraction(fraction: number): void {
        const x = lerp(this.trackX0, this.trackX1, Math.min(1, Math.max(0, fraction)));
        this.handleEl.setAttribute("cx", String(x));
    }

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

    private setFractionFromClientX(clientX: number, svg: SVGSVGElement, svgWidth: number): void {
        const rect = svg.getBoundingClientRect();
        const scale = svgWidth / rect.width;
        const svgX = (clientX - rect.left) * scale;
        const rawFraction = Math.min(1, Math.max(0, (svgX - this.trackX0) / (this.trackX1 - this.trackX0)));
        this.applyFraction(rawFraction);
    }

    private applyFraction(rawFraction: number): void {
        const drug = DRUG_BY_KEY[this.selectedDrugKey];
        const stepCount = this.currentStepCount();
        if (drug.doseSteps && stepCount) {
            const idx = Math.round(rawFraction * (stepCount - 1));
            this.pendingDose = drug.doseSteps[idx];
            const labels = drug.doseStepLabels ?? drug.doseSteps.map((f) => `${Math.round(f * 100)}%`);
            this.doseValueLabel.textContent = labels[idx];
            this.setHandleFraction(idx / (stepCount - 1));
        } else {
            this.pendingDose = rawFraction;
            this.doseValueLabel.textContent = this.formatFreeDose(drug, this.pendingDose);
            this.setHandleFraction(rawFraction);
        }
    }

    private startDrag(svg: SVGSVGElement, svgWidth: number): void {
        const move = (e: PointerEvent) => this.setFractionFromClientX(e.clientX, svg, svgWidth);
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    }

    private onAdminister(): void {
        const drug = DRUG_BY_KEY[this.selectedDrugKey];
        const contraindication = this.findContraindication(drug);
        if (contraindication) {
            this.callbacks.onContraindicated(drug, contraindication.other, contraindication.note);
            return;
        }
        this.administeredKeys.add(drug.key);
        this.applyDoseChange(drug, this.pendingDose);
    }

    // 5-MAPB cannot be combined with anything else, except cannabis and psilocybin
    // (candyflipping - a classic, well-established combo).
    private static readonly MAPB_COMPATIBLE_KEYS = new Set(["cannabis", "psilocybin"]);

    // Contraindications come from two sources: the explicit named INTERACTIONS table
    // (every entry is a hard block) and 5-MAPB's blanket exclusivity rule.
    private findContraindication(drug: DrugEffect): { other: DrugEffect; note: string } | null {
        for (const interaction of INTERACTIONS) {
            const otherKey = interaction.a === drug.key ? interaction.b : interaction.b === drug.key ? interaction.a : null;
            if (otherKey && this.isActive(otherKey)) {
                return { other: DRUG_BY_KEY[otherKey], note: interaction.note };
            }
        }
        const mapbBlocked =
            drug.key !== "mapb" &&
            !DoseController.MAPB_COMPATIBLE_KEYS.has(drug.key) &&
            this.isActive("mapb");
        if (mapbBlocked) return { other: DRUG_BY_KEY.mapb, note: "should not combine with 5-MAPB" };
        if (drug.key === "mapb") {
            const other = DRUGS.find((d) => d.key !== "mapb" && !DoseController.MAPB_COMPATIBLE_KEYS.has(d.key) && this.isActive(d.key));
            if (other) return { other, note: "should not combine 5-MAPB with another drug" };
        }
        return null;
    }

    private applyDoseChange(drug: DrugEffect, value: number): void {
        this.doses[drug.key] = value;
        this.updateAppliedList();
        this.callbacks.onDoseChange(drug, value);
    }

    cancelDrug(drug: DrugEffect): void {
        this.administeredKeys.delete(drug.key);
        this.applyDoseChange(drug, 0);
        if (this.selectedDrugKey === drug.key) {
            this.configureSliderFor(drug);
        }
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

            // Rough per-char width estimate avoids a getBBox layout reflow.
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
}
