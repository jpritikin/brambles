// A brief, page-wide fireworks display: rockets launch from the bottom of
// the screen, arc up to a target point trailing sparks, then explode into
// one of several particle patterns that fall under gravity and fade over
// ~1.5-2.5s. Drawn on a full-viewport canvas overlay. Used as the recipe
// slideshow's finale once the empty cup is placed back in step 6.

const COLORS = ["#ff595e", "#ffca3a", "#8ac926", "#1982c4", "#6a4c93", "#ff924c", "#ff5cad", "#39e6e6"];

const PARTICLE_LIFETIME_MIN = 1400; // ms
const PARTICLE_LIFETIME_MAX = 2200;
const GRAVITY = 140; // px/s², downward drift on particles/rockets

const ROCKET_SPEED_MIN = 420; // px/s, upward launch speed
const ROCKET_SPEED_MAX = 620;
const ROCKET_TRAIL_LENGTH = 10; // recent positions kept for the trail

const BURST_COUNT = 16;
const LAUNCH_INTERVAL_MIN = 80; // ms between rocket launches
const LAUNCH_INTERVAL_MAX = 600;
const DISPLAY_DURATION = 9500; // ms, total time the canvas stays mounted

interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    color: string;
    radius: number;
    bornAt: number;
    lifetime: number;
}

interface Rocket {
    x: number;
    y: number;
    vx: number;
    vy: number;
    color: string;
    targetY: number;
    trail: Array<{ x: number; y: number }>;
    exploded: boolean;
}

function randomBetween(a: number, b: number): number {
    return a + Math.random() * (b - a);
}

// Uniform scatter in all directions, varied speeds — a classic "pop".
function spawnScatterBurst(particles: Particle[], x: number, y: number, now: number): void {
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const count = 70;
    for (let i = 0; i < count; i++) {
        const angle = randomBetween(0, Math.PI * 2);
        const speed = randomBetween(60, 320);
        particles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            color: Math.random() < 0.3 ? COLORS[Math.floor(Math.random() * COLORS.length)] : color,
            radius: randomBetween(1.5, 3),
            bornAt: now,
            lifetime: randomBetween(PARTICLE_LIFETIME_MIN, PARTICLE_LIFETIME_MAX),
        });
    }
}

// A crisp ring of particles all moving at roughly the same speed.
function spawnRingBurst(particles: Particle[], x: number, y: number, now: number): void {
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const count = 60;
    const speed = randomBetween(150, 260);
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + randomBetween(-0.05, 0.05);
        const s = speed * randomBetween(0.9, 1.1);
        particles.push({
            x, y,
            vx: Math.cos(angle) * s,
            vy: Math.sin(angle) * s,
            color,
            radius: randomBetween(1.5, 2.5),
            bornAt: now,
            lifetime: randomBetween(PARTICLE_LIFETIME_MIN, PARTICLE_LIFETIME_MAX),
        });
    }
}

// Two concentric rings of contrasting colors.
function spawnDoubleRingBurst(particles: Particle[], x: number, y: number, now: number): void {
    const colorA = COLORS[Math.floor(Math.random() * COLORS.length)];
    let colorB = COLORS[Math.floor(Math.random() * COLORS.length)];
    if (colorB === colorA) colorB = COLORS[(COLORS.indexOf(colorA) + 1) % COLORS.length];
    const count = 40;
    for (const [speed, color] of [[300, colorA], [160, colorB]] as const) {
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2 + randomBetween(-0.05, 0.05);
            const s = (speed as number) * randomBetween(0.9, 1.1);
            particles.push({
                x, y,
                vx: Math.cos(angle) * s,
                vy: Math.sin(angle) * s,
                color: color as string,
                radius: randomBetween(1.5, 2.5),
                bornAt: now,
                lifetime: randomBetween(PARTICLE_LIFETIME_MIN, PARTICLE_LIFETIME_MAX),
            });
        }
    }
}

// Sparse, fast spokes with trailing sparks along each — a "willow" or
// chrysanthemum-style starburst.
function spawnStarburst(particles: Particle[], x: number, y: number, now: number): void {
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const spokes = 10 + Math.floor(Math.random() * 4);
    const sparksPerSpoke = 6;
    for (let i = 0; i < spokes; i++) {
        const angle = (i / spokes) * Math.PI * 2 + randomBetween(-0.1, 0.1);
        const baseSpeed = randomBetween(200, 360);
        for (let j = 0; j < sparksPerSpoke; j++) {
            const speed = baseSpeed * (1 - j / sparksPerSpoke) + randomBetween(-15, 15);
            particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                color,
                radius: randomBetween(1, 2.5),
                bornAt: now + j * 20,
                lifetime: randomBetween(PARTICLE_LIFETIME_MIN, PARTICLE_LIFETIME_MAX),
            });
        }
    }
}

