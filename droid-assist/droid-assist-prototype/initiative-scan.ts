import type { Frame, WorkflowStep } from './types.js';
import { SAMPLE_VIEW, parseJsonReply } from './ai.js';
import type { AskFn, ViewSize } from './ai.js';
import { gridPrompt, replyPoint } from './grid.js';
import { uid } from './planner.js';
import type { Thought } from './assist-ai.js';
import type { InitiativeProposal } from './initiative.js';

/** What a scan looks for: an unhandled popup, an element that changed, a state left incomplete. */
export type FindingKind = 'popup' | 'changed' | 'incomplete';
export const FINDING_KINDS: readonly FindingKind[] = ['popup', 'changed', 'incomplete'];

/** Actions a scan may propose; anything else is noted without a step. */
const SCAN_ACTIONS = new Set<WorkflowStep['action']>(['click', 'double_click', 'type', 'key']);

/** One thing the scan found, with the step that would handle it when it gave one. */
export interface ScanFinding {
  kind: FindingKind;
  text: string;
  step?: WorkflowStep;
}

/** A scan's findings and, when the AI wants to look again sooner, the seconds until it does. */
export interface ScanResult extends Thought {
  findings: ScanFinding[];
  nextScanSec?: number;
}

/** System prompt of the initiative scan for a `view`-sized screenshot. */
export const scanSystem = (view: ViewSize) => `You are Droid Assist's initiative scanner. Look at the user's screen for things that need doing.
${gridPrompt(view)}
Reply ONLY with JSON {"findings":[{"kind":"popup"|"changed"|"incomplete","text":string,"action":"click"|"double_click"|"type"|"key","target":string,"cell":string,"cx":number,"cy":number,"input":string}],"next_scan_sec":number}.
popup = an unhandled popup or dialog (give its close/dismiss control as target + cell); changed = an element that changed and may need attention; incomplete = a form, flow or state left unfinished (give the control that continues it).
At most 3 findings, each text under 15 words. Give action + target + cell only when one input handles it; "input" is the text to type or key to press. Do not repeat a recent finding.
next_scan_sec (optional): seconds until you want to look again, when something is about to change.`;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** The step that handles a finding: its action on its target at the replied point; null without a usable point. */
function findingStep(f: Record<string, unknown>, view: ViewSize): WorkflowStep | undefined {
  const action = f.action as WorkflowStep['action'];
  const target = str(f.target);
  if (!SCAN_ACTIONS.has(action) || !target) return undefined;
  let point: { x: number; y: number };
  try {
    point = replyPoint(f, undefined, view);
  } catch {
    return undefined;
  }
  const input = str(f.input);
  if ((action === 'type' || action === 'key') && !input) return undefined;
  return { id: uid('scan'), name: `Scan: ${action} "${target}"`, action, target, ...point, ...(input ? { text: input } : {}), status: 'pending' };
}

function toFinding(raw: unknown, view: ViewSize): ScanFinding[] {
  const f = (raw ?? {}) as Record<string, unknown>;
  const text = str(f.text);
  if (!text || !FINDING_KINDS.includes(f.kind as FindingKind)) return [];
  const step = findingStep(f, view);
  return [{ kind: f.kind as FindingKind, text, ...(step ? { step } : {}) }];
}

/**
 * Asks the model to scan `frame` for popups, changed elements and incomplete states. Malformed
 * findings are dropped; a non-JSON reply throws AiError.
 */
export async function scanScreen(ask: AskFn, frame: Frame, steps: WorkflowStep[], goal: string, recent: string[]): Promise<ScanResult> {
  const flow = steps.map((s, i) => `${i + 1}. ${s.name} [${s.action}] → ${s.status}`).join('\n') || '(none)';
  const { content, thinking, view = SAMPLE_VIEW } = await ask({
    system: scanSystem,
    prompt: `Goal: ${goal || '(none)'}\nRecent findings:\n${recent.slice(0, 8).map((t) => `- ${t}`).join('\n') || '(none)'}\nCurrent workflow steps:\n${flow}`,
    frame,
    json: true,
  });
  const r = parseJsonReply(content);
  const findings = Array.isArray(r.findings) ? r.findings.flatMap((f) => toFinding(f, view)) : [];
  const next = r.next_scan_sec;
  return { findings, thinking, ...(typeof next === 'number' && Number.isFinite(next) && next > 0 ? { nextScanSec: next } : {}) };
}

/** A finding as an initiative proposal: its text with its kind, and its step when it has one. */
export const findingProposal = (f: ScanFinding): Omit<InitiativeProposal, 'id' | 'time' | 'status'> => ({ category: 'scan', text: `[${f.kind}] ${f.text}`, ...(f.step ? { step: f.step } : {}) });

/** Timeline text of a scan. */
export const scanSummary = (r: ScanResult) => `${r.findings.length} finding(s)${r.findings.length ? `: ${r.findings.map((f) => `[${f.kind}] ${f.text}`).join('; ')}` : ''}${r.nextScanSec ? ` — next scan in ${r.nextScanSec}s` : ''}`;
