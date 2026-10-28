import { useRef, useState } from 'react';
import type { Frame, LogEntry, StepAction, WorkflowStep } from './types.js';
import { STEP_ACTIONS } from './types.js';
import type { ActionBudget, DispatchState } from './safety.js';
import type { AskFn } from './ai.js';
import type { HabitOutcome } from './habits.js';
import { STAGES, type StageId } from './loop-control.js';
import { uid } from './planner.js';
import { askCapability, createRegistry, invokeCapability, parseDoRequest, type Caller, type Capability, type CapabilityResult, type Params, type Registry } from './capability-registry.js';
import { askShotConfirm, buildSlides, finishPresentation, presentationText, verifySlide, type Presentation, type SlideSource } from './presentation.js';
import { findScript, runnableSteps, saveScript, validateScript, type SavedScript } from './script-op.js';
import { simulateFlow, simulationOutcomes, simulationText } from './simulation.js';
import { addNote, notableMoment, sessionText, startSession, toKnowledge, type KnowledgeEntry, type VideoSession } from './video-notes.js';
import { loadArtifacts, saveArtifacts, upsertArtifact } from './artifact-store.js';

/** One step's result on the real-input path: `halt` when abort, disarm or the budget stopped it. */
export interface StepRun {
  ok: boolean;
  executed: boolean;
  message: string;
  halt?: boolean;
}

/** What the capabilities drive in the engine. */
export interface CapabilityDeps {
  /** Records a proposal, runs the pre-action briefing and executes `step` (armed = bridge dispatch); `budget` is one run's. */
  runBriefed: (actor: string, step: WorkflowStep, budget: ActionBudget, dryRun: boolean) => Promise<StepRun>;
  /** Runs `step` as a dry run: no input is dispatched. */
  dryRun: (actor: string, step: WorkflowStep) => Promise<StepRun>;
  /** A fresh action budget for one capability run. */
  newBudget: () => ActionBudget;
  armed: () => boolean;
  /** Where input goes right now: real only when armed with the bridge online; the label says why not. */
  dispatch: () => DispatchState;
  /** The latest captured frame, or null before the first. */
  live: () => Frame | null;
  /** The AskFn of a stage while the AI is online, null when it is offline. */
  ask: (stage: StageId) => AskFn | null;
  learn: (outcomes: HabitOutcome[]) => void;
  /** The app the habits of this moment belong to. */
  app: () => string;
  log: (from: string, message: string, tone?: LogEntry['tone'], shots?: string[]) => void;
  stageOn: (id: StageId) => boolean;
  toggleStage: (id: StageId, on: boolean) => void;
  sleep: (ms: number) => Promise<unknown>;
}

const ACTOR = 'Capabilities';
const CONTROL_ACTIONS: readonly StepAction[] = STEP_ACTIONS.filter((a) => a !== 'measure');
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const lines = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const mode = (d: DispatchState) => (d.real ? 'sent to the bridge' : `${d.label} — ${d.reason}, no real input sent`);

/** What running steps on the real-input path needs. */
export type RunDeps = Pick<CapabilityDeps, 'runBriefed' | 'newBudget' | 'armed' | 'dispatch'>;

/** How a caller is named in the log and in approvals. */
export const callerName = (c: Caller) => (c.kind === 'agent' ? `Agent ${c.stage}` : c.kind === 'main' ? 'Main AI' : 'User');

/** Runs `steps` one by one on the real-input path (dry run unless armed); stops at the first failure or halt. */
export async function runSteps(deps: RunDeps, label: string, steps: WorkflowStep[]): Promise<CapabilityResult> {
  const dryRun = !deps.armed();
  const budget = deps.newBudget();
  for (const step of steps) {
    const out = await deps.runBriefed(label, step, budget, dryRun);
    if (!out.ok) return { ok: false, message: `${label}: "${step.name}" failed${out.halt ? ' (run halted)' : ''} — ${out.message}` };
  }
  return { ok: true, message: `${label}: ${steps.length} step(s) ran (${mode(deps.dispatch())})`, data: { real: deps.dispatch().real } };
}