const PATTERNS = [spawnScatterBurst, spawnRingBurst, spawnDoubleRingBurst, spawnStarburst];

function spawnExplosion(particles: Particle[], x: number, y: number, now: number): void {
    const pattern = PATTERNS[Math.floor(Math.random() * PATTERNS.length)];
    pattern(particles, x, y, now);
}

// Launches a rocket from near the bottom of the screen toward a random
// target point in the upper portion, with enough upward speed to roughly
// reach that height before gravity brings it back down (where it explodes).
function spawnRocket(rockets: Rocket[]): void {
    const targetX = randomBetween(window.innerWidth * 0.1, window.innerWidth * 0.9);
    const targetY = randomBetween(window.innerHeight * 0.1, window.innerHeight * 0.55);
    const startX = targetX + randomBetween(-60, 60);
    const startY = window.innerHeight + 20;

    const speed = randomBetween(ROCKET_SPEED_MIN, ROCKET_SPEED_MAX);
    // Time to decelerate (under GRAVITY) from `speed` to 0 determines how
    // high the rocket climbs; aim its horizontal velocity so it drifts from
    // startX to targetX over that same time.
    const riseTime = speed / GRAVITY;
    const vx = (targetX - startX) / riseTime;

    rockets.push({
        x: startX,
        y: startY,
        vx,
        vy: -speed,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        targetY,
        trail: [],
        exploded: false,
    });
}

// Mounts a full-viewport canvas, runs a brief fireworks display, then
// removes the canvas. Safe to call multiple times (each call gets its own
// canvas); respects prefers-reduced-motion.
export function launchFireworks(): void {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100";
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d")!;

    const particles: Particle[] = [];
    const rockets: Rocket[] = [];
    const start = performance.now();
    let lastTime = start;
    let nextLaunchAt = start + randomBetween(0, LAUNCH_INTERVAL_MAX);
    let launched = 0;

    function tick(now: number): void {
        const dt = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;
        const elapsed = now - start;
        if (elapsed >= DISPLAY_DURATION && particles.length === 0 && rockets.length === 0) {
            canvas.remove();
            return;
        }

        if (launched < BURST_COUNT && now >= nextLaunchAt) {
            spawnRocket(rockets);
            launched++;
            // Vary the gap stochastically: most gaps short, occasional longer
            // lulls, so the cadence doesn't feel metronomic.
            const gap = Math.random() < 0.2
                ? randomBetween(LAUNCH_INTERVAL_MAX * 0.6, LAUNCH_INTERVAL_MAX)
                : randomBetween(LAUNCH_INTERVAL_MIN, LAUNCH_INTERVAL_MAX * 0.5);
            nextLaunchAt = now + gap;
        }

        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Advance rockets: integrate, draw trail, explode once past target
        // height (vy turns non-negative) or close enough to it.
        for (let i = rockets.length - 1; i >= 0; i--) {
            const r = rockets[i];
            r.trail.push({ x: r.x, y: r.y });
            if (r.trail.length > ROCKET_TRAIL_LENGTH) r.trail.shift();

            r.vy += GRAVITY * dt;
            r.x += r.vx * dt;
            r.y += r.vy * dt;

            if (r.vy >= 0 || r.y <= r.targetY) {
                spawnExplosion(particles, r.x, r.y, now);
                rockets.splice(i, 1);
                continue;
            }

            for (let j = 0; j < r.trail.length; j++) {
                const point = r.trail[j];
                ctx.globalAlpha = ((j + 1) / r.trail.length) * 0.8;
                ctx.fillStyle = r.color;
                ctx.beginPath();
                ctx.arc(point.x, point.y, 1.5, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            ctx.fillStyle = r.color;
            ctx.beginPath();
            ctx.arc(r.x, r.y, 2, 0, Math.PI * 2);
            ctx.fill();
        }

        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            const age = now - p.bornAt;
            if (age < 0) continue; // not yet "lit" (staggered starburst sparks)
            if (age >= p.lifetime) {
                particles.splice(i, 1);
                continue;
            }
            const t = age / 1000;
            const x = p.x + p.vx * t;
            const y = p.y + p.vy * t + 0.5 * GRAVITY * t * t;
            const alpha = 1 - age / p.lifetime;

            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(x, y, p.radius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
}
