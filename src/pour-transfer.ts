import { type PropGroupMember, type SceneObject, type Sprite } from "./ascii-compositor";
import { type ContainerState, type PourParticle, type PourParticleKind, PourSim, type PourSimConfig } from "./pour-sim";
import { type StepEffect } from "./stahl-timeline";
import { type SceneAnimator } from "./stahl-animator";

export interface PourTransferConfig {
    label: string;
    initT: number;
    simConfig: PourSimConfig;
    visualIdPrefix: string;
    visualZ: number;

    getSourceMembers: (anim: SceneAnimator) => PropGroupMember[];
    getSourceState: (anim: SceneAnimator) => ContainerState;
    getTargetState: (anim: SceneAnimator) => ContainerState;

    // How many PourSim particles to create. null = 1:1 with source members.
    simParticleCount?: number | null;
    // How many source members to drain. null = all source members.
    sourceTotal?: number | null;
    // Sprite for the visual particles (null = use each source member's sprite).
    visualSprite?: Sprite | null;
    // Sort source members before processing.
    sortMembers?: (a: PropGroupMember, b: PropGroupMember) => number;

    destTotal: (sourceCount: number, anim: SceneAnimator) => number;
    onDrain: (count: number, members: PropGroupMember[], nextIdx: number, anim: SceneAnimator) => number;
    onFill: (count: number, anim: SceneAnimator) => void;

    // Called before PourSim init (e.g. to initialize a fluid sim).
    onPreInit?: (anim: SceneAnimator) => void;
    // Called each tick with dt (e.g. to step a fluid sim).
    onTick?: (dt: number, anim: SceneAnimator) => void;
    // When this many particles have exited the source, call onMinExited.
    minExited?: number;
    onMinExited?: (anim: SceneAnimator) => void;
    // When set, the transfer keeps running until this returns true (e.g.
    // the source container has returned to rest). Only checked after
    // minExited has fired.
    doneWhen?: () => boolean;
    // Hard deadline (elapsed ms): force completion at this time regardless
    // of particle state.
    deadline?: number;
    // Called for each remaining visible liquid visual when the pour ends
    // with particles still in the source (e.g. at deadline). Receives the
    // visual's world position so the caller can snapshot it back into a
    // PropGroup.
    onSnapshotRemaining?: (x: number, y: number, anim: SceneAnimator) => void;
    // Called when all particles have landed or settled.
    onAllLanded?: (anim: SceneAnimator) => void;
    // Extra particles added to the sim that participate in physics but
    // aren't tracked for drain/fill/landing (e.g. powder sitting in the
    // glass while liquid pours out).
    getBackgroundMembers?: (anim: SceneAnimator) => PropGroupMember[];
    backgroundKind?: PourParticleKind;
}

export class PourTransfer implements StepEffect {
    private sim: PourSim | null = null;
    private pourParticles: PourParticle[] = [];
    private visuals: SceneObject[] = [];
    private bgParticles: PourParticle[] = [];
    private bgVisuals: SceneObject[] = [];
    private bgMembers: PropGroupMember[] = [];
    private lastT: number | null = null;
    private sourceMembers: PropGroupMember[] = [];
    private nextSourceDrain = 0;
    private done = false;
    private minExitedFired = false;

    constructor(private config: PourTransferConfig) {}

    get isLanded(): boolean { return this.done; }

