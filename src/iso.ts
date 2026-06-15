// 3D voxel grid + projection for the fluid simulation. Containers (glass,
// bottle, grinder bowl, dish) are cylindrical or box-shaped and viewed
// straight-on at their widest cross-section: grid x = diameter (screen
// column), grid y = height above the table (screen row), grid z = depth into
// the screen. Projection is orthographic — for each (x, y) screen cell, the
// voxels at z=0 (closest to camera) .. depth-1 (farthest) are walked
// front-to-back and blended by opacity until fully covered, so a transparent
// voxel (e.g. ethanol) lets whatever is behind it (e.g. a seed fragment) show
// through, while an opaque one wins outright.

import { staticRole } from "./ascii-sprites";

export interface VoxelMaterial {
  // 0 = fully transparent (e.g. ethanol), 1 = fully opaque.
  opacity: number;
}

export interface Voxel<M extends string> {
  material: M;
}

export interface GridDims {
  width: number;
  height: number;
  depth: number;
}

// Dense [x][y][z] grid; empty cells are `null`.
export type Grid3D<M extends string> = Array<Array<Array<Voxel<M> | null>>>;

export function makeGrid3D<M extends string>(dims: GridDims): Grid3D<M> {
  const { width, height, depth } = dims;
  return Array.from({ length: width }, () =>
    Array.from({ length: height }, () => new Array<Voxel<M> | null>(depth).fill(null)),
  );
}

// The result of projecting one (x, y) column: the material that's most
// visible from the camera, or null if the column is empty/fully transparent.
export interface ProjectedCell<M extends string> {
  material: M;
}

// Walks z = 0 (front) .. depth - 1 (back) for column (x, y), blending by each
// voxel's opacity. The material contributing the most visible "weight"
// (opacity * fraction of the column not yet covered by nearer voxels) is
// returned. Stops early once accumulated coverage reaches 1 (a fully opaque
// voxel was found).
export function projectColumn<M extends string>(
  grid: Grid3D<M>,
  materials: Record<M, VoxelMaterial>,
  x: number,
  y: number,
): ProjectedCell<M> | null {
  const column = grid[x]?.[y];
  if (!column) return null;

  let coverage = 0;
  let winner: M | null = null;
  let winnerWeight = 0;
  for (const voxel of column) {
    if (!voxel) continue;
    const opacity = materials[voxel.material].opacity;
    const weight = opacity * (1 - coverage);
    if (weight > winnerWeight) {
      winnerWeight = weight;
      winner = voxel.material;
    }
    coverage += weight;
    if (coverage >= 1) break;
  }
  return winner === null ? null : { material: winner };
}

// Projects every (x, y) column of `grid` onto a 2D array of cells (or null
// for empty columns), ready to drive a glyph resolver per material.
export function projectGrid<M extends string>(
  grid: Grid3D<M>,
  materials: Record<M, VoxelMaterial>,
): Array<Array<ProjectedCell<M> | null>> {
  return grid.map((column, x) => column.map((_, y) => projectColumn(grid, materials, x, y)));
}

// The glyph drawn for each material a projected column can resolve to.
// Replaces the hardcoded `staticRole("~")` used for every liquid particle
// today — the sim's projected grid picks a role per cell based on what's
// actually visible there (ethanol vs. a seed fragment vs. residue, etc.).
const MATERIAL_GLYPHS: Record<string, string> = {
  ethanol: "~",
  water: "~",
  seedFragment: ".",
  barleyPowder: ".",
  residue: "@",
  steam: "*",
};

// The glyph role for a projected cell's material, or null for an empty
// column (no cell drawn). Unknown materials fall back to "?" via
// resolveGlyph's default, same as any other unregistered role.
export function liquidRole<M extends string>(cell: ProjectedCell<M> | null): string | null {
  if (cell === null) return null;
  const glyph = MATERIAL_GLYPHS[cell.material] ?? "?";
  return staticRole(glyph);
}
