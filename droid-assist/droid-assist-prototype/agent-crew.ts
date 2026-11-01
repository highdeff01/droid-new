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
  /** ID of the screenshot/frame used to ground this report. */
  screenshotId?: number;
  /** Normalized region the report refers to; reviewers can inspect the same frame region. */
  evidenceRegion?: { x: number; y: number; w: number; h: number };
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
  /** Automatic follow-ups can guarantee a minimum number of enabled workers receive bounded tasks. */
  minimumCommands?: number;
  fallbackTasks?: Readonly<Partial<Record<string, string>>>;
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
Think about the goal and the agents' reports, then decide what each agent must find or do next. Several agents may work at once; give each at most one command and coordinate them so they do not fight over the same element. Treat every report as a claim to verify, not a fact to accept. Compare reports against the current screenshot and each other's findings; call out contradictions, stale coordinates, covered/missing targets, and evidence that the current controller is blocked or still making verified progress. When evidence conflicts, assign an independent cross-check or a small test of the competing route. Prefer the route that passes screenshot-backed verification and the user's goal criteria, not the agent with the highest confidence alone. Agents may propose an override while another agent owns input, but they must not dispatch physical input themselves; the main AI arbitrates and the single input gate serializes execution. Replies should identify the screenshot/frame ID and the relevant normalized region when discussing a visual finding.
Reply ONLY with JSON {"done":boolean,"summary":string,"commands":[{"agent":string,"task":string}]}. Set "done" true (and no commands) when the goal is complete or cannot progress.`;

/** One report as a prompt line. */
const reportLine = (r: CrewReport) => {
  const region = r.evidenceRegion ? ` region x=${r.evidenceRegion.x.toFixed(3)},y=${r.evidenceRegion.y.toFixed(3)},w=${r.evidenceRegion.w.toFixed(3)},h=${r.evidenceRegion.h.toFixed(3)}` : '';
  const frame = r.screenshotId !== undefined ? ` [frame #${r.screenshotId}${region}]` : '';
  const point = r.point ? ` at (${r.point.x.toFixed(3)}, ${r.point.y.toFixed(3)})` : '';
  return `${r.agent} (${r.ok ? 'ok' : 'failed'}) on "${r.task}"${frame}${point}: ${r.found}`;
};

/** Asks the main AI for the next round's commands (`system` names the roster's roles; the crew prompt by default). */
export async function decideCrew(ask: AskFn, frame: Frame | null, goal: string, agents: readonly CrewAgent[], reports: CrewReport[], system = CREW_SYSTEM, perception = ''): Promise<CrewDecision> {
  const roster = agents.map((a) => `${a.id}: ${a.status}${a.lastReport ? ` — last report: ${a.lastReport}` : ''}`).join('\n');
  const prompt = `Goal: ${goal}\nAgents:\n${roster}\n${reports.length ? `Reports from the last round:\n${reports.map(reportLine).join('\n')}` : 'No reports yet: this is the first round.'}`;
  const reply = await ask({ system, prompt, frame, json: true });
  return { ...parseCrewDecision(parseJsonReply(reply.content), agents.map((a) => a.id)), thinking: reply.thinking };
}

/** An agent report as a Screen watcher note. */
export const reportNote = (r: CrewReport): NoteDraft => ({ kind: r.ok ? 'element' : 'unusual', text: `Crew ${reportLine(r)}` });

/** A serialized native-input gate. Queued work is generation-fenced when ownership changes. */
export interface ScreenLock {
  <T>(fn: () => Promise<T>): Promise<T>;
  /** Invalidates every queued dispatch captured under an older generation. */
  invalidate(): number;
  generation(): number;
}

/**
 * Serializes only the physical send, not planning, screenshot inspection or grounding. Each queued
 * dispatch captures a generation; a pause/transfer invalidates stale queued work before it reaches
 * the native bridge. An already-running native action must still acknowledge cancellation/release
 * at its own safe boundary before another action can enter the queue.
 */
export function createScreenLock(): ScreenLock {
  let tail: Promise<unknown> = Promise.resolve();
  let currentGeneration = 1;
  const lock = (<T>(fn: () => Promise<T>): Promise<T> => {
    const capturedGeneration = currentGeneration;
    const run = tail.then(async () => {
      if (capturedGeneration !== currentGeneration) throw new Error('Stale physical-input dispatch rejected after control generation changed');
      return fn();
    }, async () => {
      if (capturedGeneration !== currentGeneration) throw new Error('Stale physical-input dispatch rejected after control generation changed');
      return fn();
    });
    tail = run.catch(() => undefined);
    return run;
  }) as ScreenLock;
  lock.invalidate = () => ++currentGeneration;
  lock.generation = () => currentGeneration;
  return lock;
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
    if (deps.minimumCommands && !decision.done) {
      const commands = [...decision.commands];
      for (const id of deps.agents) {
        if (commands.length >= deps.minimumCommands) break;
        const task = deps.fallbackTasks?.[id];
        if (task && !commands.some((command) => command.agent === id)) commands.push({ agent: id, task });
      }
      if (commands.length) decision = { ...decision, done: false, commands };
    }
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
