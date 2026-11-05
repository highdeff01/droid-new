import { parseJsonReply, type AskFn } from './ai.js';
import type { Frame } from './types.js';
import type { NoteDraft } from './watcher.js';

/**
 * AI-directed agent crew: the main AI decides, hands each agent a task, every assigned agent works
 * on its own thread (its own queued AI call and grounding), reports back what it found and then
 * WAITS for the next command. One round = decide → agents work in parallel → reports.
 */

/** How many crew agents the main AI can command. */
export const CREW_SIZE = 4;

/** The crew's agent ids, in panel order. */
export const CREW_AGENTS: readonly string[] = Array.from({ length: CREW_SIZE }, (_, i) => `agent-${i + 1}`);

/** Waiting for a command, working on one, or parked by Stop plan / abort. */
export type CrewAgentStatus = 'waiting' | 'working' | 'parked';

/** One crew agent as the panel shows it. */
export interface CrewAgent {
  id: string;
  status: CrewAgentStatus;
  /** The last task the main AI gave it. */
  task: string | null;
  /** What it reported for that task. */
  lastReport: string | null;
}

/** One command of the main AI: which agent, and what it wants found or done. */
export interface CrewCommand {
  agent: string;
  task: string;
}

/** What an agent reports back after working on its command. */
export interface CrewReport {
  agent: string;
  task: string;
  ok: boolean;
  found: string;
  /** Where on screen the agent ended (normalized), when it acted on something. */
  point?: { x: number; y: number };
}

/** The main AI's decision for one round. */
export interface CrewDecision {
  done: boolean;
  summary: string;
  commands: CrewCommand[];
  /** Agents named by a command that is not valid this round (unknown, or given a second command). */
  ignored: string[];
  thinking: string | null;
}

/** How a crew run ended. */
export type CrewStop = 'done' | 'stopped' | 'cap' | 'stalled';

/** The result of a crew run. */
export interface CrewOutcome {
  stop: CrewStop;
  rounds: number;
  reports: CrewReport[];
  summary: string;
}

/** What runCrew needs: the decision maker, the agent worker, the stop check and the observers. */
export interface CrewDeps {
  agents: readonly string[];
  maxRounds: number;
  /** The main AI decides from the previous round's reports. */
  decide: (reports: CrewReport[], round: number) => Promise<CrewDecision>;
  /** One agent works on one command and reports. */
  work: (command: CrewCommand) => Promise<CrewReport>;
  /** Stop plan, abort or an unchecked stage. */
  shouldStop: () => boolean;
  onAgents: (agents: CrewAgent[]) => void;
  onReport: (report: CrewReport) => void;
  onDecision?: (decision: CrewDecision, round: number) => void;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Reads one command entry; null when it carries no task. */
function readCommand(entry: unknown): CrewCommand | null {
  const o = (entry ?? {}) as Record<string, unknown>;
  const task = typeof o.task === 'string' ? o.task.trim() : '';
  if (!task) return null;
  return { agent: typeof o.agent === 'string' ? o.agent.trim() : '', task };
}

/**
 * The main AI's JSON reply as a decision. A command for an unknown agent, or a second command for
 * an agent already given one this round, is ignored (listed in `ignored`); a command without a task is dropped.
 */
export function parseCrewDecision(raw: Record<string, unknown>, agents: readonly string[]): Omit<CrewDecision, 'thinking'> {
  const entries = Array.isArray(raw.commands) ? raw.commands : [];
  const commands: CrewCommand[] = [];
  const ignored: string[] = [];
  for (const command of entries.map(readCommand)) {
    if (!command) continue;
    if (!agents.includes(command.agent) || commands.some((c) => c.agent === command.agent)) ignored.push(command.agent || '(no agent)');
    else commands.push(command);
  }
  return { done: raw.done === true, summary: typeof raw.summary === 'string' ? raw.summary : '', commands, ignored };
}

/** System prompt of the main AI directing the crew. */
export const CREW_SYSTEM = `You are Droid Assist's main AI directing a crew of agents on the user's screen.
Think about the goal and the agents' reports, then decide what each agent must find or do next. Several agents may work at once; give each at most one command and coordinate them so they do not fight over the same element.
Reply ONLY with JSON {"done":boolean,"summary":string,"commands":[{"agent":string,"task":string}]}. Set "done" true (and no commands) when the goal is complete or cannot progress.`;

/** One report as a prompt line. */
const reportLine = (r: CrewReport) => `${r.agent} (${r.ok ? 'ok' : 'failed'}) on "${r.task}": ${r.found}`;

/** Asks the main AI for the next round's commands (`system` names the roster's roles; the crew prompt by default). */
export async function decideCrew(ask: AskFn, frame: Frame | null, goal: string, agents: readonly CrewAgent[], reports: CrewReport[], system = CREW_SYSTEM): Promise<CrewDecision> {
  const roster = agents.map((a) => `${a.id}: ${a.status}${a.lastReport ? ` — last report: ${a.lastReport}` : ''}`).join('\n');
  const prompt = `Goal: ${goal}\nAgents:\n${roster}\n${reports.length ? `Reports from the last round:\n${reports.map(reportLine).join('\n')}` : 'No reports yet: this is the first round.'}`;
  const reply = await ask({ system, prompt, frame, json: true });
  return { ...parseCrewDecision(parseJsonReply(reply.content), agents.map((a) => a.id)), thinking: reply.thinking };
}

/** An agent report as a Screen watcher note. */
export const reportNote = (r: CrewReport): NoteDraft => ({ kind: r.ok ? 'element' : 'unusual', text: `Crew ${reportLine(r)}` });

/** Serializes real screen input: two agents never move the pointer at once. */
export function createScreenLock() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}

