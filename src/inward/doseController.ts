import { DRUGS, DRUG_BY_KEY, INTERACTIONS, type DrugEffect } from "./drugData";
import { VERTEX_BY_NAME, lerp, svgEl } from "./geometry";

export interface DoseControllerCallbacks {
    onDoseChange: (drug: DrugEffect, value: number) => void;
}

// Owns dosing state and the picker UI wired to it. See docs/inward-primer.txt.
export class DoseController {
    doses: Record<string, number> = {};
    private administeredKeys = new Set<string>();
    // Staged slider value, not yet administered.
    private pendingDose = 0;
    private selectedDrugKey: string;

    private pickerRow!: HTMLElement;
    private doseSlider!: HTMLInputElement;
    private doseValueLabel!: HTMLElement;
    private administerBtn!: HTMLButtonElement;
    private warningEl!: HTMLElement;
    private appliedListEl: SVGGElement;
    private appliedListX: number;
    private appliedListY: number;

    constructor(
        root: HTMLElement,
        svg: SVGSVGElement,
        w: number,
        h: number,
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
        svg.appendChild(this.appliedListEl);

        const picker = document.createElement("div");
        picker.className = "ipe-picker";
        this.pickerRow = picker;
        picker.style.left = `${(drugWheelCenterX / w) * 100}%`;
        picker.style.top = `${((drugWheelCenterY + 40) / h) * 100}%`;
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

        root.appendChild(picker);

        this.configureSliderFor(DRUG_BY_KEY[this.selectedDrugKey]);

        this.warningEl = document.createElement("div");
        this.warningEl.className = "ipe-warning";
        root.appendChild(this.warningEl);
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
            } else if (drug.selfEnergyBoostMax !== undefined) {
                baseline += drug.selfEnergyBoostMax * this.doses[drug.key];
            }
        }
        return baseline;
    }

    // Stepped snapping for drugs with doseSteps, else a free 0-100 slider.
    private configureSliderFor(drug: DrugEffect): void {
        const currentDose = this.doses[drug.key];
        if (drug.doseSteps) {
            const labels = drug.doseStepLabels ?? drug.doseSteps.map((f) => `${Math.round(f * 100)}%`);
            this.doseSlider.min = "0";
            this.doseSlider.max = String(drug.doseSteps.length - 1);
            this.doseSlider.step = "1";
            const idx = Math.max(0, drug.doseSteps.indexOf(currentDose));
            this.doseSlider.value = String(idx);
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
        this.applyDoseChange(drug, this.pendingDose);
        this.updateAdministerBtn();
    }

    // 5-MAPB cannot be combined with anything else, in either direction.
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

    private applyDoseChange(drug: DrugEffect, value: number): void {
        this.doses[drug.key] = value;
        this.syncContraindications();
        this.updateWarning();
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
