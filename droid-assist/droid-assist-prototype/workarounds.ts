import type { Frame, WorkflowStep } from './types.js';
import { STEP_ACTIONS } from './types.js';
import { SAMPLE_VIEW, parseJsonReply } from './ai.js';
import type { AskFn, ViewSize } from './ai.js';
import { gridPrompt, replyPoint } from './grid.js';
import { similarity, uid } from './planner.js';
import type { Thought } from './assist-ai.js';
import { WORKFLOW_EDIT_KINDS, applyEdits, type WorkflowEdit, type WorkflowEditKind } from './initiative.js';

/** A known on-screen element a failed step's target may have moved to. */
export interface KnownPoint {
  name: string;
  x: number;
  y: number;
}

/** How alike a known element's name must be to a step's target to stand in for it. */
const SAME_TARGET = 0.6;
/** How far (normalized) a known element must be from the failed point to count as an alternate target. */
const MOVED = 0.01;

/** A workaround: the edits and why. */
export interface Workaround extends Thought {
  edits: WorkflowEdit[];
  reason: string;
}

const nameOf = (s: WorkflowStep) => s.target ?? s.name;

/**
 * The workaround the engine can make without the model: an alternate target when a known element
 * of the same name sits elsewhere, otherwise a short wait added before the failed step (a slow
 * screen is the commonest cause). Null when the failed step is already preceded by a wait.
 */
export function localWorkaround(steps: WorkflowStep[], failed: number, known: KnownPoint[]): Workaround | null {
  const step = steps[failed - 1];
  if (!step) return null;
  const name = nameOf(step);
  const alt = known.find((k) => Math.min(similarity(k.name, name), similarity(name, k.name)) >= SAME_TARGET && Math.hypot(k.x - step.x, k.y - step.y) > MOVED);
  if (alt) return { edits: [{ kind: 'retarget', at: failed, x: alt.x, y: alt.y, target: alt.name }], reason: `"${alt.name}" is known at another position`, thinking: null };
  if (steps[failed - 2]?.action === 'wait') return null;
  const wait: WorkflowStep = { id: uid('wa'), name: `Wait before "${step.name}"`, action: 'wait', x: step.x, y: step.y, status: 'pending' };
  return { edits: [{ kind: 'add', at: failed, step: wait }], reason: 'the screen may not have been ready', thinking: null };
}

/** System prompt of the workaround maker for a `view`-sized screenshot. */
export const workaroundSystem = (view: ViewSize) => `You are Droid Assist's workaround maker. A workflow step just failed; propose the smallest change to the workflow that gets past it.
${gridPrompt(view)}
Reply ONLY with JSON {"edits":[{"kind":"add"|"remove"|"reorder"|"retarget","at":number,"from":number,"to":number,"action":string,"name":string,"target":string,"input":string,"cell":string,"cx":number,"cy":number}],"reason":string}.
Positions are 1-based in the CURRENT steps. add = insert a new step at "at" (give action, name, target + cell, input for type/key); remove = drop step "at"; reorder = move step "from" to "to"; retarget = point step "at" at an alternate target (target + cell). At most 2 edits.`;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : NaN);

function pointOf(e: Record<string, unknown>, view: ViewSize): { x: number; y: number } | null {
  try {
    return replyPoint(e, undefined, view);
  } catch {
    return null;
  }
}

/** One reply edit as a WorkflowEdit, per kind; null when malformed. */
const PARSERS: Record<WorkflowEditKind, (e: Record<string, unknown>, view: ViewSize) => WorkflowEdit | null> = {
  add: (e, view) => {
    const p = pointOf(e, view);
    const action = str(e.action) as WorkflowStep['action'];
    const name = str(e.name) || str(e.target);
    if (!p || !STEP_ACTIONS.includes(action) || !name) return null;
    const input = str(e.input);
    return { kind: 'add', at: int(e.at), step: { id: uid('wa'), name, action, ...p, ...(str(e.target) ? { target: str(e.target) } : {}), ...(input ? { text: input } : {}), status: 'pending' } };
  },
  remove: (e) => ({ kind: 'remove', at: int(e.at) }),
  reorder: (e) => ({ kind: 'reorder', from: int(e.from), to: int(e.to) }),
  retarget: (e, view) => {
    const p = pointOf(e, view);
    return p ? { kind: 'retarget', at: int(e.at), ...p, ...(str(e.target) ? { target: str(e.target) } : {}) } : null;
  },
};

/**
 * Asks the model for a workaround to the failed step (1-based `failed`); only edits that fit the
 * current steps are kept (`workaround` null when none do). A non-JSON reply throws AiError.
 */
export async function askWorkaround(ask: AskFn, frame: Frame | null, steps: WorkflowStep[], failed: number, message: string, goal: string): Promise<Thought & { workaround: Workaround | null }> {
  const flow = steps.map((s, i) => `${i + 1}. ${s.name} [${s.action}${s.target ? ` "${s.target}"` : ''}] → ${s.status}`).join('\n');
  const { content, thinking, view = SAMPLE_VIEW } = await ask({
    system: workaroundSystem,
    prompt: `Goal: ${goal || '(none)'}\nSteps:\n${flow}\nStep ${failed} failed: ${message}`,
    frame,
    json: true,
  });
  const r = parseJsonReply(content);
  const raw = Array.isArray(r.edits) ? r.edits : [];
  const edits = raw.flatMap((x) => {
    const e = (x ?? {}) as Record<string, unknown>;
    const kind = e.kind as WorkflowEditKind;
    const edit = WORKFLOW_EDIT_KINDS.includes(kind) ? PARSERS[kind](e, view) : null;
    return edit ? [edit] : [];
  }).slice(0, 2);
  if (!edits.length || !applyEdits(steps, edits)) return { workaround: null, thinking };
  return { workaround: { edits, reason: str(r.reason) || 'AI workaround', thinking }, thinking };
}
