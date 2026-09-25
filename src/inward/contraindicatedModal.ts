import type { DrugEffect } from "./drugData";

// Playful messages for the contraindicated-combo modal - {a}/{b}/{note} get substituted.
// Suggests removing the other drug first rather than just refusing the dose.
const CONTRAINDICATED_MESSAGES: string[] = [
    "{a} and {b} really don't want to meet each other ({note}). Remove {b} first?",
    "Whoa there - {a} + {b} is a bad scene ({note}). Try clearing {b} before administering {a}.",
    "Your body called and said no to {a} + {b} ({note}). Remove {b} and try again.",
    "That combo's a hard pass: {a} + {b} ({note}). Clear {b} first, then go for it.",
];

// Modal warning shown when DoseController's onContraindicated fires - HTML overlay (not
// SVG) appended to the widget root, since it needs to sit above the whole widget.
export class ContraindicatedModal {
    private backdrop: HTMLElement;
    private text: HTMLElement;

    constructor(root: HTMLElement) {
        this.backdrop = document.createElement("div");
        this.backdrop.className = "ipe-contraindicated-modal-backdrop";
        this.backdrop.addEventListener("click", (e) => {
            if (e.target === this.backdrop) this.hide();
        });
        const modal = document.createElement("div");
        modal.className = "ipe-contraindicated-modal";
        const emoji = document.createElement("div");
        emoji.className = "ipe-contraindicated-modal-emoji";
        emoji.textContent = "🚫";
        modal.appendChild(emoji);
        this.text = document.createElement("p");
        this.text.className = "ipe-contraindicated-modal-text";
        modal.appendChild(this.text);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ipe-contraindicated-modal-btn";
        btn.textContent = "Got it";
        btn.addEventListener("click", () => this.hide());
        modal.appendChild(btn);
        this.backdrop.appendChild(modal);
        root.appendChild(this.backdrop);

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && this.backdrop.classList.contains("ipe-open")) this.hide();
        });
    }

    show(drug: DrugEffect, other: DrugEffect, note: string): void {
        const template = CONTRAINDICATED_MESSAGES[Math.floor(Math.random() * CONTRAINDICATED_MESSAGES.length)];
        this.text.textContent = template.replace(/{a}/g, drug.name).replace(/{b}/g, other.name).replace(/{note}/g, note);
        this.backdrop.classList.add("ipe-open");
    }

    hide(): void {
        this.backdrop.classList.remove("ipe-open");
    }
}
