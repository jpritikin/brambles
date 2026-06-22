import { type GridDims, type ProjectedCell, type VoxelMaterial } from "./iso";

export interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  kind: "ethanol" | "powder";
}

export interface CylinderBounds {
  cx: number;
  cz: number;
  radius: number;
  yFloor: number;
}

export interface FluidSim {
  dims: GridDims;
  particles: Particle[];
  solid: Uint8Array;
  bounds?: CylinderBounds;
  viscosity: number;
  flipRatio: number;
  get powder(): Particle[];
}

export interface StirImpulse {
  cx: number;
  cz: number;
  cy: number;
  yRadius: number;
  radius: number;
  strength: number;
}

function idx(x: number, y: number, z: number, dims: GridDims): number {
  return (x * dims.height + y) * dims.depth + z;
}

function inBounds(x: number, y: number, z: number, dims: GridDims): boolean {
  return x >= 0 && x < dims.width && y >= 0 && y < dims.height && z >= 0 && z < dims.depth;
}

// --- Grid construction / rasterization (unchanged) ---

function rasterizeCylindrical(dims: GridDims, profile: Array<[number, number]>): Uint8Array {
  const solid = new Uint8Array(dims.width * dims.height * dims.depth);
  const cxGrid = (dims.width - 1) / 2;
  const czGrid = (dims.depth - 1) / 2;
  const maxGridRadius = Math.max(cxGrid, czGrid);
  const rightEdge: Array<{ profileY: number; radius: number }> = [];
  for (const [px, py] of profile) {
    if (px >= 0) rightEdge.push({ profileY: py, radius: px });
  }
  rightEdge.sort((a, b) => a.profileY - b.profileY);

  function radiusAtGridY(gy: number): number {
    if (rightEdge.length === 0) return 0;
    const profileYRange = { min: rightEdge[0].profileY, max: rightEdge[rightEdge.length - 1].profileY };
    const t = (profileYRange.max - profileYRange.min) > 0
      ? profileYRange.min + (gy / (dims.height - 1)) * (profileYRange.max - profileYRange.min)
      : rightEdge[0].profileY;
    for (let i = 0; i < rightEdge.length - 1; i++) {
      if (t >= rightEdge[i].profileY && t <= rightEdge[i + 1].profileY) {
        const frac = (t - rightEdge[i].profileY) / (rightEdge[i + 1].profileY - rightEdge[i].profileY);
        return rightEdge[i].radius + frac * (rightEdge[i + 1].radius - rightEdge[i].radius);
      }
    }
    return t <= rightEdge[0].profileY ? rightEdge[0].radius : rightEdge[rightEdge.length - 1].radius;
  }

  for (let gx = 0; gx < dims.width; gx++) {
    for (let gy = 0; gy < dims.height; gy++) {
      for (let gz = 0; gz < dims.depth; gz++) {
        const i = idx(gx, gy, gz, dims);
        if (gy === dims.height - 1) { solid[i] = 1; continue; }
        const dx = gx - cxGrid;
        const dz = gz - czGrid;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const profileRadius = radiusAtGridY(gy);
        const gridRadius = (profileRadius / Math.max(...profile.map(([px]) => Math.abs(px)))) * maxGridRadius;
        solid[i] = dist >= gridRadius ? 1 : 0;
      }
    }
  }
  return solid;
}

function rasterizeRectangular(dims: GridDims): Uint8Array {
  const solid = new Uint8Array(dims.width * dims.height * dims.depth);
  for (let gx = 0; gx < dims.width; gx++) {
    for (let gy = 0; gy < dims.height; gy++) {
      for (let gz = 0; gz < dims.depth; gz++) {
        const isWall = gx === 0 || gx === dims.width - 1
          || gy === dims.height - 1
          || gz === 0 || gz === dims.depth - 1;
        solid[idx(gx, gy, gz, dims)] = isWall ? 1 : 0;
      }
    }
  }
  return solid;
}

function createSimObject(dims: GridDims, particles: Particle[], solid: Uint8Array, bounds?: CylinderBounds): FluidSim {
  return {
    dims,
    particles,
    solid,
    bounds,
    viscosity: VISCOSITY,
    flipRatio: FLIP_RATIO,
    get powder(): Particle[] {
      return this.particles.filter(p => p.kind === "powder");
    },
  };
}

export interface CylinderSpec {
  radius: number;
  height: number;
}

