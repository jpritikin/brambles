import { PARTS_PALETTE } from "./part";
import { READOUT_MAX_LISTED_PARTS } from "./readoutText";

// Broader emoji choices for the manual part-add picker, beyond PARTS_PALETTE's small
// spontaneous-spawn set - the user isn't restricted to a handful of preset feelings.
// Kept in sync with PARTS_PALETTE - every choice here must have a matching feeling there,
// so the manual-add picker never produces a part with an empty feeling. Deliberately
// pruned from a much larger face-emoji set: many visually-similar faces (sad/afraid/
// uncomfortable variants) would only muddy the readout with duplicate or indistinguishable
// feelings, so each choice here is a genuinely distinct emotion.
export const MANUAL_PART_EMOJI_CHOICES: string[] = PARTS_PALETTE.map((p) => p.emoji);

// Playful messages when Remove part is clicked with nothing removable - varied rather
// than a single static line, and each one suggests what to do instead.
const NO_PARTS_TO_REMOVE_MESSAGES: string[] = [
    "Nothing to remove - your mind is already quiet. Try Add part.",
    "No parts here. Peace, for now. Add one to get started.",
    "Nobody home. Click Add part to invite someone in.",
    "All clear! Add a part if you'd like company.",
];
// Playful messages when Add part is clicked at the readout's max listed-parts count -
// reuses READOUT_MAX_LISTED_PARTS as the single source of truth for the cap, so the
// limit here always matches what the readout can actually list without overflowing.
const TOO_MANY_PARTS_MESSAGES: string[] = [
    "Full house! Try Remove part to make room for someone new.",
    "That's a lot of feelings at once. Remove one first?",
    "No more room on the perimeter - remove a part to add another.",
    "Every seat's taken. Remove part before adding.",
];

export interface ManualPartPanelCallbacks {
    // Feelings currently visible (non-fading) on screen, used to avoid repeating the same
    // emoji on the picker right after it's placed.
    takenEmojis(): Set<string>;
    // Count of non-cannabis, non-fading parts, checked against READOUT_MAX_LISTED_PARTS.
    addablePartCount(): number;
    addPart(emoji: string, blendUrgency: number): void;
    // Returns true if a part was actually removed (false if nothing was removable).
    sweepOldestPart(): boolean;
    onSimulateToggle(enabled: boolean): void;
}

// The "Add part" / "Remove part" manual-control panel below the SVG widget, plus the
// spontaneous-spawn on/off toggle. Owns its own DOM, emoji-picker, and transient-message
// state; part lifecycle itself stays with the host via the callbacks above.
export class ManualPartPanel {
    private manualEmoji: string = MANUAL_PART_EMOJI_CHOICES[0];
    private manualEmojiTriggerBtn!: HTMLButtonElement;
    private manualEmojiPopup!: HTMLElement;
    private manualUrgencyInput!: HTMLInputElement;
    private msgEl!: HTMLElement;
    private msgTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(root: HTMLElement, simulatePartsEnabled: boolean, private callbacks: ManualPartPanelCallbacks) {
        const panel = document.createElement("div");
        panel.className = "ipe-manual-part-panel";

        const toggleLabel = document.createElement("label");
        toggleLabel.className = "ipe-sim-toggle";
        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.checked = simulatePartsEnabled;
        toggleLabel.appendChild(toggle);
        toggleLabel.appendChild(document.createTextNode("Let parts appear and disappear on their own schedule"));
        panel.appendChild(toggleLabel);

        const row = document.createElement("div");
        row.className = "ipe-manual-part-row";
        row.classList.toggle("ipe-disabled", simulatePartsEnabled);

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
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") this.manualEmojiPopup.classList.remove("ipe-open");
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

        const manualUrgencyValue = document.createElement("span");
        manualUrgencyValue.className = "ipe-manual-urgency-value";
        manualUrgencyValue.textContent = Number(this.manualUrgencyInput.value).toFixed(2);
        row.appendChild(manualUrgencyValue);
        this.manualUrgencyInput.addEventListener("input", () => {
            manualUrgencyValue.textContent = Number(this.manualUrgencyInput.value).toFixed(2);
        });

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "ipe-manual-part-btn";
        addBtn.textContent = "Add part";
        addBtn.addEventListener("click", () => {
            if (this.callbacks.addablePartCount() >= READOUT_MAX_LISTED_PARTS) {
                this.showMessage(TOO_MANY_PARTS_MESSAGES[Math.floor(Math.random() * TOO_MANY_PARTS_MESSAGES.length)]);
                return;
            }
            const urgency = Number(this.manualUrgencyInput.value);
            this.callbacks.addPart(this.manualEmoji, urgency);
            this.pickRandomManualEmoji();
        });
        row.appendChild(addBtn);

        const sweepBtn = document.createElement("button");
        sweepBtn.type = "button";
        sweepBtn.className = "ipe-manual-part-btn";
        sweepBtn.textContent = "Remove part";
        sweepBtn.title = "Remove the least recently added part";
        sweepBtn.addEventListener("click", () => {
            if (!this.callbacks.sweepOldestPart()) {
                this.showMessage(NO_PARTS_TO_REMOVE_MESSAGES[Math.floor(Math.random() * NO_PARTS_TO_REMOVE_MESSAGES.length)]);
            }
        });
        row.appendChild(sweepBtn);

        panel.appendChild(row);

        this.msgEl = document.createElement("div");
        this.msgEl.className = "ipe-manual-part-msg";
        this.msgEl.style.display = "none";
        panel.appendChild(this.msgEl);

        root.appendChild(panel);

        toggle.addEventListener("change", () => {
            row.classList.toggle("ipe-disabled", toggle.checked);
            this.callbacks.onSimulateToggle(toggle.checked);
        });
    }

    private showMessage(text: string): void {
        if (this.msgTimer !== null) clearTimeout(this.msgTimer);
        this.msgEl.textContent = text;
        this.msgEl.style.display = "block";
        this.msgTimer = setTimeout(() => {
            this.msgEl.style.display = "none";
            this.msgTimer = null;
        }, 3000);
    }

    // After adding a manual part, rolls a fresh emoji for the picker so the next Add part
    // click doesn't just repeat the same feeling - excludes the just-used emoji and every
    // emoji currently on screen (spontaneous, manual, or cannabis parts alike).
    private pickRandomManualEmoji(): void {
        const taken = this.callbacks.takenEmojis();
        taken.add(this.manualEmoji);
        const available = MANUAL_PART_EMOJI_CHOICES.filter((e) => !taken.has(e));
        const pool = available.length > 0 ? available : MANUAL_PART_EMOJI_CHOICES;
        this.manualEmoji = pool[Math.floor(Math.random() * pool.length)];
        this.manualEmojiTriggerBtn.textContent = this.manualEmoji;
    }
}