    tick(t: number, anim: SceneAnimator): void {
        if (this.done) return;
        if (t < this.config.initT) return;

        if (!this.sim) {
            this.config.onPreInit?.(anim);
            this.sourceMembers = this.config.getSourceMembers(anim);
            if (this.sourceMembers.length === 0) { this.done = true; return; }
            if (this.config.sortMembers) {
                this.sourceMembers.sort(this.config.sortMembers);
            }

            const sourceCount = this.sourceMembers.length;
            const effectiveSourceTotal = this.config.sourceTotal ?? sourceCount;
            const destTotal = this.config.destTotal(sourceCount, anim);
            const simCount = this.config.simParticleCount ?? sourceCount;
            const clampedSimCount = Math.min(simCount, sourceCount);

            this.sim = new PourSim(
                this.config.simConfig,
                effectiveSourceTotal, destTotal,
                (_i, srcBatch, dstBatch) => {
                    this.nextSourceDrain = this.config.onDrain(
                        srcBatch, this.sourceMembers, this.nextSourceDrain, anim,
                    );
                    this.config.onFill(dstBatch, anim);
                },
            );

            const sourceState = this.config.getSourceState(anim);
            const targetState = this.config.getTargetState(anim);
            for (let i = 0; i < clampedSimCount; i++) {
                const srcIdx = i;
                const member = this.sourceMembers[srcIdx];
                const p = this.sim.addParticleLocal(member.relX, member.relY, "liquid");
                this.pourParticles.push(p);
                const [gx, gy] = this.sim.gridPos(p, sourceState, targetState);
                member.obj.visible = false;
                const sprite = this.config.visualSprite ?? member.obj.sprite;
                const obj: SceneObject = {
                    id: `${this.config.visualIdPrefix}-${i}`,
                    sprite, x: gx, y: gy, z: this.config.visualZ,
                    rotation: 0, visible: true,
                };
                anim.addTransient(obj);
                this.visuals.push(obj);
            }
            if (this.config.getBackgroundMembers) {
                this.bgMembers = this.config.getBackgroundMembers(anim);
                const bgKind = this.config.backgroundKind ?? "powder";
                for (let i = 0; i < this.bgMembers.length; i++) {
                    const member = this.bgMembers[i];
                    const p = this.sim.addParticleLocal(member.relX, member.relY, bgKind);
                    this.bgParticles.push(p);
                    const [gx, gy] = this.sim.gridPos(p, sourceState, targetState);
                    member.obj.visible = false;
                    const obj: SceneObject = {
                        id: `${this.config.visualIdPrefix}-bg-${i}`,
                        sprite: member.obj.sprite, x: gx, y: gy,
                        z: this.config.visualZ - 1,
                        rotation: 0, visible: true,
                    };
                    anim.addTransient(obj);
                    this.bgVisuals.push(obj);
                }
            }

            anim.registerPourSim(
                this.config.label, this.sim,
                () => this.config.getSourceState(anim),
                () => this.config.getTargetState(anim),
            );
            this.lastT = t;
            return;
        }

        const dt = this.lastT !== null ? Math.max(0, t - this.lastT) / 1000 : 0;
        this.lastT = t;
        if (dt <= 0) return;

        this.config.onTick?.(dt, anim);

        const sourceState = this.config.getSourceState(anim);
        const targetState = this.config.getTargetState(anim);
        this.sim.step(dt, sourceState, targetState);

        for (let i = 0; i < this.pourParticles.length; i++) {
            const p = this.pourParticles[i];
            const obj = this.visuals[i];
            if (p.landed) {
                if (obj.visible) {
                    obj.visible = false;
                    anim.removeTransient(obj.id);
                }
            } else {
                const [gx, gy] = this.sim.gridPos(p, sourceState, targetState);
                obj.x = gx;
                obj.y = gy;
            }
        }
        for (let i = 0; i < this.bgParticles.length; i++) {
            const p = this.bgParticles[i];
            const obj = this.bgVisuals[i];
            const [gx, gy] = this.sim.gridPos(p, sourceState, targetState);
            obj.x = gx;
            obj.y = gy;
        }

        if (!this.minExitedFired && this.config.minExited != null && this.sim.exitedCount >= this.config.minExited) {
            this.minExitedFired = true;
            this.config.onMinExited?.(anim);
        }

        const done = this.config.deadline != null
            ? t >= this.config.deadline
            : (this.config.doneWhen
                ? (this.minExitedFired && this.config.doneWhen())
                : this.sim.allLanded());
        if (done) {
            const sourceState = this.config.getSourceState(anim);
            for (let i = 0; i < this.pourParticles.length; i++) {
                const p = this.pourParticles[i];
                const v = this.visuals[i];
                if (!p.airborne && !p.landed) {
                    const [gx, gy] = this.sim.gridPos(p, sourceState, targetState);
                    this.config.onSnapshotRemaining?.(gx, gy, anim);
                }
                if (v.visible) { v.visible = false; anim.removeTransient(v.id); }
            }
            for (let i = 0; i < this.bgVisuals.length; i++) {
                const vis = this.bgVisuals[i];
                anim.removeTransient(vis.id);
                this.bgMembers[i].relX = vis.x - sourceState.x;
                this.bgMembers[i].relY = vis.y - sourceState.y;
                this.bgMembers[i].obj.visible = true;
            }
            this.config.onAllLanded?.(anim);
            anim.unregisterPourSim(this.config.label);
            this.done = true;
        }
    }
}
