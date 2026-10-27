import type { WorkflowStep } from './types.js';
import type { AskFn } from './ai.js';
import { parseJsonReply } from './ai.js';
import type { RunSummary } from './run-stats.js';
import { uid } from './planner.js';

/** Where an important event came from; auto-act is toggled per category. */
export type NotificationCategory = 'ai' | 'bridge' | 'goal' | 'budget' | 'abort' | 'errors' | 'agents' | 'suggestion' | 'relax';

/** Every category with its label, in panel order. */
export const NOTIFY_CATEGORIES: Record<NotificationCategory, string> = {
  ai: 'AI status',
  bridge: 'Desktop bridge',
  goal: 'Goals',
  budget: 'Action budget',
  abort: 'Aborts',
  errors: 'Error forwarding',
  agents: 'Agent reports',
  suggestion: 'AI suggestions',
  relax: 'Break reminders',
};
export const CATEGORY_IDS = Object.keys(NOTIFY_CATEGORIES) as NotificationCategory[];

export type Severity = 'info' | 'warning' | 'critical';
export const SEVERITIES: readonly Severity[] = ['info', 'warning', 'critical'];

/** What a proposed action does on the PC: open an app (Start + typing), press a shortcut, type text, or search. */
export type ActionKind = 'open_app' | 'key' | 'type' | 'search';
export const ACTION_KINDS: readonly ActionKind[] = ['open_app', 'key', 'type', 'search'];

/** An action the assistant may perform for a notification. */
export interface ProposedAction {
  kind: ActionKind;
  /** The app name, key combo, text or search query. */
  text: string;
}

/** How an auto-act or a manual run of a notification's action ended. */
export type ActedState = 'done' | 'failed' | 'dry-run' | 'skipped';
export const ACTED_STATES: readonly ActedState[] = ['done', 'failed', 'dry-run', 'skipped'];

/** One important event in the notification center. */
export interface AssistNotification {
  id: string;
  time: number;
  /** The engine part that raised it ("AI", "Bridge", "Supervisor"…). */
  source: string;
  category: NotificationCategory;
  severity: Severity;
  title: string;
  action?: ProposedAction;
  read: boolean;
  /** How its proposed action was run, once it was. */
  acted?: ActedState;
}

/** What a caller supplies to raise a notification. */
export type NotificationDraft = Pick<AssistNotification, 'source' | 'category' | 'severity' | 'title'> & { action?: ProposedAction };

/** Most notifications kept, in memory and in storage. */
export const NOTIFICATION_LIMIT = 100;
/** The same category and title within this window is one notification. */
export const NOTIFY_DEDUPE_MS = 60_000;

/** Auto-act on/off per category; every category starts off. */
export type AutoActMap = Record<NotificationCategory, boolean>;
export const DEFAULT_AUTO_ACT: AutoActMap = Object.fromEntries(CATEGORY_IDS.map((c) => [c, false])) as AutoActMap;

/** A stored auto-act map with every category present; anything not literally true is off. */
export function sanitizeAutoAct(v: unknown): AutoActMap {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return Object.fromEntries(CATEGORY_IDS.map((c) => [c, o[c] === true])) as AutoActMap;
}

/**
 * Adds a notification at the top (pruned to NOTIFICATION_LIMIT); `added` is null when the same
 * category and title was raised within NOTIFY_DEDUPE_MS (the list is then unchanged).
 */
export function addNotification(list: AssistNotification[], draft: NotificationDraft, now = Date.now()): { list: AssistNotification[]; added: AssistNotification | null } {
  const dup = list.some((n) => n.category === draft.category && n.title === draft.title && now - n.time < NOTIFY_DEDUPE_MS);
  if (dup) return { list, added: null };
  const added: AssistNotification = { id: uid('notif'), time: now, read: false, ...draft };
  return { list: [added, ...list].slice(0, NOTIFICATION_LIMIT), added };
}

/** The list with one notification changed. */
export const patchNotification = (list: AssistNotification[], id: string, change: Partial<AssistNotification>) => list.map((n) => (n.id === id ? { ...n, ...change } : n));

/** Relaxation mode dims the non-essential: info notifications other than break reminders. */
export const dimmed = (n: AssistNotification, relax: boolean) => relax && n.severity === 'info' && n.category !== 'relax';

/** One-line text of a proposed action. */
export function actionText(a: ProposedAction): string {
  const TEXT: Record<ActionKind, string> = { open_app: `Open ${a.text}`, key: `Press ${a.text}`, type: `Type "${a.text}"`, search: `Search for "${a.text}"` };
  return TEXT[a.kind];
}

