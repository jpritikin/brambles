import { PourSim } from "../src/pour-sim";
import { BOTTLE_INTERIOR_POINTS, BOTTLE_LIQUID_POSITIONS, GLASS_POINTS, GLASS_PIVOT } from "../src/stahl-props";

const TAU = Math.PI * 2;
const tipAngle = TAU * (45 + 65) / 360;
const sourceTotal = BOTTLE_LIQUID_POSITIONS.length;
const simCount = Math.min(12, sourceTotal);
const sim = new PourSim({
    sourcePoints: BOTTLE_INTERIOR_POINTS,
    sourceClosed: false,
    targetPoints: GLASS_POINTS,
    targetClosed: false,
    targetPivot: GLASS_PIVOT,
});

for (let i = 0; i < simCount; i++) {
    const srcIdx = Math.floor(i * sourceTotal / simCount);
    const [rx, ry] = BOTTLE_LIQUID_POSITIONS[srcIdx];
    sim.addParticleLocal(rx, ry);
}
const dt = 0.016;
const glassX = 37.5;
for (let t = 0; t < 15; t += dt) {
    const rotation = t < 2 ? tipAngle * (t / 2) : tipAngle;
    sim.step(dt,
        { x: glassX + 2, y: 0, rotation },
        { x: glassX, y: 6, rotation: 0 },
    );
    if (Math.abs(t % 2) < dt) {
        for (let i = 0; i < simCount; i++) {
            const p = sim.particles[i];
            console.log(`t=${t.toFixed(1)} p${i}: airborne=${p.airborne} landed=${p.landed} x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} vx=${p.vx.toFixed(2)} vy=${p.vy.toFixed(2)}`);
        }
        console.log();
    }
}
