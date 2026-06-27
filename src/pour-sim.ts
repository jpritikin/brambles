import { CELL_ASPECT } from "./ascii-compositor";

// 2D particle physics for pouring liquids/powders between containers.
//
// Particles live in a container's local physical space (the polygon points
// scaled by CELL_ASPECT for square units). Gravity is rotated into the
// container's frame each step so the walls never need recomputing.
// When a particle exits the source, it's transformed into the target's
// local frame and collides with those walls instead.

export type PourParticleKind = "liquid" | "powder";

export interface PourParticle {
    x: number;    // local physical space of current container
    y: number;
    vx: number;
    vy: number;
    airborne: boolean;
    landed: boolean;
    kind: PourParticleKind;
}

export interface Segment {
    x1: number; y1: number;
    x2: number; y2: number;
    nx: number; ny: number;  // inward normal
}

const GRAVITY = 80;
const FRICTION = 0.1;
const RESTITUTION = 0.05;
const PARTICLE_RADIUS = 0.4;
const MAX_DISPLACEMENT = PARTICLE_RADIUS * 0.5;
const LAND_SPEED = 4;
const SEPARATION_STRENGTH = 200;
const EXIT_THRESHOLD = 0.5;

interface BuildResult { walls: Segment[]; gapSeg: Segment | null; }

// Build wall segments from polygon points in local physical space (y scaled
// by CELL_ASPECT). Inward normals point toward the centroid. For open
// polygons, also returns a "gap segment" spanning the opening with its
// normal pointing outward—used to detect when a particle exits.
function buildSegmentsWithGap(points: Array<[number, number]>, pivot: [number, number], closed: boolean, margin = 0): BuildResult {
    const physical = points.map(([dx, dy]) => [dx - pivot[0], (dy - pivot[1]) * CELL_ASPECT] as [number, number]);
    let cx = 0, cy = 0;
    for (const [x, y] of physical) { cx += x; cy += y; }
    cx /= physical.length; cy /= physical.length;

    const segs: Segment[] = [];
    const n = physical.length;
    const limit = closed ? n : n - 1;
    for (let i = 0; i < limit; i++) {
        const [x1, y1] = physical[i];
        const [x2, y2] = physical[(i + 1) % n];
        const edx = x2 - x1, edy = y2 - y1;
        const len = Math.hypot(edx, edy);
        if (len === 0) continue;
        const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
        let nx = -edy / len, ny = edx / len;
        if ((cx - midX) * nx + (cy - midY) * ny < 0) { nx = -nx; ny = -ny; }
        const m = margin * (Math.abs(nx) + Math.abs(ny) * CELL_ASPECT);
        segs.push({ x1: x1 + nx * m, y1: y1 + ny * m, x2: x2 + nx * m, y2: y2 + ny * m, nx, ny });
    }

    let gapSeg: Segment | null = null;
    if (!closed && n >= 2) {
        const [x1, y1] = physical[n - 1];
        const [x2, y2] = physical[0];
        const edx = x2 - x1, edy = y2 - y1;
        const len = Math.hypot(edx, edy);
        if (len > 0) {
            const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
            let nx = -edy / len, ny = edx / len;
            // Outward normal: points away from centroid
            if ((cx - midX) * nx + (cy - midY) * ny > 0) { nx = -nx; ny = -ny; }
            gapSeg = { x1, y1, x2, y2, nx, ny };
        }
    }

    return { walls: segs, gapSeg };
}

function buildSegments(points: Array<[number, number]>, pivot: [number, number], closed: boolean): Segment[] {
    return buildSegmentsWithGap(points, pivot, closed).walls;
}

function signedDistToLine(px: number, py: number, seg: Segment): number {
    return (px - seg.x1) * seg.nx + (py - seg.y1) * seg.ny;
}

function projectOnSegment(px: number, py: number, seg: Segment): { cx: number; cy: number; t: number } {
    const edx = seg.x2 - seg.x1, edy = seg.y2 - seg.y1;
    const lenSq = edx * edx + edy * edy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - seg.x1) * edx + (py - seg.y1) * edy) / lenSq));
    return { cx: seg.x1 + t * edx, cy: seg.y1 + t * edy, t };
}

const FRICTION_BY_KIND: Record<PourParticleKind, number> = { liquid: FRICTION, powder: 0.8 };

