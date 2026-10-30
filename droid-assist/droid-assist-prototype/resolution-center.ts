import type { Frame, WorkflowStep } from './types.js';
import { AiError, parseJsonReply, type AskFn } from './ai.js';
import { BUS_AGENTS, sameElement, type BusAgentId, type BusMessage, type ForwardedElement } from './agent-bus.js';
import { uid } from './planner.js';

/** Normalized distance above which two reports of one element disagree. */
export const DISAGREEMENT_THRESHOLD = 0.05;

/** Who made a report: the main AI's plan or one of the bus agents. */
export type Reporter = 'main' | BusAgentId;

/** One judgment of where an element is. */
export interface Report {
  reporter: Reporter;
  element: ForwardedElement;
  time: number;
}

/** Two or more reporters placing the same element far apart. */
export interface Disagreement {
  id: string;
  element: string;
  /** The latest report of each distinct reporter, newest first. */
  reports: Report[];
  /** Largest distance between two of the reports (normalized). */
  spread: number;
}

/** The model's ruling on a disagreement. */
export interface Ruling {
  winner: Reporter | null;
  /** The workflow the main AI should run with the resolved target. */
  workflow: string[];
  info: string;
  needsTest: boolean;
  thinking: string | null;
}

/** How a disagreement was settled: AI ruling, test, droid-new's arbiter verdict on a disputed step, or not at all. */
export type ResolutionVia = 'ai' | 'test' | 'arbiter' | 'unresolved';

/** The log wording of each way a disagreement was settled. */
export const VIA_TEXT: Readonly<Record<ResolutionVia, string>> = {
  ai: 'Resolved by AI ruling',
  test: 'Resolved by test',
  arbiter: 'Resolved by droid-new (arbiter)',
  unresolved: 'Unresolved',
};

/** A finished resolution, as listed in the panel. */
export interface Resolution {
  id: string;
  time: number;
  element: string;
  via: ResolutionVia;
  winner: Report | null;
  /** What the main AI is told: the edit, the workflow and the accompanying info. */
  brief: string;
}

/** Display name of a reporter. */
export const reporterName = (r: Reporter) => (r === 'main' ? 'Main AI' : BUS_AGENTS[r]);

const distance = (a: ForwardedElement, b: ForwardedElement) => Math.hypot(a.x - b.x, a.y - b.y);

/** The main plan's placement of each targeted step (time 0: it is the standing judgment every newer report is weighed against). */
function mainReports(steps: WorkflowStep[]): Report[] {
  return steps
    .filter((s) => s.target)
    .map((s) => ({ reporter: 'main' as const, element: { name: s.target!, x: s.correctedX ?? s.x, y: s.correctedY ?? s.y }, time: 0 }));
}

