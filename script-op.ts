import type { WorkflowStep } from './types.js';
import { FIX_ACTIONS, MAX_FIX_STEPS } from './fix-script.js';
import { uid } from './planner.js';

/** A saved standalone script: a named, reusable bounded operation. */
export interface SavedScript {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  saved: number;
}

/** A scalar reply field as text; objects and missing values give `fallback`. */
const text = (v: unknown, fallback = '') => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : fallback);

const isUnit = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1;

/** One raw entry as a script step, or why it is refused (not an object, disallowed action, click without a 0..1 point). */
function scriptStep(raw: unknown, index: number): WorkflowStep | string {
  if (!raw || typeof raw !== 'object') return `step ${index + 1} is not an object`;
  const r = raw as Record<string, unknown>;
  const action = text(r.action);
  if (!FIX_ACTIONS.has(action as WorkflowStep['action'])) return `step ${index + 1}: action "${action}" is not allowed (allowed: ${[...FIX_ACTIONS].join(', ')})`;
  const name = text(r.name, text(r.target, action));
  const typed = r.text === undefined ? {} : { text: text(r.text) };
  const base = { id: uid('script'), name, action: action as WorkflowStep['action'], x: 0.5, y: 0.5, status: 'pending' as const, ...typed };
  if (action !== 'click') return base;
  if (!isUnit(r.x) || !isUnit(r.y)) return `step ${index + 1}: a click needs x and y between 0 and 1`;
  return { ...base, x: r.x, y: r.y, target: text(r.target, name) };
}

/**
 * Validates a standalone script inside the fix-script bounds: at most MAX_FIX_STEPS steps, each
 * one of FIX_ACTIONS. An oversize script or any disallowed step refuses the whole script (never truncated).
 */
export function validateScript(raw: unknown): { ok: true; steps: WorkflowStep[] } | { ok: false; reason: string } {
  if (!Array.isArray(raw) || !raw.length) return { ok: false, reason: 'a script needs a non-empty steps array' };
  if (raw.length > MAX_FIX_STEPS) return { ok: false, reason: `script has ${raw.length} steps — at most ${MAX_FIX_STEPS} allowed` };
  const steps: WorkflowStep[] = [];
  for (const [i, entry] of raw.entries()) {
    const s = scriptStep(entry, i);
    if (typeof s === 'string') return { ok: false, reason: s };
    steps.push(s);
  }
  return { ok: true, steps };
}

const key = (name: string) => name.trim().toLowerCase();

/** Saves a script by name; a script with the same name (case-insensitive) is replaced. Newest first. */
export function saveScript(list: SavedScript[], name: string, description: string, steps: WorkflowStep[], now = Date.now()): SavedScript[] {
  const script: SavedScript = { id: uid('op'), name: name.trim(), description: description.trim(), steps, saved: now };
  return [script, ...list.filter((s) => key(s.name) !== key(name))];
}

/** The saved script named `name` (case-insensitive), or null. */
export const findScript = (list: SavedScript[], name: string) => list.find((s) => key(s.name) === key(name)) ?? null;

/** Fresh pending copies of a saved script's steps for one run. */
export const runnableSteps = (s: SavedScript): WorkflowStep[] => s.steps.map((st) => ({ ...st, id: uid('script'), status: 'pending' }));