function resolveCollisions(p: PourParticle, walls: Segment[], canLand: boolean): void {
    const friction = FRICTION_BY_KIND[p.kind];
    for (let iter = 0; iter < 4; iter++) {
        let worstPen = 0;
        let worstSeg: Segment | null = null;

        for (const seg of walls) {
            const proj = projectOnSegment(p.x, p.y, seg);
            const dist = Math.hypot(p.x - proj.cx, p.y - proj.cy);
            const side = signedDistToLine(p.x, p.y, seg);
            if (side < PARTICLE_RADIUS) {
                const pen = PARTICLE_RADIUS - side;
                if (proj.t > 0.001 && proj.t < 0.999) {
                    if (pen > worstPen) { worstPen = pen; worstSeg = seg; }
                } else if (dist < PARTICLE_RADIUS && PARTICLE_RADIUS - dist > worstPen) {
                    worstPen = PARTICLE_RADIUS - dist; worstSeg = seg;
                }
            }
        }
        if (!worstSeg) break;

        p.x += worstSeg.nx * worstPen;
        p.y += worstSeg.ny * worstPen;
        const vn = p.vx * worstSeg.nx + p.vy * worstSeg.ny;
        if (vn < 0) {
            const edx = worstSeg.x2 - worstSeg.x1, edy = worstSeg.y2 - worstSeg.y1;
            const len = Math.hypot(edx, edy);
            const tx = edx / len, ty = edy / len;
            const vt = p.vx * tx + p.vy * ty;
            p.vx = worstSeg.nx * (-vn * RESTITUTION) + tx * (vt * (1 - friction));
            p.vy = worstSeg.ny * (-vn * RESTITUTION) + ty * (vt * (1 - friction));
            if (canLand && Math.hypot(p.vx, p.vy) < LAND_SPEED) {
                p.vx = 0; p.vy = 0; p.landed = true; return;
            }
        }
    }
}

// Transform local physical coords to world grid coords given container state.
function localToGrid(lx: number, ly: number, state: ContainerState, pivot: [number, number]): [number, number] {
    const cos = Math.cos(state.rotation), sin = Math.sin(state.rotation);
    const wx = lx * cos - ly * sin;
    const wy = lx * sin + ly * cos;
    return [state.x + pivot[0] + wx, state.y + pivot[1] + wy / CELL_ASPECT];
}

// Transform world grid coords to local physical coords.
function gridToLocal(gx: number, gy: number, state: ContainerState, pivot: [number, number]): [number, number] {
    const dx = gx - state.x - pivot[0];
    const dy = (gy - state.y - pivot[1]) * CELL_ASPECT;
    const cos = Math.cos(-state.rotation), sin = Math.sin(-state.rotation);
    return [dx * cos - dy * sin, dx * sin + dy * cos];
}

// Transform from source local physical to target local physical.
function sourceToTarget(
    lx: number, ly: number, vx: number, vy: number,
    source: ContainerState, sPivot: [number, number],
    target: ContainerState, tPivot: [number, number],
): { x: number; y: number; vx: number; vy: number } {
    // Local → world physical
    const sCos = Math.cos(source.rotation), sSin = Math.sin(source.rotation);
    const wpx = (source.x + sPivot[0]) + lx * sCos - ly * sSin;
    const wpy = (source.y + sPivot[1]) * CELL_ASPECT + lx * sSin + ly * sCos;
    const wvx = vx * sCos - vy * sSin;
    const wvy = vx * sSin + vy * sCos;
    // World physical → target local
    const tCos = Math.cos(-target.rotation), tSin = Math.sin(-target.rotation);
    const tdx = wpx - (target.x + tPivot[0]);
    const tdy = wpy - (target.y + tPivot[1]) * CELL_ASPECT;
    return {
        x: tdx * tCos - tdy * tSin,
        y: tdx * tSin + tdy * tCos,
        vx: wvx * tCos - wvy * tSin,
        vy: wvx * tSin + wvy * tCos,
    };
}

export interface PourSimConfig {
    sourcePoints: Array<[number, number]>;
    sourceClosed: boolean;
    sourcePivot?: [number, number];
    targetPoints: Array<[number, number]>;
    targetClosed: boolean;
    targetPivot?: [number, number];
    // Inward margin (in grid cells) applied to wall segments, scaled by
    // wall orientation so 1 = one character cell from every wall.
    wallMargin?: number;
}

export interface ContainerState {
    x: number;
    y: number;
    rotation: number;
}

