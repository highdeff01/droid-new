/** The two apps: droid-new (assist, the boss) and droid-main. */
export type AppId = 'assist' | 'main';
/** Where a job goes: one app, split (calculate in one, perform in the other), or both. */
export type AppChoice = AppId | 'split' | 'both';
/** The two phases of a job. */
export type JobPhase = 'calculate' | 'perform';

/** Display name of each app. */
export const APP_NAMES: Readonly<Record<AppId, string>> = { assist: 'droid-new', main: 'droid-main' };
/** Log source of every app-selection line. */
export const APP_SELECTION_SOURCE = 'App selection';

/** What an app can do for a job and what it costs (lower is cheaper); cost is ignored when incapable. */
export interface AppCapability {
  calculate: boolean;
  perform: boolean;
  calculateCost: number;
  performCost: number;
}

/** A job to place: the apps' capabilities and whether it must run on both. */
export interface Job {
  name: string;
  apps: Readonly<Record<AppId, AppCapability>>;
  /** Both apps must do it (e.g. a cross-app check). */
  needsBoth?: boolean;
}

/** Where each phase runs and why. */
export interface AppDecision {
  choice: AppChoice;
  calculate: AppId;
  perform: AppId;
  reason: string;
}

const APP_IDS: readonly AppId[] = ['assist', 'main'];
const COST: Readonly<Record<JobPhase, keyof AppCapability>> = { calculate: 'calculateCost', perform: 'performCost' };

/** The cheapest capable app for a phase (ties go to droid-new, the boss); null when neither can. */
export function cheapestFor(job: Job, phase: JobPhase): AppId | null {
  const capable = APP_IDS.filter((id) => job.apps[id][phase]);
  if (!capable.length) return null;
  return capable.reduce((best, id) => (job.apps[id][COST[phase]] < job.apps[best][COST[phase]] ? id : best));
}

const phaseText = (job: Job, phase: JobPhase, app: AppId | null) =>
  app ? `${phase} in ${APP_NAMES[app]} (cost ${job.apps[app][COST[phase]]})` : `nobody can ${phase} — ${APP_NAMES.assist} (boss) takes it`;

/** Decides which app does a job by capability and cost. */
export function decideApp(job: Job): AppDecision {
  const calc = cheapestFor(job, 'calculate');
  const perf = cheapestFor(job, 'perform');
  const calculate = calc ?? 'assist';
  const perform = perf ?? 'assist';
  const reason = `${phaseText(job, 'calculate', calc)}; ${phaseText(job, 'perform', perf)}`;
  if (job.needsBoth) return { choice: 'both', calculate, perform, reason: `both apps needed — ${reason}` };
  return { choice: calculate === perform ? calculate : 'split', calculate, perform, reason };
}

/** The log line of a decision. */
export const decisionLine = (job: Job, d: AppDecision) => `"${job.name}" → ${d.choice === 'assist' || d.choice === 'main' ? APP_NAMES[d.choice] : d.choice}: ${d.reason}`;

/** Decides and logs the decision (one line per call). */
export function selectApp(job: Job, log: (source: string, line: string) => void): AppDecision {
  const d = decideApp(job);
  log(APP_SELECTION_SOURCE, decisionLine(job, d));
  return d;
}

/**
 * The apps' standing capabilities: droid-new plans (AI, agents) and performs with real input when
 * armed; droid-main performs on its own preview cheaply and can plan when its AI is reachable.
 */
export function standingCapabilities(state: { armed: boolean; aiOnline: boolean; mainConnected: boolean }): Record<AppId, AppCapability> {
  return {
    assist: { calculate: state.aiOnline, perform: state.armed, calculateCost: 1, performCost: 2 },
    main: { calculate: state.mainConnected, perform: state.mainConnected, calculateCost: 2, performCost: 1 },
  };
}