export function makeFluidSim(spec: CylinderSpec, profile: Array<[number, number]>): FluidSim;
export function makeFluidSim(dims: GridDims): FluidSim;
export function makeFluidSim(specOrDims: CylinderSpec | GridDims, profile?: Array<[number, number]>): FluidSim {
  if ("radius" in specOrDims) {
    const side = specOrDims.radius * 2 + 1;
    const dims: GridDims = { width: side, height: specOrDims.height, depth: side };
    const center = specOrDims.radius;
    return createSimObject(
      dims, [],
      rasterizeCylindrical(dims, profile!),
      { cx: center, cz: center, radius: specOrDims.radius, yFloor: dims.height - 1 },
    );
  }
  const dims = specOrDims;
  return createSimObject(dims, [], rasterizeRectangular(dims));
}

export function fillFluidSim(sim: FluidSim, levelFraction: number): void {
  const { dims, solid } = sim;
  const cutoff = Math.floor(dims.height * levelFraction);
  const ethanol: Particle[] = sim.particles.filter(p => p.kind === "powder");
  for (let x = 0; x < dims.width; x++) {
    for (let y = 0; y < dims.height; y++) {
      for (let z = 0; z < dims.depth; z++) {
        const i = idx(x, y, z, dims);
        if (!solid[i] && y >= dims.height - cutoff) {
          ethanol.push({ x, y, z, vx: 0, vy: 0, vz: 0, kind: "ethanol" });
        }
      }
    }
  }
  sim.particles = ethanol;
}

export function seedFluidFromPositions(
  sim: FluidSim,
  positions: Array<[number, number]>,
  origin: { minX: number; minY: number; w: number; h: number },
): void {
  sim.particles = sim.particles.filter(p => p.kind !== "ethanol");
  const { dims } = sim;
  for (const [relX, relY] of positions) {
    const gx = Math.round(((relX - origin.minX) / origin.w) * (dims.width - 1));
    const gy = Math.round(((relY - origin.minY) / origin.h) * (dims.height - 1));
    if (gx < 0 || gx >= dims.width || gy < 0 || gy >= dims.height) continue;
    for (let gz = 0; gz < dims.depth; gz++) {
      const i = idx(gx, gy, gz, dims);
      if (!sim.solid[i]) sim.particles.push({ x: gx, y: gy, z: gz, vx: 0, vy: 0, vz: 0, kind: "ethanol" });
    }
  }
}

// --- MAC-grid Stable Fluids + FLIP ---

const GRAVITY = 9.0;
const POWDER_GRAVITY_EXTRA = 0.012;
const GS_ITERS = 50;
const FLIP_RATIO = 0.95;
const CFL_LIMIT = 0.5;
const MAX_SUBSTEPS = 4;
const DISPLACEMENT = 8.0;
const VISCOSITY = 0.14;

// MAC grid index helpers—each velocity component lives on cell faces
function vxIdx(i: number, j: number, k: number, W: number, H: number, D: number): number {
  return (i * H + j) * D + k;
}
function vyIdx(i: number, j: number, k: number, W: number, H: number, D: number): number {
  return (i * (H + 1) + j) * D + k;
}
function vzIdx(i: number, j: number, k: number, W: number, H: number, D: number): number {
  return (i * H + j) * (D + 1) + k;
}

function trilinearSplat(
  field: Float32Array, weight: Float32Array,
  px: number, py: number, pz: number, val: number,
  sizeI: number, sizeJ: number, sizeK: number,
  idxFn: (i: number, j: number, k: number, W: number, H: number, D: number) => number,
  W: number, H: number, D: number,
): void {
  const i0 = Math.floor(px), j0 = Math.floor(py), k0 = Math.floor(pz);
  const fi = px - i0, fj = py - j0, fk = pz - k0;
  for (let di = 0; di <= 1; di++) {
    for (let dj = 0; dj <= 1; dj++) {
      for (let dk = 0; dk <= 1; dk++) {
        const ii = i0 + di, jj = j0 + dj, kk = k0 + dk;
        if (ii < 0 || ii >= sizeI || jj < 0 || jj >= sizeJ || kk < 0 || kk >= sizeK) continue;
        const w = (di ? fi : 1 - fi) * (dj ? fj : 1 - fj) * (dk ? fk : 1 - fk);
        if (w > 0) {
          const idx = idxFn(ii, jj, kk, W, H, D);
          field[idx] += val * w;
          weight[idx] += w;
        }
      }
    }
  }
}

