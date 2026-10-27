import type { Frame, StepAction, WorkflowStep } from './types.js';
import { parseJsonReply, toUnit, type AskFn } from './ai.js';
import { uid } from './planner.js';

/** Consecutive failures of the same element/flow step that call for a fix script. */
export const FAIL_THRESHOLD = 2;
/** Most steps a fix script may have. */
export const MAX_FIX_STEPS = 10;
/** The only actions a fix script may use. */
export const FIX_ACTIONS: ReadonlySet<StepAction> = new Set<StepAction>(['click', 'type', 'key', 'wait']);
/** Most fix methods remembered. */
export const FIX_METHOD_LIMIT = 50;

/** Where the run is stuck: the failing element in a flow, and why. */
export interface FixContext {
  element: string;
  flow: string;
  /** What went wrong: "element not found", the step's failure message, a covering popup… */
  problem: string;
}

/** A bounded repair script, reviewed in the pre-action briefing before it runs. */
export interface FixScript {
  id: string;
  context: FixContext;
  steps: WorkflowStep[];
  /** Where it came from: a saved fix method, the model, or the local fallback. */
  source: 'memory' | 'ai' | 'local';
  reason: string;
}

/** A fix script that worked, remembered against the element and flow it repaired. */
export interface FixMethod {
  id: string;
  element: string;
  flow: string;
  steps: WorkflowStep[];
  uses: number;
  successes: number;
  savedAt: number;
}

const key = (s: string) => s.trim().toLowerCase();
/** The failure-count key of an element in a flow (case-insensitive). */
export const failureKey = (element: string, flow: string) => `${key(flow)}::${key(element)}`;

/** Counts consecutive failures per key: a failure adds one, a success resets it. */
export function noteResult(counts: Record<string, number>, k: string, ok: boolean): Record<string, number> {
  const next = { ...counts };
  if (ok) delete next[k];
  else next[k] = (next[k] ?? 0) + 1;
  return next;
}

/** Whether `k` failed FAIL_THRESHOLD times in a row. */
export const needsFix = (counts: Record<string, number>, k: string) => (counts[k] ?? 0) >= FAIL_THRESHOLD;

const step = (name: string, action: StepAction, over: Partial<WorkflowStep> = {}): WorkflowStep => ({ id: uid('fix'), name, action, x: 0.5, y: 0.5, status: 'pending', ...over });

/** One reply entry as a fix step; null when its action is not allowed or a click has no point. */
function toStep(raw: unknown): WorkflowStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const action = String(r.action ?? '') as StepAction;
  if (!FIX_ACTIONS.has(action)) return null;
  const name = String(r.name ?? r.target ?? action);
  const text = r.text === undefined ? undefined : String(r.text);
  if (action !== 'click') return step(name, action, text === undefined ? {} : { text });
  if (r.x === undefined || r.y === undefined) return null;
  return step(name, action, { x: toUnit(r.x, 480), y: toUnit(r.y, 270), target: String(r.target ?? name) });
}

/** Parses a model reply into at most MAX_FIX_STEPS allowed steps; other actions are dropped. Throws on a reply with no JSON. */
export function parseFixScript(content: string): { steps: WorkflowStep[]; reason: string } {
  const r = parseJsonReply(content);
  const list = Array.isArray(r.steps) ? r.steps : [];
  const steps = list.map(toStep).filter((s): s is WorkflowStep => s !== null).slice(0, MAX_FIX_STEPS);
  return { steps, reason: String(r.reason ?? '') };
}

/** The local repair when the model is unavailable: dismiss whatever covers the screen, wait, go back one view, wait. */
export function localFixScript(ctx: FixContext): FixScript {
  const steps = [step('Dismiss obstacle', 'key', { text: 'Escape' }), step('Let it settle', 'wait'), step('Navigate back', 'key', { text: 'Alt+Left' }), step('Let it settle', 'wait')];
  return { id: uid('fixscript'), context: ctx, steps, source: 'local', reason: `Local repair for "${ctx.element}": dismiss, go back and retry` };
}

