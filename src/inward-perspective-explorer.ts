// Animated explorer for the "Inward perspective" axis of the Psychological
// Characterization scale. See docs/inward-primer.txt for architecture.

import { DRUGS, DRUG_BY_KEY, sampleDoseCurve, type DrugEffect } from "./inward/drugData";
import { CX, H, VERTEX_BY_NAME, VERTICES, W, clampPartPosition, lerp, sigmoid, svgEl } from "./inward/geometry";
import { PARTS_PALETTE, pickUnusedPalette, type Part, type PartForce } from "./inward/part";
import { BLEND_FORCE_SCALE, buildAttnPerimeterPath, buildCircles, computeTargetShrinkWrap } from "./inward/attnPerimeter";
import { blendIntensityWord, focusPhrase, READOUT_MAX_LISTED_PARTS, selfQualitiesFor, SLEEP_SELF_ENERGY_MAX, wrapCommaList } from "./inward/readoutText";
import { DrugWheel } from "./inward/drugWheel";
import { SelfEnergyKnob } from "./inward/selfEnergyKnob";
import { DoseController } from "./inward/doseController";
import { ContraindicatedModal } from "./inward/contraindicatedModal";
import { ManualPartPanel } from "./inward/manualPartPanel";
import { ForceOverlay, FORCE_COLORS } from "./inward/forceOverlay";
import { computeConflict } from "./inward/part";
import { DebugOverlay } from "./inward/debugOverlay";

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
    private debugOverlay: DebugOverlay | null = null;
    private partsLayer!: SVGGElement;
    private doseLayer!: SVGGElement;
    private contraindicatedModal!: ContraindicatedModal;

    // Force-breakdown popup (hover, or click-to-lock), conflict ring, and conflict-emoji
    // bursts, per part.
    private forceOverlay!: ForceOverlay;

    // Manual part-add panel
    private simulatePartsEnabled = true;
    private manualPartPanel!: ManualPartPanel;

    constructor(container: HTMLElement) {
        this.root = container;
        this.root.classList.add("ipe-root");

        this.debugEnabled = new URLSearchParams(window.location.search).get("debug") === "1";

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
        this.forceOverlay = new ForceOverlay(this.svg);

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
                onContraindicated: (drug, other, note) => this.contraindicatedModal.show(drug, other, note),
            },
        );

        this.contraindicatedModal = new ContraindicatedModal(this.root);

        if (this.debugEnabled) {
            this.debugOverlay = new DebugOverlay(this.svg, this.root);
        }

        this.manualPartPanel = new ManualPartPanel(this.root, this.simulatePartsEnabled, {
            takenEmojis: () => new Set(this.parts.filter((p) => !p.fadingOut).map((p) => p.emoji)),
            addablePartCount: () => this.parts.filter((p) => p !== this.cannabisPart && !p.fadingOut).length,
            addPart: (emoji, blendUrgency) => this.addManualPart(emoji, blendUrgency),
            sweepOldestPart: () => this.sweepOldestPart(),
            onSimulateToggle: (enabled) => {
                this.simulatePartsEnabled = enabled;
            },
        });

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

    // Midpoint (mg) of the sigmoid gating THH's cannabis-quieting effect - below this,
    // mostly absent; above it, mostly full strength.
    private static readonly THH_DOSE_GATE_MIDPOINT_MG = 5;

    // 0..1 dose-fraction to mg (via a drug's doseUnitLogRange), then through a sigmoid
    // centered at THH_DOSE_GATE_MIDPOINT_MG - used for cannabisBlendUrgencyDivisor, so a
    // trace THH dose doesn't fully quiet cannabis.
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
            if (drug.blendUrgencyDivisorRange !== undefined) {
                const { min, max, curve, k } = drug.blendUrgencyDivisorRange;
                const frac = this.doseController.doses[drug.key];
                // exp: stays quiet until late in the dose range, then rises sharply.
                const shaped = curve === "exp" && k !== undefined ? (Math.pow(k, frac) - 1) / (k - 1) : frac;
                divisor *= lerp(min, max, shaped);
            } else if (drug.blendUrgencyDivisor !== undefined) {
                divisor *= drug.blendUrgencyDivisor;
            }
            if (part === this.cannabisPart && drug.cannabisBlendUrgencyDivisor !== undefined) {
                divisor *= lerp(1, drug.cannabisBlendUrgencyDivisor, this.doseGate(drug));
            }
        }
        return part.blendUrgency / divisor;
    }

    // Max shrinkWrap contribution from THH at full dose - THH tightens the perimeter a bit
    // on its own on top of N,N-DMT's blendPressure-driven tightening, scaled log-linearly
    // with THH's mg dose (its doseUnitLogRange fraction) rather than gated by the sigmoid
    // used for cannabisBlendUrgencyDivisor.
    private static readonly THH_SHRINK_WRAP_MAX = 0.2;

    private thhShrinkWrapEffect(): number {
        const thh = DRUG_BY_KEY.thh;
        if (!this.doseController.isActive(thh.key)) return 0;
        return InwardPerspectiveExplorer.THH_SHRINK_WRAP_MAX * this.doseController.doses[thh.key];
    }

    // Sum of every active drug's linear shrinkWrapBoostMax (cannabis: ramps with dose
    // fraction directly, unlike THH's sigmoid-gated thhShrinkWrapEffect above).
    private linearShrinkWrapEffect(): number {
        let effect = 0;
        for (const drug of DRUGS) {
            if (drug.shrinkWrapBoostMax === undefined || !this.doseController.isActive(drug.key)) continue;
            effect += drug.shrinkWrapBoostMax * this.doseController.doses[drug.key];
        }
        return effect;
    }

    // Builds a Part's SVG element, drag wiring, and force-popup wiring at a given spawn
    // position - shared by every part-creation path (spontaneous, manual, cannabis) so
    // that wiring can't drift out of sync between them.
    private spawnPartAt(emoji: string, feeling: string, blendUrgency: number, x: number, y: number, isDrugRendered = false): Part {
        const el = svgEl("text");
        el.classList.add("ipe-part");
        el.setAttribute("x", String(x));
        el.setAttribute("y", String(y));
        el.style.opacity = "0";
        el.textContent = emoji;
        const part: Part = { emoji, feeling, x, y, vx: 0, vy: 0, opacity: 0, fadingOut: false, el, blendUrgency, forces: [], extraLinkTo: this.rollExtraLink(), hyperFocused: false, isDrugRendered };
        el.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            this.startDrag(part, e);
        });
        this.partsLayer.appendChild(el);
        this.forceOverlay.wirePart(part);
        return part;
    }

    // Spawns a part on a random orbit around the Self vertex - the common case for every
    // part except cannabis, which spawns fixed at the blended vertex instead.
    private createPart(emoji: string, feeling: string, blendUrgency: number): Part {
        const angle = Math.random() * Math.PI * 2;
        const r = 30 + Math.random() * 20;
        const { x, y } = clampPartPosition(VERTEX_BY_NAME.self.x + Math.cos(angle) * r, VERTEX_BY_NAME.self.y + Math.sin(angle) * r);
        return this.spawnPartAt(emoji, feeling, blendUrgency, x, y);
    }

    private addRandomPart(): void {
        const taken = new Set(this.parts.filter((p) => !p.fadingOut).map((p) => p.emoji));
        const { emoji, feeling } = pickUnusedPalette(PARTS_PALETTE, taken);
        const part = this.createPart(emoji, feeling, Math.random());
        this.parts.push(part);
        this.spontaneousParts.push(part);
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
    // cannabis part since its lifecycle is dose-driven, not manually removable. Returns
    // false if nothing was removable.
    private sweepOldestPart(): boolean {
        const oldest = this.parts.find((p) => p !== this.cannabisPart && !p.fadingOut);
        if (!oldest) return false;
        oldest.fadingOut = true;
        const spontaneousIdx = this.spontaneousParts.indexOf(oldest);
        if (spontaneousIdx !== -1) this.spontaneousParts.splice(spontaneousIdx, 1);
        return true;
    }

    // Adds a part the user placed by hand via the manual-add panel, bypassing spontaneous
    // spawn/reap bookkeeping (spontaneousParts) since it isn't subject to auto-reaping.
    private addManualPart(emoji: string, blendUrgency: number): void {
        const feeling = PARTS_PALETTE.find((p) => p.emoji === emoji)?.feeling ?? "";
        const part = this.createPart(emoji, feeling, blendUrgency);
        this.parts.push(part);
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
        this.selfEnergyKnob.setCap(this.computeSelfEnergyCap());
    }

    // THH caps accumulated Self energy - full dose caps at THH_SELF_ENERGY_CAP_MIN, linear
    // in slider position (fraction), down to uncapped at zero dose. Distinct from THH's
    // selfEnergyBoostMax: the boost raises the ambient baseline, this ceilings the total.
    private static readonly THH_SELF_ENERGY_CAP_MIN = 0.51;

    private computeSelfEnergyCap(): number {
        const thh = DRUG_BY_KEY.thh;
        if (!this.doseController.isActive(thh.key)) return 1;
        const fraction = this.doseController.doses[thh.key];
        return lerp(1, InwardPerspectiveExplorer.THH_SELF_ENERGY_CAP_MIN, fraction);
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
            // Tracks THC dose fraction rather than being randomly sampled.
            const part = this.spawnPartAt("🌿", "mellow", this.doseController.doses.cannabis, target.x, target.y - 40, true);
            this.cannabisPart = part;
            this.parts.push(part);
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
            const conflicted = !p.hyperFocused && !p.isDrugRendered && computeConflict(p.forces) > 0.75;
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
                { name: "Self differentiation", color: FORCE_COLORS.selfProximity, x: 0, y: 0 },
                { name: "Self-energy unblend", color: FORCE_COLORS.selfUnblend, x: 0, y: 0 },
                { name: "Blend urgency", color: FORCE_COLORS.blendUrgency, x: 0, y: 0 },
                { name: "Part repulsion", color: FORCE_COLORS.partRepulsion, x: 0, y: 0 },
            ];
            const [fSelfProximity, fSelfUnblend, fBlendUrgency, fPartRepulsion] = forces;

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

            this.forceOverlay.update(p);
        }

        if (this.parts.some((p) => p.fadingOut && p.opacity < 0.02)) {
            for (const p of this.parts) {
                if (p.fadingOut && p.opacity < 0.02) {
                    p.el.remove();
                    this.forceOverlay.removePart(p);
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

        this.targetShrinkWrap = this.debugOverlay?.targetShrinkWrapOverride ?? computeTargetShrinkWrap(this.selfEnergy, this.blendPressure(), this.thhShrinkWrapEffect() + this.linearShrinkWrapEffect());
        this.shrinkWrap = lerp(this.shrinkWrap, this.targetShrinkWrap, 1 - Math.exp(-1.5 * dt));

        this.currentCircleCount = circles.length;
        this.wobblePhase = this.wobblePhase.map((ph, i) => ph + dt * (0.6 + i * 0.23));

        this.attnPerimeterPath.setAttribute(
            "d",
            buildAttnPerimeterPath(circles, this.parts, this.shrinkWrap, this.wobblePhase, this.focusedParts),
        );
        this.updateReadout();

        if (this.debugOverlay) {
            this.debugOverlay.update(circles, {
                selfEnergy: this.selfEnergy,
                selfEnergyBaseline: this.selfEnergyKnob.currentBaseline,
                selfEnergyUserFraction: this.selfEnergyKnob.currentUserFraction,
                parts: this.parts,
                focusedParts: this.focusedParts,
                shrinkWrap: this.shrinkWrap,
                targetShrinkWrap: this.targetShrinkWrap,
                blendPressure: this.blendPressure(),
                unblendPressure: this.unblendPressure(),
                thhShrinkWrapEffect: this.thhShrinkWrapEffect() + this.linearShrinkWrapEffect(),
            });
        }

        requestAnimationFrame((next) => this.tick(next));
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
