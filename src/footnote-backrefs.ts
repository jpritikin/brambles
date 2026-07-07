// Animates footnote backref links (the "↩" anchors at the end of each
// footnote definition) when the cursor passes near one. Only applies to
// footnotes referenced more than once (i.e. with 2+ backrefs), since a
// single backref has nowhere to go.
//
// Mechanic: hovering near a backref sends it chasing its left neighbor along
// a semicircular arc (alternating above/below the line on each successive
// hop). As it nears the neighbor, it "pushes" that neighbor into the same
// chase, so the motion cascades leftward across the row. The leftmost
// backref arcs all the way out to the rightmost slot instead of off the end.
// The cascade runs for exactly one full lap (every backref hops once) and
// then the row is back to its original layout, at which point it can be
// triggered again after a cooldown.
//
// Line membership (which backrefs count as "the same row" for the purposes
// of "one step left") is recomputed from live layout on every trigger,
// rather than cached at page-load time, since layout can still shift after
// this script's initial run (font swap, sidebar width transitions, etc.).
// Once a cascade starts, though, its line and each member's original x
// position are frozen for that cascade's lifetime — re-measuring mid-flight
// would read a moving element's *transformed* position instead of its flow
// position, corrupting both line detection and target offsets.

const TRIGGER_RADIUS = 30;
const GROUP_COOLDOWN_MS = 3000;
const HOP_DURATION_MS = 900;
const PUSH_THRESHOLD = 0.3; // fraction of a hop traveled before pushing the next backref
const ARC_HEIGHT = 14; // px, semicircle bulge above/below the line

function easeInOutQuint(t: number): number {
  return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
}

interface Hop {
  el: HTMLElement;
  fromX: number; // translateX at hop start
  toX: number; // translateX once this hop lands
  arcSign: 1 | -1; // +1 = below the line, -1 = above
  startTime: number;
  pushedNext: boolean;
  index: number; // position within the frozen cascade line
}

interface Cascade {
  line: HTMLElement[];
  origLeft: number[]; // origLeft[i] = line[i]'s untransformed left, measured once at trigger time
  length: number;
  hopsStarted: number;
  hops: Map<HTMLElement, Hop>;
}

// One per footnote definition (<li> containing 2+ backrefs).
class FootnoteBackrefs {
  private cooldownUntil = 0;
  private cascade: Cascade | null = null;
  private raf = 0;
  // Persists across cascades: each backref's current logical slot, as an
  // index into its line's original (DOM-order) positions. A landed hop
  // permanently rotates the element into its neighbor's original slot
  // rather than snapping back — tracking the slot index (bounded to
  // [0, line.length)) rather than a raw cumulative pixel offset keeps
  // repeated cascades from drifting the element further and further from
  // the row every time it happens to draw the "wrap to the far end" hop.
  private slotOf = new Map<HTMLElement, number>();

  constructor(private parent: Element) {
    // CSS transforms have no visual effect on `display: inline` elements
    // (they don't generate a transformable box), so force inline-block.
    for (const el of this.allBackrefs()) {
      el.style.display = "inline-block";
    }
  }

  private allBackrefs(): HTMLElement[] {
    return Array.from(this.parent.querySelectorAll<HTMLElement>("a.footnote-backref"));
  }

  // Splits this footnote's backrefs into visual lines (left-to-right runs;
  // a wrap is where the next el's left edge drops back before the
  // previous one's) and returns the line containing `el`, or null. Only
  // safe to call when no backref in this footnote is mid-animation. Lines
  // are grouped by original (DOM/flow) order — untransformed left, i.e.
  // ignoring any rotation a previous cascade left the row in — since that's
  // what determines which backrefs wrapped together in the markup.
  private getLine(el: HTMLElement): HTMLElement[] | null {
    const all = this.allBackrefs();
    let current: HTMLElement[] = [];
    let prevLeft: number | null = null;
    for (const a of all) {
      const style = a.style.transform;
      a.style.transform = "";
      const left = a.getBoundingClientRect().left;
      a.style.transform = style;
      if (prevLeft !== null && left < prevLeft) {
        if (current.includes(el)) return current;
        current = [];
      }
      current.push(a);
      prevLeft = left;
    }
    return current.includes(el) ? current : null;
  }

  checkProximity(x: number, y: number) {
    if (performance.now() < this.cooldownUntil || this.cascade) return;
    // Adjacent backrefs can be closer together than TRIGGER_RADIUS, so pick
    // whichever one is actually nearest the cursor rather than the first
    // in DOM order that happens to be within range.
    let closest: HTMLElement | null = null;
    let closestDistSq = TRIGGER_RADIUS * TRIGGER_RADIUS;
    for (const el of this.allBackrefs()) {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = x - cx;
      const dy = y - cy;
      const distSq = dx * dx + dy * dy;
      if (distSq <= closestDistSq) {
        closest = el;
        closestDistSq = distSq;
      }
    }
    if (closest) this.trigger(closest);
  }