function trilinearSample(
  field: Float32Array,
  px: number, py: number, pz: number,
  sizeI: number, sizeJ: number, sizeK: number,
  idxFn: (i: number, j: number, k: number, W: number, H: number, D: number) => number,
  W: number, H: number, D: number,
): number {
  const i0 = Math.floor(px), j0 = Math.floor(py), k0 = Math.floor(pz);
  const fi = px - i0, fj = py - j0, fk = pz - k0;
  let val = 0;
  for (let di = 0; di <= 1; di++) {
    for (let dj = 0; dj <= 1; dj++) {
      for (let dk = 0; dk <= 1; dk++) {
        const ii = i0 + di, jj = j0 + dj, kk = k0 + dk;
        if (ii < 0 || ii >= sizeI || jj < 0 || jj >= sizeJ || kk < 0 || kk >= sizeK) continue;
        const w = (di ? fi : 1 - fi) * (dj ? fj : 1 - fj) * (dk ? fk : 1 - fk);
        if (w > 0) val += field[idxFn(ii, jj, kk, W, H, D)] * w;
      }
    }
  }
  return val;
}

function isSolid(x: number, y: number, z: number, solid: Uint8Array, dims: GridDims): boolean {
  // y<0 is above the grid = open air, not solid
  if (y < 0) return false;
  if (x < 0 || x >= dims.width || y >= dims.height || z < 0 || z >= dims.depth) return true;
  return solid[idx(x, y, z, dims)] !== 0;
}

function clampToBounds(p: Particle, sim: FluidSim): void {
  const { dims } = sim;
  if (sim.bounds) {
    const { cx, cz, radius, yFloor } = sim.bounds;
    let dx = p.x - cx, dz = p.z - cz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const maxR = radius - 0.5;
    if (dist > maxR && dist > 0) {
      p.x = cx + dx * maxR / dist;
      p.z = cz + dz * maxR / dist;
      const nd = Math.sqrt((p.x - cx) ** 2 + (p.z - cz) ** 2);
      if (nd > 0.01) {
        const wnx = (p.x - cx) / nd, wnz = (p.z - cz) / nd;
        const dot = p.vx * wnx + p.vz * wnz;
        if (dot > 0) { p.vx -= dot * wnx; p.vz -= dot * wnz; }
      }
    }
    if (p.y > yFloor - 0.5) { p.y = yFloor - 0.5; if (p.vy > 0) p.vy = 0; }
  } else {
    if (p.x < 0.5) { p.x = 0.5; if (p.vx < 0) p.vx = 0; }
    if (p.x > dims.width - 1.5) { p.x = dims.width - 1.5; if (p.vx > 0) p.vx = 0; }
    if (p.y > dims.height - 2.5) { p.y = dims.height - 2.5; if (p.vy > 0) p.vy = 0; }
    if (p.z < 0.5) { p.z = 0.5; if (p.vz < 0) p.vz = 0; }
    if (p.z > dims.depth - 1.5) { p.z = dims.depth - 1.5; if (p.vz > 0) p.vz = 0; }
  }
  if (p.y < -0.5) { p.y = -0.5; if (p.vy < 0) p.vy = 0; }
}

function buildSpatialHash(particles: Particle[], dims: GridDims): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (let pi = 0; pi < particles.length; pi++) {
    const p = particles[pi];
    const gx = Math.max(0, Math.min(dims.width - 1, Math.round(p.x)));
    const gy = Math.max(0, Math.min(dims.height - 1, Math.round(p.y)));
    const gz = Math.max(0, Math.min(dims.depth - 1, Math.round(p.z)));
    const ci = idx(gx, gy, gz, dims);
    let list = map.get(ci);
    if (!list) { list = []; map.set(ci, list); }
    list.push(pi);
  }
  return map;
}

