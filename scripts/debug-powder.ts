import { Compositor } from "../src/ascii-compositor";
import { setSeed } from "../src/rng";
import { GRINDER_BOWL_POINTS } from "../src/stahl-props";

setSeed(42);

async function main() {
    const { GRID_HEIGHT, GRID_WIDTH, SceneAnimator } = await import("../src/stahl-scene");
    const compositor = new Compositor(GRID_WIDTH, GRID_HEIGHT);
    const anim = new SceneAnimator(compositor);
    anim.runStepInstant(1);
    const grinder = anim.getObject("grinderBody");
    console.log("Grinder at:", grinder.x, grinder.y, "rotation:", grinder.rotation);
    console.log("Grinder bowl points:", GRINDER_BOWL_POINTS);
    console.log("GrinderPowder members:", anim.grinderPowderGroup.members.length);
    for (const m of anim.grinderPowderGroup.members) {
        console.log("  relX:", m.relX.toFixed(2), "relY:", m.relY.toFixed(2),
            "world:", (grinder.x + m.relX).toFixed(2), (grinder.y + m.relY).toFixed(2));
    }
}

main();