  private trigger(el: HTMLElement) {
    const line = this.getLine(el);
    if (!line || line.length < 2) return;
    const origLeft = line.map((a) => {
      const style = a.style.transform;
      a.style.transform = "";
      const left = a.getBoundingClientRect().left;
      a.style.transform = style;
      return left;
    });
    const cascade: Cascade = {
      line,
      origLeft,
      length: line.length,
      hopsStarted: 0,
      hops: new Map(),
    };
    this.cascade = cascade;
    // The cascade always advances through original line positions, in
    // order, starting at the triggered element: that element moves into
    // its left neighbor's slot (or wraps to the rightmost slot, if it was
    // leftmost), then the element originally to its right takes its place,
    // and so on rightward through original indices until the gap the
    // triggered element left behind is filled from its other side.
    this.startHop(cascade, line.indexOf(el), performance.now());
    if (!this.raf) this.raf = requestAnimationFrame((now) => this.tick(now));
  }

  private startHop(cascade: Cascade, index: number, now: number) {
    const n = cascade.length;
    const el = cascade.line[index];
    const fromSlot = this.slotOf.get(el) ?? index;
    const toSlot = (fromSlot - 1 + n) % n;
    this.slotOf.set(el, toSlot);
    const fromX = cascade.origLeft[fromSlot] - cascade.origLeft[index];
    const toX = cascade.origLeft[toSlot] - cascade.origLeft[index];
    const arcSign: 1 | -1 = cascade.hopsStarted % 2 === 0 ? -1 : 1;
    cascade.hopsStarted++;
    cascade.hops.set(el, { el, fromX, toX, arcSign, startTime: now, pushedNext: false, index });
  }

  private tick(now: number) {
    const cascade = this.cascade;
    if (!cascade) return;
    for (const [el, hop] of cascade.hops) {
      const t = Math.min(1, (now - hop.startTime) / HOP_DURATION_MS);
      const eased = easeInOutQuint(t);
      const x = hop.fromX + (hop.toX - hop.fromX) * eased;
      const y = hop.arcSign * ARC_HEIGHT * Math.sin(Math.PI * eased);
      el.style.transform = `translate(${x}px, ${y}px)`;

      if (!hop.pushedNext && t >= PUSH_THRESHOLD && cascade.hopsStarted < cascade.length) {
        hop.pushedNext = true;
        const nextIndex = (hop.index - 1 + cascade.length) % cascade.length;
        const nextEl = cascade.line[nextIndex];
        if (!cascade.hops.has(nextEl)) this.startHop(cascade, nextIndex, now);
      }

      if (t >= 1) {
        el.style.transform = `translate(${hop.toX}px, 0px)`;
        cascade.hops.delete(el);
      }
    }
    if (cascade.hops.size > 0) {
      this.raf = requestAnimationFrame((n) => this.tick(n));
    } else {
      this.raf = 0;
      this.cascade = null;
      this.cooldownUntil = now + GROUP_COOLDOWN_MS;
    }
  }
}

function findMultiBackrefFootnotes(): Element[] {
  const backrefs = Array.from(document.querySelectorAll<HTMLElement>("a.footnote-backref"));
  const parents = new Map<Element, number>();
  for (const a of backrefs) {
    const parent = a.parentElement;
    if (!parent) continue;
    parents.set(parent, (parents.get(parent) || 0) + 1);
  }
  return Array.from(parents.entries())
    .filter(([, count]) => count >= 2)
    .map(([parent]) => parent);
}

// Hugo's goldmark footnote template joins consecutive backrefs with &nbsp;,
// which (correctly, in general) suppresses line breaks. But that leaves a
// long backref chain as one unbreakable run that only wraps as a last
// resort, in whatever spot the browser is forced into. Since these are
// pure separators with no other content, it's safe to let them break here
// — replace only the whitespace text nodes that sit directly between two
// backref anchors, leaving every other &nbsp; on the page untouched.
function allowBackrefRowWrapping(parent: Element) {
  for (const node of Array.from(parent.childNodes)) {
    if (
      node.nodeType === Node.TEXT_NODE &&
      node.textContent &&
      /^[\s ]+$/.test(node.textContent) &&
      (node.previousSibling as HTMLElement | null)?.classList?.contains("footnote-backref") &&
      (node.nextSibling as HTMLElement | null)?.classList?.contains("footnote-backref")
    ) {
      node.textContent = node.textContent.replace(/ /g, " ");
    }
  }
}

function init() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const parents = findMultiBackrefFootnotes();
  for (const parent of parents) allowBackrefRowWrapping(parent);
  const footnotes = parents.map((parent) => new FootnoteBackrefs(parent));
  if (footnotes.length === 0) return;

  document.addEventListener("pointermove", (e) => {
    for (const fn of footnotes) fn.checkProximity(e.clientX, e.clientY);
  });
}

init();
