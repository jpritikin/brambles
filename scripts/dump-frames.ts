// Dumps frame-by-frame ASCII for a step's transition.
//
// Usage:
//   npx tsx scripts/dump-frames.ts [--seed=<n>] <step-index> [every-ms] [max-frames]
//
// Outputs one ASCII grid per sampled frame with elapsed time header.

import { Compositor, rasterizePolygon, resolveGlyph, rotateOffset, type Sprite } from "../src/ascii-compositor";
import { setSeed } from "../src/rng";

function renderGrid(compositor: Compositor, width: number, height: number): string[] {
    const grid: string[][] = Array.from({ length: height }, () => Array(width).fill(" "));
    const objects = (compositor as unknown as {
        objects: Map<string, {
            id: string; x: number; y: number; z: number;
            rotation: number; visible: boolean; sprite: Sprite;
        }>
    }).objects;
    const ordered = Array.from(objects.values())
        .filter((obj) => obj.visible)
        .sort((a, b) => a.z - b.z);

    for (const obj of ordered) {
        const cos = Math.cos(obj.rotation);
        const sin = Math.sin(obj.rotation);
        const pivot = (obj.sprite as { pivot?: [number, number] }).pivot ?? [0, 0];
        for (const cell of obj.sprite.cells) {
            if (cell.alpha <= 0) continue;
            const { rx, ry } = rotateOffset(cell.dx - pivot[0], cell.dy - pivot[1], cos, sin);
            const col = Math.round(obj.x - compositor.viewOffsetX + pivot[0] + rx);
            const row = Math.round(obj.y + pivot[1] + ry);
            if (row < 0 || row >= height || col < 0 || col >= width) continue;
            grid[row][col] = resolveGlyph(obj.rotation, cell);
        }
        if (obj.sprite.polygon) {
            const closed = obj.sprite.polygonClosed ?? true;
            for (const { col: lc, row: lr, char } of rasterizePolygon(obj.sprite.polygon, obj.rotation, closed, pivot)) {
                const col = Math.round(obj.x - compositor.viewOffsetX + pivot[0]) + lc;
                const row = Math.round(obj.y + pivot[1]) + lr;
                if (row < 0 || row >= height || col < 0 || col >= width) continue;
                grid[row][col] = char;
            }
        }
    }
    return grid.map(row => row.map(c => c === " " ? "." : c).join(""));
}

async function main(): Promise<void> {
    const args = process.argv.slice(2).filter(arg => {
        const m = arg.match(/^--seed=(\d+)$/);
        if (m) setSeed(Number(m[1]));
        return !m;
    });

    const [stepArg, everyArg, maxArg] = args;
    if (!stepArg) {
        console.error("Usage: npx tsx scripts/dump-frames.ts [--seed=<n>] <step-index> [every-ms] [max-frames]");
        process.exit(1);
    }

    const { GRID_HEIGHT, GRID_WIDTH, PANE_WIDTH, SceneAnimator, STEPS } = await import("../src/stahl-scene");

    const index = Number(stepArg);
    const step = STEPS[index - 1];
    if (!step) {
        console.error(`No such step: ${index}`);
        process.exit(1);
    }

    const every = everyArg ? Number(everyArg) : 200;
    const maxFrames = maxArg ? Number(maxArg) : 100;

    const compositor = new Compositor(GRID_WIDTH, GRID_HEIGHT);
    const anim = new SceneAnimator(compositor);
    compositor.viewOffsetX = (index - 1) * PANE_WIDTH;

    let frameCount = 0;
    let lastLogged = -Infinity;
    anim.runStepInstant(index, (elapsed) => {
        if (frameCount >= maxFrames) return;
        if (elapsed - lastLogged < every && elapsed < step.transitionDuration) return;
        lastLogged = elapsed;
        frameCount++;
        const lines = renderGrid(compositor, GRID_WIDTH, GRID_HEIGHT);
        console.log(`\n=== t=${elapsed.toFixed(0)}ms (frame ${frameCount}) ===`);
        for (const line of lines) console.log(line);
    });

    console.log(`\nDone: ${frameCount} frames, transition duration=${step.transitionDuration}ms`);
}

main();
