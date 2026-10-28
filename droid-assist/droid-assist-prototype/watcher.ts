import type { Frame, WorkflowStep } from './types.js';
import { SAMPLE_VIEW, parseJsonReply } from './ai.js';
import type { AskFn, ViewSize } from './ai.js';
import { gridPrompt, replyPoint } from './grid.js';
import { uid } from './planner.js';
import type { Thought } from './assist-ai.js';
import { AI_MODES, type ModeDirective } from './execution-mode.js';

/** Most notes, proposals and test results the watcher keeps. */
export const NOTE_LIMIT = 100;
export const PROPOSAL_LIMIT = 50;
export const TEST_LIMIT = 50;

/**
 * What a note records: a notable UI element, a state change, something unusual, an opportunity —
 * or, from the agents during operations, a wait/wake, a decision, or an error.
 */
export type NoteKind = 'element' | 'change' | 'unusual' | 'opportunity' | 'wake' | 'decision' | 'error';
export const NOTE_KINDS: readonly NoteKind[] = ['element', 'change', 'unusual', 'opportunity', 'wake', 'decision', 'error'];

/** One short, timestamped observation of the screen or of an operation. */
export interface WatchNote {
  id: string;
  time: number;
  kind: NoteKind;
  text: string;
  /** The agent that took it (Screen watcher, Wake, Backup watcher, …). */
  source?: string;
  /** The operation (goal) it was taken during. */
  op?: string;
}

/** What notes are recalled by: any of kind, operation and agent; an absent field matches all. */
export interface NoteQuery {
  kind?: NoteKind;
  op?: string;
  source?: string;
}

/** The notes matching every given field of `q`, newest first as stored. */
export const recallNotes = (notes: WatchNote[], q: NoteQuery): WatchNote[] =>
  notes.filter((n) => (q.kind === undefined || n.kind === q.kind) && (q.op === undefined || n.op === q.op) && (q.source === undefined || n.source === q.source));

/**
 * What a proposal changes: add a popup to the close list (a learned "add" pattern), save a
 * stable element as familiar, save a learned pattern, or reorder the current workflow steps.
 */
export type ProposalKind = 'close_popup' | 'familiar' | 'pattern' | 'reorder' | 'workflow';
/** `workflow` is proposed by the app (a thinking-only AI reply), never by the watcher's model. */
export const PROPOSAL_KINDS: readonly ProposalKind[] = ['close_popup', 'familiar', 'pattern', 'reorder', 'workflow'];

export type ProposalStatus = 'pending' | 'accepted' | 'dismissed';
export const PROPOSAL_STATUSES: readonly ProposalStatus[] = ['pending', 'accepted', 'dismissed'];

/** An actionable change the watcher suggests from its observations. */
export interface WatchProposal {
  id: string;
  time: number;
  kind: ProposalKind;
  text: string;
  /** The on-screen thing it concerns (popup close control, element name). */
  target?: string;
  /** Normalized point of the target, for testable proposals. */
  x?: number;
  y?: number;
  /** For reorder: move step `from` to position `to` (1-based). */
  from?: number;
  to?: number;
  status: ProposalStatus;
  /** Whether a background test already ran for it. */
  tested?: boolean;
  /** Prior operations/elements/errors cross-referenced from the operation database when it was proposed. */
  related?: string[];
}

/** The result of one background test of a proposal. */
export interface WatchTest {
  id: string;
  time: number;
  proposalId: string;
  /** What was tried. */
  tried: string;
  /** What happened. */
  happened: string;
  verdict: 'passed' | 'failed';
  dryRun: boolean;
}

/** Everything the watcher persists. */
export interface WatcherState {
  notes: WatchNote[];
  proposals: WatchProposal[];
  tests: WatchTest[];
}

export const EMPTY_WATCHER: WatcherState = { notes: [], proposals: [], tests: [] };

