import { CELL_ASPECT } from "./ascii-compositor";
import type { SceneAnimator } from "./stahl-animator";
import type { FluidSim } from "./fluid-sim";
import type { PourSim, ContainerState, Segment } from "./pour-sim";
import { GLASS_FLUID_FILL } from "./stahl-props";

const WIDTH = 500;
const HEIGHT = 400;
const ETHANOL_COLOR = [60, 120, 220];
const POWDER_COLOR = [180, 140, 60];
const SOLID_COLOR = [120, 120, 120];

interface Camera {
  azimuth: number;
  elevation: number;
  zoom: number;
}

function project(
  x: number, y: number, z: number,
  cx: number, cy: number, cz: number,
  cam: Camera,
): [number, number, number] {
  const dx = x - cx, dy = y - cy, dz = z - cz;
  const cosA = Math.cos(cam.azimuth), sinA = Math.sin(cam.azimuth);
  const cosE = Math.cos(cam.elevation), sinE = Math.sin(cam.elevation);
  const rx = dx * cosA - dz * sinA;
  const rz = dx * sinA + dz * cosA;
  const ry = dy * cosE - rz * sinE;
  const depth = dy * sinE + rz * cosE;
  const scale = cam.zoom;
  return [WIDTH / 2 + rx * scale, HEIGHT / 2 + ry * scale, depth];
}

interface VoxelEntry {
  sx: number;
  sy: number;
  depth: number;
  size: number;
  r: number;
  g: number;
  b: number;
  alpha: number;
  wireframe: boolean;
}

// Build a map of topmost ethanol particle y per (x,z) column
function buildSurfaceMap(sim: FluidSim): Map<number, number> {
  const surface = new Map<number, number>();
  const d = sim.dims.depth;
  for (const p of sim.particles) {
    if (p.kind !== "ethanol") continue;
    const gx = Math.round(p.x), gz = Math.round(p.z);
    const key = gx * d + gz;
    const prev = surface.get(key);
    if (prev === undefined || p.y < prev) surface.set(key, p.y);
  }
  return surface;
}

