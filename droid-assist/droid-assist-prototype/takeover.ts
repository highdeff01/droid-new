import type { RegulateCommand, RegulatePayload, StepOpinionPayload, TakeoverPayload } from './main-bridge-protocol.js';
import type { StepStatus, WorkflowStep } from './types.js';

/** How long the first step of a run has to be verified complete before it is handed to droid-main. */
export const TAKEOVER_MS = 10_000;
/** Log lines handed over with a takeover. */
export const TAKEOVER_LOG_LINES = 20;
/** Log source of every takeover line. */
export const TAKEOVER_SOURCE = 'Takeover';

/** Which app performs a step: droid-new (assist, the boss) or droid-main. */
export type StepOwner = 'assist' | 'main';

/** Where one step stands under the shared completion rule. */
export type StepAgreementState = 'unverified' | 'awaiting agreement' | 'disagreement' | 'complete';

/** Droid-new's verification and both sides' agents' opinions of one step. */
export interface StepAgreement {
  index: number;
  step: string;
  owner: StepOwner;
  /** Droid-new's verification: null until it ran. */
  verified: boolean | null;
  /** Droid-new's agents' opinion; undefined until they gave one. */
  local?: boolean;
  /** Droid-main's agents' opinion; undefined until a step_opinion arrived. */
  remote?: boolean;
  startedAt: number;
}

/** A step is complete only when droid-new's verification passed AND both sides' agents agree. */
export const stepComplete = (verified: boolean | null, local: boolean | undefined, remote: boolean | undefined): boolean => verified === true && local === true && remote === true;

/** The state of a step: a missing opinion (e.g. the bridge is down) waits, never completes. */
export function agreementState(a: StepAgreement): StepAgreementState {
  if (a.verified !== true) return 'unverified';
  if (a.local === false || a.remote === false) return 'disagreement';
  return stepComplete(a.verified, a.local, a.remote) ? 'complete' : 'awaiting agreement';
}

/** A fresh agreement record for a step droid-new starts. */
export const startStep = (index: number, step: string, now: number, owner: StepOwner = 'assist'): StepAgreement => ({ index, step, owner, verified: null, startedAt: now });

/** Records droid-main's agents' opinion when it is about this step. */
export const withRemoteOpinion = (a: StepAgreement, o: StepOpinionPayload): StepAgreement => (o.index === a.index ? { ...a, remote: o.agree } : a);

/** The agreements with droid-main's opinion recorded (a step droid-new has not started yet gets a record of its own). */
export function addRemoteOpinion(list: readonly StepAgreement[], o: StepOpinionPayload, now: number): StepAgreement[] {
  const known = list.some((a) => a.index === o.index);
  return known ? list.map((a) => withRemoteOpinion(a, o)) : [...list, { ...startStep(o.index, o.step, now), remote: o.agree }];
}

/** An inbound takeover recorded in the agreements. */
export function addTakeover(list: readonly StepAgreement[], t: TakeoverPayload, now: number): StepAgreement[] {
  const prev = list.find((a) => a.index === t.index) ?? null;
  return [...list.filter((a) => a !== prev), acceptTakeover(prev, t, now)].sort((x, y) => x.index - y.index);
}

/** Droid-new's verification of a step from its run status: done passed, failed/drift failed, otherwise not yet. */
export const verificationOf = (status: StepStatus): boolean | null => (status === 'done' ? true : status === 'failed' || status === 'drift' ? false : null);

/**
 * Brings the agreements up to date with the run: every started step has a record, droid-new's
 * verification follows the step's status, and once verified its agents give their opinion
 * (agree only when verification passed and the step's target is not disputed).
 */
export function syncAgreements(prev: readonly StepAgreement[], steps: readonly WorkflowStep[], now: number, disputed: (step: WorkflowStep) => boolean): StepAgreement[] {
  const started = steps.flatMap((step, index) => (step.status === 'pending' ? [] : [{ step, index }]));
  const synced = started.map(({ step, index }) => {
    const a = prev.find((x) => x.index === index) ?? startStep(index, step.name, now);
    const verified = verificationOf(step.status);
    const local = verified === null ? a.local : verified && !disputed(step);
    return { ...a, verified, ...(local === undefined ? {} : { local }) };
  });
  const untouched = prev.filter((a) => !synced.some((s) => s.index === a.index));
  return [...synced, ...untouched].sort((x, y) => x.index - y.index);
}

/** Only the first step of a run, still owned by droid-new and not complete after TAKEOVER_MS, is handed off. */
export const shouldHandOff = (a: StepAgreement, now: number): boolean =>
  a.index === 0 && a.owner === 'assist' && agreementState(a) !== 'complete' && now - a.startedAt >= TAKEOVER_MS;

/** The takeover message carrying the step's full context to the other app. */
export function takeoverPayload(goal: string, steps: readonly string[], a: StepAgreement, log: readonly string[], reason: string): TakeoverPayload {
  return { reason, goal, index: a.index, step: a.step, steps: [...steps], log: log.slice(-TAKEOVER_LOG_LINES) };
}

/** Why the first step is handed over: what is still missing from its completion. */
export function handOffReason(a: StepAgreement): string {
  const state = agreementState(a);
  return `step ${a.index + 1} "${a.step}" not verified complete within ${TAKEOVER_MS / 1000} s (${state})`;
}

/** An inbound takeover: droid-main takes the step; droid-new stays arbiter. */
export const acceptTakeover = (a: StepAgreement | null, t: TakeoverPayload, now: number): StepAgreement =>
  a && a.index === t.index ? { ...a, owner: 'main' } : startStep(t.index, t.step, now, 'main');

/** The arbiter's ruling on a disagreement: droid-new's verification is the verdict. */
export interface ArbiterRuling {
  complete: boolean;
  text: string;
}

/** Droid-new arbitrates: its verification decides whether the disputed step stands. */
export function arbitrate(a: StepAgreement): ArbiterRuling {
  const sides = `droid-new agents ${a.local === false ? 'disagree' : 'agree'}, droid-main agents ${a.remote === false ? 'disagree' : 'agree'}`;
  const complete = a.verified === true;
  return { complete, text: `Step ${a.index + 1} "${a.step}": ${sides} — droid-new (arbiter) rules it ${complete ? 'complete' : 'not complete'}` };
}

/** What a regulate command acts on, on either side. */
export interface RegulateTarget {
  pause(): void;
  stop(): void;
  resume(): void;
  setArmed(armed: boolean): void;
  setMode(mode: string): void;
}

/** Each regulate command's effect. */
export const REGULATE_EFFECTS: Readonly<Record<RegulateCommand, (t: RegulateTarget, p: RegulatePayload) => void>> = {
  pause: (t) => t.pause(),
  stop: (t) => t.stop(),
  resume: (t) => t.resume(),
  arm: (t) => t.setArmed(true),
  disarm: (t) => t.setArmed(false),
  mode: (t, p) => t.setMode(p.mode ?? ''),
};

/** Applies one regulate command and returns its log line. */
export function applyRegulate(p: RegulatePayload, target: RegulateTarget, from: string): string {
  REGULATE_EFFECTS[p.command](target, p);
  const what = p.command === 'mode' ? `mode → ${p.mode}` : p.command;
  return `${from} regulated this run: ${what}${p.reason ? ` (${p.reason})` : ''}`;
}
