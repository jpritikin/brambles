// A single butterfly that drifts around the recipe steps. It wanders toward
// random points inside a circle whose center bounces around the bounding
// box spanning #butterfly-anchor-top to #butterfly-anchor-bottom at
// semi-random angles. Once the ASCII slideshow is revealed, the circle is
// freed to drift offscreen and the butterfly disappears for good.

import { SLIDESHOW_REVEALED_EVENT } from "./stahl-events";

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

function pointOverText(px: number, py: number, textRects: DOMRect[]): boolean {
    for (const r of textRects) {
        if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) return true;
    }
    return false;
}

// Pick a random dest within `radius` of the given origin, using rejection
// sampling to keep the butterfly over actual text when possible.
const REJECTION_LIMIT = 30;
function newDest(originX: number, originY: number, radius: number, textRects: DOMRect[]): [number, number] {
    for (let i = 0; i < REJECTION_LIMIT; i++) {
        const angle = randomBetween(0, Math.PI * 2);
        const r = randomBetween(0, radius);
        const px = originX + Math.cos(angle) * r;
        const py = originY + Math.sin(angle) * r;
        if (textRects.length === 0 || pointOverText(px, py, textRects)) return [px, py];
    }
    const angle = randomBetween(0, Math.PI * 2);
    const r = randomBetween(0, radius);
    return [originX + Math.cos(angle) * r, originY + Math.sin(angle) * r];
}

function init(): void {
    const topAnchor = document.getElementById("butterfly-anchor-top");
    const bottomAnchor = document.getElementById("butterfly-anchor-bottom");
    if (!topAnchor || !bottomAnchor) return;
    const top: HTMLElement = topAnchor;
    const bottom: HTMLElement = bottomAnchor;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const el = document.createElement("span");
    el.className = "stahl-butterfly";
    el.textContent = "🦋";
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);

    // Once true, the drift circle's origin is no longer bounced back into the
    // anchor box, so it wanders offscreen via its existing drift physics; the
    // butterfly is then removed once it's fully out of view.
    let released = false;
    document.addEventListener(SLIDESHOW_REVEALED_EVENT, () => {
        released = true;
    }, { once: true });

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
    const stepEls = document.querySelectorAll<HTMLElement>(".recipe-step");
    function getTextRects(): DOMRect[] {
        const rects: DOMRect[] = [];
        stepEls.forEach(el => {
            const clientRects = el.getClientRects();
            for (let i = 0; i < clientRects.length; i++) rects.push(clientRects[i]);
        });
        return rects;
    }
    let [destX, destY] = newDest(originX, originY, radius, getTextRects());
    let nextDestAt = 0;
    let facing = 0;
    let lastScrollY = window.scrollY;

    const LAND_CHANCE = 0.1;
    const LAND_DURATION_MIN = 5000; // ms
    const LAND_DURATION_MAX = 10000;
    const WIGGLE_MAX = 8 * Math.PI / 180;
    const LAND_SETTLE_FRICTION = 0.05; // much stronger friction than flight
    let landed = false;
    let settling = false; // decelerating before full stop
    let landEnd = 0;
    let landFacing = 0;
    let wiggleEnd = 0;
    let wigglePauseEnd = 0;
    let wiggleTarget = 0;
    let wiggleProgress = 0;

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

        // Drift the circle origin, bouncing off the box walls at semi-random
        // angles — unless released, in which case the left/right walls no
        // longer bounce it, so the origin can wander offscreen horizontally;
        // the top/bottom walls keep bouncing it regardless.
        if (!landed) {
            originX += Math.cos(driftAngle) * ORIGIN_SPEED * dt;
            originY += Math.sin(driftAngle) * ORIGIN_SPEED * dt;
        }
        const minX = box.left + radius, maxX = box.right - radius;
        const minY = box.top + radius, maxY = box.bottom - radius;
        if (!released) {
            if (originX < minX) {
                originX = minX;
                driftAngle = avoidVertical(Math.PI - driftAngle + bounceJitter());
            } else if (originX > maxX) {
                originX = maxX;
                driftAngle = avoidVertical(Math.PI - driftAngle + bounceJitter());
            }
        }
        if (originY < minY) {
            originY = minY;
            driftAngle = avoidVertical(-driftAngle + bounceJitter());
        } else if (originY > maxY) {
            originY = maxY;
            driftAngle = avoidVertical(-driftAngle + bounceJitter());
        }

        if (landed && released) {
            landed = false;
            [destX, destY] = newDest(originX, originY, radius, []);
            nextDestAt = 0;
        }

        if (landed) {
            if (settling) {
                const f = Math.pow(LAND_SETTLE_FRICTION, dt);
                vx *= f;
                vy *= f;
                x += vx * dt;
                y += vy * dt;
                const speed = Math.sqrt(vx * vx + vy * vy);
                if (speed > 1) facing = Math.atan2(vy, vx);
                if (speed < 2) {
                    settling = false;
                    vx = 0;
                    vy = 0;
                    landFacing = facing;
                    wiggleEnd = 0;
                    wigglePauseEnd = now + randomBetween(300, 800);
                }
            } else {
                if (now >= wigglePauseEnd && now >= wiggleEnd) {
                    wiggleTarget = (Math.random() - 0.5) * 2 * WIGGLE_MAX;
                    wiggleProgress = 0;
                    wiggleEnd = now + randomBetween(200, 500);
                    wigglePauseEnd = 0;
                }
                if (now < wiggleEnd) {
                    wiggleProgress = Math.min(1, wiggleProgress + dt * 4);
                    const eased = wiggleProgress * wiggleProgress * (3 - 2 * wiggleProgress);
                    landFacing += wiggleTarget * eased * dt * 4;
                } else if (wigglePauseEnd === 0) {
                    wigglePauseEnd = now + randomBetween(400, 1200);
                }
                facing = landFacing;
            }
            if (now >= landEnd) {
                landed = false;
                settling = false;
                [destX, destY] = newDest(originX, originY, radius, getTextRects());
                nextDestAt = 0;
            }
        } else {
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

            // Pick a new dest once close to the current one
            const dxDest = x - destX, dyDest = y - destY;
            if (dxDest * dxDest + dyDest * dyDest < 15 * 15) {
                if (nextDestAt === 0) nextDestAt = now + randomBetween(100, 500);
                if (now >= nextDestAt) {
                    const rects = released ? [] : getTextRects();
                    if (!released && Math.random() < LAND_CHANCE && pointOverText(x, y, rects)) {
                        landed = true;
                        settling = true;
                        landEnd = now + randomBetween(LAND_DURATION_MIN, LAND_DURATION_MAX);
                    } else {
                        [destX, destY] = newDest(originX, originY, radius, rects);
                    }
                    nextDestAt = 0;
                }
            } else {
                nextDestAt = 0;
            }
        }

        render();

        // Once released and fully clear of the viewport, stop and remove the
        // butterfly for good.
        if (released && (x < -50 || x > window.innerWidth + 50 || y < -50 || y > window.innerHeight + 50)) {
            el.remove();
            if (debugCanvas) debugCanvas.remove();
            return;
        }

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
