// Step 1 — Grind the seeds. The seed pile starts in the previous pane and
// arcs across the seam into the grinder body; once it arrives, the blade
// spins up and grinds for several seconds while the body shakes and the
// seeds gradually crumble to dust (see SceneAnimator.startGrinding, which
// owns the seed pile / grinder state shared across steps).

import { PANE_WIDTH, SEED_FLIGHT_DURATION } from "../stahl-props";
import { type Step } from "../stahl-timeline";

export const STEP1: Step = {
    transitionDuration: SEED_FLIGHT_DURATION,
    transitionKeyframes: [
        { t: SEED_FLIGHT_DURATION, objects: { seedPile: { x: 7.5 + PANE_WIDTH, y: 6, z: 1 } } },
    ],
};
