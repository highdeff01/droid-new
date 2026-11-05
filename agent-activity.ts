/**
 * What each agent on the cadence is doing right now, read from the engine's live state: one
 * reporter per agent kind (agent-cadence.ts decides who is due, this decides what they say).
 */
import type { Annotation, SyncLevel, WorkflowStep } from './types.js';
import type { CrewAgent } from './agent-crew.js';
import type { SupervisorState } from './supervisor.js';
import type { WatcherState } from './watcher.js';
import type { AgentReport, CadenceAgent, CadenceKind } from './agent-cadence.js';

/** The live engine state the reporters read. */
export interface ActivitySnapshot {
  goal: string;
  steps: WorkflowStep[];
  sync: { level: SyncLevel; detail: string };
  progress: { done: number; manual: number };
  /** The popup the popup watcher has flagged; null when none is on screen. */
  popup: Annotation | null;
  watcher: WatcherState;
  /** Familiar elements the coordinate learner knows, and elements it predefined from forwards. */
  familiar: number;
  known: number;
  supervisor: SupervisorState;
  crew: CrewAgent[];
  ops: CrewAgent[];
}

const count = (steps: WorkflowStep[], status: WorkflowStep['status']) => steps.filter((s) => s.status === status).length;

/** A crew or Operations agent's status, task and last report. */
function agentLine(agent: CrewAgent | undefined): string {
  if (!agent) return 'waiting for a command';
  const task = agent.task ? ` on "${agent.task}"` : '';
  const last = agent.lastReport ? ` — last report: ${agent.lastReport}` : '';
  return `${agent.status}${task}${last}`;
}

const REPORTERS: Record<CadenceKind, (s: ActivitySnapshot, ref?: string) => string> = {
  popup: (s) => (s.popup ? `Popup flagged: "${s.popup.label}" — watching for it to close` : 'No popup on screen — watching new frames'),
  drift: (s) => `Sync ${s.sync.level} — ${s.sync.detail}`,
  progress: (s) => `${s.progress.done} verified step(s), ${s.progress.manual} manual · ${count(s.steps, 'pending')} of ${s.steps.length} step(s) still pending`,
  goal: (s) => (s.goal.trim() ? `Reviewing goal "${s.goal.trim()}": ${count(s.steps, 'done')} done, ${count(s.steps, 'failed')} failed, ${count(s.steps, 'pending')} pending` : 'No goal set — waiting for one'),
  screenWatcher: (s) => {
    const pending = s.watcher.proposals.filter((p) => p.status === 'pending').length;
    const latest = s.watcher.notes[0] ? ` · latest note: ${s.watcher.notes[0].text}` : '';
    return `${s.watcher.notes.length} note(s), ${pending} pending proposal(s)${latest}`;
  },
  coords: (s) => `${s.familiar} familiar element(s) learned, ${s.known} predefined from forwarded elements`,
  supervisor: (s) => `${s.supervisor.status} — ${s.supervisor.detail}`,
  crew: (s, ref) => agentLine(s.crew.find((a) => a.id === ref)),
  ops: (s, ref) => agentLine(s.ops.find((a) => a.id === ref)),
};

/** One report per due agent, describing its current activity at `now`. */
export const activityReports = (due: readonly CadenceAgent[], snapshot: ActivitySnapshot, now: number): AgentReport[] =>
  due.map((a) => ({ agent: a.id, name: a.name, stage: a.stage, time: now, text: REPORTERS[a.kind](snapshot, a.ref) }));
