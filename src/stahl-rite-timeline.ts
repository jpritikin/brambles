// Sample Rite timeline on the Stahl Shrine page: a variant toggle ("Don't
// Need Help" / "Uninspired" / "Thai Inspired") controls which recipe panel
// is in play, defaulting to "Don't Need Help" so the Sample Rite stays
// tucked away until asked for. Within a chosen panel, clicking a stop shows
// only that stop's detail. The Eat list highlights whichever ingredients the
// active variant's recipe actually calls for
// (content/docs/psychoactive/stahl-shrine/_index.md).

function selectStop(name: string, stops: NodeListOf<HTMLElement>, details: NodeListOf<HTMLElement>): void {
  stops.forEach((el) => el.classList.toggle("rite-stop-active", el.dataset.riteStop === name));
  details.forEach((el) => { el.hidden = el.dataset.riteDetail !== name; });
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
  const used = new Set(
    panel ? Array.from(panel.querySelectorAll<HTMLElement>(".rite-ingredient")).map((el) => el.dataset.ingredient) : [],
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
  initVariantToggle();
}

init();

export {};
