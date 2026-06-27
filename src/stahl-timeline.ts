// Generic "Step" data model for the Stahl Shrine recipe slideshow: the shape
// of a step's transition timeline, continuous loops, per-frame effects, and
// countdown timer, shared by every step's definition (see src/stahl-steps/*)
// and consumed by SceneAnimator (stahl-animator.ts).

import { type SceneObject } from "./ascii-compositor";
import { type ObjectLayout } from "./stahl-props";
import { type SceneAnimator } from "./stahl-animator";

export interface TransitionKeyframe {
    // Time offset from the start of the transition, in ms.
    t: number;
    objects: Partial<Record<string, Partial<ObjectLayout>>>;
}

// A self-contained chunk of a step's transition timeline: `keyframes[].t` are
// relative to this sequence's own start (0..duration). Used to compose a
// step's transitionKeyframes/transitionDuration out of pieces that can be
// concatenated in a runtime-chosen order (e.g. step 2's three pour
// sequences, randomly reordered, followed by the stir rod's descent).
export interface Sequence {
    duration: number;
    keyframes: TransitionKeyframe[];
}

// Concatenates `sequences` in order into a single keyframe list (with each
// sequence's `t` shifted by its cumulative start offset) plus the total
// duration.
export function concatSequences(sequences: Sequence[]): { keyframes: TransitionKeyframe[]; duration: number } {
    let offset = 0;
    const keyframes: TransitionKeyframe[] = [];
    for (const seq of sequences) {
        for (const kf of seq.keyframes) {
            keyframes.push({ t: kf.t + offset, objects: kf.objects });
        }
        offset += seq.duration;
    }
    return { keyframes, duration: offset };
}

export interface WaitCondition {
    kind: "wait";
    predicate: () => boolean;
}

export type TimelineSegment = Sequence | WaitCondition;

// A timeline with condition-based pauses between fixed sequences. Keyframe
// `t` values after a wait are shifted by however long the wait actually
// took, so interpolation works seamlessly. Call `update(elapsed)` each
// frame; when a wait's predicate fires, `version` increments and
// `keyframes`/`duration` reflect the newly-unlocked segments.
export class DynamicTimeline {
    private segments: TimelineSegment[];
    private resolvedKeyframes: TransitionKeyframe[] = [];
    private resolvedDuration = 0;
    private nextSegIndex = 0;
    private offset = 0;
    version = 0;
    readonly minDuration: number;

    constructor(segments: TimelineSegment[]) {
        this.segments = segments;
        let dur = 0;
        for (const s of segments) if (!("kind" in s)) dur += s.duration;
        this.minDuration = dur;
        this.advance();
    }

    private advance(): void {
        while (this.nextSegIndex < this.segments.length) {
            const seg = this.segments[this.nextSegIndex];
            if ("kind" in seg) break;
            for (const kf of seg.keyframes) {
                this.resolvedKeyframes.push({ t: kf.t + this.offset, objects: kf.objects });
            }
            this.offset += seg.duration;
            this.resolvedDuration = this.offset;
            this.nextSegIndex++;
        }
    }

    get duration(): number {
        return this.nextSegIndex < this.segments.length ? Infinity : this.resolvedDuration;
    }

    get keyframes(): TransitionKeyframe[] {
        return this.resolvedKeyframes;
    }

    update(elapsed: number): void {
        if (this.nextSegIndex >= this.segments.length) return;
        const seg = this.segments[this.nextSegIndex];
        if (!("kind" in seg)) return;
        if (seg.predicate()) {
            this.offset = elapsed;
            this.nextSegIndex++;
            this.version++;
            this.advance();
        }
    }
}

export interface ContinuousSpin {
    kind: "spin";
    id: string;
    // Radians per second, applied once the transition finishes.
    angularVelocity: number;
}

// Pulses a bladeSprite's arms in and out (e.g. o, -o-, --o--, ---o---, --o--,
// -o-, repeat) once the transition finishes.
export interface BladePulse {
    kind: "pulse";
    id: string;
    maxRadius: number;
    // Time, in ms, for the radius to go 0 -> maxRadius -> 0 (one full cycle).
    period: number;
}

