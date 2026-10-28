import type { LogEntry, WorkflowStep } from './types.js';
import type { ThinkingEntry, ThoughtKind } from './thinking-timeline.js';
import { currentObjective, nextGoals, type GoalRecord } from './goal-objectives.js';

/** Where a full AI response came from, as the AI responses section filters it. */
export type ResponseSource = 'planner' | 'grounding' | 'screen' | 'reflect' | 'verdict' | 'supervisor' | 'attempt' | 'agent' | 'test';

/** The source of each timeline kind. */
const SOURCE_OF_KIND: Readonly<Record<ThoughtKind, ResponseSource>> = {
  thought: 'planner', proposal: 'planner',
  check: 'grounding', snip: 'grounding',
  change: 'screen',
  reflection: 'reflect',
  verdict: 'verdict',
  review: 'supervisor', movement: 'supervisor',
  attempt: 'attempt',
  reply: 'agent',
  test: 'test',
};

/** Every source, in filter order. */
export const RESPONSE_SOURCES: readonly ResponseSource[] = ['planner', 'grounding', 'screen', 'reflect', 'verdict', 'supervisor', 'attempt', 'agent', 'test'];

/** The source of a thinking timeline entry. */
export const sourceOf = (entry: ThinkingEntry): ResponseSource => SOURCE_OF_KIND[entry.kind];

/** Farthest a log entry may be from a response, in ms, to count as its log line. */
export const LINK_WINDOW_MS = 5000;

/** One full AI response: the timeline entry, its source and the log entry it is linked to (null when none). */
export interface AiResponse {
  entry: ThinkingEntry;
  source: ResponseSource;
  logId: string | null;
}

/** The log entry of the same project closest in time to `entry`, within LINK_WINDOW_MS; null when none. */
export function linkedLog(entry: ThinkingEntry, log: readonly LogEntry[]): string | null {
  const project = entry.project ?? '';
  let best: LogEntry | null = null;
  for (const l of log) {
    const gap = Math.abs(l.time - entry.time);
    if (gap > LINK_WINDOW_MS || (l.project ?? '') !== project) continue;
    if (!best || gap < Math.abs(best.time - entry.time)) best = l;
  }
  return best?.id ?? null;
}

/** Every AI response on the timeline with its source and linked log entry, newest first. */
export function aiResponses(timeline: readonly ThinkingEntry[], log: readonly LogEntry[]): AiResponse[] {
  return timeline
    .map((entry) => ({ entry, source: sourceOf(entry), logId: linkedLog(entry, log) }))
    .sort((a, b) => b.entry.time - a.entry.time);
}

/** The responses of `source`; every response when it is unset. */
export const filterResponses = (responses: readonly AiResponse[], source?: ResponseSource): AiResponse[] =>
  responses.filter((r) => source === undefined || r.source === source);

/** What the AI is doing now and what it plans next. */
export interface Activity {
  doing: string;
  next: string[];
}

/**
 * The running step (else the current objective, else idle) and what follows: the pending steps
 * after it, then the queued next goals.
 */
export function currentActivity(steps: readonly WorkflowStep[], objectives: GoalRecord[]): Activity {
  const running = steps.findIndex((s) => s.status === 'running');
  const objective = currentObjective(objectives);
  const doing = running >= 0 ? `Step ${running + 1}: ${steps[running].name}` : objective ? `Objective: ${objective.text}` : 'Idle';
  const pending = steps.slice(running + 1).filter((s) => s.status === 'pending').map((s) => `Step: ${s.name}`);
  return { doing, next: [...pending, ...nextGoals(objectives).map((g) => `Goal: ${g.text}`)] };
}