/** A note or proposal as the model returns it, before it gets an id and time. */
export type NoteDraft = Omit<WatchNote, 'id' | 'time'>;
export type ProposalDraft = Omit<WatchProposal, 'id' | 'time' | 'status' | 'tested'>;

/** One observation: the notes and proposals the model made of a frame. */
export interface Observation extends Thought {
  notes: NoteDraft[];
  proposals: ProposalDraft[];
  /** The execution mode the watcher says fits what the user is doing, when it asked for one. */
  mode?: ModeDirective;
}

/** System prompt of the screen watcher for a `view`-sized screenshot. */
export const watchSystem = (view: ViewSize) => `You are Droid Assist's screen watcher. You observe the user's screen in the background and take short structured notes.
${gridPrompt(view)}
Reply ONLY with JSON {"notes":[{"kind":"element"|"change"|"unusual"|"opportunity","text":string}],"proposals":[{"kind":"close_popup"|"familiar"|"pattern"|"reorder","text":string,"target":string,"cell":string,"cx":number,"cy":number,"from":number,"to":number}],"mode"?:{"mode":${AI_MODES.map((m) => `"${m}"`).join('|')},"reason":string}}.
Notes: at most 4, each under 15 words: notable UI elements, what changed since the previous notes, anything unusual, opportunities to help. Do not repeat a previous note.
Proposals (optional, at most 2): close_popup = a popup keeps returning, give its close control as target + cell; familiar = an element sits at a stable position, give its name as target + cell; pattern = a lesson to remember ("avoid ..." or "add ..." in text); reorder = the workflow keeps failing at a step, move step "from" to position "to" (1-based).
Mode (optional): only when what the user is doing calls for a different execution mode — watching = a movie or video plays (low cadence, notes); reacting = the user is working through a workflow to react to; tracking = elements should be tracked into the project while working; parallel = many independent quick operations; thoughtful = deliberate work. Give the reason in a few words.`;

/** The watcher's system prompt for a sample-space (480x270) screenshot. */
export const WATCH_SYSTEM = watchSystem(SAMPLE_VIEW);

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined);

function toNote(raw: unknown): NoteDraft[] {
  const n = (raw ?? {}) as Record<string, unknown>;
  const text = str(n.text);
  return text && NOTE_KINDS.includes(n.kind as NoteKind) ? [{ kind: n.kind as NoteKind, text }] : [];
}

/** A point-bearing proposal needs its target and a valid point; otherwise it is dropped. */
function pointOf(p: Record<string, unknown>, view: ViewSize): { x: number; y: number } | null {
  try {
    return replyPoint(p, undefined, view);
  } catch {
    return null;
  }
}

function toProposal(raw: unknown, view: ViewSize): ProposalDraft[] {
  const p = (raw ?? {}) as Record<string, unknown>;
  const text = str(p.text);
  const kind = p.kind as ProposalKind;
  if (!text || !PROPOSAL_KINDS.includes(kind)) return [];
  const target = str(p.target) || undefined;
  if (kind === 'pattern') return [{ kind, text, target }];
  if (kind === 'reorder') {
    const from = int(p.from);
    const to = int(p.to);
    return from && to && from !== to ? [{ kind, text, from, to }] : [];
  }
  const point = target ? pointOf(p, view) : null;
  return point ? [{ kind, text, target, ...point }] : [];
}

/**
 * Asks the model (through the shared gateway) to observe `frame` and return notes and
 * proposals. Malformed entries are dropped; a non-JSON reply throws AiError. `related` are prior
 * operations/elements/errors from the operation database, so new ideas build on what was already tried.
 */