// Continues ticking a transition's StepEffect after the transition finishes,
// with `t` continuing to increase from where the transition left off (e.g.
// step 3's IceParticleEffect, which keeps spawning ice for as long as the
// fridge is shown).
export interface EffectLoop {
    kind: "effect";
    effect: StepEffect;
}

export type Loop = ContinuousSpin | BladePulse | EffectLoop;

// A short-lived particle (e.g. an ethanol or tartaric-acid drop) falling from
// a prop's spout into the glass. `startT`/`duration` are relative to the
// transition's elapsed time; `SceneAnimator.updateDrops` advances `obj` along
// `arcLerp(from, to, ...)` while `startT <= elapsed < startT + duration`, then
// removes it from the compositor once it lands.
export interface DropAnimation {
    obj: SceneObject;
    from: ObjectLayout;
    to: ObjectLayout;
    startT: number;
    duration: number;
    arcHeight: number;
}

// A self-contained per-frame side effect for a step's transition, beyond the
// generic keyframe interpolation `playTransition` already applies to every
// object's timeline. Each effect is constructed fresh per `playTransition`
// call (so any internal state, e.g. GroupArcTransfer's released/landed flags,
// starts clean) and `tick` is called once per frame with the transition's
// elapsed time (ms), in declaration order. Used for things keyframes can't
// express directly: particles transferring between PropGroups (pours,
// drops), or one-shot state changes triggered partway through a transition
// (e.g. the liquid filling the glass once the bottle's pour lands).
export interface StepEffect {
    tick(t: number, anim: SceneAnimator): void;
}

// A countdown timer shown once a step settles (e.g. "stir for 10 minutes",
// "refrigerate for 20 minutes"). `startDelay` is how long after the
// transition finishes the timer appears; `preElapsed` is how much time it
// shows as already elapsed at that moment (e.g. step 2's timer appears 5s
// into the stir, so it starts at 9:55 rather than 10:00). The timer is
// hidden as soon as a different step is selected, regardless of whether it
// reached 0.
export interface CountdownConfig {
    totalSeconds: number;
    startDelay: number;
    preElapsed?: number;
    // Called once when the countdown reaches 0 (not called if interrupted by
    // a step change).
    onComplete?: (anim: SceneAnimator) => void;
}

// Formats a remaining-seconds count as "mm:ss" for the countdown timer.
export function formatCountdown(seconds: number): string {
    const total = Math.ceil(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

export const COUNTDOWN_TIMER_ID = "countdownTimer";
export const COUNTDOWN_TIMER_Y = 0;
export const COUNTDOWN_TIMER_Z = 10;

export interface SubstepRange {
    id: string;
    start: number;
    end: number;
}

export interface Step {
    // How long the pan/transition animation takes, in ms. When a
    // DynamicTimeline is used, this is the minimum duration (waits extend it).
    transitionDuration: number;
    // Sparse waypoints during the transition. When a DynamicTimeline is
    // provided, its keyframes override these.
    transitionKeyframes?: TransitionKeyframe[];
    // Optional dynamic timeline with wait conditions. When present,
    // transitionDuration/transitionKeyframes are derived from it.
    timeline?: DynamicTimeline;
    // Continuous animations that start once the transition finishes. Given
    // this transition's `effects` (see below) so an EffectLoop can continue
    // ticking the same effect instance used during the transition.
    loops?: (effects: StepEffect[]) => Loop[];
    // Factory for this step's per-frame effects (see StepEffect), called once
    // per `playTransition` invocation so each effect's internal state starts
    // fresh.
    effects?: (anim: SceneAnimator) => StepEffect[];
    // Countdown timer to show once the transition (plus `startDelay`)
    // finishes; see CountdownConfig.
    countdown?: CountdownConfig;
    // Called once the transition finishes for real (not during fast-forward
    // or instant replays of earlier steps). Used for one-shot effects outside
    // the keyframe/loop/countdown system, e.g. step 6's fireworks finale.
    onSettle?: (anim: SceneAnimator) => void;
    substeps?: SubstepRange[];
}