export function stepFluid(sim: FluidSim, dt: number, stir: StirImpulse | null): void {
  const { dims, particles, solid } = sim;
  const W = dims.width, H = dims.height, D = dims.depth;
  const N = W * H * D;

  // CFL sub-stepping
  let maxSpeed = 0;
  for (const p of particles) {
    const s = Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(p.vz);
    if (s > maxSpeed) maxSpeed = s;
  }
  const dtCfl = CFL_LIMIT / Math.max(maxSpeed, 1e-6);
  const nSubsteps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / dtCfl)));
  const subDt = dt / nSubsteps;

  for (let sub = 0; sub < nSubsteps; sub++) {
    // 1. Particles → MAC grid
    const vxSize = (W + 1) * H * D;
    const vySize = W * (H + 1) * D;
    const vzSize = W * H * (D + 1);
    const macVx = new Float32Array(vxSize), macVxW = new Float32Array(vxSize);
    const macVy = new Float32Array(vySize), macVyW = new Float32Array(vySize);
    const macVz = new Float32Array(vzSize), macVzW = new Float32Array(vzSize);

    for (const p of particles) {
      // vx face at (i, j+0.5, k+0.5)—offset particle coords
      trilinearSplat(macVx, macVxW, p.x, p.y - 0.5, p.z - 0.5, p.vx,
        W + 1, H, D, vxIdx, W, H, D);
      trilinearSplat(macVy, macVyW, p.x - 0.5, p.y, p.z - 0.5, p.vy,
        W, H + 1, D, vyIdx, W, H, D);
      trilinearSplat(macVz, macVzW, p.x - 0.5, p.y - 0.5, p.z, p.vz,
        W, H, D + 1, vzIdx, W, H, D);
    }
    for (let i = 0; i < vxSize; i++) if (macVxW[i] > 0) macVx[i] /= macVxW[i];
    for (let i = 0; i < vySize; i++) if (macVyW[i] > 0) macVy[i] /= macVyW[i];
    for (let i = 0; i < vzSize; i++) if (macVzW[i] > 0) macVz[i] /= macVzW[i];

    const oldVx = new Float32Array(macVx);
    const oldVy = new Float32Array(macVy);
    const oldVz = new Float32Array(macVz);

    // 4. Fluid marking (column-based)—before forces so gravity knows which faces are fluid
    const fluid = new Uint8Array(N);
    const colTop = new Float32Array(W * D);
    colTop.fill(H);
    for (const p of particles) {
      const gx = Math.max(0, Math.min(W - 1, Math.round(p.x)));
      const gz = Math.max(0, Math.min(D - 1, Math.round(p.z)));
      const ci = gx * D + gz;
      if (p.y < colTop[ci]) colTop[ci] = p.y;
    }
    for (let x = 0; x < W; x++) {
      for (let z = 0; z < D; z++) {
        const top = colTop[x * D + z];
        if (top >= H) continue;
        for (let y = Math.max(0, Math.floor(top)); y < H; y++) {
          const i = idx(x, y, z, dims);
          if (!solid[i]) fluid[i] = 1;
        }
      }
    }

    // 2. Add forces—gravity on vy faces where at least one adjacent cell is fluid
    for (let i = 0; i < W; i++) {
      for (let j = 0; j <= H; j++) {
        for (let k = 0; k < D; k++) {
          const aboveFluid = j > 0 && fluid[idx(i, j - 1, k, dims)];
          const belowFluid = j < H && fluid[idx(i, j, k, dims)];
          if (aboveFluid || belowFluid) {
            macVy[vyIdx(i, j, k, W, H, D)] += GRAVITY * subDt;
          }
        }
      }
    }
    if (stir) {
      for (let i = 0; i <= W; i++) {
        for (let j = 0; j < H; j++) {
          for (let k = 0; k < D; k++) {
            const fx = i, fy = j + 0.5, fz = k + 0.5;
            const dx = fx - stir.cx, dz = fz - stir.cz;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist > 0.01 && dist <= stir.radius) {
              const yDist = Math.abs(fy - stir.cy);
              if (yDist <= stir.yRadius) {
                const falloff = (1 - dist / stir.radius) * (1 - yDist / stir.yRadius);
                macVx[vxIdx(i, j, k, W, H, D)] += (-dz / dist) * stir.strength * falloff * subDt;
              }
            }
          }
        }
      }
      for (let i = 0; i < W; i++) {
        for (let j = 0; j < H; j++) {
          for (let k = 0; k <= D; k++) {
            const fx = i + 0.5, fy = j + 0.5, fz = k;
            const dx = fx - stir.cx, dz = fz - stir.cz;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist > 0.01 && dist <= stir.radius) {
              const yDist = Math.abs(fy - stir.cy);
              if (yDist <= stir.yRadius) {
                const falloff = (1 - dist / stir.radius) * (1 - yDist / stir.yRadius);
                macVz[vzIdx(i, j, k, W, H, D)] += (dx / dist) * stir.strength * falloff * subDt;
              }
            }
          }
        }
      }
    }

    // 2b. Viscosity diffusion—blur each MAC velocity component toward neighbors
    {
      const nu = sim.viscosity * subDt;
      const tmpVx = new Float32Array(macVx);
      for (let i = 1; i < W; i++)
        for (let j = 0; j < H; j++)
          for (let k = 0; k < D; k++) {
            const ci = vxIdx(i, j, k, W, H, D);
            let sum = 0, n = 0;
            if (i > 0) { sum += tmpVx[vxIdx(i - 1, j, k, W, H, D)]; n++; }
            if (i < W) { sum += tmpVx[vxIdx(i + 1, j, k, W, H, D)]; n++; }
            if (j > 0) { sum += tmpVx[vxIdx(i, j - 1, k, W, H, D)]; n++; }
            if (j < H - 1) { sum += tmpVx[vxIdx(i, j + 1, k, W, H, D)]; n++; }
            if (k > 0) { sum += tmpVx[vxIdx(i, j, k - 1, W, H, D)]; n++; }
            if (k < D - 1) { sum += tmpVx[vxIdx(i, j, k + 1, W, H, D)]; n++; }
            macVx[ci] += nu * (sum / n - tmpVx[ci]);
          }
      const tmpVy = new Float32Array(macVy);
      for (let i = 0; i < W; i++)
        for (let j = 1; j < H; j++)
          for (let k = 0; k < D; k++) {
            const ci = vyIdx(i, j, k, W, H, D);
            let sum = 0, n = 0;
            if (i > 0) { sum += tmpVy[vyIdx(i - 1, j, k, W, H, D)]; n++; }
            if (i < W - 1) { sum += tmpVy[vyIdx(i + 1, j, k, W, H, D)]; n++; }
            if (j > 0) { sum += tmpVy[vyIdx(i, j - 1, k, W, H, D)]; n++; }
            if (j < H) { sum += tmpVy[vyIdx(i, j + 1, k, W, H, D)]; n++; }
            if (k > 0) { sum += tmpVy[vyIdx(i, j, k - 1, W, H, D)]; n++; }
            if (k < D - 1) { sum += tmpVy[vyIdx(i, j, k + 1, W, H, D)]; n++; }
            macVy[ci] += nu * (sum / n - tmpVy[ci]);
          }
      const tmpVz = new Float32Array(macVz);
      for (let i = 0; i < W; i++)
        for (let j = 0; j < H; j++)
          for (let k = 1; k < D; k++) {
            const ci = vzIdx(i, j, k, W, H, D);
            let sum = 0, n = 0;
            if (i > 0) { sum += tmpVz[vzIdx(i - 1, j, k, W, H, D)]; n++; }
            if (i < W - 1) { sum += tmpVz[vzIdx(i + 1, j, k, W, H, D)]; n++; }
            if (j > 0) { sum += tmpVz[vzIdx(i, j - 1, k, W, H, D)]; n++; }
            if (j < H - 1) { sum += tmpVz[vzIdx(i, j + 1, k, W, H, D)]; n++; }
            if (k > 0) { sum += tmpVz[vzIdx(i, j, k - 1, W, H, D)]; n++; }
            if (k < D) { sum += tmpVz[vzIdx(i, j, k + 1, W, H, D)]; n++; }
            macVz[ci] += nu * (sum / n - tmpVz[ci]);
          }
    }

    // 3. Enforce solid boundary velocities on MAC faces
    for (let i = 0; i <= W; i++)
      for (let j = 0; j < H; j++)
        for (let k = 0; k < D; k++)
          if (isSolid(i - 1, j, k, solid, dims) || isSolid(i, j, k, solid, dims))
            macVx[vxIdx(i, j, k, W, H, D)] = 0;
    for (let i = 0; i < W; i++)
      for (let j = 0; j <= H; j++)
        for (let k = 0; k < D; k++)
          if (isSolid(i, j - 1, k, solid, dims) || isSolid(i, j, k, solid, dims))
            macVy[vyIdx(i, j, k, W, H, D)] = 0;
    for (let i = 0; i < W; i++)
      for (let j = 0; j < H; j++)
        for (let k = 0; k <= D; k++)
          if (isSolid(i, j, k - 1, solid, dims) || isSolid(i, j, k, solid, dims))
            macVz[vzIdx(i, j, k, W, H, D)] = 0;

    // 5. Pressure projection (Gauss-Seidel)
    const div = new Float32Array(N);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        for (let z = 0; z < D; z++) {
          const i = idx(x, y, z, dims);
          if (!fluid[i]) continue;
          div[i] = macVx[vxIdx(x + 1, y, z, W, H, D)] - macVx[vxIdx(x, y, z, W, H, D)]
                  + macVy[vyIdx(x, y + 1, z, W, H, D)] - macVy[vyIdx(x, y, z, W, H, D)]
                  + macVz[vzIdx(x, y, z + 1, W, H, D)] - macVz[vzIdx(x, y, z, W, H, D)];
        }
      }
    }

    const pressure = new Float32Array(N);
    for (let iter = 0; iter < GS_ITERS; iter++) {
      for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) {
          for (let z = 0; z < D; z++) {
            const i = idx(x, y, z, dims);
            if (!fluid[i]) continue;
            let sum = 0, nFluid = 0;
            const neighbors: [number, number, number][] = [
              [x-1,y,z],[x+1,y,z],[x,y-1,z],[x,y+1,z],[x,y,z-1],[x,y,z+1]
            ];
            for (const [nx, ny, nz] of neighbors) {
              if (isSolid(nx, ny, nz, solid, dims)) continue;
              nFluid++;
              if (inBounds(nx, ny, nz, dims) && fluid[idx(nx, ny, nz, dims)])
                sum += pressure[idx(nx, ny, nz, dims)];
            }
            pressure[i] = nFluid > 0 ? (sum - div[i]) / nFluid : 0;
          }
        }
      }
      if (iter % 5 === 4) {
        let maxResidual = 0;
        for (let x = 0; x < W; x++) {
          for (let y = 0; y < H; y++) {
            for (let z = 0; z < D; z++) {
              const i = idx(x, y, z, dims);
              if (!fluid[i]) continue;
              let sum = 0, nFluid = 0;
              const neighbors: [number, number, number][] = [
                [x-1,y,z],[x+1,y,z],[x,y-1,z],[x,y+1,z],[x,y,z-1],[x,y,z+1]
              ];
              for (const [nx, ny, nz] of neighbors) {
                if (isSolid(nx, ny, nz, solid, dims)) continue;
                nFluid++;
                if (inBounds(nx, ny, nz, dims) && fluid[idx(nx, ny, nz, dims)])
                  sum += pressure[idx(nx, ny, nz, dims)];
              }
              const residual = nFluid > 0 ? Math.abs(nFluid * pressure[i] - sum + div[i]) : 0;
              if (residual > maxResidual) maxResidual = residual;
            }
          }
        }
        if (maxResidual < 1e-4) break;
      }
    }

    // Subtract pressure gradient from face velocities
    for (let i = 0; i <= W; i++) {
      for (let j = 0; j < H; j++) {
        for (let k = 0; k < D; k++) {
          const pRight = (i < W && fluid[idx(i, j, k, dims)]) ? pressure[idx(i, j, k, dims)] : 0;
          const pLeft = (i > 0 && fluid[idx(i - 1, j, k, dims)]) ? pressure[idx(i - 1, j, k, dims)] : 0;
          const leftFluid = i > 0 && !isSolid(i - 1, j, k, solid, dims) && fluid[idx(i - 1, j, k, dims)];
          const rightFluid = i < W && !isSolid(i, j, k, solid, dims) && fluid[idx(i, j, k, dims)];
          if (leftFluid || rightFluid)
            macVx[vxIdx(i, j, k, W, H, D)] -= pRight - pLeft;
        }
      }
    }
    for (let i = 0; i < W; i++) {
      for (let j = 0; j <= H; j++) {
        for (let k = 0; k < D; k++) {
          const pBelow = (j < H && fluid[idx(i, j, k, dims)]) ? pressure[idx(i, j, k, dims)] : 0;
          const pAbove = (j > 0 && fluid[idx(i, j - 1, k, dims)]) ? pressure[idx(i, j - 1, k, dims)] : 0;
          const aboveFluid = j > 0 && !isSolid(i, j - 1, k, solid, dims) && fluid[idx(i, j - 1, k, dims)];
          const belowFluid = j < H && !isSolid(i, j, k, solid, dims) && fluid[idx(i, j, k, dims)];
          if (aboveFluid || belowFluid)
            macVy[vyIdx(i, j, k, W, H, D)] -= pBelow - pAbove;
        }
      }
    }
    for (let i = 0; i < W; i++) {
      for (let j = 0; j < H; j++) {
        for (let k = 0; k <= D; k++) {
          const pFront = (k < D && fluid[idx(i, j, k, dims)]) ? pressure[idx(i, j, k, dims)] : 0;
          const pBack = (k > 0 && fluid[idx(i, j, k - 1, dims)]) ? pressure[idx(i, j, k - 1, dims)] : 0;
          const backFluid = k > 0 && !isSolid(i, j, k - 1, solid, dims) && fluid[idx(i, j, k - 1, dims)];
          const frontFluid = k < D && !isSolid(i, j, k, solid, dims) && fluid[idx(i, j, k, dims)];
          if (backFluid || frontFluid)
            macVz[vzIdx(i, j, k, W, H, D)] -= pFront - pBack;
        }
      }
    }

    // 6. Re-enforce solid boundary
    for (let i = 0; i <= W; i++)
      for (let j = 0; j < H; j++)
        for (let k = 0; k < D; k++)
          if (isSolid(i - 1, j, k, solid, dims) || isSolid(i, j, k, solid, dims))
            macVx[vxIdx(i, j, k, W, H, D)] = 0;
    for (let i = 0; i < W; i++)
      for (let j = 0; j <= H; j++)
        for (let k = 0; k < D; k++)
          if (isSolid(i, j - 1, k, solid, dims) || isSolid(i, j, k, solid, dims))
            macVy[vyIdx(i, j, k, W, H, D)] = 0;
    for (let i = 0; i < W; i++)
      for (let j = 0; j < H; j++)
        for (let k = 0; k <= D; k++)
          if (isSolid(i, j, k - 1, solid, dims) || isSolid(i, j, k, solid, dims))
            macVz[vzIdx(i, j, k, W, H, D)] = 0;

    // 7. Grid → Particles (FLIP/PIC blend)
    for (const p of particles) {
      const newVx = trilinearSample(macVx, p.x, p.y - 0.5, p.z - 0.5, W + 1, H, D, vxIdx, W, H, D);
      const newVy = trilinearSample(macVy, p.x - 0.5, p.y, p.z - 0.5, W, H + 1, D, vyIdx, W, H, D);
      const newVz = trilinearSample(macVz, p.x - 0.5, p.y - 0.5, p.z, W, H, D + 1, vzIdx, W, H, D);
      const oVx = trilinearSample(oldVx, p.x, p.y - 0.5, p.z - 0.5, W + 1, H, D, vxIdx, W, H, D);
      const oVy = trilinearSample(oldVy, p.x - 0.5, p.y, p.z - 0.5, W, H + 1, D, vyIdx, W, H, D);
      const oVz = trilinearSample(oldVz, p.x - 0.5, p.y - 0.5, p.z, W, H, D + 1, vzIdx, W, H, D);
      const flipVx = p.vx + (newVx - oVx);
      const flipVy = p.vy + (newVy - oVy);
      const flipVz = p.vz + (newVz - oVz);
      const fr = sim.flipRatio;
      p.vx = fr * flipVx + (1 - fr) * newVx;
      p.vy = fr * flipVy + (1 - fr) * newVy;
      p.vz = fr * flipVz + (1 - fr) * newVz;
      if (p.kind === "powder") p.vy += POWDER_GRAVITY_EXTRA * subDt;
    }

    // 9. Advect particles
    for (const p of particles) {
      p.x += p.vx * subDt;
      p.y += p.vy * subDt;
      p.z += p.vz * subDt;
      clampToBounds(p, sim);
    }
  }

  // 8. Powder/ethanol displacement (grid-accelerated, once per outer step)
  const hasPowder = particles.some(p => p.kind === "powder");
  if (hasPowder) {
    const hash1 = buildSpatialHash(particles, dims);
    for (let pi = 0; pi < particles.length; pi++) {
      const pa = particles[pi];
      if (pa.kind !== "powder") continue;
      const gx = Math.max(0, Math.min(dims.width - 1, Math.round(pa.x)));
      const gy = Math.max(0, Math.min(dims.height - 1, Math.round(pa.y)));
      const gz = Math.max(0, Math.min(dims.depth - 1, Math.round(pa.z)));
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const nx = gx + dx, ny = gy + dy, nz = gz + dz;
            if (!inBounds(nx, ny, nz, dims)) continue;
            const list = hash1.get(idx(nx, ny, nz, dims));
            if (!list) continue;
            for (const qi of list) {
              const pb = particles[qi];
              if (pb.kind !== "ethanol") continue;
              const ddx = pa.x - pb.x, ddy = pa.y - pb.y, ddz = pa.z - pb.z;
              const distSq = ddx * ddx + ddy * ddy + ddz * ddz;
              if (distSq > 2.25) continue;
              if (ddy <= 0.5) {
                pb.vy -= DISPLACEMENT * dt;
                pa.vy += DISPLACEMENT * dt * 0.3;
              }
            }
          }
        }
      }
    }
  }

  // 10. Particle separation (27-neighbor spatial hash)
  const hash2 = buildSpatialHash(particles, dims);
  for (let pi = 0; pi < particles.length; pi++) {
    const pa = particles[pi];
    const gx = Math.max(0, Math.min(dims.width - 1, Math.round(pa.x)));
    const gy = Math.max(0, Math.min(dims.height - 1, Math.round(pa.y)));
    const gz = Math.max(0, Math.min(dims.depth - 1, Math.round(pa.z)));
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const nx = gx + dx, ny = gy + dy, nz = gz + dz;
          if (!inBounds(nx, ny, nz, dims)) continue;
          const list = hash2.get(idx(nx, ny, nz, dims));
          if (!list) continue;
          for (const qi of list) {
            if (qi <= pi) continue;
            const pb = particles[qi];
            let sdx = pa.x - pb.x, sdy = pa.y - pb.y, sdz = pa.z - pb.z;
            let distSq = sdx * sdx + sdy * sdy + sdz * sdz;
            if (distSq < 0.8) {
              if (distSq < 0.001) {
                const angle = Math.random() * Math.PI * 2;
                sdx = Math.cos(angle) * 0.01;
                sdz = Math.sin(angle) * 0.01;
                sdy = 0;
                distSq = sdx * sdx + sdz * sdz;
              }
              const dist = Math.sqrt(distSq);
              const push = (0.8 - dist) * 0.4;
              const mx = sdx / dist * push, my = sdy / dist * push, mz = sdz / dist * push;
              pa.x += mx; pa.y += my; pa.z += mz;
              pb.x -= mx; pb.y -= my; pb.z -= mz;
            }
          }
        }
      }
    }
  }

  for (const p of particles) clampToBounds(p, sim);
}

