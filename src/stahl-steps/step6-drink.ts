// Step 6 — Drink. stirRod2 lifts out of glass2, then glass2 (carrying its
// powder/liquid contents) rises off-screen; once it's fully out of view, it's
// emptied (drunk) and, after a pause, descends back into view in step 6's
// pane.

import { INITIAL_LAYOUT, PANE_WIDTH, PROP_PARK_Y } from "../stahl-props";
import { type Step, type StepEffect } from "../stahl-timeline";
import { type SceneAnimator } from "../stahl-animator";
import { launchFireworks } from "../stahl-fireworks";

// World x glass2 rests at once it descends back into view, centered in step
// 6's own pane (one pane right of its step 5 resting spot).
const STEP6_GLASS_X = 7.5 + 6 * PANE_WIDTH;

// How long stirRod2 takes to lift out of glass2, and how long the scene then
// pauses before glass2 rises.
export const STEP6_STIR_LIFT_DURATION = 400;
export const STEP6_PRE_LIFT_PAUSE = 1000;

// How long glass2 takes to rise off-screen, how long it then pauses
// off-screen (emptied during this pause), and how long it takes to descend
// back into view.
export const STEP6_GLASS_LIFT_DURATION = 600;
export const STEP6_GLASS_EMPTY_PAUSE = 1000;
export const STEP6_GLASS_RETURN_DURATION = 600;

const STEP6_PRE_LIFT_END = STEP6_STIR_LIFT_DURATION + STEP6_PRE_LIFT_PAUSE;
const STEP6_LIFT_END = STEP6_PRE_LIFT_END + STEP6_GLASS_LIFT_DURATION;
const STEP6_EMPTY_END = STEP6_LIFT_END + STEP6_GLASS_EMPTY_PAUSE;
const STEP6_TRANSITION_DURATION = STEP6_EMPTY_END + STEP6_GLASS_RETURN_DURATION;

// Delay after the empty cup settles back into view before the fireworks
// finale fires.
const STEP6_FIREWORKS_DELAY = 1000;

// Empties glass2 (its scraped residue and tap water from step 5) once it's
// risen off-screen, so it descends back into view empty.
class GlassEmptyEffect implements StepEffect {
    private emptied = false;

    tick(t: number, anim: SceneAnimator): void {
        if (this.emptied || t < STEP6_LIFT_END) return;
        anim.emptyGlass2();
        this.emptied = true;
    }
}

export const STEP6: Step = {
    transitionDuration: STEP6_TRANSITION_DURATION,
    transitionKeyframes: [
        { t: STEP6_STIR_LIFT_DURATION, objects: { stirRod2: { y: PROP_PARK_Y } } },
        // Holds in place through the pause after stirRod2 lifts out, before
        // glass2 rises off-screen.
        { t: STEP6_PRE_LIFT_END, objects: { glass2: { x: INITIAL_LAYOUT.glass2.x, y: INITIAL_LAYOUT.glass2.y } } },
        { t: STEP6_LIFT_END, objects: { glass2: { x: INITIAL_LAYOUT.glass2.x, y: PROP_PARK_Y } } },
        // Holds off-screen through the empty pause, then shifts to step 6's
        // pane (still off-screen) before descending back into view there.
        { t: STEP6_EMPTY_END, objects: { glass2: { x: STEP6_GLASS_X, y: PROP_PARK_Y } } },
        { t: STEP6_TRANSITION_DURATION, objects: { glass2: { x: STEP6_GLASS_X, y: INITIAL_LAYOUT.glass2.y } } },
    ],
    effects: () => [new GlassEmptyEffect()],
    onSettle: () => {
        window.setTimeout(launchFireworks, STEP6_FIREWORKS_DELAY);
    },
};
