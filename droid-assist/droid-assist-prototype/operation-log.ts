import type { CaptureInput, ErrorKind } from './error-forwarding.js';
import type { OperationRecord } from './operation-db.js';
import { uid } from './planner.js';
import type { StepOutcome } from './run-step.js';
import type { WorkflowStep } from './types.js';
import type { WatchProposal } from './watcher.js';

/** Where an operation ran: the project, the actor and the app area. */
export interface OperationScope {
  project: string;
  agent: string;
  section: string;
}

/** The part of a record its builder decides; scope, id and time are added by `buildOperation`. */
export type OperationDraft = Omit<OperationRecord, 'id' | 'time' | 'project' | 'agent' | 'section'>;

/** The project an operation belongs to: the loaded flow's name, else the goal, else '(no project)'. */
export function projectOf(flowName: string | null | undefined, goal: string): string {
  return flowName?.trim() || goal.trim() || '(no project)';
}

/** A complete record from a scope and a draft. */
export function buildOperation(scope: OperationScope, draft: OperationDraft, time = Date.now()): OperationRecord {
  return { id: uid('op'), time, ...scope, ...draft };
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** A performed workflow step (track operation): the step as input, the real outcome as output. */
export function trackDraft(step: WorkflowStep, out: StepOutcome): OperationDraft {
  const element = step.target ?? step.name;
  const text = step.text ? ` with "${step.text}"` : '';
  const input = `${step.action} "${element}"${text} at (${pct(out.target.x)}, ${pct(out.target.y)})`;
  return { category: 'track', op: step.action, element, input, output: out.message, ok: out.ok };
}

/** An element-map/memory operation (remember, forget, map, unmap, bridge note). */
export function elementDraft(op: string, element: string, input: string, output: string, ok = true): OperationDraft {
  return { category: 'element', op, element, input, output, ok };
}

/** An app-capture operation (source switch, capture start/loss, screenshot). */
export function captureDraft(op: string, input: string, output: string, ok = true): OperationDraft {
  return { category: 'capture', op, input, output, ok };
}

/** The section each error kind is raised in. */
const ERROR_SECTION: Record<ErrorKind, string> = { ai: 'ai', step: 'executor', drift: 'drift', bridge: 'bridge', watcher: 'screenWatcher', test: 'errors', 'main-app': 'mainBridge' };

/** The scope fields an error belongs to, from its kind. */
export const errorSection = (kind: ErrorKind) => ERROR_SECTION[kind];

/** A captured error: the goal as input, the error message as output. */
export function errorDraft(input: CaptureInput): OperationDraft {
  return { category: 'error', op: input.kind, errorKind: input.kind, ...(input.step ? { element: input.step } : {}), input: input.goal ?? '', output: input.message, ok: false };
}

/** A watcher idea's lifecycle event (proposed, accepted, dismissed, tested). */
export function ideaDraft(op: string, p: WatchProposal, output: string, ok = true): OperationDraft {
  return { category: 'idea', op, ...(p.target ? { element: p.target } : {}), input: `${p.kind}: ${p.text}`, output, ok };
}