/**
 * The command loop: the main AI decides, every commanded agent works in parallel and reports, then
 * waits for the next decision. Ends when the AI says done, assigns nothing (stalled), the round cap
 * is reached, or `shouldStop` turns true — which parks every agent.
 */
export async function runCrew(deps: CrewDeps): Promise<CrewOutcome> {
  let agents: CrewAgent[] = deps.agents.map((id) => ({ id, status: 'waiting', task: null, lastReport: null }));
  const publish = (next: CrewAgent[]) => {
    agents = next;
    deps.onAgents(agents);
  };
  const patch = (id: string, change: Partial<CrewAgent>) => publish(agents.map((a) => (a.id === id ? { ...a, ...change } : a)));
  const all: CrewReport[] = [];
  const end = (stop: CrewStop, rounds: number, summary: string): CrewOutcome => {
    if (stop === 'stopped') publish(agents.map((a) => ({ ...a, status: 'parked' })));
    return { stop, rounds, reports: all, summary };
  };
  const work = async (command: CrewCommand): Promise<CrewReport> => {
    const report = await deps.work(command).catch((error): CrewReport => ({ agent: command.agent, task: command.task, ok: false, found: errorText(error) }));
    deps.onReport(report);
    patch(command.agent, { status: deps.shouldStop() ? 'parked' : 'waiting', lastReport: report.found });
    return report;
  };
  publish(agents);
  let last: CrewReport[] = [];
  for (let round = 1; round <= deps.maxRounds; round++) {
    if (deps.shouldStop()) return end('stopped', round - 1, 'Stopped before the next decision');
    let decision: CrewDecision;
    try {
      decision = await deps.decide(last, round);
    } catch (error) {
      if (deps.shouldStop()) return end('stopped', round - 1, 'Stopped while the main AI was deciding');
      throw error;
    }
    if (deps.shouldStop()) return end('stopped', round - 1, 'Stopped before the agents were commanded');
    deps.onDecision?.(decision, round);
    if (decision.done) return end('done', round, decision.summary || 'Goal complete');
    if (!decision.commands.length) return end('stalled', round, decision.summary || 'The main AI assigned no work');
    publish(agents.map((a) => {
      const command = decision.commands.find((c) => c.agent === a.id);
      return command ? { ...a, status: 'working', task: command.task } : a;
    }));
    last = await Promise.all(decision.commands.map(work));
    all.push(...last);
    if (deps.shouldStop()) return end('stopped', round, 'Stopped after the agents reported');
  }
  return end('cap', deps.maxRounds, `Max rounds (${deps.maxRounds}) reached`);
}
