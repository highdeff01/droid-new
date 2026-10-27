import type { StepVerdict } from './assist-ai.js';
import { uid } from './planner.js';

/**
 * What an entry records: the model's initial thought, its assessment of a screen change, the
 * what/why proposal made before a step runs, its follow-up reflection, the final verdict, a
 * verification check, a supervisor review / movement, or one attempt of a step's retry ladder.
 */
export type ThoughtKind = 'thought' | 'change' | 'proposal' | 'reflection' | 'verdict' | 'check' | 'review' | 'movement' | 'attempt';

/** One timestamped AI call on the per-step thinking timeline. */
export interface ThinkingEntry {
  id: string;
  time: number;
  /** The step or AI action the call was about. */
  step: string;
  kind: ThoughtKind;
  /** The model's answer (decision, reflection text or verdict summary); empty when the call failed. */
  text: string;
  /** message.thinking as returned by the model; null when the response carried none. */
  thinking: string | null;
  /** Why the call produced nothing (endpoint unreachable, unusable reply). */
  error?: string;
  /** Project (trimmed goal text) the call was made for; absent when no goal was set. */
  project?: string;
}

/** The newest entries kept on the timeline. */
export const TIMELINE_LIMIT = 100;

/** Prepends a new timestamped entry, keeping the newest TIMELINE_LIMIT. */
export function addEntry(timeline: ThinkingEntry[], entry: Omit<ThinkingEntry, 'id' | 'time'>): ThinkingEntry[] {
  return [{ id: uid('think'), time: Date.now(), ...entry }, ...timeline].slice(0, TIMELINE_LIMIT);
}

/** One-line summary of a verdict, for the timeline and the activity log. */
export function verdictText(v: StepVerdict): string {
  const avoid = v.pattern_avoid ? ` · avoid: ${v.pattern_avoid}` : '';
  const add = v.pattern_add ? ` · add: ${v.pattern_add}` : '';
  return `${v.success ? 'SUCCESS' : 'FAILED'}${avoid}${add}`;
}
