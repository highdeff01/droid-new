/**
 * Element-relevance logging for play/interaction: every important element is logged with its
 * position AND relevance, cross-referenced each turn into an interaction perspective (what the
 * character sees and should do next), planned as parallel lanes — one act lane that recaptures after
 * acting, plus side-agent monitor lanes on the surrounding elements.
 */

/** An element the AI reported this turn: where it is and how relevant it is (0..1) to what to do next. */
export interface ElementReport {
  name: string;
  x: number;
  y: number;
  relevance: number;
}

/** A logged element: its last reported position and relevance and the turn it was last seen. */
export interface Sighting extends ElementReport {
  /** Turn the element was first logged. */
  firstTurn: number;
  /** Turn the element was last seen. */
  turn: number;
}

/** Relevance at or above this is a candidate to act on; below it an element is peripheral. */
export const FOCUS_THRESHOLD = 0.5;

/** Most elements kept in the log (most recently seen first). */
export const SIGHTING_LIMIT = 100;

/** A move larger than this (normalized distance) is reported by the monitor. */
export const MOVE_EPSILON = 0.02;

/** A relevance change larger than this is reported by the monitor. */
export const RELEVANCE_EPSILON = 0.2;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const keyOf = (name: string) => name.trim().toLowerCase();

/**
 * The log with this turn's reports merged in: matched by case-insensitive name (position and
 * relevance updated, first turn kept), new elements added; values clamped to 0..1, blank names
 * ignored. Most recently seen first, capped at SIGHTING_LIMIT.
 */
export function logSightings(log: Sighting[], reports: ElementReport[], turn: number): Sighting[] {
  const byKey = new Map<string, Sighting>();
  for (const r of reports) {
    const name = r.name.trim();
    if (!name) continue;
    const prior = byKey.get(keyOf(name)) ?? log.find((s) => keyOf(s.name) === keyOf(name));
    byKey.set(keyOf(name), { name, x: clamp01(r.x), y: clamp01(r.y), relevance: clamp01(r.relevance), firstTurn: prior?.firstTurn ?? turn, turn });
  }
  const rest = log.filter((s) => !byKey.has(keyOf(s.name)));
  return [...byKey.values(), ...rest].slice(0, SIGHTING_LIMIT);
}

/** What the character sees on a turn and what it should do next. */
export interface Perspective {
  turn: number;
  /** The most relevant element seen this turn: what to act on next; null when nothing was seen. */
  focus: Sighting | null;
  /** Other elements seen this turn at or above FOCUS_THRESHOLD, most relevant first. */
  candidates: Sighting[];
  /** Elements seen this turn below FOCUS_THRESHOLD: the surroundings side agents watch. */
  peripheral: Sighting[];
  /** Elements seen on an earlier turn but not this one. */
  gone: Sighting[];
  /** One-line summary for the log and the AI prompt. */
  summary: string;
}

const byRelevance = (a: Sighting, b: Sighting) => b.relevance - a.relevance;
const pctOf = (v: number) => `${Math.round(v * 100)}%`;
const describe = (s: Sighting) => `"${s.name}" at (${pctOf(s.x)}, ${pctOf(s.y)}) relevance ${s.relevance.toFixed(2)}`;

/** The summary line of a perspective's parts. */
function perspectiveSummary(focus: Sighting | null, candidates: Sighting[], peripheral: Sighting[], gone: Sighting[]): string {
  if (!focus) return 'Nothing important in view';
  const parts = [`Focus ${describe(focus)}`];
  if (candidates.length) parts.push(`then ${candidates.map((s) => `"${s.name}"`).join(', ')}`);
  if (peripheral.length) parts.push(`watching ${peripheral.map((s) => `"${s.name}"`).join(', ')}`);
  if (gone.length) parts.push(`no longer seen ${gone.map((s) => `"${s.name}"`).join(', ')}`);
  return parts.join(' · ');
}

/** Cross-references the log on `turn` into the character's interaction perspective. */
export function perspective(log: Sighting[], turn: number): Perspective {
  const seen = log.filter((s) => s.turn === turn).sort(byRelevance);
  const [focus = null, ...others] = seen;
  const candidates = others.filter((s) => s.relevance >= FOCUS_THRESHOLD);
  const peripheral = others.filter((s) => s.relevance < FOCUS_THRESHOLD);
  const gone = log.filter((s) => s.turn < turn);
  return { turn, focus, candidates, peripheral, gone, summary: perspectiveSummary(focus, candidates, peripheral, gone) };
}

/** One lane of a parallel workflow: the act lane (acts, then recaptures the screen) or a side-agent monitor lane. */
export interface Lane {
  kind: 'act' | 'monitor';
  element: Sighting;
  /** Recapture the screen after this lane runs, so the next turn sees the result. */
  recapture: boolean;
  label: string;
}

/** The parallel workflow of a perspective: the focus as the act lane plus one monitor lane per peripheral element. */
export function planLanes(view: Perspective): Lane[] {
  if (!view.focus) return [];
  const act: Lane = { kind: 'act', element: view.focus, recapture: true, label: `Act on "${view.focus.name}", then recapture` };
  const monitors = view.peripheral.map((element): Lane => ({ kind: 'monitor', element, recapture: false, label: `Side agent watches "${element.name}"` }));
  return [act, ...monitors];
}

/** A change a side agent saw on an element it monitors between two turns. */
export interface ElementChange {
  name: string;
  change: 'moved' | 'vanished' | 'relevance';
  detail: string;
}

/** What changed for one monitored element between its previous and next sighting; null when nothing did. */
function changeOf(before: Sighting, after: Sighting | undefined): ElementChange | null {
  if (!after) return { name: before.name, change: 'vanished', detail: `"${before.name}" is no longer in view` };
  if (Math.hypot(after.x - before.x, after.y - before.y) > MOVE_EPSILON) return { name: before.name, change: 'moved', detail: `"${before.name}" moved to (${pctOf(after.x)}, ${pctOf(after.y)})` };
  if (Math.abs(after.relevance - before.relevance) > RELEVANCE_EPSILON) return { name: before.name, change: 'relevance', detail: `"${before.name}" relevance ${before.relevance.toFixed(2)} → ${after.relevance.toFixed(2)}` };
  return null;
}

/**
 * The side agents' report: for each monitor lane planned on the previous turn, what changed in the
 * next turn's sightings (`next` is the log after the next turn, `turn` that turn's number).
 */
export function monitorChanges(lanes: Lane[], next: Sighting[], turn: number): ElementChange[] {
  return lanes
    .filter((l) => l.kind === 'monitor')
    .map((l) => changeOf(l.element, next.find((s) => s.turn === turn && keyOf(s.name) === keyOf(l.element.name))))
    .filter((c): c is ElementChange => c !== null);
}