export async function observeScreen(ask: AskFn, frame: Frame, recent: WatchNote[], steps: WorkflowStep[], goal: string, related: string[] = []): Promise<Observation> {
  const previous = recent.slice(0, 8).map((n) => `- [${n.kind}] ${n.text}`).join('\n') || '(none)';
  const flow = steps.map((s, i) => `${i + 1}. ${s.name} [${s.action}] → ${s.status}`).join('\n') || '(none)';
  const prior = related.length ? `\nPrior operations (from the operation database):\n${related.join('\n')}` : '';
  const { content, thinking, view = SAMPLE_VIEW } = await ask({
    system: watchSystem,
    prompt: `Goal: ${goal || '(none)'}\nPrevious notes:\n${previous}\nCurrent workflow steps:\n${flow}${prior}`,
    frame,
    json: true,
  });
  const r = parseJsonReply(content);
  const notes = Array.isArray(r.notes) ? r.notes.flatMap(toNote) : [];
  const proposals = Array.isArray(r.proposals) ? r.proposals.flatMap((p) => toProposal(p, view)) : [];
  const mode = toDirective(r.mode);
  return { notes, proposals, thinking, ...(mode ? { mode } : {}) };
}

/** The reply's mode directive, kept as given (the caller rules on it); null when absent or without a mode name. */
function toDirective(raw: unknown): ModeDirective | null {
  const m = (raw ?? {}) as Record<string, unknown>;
  const mode = str(m.mode);
  return mode ? { mode, reason: str(m.reason) } : null;
}

const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const noteKey = (n: NoteDraft) => `${n.kind}:${norm(n.text)}`;
const proposalKey = (p: ProposalDraft) => `${p.kind}:${norm(p.text)}:${norm(p.target ?? '')}:${p.from ?? ''}:${p.to ?? ''}`;

/**
 * New notes first, then the existing ones; a note whose kind + normalized text matches any
 * kept note (or another new one) is dropped, so a static screen adds nothing. Returns the
 * merged list and the notes actually added.
 */
export function mergeNotes(existing: WatchNote[], drafts: NoteDraft[], time = Date.now()): { notes: WatchNote[]; added: WatchNote[] } {
  const seen = new Set(existing.map(noteKey));
  const added: WatchNote[] = [];
  for (const d of drafts) {
    const key = noteKey(d);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push({ id: uid('note'), time, ...d });
  }
  return { notes: [...added, ...existing].slice(0, NOTE_LIMIT), added };
}

/** New proposals first; one identical to a pending proposal is not added again. */
export function mergeProposals(existing: WatchProposal[], drafts: ProposalDraft[], time = Date.now()): { proposals: WatchProposal[]; added: WatchProposal[] } {
  const seen = new Set(existing.filter((p) => p.status === 'pending').map(proposalKey));
  const added: WatchProposal[] = [];
  for (const d of drafts) {
    const key = proposalKey(d);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push({ id: uid('prop'), time, status: 'pending', ...d });
  }
  return { proposals: [...added, ...existing].slice(0, PROPOSAL_LIMIT), added };
}

/** The click a proposal is tested with: its target point; null when it has no on-screen point. */
export function proposalStep(p: WatchProposal): WorkflowStep | null {
  if (p.x === undefined || p.y === undefined || !p.target) return null;
  return { id: uid('watch'), name: `Watcher test: ${p.target}`, action: 'click', target: p.target, x: p.x, y: p.y, status: 'pending' };
}

/** Moves step `from` to position `to` (1-based); null when either is out of range. */
export function reorderSteps(steps: WorkflowStep[], from: number, to: number): WorkflowStep[] | null {
  if (from < 1 || to < 1 || from > steps.length || to > steps.length) return null;
  const next = [...steps];
  const [moved] = next.splice(from - 1, 1);
  next.splice(to - 1, 0, moved);
  return next;
}

/** Sets the status / tested flag of one proposal. */
export const patchProposal = (list: WatchProposal[], id: string, patch: Partial<WatchProposal>) => list.map((p) => (p.id === id ? { ...p, ...patch } : p));

/** Adds a test result first, capped at TEST_LIMIT. */
export const addTest = (list: WatchTest[], test: Omit<WatchTest, 'id' | 'time'>, time = Date.now()): WatchTest[] => [{ id: uid('wtest'), time, ...test }, ...list].slice(0, TEST_LIMIT);
