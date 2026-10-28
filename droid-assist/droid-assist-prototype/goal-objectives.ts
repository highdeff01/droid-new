import { uid } from './planner.js';

/** Traced state of a goal: queued, being worked on, reached, or given up on. */
export type GoalState = 'pending' | 'active' | 'achieved' | 'failed';

/** One traced goal. Its trimmed text is also the project id of everything done for it. */
export interface GoalRecord {
  id: string;
  text: string;
  state: GoalState;
  /** When the goal was first traced. */
  time: number;
  /** When its state last changed. */
  updated: number;
}

/** localStorage key of the objective records (kept apart from the goal tracer's records). */
export const GOALS_KEY = 'droid-assist.objectives';
/** Most goal records kept. */
export const OBJECTIVE_LIMIT = 50;

const STATES: readonly GoalState[] = ['pending', 'active', 'achieved', 'failed'];

const isRecord = (v: unknown): v is GoalRecord => {
  const r = v as GoalRecord;
  return !!r && typeof r === 'object' && typeof r.id === 'string' && typeof r.text === 'string' && !!r.text.trim()
    && STATES.includes(r.state) && Number.isFinite(r.time) && Number.isFinite(r.updated);
};

/** The project id of a goal text: its trimmed text ('' when none). */
export const projectId = (text: string) => text.trim();

/** The persisted goal records, newest first; invalid ones are dropped. */
export function loadGoals(storage: Pick<Storage, 'getItem'> = localStorage): GoalRecord[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(GOALS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isRecord).slice(0, OBJECTIVE_LIMIT) : [];
  } catch {
    return [];
  }
}

/** Persists the newest OBJECTIVE_LIMIT records; returns them. */
export function saveGoals(goals: GoalRecord[], storage: Pick<Storage, 'setItem'> = localStorage): GoalRecord[] {
  const kept = goals.slice(0, OBJECTIVE_LIMIT);
  try {
    storage.setItem(GOALS_KEY, JSON.stringify(kept));
  } catch {
    // Storage full or unavailable: keep the in-memory records.
  }
  return kept;
}

/** Moves the record of `text` (or a new one) to the front with `state`. */
function upsert(goals: GoalRecord[], text: string, state: GoalState, now: number): GoalRecord[] {
  const key = projectId(text);
  if (!key) return goals;
  const found = goals.find((g) => g.text === key);
  const record: GoalRecord = found ? { ...found, state, updated: now } : { id: uid('goal'), text: key, state, time: now, updated: now };
  return [record, ...goals.filter((g) => g !== found)];
}

/** Traces `text` as the goal now being worked on (active). */
export const startGoal = (goals: GoalRecord[], text: string, now = Date.now()) => upsert(goals, text, 'active', now);

/** Queues `text` as a next goal (pending); a goal already traced keeps its state. */
export function queueGoal(goals: GoalRecord[], text: string, now = Date.now()): GoalRecord[] {
  return goals.some((g) => g.text === projectId(text)) ? goals : upsert(goals, text, 'pending', now);
}

/** Settles the goal `text` as achieved or failed; an untraced goal is traced with that state. */
export const settleGoal = (goals: GoalRecord[], text: string, achieved: boolean, now = Date.now()) => upsert(goals, text, achieved ? 'achieved' : 'failed', now);

/** Removes the record `id` (dropping a queued goal). */
export const dropGoal = (goals: GoalRecord[], id: string) => goals.filter((g) => g.id !== id);

/** The current objective: the most recently updated record that is active, else the most recently settled one. */
export function currentObjective(goals: GoalRecord[]): GoalRecord | null {
  const byUpdate = [...goals].sort((a, b) => b.updated - a.updated);
  return byUpdate.find((g) => g.state === 'active') ?? byUpdate.find((g) => g.state !== 'pending') ?? null;
}

/** The next goals: pending records in the order they were queued (oldest first). */
export const nextGoals = (goals: GoalRecord[]) => goals.filter((g) => g.state === 'pending').sort((a, b) => a.time - b.time);

/** Ids of the running projects: goals in state active. */
export const runningProjects = (goals: GoalRecord[]) => goals.filter((g) => g.state === 'active').map((g) => g.text);