const FIX_SYSTEM = `You are Droid Assist's repair planner. A flow is stuck. Look at the screenshot (480x270) and propose a SHORT repair script (at most ${MAX_FIX_STEPS} steps) that reopens a menu, navigates back or dismisses an obstacle so the failing step can run again. Allowed actions: click (with x,y pixel point and target), type (with text), key (with text, e.g. "Escape" or "Alt+Left"), wait. Reply ONLY with JSON {"reason":string,"steps":[{"action":string,"name":string,"target"?:string,"x"?:number,"y"?:number,"text"?:string}]}.`;

/** Asks the model for a fix script; null when its reply holds no usable step. */
export async function askFixScript(ask: AskFn, frame: Frame | null, ctx: FixContext, context: string[] = []): Promise<FixScript | null> {
  const { content } = await ask({ system: FIX_SYSTEM, prompt: `Flow "${ctx.flow}" keeps failing at "${ctx.element}": ${ctx.problem}.`, frame, context, json: true });
  const { steps, reason } = parseFixScript(content);
  return steps.length ? { id: uid('fixscript'), context: ctx, steps, source: 'ai', reason } : null;
}

/** The saved fix method of (element, flow), case-insensitive; null when none. */
export const fixMethodFor = (methods: FixMethod[], element: string, flow: string) => methods.find((m) => key(m.element) === key(element) && key(m.flow) === key(flow)) ?? null;

/** A saved fix method as a script to review (fresh step ids, pending). */
export const scriptFromMethod = (m: FixMethod, ctx: FixContext): FixScript => ({
  id: uid('fixscript'),
  context: ctx,
  steps: m.steps.map((s) => ({ ...s, id: uid('fix'), status: 'pending' })),
  source: 'memory',
  reason: `Saved fix method (${m.successes}/${m.uses} worked)`,
});

/**
 * The fix script for a stuck step: the saved fix method of its element and flow first, else the
 * model's script (when `ask` is given and answers), else the local fallback.
 */
export async function generateFixScript(ctx: FixContext, methods: FixMethod[], ask: AskFn | null, frame: Frame | null, context: string[] = []): Promise<FixScript> {
  const saved = fixMethodFor(methods, ctx.element, ctx.flow);
  if (saved) return scriptFromMethod(saved, ctx);
  const fromAi = ask ? await askFixScript(ask, frame, ctx, context).catch(() => null) : null;
  return fromAi ?? localFixScript(ctx);
}

/** Records a run fix script: on success it becomes (or refreshes) the fix method of its element and flow; every run counts a use. */
export function saveFixMethod(methods: FixMethod[], script: FixScript, ok: boolean, now = Date.now()): FixMethod[] {
  const { element, flow } = script.context;
  const old = fixMethodFor(methods, element, flow);
  if (!old && !ok) return methods;
  const steps = ok ? script.steps.map((s) => ({ ...s, status: 'pending' as const, beforeFrame: undefined, afterFrame: undefined, shot: undefined, refFrame: undefined })) : old!.steps;
  const next: FixMethod = { id: old?.id ?? uid('fixmethod'), element: element.trim(), flow: flow.trim(), steps, uses: (old?.uses ?? 0) + 1, successes: (old?.successes ?? 0) + (ok ? 1 : 0), savedAt: now };
  return [next, ...methods.filter((m) => m !== old)].slice(0, FIX_METHOD_LIMIT);
}

/** One-line text of a fix script for the log and the briefing. */
export const fixScriptText = (s: FixScript) => `${s.source} fix for "${s.context.element}" (${s.steps.length} step(s)): ${s.steps.map((st) => `${st.action}${st.text ? ` "${st.text}"` : st.target ? ` "${st.target}"` : ''}`).join(' → ')}`;