/** A single computer-control step from params. */
function controlStep(p: Params): WorkflowStep | string {
  const action = str(p.action) as StepAction;
  if (!CONTROL_ACTIONS.includes(action)) return `action "${action}" is not a computer-control action (${CONTROL_ACTIONS.join(', ')})`;
  const target = str(p.target) || undefined;
  return { id: uid('ctl'), name: target ?? action, action, x: num(p.x, 0.5), y: num(p.y, 0.5), status: 'pending', ...(target ? { target } : {}), ...(str(p.text) ? { text: str(p.text) } : {}) };
}

/** A capability parameter's spec. */
export const param = (name: string, type: Capability['params'][number]['type'], required: boolean, description: string) => ({ name, type, required, description });

/** The artifact stores the capabilities read and write. */
interface Stores {
  scripts: () => SavedScript[];
  savePresentation: (p: Presentation) => void;
  saveScripts: (list: SavedScript[]) => void;
  saveKnowledge: (e: KnowledgeEntry) => void;
}

/** presentation.build: composes, verifies each slide and saves the presentation (done only when every slide passed). */
function presentationCap(deps: CapabilityDeps, stores: Stores): Capability {
  return {
    id: 'presentation.build', access: 'all',
    description: 'Compose slides from notes, research results and the live screenshot; verify each slide (screenshot + completeness) and save the presentation',
    params: [param('name', 'string', true, 'presentation name'), param('slides', 'array', true, 'slides: {title, notes?: string[], research?: string[], screenshot?: boolean (use the live screen)}')],
    invoke: async (p) => {
      const sources: SlideSource[] = (p.slides as unknown[]).map((raw) => {
        const r = (raw ?? {}) as Record<string, unknown>;
        return { title: str(r.title), notes: lines(r.notes), research: lines(r.research), shot: r.screenshot === true ? deps.live() : null };
      });
      const draft = buildSlides(str(p.name), sources);
      const ask = deps.ask('verdict');
      const confirm = ask ? askShotConfirm(ask) : null;
      const slides = await Promise.all(draft.slides.map((s, i) => verifySlide(s, sources[i].shot ?? null, confirm)));
      const done = finishPresentation(draft, slides);
      stores.savePresentation(done);
      return { ok: done.status === 'done', message: presentationText(done), data: done };
    },
  };
}

/** script.save and script.run: bounded standalone scripts saved by name and run through the briefing and guardrails. */
function scriptCaps(deps: CapabilityDeps, stores: Stores): Capability[] {
  const resolve = (p: Params): WorkflowStep[] | string => {
    if (p.steps !== undefined) {
      const v = validateScript(p.steps);
      return v.ok ? v.steps : v.reason;
    }
    const saved = findScript(stores.scripts(), str(p.name));
    return saved ? runnableSteps(saved) : `no saved script named "${str(p.name)}"`;
  };
  return [
    {
      id: 'script.save', access: 'all', description: 'Validate a bounded script (click/type/key/wait, at most the fix-script step limit) and save it as a named reusable operation',
      params: [param('name', 'string', true, 'operation name (same name replaces)'), param('steps', 'array', true, 'steps: {action, name?, target?, x?, y?, text?}'), param('description', 'string', false, 'what it does')],
      invoke: async (p) => {
        const v = validateScript(p.steps);
        if (!v.ok) return { ok: false, message: `script.save refused — ${v.reason}` };
        stores.saveScripts(saveScript(stores.scripts(), str(p.name), str(p.description), v.steps));
        return { ok: true, message: `Saved script "${str(p.name)}" (${v.steps.length} step(s))` };
      },
    },
    {
      id: 'script.run', access: 'all', description: 'Run a saved script by name, or given steps, each step pre-action briefed and gated by arm, abort and the action budget',
      params: [param('name', 'string', false, 'saved script name'), param('steps', 'array', false, 'steps to run instead of a saved script')],
      invoke: async (p) => {
        const steps = resolve(p);
        return typeof steps === 'string' ? { ok: false, message: `script.run refused — ${steps}` } : runSteps(deps, `Script ${str(p.name, 'inline')}`, steps);
      },
    },
    {
      id: 'flow.simulate', access: 'all', description: 'Dry-run a flow (saved script or steps) with no real input dispatched; the results are learned as habits',
      params: [param('name', 'string', false, 'saved script name'), param('steps', 'array', false, 'steps to simulate'), param('app', 'string', false, 'app the flow belongs to (default: the attached app)')],
      invoke: async (p) => {
        const steps = resolve(p);
        if (typeof steps === 'string') return { ok: false, message: `flow.simulate refused — ${steps}` };
        const report = await simulateFlow(str(p.app) || deps.app(), steps, (s) => deps.dryRun('Simulation', s));
        deps.learn(simulationOutcomes(report));
        return { ok: report.passed, message: simulationText(report), data: report };
      },
    },
  ];
}

