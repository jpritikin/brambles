// Decodes the psychological-characterization emoji patterns used on
// psychoactive substance pages (see content/docs/psychoactive/_index.md,
// "Psychological Characterization"). data/psychScale.json is the single
// source of truth for the criteria/levels; both this widget and the
// {{< psych-scale-legend >}} shortcode read from it. Substance pages embed a
// pattern via <span class="psych-scale" data-pattern="🚂🧊🍃">.
//
// Click the pattern to expand a popup listing the decoded meaning of each
// emoji in order. Click again (or elsewhere) to collapse.

import psychScale from "../data/psychScale.json";

interface Level {
  emoji: string;
  label: string;
  description: string;
}

interface Criterion {
  name: string;
  levels: Level[];
}

const LEVELS_BY_EMOJI: Record<string, Level> = Object.fromEntries(
  (psychScale.criteria as Criterion[]).flatMap((c) => c.levels.map((l) => [l.emoji, l])),
);

function segmentEmoji(pattern: string): string[] {
  // Matches one emoji, including any trailing variation selector (e.g. the
  // U+FE0F on 🌧️) or ZWJ sequence continuation.
  const EMOJI_RE = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu;
  return pattern.match(EMOJI_RE) ?? [];
}

function buildPopup(emojis: string[]): HTMLElement {
  const popup = document.createElement("div");
  popup.className = "psych-scale-popup";
  for (const emoji of emojis) {
    const row = document.createElement("div");
    row.className = "psych-scale-row";
    const glyph = document.createElement("span");
    glyph.className = "psych-scale-glyph";
    glyph.textContent = emoji;
    const level = LEVELS_BY_EMOJI[emoji];
    const label = document.createElement("span");
    label.className = "psych-scale-label";
    label.textContent = level ? `${level.label} — ${level.description}` : "(unknown)";
    row.append(glyph, label);
    popup.appendChild(row);
  }
  return popup;
}

// Appended directly to <body> (rather than inside the widget) so it isn't
// trapped by an ancestor stacking context — the theme's TOC sidebar
// (.book-toc-content) uses `will-change: transform`, which creates one, and
// any popup nested inside .markdown would stack below it regardless of
// z-index.
function positionPopup(popup: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  popup.style.position = "fixed";
  popup.style.top = `${rect.bottom + 4}px`;
  popup.style.left = `${rect.left}px`;

  // Clamp horizontally so the popup doesn't overflow the right edge of the
  // viewport; only measurable once the popup is attached to the DOM.
  const margin = 8;
  const popupWidth = popup.getBoundingClientRect().width;
  const overflow = rect.left + popupWidth - (window.innerWidth - margin);
  if (overflow > 0) {
    popup.style.left = `${Math.max(margin, rect.left - overflow)}px`;
  }
}

function initWidget(el: HTMLElement): void {
  const pattern = el.dataset.pattern ?? el.textContent ?? "";
  const emojis = segmentEmoji(pattern.trim());
  el.textContent = "";
  el.classList.add("psych-scale-widget");
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-expanded", "false");

  for (const emoji of emojis) {
    const glyph = document.createElement("span");
    glyph.textContent = emoji;
    el.appendChild(glyph);
  }

  let popup: HTMLElement | null = null;

  const reposition = () => {
    if (popup) positionPopup(popup, el);
  };

  const close = () => {
    popup?.remove();
    popup = null;
    el.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDocumentClick, true);
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
  };

  const onDocumentClick = (event: MouseEvent) => {
    const target = event.target as Node;
    if (!el.contains(target) && !popup?.contains(target)) close();
  };

  const toggle = () => {
    if (popup) {
      close();
      return;
    }
    popup = buildPopup(emojis);
    document.body.appendChild(popup);
    positionPopup(popup, el);
    el.setAttribute("aria-expanded", "true");
    document.addEventListener("click", onDocumentClick, true);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
  };

  el.addEventListener("click", (event) => {
    event.stopPropagation();
    toggle();
  });
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  });
}

document.querySelectorAll<HTMLElement>(".psych-scale").forEach(initWidget);
