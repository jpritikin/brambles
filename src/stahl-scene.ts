// Assembles the Stahl Shrine recipe's step timeline from src/stahl-steps/*
// and re-exports the names src/stahl-recipe.ts and scripts/*.ts depend on.
//
// Steps live in an unbounded world space, one PANE_WIDTH-wide "pane" per
// step (step N occupies world x in [N*PANE_WIDTH, (N+1)*PANE_WIDTH)). All
// coordinates (initial layouts and keyframes, defined in stahl-props.ts and
// src/stahl-steps/*) are authored directly in this world space. Selecting
// step `index` rests the viewport at viewOffsetX = (index-1)*PANE_WIDTH,
// panning from the previous step's resting offset, so both the previous and
// new resting frames stay visible and an object can lift, slide across the
// seam, rotate, and land in its new spot in one continuous move.

import { GRID_HEIGHT, GRID_WIDTH, GRINDER_BLADE, GRINDER_BLADE_RADIUS, GRINDER_BODY, PANE_WIDTH } from "./stahl-props";
import { type Step } from "./stahl-timeline";
import { STEP1 } from "./stahl-steps/step1-grind";
import { STEP2 } from "./stahl-steps/step2-mix";
import { STEP3 } from "./stahl-steps/step3-fridge";
import { STEP4 } from "./stahl-steps/step4-evaporate";
import { STEP5 } from "./stahl-steps/step5-residue";
import { STEP6 } from "./stahl-steps/step6-drink";

export { GRID_HEIGHT, GRID_WIDTH, GRINDER_BLADE, GRINDER_BLADE_RADIUS, GRINDER_BODY, PANE_WIDTH };
export { SceneAnimator } from "./stahl-animator";

export const STEPS: Step[] = [STEP1, STEP2, STEP3, STEP4, STEP5, STEP6];
