// Hidden interactive easter egg for the Stahl Shrine recipe. Clicking a step
// in the recipe text reveals an ASCII scene above the Materials section and
// pans/animates from the previous step's resting frame to this step's, with
// objects (seeds, glass, stir rod, fan, etc.) gliding continuously between
// the two via the compositor.

import { Compositor } from "./ascii-compositor";
import { initFluidDebug3D } from "./fluid-debug-3d";
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

  const animator = new SceneAnimator(compositor);

  // Secret: clicking the countdown timer skips it ahead by a random 1-3
  // minutes. No visual hint, deliberately undiscoverable.
  grid.addEventListener("click", (event) => {
    const range = animator.getCountdownCellRange();
    if (range) {
      const target = event.target as Node;
      const hit = range.cols.some((col) => compositor.getCellElement(range.row, col) === target);
      if (hit) { animator.skipCountdown(); return; }
    }
    const text = compositor.dumpAscii();
    if (text) navigator.clipboard.writeText(text);
  });

  return animator;
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
  (window as any).__animator = animator; // DEBUG
  const debug = new URLSearchParams(window.location.search).has("debug");

  if (debug) initFluidDebug3D(animator);

  let tickEls: HTMLElement[] = [];
  const completedSteps = new Set<number>();
  let activeSubstepEl: HTMLElement | null = null;
  let lastSelectedIndex = -1;

  function clearSubstepHighlight(): void {
    if (activeSubstepEl) {
      activeSubstepEl.classList.remove("recipe-substep-active");
      activeSubstepEl = null;
    }
  }

  function selectStep(index: number): void {
    clearSubstepHighlight();
    if (index <= lastSelectedIndex) {
      for (let i = index; i < steps.length; i++) completedSteps.delete(i);
    } else {
      for (let i = 0; i < index; i++) completedSteps.add(i);
    }
    lastSelectedIndex = index;
    steps.forEach((el, i) => {
      el.classList.remove("recipe-step-active", "recipe-step-next");
      el.classList.toggle("recipe-step-done", completedSteps.has(i) && i !== index);
    });
    steps[index].classList.add("recipe-step-active");
    steps[index].classList.remove("recipe-step-done");
    tickEls.forEach((el, i) => el.classList.toggle("recipe-ss-tick-active", i === index));
    if (container!.hidden) document.dispatchEvent(new CustomEvent(SLIDESHOW_REVEALED_EVENT));
    container!.hidden = false;
    animator.playStep(STEPS[index], index + 1);
  }

  animator.onSubstepChange = (stepIndex, substepId) => {
    clearSubstepHighlight();
    if (substepId) {
      const stepEl = steps[stepIndex - 1];
      const el = stepEl?.querySelector<HTMLElement>(`.recipe-substep[data-substep="${substepId}"]`);
      if (el) {
        el.classList.add("recipe-substep-active");
        activeSubstepEl = el;
      }
    }
  };

  animator.onStepComplete = (stepIndex) => {
    completedSteps.add(stepIndex - 1);
    clearSubstepHighlight();
    steps[stepIndex - 1].classList.remove("recipe-step-active");
    steps[stepIndex - 1].classList.add("recipe-step-done");
    if (stepIndex < steps.length) {
      steps[stepIndex].classList.add("recipe-step-next");
    }
  };

  if (debug) {
    const { element: controls, tickEls: tEls } = buildViewportControls(animator);
    container.appendChild(controls);
    tickEls = tEls;

    const speedPanel = document.createElement("div");
    speedPanel.className = "recipe-ss-speed";
    const SPEEDS = [0, 0.25, 0.5, 1];
    for (const speed of SPEEDS) {
      const btn = document.createElement("button");
      btn.textContent = speed === 0 ? "||" : `${speed}x`;
      btn.className = "recipe-ss-speed-btn";
      btn.addEventListener("click", () => { animator.playbackSpeed = speed; });
      speedPanel.appendChild(btn);
    }
    container.insertAdjacentElement("afterend", speedPanel);
  }

  steps.forEach((el, i) => {
    el.addEventListener("click", () => selectStep(i));
  });
}

init();
