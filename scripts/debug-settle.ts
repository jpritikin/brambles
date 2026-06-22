import { makeFluidSim, fillFluidSim, stepFluid, type FluidSim } from "../src/fluid-sim";
const dt = 0.016;
const spec = { radius: 8, height: 12 };
const profile: Array<[number, number]> = [[-8, -6], [-8, 6], [8, 6], [8, -6]];

// Test 1: settled height
console.log("=== Settled height ===");
{
  const sim = makeFluidSim(spec, profile);
  fillFluidSim(sim, 0.7);
  for (let i = 0; i < 300; i++) stepFluid(sim, dt, null);
  const yBins = new Map<number, number>();
  for (const p of sim.particles) {
    if (p.kind !== "ethanol") continue;
    const gy = Math.round(p.y);
    yBins.set(gy, (yBins.get(gy) || 0) + 1);
  }
  for (const [y, count] of [...yBins.entries()].sort((a, b) => a[0] - b[0]))
    console.log(`  y=${y}: ${count}`);
}

// Test 2: ring velocities
console.log("\n=== Ring velocities after 500 stir steps ===");
{
  const sim = makeFluidSim(spec, profile);
  fillFluidSim(sim, 0.7);
  const stir = { cx: sim.bounds!.cx, cz: sim.bounds!.cz, cy: sim.dims.height - 4, yRadius: 4, radius: 4, strength: 30 };
  for (let i = 0; i < 500; i++) stepFluid(sim, dt, stir);
  const { cx, cz } = sim.bounds!;
  const maxR = sim.bounds!.radius;
  const bins = 8, binWidth = maxR / bins;
  const tangential = new Float64Array(bins), count = new Float64Array(bins);
  for (const p of sim.particles) {
    const dx = p.x - cx, dz = p.z - cz;
    const r = Math.sqrt(dx * dx + dz * dz);
    if (r < 0.01) continue;
    const bin = Math.min(bins - 1, Math.floor(r / binWidth));
    tangential[bin] += Math.abs(-p.vx * (dz/r) + p.vz * (dx/r));
    count[bin]++;
  }
  for (let i = 0; i < bins; i++) {
    if (count[i] === 0) continue;
    console.log(`  r=${(i*binWidth).toFixed(0)}-${((i+1)*binWidth).toFixed(0)}: avg|vt|=${(tangential[i]/count[i]).toFixed(3)} (${count[i]} particles)`);
  }
}
