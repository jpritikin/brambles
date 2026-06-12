// Step 5 — Final draught. The dried residue is scraped into a fresh shot
// glass with water; the stir rod returns for a final stir, then the glass
// empties (drunk).

import { PANE_WIDTH, STIR_ROD_PULSE_PERIOD, STIR_ROD_RADIUS, STIR_ROD_REST_Y } from "../stahl-props";
import { type Step } from "../stahl-timeline";

export const STEP5: Step = {
    transitionDuration: 2400,
    transitionKeyframes: [
        {
            t: 500,
            objects: {
                glass2: { x: 7.5 + 5 * PANE_WIDTH, y: 6, z: 1, rotation: 0 },
                stirRod: { x: 7.5 + 5 * PANE_WIDTH, y: STIR_ROD_REST_Y, z: 3, rotation: 0 },
            },
        },
    ],
    loops: () => [{ kind: "pulse", id: "stirRod", maxRadius: STIR_ROD_RADIUS, period: STIR_ROD_PULSE_PERIOD }],
};