function renderSim(ctx: CanvasRenderingContext2D, sim: FluidSim, cam: Camera, showForces: boolean): void {
  const { width, height, depth } = sim.dims;
  const cx = width / 2, cy = height / 2, cz = depth / 2;
  const cellSize = cam.zoom * 0.8;
  const voxels: VoxelEntry[] = [];

  // Solid boundary (inner shell only)
  for (let gx = 0; gx < width; gx++) {
    for (let gy = 0; gy < height; gy++) {
      for (let gz = 0; gz < depth; gz++) {
        const i = (gx * height + gy) * depth + gz;
        if (sim.solid[i] !== 1) continue;
        let adjacentToInterior = false;
        for (const [ox, oy, oz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
          const nx = gx + ox, ny = gy + oy, nz = gz + oz;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && nz >= 0 && nz < depth) {
            if (sim.solid[(nx * height + ny) * depth + nz] === 0) { adjacentToInterior = true; break; }
          }
        }
        if (!adjacentToInterior) continue;
        const [sx, sy, d] = project(gx, gy, gz, cx, cy, cz, cam);
        voxels.push({
          sx, sy, depth: d, size: cellSize,
          r: SOLID_COLOR[0], g: SOLID_COLOR[1], b: SOLID_COLOR[2],
          alpha: 0.15, wireframe: true,
        });
      }
    }
  }

  // Liquid surface: render topmost ethanol particle per (x,z) column
  const surface = buildSurfaceMap(sim);
  for (const [key, surfaceY] of surface) {
    const gz = key % depth;
    const gx = (key - gz) / depth;
    const [sx, sy, d] = project(gx, surfaceY, gz, cx, cy, cz, cam);
    voxels.push({
      sx, sy, depth: d, size: cellSize,
      r: ETHANOL_COLOR[0], g: ETHANOL_COLOR[1], b: ETHANOL_COLOR[2],
      alpha: 0.85, wireframe: false,
    });
  }

  // Powder particles
  for (const p of sim.particles) {
    if (p.kind !== "powder") continue;
    const [sx, sy, d] = project(p.x, p.y, p.z, cx, cy, cz, cam);
    voxels.push({
      sx, sy, depth: d, size: cellSize,
      r: POWDER_COLOR[0], g: POWDER_COLOR[1], b: POWDER_COLOR[2],
      alpha: 1, wireframe: false,
    });
  }

  voxels.sort((a, b) => b.depth - a.depth);

  for (const v of voxels) {
    const half = v.size / 2;
    if (v.wireframe) {
      ctx.strokeStyle = `rgba(${v.r},${v.g},${v.b},${v.alpha})`;
      ctx.lineWidth = 0.5;
      ctx.strokeRect(v.sx - half, v.sy - half, v.size, v.size);
    } else {
      ctx.fillStyle = `rgba(${v.r},${v.g},${v.b},${v.alpha})`;
      ctx.fillRect(v.sx - half, v.sy - half, v.size, v.size);
    }
  }

  // Force vectors (per-particle, not grid-based)
  let maxSpeed = 0;
  for (const p of sim.particles) {
    const s = Math.sqrt(p.vx ** 2 + p.vy ** 2 + p.vz ** 2);
    if (s > maxSpeed) maxSpeed = s;
  }

  if (showForces && maxSpeed > 0.01) {
    const arrowScale = cam.zoom * 0.3;
    const headLen = 4;
    ctx.lineWidth = 1.5;
    for (const p of sim.particles) {
      const speed = Math.sqrt(p.vx ** 2 + p.vy ** 2 + p.vz ** 2);
      if (speed < maxSpeed * 0.05) continue;
      const t = Math.min(1, speed / maxSpeed);
      const hue = 60 * (1 - t);
      ctx.strokeStyle = `hsla(${hue},100%,50%,0.7)`;
      ctx.fillStyle = ctx.strokeStyle;
      const [sx0, sy0] = project(p.x, p.y, p.z, cx, cy, cz, cam);
      const sc = arrowScale / cam.zoom;
      const [sx1, sy1] = project(p.x + p.vx * sc, p.y + p.vy * sc, p.z + p.vz * sc, cx, cy, cz, cam);
      ctx.beginPath();
      ctx.moveTo(sx0, sy0);
      ctx.lineTo(sx1, sy1);
      ctx.stroke();
      const adx = sx1 - sx0, ady = sy1 - sy0;
      const alen = Math.sqrt(adx * adx + ady * ady);
      if (alen > 2) {
        const ux = adx / alen, uy = ady / alen;
        ctx.beginPath();
        ctx.moveTo(sx1, sy1);
        ctx.lineTo(sx1 - headLen * ux + headLen * 0.4 * uy, sy1 - headLen * uy - headLen * 0.4 * ux);
        ctx.lineTo(sx1 - headLen * ux - headLen * 0.4 * uy, sy1 - headLen * uy + headLen * 0.4 * ux);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // Stats overlay
  const ethCount = sim.particles.filter(p => p.kind === "ethanol").length;
  const powCount = sim.particles.filter(p => p.kind === "powder").length;
  ctx.fillStyle = "#fff";
  ctx.font = "11px monospace";
  const lines = [
    `ethanol: ${ethCount} particles`,
    `powder:  ${powCount} particles`,
    `grid: ${width}x${height}x${depth}  maxV: ${maxSpeed.toFixed(2)}`,
  ];
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], 8, 14 + i * 14);
  }
  if (showForces) {
    const legY = 14 + lines.length * 14;
    const legW = 80;
    for (let lx = 0; lx < legW; lx++) {
      const t = lx / legW;
      ctx.fillStyle = `hsl(${60 * (1 - t)},100%,50%)`;
      ctx.fillRect(8 + lx, legY, 1, 8);
    }
    ctx.fillStyle = "#fff";
    ctx.fillText("slow", 8, legY + 20);
    ctx.fillText("fast", 8 + legW - 20, legY + 20);
  }
}

