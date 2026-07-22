// Sample Rite timeline on the Stahl Shrine page: a variant toggle ("Don't
// Need Help" / "Uninspired" / "Thai Inspired") controls which recipe panel
// is in play, defaulting to "Don't Need Help" so the Sample Rite stays
// tucked away until asked for. Within a chosen panel, clicking a stop shows
// only that stop's detail. The Eat list highlights whichever ingredients the
// active variant's recipe actually calls for. Panels that call for millet
// gate their recipe behind a millet-vs-sorghum choice (the "grain oracle"),
// remembered for the rest of the session once made
// (content/docs/psychoactive/stahl-shrine/_index.md).

function selectStop(name: string, stops: NodeListOf<HTMLElement>, details: NodeListOf<HTMLElement>): void {
  stops.forEach((el) => el.classList.toggle("rite-stop-active", el.dataset.riteStop === name));
  details.forEach((el) => { el.hidden = el.dataset.riteDetail !== name; });
}

// Shared rite-detail content (e.g. "shared-dinner") lives once in the DOM but
// must render inline within whichever panel's timeline is active, right after
// that timeline's slot placeholder. Move the shared node there instead of
// duplicating its markup per panel.
function relocateSharedDetails(panel: HTMLElement): void {
  panel.querySelectorAll<HTMLElement>(".rite-detail-slot").forEach((slot) => {
    const name = slot.dataset.riteDetailSlot;
    const detail = name && document.querySelector<HTMLElement>(`.rite-detail[data-rite-detail="${name}"]`);
    if (detail && detail.parentElement !== slot) slot.appendChild(detail);
  });
}

// The grain oracle gate is another single shared node (like the rite-detail
// blocks above), relocated into whichever panel needs it via a
// grain-oracle-slot placeholder.
let chosenGrain: string | null = null;

function applyGrainChoice(grain: string, panel: HTMLElement): void {
  chosenGrain = grain;
  const gate = document.querySelector<HTMLElement>(".grain-oracle-gate");
  if (gate) gate.hidden = true;
  const gated = panel.querySelector<HTMLElement>(".grain-gated-content");
  if (gated) gated.hidden = false;
  document.querySelectorAll<HTMLElement>(".grain-slot").forEach((el) => {
    el.textContent = grain;
    el.dataset.ingredient = grain;
  });
  highlightIngredients(panel);
}

function relocateGrainOracleGate(panel: HTMLElement): void {
  const slot = panel.querySelector<HTMLElement>(".grain-oracle-slot");
  const gate = document.querySelector<HTMLElement>(".grain-oracle-gate");
  if (!slot || !gate) return;

  if (gate.parentElement !== slot) slot.appendChild(gate);
  gate.hidden = chosenGrain !== null;

  const gated = panel.querySelector<HTMLElement>(".grain-gated-content");
  if (gated) gated.hidden = chosenGrain === null;
  if (chosenGrain) applyGrainChoice(chosenGrain, panel);
}

function initGrainOracle(): void {
  const gate = document.querySelector<HTMLElement>(".grain-oracle-gate");
  if (!gate) return;

  gate.querySelectorAll<HTMLElement>(".grain-oracle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const grain = btn.dataset.grainChoice;
      const panel = gate.closest<HTMLElement>(".rite-variant");
      if (grain && panel) applyGrainChoice(grain, panel);
    });
  });
}

function initTimeline(): void {
  const stops = document.querySelectorAll<HTMLElement>(".rite-stop");
  const details = document.querySelectorAll<HTMLElement>(".rite-detail");
  if (stops.length === 0) return;

  stops.forEach((el) => {
    el.addEventListener("click", () => {
      const name = el.dataset.riteStop;
      if (name) selectStop(name, stops, details);
    });
  });
}

function highlightIngredients(panel: HTMLElement | null): void {
  const gated = panel?.querySelector<HTMLElement>(".grain-gated-content");
  const revealed = !gated || !gated.hidden;
  const used = new Set(
    panel && revealed ? Array.from(panel.querySelectorAll<HTMLElement>(".rite-ingredient")).map((el) => el.dataset.ingredient) : [],
  );
  document.querySelectorAll<HTMLElement>(".eat-ingredient").forEach((el) => {
    el.classList.toggle("eat-ingredient-active", used.has(el.dataset.ingredient));
  });
}

function selectVariant(
  name: string,
  buttons: NodeListOf<HTMLElement>,
  panels: NodeListOf<HTMLElement>,
  stops: NodeListOf<HTMLElement>,
  details: NodeListOf<HTMLElement>,
): void {
  buttons.forEach((el) => el.classList.toggle("rite-variant-btn-active", el.dataset.riteVariant === name));
  panels.forEach((el) => { el.hidden = el.dataset.riteVariantPanel !== name; });

  const panel = Array.from(panels).find((el) => el.dataset.riteVariantPanel === name) ?? null;
  if (panel) relocateSharedDetails(panel);
  if (panel) relocateGrainOracleGate(panel);
  highlightIngredients(panel);
  if (!panel) return;

  const first = panel.querySelector<HTMLElement>(".rite-stop")?.dataset.riteStop;
  if (first) selectStop(first, stops, details);
}

function initVariantToggle(): void {
  const buttons = document.querySelectorAll<HTMLElement>(".rite-variant-btn");
  const panels = document.querySelectorAll<HTMLElement>(".rite-variant");
  const stops = document.querySelectorAll<HTMLElement>(".rite-stop");
  const details = document.querySelectorAll<HTMLElement>(".rite-detail");
  if (buttons.length === 0) return;

  buttons.forEach((el) => {
    el.addEventListener("click", () => {
      const name = el.dataset.riteVariant;
      if (name) selectVariant(name, buttons, panels, stops, details);
    });
  });

  const first = buttons[0]?.dataset.riteVariant;
  if (first) selectVariant(first, buttons, panels, stops, details);
}

function init(): void {
  initTimeline();
  initGrainOracle();
  initVariantToggle();
}

init();

export {};
