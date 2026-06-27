// Sanity checks for src/fluid-sim.ts. Run with `npx tsx scripts/check-fluid-sim.ts`;
// exits non-zero on failure. Silent on success.

import { makeFluidSim, fillFluidSim, stepFluid, projectFluidSim, type FluidSim, type ParticleKind } from "../src/fluid-sim";

interface Failure { test: string; label: string; detail: string }
const failures: Failure[] = [];
let currentTest = "";

function assert(condition: boolean, label: string, detail = ""): void {
  if (!condition) failures.push({ test: currentTest, label, detail });
}

function particleCount(sim: FluidSim, kind?: ParticleKind): number {
  return kind ? sim.particles.filter(p => p.kind === kind).length : sim.particles.length;
}

function centerOfMassY(sim: FluidSim, kind?: ParticleKind): number {
  let sum = 0, count = 0;
  for (const p of sim.particles) {
    if (kind && p.kind !== kind) continue;
    sum += p.y;
    count++;
  }
  return count > 0 ? sum / count : 0;
}

function surfaceHeights(sim: FluidSim): number[][] {
  const { width, height, depth } = sim.dims;
  const grid: number[][] = [];
  for (let x = 0; x < width; x++) {
    const row: number[] = [];
    for (let z = 0; z < depth; z++) row.push(-1);
    grid.push(row);
  }
  for (const p of sim.particles) {
    if (p.kind !== "ethanol") continue;
    const gx = Math.round(p.x), gz = Math.round(p.z);
    if (gx < 0 || gx >= width || gz < 0 || gz >= depth) continue;
    const h = (height - 1) - p.y;
    if (h > grid[gx][gz]) grid[gx][gz] = h;
  }
  return grid;
}

function dumpSurface(sim: FluidSim): string {
  const { width } = sim.dims;
  const heights = surfaceHeights(sim);
  const lines: string[] = [];
  for (let x = 0; x < width; x++) {
    const row = heights[x].map(h => h < 0 ? "  .  " : h.toFixed(1).padStart(5));
    lines.push(`x=${String(x).padStart(2)}: ${row.join(" ")}`);
  }
  return lines.join("\n");
}

const dims = { width: 8, height: 6, depth: 4 };
const dt = 0.016;

// --- Gravity & basic mechanics ---

currentTest = "single particle falls to floor";
{
  const sim = makeFluidSim(dims);
  sim.particles.push({ x: 3, y: 0, z: 2, vx: 0, vy: 0, vz: 0, kind: "ethanol" });
  const n0 = particleCount(sim);
  for (let step = 0; step < 200; step++) stepFluid(sim, dt, null);
  assert(particleCount(sim) === n0, "particle count preserved");
  const p = sim.particles[0];
  assert(p.y > dims.height - 3, "particle settled near floor",
    `y=${p.y.toFixed(2)}, floor at y=${dims.height - 2}`);
}

currentTest = "center of mass falls";
{
  const sim = makeFluidSim(dims);
  for (let x = 1; x < dims.width - 1; x++)
    for (let z = 1; z < dims.depth - 1; z++)
      sim.particles.push({ x, y: 1, z, vx: 0, vy: 0, vz: 0, kind: "ethanol" });
  const comY0 = centerOfMassY(sim);
  for (let i = 0; i < 50; i++) stepFluid(sim, dt, null);
  const comY1 = centerOfMassY(sim);
  assert(comY1 >= comY0, "center of mass falls",
    `comY: ${comY0.toFixed(2)} -> ${comY1.toFixed(2)}`);
}

currentTest = "co-located particles separate";
{
  const sim = makeFluidSim(dims);
  sim.particles.push({ x: 3, y: 3, z: 2, vx: 0, vy: 0, vz: 0, kind: "ethanol" });
  sim.particles.push({ x: 3, y: 3, z: 2, vx: 0, vy: 0, vz: 0, kind: "ethanol" });
  stepFluid(sim, dt, null);
  const [a, b] = sim.particles;
  const dist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
  assert(dist > 0.001, "co-located particles separate",
    `separation after 1 step: ${dist.toFixed(4)}`);
}

// --- Pressure solve correctness ---