// --- Projection & utilities (unchanged) ---

type FluidMaterial = "ethanol" | "powder";
const FLUID_MATERIALS: Record<FluidMaterial, VoxelMaterial> = {
  ethanol: { opacity: 1 },
  powder: { opacity: 1 },
};

export function projectFluidSim(sim: FluidSim): Array<Array<ProjectedCell<FluidMaterial> | null>> {
  const { dims } = sim;
  const centerZ = Math.floor(dims.depth / 2);
  const result: Array<Array<ProjectedCell<FluidMaterial> | null>> = [];
  for (let x = 0; x < dims.width; x++) {
    const col: Array<ProjectedCell<FluidMaterial> | null> = new Array(dims.height).fill(null);
    result.push(col);
  }
  for (const p of sim.particles) {
    const gx = Math.round(p.x), gy = Math.round(p.y), gz = Math.round(p.z);
    if (gz === centerZ && inBounds(gx, gy, gz, dims)) {
      result[gx][gy] = { material: p.kind };
    }
  }
  return result;
}


export function seedPowderAtBottom(sim: FluidSim, count: number): void {
  const { dims, solid } = sim;
  const candidates: Array<{ x: number; y: number; z: number }> = [];
  for (let gx = 0; gx < dims.width; gx++) {
    for (let gy = dims.height - 1; gy >= 0; gy--) {
      let found = false;
      for (let gz = 0; gz < dims.depth; gz++) {
        const i = idx(gx, gy, gz, dims);
        if (!solid[i]) { candidates.push({ x: gx, y: gy, z: gz }); found = true; }
      }
      if (found) break;
    }
  }
  const step = Math.max(1, Math.floor(candidates.length / count));
  let added = 0;
  for (let i = 0; i < candidates.length && added < count; i += step) {
    const c = candidates[i];
    sim.particles.push({ x: c.x, y: c.y, z: c.z, vx: 0, vy: 0, vz: 0, kind: "powder" });
    added++;
  }
}

export function gridToRel(
  gx: number, gy: number,
  dims: GridDims,
  origin: { minX: number; minY: number; w: number; h: number },
): [number, number] {
  const relX = origin.minX + (gx + 0.5) * origin.w / dims.width;
  const relY = origin.minY + (gy + 0.5) * origin.h / dims.height;
  return [relX, relY];
}

export function interiorBounds(polygon: Array<[number, number]>, margin: number): { minX: number; minY: number; w: number; h: number } {
  const xs = polygon.map(([x]) => x);
  const ys = polygon.map(([, y]) => y);
  const minX = Math.min(...xs) + margin;
  const minY = Math.min(...ys) + margin;
  const w = Math.max(...xs) - Math.min(...xs) - 2 * margin;
  const h = Math.max(...ys) - Math.min(...ys) - 2 * margin;
  return { minX, minY, w, h };
}
