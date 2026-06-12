// CLI debug tool: traces the (x, y, z, rotation) of one or more scene objects
// across every frame of a step's transition, using the real SceneAnimator
// (via SceneAnimator.runStepInstant) so StepEffects (e.g. step 3's
// GlassFridgeArcEffect/CoverDropEffect) run exactly as they do at runtime —
// unlike dump-step.ts, which only replays transitionKeyframes.
//
// Usage: npx tsx scripts/trace-step.ts [--seed=<n>] <step-index 1-based> <object-id>[,<object-id>...] [every-ms]

import { Compositor } from "../src/ascii-compositor";
import { setSeed } from "../src/rng";

async function main(): Promise<void> {
    const args = process.argv.slice(2).filter((arg) => {
        const m = arg.match(/^--seed=(\d+)$/);
        if (m) setSeed(Number(m[1]));
        return !m;
    });

    const [stepArg, idsArg, everyArg] = args;
    if (!stepArg || !idsArg) {
        console.error("Usage: npx tsx scripts/trace-step.ts [--seed=<n>] <step-index 1-based> <object-id>[,<object-id>...] [every-ms]");
        process.exit(1);
    }

    const { GRID_HEIGHT, GRID_WIDTH, SceneAnimator, STEPS } = await import("../src/stahl-scene");

    const index = Number(stepArg);
    const step = STEPS[index - 1];
    if (!step) {
        console.error(`No such step: ${index} (STEPS has ${STEPS.length} entries)`);
        process.exit(1);
    }

    const ids = idsArg.split(",");
    const every = everyArg !== undefined ? Number(everyArg) : 16;

    const compositor = new Compositor(GRID_WIDTH, GRID_HEIGHT);
    const anim = new SceneAnimator(compositor);

    console.log(`Step ${index}, transitionDuration=${step.transitionDuration}ms, logging every ${every}ms (unchanged lines omitted)`);
    let lastLogged = -Infinity;
    let lastLine: string | null = null;
    anim.runStepInstant(index, (elapsed, anim) => {
        const atEnd = elapsed >= step.transitionDuration;
        if (elapsed - lastLogged < every && !atEnd) return;
        lastLogged = elapsed;
        const parts = ids.map((id) => {
            const o = anim.getObject(id);
            return `${id} x=${o.x.toFixed(2)} y=${o.y.toFixed(2)} z=${o.z} rot=${o.rotation.toFixed(2)}`;
        });
        const line = parts.join("  |  ");
        if (line === lastLine && !atEnd) return;
        lastLine = line;
        console.log(`t=${elapsed.toFixed(0).padStart(5)}ms  ${line}`);
    });
}

main();