currentTest = "divergence-free after projection";
{
  const sim = makeFluidSim(dims);
  fillFluidSim(sim, 0.5);
  for (let i = 0; i < 50; i++) stepFluid(sim, dt, null);
  // Measure divergence from particle velocities splatted to grid.
  // A correct pressure solve should leave the velocity field nearly divergence-free.
  const { width, height, depth } = dims;
  const N = width * height * depth;
  const gvx = new Float32Array(N), gvy = new Float32Array(N), gvz = new Float32Array(N);
  const gw = new Float32Array(N);
  for (const p of sim.particles) {
    const x0 = Math.floor(p.x), y0 = Math.floor(p.y), z0 = Math.floor(p.z);
    const fx = p.x - x0, fy = p.y - y0, fz = p.z - z0;
    for (let dx = 0; dx <= 1; dx++) {
      for (let dy = 0; dy <= 1; dy++) {
        for (let dz = 0; dz <= 1; dz++) {
          const ix = x0 + dx, iy = y0 + dy, iz = z0 + dz;
          if (ix < 0 || ix >= width || iy < 0 || iy >= height || iz < 0 || iz >= depth) continue;
          const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
          if (w > 0) {
            const i = (ix * height + iy) * depth + iz;
            gvx[i] += p.vx * w; gvy[i] += p.vy * w; gvz[i] += p.vz * w;
            gw[i] += w;
          }
        }
      }
    }
  }
  for (let i = 0; i < N; i++) {
    if (gw[i] > 0) { gvx[i] /= gw[i]; gvy[i] /= gw[i]; gvz[i] /= gw[i]; }
  }
  let maxDiv = 0;
  for (let x = 1; x < width - 1; x++) {
    for (let y = 1; y < height - 1; y++) {
      for (let z = 1; z < depth - 1; z++) {
        const i = (x * height + y) * depth + z;
        if (sim.solid[i]) continue;
        if (gw[i] === 0) continue;
        const div = (gvx[((x+1) * height + y) * depth + z] - gvx[((x-1) * height + y) * depth + z]
          + gvy[(x * height + y+1) * depth + z] - gvy[(x * height + y-1) * depth + z]
          + gvz[(x * height + y) * depth + z+1] - gvz[(x * height + y) * depth + z-1]) * 0.5;
        maxDiv = Math.max(maxDiv, Math.abs(div));
      }
    }
  }
  assert(maxDiv < 0.1, "velocity field nearly divergence-free",
    `max |div| = ${maxDiv.toFixed(4)}`);
}

currentTest = "flat fill stays flat";
{
  const sim = makeFluidSim(dims);
  fillFluidSim(sim, 0.5);
  const n0 = particleCount(sim, "ethanol");
  for (let i = 0; i < 200; i++) stepFluid(sim, dt, null);
  assert(particleCount(sim, "ethanol") === n0, "particle count preserved");
  const heights = surfaceHeights(sim);
  const interiorH: number[] = [];
  for (let x = 0; x < dims.width; x++)
    for (let z = 0; z < dims.depth; z++)
      if (heights[x][z] >= 0) interiorH.push(heights[x][z]);
  const hMin = Math.min(...interiorH), hMax = Math.max(...interiorH);
  assert(hMax - hMin < 1.0, "surface stays flat",
    `spread ${(hMax - hMin).toFixed(1)}, surface:\n${dumpSurface(sim)}`);
}

currentTest = "asymmetric fill settles flat";
{
  const sim = makeFluidSim(dims);
  for (let x = 0; x < dims.width / 2; x++)
    for (let y = 0; y < dims.height; y++)
      for (let z = 0; z < dims.depth; z++) {
        const i = (x * dims.height + y) * dims.depth + z;
        if (!sim.solid[i])
          sim.particles.push({ x, y, z, vx: 0, vy: 0, vz: 0, kind: "ethanol" });
      }
  const n0 = particleCount(sim, "ethanol");
  for (let i = 0; i < 1000; i++) stepFluid(sim, dt, null);
  assert(particleCount(sim, "ethanol") === n0, "particle count preserved");
  const heights = surfaceHeights(sim);
  const interiorH: number[] = [];
  for (let x = 0; x < dims.width; x++)
    for (let z = 0; z < dims.depth; z++)
      if (heights[x][z] >= 0) interiorH.push(heights[x][z]);
  if (interiorH.length > 0) {
    const hMin = Math.min(...interiorH), hMax = Math.max(...interiorH);
    assert(hMax - hMin < 3.5, "surface settles flat",
      `spread ${(hMax - hMin).toFixed(1)}, surface:\n${dumpSurface(sim)}`);
  }
}

