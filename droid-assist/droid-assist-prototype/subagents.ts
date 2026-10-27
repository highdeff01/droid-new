import type { Frame, LearnedPattern } from './types.js';
import { AiError, parseJsonReply } from './ai.js';
import type { AskFn } from './ai.js';
import { newPattern } from './flow-memory.js';

/** What a subagent tests: one link (nav item) or one segment of a route/flow. */
export type SubagentKind = 'link' | 'route';

/** A request to test links or a route thoroughly; empty `items` means the model lists them on the live screen. */
export interface TestRequest {
  kind: SubagentKind;
  items: string[];
  goal: string;
}

/** One bounded slice of a test: one link or one route segment, with its own slice of the action budget. */
export interface SubagentTask {
  id: string;
  index: number;
  kind: SubagentKind;
  /** What the slice covers, e.g. "Files" or "Cart → Checkout". */
  label: string;
  /** The goal the subagent plans from. */
  goal: string;
  /** The on-screen thing the slice ends on. */
  target: string;
  /** Real input actions this subagent may spend. */
  budget: number;
}

/** How a subagent ended. */
export type SubagentStatus = 'pass' | 'fail' | 'aborted' | 'skipped';

/** What one subagent run produced. */
export interface SubagentOutcome {
  status: SubagentStatus;
  message: string;
  /** True when it ran disarmed: verified on screen, nothing sent. */
  dry: boolean;
  /** Screenshots taken after its steps. */
  shots: Frame[];
  /** The model's thinking for the slice's plan and verdicts (only what the model returned). */
  thinking: string[];
  avoid?: string | null;
  add?: string | null;
  /** Where the slice's last step landed, normalized 0..1 (forwarded to the agents on a pass). */
  point?: { x: number; y: number };
}

/** One row of the summary report. */
export type SubagentResult = SubagentTask & SubagentOutcome;

/** The aggregated report of one link/route test. */
export interface SubagentReport {
  goal: string;
  kind: SubagentKind;
  time: number;
  /** False while subagents are still running. */
  finished: boolean;
  results: SubagentResult[];
}

const LINK_WORDS = /\b(links?|nav(igation)?|menu|items?|tabs?|buttons?|sections?)\b/i;
const ROUTE_WORDS = /\b(routes?|flows?|end[- ]to[- ]end|journey|path|segments?)\b/i;
const TEST_WORDS = /\b(test|verify|check|validate)\b/i;

/** True when a goal asks to test links or routes thoroughly (e.g. "verify every nav item opens its section"). */
export const isTestGoal = (goal: string) => TEST_WORDS.test(goal) && (LINK_WORDS.test(goal) || ROUTE_WORDS.test(goal));

/** The kind a free-text test goal asks for: a route when it names a route/flow, else links. */
export const kindOf = (goal: string): SubagentKind => (ROUTE_WORDS.test(goal) ? 'route' : 'link');

const splitList = (text: string, sep: RegExp) => text.split(sep).map((s) => s.trim()).filter(Boolean);

/**
 * Parses the argument of "/test": "links a, b, c" lists the links, "route a > b > c" the route
 * stops in order; anything else is a free-text goal whose items the model lists.
 */
export function parseTestSpec(text: string): TestRequest {
  const t = text.trim();
  const links = /^links?\s*:?\s+(.+)$/i.exec(t);
  if (links) return { kind: 'link', items: splitList(links[1], /,/), goal: `Test links: ${t}` };
  const route = /^(?:route|flow)\s*:?\s+(.+)$/i.exec(t);
  if (route) return { kind: 'route', items: splitList(route[1], />|→|->/), goal: `Test route: ${t}` };
  return { kind: kindOf(t), items: [], goal: t };
}

/**
 * Splits the global action budget into `n` slices that sum to at most `total`: even shares,
 * the remainder to the earliest. With fewer actions than subagents the last slices are 0.
 */
