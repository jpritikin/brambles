// Sanity checks for src/iso.ts's voxel grid + occlusion projection. Run with
// `npx tsx scripts/check-iso.ts`; exits non-zero on the first failed
// assertion.

import { makeGrid3D, projectColumn, projectGrid, liquidRole, type VoxelMaterial } from "../src/iso";

type Material = "ethanol" | "seedFragment" | "residue";

const materials: Record<Material, VoxelMaterial> = {
  ethanol: { opacity: 0.2 },
  seedFragment: { opacity: 1 },
  residue: { opacity: 1 },
};

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
  console.log(`ok - ${label}`);
}

const grid = makeGrid3D<Material>({ width: 3, height: 1, depth: 3 });

// Column (0,0): empty.
// Column (1,0): transparent ethanol in front, seed fragment behind -> the
// fragment shows through.
grid[1][0][0] = { material: "ethanol" };
grid[1][0][1] = { material: "seedFragment" };
// Column (2,0): opaque seed fragment in front blocks the residue behind it.
grid[2][0][0] = { material: "seedFragment" };
grid[2][0][1] = { material: "residue" };

assertEqual(projectColumn(grid, materials, 0, 0), null, "empty column projects to null");
assertEqual(projectColumn(grid, materials, 1, 0), { material: "seedFragment" }, "transparent voxel lets the one behind it show through");
assertEqual(projectColumn(grid, materials, 2, 0), { material: "seedFragment" }, "opaque voxel blocks the one behind it");

const projected = projectGrid(grid, materials);
assertEqual(liquidRole(projected[0][0]), null, "liquidRole of an empty column is null");
assertEqual(liquidRole(projected[1][0]) === liquidRole(projected[2][0]), true, "seed fragments resolve to the same glyph role regardless of depth");

console.log("all checks passed");