currentTest = "incompressible column";
{
  const spec = { radius: 3, height: 12 };
  const profile: Array<[number, number]> = [[-3, -6], [-3, 6], [3, 6], [3, -6]];
  const sim = makeFluidSim(spec, profile);
  fillFluidSim(sim, 0.8);
  const n0 = particleCount(sim, "ethanol");
  for (let i = 0; i < 500; i++) stepFluid(sim, dt, null);
  assert(particleCount(sim, "ethanol") === n0, "particle count preserved");
  let minY = sim.dims.height, maxY = 0;
  for (const p of sim.particles) {
    if (p.kind !== "ethanol") continue;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const span = maxY - minY;
  assert(span > 3.0, "liquid spans vertically",
    `span=${span.toFixed(1)}, y range: ${minY.toFixed(1)}-${maxY.toFixed(1)}`);
}

currentTest = "no floor pileup";
{
  const spec = { radius: 3, height: 12 };
  const profile: Array<[number, number]> = [[-3, -6], [-3, 6], [3, 6], [3, -6]];
  const sim = makeFluidSim(spec, profile);
  fillFluidSim(sim, 0.8);
  for (let i = 0; i < 500; i++) stepFluid(sim, dt, null);
  const floorY = sim.dims.height - 1;
  let bottomCount = 0, total = 0;
  for (const p of sim.particles) {
    if (p.kind !== "ethanol") continue;
    total++;
    if (p.y > floorY - 2) bottomCount++;
  }
  const bottomFrac = total > 0 ? bottomCount / total : 0;
  assert(bottomFrac < 0.5, "particles distributed, not piled at floor",
    `${(bottomFrac * 100).toFixed(0)}% in bottom 2 cells (${bottomCount}/${total})`);
}

// --- Boundary enforcement ---

currentTest = "rectangular containment";
{
  const sim = makeFluidSim(dims);
  fillFluidSim(sim, 0.7);
  const stir = { cx: dims.width / 2, cz: dims.depth / 2, cy: dims.height - 2, yRadius: 3, radius: 3, strength: 30 };
  for (let i = 0; i < 200; i++) stepFluid(sim, dt, stir);
  for (let i = 0; i < 100; i++) stepFluid(sim, dt, null);
  let escaped = 0;
  for (const p of sim.particles) {
    if (p.x < -0.5 || p.x > dims.width - 0.5 ||
        p.y < -1.0 || p.y > dims.height - 0.5 ||
        p.z < -0.5 || p.z > dims.depth - 0.5) escaped++;
  }
  assert(escaped === 0, "no particles escape container",
    `escaped: ${escaped} / ${sim.particles.length}`);
}

currentTest = "cylindrical containment";
{
  const spec = { radius: 4, height: 8 };
  const profile: Array<[number, number]> = [[-4, -4], [-4, 4], [4, 4], [4, -4]];
  const sim = makeFluidSim(spec, profile);
  fillFluidSim(sim, 0.6);
  const stir = { cx: sim.bounds!.cx, cz: sim.bounds!.cz, cy: sim.dims.height - 3, yRadius: 3, radius: 3, strength: 25 };
  for (let i = 0; i < 200; i++) stepFluid(sim, dt, stir);
  let escaped = 0;
  const { cx, cz, radius } = sim.bounds!;
  for (const p of sim.particles) {
    const dx = p.x - cx, dz = p.z - cz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > radius + 0.5 || p.y < -1.0 || p.y > sim.dims.height - 0.5) escaped++;
  }
  assert(escaped === 0, "no particles escape container",
    `escaped: ${escaped} / ${sim.particles.length}`);
}

currentTest = "CFL sub-stepping under extreme velocity";
{
  const sim = makeFluidSim(dims);
  sim.particles.push({ x: 3, y: 3, z: 2, vx: 20, vy: 0, vz: -15, kind: "ethanol" });
  sim.particles.push({ x: 4, y: 2, z: 1, vx: -10, vy: 20, vz: 10, kind: "ethanol" });
  stepFluid(sim, dt, null);
  let escaped = 0;
  for (const p of sim.particles) {
    if (p.x < -0.5 || p.x > dims.width - 0.5 ||
        p.y < -1.0 || p.y > dims.height - 0.5 ||
        p.z < -0.5 || p.z > dims.depth - 0.5) escaped++;
  }
  assert(escaped === 0, "high-velocity particles stay inside bounds",
    `escaped: ${escaped} / ${sim.particles.length}`);
}

// --- Stirring & dissipation ---

currentTest = "stirring produces circulation";
{
  const sim = makeFluidSim(dims);
  fillFluidSim(sim, 0.7);
  const stir = { cx: dims.width / 2, cz: dims.depth / 2, cy: dims.height - 2, yRadius: 3, radius: 3, strength: 20 };
  for (let i = 0; i < 20; i++) stepFluid(sim, dt, stir);
  let totalVxz = 0;
  for (const p of sim.particles) totalVxz += Math.abs(p.vx) + Math.abs(p.vz);
  assert(totalVxz > 0.1, "particles develop horizontal velocity",
    `total |vx|+|vz|: ${totalVxz.toFixed(2)}`);
}

