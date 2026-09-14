import { VERTEX_BY_NAME, svgEl } from "./geometry";

// Rotary volume-knob control at the Self vertex. See docs/inward-primer.txt.
export class SelfEnergyKnob {
    private static readonly USER_RANGE = 0.5;
    private static readonly KNOB_R = 20;

    private userFraction = 0.6;
    private baseline = 0;

    private ring: SVGCircleElement;
    private wedge: SVGPathElement;
    private valueBg: SVGRectElement;
    private valueLabel: SVGTextElement;

    // Current drag travel (degrees) for the energy side of the wedge, clamped
    // to the knob's 270° range.
    private dragAngle = 0;

    constructor(
        private svg: SVGSVGElement,
        private svgWidth: number,
    ) {
        const v = VERTEX_BY_NAME.self;
        const KNOB_R = SelfEnergyKnob.KNOB_R;

        const group = svgEl("g");
        group.classList.add("ipe-self-knob-group");
        svg.appendChild(group);

        const ringTrack = svgEl("circle");
        ringTrack.classList.add("ipe-self-knob-ring");
        ringTrack.setAttribute("cx", String(v.x));
        ringTrack.setAttribute("cy", String(v.y));
        ringTrack.setAttribute("r", String(KNOB_R));
        group.appendChild(ringTrack);

        this.ring = svgEl("circle");
        this.ring.classList.add("ipe-self-knob-ring-fill");
        this.ring.setAttribute("cx", String(v.x));
        this.ring.setAttribute("cy", String(v.y));
        this.ring.setAttribute("r", String(KNOB_R));
        group.appendChild(this.ring);

        this.wedge = svgEl("path");
        this.wedge.classList.add("ipe-self-knob-wedge");
        group.appendChild(this.wedge);

        this.valueBg = svgEl("rect");
        this.valueBg.classList.add("ipe-self-knob-value-bg");
        this.valueBg.setAttribute("x", String(v.x - 22));
        this.valueBg.setAttribute("y", String(v.y - KNOB_R - 34));
        this.valueBg.setAttribute("width", "44");
        this.valueBg.setAttribute("height", "20");
        this.valueBg.setAttribute("rx", "10");
        group.appendChild(this.valueBg);

        this.valueLabel = svgEl("text");
        this.valueLabel.classList.add("ipe-self-knob-value");
        this.valueLabel.setAttribute("x", String(v.x));
        this.valueLabel.setAttribute("y", String(v.y - KNOB_R - 19));
        group.appendChild(this.valueLabel);

        // Invisible hit area covering the whole knob disc.
        const hitArea = svgEl("circle");
        hitArea.classList.add("ipe-self-knob-hit");
        hitArea.setAttribute("cx", String(v.x));
        hitArea.setAttribute("cy", String(v.y));
        hitArea.setAttribute("r", String(KNOB_R + 6));
        hitArea.addEventListener("pointerdown", (e) => this.startDrag(e));
        group.appendChild(hitArea);

        this.updateRing();
    }

    get energy(): number {
        const range = Math.min(SelfEnergyKnob.USER_RANGE, 1 - this.baseline);
        return Math.min(1, Math.max(0, this.baseline + this.userFraction * range));
    }

    get currentBaseline(): number {
        return this.baseline;
    }

    get currentUserFraction(): number {
        return this.userFraction;
    }

    setBaseline(baseline: number): void {
        this.baseline = baseline;
        this.updateRing();
    }

    private startDrag(e: PointerEvent): void {
        e.stopPropagation();
        e.preventDefault();
        const rect = this.svg.getBoundingClientRect();
        const scale = this.svgWidth / rect.width;
        const selfV = VERTEX_BY_NAME.self;
        const KNOB_R = SelfEnergyKnob.KNOB_R;

        this.wedge.style.display = "block";
        this.valueBg.style.display = "block";
        this.valueLabel.style.display = "block";

        // atan2 in [-180, 180], 0 = up, positive = clockwise. The knob's travel
        // starts at -135° (angleAt = -135 -> dragAngle = 0). dragAngle tracks
        // the energy (displayed) side of the wedge, so it points straight at
        // the mouse; userFraction is then derived by inverting `energy`.
        const angleAt = (ev: PointerEvent): number => {
            const ex = (ev.clientX - rect.left) * scale;
            const ey = (ev.clientY - rect.top) * scale;
            return (Math.atan2(ex - selfV.x, -(ey - selfV.y)) * 180) / Math.PI;
        };

        this.dragAngle = angleAt(e) + 135;

        const render = () => {
            const travel = Math.max(0, Math.min(270, this.dragAngle));
            const targetEnergy = travel / 270;
            const range = Math.min(SelfEnergyKnob.USER_RANGE, 1 - this.baseline);
            this.userFraction = range > 0 ? Math.min(1, Math.max(0, (targetEnergy - this.baseline) / range)) : 0;
            this.updateRing();

            const wedgeR = KNOB_R + 40;
            const angleForEnergy = (energy: number) => ((energy * 270 - 135) * Math.PI) / 180;
            const startRad = angleForEnergy(this.baseline);
            const rad = angleForEnergy(this.energy);
            const sweepDeg = (this.energy - this.baseline) * 270;
            const large = sweepDeg > 180 ? 1 : 0; // SVG large-arc-flag: sweep exceeds 180°
            const sx = selfV.x + Math.sin(startRad) * wedgeR;
            const sy = selfV.y - Math.cos(startRad) * wedgeR;
            const ex2 = selfV.x + Math.sin(rad) * wedgeR;
            const ey2 = selfV.y - Math.cos(rad) * wedgeR;
            this.wedge.setAttribute(
                "d",
                `M ${selfV.x} ${selfV.y} L ${sx.toFixed(1)} ${sy.toFixed(1)} A ${wedgeR} ${wedgeR} 0 ${large} 1 ${ex2.toFixed(1)} ${ey2.toFixed(1)} Z`,
            );
            this.valueLabel.textContent = `${Math.round(this.energy * 100)}%`;
        };

        const move = (ev: PointerEvent) => {
            this.dragAngle = angleAt(ev) + 135;
            render();
        };
        const up = () => {
            this.wedge.style.display = "none";
            this.valueBg.style.display = "none";
            this.valueLabel.style.display = "none";
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        render();
    }

    private updateRing(): void {
        const KNOB_R = SelfEnergyKnob.KNOB_R;
        const circumference = 2 * Math.PI * KNOB_R;
        const arcFraction = 270 / 360;
        const arcLength = circumference * arcFraction;
        const filled = arcLength * this.energy;
        this.ring.setAttribute("stroke-dasharray", `${filled} ${circumference - filled}`);
        // Rotates the dash-start from the circle's default 3-o'clock origin to -135°.
        this.ring.setAttribute("transform", `rotate(135 ${VERTEX_BY_NAME.self.x} ${VERTEX_BY_NAME.self.y})`);
    }
}