export function initFluidDebug3D(animator: SceneAnimator): void {
  const anchor = document.getElementById("stahl-slideshow");
  if (!anchor) return;

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.style.cssText = "display:block;margin:1em auto;border:1px solid #444;background:#111;cursor:grab;";
  anchor.insertAdjacentElement("afterend", canvas);

  const controls = document.createElement("div");
  controls.style.cssText = "text-align:center;color:#888;font-size:12px;font-family:monospace;margin-bottom:1em;";
  canvas.insertAdjacentElement("afterend", controls);

  controls.innerHTML = "3D Fluid Debug—drag to rotate, scroll to zoom";

  let showForces = false;
  const forceRow = document.createElement("div");
  forceRow.style.cssText = "margin-top:0.5em;";
  const forceCheckbox = document.createElement("input");
  forceCheckbox.type = "checkbox";
  forceCheckbox.id = "fluid-debug-forces";
  forceCheckbox.addEventListener("change", () => { showForces = forceCheckbox.checked; });
  const forceLabel = document.createElement("label");
  forceLabel.htmlFor = "fluid-debug-forces";
  forceLabel.textContent = " Show force vectors";
  forceLabel.style.cssText = "cursor:pointer;";
  forceRow.appendChild(forceCheckbox);
  forceRow.appendChild(forceLabel);
  controls.appendChild(forceRow);

  const sliderRow = document.createElement("div");
  sliderRow.style.cssText = "margin-top:0.5em;";
  const sliderLabel = document.createElement("span");
  sliderLabel.textContent = "Stir force: 140";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "500";
  slider.value = "140";
  slider.style.cssText = "width:200px;vertical-align:middle;margin-left:8px;";
  slider.addEventListener("input", () => {
    const val = Number(slider.value);
    sliderLabel.textContent = `Stir force: ${val}`;
    animator.stirStrengthOverride = val === 140 ? null : val;
  });
  sliderRow.appendChild(sliderLabel);
  sliderRow.appendChild(slider);
  controls.appendChild(sliderRow);

  const fillRow = document.createElement("div");
  fillRow.style.cssText = "margin-top:0.5em;";
  const fillLabel = document.createElement("span");
  fillLabel.textContent = `Fill level: ${GLASS_FLUID_FILL}`;
  const fillSlider = document.createElement("input");
  fillSlider.type = "range";
  fillSlider.min = "10";
  fillSlider.max = "100";
  fillSlider.value = String(Math.round(GLASS_FLUID_FILL * 100));
  fillSlider.style.cssText = "width:200px;vertical-align:middle;margin-left:8px;";
  fillSlider.addEventListener("input", () => {
    const val = Number(fillSlider.value) / 100;
    fillLabel.textContent = `Fill level: ${val.toFixed(2)}`;
    animator.fillLevelOverride = val;
    animator.fillLiquidContainer("glass");
  });
  fillRow.appendChild(fillLabel);
  fillRow.appendChild(fillSlider);
  controls.appendChild(fillRow);

  const viscRow = document.createElement("div");
  viscRow.style.cssText = "margin-top:0.5em;";
  const viscLabel = document.createElement("span");
  viscLabel.textContent = "Viscosity: 0.14";
  const viscSlider = document.createElement("input");
  viscSlider.type = "range";
  viscSlider.min = "0";
  viscSlider.max = "100";
  viscSlider.value = "14";
  viscSlider.style.cssText = "width:200px;vertical-align:middle;margin-left:8px;";
  viscSlider.addEventListener("input", () => {
    const val = Number(viscSlider.value) / 100;
    viscLabel.textContent = `Viscosity: ${val.toFixed(2)}`;
    const sim = animator.getGlassFluidSim();
    if (sim) sim.viscosity = val;
  });
  viscRow.appendChild(viscLabel);
  viscRow.appendChild(viscSlider);
  controls.appendChild(viscRow);

  const flipRow = document.createElement("div");
  flipRow.style.cssText = "margin-top:0.5em;";
  const flipLabel = document.createElement("span");
  flipLabel.textContent = "FLIP ratio: 0.95";
  const flipSlider = document.createElement("input");
  flipSlider.type = "range";
  flipSlider.min = "0";
  flipSlider.max = "100";
  flipSlider.value = "95";
  flipSlider.style.cssText = "width:200px;vertical-align:middle;margin-left:8px;";
  flipSlider.addEventListener("input", () => {
    const val = Number(flipSlider.value) / 100;
    flipLabel.textContent = `FLIP ratio: ${val.toFixed(2)}`;
    const sim = animator.getGlassFluidSim();
    if (sim) sim.flipRatio = val;
  });
  flipRow.appendChild(flipLabel);
  flipRow.appendChild(flipSlider);
  controls.appendChild(flipRow);

  const copyBtn = document.createElement("button");
  copyBtn.textContent = "Copy surface data";
  copyBtn.style.cssText = "margin-top:0.5em;cursor:pointer;";
  copyBtn.addEventListener("click", () => {
    const sim = animator.getGlassFluidSim();
    if (!sim) { navigator.clipboard.writeText("No fluid sim active"); return; }
    const { width, height, depth } = sim.dims;
    const ethCount = sim.particles.filter(p => p.kind === "ethanol").length;
    const powCount = sim.particles.filter(p => p.kind === "powder").length;
    const surface = buildSurfaceMap(sim);
    let maxSpeed = 0, avgSpeed = 0;
    for (const p of sim.particles) {
      const s = Math.sqrt(p.vx ** 2 + p.vy ** 2 + p.vz ** 2);
      if (s > maxSpeed) maxSpeed = s;
      avgSpeed += s;
    }
    avgSpeed /= sim.particles.length || 1;
    const stirVal = animator.stirStrengthOverride ?? "default";
    const fillVal = animator.fillLevelOverride ?? GLASS_FLUID_FILL;
    const bounds = sim.bounds ? `r=${sim.bounds.radius.toFixed(1)} cx=${sim.bounds.cx.toFixed(1)} cz=${sim.bounds.cz.toFixed(1)}` : "none";
    const lines: string[] = [
      `grid: ${width}x${height}x${depth}  ethanol: ${ethCount}  powder: ${powCount}  fill: ${fillVal}`,
      `stir: ${stirVal}  viscosity: ${sim.viscosity.toFixed(2)}  flip: ${sim.flipRatio.toFixed(2)}  bounds: ${bounds}`,
      `maxV: ${maxSpeed.toFixed(2)}  avgV: ${avgSpeed.toFixed(2)}`,
      ``,
      `Surface height from floor per (x,z) column (. = dry, S = solid):`,
    ];
    for (let gx = 0; gx < width; gx++) {
      const row: string[] = [];
      for (let gz = 0; gz < depth; gz++) {
        const i = (gx * height + 0) * depth + gz;
        let allSolid = true;
        for (let gy = 0; gy < height; gy++) {
          if (!sim.solid[(gx * height + gy) * depth + gz]) { allSolid = false; break; }
        }
        if (allSolid) { row.push("  S "); continue; }
        const key = gx * depth + gz;
        const surfaceY = surface.get(key);
        if (surfaceY === undefined) { row.push("  . "); continue; }
        const h = (height - 1) - surfaceY;
        row.push(h.toFixed(1));
      }
      lines.push(`x=${String(gx).padStart(2)}: ${row.join(" ")}`);
    }
    navigator.clipboard.writeText(lines.join("\n"));
    copyBtn.textContent = "Copied!";
    setTimeout(() => { copyBtn.textContent = "Copy surface data"; }, 1500);
  });
  controls.appendChild(copyBtn);

  // 2D Pour Sim debug canvas
  const pourCanvas = document.createElement("canvas");
  pourCanvas.width = WIDTH;
  pourCanvas.height = HEIGHT;
  pourCanvas.style.cssText = "display:block;margin:1em auto;border:1px solid #644;background:#111;";
  controls.insertAdjacentElement("afterend", pourCanvas);

  const pourControls = document.createElement("div");
  pourControls.style.cssText = "text-align:center;color:#888;font-size:12px;font-family:monospace;margin-bottom:1em;";
  pourCanvas.insertAdjacentElement("afterend", pourControls);

  const SPEEDS = [0, 0.25, 0.5, 1];
  const speedBtns: HTMLButtonElement[] = [];
  for (const speed of SPEEDS) {
    const btn = document.createElement("button");
    btn.textContent = speed === 0 ? "Pause" : `${speed}x`;
    btn.style.cssText = "cursor:pointer;font-family:monospace;font-size:12px;margin-right:4px;";
    btn.addEventListener("click", () => { animator.playbackSpeed = speed; });
    pourControls.appendChild(btn);
    speedBtns.push(btn);
  }

  const pourLabel = document.createElement("span");
  pourLabel.textContent = " Playback";
  pourLabel.style.cssText = "margin-left:8px;";
  pourControls.appendChild(pourLabel);

  // Toggle between 3D fluid and 2D pour views—pour sim is default
  const toggleRow = document.createElement("div");
  toggleRow.style.cssText = "text-align:center;margin-top:0.5em;margin-bottom:0.5em;";
  canvas.insertAdjacentElement("beforebegin", toggleRow);
  const toggleBtn = document.createElement("button");
  toggleBtn.textContent = "Show Fluid Sim";
  toggleBtn.style.cssText = "cursor:pointer;font-family:monospace;font-size:12px;margin-right:8px;";
  let showPourView = true;
  canvas.style.display = "none";
  controls.style.display = "none";
  toggleBtn.addEventListener("click", () => {
    showPourView = !showPourView;
    toggleBtn.textContent = showPourView ? "Show Fluid Sim" : "Show Pour Sim";
    canvas.style.display = showPourView ? "none" : "block";
    controls.style.display = showPourView ? "none" : "";
    pourCanvas.style.display = showPourView ? "block" : "none";
    pourControls.style.display = showPourView ? "" : "none";
  });
  toggleRow.appendChild(toggleBtn);

  // Copy ASCII from the live DOM grid—always available regardless of active view
  const asciiBtn = document.createElement("button");
  asciiBtn.textContent = "Copy ASCII";
  asciiBtn.style.cssText = "cursor:pointer;font-family:monospace;font-size:12px;";
  asciiBtn.addEventListener("click", () => {
    const text = animator.dumpAscii();
    navigator.clipboard.writeText(text || "(no grid mounted)");
    asciiBtn.textContent = "Copied!";
    setTimeout(() => { asciiBtn.textContent = "Copy ASCII"; }, 1500);
  });
  toggleRow.appendChild(asciiBtn);

  const ctx = canvas.getContext("2d")!;
  const pourCtx = pourCanvas.getContext("2d")!;
  const cam: Camera = { azimuth: 0.6, elevation: -0.4, zoom: 40 };

  let dragging = false;
  let lastX = 0, lastY = 0;

  canvas.addEventListener("mousedown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.style.cursor = "grabbing";
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
    canvas.style.cursor = "grab";
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    cam.azimuth += (e.clientX - lastX) * 0.01;
    cam.elevation += (e.clientY - lastY) * 0.01;
    cam.elevation = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cam.elevation));
    lastX = e.clientX;
    lastY = e.clientY;
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    cam.zoom *= e.deltaY > 0 ? 0.9 : 1.1;
    cam.zoom = Math.max(10, Math.min(120, cam.zoom));
  }, { passive: false });

  function tick(): void {
    for (let i = 0; i < SPEEDS.length; i++) {
      const active = SPEEDS[i] === animator.playbackSpeed;
      speedBtns[i].style.fontWeight = active ? "bold" : "normal";
      speedBtns[i].style.textDecoration = active ? "underline" : "none";
    }

    if (!showPourView) {
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      const sim = animator.getGlassFluidSim();
      if (!sim) {
        ctx.fillStyle = "#666";
        ctx.font = "14px monospace";
        ctx.fillText("No fluid sim active", WIDTH / 2 - 70, HEIGHT / 2);
      } else {
        renderSim(ctx, sim, cam, showForces);
      }
    } else {
      pourCtx.clearRect(0, 0, WIDTH, HEIGHT);
      const pourSims = animator.getActivePourSims();
      if (pourSims.size === 0) {
        pourCtx.fillStyle = "#666";
        pourCtx.font = "14px monospace";
        pourCtx.fillText("No pour sim active", WIDTH / 2 - 70, HEIGHT / 2);
      } else {
        renderPourSims(pourCtx, pourSims, animator.playbackSpeed);
      }
    }

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// Transform a point from a container's local physical space to world grid coords.
function pourLocalToWorld(
  lx: number, ly: number,
  state: ContainerState, pivot: [number, number],
): [number, number] {
  const cos = Math.cos(state.rotation), sin = Math.sin(state.rotation);
  const wx = lx * cos - ly * sin;
  const wy = lx * sin + ly * cos;
  return [state.x + pivot[0] + wx, state.y + pivot[1] + wy / CELL_ASPECT];
}

function drawWallsWorld(
  ctx: CanvasRenderingContext2D,
  walls: Segment[],
  state: ContainerState,
  pivot: [number, number],
  scale: number, ox: number, oy: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  for (const seg of walls) {
    const [x1, y1] = pourLocalToWorld(seg.x1, seg.y1, state, pivot);
    const [x2, y2] = pourLocalToWorld(seg.x2, seg.y2, state, pivot);
    ctx.beginPath();
    ctx.moveTo(ox + x1 * scale, oy + y1 * scale);
    ctx.lineTo(ox + x2 * scale, oy + y2 * scale);
    ctx.stroke();
  }
}

const POUR_COLORS = {
  source: "rgba(100, 180, 100, 0.6)",
  target: "rgba(100, 100, 220, 0.6)",
  inSource: "rgba(60, 200, 60, 1)",
  airborne: "rgba(255, 200, 50, 1)",
  landed: "rgba(100, 100, 100, 0.5)",
};

function renderPourSims(
  ctx: CanvasRenderingContext2D,
  sims: Map<string, { sim: PourSim; sourceState: () => ContainerState; targetState: () => ContainerState }>,
  speed: number,
): void {
  // Compute bounding box of all particles + wall endpoints in world coords
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  const entries = [...sims.entries()];
  const resolved = entries.map(([label, { sim, sourceState, targetState }]) => {
    const src = sourceState();
    const tgt = targetState();
    return { label, sim, src, tgt };
  });

  for (const { sim, src, tgt } of resolved) {
    for (const seg of sim.sourceWalls) {
      for (const [lx, ly] of [[seg.x1, seg.y1], [seg.x2, seg.y2]] as const) {
        const [wx, wy] = pourLocalToWorld(lx, ly, src, sim.sourcePivot);
        minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
        minY = Math.min(minY, wy); maxY = Math.max(maxY, wy);
      }
    }
    for (const seg of sim.targetWalls) {
      for (const [lx, ly] of [[seg.x1, seg.y1], [seg.x2, seg.y2]] as const) {
        const [wx, wy] = pourLocalToWorld(lx, ly, tgt, sim.targetPivot);
        minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
        minY = Math.min(minY, wy); maxY = Math.max(maxY, wy);
      }
    }
    for (const p of sim.particles) {
      const pivot = p.airborne || p.landed ? sim.targetPivot : sim.sourcePivot;
      const state = p.airborne || p.landed ? tgt : src;
      const [wx, wy] = pourLocalToWorld(p.x, p.y, state, pivot);
      minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
      minY = Math.min(minY, wy); maxY = Math.max(maxY, wy);
    }
  }

  if (!isFinite(minX)) return;

  const pad = 2;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale = Math.min((WIDTH - 40) / rangeX, (HEIGHT - 60) / rangeY);
  const ox = (WIDTH - rangeX * scale) / 2 - minX * scale;
  const oy = (HEIGHT - rangeY * scale) / 2 - minY * scale + 10;

  for (const { label, sim, src, tgt } of resolved) {
    drawWallsWorld(ctx, sim.sourceWalls, src, sim.sourcePivot, scale, ox, oy, POUR_COLORS.source);
    drawWallsWorld(ctx, sim.targetWalls, tgt, sim.targetPivot, scale, ox, oy, POUR_COLORS.target);

    // Particles
    let inSourceCount = 0, airborneCount = 0, landedCount = 0;
    for (const p of sim.particles) {
      const pivot = p.airborne || p.landed ? sim.targetPivot : sim.sourcePivot;
      const state = p.airborne || p.landed ? tgt : src;
      const [wx, wy] = pourLocalToWorld(p.x, p.y, state, pivot);
      const sx = ox + wx * scale;
      const sy = oy + wy * scale;

      if (p.landed) {
        ctx.fillStyle = POUR_COLORS.landed;
        landedCount++;
      } else if (p.airborne) {
        ctx.fillStyle = POUR_COLORS.airborne;
        airborneCount++;
      } else {
        ctx.fillStyle = POUR_COLORS.inSource;
        inSourceCount++;
      }
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fill();

      // Velocity arrow
      const speed = Math.hypot(p.vx, p.vy);
      if (speed > 0.5 && !p.landed) {
        const cos = Math.cos(state.rotation), sin = Math.sin(state.rotation);
        const wvx = p.vx * cos - p.vy * sin;
        const wvy = (p.vx * sin + p.vy * cos) / CELL_ASPECT;
        const arrowLen = Math.min(20, speed * scale * 0.05);
        const nvx = wvx / speed, nvy = wvy / speed;
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + nvx * arrowLen, sy + nvy * arrowLen);
        ctx.stroke();
      }
    }

    // Stats
    ctx.fillStyle = "#fff";
    ctx.font = "11px monospace";
    const total = sim.particles.length;
    const status = speed === 0 ? " [PAUSED]" : speed < 1 ? ` [${speed}x]` : "";
    ctx.fillText(`${label}: ${total} particles (src:${inSourceCount} air:${airborneCount} landed:${landedCount})${status}`, 8, 14);
  }

  // Legend
  const legY = HEIGHT - 30;
  ctx.font = "10px monospace";
  for (const [color, text, lx] of [
    [POUR_COLORS.source, "source walls", 8],
    [POUR_COLORS.target, "target walls", 110],
    [POUR_COLORS.inSource, "in source", 210],
    [POUR_COLORS.airborne, "airborne", 290],
    [POUR_COLORS.landed, "landed", 360],
  ] as const) {
    ctx.fillStyle = color;
    ctx.fillRect(lx, legY, 8, 8);
    ctx.fillStyle = "#888";
    ctx.fillText(text, lx + 12, legY + 8);
  }
}
