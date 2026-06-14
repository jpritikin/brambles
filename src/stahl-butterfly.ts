// A single butterfly that drifts around the recipe steps. It wanders toward
// random points inside a circle whose center bounces around the bounding
// box spanning #butterfly-anchor-top to #butterfly-anchor-bottom at
// semi-random angles.

const ORIGIN_RADIUS_MAX = 90; // px, drift circle radius on tall/narrow boxes
const ACCEL = 80; // px/s² toward dest
const FRICTION = 0.5; // velocity multiplied each second (lower = more damping)
const ORIGIN_SPEED = 30; // px/s, origin drift speed
const MAX_BOUNCE_JITTER = 30 * Math.PI / 180; // added to reflection angle on bounce
// Bounce angles within this many radians of straight up/down are pushed
// toward horizontal, so the circle doesn't get stuck pinging vertically
// on wide, short boxes.
const VERTICAL_AVOIDANCE = 25 * Math.PI / 180;
const BUTTERFLY_FACING_OFFSET = 100 * Math.PI / 180; // 🦋 glyph's natural facing vs. rightward (0 rad)
const HOVER_RADIUS = 24; // px — pointer proximity that triggers the hover effect

function isDebugMode(): boolean {
    const param = new URLSearchParams(window.location.search).get("debug");
    return param === "1" || param === "butterfly";
}

interface Box {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

function getBox(top: HTMLElement, bottom: HTMLElement): Box {
    const topRect = top.getBoundingClientRect();
    const bottomRect = bottom.getBoundingClientRect();
    return {
        left: Math.min(topRect.left, bottomRect.left),
        right: Math.max(topRect.right, bottomRect.right),
        top: topRect.bottom,
        bottom: bottomRect.top,
    };
}

function randomBetween(a: number, b: number): number {
    return a + Math.random() * (b - a);
}

// Pick a random dest within `radius` of the given origin
function newDest(originX: number, originY: number, radius: number): [number, number] {
    const angle = randomBetween(0, Math.PI * 2);
    const r = randomBetween(0, radius);
    return [originX + Math.cos(angle) * r, originY + Math.sin(angle) * r];
}

function init(): void {
    const top = document.getElementById("butterfly-anchor-top");
    const bottom = document.getElementById("butterfly-anchor-bottom");
    if (!top || !bottom) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const el = document.createElement("span");
    el.className = "stahl-butterfly";
    el.textContent = "🦋";
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);

    const debug = isDebugMode();
    let debugCanvas: HTMLCanvasElement | null = null;
    let debugCtx: CanvasRenderingContext2D | null = null;
    if (debug) {
        debugCanvas = document.createElement("canvas");
        debugCanvas.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999";
        document.body.appendChild(debugCanvas);
        debugCtx = debugCanvas.getContext("2d");
    }

    let box = getBox(top, bottom);
    // Shrink the drift circle so it fits within the box on wide displays.
    let radius = Math.max(20, Math.min(ORIGIN_RADIUS_MAX, (box.bottom - box.top) / 2, (box.right - box.left) / 2));
    let originX = (box.left + box.right) / 2;
    let originY = (box.top + box.bottom) / 2;
    let driftAngle = randomBetween(0, Math.PI * 2);
    let [x, y] = [originX, originY];
    let vx = 0, vy = 0;
    let [destX, destY] = newDest(originX, originY, radius);
    let nextDestAt = 0;
    let facing = 0; // radians, direction the butterfly faces
    let lastScrollY = window.scrollY;

    function bounceJitter(): number {
        return (Math.random() - 0.5) * 2 * MAX_BOUNCE_JITTER;
    }

    // If an angle points within VERTICAL_AVOIDANCE of straight up/down,
    // rotate it toward the nearer horizontal direction by the shortfall, so
    // the circle doesn't get trapped bouncing vertically on wide boxes.
    function avoidVertical(a: number): number {
        const up = Math.PI / 2, down = -Math.PI / 2;
        for (const vertical of [up, down]) {
            let diff = a - vertical;
            diff -= Math.round(diff / (2 * Math.PI)) * 2 * Math.PI; // wrap to [-π, π]
            if (Math.abs(diff) < VERTICAL_AVOIDANCE) {
                const shortfall = VERTICAL_AVOIDANCE - Math.abs(diff);
                return a + Math.sign(diff || 1) * shortfall;
            }
        }
        return a;
    }

