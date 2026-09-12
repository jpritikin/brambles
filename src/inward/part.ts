export interface Part {
    emoji: string;
    feeling: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    opacity: number;
    fadingOut: boolean;
    el: SVGTextElement;
    // Sampled once at creation from uniform [0, 1): this part's own propensity to blend,
    // independent of ambient Self energy. Drives a steady pull toward the blended corner
    // and the intensity word ("slightly"/"very"/etc.) shown before its feeling in the readout.
    blendPropensity: number;
}

export const PARTS_PALETTE: { emoji: string; feeling: string }[] = [
    { emoji: "😠", feeling: "angry" },
    { emoji: "😢", feeling: "sad" },
    { emoji: "😨", feeling: "afraid" },
    { emoji: "😳", feeling: "ashamed" },
    { emoji: "💭", feeling: "pensive" },
    { emoji: "🧐", feeling: "critical" },
];
