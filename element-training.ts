import type { Frame, WorkflowStep } from './types.js';
import { iou } from './identify.js';
import { scanElements, type Detection } from './auto-scan.js';
import { boxCenter, mapCell, type MappedElement } from './element-map-studio.js';
import { navigateStep } from './element-perform.js';
import { keyStep } from './recorder.js';
import { uid } from './planner.js';

/**
 * Element training: an agent's exclusive session with one mapped element. It performs the
 * element (its perform function, else a click), screenshots the result, explores what it opened
 * (links, menus, popups: each clicked, screenshotted, then backed out of with Escape), maps those
 * as related elements and asks the AI to research the element. Foreground holds the screen (the
 * user watches, Auto Act pauses); background runs on its own task without pausing the UI.
 */

/** Foreground: exclusive and visible; background: its own task, the UI keeps going. */
export type TrainMode = 'foreground' | 'background';
/** Both training modes, for the Settings select and validation. */
export const TRAIN_MODES: readonly TrainMode[] = ['foreground', 'background'];

/** Most opened elements one session explores. */
export const TRAIN_EXPLORE = 3;
/** Overlap below which a detection after the action counts as newly opened. */
const OPENED_IOU = 0.3;

/** One action of a training session and what it showed. */
export interface TrainingEntry {
  label: string;
  ok: boolean;
  message: string;
  shot?: Frame;
}

/** A session's state: still running, every action passed, an action failed, or stopped by the user. */
export type TrainingStatus = 'running' | 'pass' | 'fail' | 'aborted';

/** The report of one training session. */
export interface TrainingReport {
  elementId: string;
  name: string;
  mode: TrainMode;
  startedAt: number;
  status: TrainingStatus;
  entries: TrainingEntry[];
  /** Elements the action opened, explored and mapped as related. */
  related: Detection[];
  /** The AI's research notes on the element; null when the AI was unavailable or off. */
  research: string | null;
}

/** What a training session needs from the engine: guarded input, screenshots, the AI and the stop signal. */
export interface TrainingDeps {
  /** Runs one step through the guarded executor (abort, arm/dry run, budget). */
  perform: (step: WorkflowStep) => Promise<{ ok: boolean; message: string; shot?: Frame }>;
  /** A fresh screenshot of the live screen. */
  capture: () => Promise<Frame | null>;
  /** The AI's notes on the element and what it opened; may throw (AI unavailable). */
  research: (el: MappedElement, frame: Frame | null, related: Detection[]) => Promise<string | null>;
  stopped: () => boolean;
  /** Called after each entry with the report so far. */
  progress: (report: TrainingReport) => void;
}

/** Elements on `after` that were not on `before` (what an action opened), largest first, at most TRAIN_EXPLORE. */
export function openedElements(before: ImageData, after: ImageData): Detection[] {
  const old = scanElements(before);
  return scanElements(after).filter((d) => !old.some((o) => iou(o.box, d.box) >= OPENED_IOU)).slice(0, TRAIN_EXPLORE);
}

/** The step that trains on `el`: its perform function, else a plain click on its current centre. */
export function trainingStep(el: MappedElement, map: MappedElement[]): WorkflowStep {
  const nav = el.perform ? navigateStep(el, map) : null;
  if (nav && !('error' in nav)) return nav;
  const c = boxCenter(el.box);
  return { id: uid('train'), name: `Train: click "${el.name}"`, action: 'click', x: c.x, y: c.y, target: el.name, status: 'pending' };
}

/** A click on one opened element. */
const exploreStep = (d: Detection, i: number): WorkflowStep => {
  const c = boxCenter(d.box);
  return { id: uid('train'), name: `Train: open related ${d.kind} ${i + 1} at ${mapCell(c)}`, action: 'click', x: c.x, y: c.y, target: `${d.kind} at ${mapCell(c)}`, status: 'pending' };
};

/** Runs one step and adds its entry; false when it failed or the session was stopped. */
async function attempt(report: TrainingReport, deps: TrainingDeps, step: WorkflowStep): Promise<boolean> {
  if (deps.stopped()) return false;
  const out = await deps.perform(step);
  const shot = out.shot ?? (await deps.capture()) ?? undefined;
  report.entries.push({ label: step.name, ok: out.ok, message: out.message, ...(shot ? { shot } : {}) });
  deps.progress({ ...report, entries: [...report.entries] });
  return out.ok;
}

/** Explores each opened element: click it, screenshot, Escape back out. */
async function explore(report: TrainingReport, deps: TrainingDeps, opened: Detection[]): Promise<boolean> {
  let ok = true;
  for (const [i, d] of opened.entries()) {
    if (deps.stopped()) return false;
    ok = (await attempt(report, deps, exploreStep(d, i))) && ok;
    ok = (await attempt(report, deps, { ...keyStep(uid('train'), 'Escape'), name: 'Train: back out (Escape)' })) && ok;
  }
  return ok;
}

/** The AI's research on the element; a failure is recorded as an entry, never invented. */
async function researchOf(report: TrainingReport, deps: TrainingDeps, el: MappedElement, frame: Frame | null): Promise<string | null> {
  try {
    return await deps.research(el, frame, report.related);
  } catch (error) {
    report.entries.push({ label: 'Train: research', ok: false, message: `AI unavailable — ${error instanceof Error ? error.message : String(error)}` });
    return null;
  }
}

/** One full training session on `el`; the report says pass only when every action succeeded. */
export async function trainElement(el: MappedElement, map: MappedElement[], mode: TrainMode, deps: TrainingDeps, now = Date.now()): Promise<TrainingReport> {
  const report: TrainingReport = { elementId: el.id, name: el.name, mode, startedAt: now, status: 'running', entries: [], related: [], research: null };
  deps.progress({ ...report });
  const before = await deps.capture();
  let ok = await attempt(report, deps, trainingStep(el, map));
  const after = report.entries[report.entries.length - 1]?.shot ?? null;
  if (ok && before && after) {
    report.related = openedElements(before.data, after.data);
    ok = await explore(report, deps, report.related);
  }
  if (!deps.stopped()) report.research = await researchOf(report, deps, el, after ?? before);
  report.status = deps.stopped() ? 'aborted' : ok ? 'pass' : 'fail';
  deps.progress({ ...report, entries: [...report.entries] });
  return report;
}

/** The research system prompt. */
export const RESEARCH_SYSTEM = 'You are Droid Assist\'s element trainer. The image is the screen after the element was used. In at most 4 short sentences say what the element does, what it opened, and how a workflow should use it. Plain text, no JSON.';
