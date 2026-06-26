import { fillRegion } from "../src/ascii-sprites";
import { BOTTLE_POINTS } from "../src/stahl-props";

for (const margin of [0.3, 0.1, 0.01]) {
    const pts = fillRegion(BOTTLE_POINTS, margin, 1, 1);
    const unique = new Set(pts.map(([x,y]) => `${Math.round(x)},${Math.round(y)}`));
    console.log(`margin=${margin}: ${pts.length} points, ${unique.size} unique cells`);
    console.log(pts);
}
