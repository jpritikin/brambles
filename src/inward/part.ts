// One named contribution to a part's per-frame velocity, in force-space units
// (before the 0.95 damping and dt integration applied in the tick loop).
export interface PartForce {
    name: string;
    color: string;
    x: number;
    y: number;
    // Pre-BLEND_FORCE_SCALE magnitude on the shared 0-1 blending-force scale, for forces that
    // have one; omitted for forces (Self differentiation, part repulsion) with no such scale.
    displayMag?: number;
}

export interface Part {
    emoji: string;
    feeling: string;
    // Force-driven center: every psychological force (Self-energy push, blend urgency,
    // part repulsion, etc.) acts on this point, not on the rendered emoji directly.
    x: number;
    y: number;
    vx: number;
    vy: number;
    opacity: number;
    fadingOut: boolean;
    el: SVGTextElement;
    // Sampled once at creation from uniform [0, 1): this part's own baseline urgency to
    // blend, independent of ambient Self energy. Drug effects (e.g. 5-MAPB's
    // blendUrgencyDivisor) quiet this at read time rather than mutating it - see
    // InwardPerspectiveExplorer.effectiveBlendUrgency. Drives a steady pull toward the
    // blended corner and the intensity word ("slightly"/"very"/etc.) shown before its
    // feeling in the readout.
    blendUrgency: number;
    // Last frame's named forces, for the hover/click force-breakdown popup. Excludes the
    // random-wander jitter, which isn't a meaningful psychological force.
    forces: PartForce[];
    // Rolled once at creation (see attnPerimeter.ts's connector logic): an extra
    // attention-perimeter link to another part already present when this one spawned, on
    // top of this part's own always-present link to Self. Null if the roll failed or no
    // other parts existed yet. Fixed for this part's lifetime, not re-rolled per frame.
    extraLinkTo: Part | null;
    // True while this part is the sole target of a "Private reverie" attention perimeter
    // (Self excluded) - see InwardPerspectiveExplorer's focus-lock hysteresis. Exempt from
    // spontaneous reaping while true, since it's currently the entire focus of attention.
    hyperFocused: boolean;
}

export const PARTS_PALETTE: { emoji: string; feeling: string }[] = [
    { emoji: "😠", feeling: "angry" },
    { emoji: "😢", feeling: "sad" },
    { emoji: "😨", feeling: "afraid" },
    { emoji: "😳", feeling: "ashamed" },
    { emoji: "💭", feeling: "pensive" },
    { emoji: "🧐", feeling: "critical" },
    { emoji: "🥺", feeling: "pleading" },
    { emoji: "🥱", feeling: "bored" },
    { emoji: "🙄", feeling: "dismissive" },
];