    function render(): void {
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${facing + BUTTERFLY_FACING_OFFSET}rad)`;

        if (debugCtx && debugCanvas) {
            debugCanvas.width = window.innerWidth;
            debugCanvas.height = window.innerHeight;
            const ctx = debugCtx;
            ctx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
            // Bounding box
            ctx.globalAlpha = 0.3;
            ctx.strokeStyle = "#0f0";
            ctx.lineWidth = 1;
            ctx.strokeRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
            // Drift circle
            ctx.globalAlpha = 0.5;
            ctx.strokeStyle = "#f0f";
            ctx.beginPath();
            ctx.arc(originX, originY, radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(originX, originY, 3, 0, Math.PI * 2);
            ctx.fillStyle = "#f0f";
            ctx.fill();
            // Dest
            ctx.globalAlpha = 0.8;
            ctx.beginPath();
            ctx.arc(destX, destY, 4, 0, Math.PI * 2);
            ctx.fillStyle = "#ff0";
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    }

    let lastTime = performance.now();
    function tick(now: number): void {
        const dt = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;

        // Shift all viewport-relative positions by the scroll delta so the
        // butterfly stays put relative to the page (and the box) instantly,
        // instead of lagging behind via the drift physics.
        const scrollY = window.scrollY;
        const scrollDelta = scrollY - lastScrollY;
        lastScrollY = scrollY;
        if (scrollDelta !== 0) {
            originY -= scrollDelta;
            y -= scrollDelta;
            destY -= scrollDelta;
        }

        box = getBox(top, bottom);
        radius = Math.max(20, Math.min(ORIGIN_RADIUS_MAX, (box.bottom - box.top) / 2, (box.right - box.left) / 2));

        // Drift the circle origin, bouncing off the box walls at semi-random angles.
        originX += Math.cos(driftAngle) * ORIGIN_SPEED * dt;
        originY += Math.sin(driftAngle) * ORIGIN_SPEED * dt;
        const minX = box.left + radius, maxX = box.right - radius;
        const minY = box.top + radius, maxY = box.bottom - radius;
        if (originX < minX) {
            originX = minX;
            driftAngle = avoidVertical(Math.PI - driftAngle + bounceJitter());
        } else if (originX > maxX) {
            originX = maxX;
            driftAngle = avoidVertical(Math.PI - driftAngle + bounceJitter());
        }
        if (originY < minY) {
            originY = minY;
            driftAngle = avoidVertical(-driftAngle + bounceJitter());
        } else if (originY > maxY) {
            originY = maxY;
            driftAngle = avoidVertical(-driftAngle + bounceJitter());
        }

        // Accelerate toward dest, apply friction, integrate
        const toX = destX - x, toY = destY - y;
        const dist = Math.sqrt(toX * toX + toY * toY) || 1;
        vx += (toX / dist) * ACCEL * dt;
        vy += (toY / dist) * ACCEL * dt;
        const frictionFactor = Math.pow(FRICTION, dt);
        vx *= frictionFactor;
        vy *= frictionFactor;
        x += vx * dt;
        y += vy * dt;

        const speed = Math.sqrt(vx * vx + vy * vy);
        if (speed > 1) facing = Math.atan2(vy, vx);

        // Pick a new dest once close to the current one and settled
        const dxDest = x - destX, dyDest = y - destY;
        if (dxDest * dxDest + dyDest * dyDest < 15 * 15) {
            if (nextDestAt === 0) nextDestAt = now + randomBetween(100, 500);
            if (now >= nextDestAt) {
                [destX, destY] = newDest(originX, originY, radius);
                nextDestAt = 0;
            }
        } else {
            nextDestAt = 0;
        }

        render();
        requestAnimationFrame(tick);
    }

    // Hover effect: highlight the butterfly when the pointer is near it, to
    // suggest it's clickable, without giving it pointer-events that would
    // block clicks from reaching the step underneath.
    document.addEventListener("pointermove", (e) => {
        const dx = x - e.clientX;
        const dy = y - e.clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        el.classList.toggle("stahl-butterfly-hover", dist < HOVER_RADIUS);
    });

    render();
    requestAnimationFrame(tick);
}

init();
