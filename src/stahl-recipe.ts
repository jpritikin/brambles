// Hidden interactive easter egg for the Stahl Shrine recipe. Clicking a step
// in the recipe text reveals an ASCII scene above the Materials section and
// pans/animates from the previous step's resting frame to this step's, with
// objects (seeds, glass, stir rod, fan, etc.) gliding continuously between
// the two via the compositor.

import { Compositor } from "./ascii-compositor";
import { GRID_HEIGHT, GRID_WIDTH, PANE_WIDTH, SceneAnimator, STEPS } from "./stahl-scene";
import { SLIDESHOW_REVEALED_EVENT } from "./stahl-events";

function buildScene(container: HTMLElement): SceneAnimator {
  const viewport = document.createElement("div");
  viewport.className = "recipe-ss-viewport";

  const grid = document.createElement("div");
  grid.className = "recipe-ss-grid";
  viewport.appendChild(grid);
  container.appendChild(viewport);

  const compositor = new Compositor(GRID_WIDTH, GRID_HEIGHT);
  compositor.mount(grid);

  return new SceneAnimator(compositor);
}

// Builds a slider for manually panning the viewport's world-x offset. Below
// the slider, numbered ticks mark each step's resting offset; clicking a
// tick pans the viewport there (without changing the active step), and the
// active step's tick is highlighted.
function buildViewportControls(animator: SceneAnimator): { element: HTMLElement; tickEls: HTMLElement[] } {
  const controls = document.createElement("div");
  controls.className = "recipe-ss-controls";

  const paneCount = STEPS.length + 1;
  const max = paneCount * PANE_WIDTH - GRID_WIDTH;

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = String(max);
  slider.step = "1";
  slider.value = "0";
  slider.className = "recipe-ss-slider";
  slider.addEventListener("input", () => {
    animator.setManualViewOffset(Number(slider.value));
  });
  controls.appendChild(slider);

  // Numbered ticks below the slider, one per step, positioned at the
  // step's resting offset as a percentage of the slider's range.
  const ticks = document.createElement("div");
  ticks.className = "recipe-ss-ticks";
  const tickEls: HTMLElement[] = [];
  for (let i = 0; i < STEPS.length; i++) {
    const restingOffset = i * PANE_WIDTH;
    const tick = document.createElement("button");
    tick.type = "button";
    tick.className = "recipe-ss-tick";
    tick.textContent = String(i + 1);
    tick.style.left = `${(restingOffset / max) * 100}%`;
    tick.addEventListener("click", () => {
      animator.setManualViewOffset(restingOffset);
      slider.value = String(restingOffset);
    });
    ticks.appendChild(tick);
    tickEls.push(tick);
  }
  controls.appendChild(ticks);

  // Keep the slider in sync with the viewport offset as it pans (e.g. when a
  // step is selected), so the slider always reflects what's on screen.
  animator.onViewOffsetChange = (x) => {
    slider.value = String(x);
  };

  return { element: controls, tickEls };
}

function init(): void {
  const container = document.getElementById("stahl-slideshow");
  const steps = document.querySelectorAll<HTMLElement>(".recipe-step");
  if (!container || steps.length !== STEPS.length) return;

  const animator = buildScene(container);

  function selectStep(index: number): void {
    steps.forEach((el, i) => el.classList.toggle("recipe-step-active", i === index));
    tickEls.forEach((el, i) => el.classList.toggle("recipe-ss-tick-active", i === index));
    if (container!.hidden) document.dispatchEvent(new CustomEvent(SLIDESHOW_REVEALED_EVENT));
    container!.hidden = false;
    animator.playStep(STEPS[index], index + 1);
  }

  const { element: controls, tickEls } = buildViewportControls(animator);
  container.appendChild(controls);

  steps.forEach((el, i) => {
    el.addEventListener("click", () => selectStep(i));
  });
}

init();
