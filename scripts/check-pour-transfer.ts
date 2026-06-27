import { CELL_ASPECT, Compositor, PropGroup } from "../src/ascii-compositor";
import { PourSim } from "../src/pour-sim";
import { GLASS_POINTS, GLASS_PIVOT, DISH_POINTS, POWDER_PARTICLE, LIQUID_PARTICLE } from "../src/stahl-props";

function assert(cond: boolean, msg: string): void {
    if (!cond) { console.error("FAIL:", msg); process.exit(1); }
}

function approxEqual(a: number, b: number, tol = 0.01): boolean {
    return Math.abs(a - b) < tol;
}

// Test: static PropGroup → PourSim transient → static PropGroup round-trip
// preserves visual positions (unrotated glass).
{
    const origin = { x: 10, y: 5, z: 2, rotation: 0 };
    const positions = [[1, 2], [2, 3], [-1, 1], [0, 2.5]] as [number, number][];

    const compositor = new Compositor(80, 20);
    const group = new PropGroup(compositor, "test", [], origin, GLASS_PIVOT);
    for (const [rx, ry] of positions) {
        group.addMember({ sprite: POWDER_PARTICLE, relX: rx, relY: ry, relZ: 0 });
    }

    const worldPositions = group.members.map(m => [m.obj.x, m.obj.y] as [number, number]);

    const sim = new PourSim({
        sourcePoints: GLASS_POINTS,
        sourceClosed: false,
        sourcePivot: GLASS_PIVOT,
        targetPoints: DISH_POINTS,
        targetClosed: false,
    });

    const sourceState = { x: origin.x, y: origin.y, rotation: origin.rotation };
    const targetState = { x: 30, y: 7, rotation: 0 };
    const particles = positions.map(([rx, ry]) => sim.addParticleLocal(rx, ry, "powder"));

    for (let i = 0; i < particles.length; i++) {
        const [gx, gy] = sim.gridPos(particles[i], sourceState, targetState);
        assert(
            approxEqual(gx, worldPositions[i][0]) && approxEqual(gy, worldPositions[i][1]),
            `static→sim mismatch at ${i}: PropGroup=(${worldPositions[i][0].toFixed(2)}, ${worldPositions[i][1].toFixed(2)}) sim=(${gx.toFixed(2)}, ${gy.toFixed(2)})`,
        );
    }

    // Simulate done branch: snapshot sim gridPos back to relX/relY
    for (let i = 0; i < particles.length; i++) {
        const [gx, gy] = sim.gridPos(particles[i], sourceState, targetState);
        group.members[i].relX = gx - sourceState.x;
        group.members[i].relY = gy - sourceState.y;
    }
    group.setOrigin(origin.x, origin.y, origin.z, origin.rotation);

    for (let i = 0; i < positions.length; i++) {
        assert(
            approxEqual(group.members[i].obj.x, worldPositions[i][0]) &&
            approxEqual(group.members[i].obj.y, worldPositions[i][1]),
            `sim→static mismatch at ${i}: expected=(${worldPositions[i][0].toFixed(2)}, ${worldPositions[i][1].toFixed(2)}) got=(${group.members[i].obj.x.toFixed(2)}, ${group.members[i].obj.y.toFixed(2)})`,
        );
    }
    console.log("Test 1 (unrotated round-trip): passed");
}

