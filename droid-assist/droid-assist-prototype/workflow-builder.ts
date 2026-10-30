import type { Frame, LogEntry, StepAction, WorkflowStep } from './types.js';
import { STEP_ACTIONS } from './types.js';
import { parseJsonReply, type AskFn } from './ai.js';

/**
 * AI-assisted workflow building (only while the AI is available): the user's command is extracted
 * into a workflow, then the workflow's screenshots are analysed SHOT_BATCH at a time, each placed into
 * the step it shows, until a step is verified complete — only then is that step's action performed.
 */

/** Screenshots analysed per AI call. */
export const SHOT_BATCH = 10;

const EXTRACT_SYSTEM = `Turn the user's command into a workflow. Reply with ONLY JSON: {"steps":[{"name":string,"action":one of ${STEP_ACTIONS.join('|')},"target":string,"x":0..1,"y":0..1,"text"?:string}]}`;
const PLACE_SYSTEM = 'You are given a workflow and a batch of screenshots numbered from the batch\'s first index. Place each screenshot into the step it shows, and list the steps the screenshots placed so far prove complete. Reply with ONLY JSON: {"placements":[{"shot":number,"step":number}],"verified":[number]} (steps are 1-based).';

/** Where one screenshot was placed: its index in the shot list and the 0-based step. */
export interface Placement {
  shot: number;
  step: number;
}

/** What building needs from its host. */
export interface BuilderDeps {
  /** The AI; null while it is unavailable (nothing is built or performed then). */
  ask: AskFn | null;
  /** Performs one verified step through the real-input path; resolves whether it succeeded. */
  perform: (step: WorkflowStep) => Promise<boolean>;
  log: (message: string, tone: LogEntry['tone']) => void;
}

/** The result of building (and performing) a workflow. */
export interface BuildResult {
  steps: WorkflowStep[];
  placements: Placement[];
  /** 0-based steps the AI verified complete. */
  verified: number[];
  /** 0-based steps performed, in order. */
  performed: number[];
  /** Shot count of each AI batch, in order. */
  batches: number[];
  /** Why nothing was built, when nothing was. */
  skipped?: string;
}

const isAction = (v: unknown): v is StepAction => typeof v === 'string' && (STEP_ACTIONS as readonly string[]).includes(v);
const unit = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5);
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The AI's workflow reply as pending steps; entries without a known action are dropped. */
export function parseWorkflow(raw: string): WorkflowStep[] {
  const steps = parseJsonReply(raw).steps;
  if (!Array.isArray(steps)) return [];
  return steps
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && isAction((s as Record<string, unknown>).action))
    .map((s, i) => ({
      id: `built-${i + 1}`,
      name: typeof s.name === 'string' && s.name.trim() ? s.name.trim() : `Step ${i + 1}`,
      action: s.action as StepAction,
      x: unit(s.x),
      y: unit(s.y),
      ...(typeof s.target === 'string' ? { target: s.target } : {}),
      ...(typeof s.text === 'string' ? { text: s.text } : {}),
      status: 'pending' as const,
    }));
}

/** The AI's placement reply for a batch starting at shot `first`: placements in range, verified steps 0-based. */
export function parsePlacements(raw: string, first: number, batchSize: number, stepCount: number): { placements: Placement[]; verified: number[] } {
  const reply = parseJsonReply(raw);
  const inSteps = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= stepCount;
  const placements = (Array.isArray(reply.placements) ? reply.placements : [])
    .filter((p): p is { shot: number; step: number } => !!p && typeof p.shot === 'number' && p.shot >= first && p.shot < first + batchSize && inSteps(p.step))
    .map((p) => ({ shot: p.shot, step: p.step - 1 }));
  const verified = (Array.isArray(reply.verified) ? reply.verified : []).filter(inSteps).map((n) => n - 1);
  return { placements, verified };
}

/** The shots in batches of at most SHOT_BATCH, each with the index of its first shot. */
export function shotBatches<T>(shots: T[], size = SHOT_BATCH): Array<{ first: number; shots: T[] }> {
  const out: Array<{ first: number; shots: T[] }> = [];
  for (let first = 0; first < shots.length; first += size) out.push({ first, shots: shots.slice(first, first + size) });
  return out;
}

const workflowText = (steps: WorkflowStep[]) => steps.map((s, i) => `${i + 1}. ${s.name} (${s.action}${s.target ? ` ${s.target}` : ''})`).join('\n');

/** Performs, in order, every step from `next` on that is verified; stops at the first unverified or failed step. Returns the new next index. */
async function performVerified(steps: WorkflowStep[], verified: Set<number>, next: number, performed: number[], deps: BuilderDeps): Promise<number> {
  let i = next;
  while (i < steps.length && verified.has(i)) {
    deps.log(`Step ${i + 1} "${steps[i].name}" verified complete by its screenshots — performing it`, 'info');
    if (!(await deps.perform(steps[i]))) return -1;
    performed.push(i);
    i++;
  }
  return i;
}

/**
 * Extracts `command` into a workflow, then sends the screenshots SHOT_BATCH at a time; each batch's
 * placements and verifications accumulate, and a step is performed only once the AI has verified it
 * (and every step before it has been performed). Without the AI nothing is built or performed.
 */
export async function buildWorkflow(command: string, shots: Frame[], deps: BuilderDeps): Promise<BuildResult> {
  const result: BuildResult = { steps: [], placements: [], verified: [], performed: [], batches: [] };
  if (!deps.ask) return { ...result, skipped: 'AI unavailable — workflow building needs the AI; nothing was executed' };
  try {
    result.steps = parseWorkflow((await deps.ask({ system: EXTRACT_SYSTEM, prompt: command, json: true })).content);
  } catch (error) {
    return { ...result, skipped: `AI could not extract the workflow (${errorText(error)}); nothing was executed` };
  }
  if (!result.steps.length) return { ...result, skipped: 'AI found no steps in the command; nothing was executed' };
  const verified = new Set<number>();
  let next = 0;
  for (const batch of shotBatches(shots)) {
    if (next < 0 || next >= result.steps.length) break;
    result.batches.push(batch.shots.length);
    try {
      const prompt = `Workflow:\n${workflowText(result.steps)}\nScreenshots ${batch.first} to ${batch.first + batch.shots.length - 1} follow, in order.`;
      const reply = await deps.ask({ system: PLACE_SYSTEM, prompt, frames: batch.shots, json: true });
      const placed = parsePlacements(reply.content, batch.first, batch.shots.length, result.steps.length);
      result.placements.push(...placed.placements);
      for (const v of placed.verified) verified.add(v);
    } catch (error) {
      deps.log(`Screenshot batch from ${batch.first} not analysed (${errorText(error)}) — its steps stay unverified`, 'warn');
    }
    next = await performVerified(result.steps, verified, next, result.performed, deps);
  }
  result.verified = [...verified].sort((a, b) => a - b);
  return result;
}
