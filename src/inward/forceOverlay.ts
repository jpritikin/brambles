import { svgEl, W } from "./geometry";
import { computeConflict, type Part } from "./part";
import { EMOJI_VERTICAL_CENTER_OFFSET } from "./attnPerimeter";

// Legend colors for the per-part force breakdown popup, keyed by force name (part.ts's
// PartForce.name). One entry per named force pushed in the tick loop.
export const FORCE_COLORS: Record<string, string> = {
    selfUnblend: "#e74c3c",
    selfProximity: "#2980b9",
    blendUrgency: "#27ae60",
    partRepulsion: "#f39c12",
};

// Small burst of these drifts off a part while its conflict ring is showing - a pained
// reaction to being pulled toward Self and blended at once. Non-face emoji deliberately,
// since part emoji are already pained faces - a face here would blend into the part's own
// emoji instead of reading as a distinct effect.
const CONFLICT_EMOJIS = ["🗡️", "💥", "⛓️", "🩸"];
const CONFLICT_EMOJI_SPEED = 20;
const CONFLICT_EMOJI_DURATION_MS = 1600;
// Fraction of the transit spent at full opacity before fading out.
const CONFLICT_EMOJI_HOLD_FRAC = 0.35;
// Minimum gap between bursts on the same part - plays continuously while conflict is high
// rather than once on a click, so bursts stay sparse rather than overlapping.
const CONFLICT_EMOJI_SPAWN_INTERVAL_MS = 900;

// Per-part hover/click force-breakdown popup, conflict ring, and conflict pain-emoji
// bursts - grouped together since all three are driven by the same per-frame call
// (update()) off the same part.forces/hyperFocused state.
export class ForceOverlay {
    private forcePopupGroup: SVGGElement;
    private forcePopupBg: SVGRectElement;
    private forcePopupPin: SVGGElement;
    private hoveredPart: Part | null = null;
    private lockedPart: Part | null = null;
    private forcePopupHideTimer: ReturnType<typeof setTimeout> | null = null;
    private forcePopupVisiblePart: Part | null = null;
    private conflictRings = new Map<Part, SVGCircleElement>();
    // Last time (ms) each conflicted part spawned a pain-emoji burst - throttles spawns to
    // an occasional pulse rather than one every frame.
    private lastConflictEmojiSpawn = new Map<Part, number>();

    constructor(private svg: SVGSVGElement) {
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
        const forcePopupPinBg = svgEl("circle");
        forcePopupPinBg.classList.add("ipe-force-popup-pin-bg");
        forcePopupPinBg.setAttribute("r", "8");
        this.forcePopupPin.appendChild(forcePopupPinBg);
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
    }

    // Wires hover/click behavior for a newly created part and creates its conflict ring.
    wirePart(part: Part): void {
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

    // Cleans up a removed part's ring/popup/throttle state.
    removePart(part: Part): void {
        this.conflictRings.get(part)?.remove();
        this.conflictRings.delete(part);
        this.lastConflictEmojiSpawn.delete(part);
        if (this.hoveredPart === part) {
            this.hoveredPart = null;
            if (!this.lockedPart) this.hideForcePopup();
        }
        if (this.lockedPart === part) {
            this.lockedPart = null;
            this.hideForcePopup();
        }
    }

    // Per-frame update for one part: conflict ring opacity/spawn and (if this part is the
    // one currently shown) popup content refresh.
    update(part: Part): void {
        const ring = this.conflictRings.get(part);
        if (ring) {
            // Private reverie's target/group (hyperFocused) is, by definition, no longer torn
            // between Self and blended - it's the sole object of a Self-excluding perimeter,
            // fully blended rather than in conflict - so the ring never shows for it even if
            // its underlying forces still read as opposed.
            const conflict = part.hyperFocused ? 0 : computeConflict(part.forces);
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
}