// Test: round-trip after PourSim has run physics (particles settle under
// gravity, then snapshot back). Positions should match the last gridPos.
{
    const origin = { x: 10, y: 5, z: 2, rotation: 0 };
    const positions = [[1, 0], [2, 0], [-1, -1]] as [number, number][];

    const compositor = new Compositor(80, 20);
    const group = new PropGroup(compositor, "test2", [], origin, GLASS_PIVOT);
    for (const [rx, ry] of positions) {
        group.addMember({ sprite: LIQUID_PARTICLE, relX: rx, relY: ry, relZ: 0 });
    }

    const sim = new PourSim({
        sourcePoints: GLASS_POINTS,
        sourceClosed: false,
        sourcePivot: GLASS_PIVOT,
        targetPoints: DISH_POINTS,
        targetClosed: false,
    });

    const sourceState = { x: origin.x, y: origin.y, rotation: origin.rotation };
    const targetState = { x: 30, y: 7, rotation: 0 };
    const particles = positions.map(([rx, ry]) => sim.addParticleLocal(rx, ry, "powder"));

    // Run physics to let particles settle
    for (let i = 0; i < 100; i++) {
        sim.step(0.016, sourceState, targetState);
    }

    // Record where they ended up
    const settledPositions = particles.map(p => sim.gridPos(p, sourceState, targetState));

    // Snapshot back to group
    for (let i = 0; i < particles.length; i++) {
        const [gx, gy] = settledPositions[i];
        group.members[i].relX = gx - sourceState.x;
        group.members[i].relY = gy - sourceState.y;
    }
    group.setOrigin(origin.x, origin.y, origin.z, origin.rotation);

    for (let i = 0; i < particles.length; i++) {
        assert(
            approxEqual(group.members[i].obj.x, settledPositions[i][0]) &&
            approxEqual(group.members[i].obj.y, settledPositions[i][1]),
            `settled sim→static mismatch at ${i}: expected=(${settledPositions[i][0].toFixed(2)}, ${settledPositions[i][1].toFixed(2)}) got=(${group.members[i].obj.x.toFixed(2)}, ${group.members[i].obj.y.toFixed(2)})`,
        );
    }

    // Now move the origin (simulating glass moving) and verify members follow
    const newOrigin = { x: 20, y: 3, z: 2, rotation: 0 };
    group.setOrigin(newOrigin.x, newOrigin.y, newOrigin.z, newOrigin.rotation);
    for (let i = 0; i < particles.length; i++) {
        const expectedX = settledPositions[i][0] + (newOrigin.x - origin.x);
        const expectedY = settledPositions[i][1] + (newOrigin.y - origin.y);
        assert(
            approxEqual(group.members[i].obj.x, expectedX) &&
            approxEqual(group.members[i].obj.y, expectedY),
            `after origin move, member ${i} didn't follow: expected=(${expectedX.toFixed(2)}, ${expectedY.toFixed(2)}) got=(${group.members[i].obj.x.toFixed(2)}, ${group.members[i].obj.y.toFixed(2)})`,
        );
    }
    console.log("Test 2 (settled + origin move): passed");
}

// Test 3: full PourTransfer lifecycle simulation—liquid gets released,
// powder stays as bg, deadline fires, powder snapshotted back.
{
    const glassOrigin = { x: 10, y: 5, z: 2, rotation: 0 };
    const compositor = new Compositor(80, 20);
    const liquidGroup = new PropGroup(compositor, "liquid", [], glassOrigin, GLASS_PIVOT);

    // Add liquid and powder members (like step 2's fill)
    const liquidPositions = [[1, 2], [2, 2], [0, 3]] as [number, number][];
    const powderPositions = [[1, 3], [2, 3.5]] as [number, number][];
    for (const [rx, ry] of liquidPositions) {
        liquidGroup.addMember({ sprite: LIQUID_PARTICLE, relX: rx, relY: ry, relZ: 0 });
    }
    for (const [rx, ry] of powderPositions) {
        liquidGroup.addMember({ sprite: POWDER_PARTICLE, relX: rx, relY: ry, relZ: 0 });
    }

    // Record initial world positions of powder
    const liquidRole = LIQUID_PARTICLE.cells[0].role;
    const powderMembers = liquidGroup.members.filter(m => m.obj.sprite.cells[0]?.role !== liquidRole);
    const powderWorldBefore = powderMembers.map(m => [m.obj.x, m.obj.y] as [number, number]);

    // Simulate PourTransfer init: create sim, hide members, make transients
    const sim = new PourSim({
        sourcePoints: GLASS_POINTS,
        sourceClosed: false,
        sourcePivot: GLASS_PIVOT,
        targetPoints: DISH_POINTS,
        targetClosed: false,
    });

    const sourceState = { x: glassOrigin.x, y: glassOrigin.y, rotation: 0 };
    const targetState = { x: 30, y: 7, rotation: 0 };

    // Source (liquid) members: release and hide (like onDrain does)
    const liquidMembers = liquidGroup.members.filter(m => m.obj.sprite.cells[0]?.role === liquidRole);
    for (const m of liquidMembers) {
        sim.addParticleLocal(m.relX, m.relY, "liquid");
        liquidGroup.release(m);
        m.obj.visible = false;
    }

    // Bg (powder) members: hide but don't release
    const bgParticles = powderMembers.map(m => sim.addParticleLocal(m.relX, m.relY, "powder"));
    const bgVisuals = powderMembers.map((m, i) => {
        m.obj.visible = false;
        const [gx, gy] = sim.gridPos(bgParticles[i], sourceState, targetState);
        return { x: gx, y: gy };
    });

    // Verify bg visuals match original world positions
    for (let i = 0; i < powderMembers.length; i++) {
        assert(
            approxEqual(bgVisuals[i].x, powderWorldBefore[i][0]) &&
            approxEqual(bgVisuals[i].y, powderWorldBefore[i][1]),
            `init: bg visual ${i} doesn't match original: expected=(${powderWorldBefore[i][0].toFixed(2)}, ${powderWorldBefore[i][1].toFixed(2)}) got=(${bgVisuals[i].x.toFixed(2)}, ${bgVisuals[i].y.toFixed(2)})`,
        );
    }

    // Simulate done branch: snapshot bg visuals back
    for (let i = 0; i < powderMembers.length; i++) {
        powderMembers[i].relX = bgVisuals[i].x - sourceState.x;
        powderMembers[i].relY = bgVisuals[i].y - sourceState.y;
        powderMembers[i].obj.visible = true;
    }

    // Simulate syncGroupOrigins
    liquidGroup.setOrigin(glassOrigin.x, glassOrigin.y, glassOrigin.z, glassOrigin.rotation);

    // Verify powder is at original positions
    for (let i = 0; i < powderMembers.length; i++) {
        assert(
            approxEqual(powderMembers[i].obj.x, powderWorldBefore[i][0]) &&
            approxEqual(powderMembers[i].obj.y, powderWorldBefore[i][1]),
            `restore: powder ${i} position wrong: expected=(${powderWorldBefore[i][0].toFixed(2)}, ${powderWorldBefore[i][1].toFixed(2)}) got=(${powderMembers[i].obj.x.toFixed(2)}, ${powderMembers[i].obj.y.toFixed(2)})`,
        );
        assert(powderMembers[i].obj.visible, `restore: powder ${i} should be visible`);
        assert(!powderMembers[i].released, `restore: powder ${i} should not be released`);
    }

    // Move glass (simulating return arc) and verify powder follows
    const newOrigin = { x: 20, y: 3, z: 2, rotation: 0 };
    liquidGroup.setOrigin(newOrigin.x, newOrigin.y, newOrigin.z, newOrigin.rotation);
    for (let i = 0; i < powderMembers.length; i++) {
        const expectedX = powderWorldBefore[i][0] + (newOrigin.x - glassOrigin.x);
        const expectedY = powderWorldBefore[i][1] + (newOrigin.y - glassOrigin.y);
        assert(
            approxEqual(powderMembers[i].obj.x, expectedX) &&
            approxEqual(powderMembers[i].obj.y, expectedY),
            `after move: powder ${i} didn't follow glass: expected=(${expectedX.toFixed(2)}, ${expectedY.toFixed(2)}) got=(${powderMembers[i].obj.x.toFixed(2)}, ${powderMembers[i].obj.y.toFixed(2)})`,
        );
    }
    console.log("Test 3 (full lifecycle + glass move): passed");
}