/** Notes on one sampled frame: the AI's description when online, else an honest pixel-change note. */
async function describeMoment(deps: CapabilityDeps, frame: Frame, title: string): Promise<string> {
  const ask = deps.ask('screenWatcher');
  if (!ask) return 'Notable change on screen (AI offline — pixel change only)';
  const { content } = await ask({ system: 'You take notes while watching a video. Describe the notable moment on screen in one sentence.', prompt: `Video: ${title}`, frame });
  return content.trim() || 'Notable change on screen';
}

/** video.watch: plays via a media step, samples frames, notes notable moments with screenshots, pauses and saves the notes. */
function videoCap(deps: CapabilityDeps, stores: Stores): Capability {
  const media = (name: string): WorkflowStep => ({ id: uid('media'), name, action: 'media', x: 0.5, y: 0.5, status: 'pending' });
  return {
    id: 'video.watch', access: 'all', description: 'Play/pause a video via computer control and take timestamped notes with screenshots of notable moments; notes go to the knowledge store',
    params: [param('title', 'string', true, 'what is being watched'), param('durationMs', 'number', false, 'how long to watch (default 10000)'), param('samples', 'number', false, 'frames sampled (default 5)')],
    invoke: async (p) => {
      const title = str(p.title);
      const play = await runSteps(deps, `Video "${title}"`, [media('Play video')]);
      if (!play.ok) return play;
      let session: VideoSession = startSession(title);
      let prev = deps.live();
      const samples = Math.max(1, Math.round(num(p.samples, 5)));
      for (let i = 0; i < samples; i++) {
        await deps.sleep(num(p.durationMs, 10000) / samples);
        const cur = deps.live();
        if (cur && notableMoment(prev, cur)) session = addNote(session, await describeMoment(deps, cur, title), Date.now(), cur.url);
        prev = cur ?? prev;
      }
      const pause = await runSteps(deps, `Video "${title}"`, [media('Pause video')]);
      stores.saveKnowledge(toKnowledge(session));
      return { ok: pause.ok, message: `${sessionText(session)}${pause.ok ? '' : ` — pause failed: ${pause.message}`}`, data: session };
    },
  };
}