/** One report per forwarded element (a fan-out puts the same element in every inbox). */
function busReports(bus: BusMessage[]): Report[] {
  const seen = new Set<string>();
  return bus.flatMap((m) => {
    const key = `${m.from}|${m.time}|${m.element.name}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ reporter: m.from, element: m.element, time: m.time }];
  });
}

/** Largest pairwise distance of the reports. */
function spreadOf(reports: Report[]): number {
  return reports.reduce((max, a, i) => reports.slice(i + 1).reduce((m, b) => Math.max(m, distance(a.element, b.element)), max), 0);
}

/** Reports grouped by element name, keeping the latest report of each reporter. */
function groupReports(reports: Report[]): Report[][] {
  const groups: Report[][] = [];
  for (const r of [...reports].sort((a, b) => b.time - a.time)) {
    const group = groups.find((g) => sameElement(g[0].element.name, r.element.name));
    if (!group) groups.push([r]);
    else if (!group.some((g) => g.reporter === r.reporter)) group.push(r);
  }
  return groups;
}

/** A group's element name as first reported (the main plan's name when it is in the group). */
const firstName = (reports: Report[]) => reports[reports.length - 1].element.name;

/**
 * Disagreements between the main plan and the agents' bus reports: every element two or more
 * distinct reporters place more than `threshold` apart. Agreeing reports are not disagreements.
 */
export function detectDisagreements(steps: WorkflowStep[], bus: BusMessage[], threshold = DISAGREEMENT_THRESHOLD): Disagreement[] {
  return groupReports([...mainReports(steps), ...busReports(bus)])
    .filter((g) => g.length > 1)
    .map((reports) => ({ id: `dis:${firstName(reports).trim().toLowerCase()}`, element: firstName(reports), reports, spread: spreadOf(reports) }))
    .filter((d) => d.spread > threshold);
}

const reportLine = (r: Report, i: number) => `${i + 1}. ${r.reporter} (${reporterName(r.reporter)}) puts it at x=${r.element.x.toFixed(3)}, y=${r.element.y.toFixed(3)}`;

/** Reads the ruling JSON; a winner that is not one of the reporters is an AiError, never guessed. */
export function parseRuling(content: string, thinking: string | null, d: Disagreement): Ruling {
  const r = parseJsonReply(content);
  const winner = typeof r.winner === 'string' && r.winner.trim() ? r.winner.trim() : null;
  if (winner && !d.reports.some((p) => p.reporter === winner)) throw new AiError(`Resolution ruling named an unknown reporter "${winner}"`);
  const workflow = (Array.isArray(r.workflow) ? r.workflow : []).filter((w): w is string => typeof w === 'string' && !!w.trim());
  return { winner: winner as Reporter | null, workflow, info: typeof r.info === 'string' ? r.info.trim() : '', needsTest: r.needs_test === true || !winner, thinking };
}

/** Asks the model which reporter is right about the element, with the workflow and info that go with the edit. */
export async function resolveDisagreement(ask: AskFn, d: Disagreement, frame: Frame | null): Promise<Ruling> {
  const reply = await ask({
    system: (view) => `You are Droid Assist's resolution center. AIs and agents disagree about where an on-screen element is. Judge from the screenshot (${view.w}x${view.h}) which report is right. Reply ONLY with JSON {"winner":string|null,"workflow":[string],"info":string,"needs_test":boolean} where winner is one reporter id from the list, workflow is the steps the main AI should run with the resolved target, info is what it needs to know, and needs_test is true when only a test can settle it.`,
    prompt: `Element "${d.element}" (spread ${d.spread.toFixed(3)}):\n${d.reports.map(reportLine).join('\n')}`,
    frame,
    json: true,
  });
  return parseRuling(reply.content, reply.thinking, d);
}

/** Tests each report in turn (newest first); the first that passes wins, none passing leaves it unresolved. */
export async function settleByTests(d: Disagreement, test: (r: Report) => Promise<boolean>): Promise<Report | null> {
  for (const r of d.reports) if (await test(r)) return r;
  return null;
}

/** What the main AI is told: the suggested edit, the workflow and the accompanying info. */
export function resolutionBrief(d: Disagreement, winner: Report | null, ruling: Ruling | null): string {
  if (!winner) return `"${d.element}" unresolved — ${d.reports.map((r) => reporterName(r.reporter)).join(' vs ')} disagree by ${d.spread.toFixed(3)} and no report passed a test`;
  const edit = `Use "${d.element}" at x=${winner.element.x.toFixed(3)}, y=${winner.element.y.toFixed(3)} (${reporterName(winner.reporter)})`;
  const workflow = ruling?.workflow.length ? ` · workflow: ${ruling.workflow.join(' → ')}` : '';
  const info = ruling?.info ? ` · info: ${ruling.info}` : '';
  return `${edit}${workflow}${info}`;
}

/** The resolution record of a settled (or unsettled) disagreement. */
export function toResolution(d: Disagreement, via: ResolutionVia, winner: Report | null, ruling: Ruling | null, now = Date.now()): Resolution {
  return { id: uid('res'), time: now, element: d.element, via, winner, brief: resolutionBrief(d, winner, ruling) };
}

/** Droid-new's arbiter verdict on a step both apps' agents disputed: its verification is the brief. */
export function arbiterResolution(step: string, brief: string, now = Date.now()): Resolution {
  return { id: uid('res'), time: now, element: step, via: 'arbiter', winner: null, brief };
}

/** The ruling's winning report; null when it named none. */
export const winningReport = (d: Disagreement, ruling: Ruling): Report | null => d.reports.find((r) => r.reporter === ruling.winner) ?? null;

/** Disagreements not yet settled: a settled element reopens only when a report newer than its resolution arrives. */
export function openDisagreements(found: Disagreement[], resolutions: Resolution[]): Disagreement[] {
  return found.filter((d) => {
    const settled = resolutions.find((r) => r.via !== 'unresolved' && sameElement(r.element, d.element));
    return !settled || d.reports.some((r) => r.time > settled.time);
  });
}
