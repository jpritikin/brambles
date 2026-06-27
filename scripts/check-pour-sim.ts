import { PourSim, type OnLandCallback } from "../src/pour-sim";
import { GLASS_POINTS, GLASS_PIVOT, GRINDER_INTERIOR_POINTS, DISH_POINTS, BOTTLE_INTERIOR_POINTS, BOTTLE_LIQUID_POSITIONS } from "../src/stahl-props";

function assert(cond: boolean, msg: string): void {
    if (!cond) { console.error("FAIL:", msg); process.exit(1); }
}

// Test 1: particle stays inside source container under gravity (doesn't
// escape through walls). Particles can't "land" in the source—they only
// land in the target after exiting through the gap.
{
    const sim = new PourSim({
        sourcePoints: GLASS_POINTS,
        sourceClosed: false,
        targetPoints: GLASS_POINTS,
        targetClosed: false,
    });
    sim.addParticleLocal(0, -1); // near top of glass interior
    const state = { x: 10, y: 6, rotation: 0 };
    for (let i = 0; i < 300; i++) {
        sim.step(0.016, state, state);
    }
    const p = sim.particles[0];
    assert(!p.airborne, "particle should stay in source (not escape through walls)");
    const [, gy] = sim.gridPos(p, state, state);
    assert(gy > 6 && gy < 9, `particle should be near bottom of glass, gy=${gy.toFixed(2)}`);
}

// Test 2: particles pour from tipped grinder into glass
{
    const sim = new PourSim({
        sourcePoints: GRINDER_INTERIOR_POINTS,
        sourceClosed: false,
        targetPoints: GLASS_POINTS,
        targetClosed: false,
    });
    const glassX = 37.5, glassY = 6;
    for (let i = 0; i < 5; i++) {
        sim.addParticleLocal((i - 2) * 0.5, 1); // near bottom of grinder
    }
    const TAU = Math.PI * 2;
    const tipAngle = TAU * (110 / 360);
    const dt = 0.016;
    for (let t = 0; t < 10; t += dt) {
        const rotation = t < 2 ? tipAngle * (t / 2) : tipAngle;
        sim.step(dt,
            { x: glassX - 2, y: 0, rotation },
            { x: glassX, y: glassY, rotation: 0 },
        );
    }
    const landedCount = sim.particles.filter(p => p.landed).length;
    assert(landedCount === 5, `all 5 particles should have landed, got ${landedCount}`);
}

// Test 3: particles pour from tipped glass (with pivot) into dish
{
    const sim = new PourSim({
        sourcePoints: GLASS_POINTS,
        sourceClosed: false,
        sourcePivot: GLASS_PIVOT,
        targetPoints: DISH_POINTS,
        targetClosed: false,
    });
    for (let i = 0; i < 8; i++) {
        sim.addParticleLocal((i % 4 - 1.5) * 0.8, 1 + Math.floor(i / 4) * 0.5);
    }
    const TAU = Math.PI * 2;
    const tipAngle = TAU * (110 / 360);
    const dt = 0.016;
    for (let t = 0; t < 10; t += dt) {
        const rotation = t < 2.4 ? tipAngle * (t / 2.4) : tipAngle;
        sim.step(dt,
            { x: 30, y: 2, rotation },
            { x: 37.5, y: 7, rotation: 0 },
        );
    }
    const landedCount = sim.particles.filter(p => p.landed).length;
    console.log(`Glass->dish pour: ${landedCount}/${sim.particles.length} landed`);
    assert(landedCount >= 4, `at least half should land, got ${landedCount}`);
}

// Test 4: multiplier callback (tipped glass pours into dish)
{
    let totalSourceDrained = 0;
    let totalDestAdded = 0;
    const landings: number[] = [];
    const onLand: OnLandCallback = (i, srcBatch, dstBatch) => {
        totalSourceDrained += srcBatch;
        totalDestAdded += dstBatch;
        landings.push(i);
    };
    const TAU = Math.PI * 2;
    const tipAngle = TAU * (110 / 360);
    const sim = new PourSim({
        sourcePoints: GLASS_POINTS,
        sourceClosed: false,
        sourcePivot: GLASS_PIVOT,
        targetPoints: DISH_POINTS,
        targetClosed: false,
    }, 10, 20, onLand);

    for (let i = 0; i < 4; i++) {
        sim.addParticleLocal((i - 1.5) * 0.5, 0);
    }
    const target = { x: 30, y: 7, rotation: 0 };
    const dt = 0.016;
    for (let t = 0; t < 10; t += dt) {
        const rotation = t < 2 ? tipAngle * (t / 2) : tipAngle;
        sim.step(dt, { x: 20, y: 4, rotation }, target);
    }
    assert(sim.allLanded(), "all particles should have landed");
    assert(totalSourceDrained === 10, `should drain all 10 source, got ${totalSourceDrained}`);
    assert(totalDestAdded === 20, `should add all 20 dest, got ${totalDestAdded}`);
    assert(landings.length === 4, `should have 4 landings, got ${landings.length}`);
}

// Test 5: bottle pour — fewer sim particles than source members (mirrors
// step 2's bottle pour where simParticleCount < BOTTLE_LIQUID_POSITIONS).
{
    const TAU = Math.PI * 2;
    const tipAngle = TAU * (45 + 65) / 360; // BOTTLE_REST_ROTATION + 65°
    const simCount = BOTTLE_LIQUID_POSITIONS.length;
    let totalSourceDrained = 0;
    let totalDestAdded = 0;
    const onLand: OnLandCallback = (_i, srcBatch, dstBatch) => {
        totalSourceDrained += srcBatch;
        totalDestAdded += dstBatch;
    };
    const sim = new PourSim({
        sourcePoints: BOTTLE_INTERIOR_POINTS,
        sourceClosed: false,
        targetPoints: GLASS_POINTS,
        targetClosed: false,
        targetPivot: GLASS_PIVOT,
    }, simCount, 15, onLand);

    for (const [rx, ry] of BOTTLE_LIQUID_POSITIONS) {
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
    }
    const landedCount = sim.particles.filter(p => p.landed).length;
    console.log(`Bottle->glass pour: ${landedCount}/${sim.particles.length} landed`);
    assert(landedCount >= 15, `at least half should pour out, got ${landedCount}`);
    assert(landedCount < simCount, `bottle should not fully empty, got ${landedCount}/${simCount}`);
}

console.log("All pour-sim checks passed.");
