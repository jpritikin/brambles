// Animates the offerings inside `.shrine` containers: tossed flowers
// (driven by a small falling-leaf physics simulation) and flickering
// aarti lamps.

const FLOWERS = ["🌸", "🌺", "🌼", "🪷", "🌹"];

const GRAVITY = 14; // px/s^2, gentle — these are petals, not stones
const AIR_DRAG = 0.6; // damps vertical speed so terminal velocity is low

interface Petal {
  el: HTMLElement;
  x: number;
  y: number;
  vy: number;
  vx: number;
  angle: number;
  angularVelocity: number;
}

// Ornstein-Uhlenbeck step: nudges `v` with random turbulence while pulling it
// back toward zero, so horizontal drift wanders unpredictably but stays bounded —
// like a petal being knocked around by little gusts of air resistance.
function ouStep(v: number, dt: number, revertRate: number, volatility: number): number {
  const noise = (Math.random() - 0.5) * 2;
  return v - revertRate * v * dt + volatility * noise * Math.sqrt(dt);
}

function spawnPetal(layer: HTMLElement): Petal {
  const el = document.createElement("span");
  el.className = "shrine-flower";
  el.textContent = FLOWERS[Math.floor(Math.random() * FLOWERS.length)];
  el.style.fontSize = `${0.8 + Math.random() * 0.9}rem`;
  layer.appendChild(el);

  return {
    el,
    x: Math.random() * layer.clientWidth,
    y: 0,
    vy: 4 + Math.random() * 4,
    vx: (Math.random() - 0.5) * 12,
    angle: Math.random() * 360,
    angularVelocity: (Math.random() - 0.5) * 60,
  };
}

const MAX_OPACITY = 0.5;
const FADE_ZONE = 56; // px over which petals fade in/out at the layer's edges

function stepPetal(petal: Petal, dt: number, layerWidth: number, layerHeight: number): void {
  petal.vy += GRAVITY * dt;
  petal.vy -= AIR_DRAG * petal.vy * dt;
  petal.y += petal.vy * dt;

  // Horizontal drift wanders stochastically, as if buffeted by little gusts —
  // mean-reverting so the petal doesn't drift off forever in one direction.
  petal.vx = ouStep(petal.vx, dt, 0.4, 18);
  petal.x += petal.vx * dt;
  petal.angularVelocity = ouStep(petal.angularVelocity, dt, 0.3, 40);
  petal.angle += petal.angularVelocity * dt;

  // Fade out near every edge of the layer — top, bottom, left, and right —
  // so petals never appear to be clipped by a hard rectangular boundary.
  // Distances are measured from the petal's visible edges (not its anchor
  // point), so the fade reaches zero before any part of the glyph is clipped.
  const width = petal.el.offsetWidth;
  const height = petal.el.offsetHeight;
  const fadeTop = Math.min(petal.y / FADE_ZONE, 1);
  const fadeBottom = Math.min((layerHeight - (petal.y + height)) / FADE_ZONE, 1);
  const fadeLeft = Math.min(petal.x / FADE_ZONE, 1);
  const fadeRight = Math.min((layerWidth - (petal.x + width)) / FADE_ZONE, 1);
  const edgeFade = Math.max(0, Math.min(fadeTop, fadeBottom, fadeLeft, fadeRight));
  const opacity = edgeFade * MAX_OPACITY;

  petal.el.style.opacity = opacity.toFixed(2);
  petal.el.style.transform =
    `translate(${petal.x.toFixed(1)}px, ${petal.y.toFixed(1)}px) rotate(${petal.angle.toFixed(1)}deg)`;
}

function runPetals(layer: HTMLElement): void {
  const petals: Petal[] = [];
  let lastSpawn = 0;
  let lastTime = performance.now();

  function frame(now: number): void {
    const dt = Math.max(0, Math.min((now - lastTime) / 1000, 0.05));
    lastTime = now;

    if (now - lastSpawn > 1100 + Math.random() * 800) {
      petals.push(spawnPetal(layer));
      lastSpawn = now;
    }

    const layerWidth = layer.clientWidth;
    const layerHeight = layer.clientHeight;
    for (let i = petals.length - 1; i >= 0; i--) {
      const petal = petals[i];
      stepPetal(petal, dt, layerWidth, layerHeight);
      const offBottom = petal.y > layerHeight;
      const offSide = petal.x + petal.el.offsetWidth < 0 || petal.x > layerWidth;
      if (offBottom || offSide) {
        petal.el.remove();
        petals.splice(i, 1);
      }
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

interface Flame {
  el: HTMLElement;
  scale: number;
  scaleVelocity: number;
  tilt: number;
  tiltVelocity: number;
  lift: number;
}

function stepFlame(flame: Flame, dt: number): void {
  // A real flame doesn't oscillate on a fixed beat — it guts and steadies at
  // the whim of the surrounding air. Mean-reverting noise gives that unevenness
  // without ever repeating, and slow rates keep it gentle rather than jittery.
  flame.scaleVelocity = ouStep(flame.scaleVelocity, dt, 0.6, 0.05);
  flame.scale += flame.scaleVelocity * dt;
  flame.scale = Math.max(0.85, Math.min(1.2, flame.scale));

  flame.tiltVelocity = ouStep(flame.tiltVelocity, dt, 0.5, 1.6);
  flame.tilt += flame.tiltVelocity * dt;
  flame.tilt = Math.max(-6, Math.min(6, flame.tilt));

  const opacity = 0.85 + (flame.scale - 1) * 0.5;
  flame.el.style.opacity = opacity.toFixed(2);
  flame.el.style.transform =
    `translateY(${flame.lift.toFixed(1)}px) scale(${flame.scale.toFixed(3)}) rotate(${flame.tilt.toFixed(2)}deg)`;
}

// Lifts the lamps from the book's base by a fraction of its rendered
// height. Measured from the actual image (rather than assumed from CSS
// dimensions) so the lamps stay aligned regardless of when the image loads
// or how its intrinsic size affects layout.
function flameLift(icon: HTMLElement | null): number {
  if (!icon) return 0;
  return -icon.clientHeight / 5;
}

function runFlames(shrine: HTMLElement): void {
  const icon = shrine.querySelector<HTMLElement>(".shrine-icon");
  const img = icon?.querySelector("img") ?? null;
  const flames: Flame[] = Array.from(shrine.querySelectorAll<HTMLElement>(".shrine-flame")).map((el) => ({
    el,
    scale: 1,
    scaleVelocity: 0,
    tilt: 0,
    tiltVelocity: 0,
    lift: flameLift(icon),
  }));
  if (flames.length === 0) return;

  function remeasure(): void {
    const lift = flameLift(icon);
    flames.forEach((flame) => (flame.lift = lift));
  }
  if (img && !img.complete) img.addEventListener("load", remeasure, { once: true });
  window.addEventListener("resize", remeasure);

  let lastTime = performance.now();
  function frame(now: number): void {
    const dt = Math.max(0, Math.min((now - lastTime) / 1000, 0.05));
    lastTime = now;
    flames.forEach((flame) => stepFlame(flame, dt));
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function initShrine(shrine: HTMLElement): void {
  const layer = shrine.querySelector<HTMLElement>(".shrine-flowers");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) return;
  if (layer) runPetals(layer);
  runFlames(shrine);
}

document.querySelectorAll<HTMLElement>(".shrine").forEach(initShrine);