/** The workflow step that performs a proposed action through the bridge (Start + typing for an app). */
export function actionStep(a: ProposedAction): WorkflowStep {
  return { id: uid('notify'), name: actionText(a), action: a.kind, text: a.text, x: 0.5, y: 0.5, status: 'pending' };
}

/** A valid proposed action, or undefined. */
export function parseAction(v: unknown): ProposedAction | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const { kind, text } = v as Record<string, unknown>;
  if (!ACTION_KINDS.includes(kind as ActionKind) || typeof text !== 'string' || !text.trim()) return undefined;
  return { kind: kind as ActionKind, text: text.trim() };
}

/** Whether a stored value is a valid notification (the storage guard). */
export function isNotification(v: unknown): v is AssistNotification {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const n = v as Record<string, unknown>;
  return typeof n.id === 'string' && !!n.id && typeof n.time === 'number' && Number.isFinite(n.time) && typeof n.source === 'string'
    && Object.hasOwn(NOTIFY_CATEGORIES, n.category as string) && SEVERITIES.includes(n.severity as Severity) && typeof n.title === 'string'
    && typeof n.read === 'boolean' && (n.action === undefined || parseAction(n.action) !== undefined)
    && (n.acted === undefined || ACTED_STATES.includes(n.acted as ActedState));
}

/** Days a goal must have run in the same hour before it counts as a habit. */
export const HABIT_DAYS = 3;
const OPEN_GOAL = /^\s*(?:open|launch|start)\s+(.+?)\s*$/i;

/**
 * Habit suggestions: a goal that succeeded on at least HABIT_DAYS different days within an hour of
 * the current time of day ("you usually open YouTube around now"). An "open X" goal proposes opening X.
 */
export function habitSuggestions(runs: RunSummary[], now = Date.now()): NotificationDraft[] {
  const hour = new Date(now).getHours();
  const days = new Map<string, Set<string>>();
  for (const r of runs) {
    const d = new Date(r.time);
    const near = Math.abs(d.getHours() - hour) <= 1 || Math.abs(d.getHours() - hour) === 23;
    if (r.outcome !== 'success' || !r.goal || !near) continue;
    const set = days.get(r.goal) ?? new Set<string>();
    set.add(d.toDateString());
    days.set(r.goal, set);
  }
  return [...days.entries()].filter(([, set]) => set.size >= HABIT_DAYS).map(([goal]) => {
    const app = OPEN_GOAL.exec(goal)?.[1];
    return {
      source: 'Suggestions',
      category: 'suggestion' as const,
      severity: 'info' as const,
      title: `You usually ${app ? `open ${app}` : `run "${goal}"`} around now`,
      ...(app ? { action: { kind: 'open_app' as const, text: app } } : {}),
    };
  });
}

/** The "disk almost full" suggestion, proposing the OS disk cleanup tool. */
export function diskSuggestion(freeBytes: number, totalBytes: number): NotificationDraft {
  return {
    source: 'Suggestions',
    category: 'suggestion',
    severity: 'warning',
    title: `Disk almost full — ${Math.round((freeBytes / totalBytes) * 100)}% free`,
    action: { kind: 'open_app', text: 'Disk Cleanup' },
  };
}

/** System prompt for AI-generated suggestions. */
export const SUGGEST_SYSTEM = `You are Droid Assist's notification assistant. From the user's recent operations, the time and the computer's state, suggest at most 3 helpful actions.
Reply ONLY with JSON {"suggestions":[{"title":string,"severity":"info"|"warning"|"critical","action":{"kind":"open_app"|"key"|"type"|"search","text":string}|null}]}.
Example titles: "You usually open YouTube around now", "Disk almost full". Use an empty list when nothing is worth suggesting.`;

/** The suggestions in a model reply; invalid entries are dropped, an invalid action is left out. */
export function parseSuggestions(content: string): NotificationDraft[] {
  const raw = parseJsonReply(content).suggestions;
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 3).flatMap((s) => {
    if (!s || typeof s !== 'object' || typeof s.title !== 'string' || !s.title.trim()) return [];
    const action = parseAction(s.action);
    const severity = SEVERITIES.includes(s.severity) ? (s.severity as Severity) : 'info';
    return [{ source: 'AI suggestions', category: 'suggestion' as const, severity, title: s.title.trim(), ...(action ? { action } : {}) }];
  });
}

/** Asks the model for suggestions from the given context lines (recent operations, time, system state). */
export async function suggestWithAi(ask: AskFn, context: string[]): Promise<NotificationDraft[]> {
  const reply = await ask({ system: SUGGEST_SYSTEM, prompt: `Now: ${new Date().toString()}\n${context.join('\n')}`, json: true, context: [] });
  return parseSuggestions(reply.content);
}