// Test 4: verify powder member survives multiple setOrigin calls after
// restore (simulating the glass return arc with syncGroupOrigins each frame).
{
    const compositor = new Compositor(80, 20);
    const pivot: [number, number] = [3, 2]; // GLASS_PIVOT
    const origin = { x: 15, y: 3, z: 4, rotation: 0 };
    const group = new PropGroup(compositor, "t4", [], origin, pivot);
    const member = group.addMember({ sprite: POWDER_PARTICLE, relX: 1, relY: 2, relZ: 0 });
    const initialWorldX = member.obj.x;
    const initialWorldY = member.obj.y;

    // Simulate PourTransfer: hide member
    member.obj.visible = false;

    // Simulate done branch: snapshot back (same relX/relY since no physics)
    const visX = initialWorldX; // transient visual was at same position
    const visY = initialWorldY;
    member.relX = visX - origin.x;
    member.relY = visY - origin.y;
    member.obj.visible = true;

    // syncGroupOrigins at same origin
    group.setOrigin(origin.x, origin.y, origin.z, origin.rotation);
    assert(
        approxEqual(member.obj.x, initialWorldX) && approxEqual(member.obj.y, initialWorldY),
        `frame 0: expected (${initialWorldX}, ${initialWorldY}), got (${member.obj.x.toFixed(2)}, ${member.obj.y.toFixed(2)})`,
    );

    // Glass moves over several frames
    for (let frame = 1; frame <= 10; frame++) {
        const newX = origin.x + frame * 0.5;
        const newY = origin.y - frame * 0.2;
        group.setOrigin(newX, newY, origin.z, 0);
        const expectedX = initialWorldX + frame * 0.5;
        const expectedY = initialWorldY - frame * 0.2;
        assert(
            approxEqual(member.obj.x, expectedX) && approxEqual(member.obj.y, expectedY),
            `frame ${frame}: expected (${expectedX.toFixed(2)}, ${expectedY.toFixed(2)}), got (${member.obj.x.toFixed(2)}, ${member.obj.y.toFixed(2)})`,
        );
        assert(member.obj.visible, `frame ${frame}: member should be visible`);
    }
    console.log("Test 4 (powder survives multi-frame glass move): passed");
}

console.log("All pour-transfer checks passed.");