export type OnLandCallback = (i: number, sourceBatch: number, destBatch: number) => void;

export class PourSim {
    particles: PourParticle[] = [];
    readonly sourceWalls: Segment[];
    readonly targetWalls: Segment[];
    readonly sourcePivot: [number, number];
    readonly targetPivot: [number, number];
    private sourceGapSeg: Segment | null;
    private landedCount = 0;
    private sourceDrained = 0;
    private destAdded = 0;
    private sourceTotal: number;
    private destTotal: number;
    private pourKind: PourParticleKind;
    private onLand: OnLandCallback | null;
    private prevSource: ContainerState | null = null;
    private prevTarget: ContainerState | null = null;
    private srcVel = { x: 0, y: 0 };
    private tgtVel = { x: 0, y: 0 };
    exitedCount = 0;

    constructor(
        config: PourSimConfig,
        sourceTotal = 0,
        destTotal = 0,
        onLand: OnLandCallback | null = null,
        pourKind: PourParticleKind = "liquid",
    ) {
        this.sourcePivot = config.sourcePivot ?? [0, 0];
        this.targetPivot = config.targetPivot ?? [0, 0];
        const margin = config.wallMargin ?? 0.5;
        const src = buildSegmentsWithGap(config.sourcePoints, this.sourcePivot, config.sourceClosed, margin);
        this.sourceWalls = src.walls;
        this.sourceGapSeg = src.gapSeg;
        this.targetWalls = buildSegments(config.targetPoints, this.targetPivot, config.targetClosed);
        this.sourceTotal = sourceTotal;
        this.destTotal = destTotal;
        this.onLand = onLand;
        this.pourKind = pourKind;
    }

    // Add particle at a position in the source container's local grid coords
    // (relative to origin, before pivot adjustment — i.e. the same frame as
    // the polygon points and PropGroup member relX/relY).
    addParticleLocal(relX: number, relY: number, kind: PourParticleKind = "liquid"): PourParticle {
        const px = relX - this.sourcePivot[0];
        const py = (relY - this.sourcePivot[1]) * CELL_ASPECT;
        const p: PourParticle = { x: px, y: py, vx: 0, vy: 0, airborne: false, landed: false, kind };
        this.particles.push(p);
        if (kind === this.pourKind) this.pourParticleCount++;
        return p;
    }

