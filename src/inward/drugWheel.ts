import { DRUGS, DRUG_BY_KEY } from "./drugData";
import { svgEl } from "./geometry";
import { wrapWheelLabel } from "./readoutText";

// Pie-menu drug picker (see urbb-web's src/menu/pieMenu.ts for the pattern this
// borrows from): a small button left of Self that expands into a ring of drug
// slices around itself when clicked, collapsing again on a selection or on
// clicking the center.
export class DrugWheel {
    readonly group: SVGGElement;
    private ring!: SVGGElement;
    private btn!: SVGGElement;
    private btnLabel!: SVGTextElement;
    private open = false;
    private outerR = 0;
    private selectedKey: string;

    constructor(
        private readonly cx: number,
        private readonly cy: number,
        initialSelectedKey: string,
        private readonly onSelect: (key: string) => void,
        private readonly onOpenChange: (open: boolean) => void,
    ) {
        this.selectedKey = initialSelectedKey;
        this.group = svgEl("g");
        this.build();
        document.addEventListener("keydown", this.onKeyDown);
    }

    private onKeyDown = (e: KeyboardEvent): void => {
        if (e.key === "Escape" && this.open) this.close();
    };

    private build(): void {
        const cx = this.cx;
        const cy = this.cy;
        const BTN_R = 22;

        this.ring = svgEl("g");
        this.ring.classList.add("ipe-drug-wheel");

        const backdrop = svgEl("circle");
        backdrop.classList.add("ipe-drug-wheel-backdrop");
        backdrop.setAttribute("cx", String(cx));
        backdrop.setAttribute("cy", String(cy));
        backdrop.setAttribute("r", "0");
        this.ring.appendChild(backdrop);

        const itemCount = DRUGS.length;
        const angleStep = (2 * Math.PI) / itemCount;
        const thhIndex = DRUGS.findIndex((d) => d.key === "thh");
        const startAngle = -Math.PI / 2 - thhIndex * angleStep;
        const outerR = BTN_R + 100;
        const innerR = BTN_R + 6;
        this.outerR = outerR;
        // Half the gap's radial width in px, held constant across the wedge's radius —
        // the angular trim that produces this gap therefore shrinks as r grows
        // (arc length = angle * r), so the gap looks the same width at the rim as near
        // the center instead of flaring outward.
        const GAP_HALF_PX = 4;

        DRUGS.forEach((drug, i) => {
            const angle = startAngle + i * angleStep;
            const slice = svgEl("g");
            slice.classList.add("ipe-drug-wheel-slice");
            slice.dataset.key = drug.key;

            const bg = svgEl("path");
            bg.classList.add("ipe-drug-wheel-slice-bg");
            const halfStep = angleStep / 2;
            const innerHalfStep = Math.max(0, halfStep - GAP_HALF_PX / innerR);
            const outerHalfStep = Math.max(0, halfStep - GAP_HALF_PX / outerR);
            const p = (r: number, a: number) => ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
            const i0 = p(innerR, angle - innerHalfStep);
            const i1 = p(innerR, angle + innerHalfStep);
            const o0 = p(outerR, angle - outerHalfStep);
            const o1 = p(outerR, angle + outerHalfStep);
            const largeArc = outerHalfStep * 2 > Math.PI ? 1 : 0;
            bg.setAttribute(
                "d",
                `M ${i0.x} ${i0.y} L ${o0.x} ${o0.y} A ${outerR} ${outerR} 0 ${largeArc} 1 ${o1.x} ${o1.y} L ${i1.x} ${i1.y} A ${innerR} ${innerR} 0 ${largeArc} 0 ${i0.x} ${i0.y} Z`,
            );
            slice.appendChild(bg);

            const textR = innerR + (outerR - innerR) * 0.72;
            const tp = p(textR, angle);
            const label = svgEl("text");
            label.classList.add("ipe-drug-wheel-slice-label");
            label.setAttribute("x", String(tp.x));
            label.setAttribute("y", String(tp.y));
            const lines = wrapWheelLabel(drug.name);
            lines.forEach((line, wi) => {
                const tspan = svgEl("tspan");
                tspan.setAttribute("x", String(tp.x));
                tspan.setAttribute("dy", wi === 0 ? `${-(lines.length - 1) * 5.5}` : "11");
                tspan.textContent = line;
                label.appendChild(tspan);
            });
            slice.appendChild(label);

            // pointerdown must also be stopped here, not just click: the global
            // svg pointerdown listener closes the wheel on outside clicks, and
            // pointerdown fires before click — without this, clicking a slice
            // closes the wheel first and the click that follows lands on nothing,
            // silently swallowing the selection.
            slice.addEventListener("pointerdown", (e) => e.stopPropagation());
            slice.addEventListener("click", (e) => {
                e.stopPropagation();
                this.selectedKey = drug.key;
                this.onSelect(drug.key);
                this.close();
            });
            this.ring.appendChild(slice);
        });

        const center = svgEl("circle");
        center.classList.add("ipe-drug-wheel-center");
        center.setAttribute("cx", String(cx));
        center.setAttribute("cy", String(cy));
        center.setAttribute("r", String(BTN_R));
        center.addEventListener("pointerdown", (e) => e.stopPropagation());
        center.addEventListener("click", (e) => {
            e.stopPropagation();
            this.close();
        });
        this.ring.appendChild(center);

        const closeX = svgEl("text");
        closeX.classList.add("ipe-drug-wheel-close");
        closeX.setAttribute("x", String(cx));
        closeX.setAttribute("y", String(cy));
        closeX.textContent = "✕";
        this.ring.appendChild(closeX);

        this.group.appendChild(this.ring);

        // The always-visible trigger button, drawn on top so it stays clickable
        // whether or not the ring is open.
        this.btn = svgEl("g");
        this.btn.classList.add("ipe-drug-wheel-btn");
        // A rect rather than the ring's inner circle, so there's more width for the
        // selected drug's name - no need to match the popped-open ring's inner circle.
        const BTN_W = BTN_R * 3.2;
        const BTN_H = BTN_R * 2;
        const btnRect = svgEl("rect");
        btnRect.classList.add("ipe-drug-wheel-btn-ring");
        btnRect.setAttribute("x", String(cx - BTN_W / 2));
        btnRect.setAttribute("y", String(cy - BTN_H / 2));
        btnRect.setAttribute("width", String(BTN_W));
        btnRect.setAttribute("height", String(BTN_H));
        btnRect.setAttribute("rx", "10");
        this.btn.appendChild(btnRect);

        this.btnLabel = svgEl("text");
        this.btnLabel.classList.add("ipe-drug-wheel-btn-label");
        this.btnLabel.setAttribute("x", String(cx));
        this.btnLabel.setAttribute("y", String(cy));
        this.setBtnLabelText(DRUG_BY_KEY[this.selectedKey].name, cx);
        this.btn.appendChild(this.btnLabel);

        this.btn.addEventListener("pointerdown", (e) => e.stopPropagation());
        this.btn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (this.open) this.close();
            else this.openWheel();
        });

        this.group.appendChild(this.btn);
    }

    // Wraps the selected drug's name into up to two stacked tspans so it fits inside
    // the small always-visible button circle, same wrapping approach as the slices.
    private setBtnLabelText(name: string, x: number): void {
        this.btnLabel.textContent = "";
        const lines = wrapWheelLabel(name);
        lines.forEach((line, wi) => {
            const tspan = svgEl("tspan");
            tspan.setAttribute("x", String(x));
            tspan.setAttribute("dy", wi === 0 ? `${-(lines.length - 1) * 5.5}` : "11");
            tspan.textContent = line;
            this.btnLabel.appendChild(tspan);
        });
    }

    setSelected(key: string): void {
        this.selectedKey = key;
        this.setBtnLabelText(DRUG_BY_KEY[key].name, this.cx);
    }

    isOpen(): boolean {
        return this.open;
    }

    openWheel(): void {
        this.open = true;
        this.ring.classList.add("ipe-open");
        // Hide the always-visible trigger button while open: it sits on top of the
        // ring's own center circle + close X, and its selected-drug label would
        // otherwise overlap and be unreadable against the X.
        this.btn.style.visibility = "hidden";
        for (const slice of Array.from(this.ring.querySelectorAll<SVGGElement>(".ipe-drug-wheel-slice"))) {
            slice.classList.toggle("ipe-selected", slice.dataset.key === this.selectedKey);
        }
        const backdrop = this.ring.querySelector<SVGCircleElement>(".ipe-drug-wheel-backdrop")!;
        backdrop.setAttribute("r", String(this.outerR));
        this.onOpenChange(true);
    }

    close(): void {
        this.open = false;
        this.ring.classList.remove("ipe-open");
        this.btn.style.visibility = "visible";
        const backdrop = this.ring.querySelector<SVGCircleElement>(".ipe-drug-wheel-backdrop")!;
        backdrop.setAttribute("r", "0");
        this.onOpenChange(false);
    }
}
