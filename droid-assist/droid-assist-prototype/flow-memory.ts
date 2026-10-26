import type { LearnedPattern, SavedCard, WorkflowStep } from './types.js';
import { parseJsonReply } from './ai.js';
import type { AskFn } from './ai.js';
import { generateCard, similarity, uid } from './planner.js';
import { PATTERN_LIMIT } from './storage.js';

/** How alike two flow names must be (both ways) to count as the same flow. */
export const SAME_FLOW = 0.6;

/** What a finished run means for memory: save it, learn from its failure, or neither. */
export type RunVerdict = 'success' | 'failed' | 'ignored';

/**
 * A finished run's verdict. Dry runs and runs the user stopped are ignored; a real run
 * where every step executed (done, or done after drift correction) succeeded; any other
 * real run failed.
 */
export function runVerdict(steps: WorkflowStep[], { dryRun, stopped }: { dryRun: boolean; stopped: boolean }): RunVerdict {
  if (dryRun || stopped || !steps.length) return 'ignored';
  return steps.every((s) => s.status === 'done' || s.status === 'drift') ? 'success' : 'failed';
}

/** A run step as a saved step: it lands where the run found its target, with that screenshot. */
function savedStep({ shot: _shot, drift: _drift, driftPx: _driftPx, ...s }: WorkflowStep): WorkflowStep {
  const x = s.correctedX ?? s.x;
  const y = s.correctedY ?? s.y;
  return { ...s, x, y, correctedX: x, correctedY: y, status: 'pending' };
}

/** A successful run as a saved card named from the goal. */
export function flowCard(goal: string, steps: WorkflowStep[], savedAt = Date.now()): SavedCard {
  const { name, description } = generateCard(steps, goal);
  return { id: uid('card'), name, description, savedAt, steps: steps.map(savedStep) };
}

/** True when two flow names describe the same flow, in either direction. */
const sameFlow = (a: string, b: string) => Math.min(similarity(a, b), similarity(b, a)) >= SAME_FLOW;

/**
 * Inserts `card` first; a card for the same flow is replaced in place of a near-duplicate
 * (keeping its id) rather than added beside it.
 */
export function upsertCard(cards: SavedCard[], card: SavedCard): { cards: SavedCard[]; replaced: SavedCard | null } {
  const replaced = cards.find((c) => sameFlow(c.name, card.name)) ?? null;
  const next = replaced ? { ...card, id: replaced.id } : card;
  return { cards: [next, ...cards.filter((c) => c !== replaced)], replaced };
}

/** A new learned pattern. */
export const newPattern = (kind: LearnedPattern['kind'], pattern: string, context: string): LearnedPattern => ({ id: uid('pat'), kind, pattern: pattern.trim(), context: context.trim(), time: Date.now() });

/** The lesson a failed run always leaves, with or without the model: avoid its failed steps as planned. */
export function failurePattern(goal: string, steps: WorkflowStep[]): LearnedPattern {
  const failed = steps.filter((s) => s.status === 'failed' || s.status === 'pending' || s.status === 'running');
  const names = failed.map((s) => `"${s.name}" (${s.action})`).join(', ') || 'the planned steps';
  return newPattern('avoid', `Step ${names} failed on screen — target or approach did not work`, goal);
}

const KINDS = new Set<LearnedPattern['kind']>(['avoid', 'add']);

/** System prompt for the reviewer that turns a run into lessons. */
export const LEARN_SYSTEM = `You are Droid Assist's run reviewer. From one finished run, extract short reusable lessons for planning similar goals.
Reply ONLY with JSON: {"patterns":[{"kind":"avoid"|"add","pattern":string,"context":string}]}
"avoid" is something that failed or wasted steps; "add" is something that helped and should be included next time. "context" names the goal or situation it applies to. At most 3 patterns.`;

const stepLine = (s: WorkflowStep) => `- ${s.name} [${s.action}${s.text ? ` "${s.text}"` : ''}] → ${s.status}`;

/**
 * Asks the model for lessons from a finished run; only well-formed {kind, pattern, context}
 * entries are kept. Rejects with AiError when the model is unreachable or replies with non-JSON.
 */
export async function learnPatterns(ask: AskFn, goal: string, steps: WorkflowStep[], verdict: Exclude<RunVerdict, 'ignored'>): Promise<LearnedPattern[]> {
  const reply = await ask({
    system: LEARN_SYSTEM,
    prompt: `Goal: ${goal || '(none)'}\nRun ${verdict === 'success' ? 'SUCCEEDED' : 'FAILED'}:\n${steps.map(stepLine).join('\n')}`,
    json: true,
  });
  const raw = parseJsonReply(reply.content).patterns;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p) => {
    const e = (p ?? {}) as Record<string, unknown>;
    if (!KINDS.has(e.kind as LearnedPattern['kind']) || typeof e.pattern !== 'string' || !e.pattern.trim()) return [];
    return [newPattern(e.kind as LearnedPattern['kind'], e.pattern, typeof e.context === 'string' ? e.context : goal)];
  });
}

/** `added` first, then `existing`; a repeated kind+pattern keeps only the newest; capped at PATTERN_LIMIT. */
export function mergePatterns(existing: LearnedPattern[], added: LearnedPattern[]): LearnedPattern[] {
  const seen = new Set<string>();
  return [...added, ...existing].filter((p) => {
    const key = `${p.kind}:${p.pattern.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, PATTERN_LIMIT);
}