    step(dt: number, source: ContainerState, target: ContainerState): void {
        // Gravity in world space is (0, GRAVITY). Rotate into each
        // container's local physical frame. The x-component is scaled by
        // CELL_ASPECT because the walls are built with y stretched—the
        // effective slope is steeper than the visual tilt, so particles
        // need proportionally more horizontal force to slide toward the
        // opening.
        const sCos = Math.cos(-source.rotation), sSin = Math.sin(-source.rotation);
        const sGx = GRAVITY * (-sSin) * CELL_ASPECT;
        const sGy = GRAVITY * sCos;
        const tCos = Math.cos(-target.rotation), tSin = Math.sin(-target.rotation);
        const tGx = GRAVITY * (-tSin) * CELL_ASPECT;
        const tGy = GRAVITY * tCos;

        // Inertial pseudo-forces from container acceleration. Compute
        // world-space velocity, then acceleration (change in velocity),
        // rotate into local physical frame, and negate—so a sudden stop
        // jolts particles forward.
        let sInertX = 0, sInertY = 0;
        let tInertX = 0, tInertY = 0;
        if (this.prevSource && dt > 0) {
            const vx = (source.x - this.prevSource.x) / dt;
            const vy = (source.y - this.prevSource.y) * CELL_ASPECT / dt;
            const ax = -(vx - this.srcVel.x) / dt;
            const ay = -(vy - this.srcVel.y) / dt;
            sInertX = ax * sCos - ay * sSin;
            sInertY = ax * sSin + ay * sCos;
            this.srcVel = { x: vx, y: vy };
        }
        if (this.prevTarget && dt > 0) {
            const vx = (target.x - this.prevTarget.x) / dt;
            const vy = (target.y - this.prevTarget.y) * CELL_ASPECT / dt;
            const ax = -(vx - this.tgtVel.x) / dt;
            const ay = -(vy - this.tgtVel.y) / dt;
            tInertX = ax * tCos - ay * tSin;
            tInertY = ax * tSin + ay * tCos;
            this.tgtVel = { x: vx, y: vy };
        }
        this.prevSource = { ...source };
        this.prevTarget = { ...target };

        let maxSpeed = GRAVITY * dt;
        for (const p of this.particles) {
            if (p.landed) continue;
            const s = Math.hypot(p.vx, p.vy);
            if (s > maxSpeed) maxSpeed = s;
        }
        const maxSubDt = maxSpeed > 0 ? MAX_DISPLACEMENT / maxSpeed : dt;
        const subSteps = Math.max(1, Math.ceil(dt / maxSubDt));
        const subDt = dt / subSteps;
        for (let i = 0; i < subSteps; i++) {
            // Particle-particle separation: push overlapping particles apart
            const sep = PARTICLE_RADIUS * 2;
            for (let a = 0; a < this.particles.length; a++) {
                const pa = this.particles[a];
                if (pa.landed) continue;
                for (let b = a + 1; b < this.particles.length; b++) {
                    const pb = this.particles[b];
                    if (pb.landed || pa.airborne !== pb.airborne || pa.kind !== pb.kind) continue;
                    const dx = pb.x - pa.x, dy = pb.y - pa.y;
                    const dist = Math.hypot(dx, dy);
                    if (dist < sep && dist > 0.001) {
                        const overlap = sep - dist;
                        const nx = dx / dist, ny = dy / dist;
                        const push = overlap * 0.5;
                        pa.x -= nx * push;
                        pa.y -= ny * push;
                        pb.x += nx * push;
                        pb.y += ny * push;
                        const force = SEPARATION_STRENGTH * overlap * subDt;
                        pa.vx -= nx * force;
                        pa.vy -= ny * force;
                        pb.vx += nx * force;
                        pb.vy += ny * force;
                    }
                }
            }

            for (const p of this.particles) {
                if (p.landed) continue;
                const wasLanded = p.landed;

                if (!p.airborne) {
                    p.vx += (sGx + sInertX) * subDt;
                    p.vy += (sGy + sInertY) * subDt;
                    p.x += p.vx * subDt;
                    p.y += p.vy * subDt;
                    resolveCollisions(p, this.sourceWalls, false);
                    const exited = p.kind === this.pourKind && this.sourceGapSeg
                        ? signedDistToLine(p.x, p.y, this.sourceGapSeg) > 0
                        : false;
                    if (exited) {
                        this.exitedCount++;
                        const t = sourceToTarget(
                            p.x, p.y, p.vx, p.vy,
                            source, this.sourcePivot,
                            target, this.targetPivot,
                        );
                        p.x = t.x; p.y = t.y; p.vx = t.vx; p.vy = t.vy;
                        p.airborne = true;
                    }
                } else {
                    p.vx += (tGx + tInertX) * subDt;
                    p.vy += (tGy + tInertY) * subDt;
                    p.x += p.vx * subDt;
                    p.y += p.vy * subDt;
                    resolveCollisions(p, this.targetWalls, true);
                }

                if (!wasLanded && p.landed) this.handleLanding();
            }
        }
    }

    private pourParticleCount = 0;

    private handleLanding(): void {
        this.landedCount++;
        if (!this.onLand) return;
        const K = this.pourParticleCount;
        if (K === 0) return;
        const newSourceDrained = Math.floor(this.landedCount * this.sourceTotal / K);
        const newDestAdded = Math.floor(this.landedCount * this.destTotal / K);
        this.onLand(this.landedCount - 1, newSourceDrained - this.sourceDrained, newDestAdded - this.destAdded);
        this.sourceDrained = newSourceDrained;
        this.destAdded = newDestAdded;
    }

    // Get particle position in world grid coords.
    gridPos(p: PourParticle, source: ContainerState, target: ContainerState): [number, number] {
        if (p.airborne || p.landed) {
            return localToGrid(p.x, p.y, target, this.targetPivot);
        }
        return localToGrid(p.x, p.y, source, this.sourcePivot);
    }

    allLanded(): boolean {
        const pour = this.particles.filter(p => p.kind === this.pourKind);
        return pour.length > 0 && pour.every(p => p.landed);
    }

    allSettled(): boolean {
        if (this.exitedCount === 0) return false;
        const pour = this.particles.filter(p => p.kind === this.pourKind);
        return pour.length > 0 && pour.every(p =>
            p.landed || (!p.airborne && Math.hypot(p.vx, p.vy) < LAND_SPEED),
        );
    }
}
