// CLI debug tool: renders a sprite at a given rotation onto a small grid
// centered on its origin, for eyeballing how aspect-corrected rotation looks.
// Also supports dumping the full rendered grid for a step at rest, via the
// real Compositor/SceneAnimator, to check the actual on-screen layout.
//
// Usage:
//   npx tsx scripts/dump-sprite.ts sprite <grinder|blade> <rotation-deg>
//   npx tsx scripts/dump-sprite.ts grid <step-index 1-based>

import { Compositor, rasterizePolygon, resolveGlyph, rotateOffset, type Sprite } from "../src/ascii-compositor";
import { applyBladeRadius } from "../src/ascii-sprites";

function dumpSprite(sprite: Sprite, rotationDeg: number): void {
  const rotation = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const size = 24;
  const center = Math.floor(size / 2);
  const grid: string[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => "."));

  for (const cell of sprite.cells) {
    if (cell.alpha <= 0) continue;
    const { rx, ry } = rotateOffset(cell.dx, cell.dy, cos, sin);
    const col = center + Math.round(rx);
    const row = center + Math.round(ry);
    if (row < 0 || row >= size || col < 0 || col >= size) continue;
    grid[row][col] = resolveGlyph(rotation, cell);
  }

  if (sprite.polygon) {
    for (const { col: localCol, row: localRow, char } of rasterizePolygon(sprite.polygon, rotation)) {
      const col = center + localCol;
      const row = center + localRow;
      if (row < 0 || row >= size || col < 0 || col >= size) continue;
      grid[row][col] = char;
    }
  }

  console.log(`rotation = ${rotationDeg}deg (${rotation.toFixed(2)} rad)`);
  for (const row of grid) console.log(row.join(""));
}

// Renders the full grid for `step` (1-based) at rest, after its transition
// completes, using the real Compositor (mirroring its render() loop without
// the DOM) so glyph resolution and viewport panning match runtime exactly.
async function dumpGrid(stepIndex: number): Promise<void> {
  const { GRID_HEIGHT, GRID_WIDTH, PANE_WIDTH, SceneAnimator } = await import("../src/stahl-scene");

  const compositor = new Compositor(GRID_WIDTH, GRID_HEIGHT);
  const anim = new SceneAnimator(compositor);
  anim.runStepInstant(stepIndex);
  compositor.viewOffsetX = (stepIndex - 1) * PANE_WIDTH;

  const grid: string[][] = Array.from({ length: GRID_HEIGHT }, () => Array.from({ length: GRID_WIDTH }, () => " "));
  const objects = (compositor as unknown as { objects: Map<string, { x: number; y: number; z: number; rotation: number; visible: boolean; sprite: Sprite }> }).objects;
  const ordered = Array.from(objects.values())
    .filter((obj) => obj.visible)
    .sort((a, b) => a.z - b.z);

  for (const obj of ordered) {
    const cos = Math.cos(obj.rotation);
    const sin = Math.sin(obj.rotation);
    for (const cell of obj.sprite.cells) {
      if (cell.alpha <= 0) continue;
      const { rx, ry } = rotateOffset(cell.dx, cell.dy, cos, sin);
      const col = Math.round(obj.x - compositor.viewOffsetX + rx);
      const row = Math.round(obj.y + ry);
      if (row < 0 || row >= GRID_HEIGHT || col < 0 || col >= GRID_WIDTH) continue;
      grid[row][col] = resolveGlyph(obj.rotation, cell);
    }

    if (obj.sprite.polygon) {
      for (const { col: localCol, row: localRow, char } of rasterizePolygon(obj.sprite.polygon, obj.rotation, obj.sprite.polygonClosed ?? true)) {
        const col = Math.round(obj.x - compositor.viewOffsetX) + localCol;
        const row = Math.round(obj.y) + localRow;
        if (row < 0 || row >= GRID_HEIGHT || col < 0 || col >= GRID_WIDTH) continue;
        grid[row][col] = char;
      }
    }
  }

  for (const row of grid) console.log(row.map((c) => (c === " " ? "." : c)).join(""));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === "grid") {
    const stepIndex = Number(args[1]);
    if (!stepIndex) {
      console.error("Usage: npx tsx scripts/dump-sprite.ts grid <step-index 1-based>");
      process.exit(1);
    }
    await dumpGrid(stepIndex);
    return;
  }

  if (args[0] !== "sprite" || (args[1] !== "grinder" && args[1] !== "blade")) {
    console.error("Usage: npx tsx scripts/dump-sprite.ts sprite <grinder|blade> <rotation-deg>");
    console.error("       npx tsx scripts/dump-sprite.ts grid <step-index 1-based>");
    process.exit(1);
  }

  const { GRINDER_BLADE, GRINDER_BLADE_RADIUS, GRINDER_BODY } = await import("../src/stahl-scene");

  const deg = args[2] !== undefined ? Number(args[2]) : 0;
  if (args[1] === "blade") applyBladeRadius(GRINDER_BLADE, GRINDER_BLADE_RADIUS);
  dumpSprite(args[1] === "blade" ? GRINDER_BLADE : GRINDER_BODY, deg);
}

main();