/** computer.control and stage.toggle (main only: agents never toggle stages). */
function controlCaps(deps: CapabilityDeps): Capability[] {
  return [
    {
      id: 'computer.control', access: 'all', description: 'One input step (click, type, key, scroll, drag, media, open_app…) through the real-input path: armed = bridge dispatch, never simulated success',
      params: [param('action', 'string', true, CONTROL_ACTIONS.join('|')), param('target', 'string', false, 'on-screen target'), param('x', 'number', false, '0..1'), param('y', 'number', false, '0..1'), param('text', 'string', false, 'text or key combo')],
      invoke: async (p) => {
        const step = controlStep(p);
        return typeof step === 'string' ? { ok: false, message: `computer.control refused — ${step}` } : runSteps(deps, 'Computer control', [step]);
      },
    },
    {
      id: 'stage.toggle', access: 'main', description: 'Check or uncheck a loop-control stage (guardrails are not stages and cannot be toggled)',
      params: [param('stage', 'string', true, STAGES.map((s) => s.id).join('|')), param('on', 'boolean', true, 'checked or not')],
      invoke: async (p) => {
        const stage = STAGES.find((s) => s.id === p.stage);
        if (!stage) return { ok: false, message: `stage.toggle refused — unknown stage "${str(p.stage)}"` };
        deps.toggleStage(stage.id, p.on === true);
        return { ok: true, message: `${stage.name} ${p.on ? 'enabled' : 'disabled'}` };
      },
    },
  ];
}

/** Every registered capability. */
export function capabilities(deps: CapabilityDeps, stores: Stores): Capability[] {
  return [presentationCap(deps, stores), ...scriptCaps(deps, stores), videoCap(deps, stores), ...controlCaps(deps)];
}

/** Persisted state of one artifact store, with its ref for reads inside a running capability. */
export function useStore<T>(load: () => T[], save: (list: T[]) => void) {
  const [list, setList] = useState<T[]>(load);
  const ref = useRef(list);
  const commit = (next: T[]) => {
    ref.current = next;
    setList(next);
    save(next);
  };
  return { list, ref, commit };
}

/**
 * The capability registry of the engine: the main AI (/do), the user (panel) and agents invoke
 * capabilities through one permission-checked path; artifacts persist in the artifact stores.
 */
export function useCapabilities(deps: CapabilityDeps, extra: Capability[] = []) {
  const presentations = useStore(() => loadArtifacts('presentations'), (l) => saveArtifacts('presentations', l));
  const scripts = useStore(() => loadArtifacts('scripts'), (l) => saveArtifacts('scripts', l));
  const knowledge = useStore(() => loadArtifacts('knowledge'), (l) => saveArtifacts('knowledge', l));
  const stores: Stores = {
    scripts: () => scripts.ref.current,
    savePresentation: (p) => presentations.commit(upsertArtifact(presentations.ref.current, p)),
    saveScripts: scripts.commit,
    saveKnowledge: (e) => knowledge.commit(upsertArtifact(knowledge.ref.current, e)),
  };
  const registry: Registry = createRegistry([...capabilities(deps, stores), ...extra]);

  /** Invokes `id` for `caller` through the permission check; the result is logged either way. */
  const invoke = async (caller: Caller, id: string, params: Params): Promise<CapabilityResult> => {
    const r = await invokeCapability(registry, caller, id, params, deps.stageOn);
    deps.log(ACTOR, `${callerName(caller)} → ${id}: ${r.message}`, r.ok ? 'ok' : 'error');
    return r;
  };

  /** /do: "<id> {json}" invokes directly; free text asks the main AI to choose the capability and its parameters. */
  const doCommand = async (text: string): Promise<void> => {
    const req = parseDoRequest(text, registry);
    if (req.kind === 'error') return deps.log('/do', req.message, 'warn');
    if (req.kind === 'direct') return void await invoke({ kind: 'main' }, req.id, req.params);
    const ask = deps.ask('planner');
    if (!ask) return deps.log('/do', `AI offline — cannot resolve "${req.request}"; use /do <capability id> {json}`, 'error');
    try {
      const choice = await askCapability(ask, registry, req.request);
      await invoke({ kind: 'main' }, choice.id, choice.params);
    } catch (error) {
      deps.log('/do', `AI could not choose a capability — ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  return { registry, invoke, doCommand, presentations: presentations.list, scripts: scripts.list, knowledge: knowledge.list };
}
