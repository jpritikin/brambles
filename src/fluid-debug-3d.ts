import type { SceneAnimator } from "./stahl-animator";
import { type FluidSim, projectFluidSim } from "./fluid-sim";
import { MATERIAL_GLYPHS } from "./iso";
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

  const asciiBtn = document.createElement("button");
  asciiBtn.textContent = "Copy ASCII";
  asciiBtn.style.cssText = "margin-top:0.5em;margin-left:0.5em;cursor:pointer;";
  asciiBtn.addEventListener("click", () => {
    const sim = animator.getGlassFluidSim();
    if (!sim) { navigator.clipboard.writeText("No fluid sim active"); return; }
    const projected = projectFluidSim(sim);
    const { width, height } = sim.dims;
    const lines: string[] = [];
    for (let y = 0; y < height; y++) {
      let row = "";
      for (let x = 0; x < width; x++) {
        const cell = projected[x][y];
        row += cell ? (MATERIAL_GLYPHS[cell.material] ?? "?") : " ";
      }
      lines.push(row);
    }
    navigator.clipboard.writeText(lines.join("\n"));
    asciiBtn.textContent = "Copied!";
    setTimeout(() => { asciiBtn.textContent = "Copy ASCII"; }, 1500);
  });
  controls.appendChild(asciiBtn);

  const ctx = canvas.getContext("2d")!;
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
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    const sim = animator.getGlassFluidSim();
    if (!sim) {
      ctx.fillStyle = "#666";
      ctx.font = "14px monospace";
      ctx.fillText("No fluid sim active", WIDTH / 2 - 70, HEIGHT / 2);
    } else {
      renderSim(ctx, sim, cam, showForces);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