export function sliceBudget(total: number, n: number): number[] {
  const whole = Math.max(0, Math.floor(total));
  if (n <= 0) return [];
  const base = Math.floor(whole / n);
  const extra = whole % n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/** One link per subagent. */
function linkSlice(link: string, i: number): Omit<SubagentTask, 'budget' | 'id'> {
  return { index: i, kind: 'link', label: link, target: link, goal: `Click the "${link}" link or nav item and confirm its section opens` };
}

/** One route segment per subagent: from the previous stop (or the current screen) to this one. */
function routeSlice(stops: string[]) {
  return (stop: string, i: number): Omit<SubagentTask, 'budget' | 'id'> => {
    const from = i === 0 ? 'the current screen' : `"${stops[i - 1]}"`;
    const label = i === 0 ? stop : `${stops[i - 1]} → ${stop}`;
    return { index: i, kind: 'route', label, target: stop, goal: `Route segment ${i + 1}/${stops.length}: go from ${from} to "${stop}" and confirm "${stop}" is shown` };
  };
}

/** The subagent tasks of a request: one per link or route segment, each with its budget slice. */
export function planSubagents(kind: SubagentKind, items: string[], totalBudget: number): SubagentTask[] {
  const slices = kind === 'link' ? items.map(linkSlice) : items.map(routeSlice(items));
  const budgets = sliceBudget(totalBudget, slices.length);
  return slices.map((s, i) => ({ ...s, id: `sub_${i + 1}`, budget: budgets[i] }));
}

const ended = (status: SubagentStatus, message: string): SubagentOutcome => ({ status, message, dry: false, shots: [], thinking: [] });

/**
 * Runs the subagents `crew` at a time (default one after another, so they never fight over the
 * screen). A slice with no budget is skipped; once `shouldStop` is true the remaining slices are
 * aborted without running. A run that throws fails with its error. `onResult` sees the rows landed
 * so far, in task order. The returned rows are in task order.
 */
export async function runSubagents(
  tasks: SubagentTask[],
  run: (task: SubagentTask) => Promise<SubagentOutcome>,
  shouldStop: () => boolean,
  onResult: (results: SubagentResult[]) => void = () => undefined,
  crew = 1,
): Promise<SubagentResult[]> {
  const rows: Array<SubagentResult | undefined> = tasks.map(() => undefined);
  let next = 0;
  const one = async (task: SubagentTask): Promise<SubagentOutcome> => {
    if (shouldStop()) return ended('aborted', 'Stopped before it started — nothing sent');
    if (task.budget < 1) return ended('skipped', 'No action budget left for this slice — not run');
    return run(task).catch((error: unknown) => ended('fail', `Subagent failed: ${error instanceof Error ? error.message : String(error)}`));
  };
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      rows[i] = { ...tasks[i], ...(await one(tasks[i])) };
      onResult(rows.filter((r): r is SubagentResult => !!r));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(crew, tasks.length)) }, worker));
  return rows.filter((r): r is SubagentResult => !!r);
}

/** Count of each status. */
export function tally(results: SubagentResult[]): Record<SubagentStatus, number> {
  const counts: Record<SubagentStatus, number> = { pass: 0, fail: 0, aborted: 0, skipped: 0 };
  results.forEach((r) => {
    counts[r.status] += 1;
  });
  return counts;
}

/** One-line summary of a report. */
export function summaryText(results: SubagentResult[]): string {
  const c = tally(results);
  return `${c.pass}/${results.length} passed · ${c.fail} failed · ${c.aborted} aborted · ${c.skipped} skipped`;
}

/**
 * The habit-system lessons of a report: a passed slice adds what worked, a failed one what to
 * avoid, plus each verdict's own avoid/add patterns. Aborted and skipped slices teach nothing.
 */
export function reportPatterns(results: SubagentResult[], goal: string): LearnedPattern[] {
  return results.flatMap((r) => {
    if (r.status !== 'pass' && r.status !== 'fail') return [];
    const own = r.status === 'pass'
      ? newPattern('add', `${r.kind} "${r.label}" works: ${r.goal}`, goal)
      : newPattern('avoid', `${r.kind} "${r.label}" failed: ${r.message}`, goal);
    const fromVerdict = [r.avoid && newPattern('avoid', r.avoid, goal), r.add && newPattern('add', r.add, goal)].filter((p): p is LearnedPattern => !!p);
    return [own, ...fromVerdict];
  });
}

/** System prompt for listing the links or route stops to test on the live screen. */
export const LIST_SYSTEM = `You are Droid Assist's test supervisor. Look at the screenshot and list what must be tested.
Reply ONLY with JSON {"items":[string]}: for links, every visible link or navigation item by its label; for a route, the screens or controls of the flow in the order a user passes them. At most 12 items.`;

/** Asks the model for the links (or ordered route stops) to test; throws AiError when it lists none. */
export async function listSections(ask: AskFn, frame: Frame | null, req: TestRequest): Promise<{ items: string[]; thinking: string | null }> {
  const reply = await ask({ system: LIST_SYSTEM, prompt: `Test request (${req.kind === 'link' ? 'links' : 'route'}): ${req.goal}`, frame, json: true });
  const raw = parseJsonReply(reply.content).items;
  const items = Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string' && !!s.trim()).map((s) => s.trim()).slice(0, 12) : [];
  if (!items.length) throw new AiError('AI listed nothing to test on this screen');
  return { items, thinking: reply.thinking };
}
