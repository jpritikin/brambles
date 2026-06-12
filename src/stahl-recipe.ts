// Hidden interactive easter egg for the Stahl Shrine recipe. Clicking a step
// in the recipe text reveals an ASCII scene above the Materials section and
// pans/animates from the previous step's resting frame to this step's, with
// objects (seeds, glass, stir rod, fan, etc.) gliding continuously between
// the two via the compositor.

import { Compositor } from "./ascii-compositor";
import { GRID_HEIGHT, GRID_WIDTH, PANE_WIDTH, SceneAnimator, STEPS } from "./stahl-scene";

function buildScene(container: HTMLElement): SceneAnimator {
  const viewport = document.createElement("div");
  viewport.className = "recipe-ss-viewport";

  const grid = document.createElement("div");
  grid.className = "recipe-ss-grid";
  viewport.appendChild(grid);
  container.appendChild(viewport);

  const compositor = new Compositor(GRID_WIDTH, GRID_HEIGHT);
  compositor.mount(grid);

  // On localhost, draw pane-boundary dividers (including off-screen ones)
  // so the panning math can be visually checked against the rendered scene,
  // and add a slider to manually pan the viewport to inspect props that are
  // out of frame.
  if (location.hostname === "localhost") {
    viewport.classList.add("recipe-ss-debug");
    const paneCount = STEPS.length + 1;
    compositor.debugLinesX = Array.from({ length: paneCount + 1 }, (_, i) => i * PANE_WIDTH);
    compositor.debugLabels = true;

    const animator = new SceneAnimator(compositor);
    container.appendChild(buildDebugControls(animator, paneCount));
    return animator;
  }

  return new SceneAnimator(compositor);
}

// Builds a slider for manually setting the viewport's world-x offset, plus a
// button to reset it back to the active step's resting offset.
function buildDebugControls(animator: SceneAnimator, paneCount: number): HTMLElement {
  const controls = document.createElement("div");
  controls.className = "recipe-ss-debug-controls";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = String(paneCount * PANE_WIDTH - GRID_WIDTH);
  slider.step = "1";
  slider.value = "0";
  slider.className = "recipe-ss-debug-slider";
  slider.addEventListener("input", () => {
    animator.setDebugViewOffset(Number(slider.value));
  });

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.textContent = "Reset viewport";
  resetButton.addEventListener("click", () => {
    animator.resetViewOffset();
    slider.value = String(animator.getRestingViewOffset());
  });

  controls.appendChild(slider);
  controls.appendChild(resetButton);
  return controls;
}

function init(): void {
  const container = document.getElementById("stahl-slideshow");
  const steps = document.querySelectorAll<HTMLElement>(".recipe-step");
  if (!container || steps.length !== STEPS.length) return;

  const animator = buildScene(container);

  function selectStep(index: number): void {
    steps.forEach((el, i) => el.classList.toggle("recipe-step-active", i === index));
    container!.hidden = false;
    animator.playStep(STEPS[index], index + 1);
  }

  steps.forEach((el, i) => {
    el.addEventListener("click", () => selectStep(i));
  });
}

init();