currentTest = "stir propagates full radius";
{
  const spec = { radius: 4, height: 8 };
  const profile: Array<[number, number]> = [[-4, -4], [-4, 4], [4, 4], [4, -4]];
  const sim = makeFluidSim(spec, profile);
  fillFluidSim(sim, 0.7);
  const { cx: scx, cz: scz } = sim.bounds!;
  const stir = { cx: scx, cz: scz, cy: sim.dims.height - 3, yRadius: 3, radius: 3, strength: 25 };
  for (let i = 0; i < 100; i++) stepFluid(sim, dt, stir);
  const outerThreshold = sim.bounds!.radius * 0.7;
  let outerMoving = 0, outerTotal = 0;
  for (const p of sim.particles) {
    const dx = p.x - scx, dz = p.z - scz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist >= outerThreshold) {
      outerTotal++;
      if (Math.abs(p.vx) + Math.abs(p.vz) > 0.01) outerMoving++;
    }
  }
  const movingFrac = outerTotal > 0 ? outerMoving / outerTotal : 0;
  assert(movingFrac > 0.3, "stir reaches outer particles",
    `${(movingFrac * 100).toFixed(0)}% of outer particles moving (${outerMoving}/${outerTotal})`);
}

currentTest = "velocity decays at rest";
{
  const sim = makeFluidSim(dims);
  fillFluidSim(sim, 0.5);
  const stir = { cx: dims.width / 2, cz: dims.depth / 2, cy: dims.height - 2, yRadius: 3, radius: 3, strength: 20 };
  for (let i = 0; i < 30; i++) stepFluid(sim, dt, stir);
  let maxV0 = 0;
  for (const p of sim.particles) maxV0 = Math.max(maxV0, Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(p.vz));
  assert(maxV0 > 0.1, "particles moving after stir");
  for (let i = 0; i < 500; i++) stepFluid(sim, dt, null);
  let maxV1 = 0;
  for (const p of sim.particles) maxV1 = Math.max(maxV1, Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(p.vz));
  assert(maxV1 < maxV0 * 0.25, "velocity decays after settling",
    `maxV after stir: ${maxV0.toFixed(2)}, after settling: ${maxV1.toFixed(2)}`);
}

// --- Powder / multi-material ---

currentTest = "powder settles to floor";
{
  const sim = makeFluidSim(dims);
  fillFluidSim(sim, 0.6);
  for (let x = 2; x < dims.width - 2; x++)
    sim.particles.push({ x, y: 1, z: 2, vx: 0, vy: 0, vz: 0, kind: "powder" });
  const floorY = dims.height - 2.5;
  for (let i = 0; i < 500; i++) stepFluid(sim, dt, null);
  let maxPowderY = -Infinity;
  for (const p of sim.particles)
    if (p.kind === "powder" && p.y > maxPowderY) maxPowderY = p.y;
  assert(maxPowderY >= floorY - 1, "powder reaches floor",
    `deepest powder y: ${maxPowderY.toFixed(2)}, floor at y ~${floorY.toFixed(1)}`);
}

currentTest = "powder separates from ethanol";
{
  const sim = makeFluidSim(dims);
  fillFluidSim(sim, 0.7);
  let idx2 = 0;
  for (const p of [...sim.particles]) {
    if (p.kind === "ethanol" && (idx2++ % 4 === 0))
      sim.particles.push({ x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, kind: "powder" });
  }
  const powderComY0 = centerOfMassY(sim, "powder");
  for (let i = 0; i < 2000; i++) stepFluid(sim, dt, null);
  const powderComY1 = centerOfMassY(sim, "powder");
  const ethanolComY1 = centerOfMassY(sim, "ethanol");
  assert(powderComY1 > ethanolComY1, "powder below ethanol",
    `ethanol comY=${ethanolComY1.toFixed(2)}, powder comY=${powderComY1.toFixed(2)}`);
}

// --- Projection ---

currentTest = "projection produces cells";
{
  const sim = makeFluidSim(dims);
  fillFluidSim(sim, 0.6);
  const projected = projectFluidSim(sim);
  let filledCells = 0;
  for (const col of projected) for (const cell of col) if (cell) filledCells++;
  assert(filledCells > 0, "projectFluidSim produces non-null cells",
    `filledCells=${filledCells}`);
}

if (failures.length > 0) {
  console.log(`${failures.length} check(s) FAILED:\n`);
  for (const f of failures) {
    console.log(`  [${f.test}] ${f.label}`);
    if (f.detail) console.log(`    ${f.detail}`);
  }
  process.exit(1);
}
console.log("all checks passed");
