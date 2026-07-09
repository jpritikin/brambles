// Sample Rite timeline on the Stahl Shrine page: clicking a stop shows only
// that stop's detail panel (content/docs/psychoactive/stahl-shrine/_index.md).

function selectStop(name: string, stops: NodeListOf<HTMLElement>, details: NodeListOf<HTMLElement>): void {
  stops.forEach((el) => el.classList.toggle("rite-stop-active", el.dataset.riteStop === name));
  details.forEach((el) => { el.hidden = el.dataset.riteDetail !== name; });
}

function init(): void {
  const stops = document.querySelectorAll<HTMLElement>(".rite-stop");
  const details = document.querySelectorAll<HTMLElement>(".rite-detail");
  if (stops.length === 0) return;

  stops.forEach((el) => {
    el.addEventListener("click", () => {
      const name = el.dataset.riteStop;
      if (name) selectStop(name, stops, details);
    });
  });

  const first = stops[0]?.dataset.riteStop;
  if (first) selectStop(first, stops, details);
}

init();

export {};
