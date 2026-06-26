import { type PropGroupMember, type SceneObject, type Sprite } from "./ascii-compositor";
import { type ContainerState, PourSim, type PourSimConfig } from "./pour-sim";
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
    // Called when all particles have landed or settled.
    onAllLanded?: (anim: SceneAnimator) => void;
}

export class PourTransfer implements StepEffect {
    private sim: PourSim | null = null;
    private visuals: SceneObject[] = [];
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
                const p = this.sim.addParticleLocal(member.relX, member.relY);
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

        for (let i = 0; i < this.sim.particles.length; i++) {
            const p = this.sim.particles[i];
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

        if (!this.minExitedFired && this.config.minExited != null && this.sim.exitedCount >= this.config.minExited) {
            this.minExitedFired = true;
            this.config.onMinExited?.(anim);
        }

        const done = this.config.doneWhen
            ? (this.minExitedFired && this.config.doneWhen())
            : this.sim.allLanded();
        if (done) {
            for (let i = 0; i < this.visuals.length; i++) {
                if (this.visuals[i].visible) {
                    this.visuals[i].visible = false;
                    anim.removeTransient(this.visuals[i].id);
                }
            }
            this.config.onAllLanded?.(anim);
            anim.unregisterPourSim(this.config.label);
            this.done = true;
        }
    }
}
