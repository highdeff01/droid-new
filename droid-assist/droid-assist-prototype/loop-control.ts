/**
 * Loop control: one on/off switch per automation stage and agent. Guardrails (arm/disarm,
 * emergency stop, action budget, abort) are deliberately not stages — no switch can disable them.
 */

/** Whether a stage is a step of the plan → ground → execute → reflect → verdict pipeline or a background agent. */
export type StageGroup = 'pipeline' | 'agent';

/** One switchable stage: what it is and the code path it gates. */
export interface Stage {
  id: StageId;
  group: StageGroup;
  name: string;
  description: string;
  /** Turning it off lets steps run without this check (shown as an unverified-input warning). */
  verifies: boolean;
}

/** Every switchable stage and agent, in panel order. */
export const STAGES = [
  { id: 'planner', group: 'pipeline', name: 'Planner', description: 'AI plans steps from the goal (AI plan, /move, auto-continue re-plans)', verifies: false },
  { id: 'grounding', group: 'pipeline', name: 'Grounding', description: 'AI confirms each named target on a zoomed crop before input', verifies: true },
  { id: 'briefing', group: 'pipeline', name: 'Pre-action briefing', description: 'Before each step: objectives, live-vs-reference screenshot comparison and knowledge cross-reference; recalibrates, re-grounds or re-plans on conflicts', verifies: false },
  { id: 'executor', group: 'pipeline', name: 'Executor', description: 'Runs steps as input (demo or desktop bridge)', verifies: false },
  { id: 'reflect', group: 'pipeline', name: 'Reflect', description: 'AI reflects on the screen after each executed step', verifies: true },
  { id: 'verdict', group: 'pipeline', name: 'Verdict', description: 'AI gives the final success verdict and lessons for each step', verifies: true },
  { id: 'autoContinue', group: 'pipeline', name: 'Auto-continue', description: 'After a replay, verify the goal and keep re-planning until done', verifies: false },
  { id: 'screenResponder', group: 'pipeline', name: 'Screen-change responder', description: 'Auto Act reacts to each new frame and runs the next step', verifies: false },
  { id: 'popup', group: 'agent', name: 'Popup watcher', description: 'Flags ads & intrusive popups, auto-closes when Auto act is on', verifies: false },
  { id: 'drift', group: 'agent', name: 'Drift monitor', description: 'Cross-checks every frame against the active step', verifies: true },
  { id: 'progress', group: 'agent', name: 'Progress tracker', description: 'Counts verified steps toward the goal', verifies: false },
  { id: 'goal', group: 'agent', name: 'Goal reviewer', description: 'Reviews the goal after each run', verifies: false },
  { id: 'screenWatcher', group: 'agent', name: 'Screen watcher', description: 'AI help: answers questions about the live screen', verifies: false },
  { id: 'identify', group: 'agent', name: 'Element identifier', description: 'Sends missed, unproposed, new or changing elements to the AI and agent-tests the answer (3 tries / 30 s)', verifies: false },
  { id: 'coords', group: 'agent', name: 'Coordinate learner', description: 'Learns and reuses target coordinates from verified steps (habits)', verifies: false },
  { id: 'supervisor', group: 'agent', name: 'Supervisor', description: 'Reviews finished runs: saves flows and learns patterns', verifies: false },
  { id: 'elementMap', group: 'agent', name: 'Element-mapping intercept', description: 'Remembers used targets as familiar elements', verifies: false },
  { id: 'subagents', group: 'agent', name: 'Subagent testing', description: 'Test-clicks single elements from the Elements panel', verifies: false },
  { id: 'trainer', group: 'agent', name: 'Element trainer', description: 'Trains mapped elements (exclusive test runs, link/popup exploration, research) and proposes their perform functions', verifies: false },
] as const satisfies ReadonlyArray<Omit<Stage, 'id'> & { id: string }>;

/** The id of a stage or agent. */
export type StageId = (typeof STAGES)[number]['id'];

/** On/off per stage, persisted with the settings. */
export type StageMap = Record<StageId, boolean>;

/** Every stage on. */
export const DEFAULT_STAGES: StageMap = Object.fromEntries(STAGES.map((s) => [s.id, true])) as StageMap;

/** The catalogue entry of `id`. */
export const stageOf = (id: StageId): Stage => STAGES.find((s) => s.id === id)!;

/** A stored map merged over the defaults: unknown keys and non-boolean values are dropped. */
export function sanitizeStages(raw: unknown): StageMap {
  const out = { ...DEFAULT_STAGES };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const s of STAGES) {
    const v = (raw as Record<string, unknown>)[s.id];
    if (typeof v === 'boolean') out[s.id] = v;
  }
  return out;
}

/** Verification stages that are off: steps run without those checks. */
export const unverifiedStages = (map: StageMap): Stage[] => STAGES.filter((s) => s.verifies && !map[s.id]);

/** Log text of one toggle. */
export const toggleMessage = (id: StageId, on: boolean) => `${stageOf(id).name} ${on ? 'enabled' : 'disabled'}${on ? '' : ' — its in-flight AI calls were cancelled'}`;

/** Refusal text when a gated stage is off. */
export const stageOff = (id: StageId) => `${stageOf(id).name} stage is unchecked in Loop control`;

/** One AbortController per stage: `cancel` aborts the stage's in-flight calls and arms a fresh controller. */
export function createStageControllers() {
  const ctrls = new Map<StageId, AbortController>();
  const get = (id: StageId) => {
    let c = ctrls.get(id);
    if (!c) {
      c = new AbortController();
      ctrls.set(id, c);
    }
    return c;
  };
  return {
    signal: (id: StageId) => get(id).signal,
    cancel: (id: StageId) => {
      get(id).abort();
      ctrls.set(id, new AbortController());
    },
  };
}
