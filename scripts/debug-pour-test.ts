import { PourSim } from "../src/pour-sim";
import { GRINDER_INTERIOR_POINTS, GLASS_POINTS } from "../src/stahl-props";

const sim = new PourSim({
    sourcePoints: GRINDER_INTERIOR_POINTS,
    sourceClosed: false,
    targetPoints: GLASS_POINTS,
    targetClosed: false,
});
const glassX = 37.5, glassY = 6;
for (let i = 0; i < 5; i++) {
    sim.addParticleLocal((i - 2) * 0.5, 1);
}
const TAU = Math.PI * 2;
const tipAngle = TAU * (110 / 360);
const dt = 0.016;
for (let t = 0; t < 12; t += dt) {
    const rotation = t < 2 ? tipAngle * (t / 2) : tipAngle;
    sim.step(dt,
        { x: glassX - 2, y: 0, rotation },
        { x: glassX, y: glassY, rotation: 0 },
    );
    if (Math.abs(t % 1) < dt) {
        for (let i = 0; i < 5; i++) {
            const p = sim.particles[i];
            console.log(`t=${t.toFixed(1)} p${i}: airborne=${p.airborne} landed=${p.landed} x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} vx=${p.vx.toFixed(2)} vy=${p.vy.toFixed(2)}`);
        }
    }
}
const landedCount = sim.particles.filter(p => p.landed).length;
console.log(`Landed: ${landedCount}/5`);
