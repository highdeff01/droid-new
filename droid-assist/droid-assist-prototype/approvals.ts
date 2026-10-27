import type { ActionRecord, LearnedPattern, WorkflowStep } from './types.js';
import type { WatchProposal } from './watcher.js';
import { similarity, uid } from './planner.js';

/** What an operation does, for elevation and the user's operation conditions. */
export type OperationClass = 'input' | 'admin_cmd' | 'system_file' | 'important_doc' | 'email';
export const OPERATION_CLASSES: readonly OperationClass[] = ['input', 'admin_cmd', 'system_file', 'important_doc', 'email'];

/** How each class is named in the panel and the log. */
export const CLASS_LABEL: Record<OperationClass, string> = {
  input: 'Screen input',
  admin_cmd: 'High-privilege command',
  system_file: 'System file save/edit',
  important_doc: 'Important document edit',
  email: 'Sending email',
};

/** Classification rules, most privileged first; text matching none is plain screen input. */
const CLASS_RULES: ReadonlyArray<[OperationClass, RegExp]> = [
  ['admin_cmd', /\b(cmd(\.exe)?|command prompt|powershell|pwsh|sudo|runas|regedit|run as administrator|administrator|diskpart|bcdedit|net user|chmod|chown|rm -rf|win\+r)\b/i],
  ['system_file', /(system32|\\windows\\|\/etc\/|\bhosts file\b|\bregistry\b|\.sys\b|\.dll\b|\.ini\b|\/usr\/|program files|\bsystem file)/i],
  ['important_doc', /(\.docx?\b|\.xlsx?\b|\.pptx?\b|\.pdf\b|\bcontract\b|\binvoice\b|\btax\b|\blegal\b|\bimportant doc)/i],
  ['email', /(\be-?mail\b|\boutlook\b|\bgmail\b|\bsend (the |a |this )?(message|mail|email)\b|\bmail to\b|\breply all\b)/i],
];

/** The class of free text (a proposal, a summary). */
export function classifyText(text: string): OperationClass {
  return CLASS_RULES.find(([, re]) => re.test(text))?.[0] ?? 'input';
}

/** The class of a workflow step, from its name, target, text and drop target. */
export const classifyStep = (step: WorkflowStep): OperationClass =>
  classifyText([step.name, step.target, step.text, step.endTarget].filter(Boolean).join(' '));

/** Admin-class operations never auto-run: they wait in the queue until the user approves (elevates) them. */
export const needsApproval = (cls: OperationClass) => cls !== 'input';

/** Hours of the day the AI may operate: [start, end) in local hours; start === end is all day, start > end wraps past midnight. */
export interface OperationHours {
  start: number;
  end: number;
}

/** The user's conditions for AI operation, enforced before every real dispatch. */
export interface OperationPolicy {
  /** null = any time. */
  hours: OperationHours | null;
  allowedClasses: OperationClass[];
  /** Project scope text; empty falls back to the current goal. */
  scope: string;
}

export const DEFAULT_OPERATION_POLICY: OperationPolicy = { hours: null, allowedClasses: [...OPERATION_CLASSES], scope: '' };

/** Whether `hour` (0..23) falls inside the allowed hours. */
export function withinHours(hours: OperationHours | null, hour: number): boolean {
  if (!hours || hours.start === hours.end) return true;
  return hours.start < hours.end ? hour >= hours.start && hour < hours.end : hour >= hours.start || hour < hours.end;
}

/** Why the conditions refuse an operation of `cls` at `now`; null when they allow it. */
export function conditionsBlock(policy: OperationPolicy, cls: OperationClass, now: Date): string | null {
  if (!policy.allowedClasses.includes(cls)) return `${CLASS_LABEL[cls]} is not an allowed operation class`;
  if (!withinHours(policy.hours, now.getHours())) return `outside the allowed hours ${hoursText(policy.hours)}`;
  return null;
}

const pad = (h: number) => `${String(h).padStart(2, '0')}:00`;
/** The allowed hours as text. */
export const hoursText = (hours: OperationHours | null) => (!hours || hours.start === hours.end ? 'any time' : `${pad(hours.start)}–${pad(hours.end)}`);

const isHour = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A stored policy with each invalid field replaced by the default's. */
export function sanitizePolicy(v: unknown, fallback: OperationPolicy = DEFAULT_OPERATION_POLICY): OperationPolicy {
  if (!isObject(v)) return fallback;
  const h = v.hours;
  const hours = h === null ? null : isObject(h) && isHour(h.start) && isHour(h.end) ? { start: h.start, end: h.end } : fallback.hours;
  const allowedClasses = Array.isArray(v.allowedClasses) && v.allowedClasses.every((c) => OPERATION_CLASSES.includes(c as OperationClass))
    ? OPERATION_CLASSES.filter((c) => (v.allowedClasses as unknown[]).includes(c)) : fallback.allowedClasses;
  return { hours, allowedClasses, scope: typeof v.scope === 'string' ? v.scope : fallback.scope };
}

/** Where a strong point the AI makes goes. */
export type Route = 'auto' | 'approval' | 'blocked';
export interface Routing {
  route: Route;
  cls: OperationClass;
  reason: string;
}

/** What the filter weighs a point against. */
export interface FilterContext {
  policy: OperationPolicy;
  goal: string;
  patterns: LearnedPattern[];
  /** The user's Auto act setting: off routes every point to approval. */
  autoAct: boolean;
  now: Date;
}

/** Share of words a point must share with the project scope to count as within it. */
export const SCOPE_MIN = 0.34;
/** Share of a point's words an avoid pattern must cover to count as against the user's input. */
const AVOID_MIN = 0.6;

/** The learned avoid pattern (user input) a point goes against, if any. */
const againstUser = (text: string, patterns: LearnedPattern[]) => patterns.find((p) => p.kind === 'avoid' && similarity(text, p.pattern) >= AVOID_MIN);

/**
 * Filters one point: blocked outside the user's conditions; queued for approval when it is an
 * admin-class operation, goes against a learned avoid pattern, is outside the project scope
 * (empty scope included) or Auto act is off; auto-acted otherwise.
 */
export function filterPoint(text: string, ctx: FilterContext): Routing {
  const cls = classifyText(text);
  const block = conditionsBlock(ctx.policy, cls, ctx.now);
  if (block) return { route: 'blocked', cls, reason: block };
  if (needsApproval(cls)) return { route: 'approval', cls, reason: `${CLASS_LABEL[cls]} never auto-runs` };
  const avoid = againstUser(text, ctx.patterns);
  if (avoid) return { route: 'approval', cls, reason: `goes against "${avoid.pattern}"` };
  const scope = ctx.policy.scope.trim() || ctx.goal.trim();
  if (!scope) return { route: 'approval', cls, reason: 'no project scope or goal set' };
  const inScope = Math.max(similarity(scope, text), similarity(text, scope)) >= SCOPE_MIN;
  if (!inScope) return { route: 'approval', cls, reason: 'outside the project scope' };
  return ctx.autoAct ? { route: 'auto', cls, reason: 'within the project scope' } : { route: 'approval', cls, reason: 'Auto act is off in Settings' };
}

export type ApprovalKind = 'point' | 'operation';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'edited';
const KINDS: readonly ApprovalKind[] = ['point', 'operation'];
const STATUSES: readonly ApprovalStatus[] = ['pending', 'approved', 'rejected', 'edited'];

/** A queued request with the context it was made in. */
export interface ApprovalItem {
  id: string;
  time: number;
  /** The agent or run that asked (Screen watcher, Replay, Auto-Actor, ...). */
  requestedBy: string;
  kind: ApprovalKind;
  cls: OperationClass;
  summary: string;
  /** Why it was queued and what was going on. */
  context: string;
  goal: string;
  /** The operation to run on approval (frames stripped). */
  step?: WorkflowStep;
  /** The step was part of the plan when queued. */
  planned?: boolean;
  /** The watcher proposal a point came from. */
  proposalId?: string;
  status: ApprovalStatus;
  decidedAt?: number;
  /** The user's edited text. */
  edit?: string;
  /** Why the last run-check found it stale; absent when still needed. */
  stale?: string;
  /** The last outcome note (e.g. why an approved run did not execute). */
  note?: string;
}

/** Most queue entries kept. */
export const APPROVAL_LIMIT = 100;
/** A pending item older than this is flagged by the run-check. */
export const STALE_AFTER_MS = 30 * 60_000;

export type ApprovalDraft = Pick<ApprovalItem, 'requestedBy' | 'kind' | 'cls' | 'summary' | 'context' | 'goal'> & Partial<Pick<ApprovalItem, 'step' | 'planned' | 'proposalId'>>;

/** A step without its screenshots, safe to persist. */
const storedStep = ({ refFrame: _r, shot: _s, beforeFrame: _b, afterFrame: _a, ...step }: WorkflowStep): WorkflowStep => ({ ...step, status: 'pending' });

/** Two drafts ask for the same thing. */
const sameRequest = (a: ApprovalDraft, b: ApprovalDraft) => a.requestedBy === b.requestedBy && a.summary === b.summary && a.proposalId === b.proposalId;

/** Queues a request (newest first); a pending duplicate is kept instead of queuing it twice. */
export function enqueue(items: ApprovalItem[], draft: ApprovalDraft, now = Date.now()): { items: ApprovalItem[]; item: ApprovalItem; added: boolean } {
  const existing = items.find((i) => i.status === 'pending' && sameRequest(i, draft));
  if (existing) return { items, item: existing, added: false };
  const item: ApprovalItem = { ...draft, ...(draft.step ? { step: storedStep(draft.step) } : {}), id: uid('apv'), time: now, status: 'pending' };
  return { items: [item, ...items].slice(0, APPROVAL_LIMIT), item, added: true };
}

/** Records the user's decision on a pending item; `edit` is the edited text of an edit. */
export function resolve(items: ApprovalItem[], id: string, status: Exclude<ApprovalStatus, 'pending'>, edit?: string, now = Date.now()): ApprovalItem[] {
  return items.map((i) => (i.id === id && i.status === 'pending' ? { ...i, status, decidedAt: now, stale: undefined, note: undefined, ...(edit !== undefined ? { edit } : {}) } : i));
}

/** Sets or clears an item's outcome note. */
export const noteItem = (items: ApprovalItem[], id: string, note: string): ApprovalItem[] => items.map((i) => (i.id === id ? { ...i, note } : i));

/** The step an edit runs: the edited text replaces the step's text (or its name when it has none). */
export const editedStep = (step: WorkflowStep, text: string): WorkflowStep => (step.text !== undefined ? { ...step, text } : { ...step, name: text });

/** The lesson a decision leaves in the learned-methods memory. */
export function decisionLesson(item: ApprovalItem): Pick<LearnedPattern, 'kind' | 'pattern' | 'context'> {
  const context = item.goal || item.requestedBy;
  if (item.status === 'rejected') return { kind: 'avoid', pattern: `Rejected: ${item.summary}`, context };
  if (item.status === 'edited') return { kind: 'add', pattern: `Edited "${item.summary}" to "${item.edit ?? ''}" before approving`, context };
  return { kind: 'add', pattern: `Approved ${CLASS_LABEL[item.cls].toLowerCase()}: ${item.summary}`, context };
}

/** What the run-check compares each pending item against. */
export interface CheckContext {
  now: number;
  goal: string;
  steps: WorkflowStep[];
  history: ActionRecord[];
  proposals: WatchProposal[];
}

const NEAR = 0.03;
/** A history record is the queued step having run. */
function ranAgain(r: ActionRecord, step: WorkflowStep): boolean {
  if (!r.ok || r.action !== step.action || (r.text ?? '') !== (step.text ?? '')) return false;
  if (!r.srcW || !r.srcH) return true;
  return Math.abs(r.x / r.srcW - step.x) <= NEAR && Math.abs(r.y / r.srcH - step.y) <= NEAR;
}

/** Why a pending item is no longer needed or needs updating; null when it still stands. */
export function staleReason(item: ApprovalItem, ctx: CheckContext): string | null {
  if (item.proposalId) {
    const p = ctx.proposals.find((x) => x.id === item.proposalId);
    if (!p) return 'its proposal is no longer listed';
    if (p.status !== 'pending') return `its proposal was already ${p.status}`;
  }
  const step = item.step;
  if (step && ctx.history.some((r) => r.time > item.time && ranAgain(r, step))) return 'the same operation already ran after it was queued';
  if (item.goal.trim() && ctx.goal.trim() !== item.goal.trim()) return `the goal changed to "${ctx.goal.trim() || '(none)'}"`;
  if (step && item.planned && !ctx.steps.some((s) => s.id === step.id)) return 'its step is no longer in the plan';
  if (ctx.now - item.time > STALE_AFTER_MS) return 'queued over 30 minutes — check it is still wanted';
  return null;
}

/** Re-evaluates every pending item: stale ones are flagged with why (never removed), the rest cleared. */
export function runCheck(items: ApprovalItem[], ctx: CheckContext): { items: ApprovalItem[]; flagged: ApprovalItem[] } {
  const next = items.map((i) => {
    if (i.status !== 'pending') return i;
    const stale = staleReason(i, ctx);
    return stale ? { ...i, stale } : { ...i, stale: undefined };
  });
  return { items: next, flagged: next.filter((i) => i.status === 'pending' && i.stale) };
}

/** One branch of the approvals tree: a requester, then its operation classes, then their pending items. */
export interface ApprovalBranch {
  requestedBy: string;
  classes: Array<{ cls: OperationClass; items: ApprovalItem[] }>;
}

/** The pending items as a tree: requester → class → items (newest first, in queue order). */
export function approvalTree(items: ApprovalItem[]): ApprovalBranch[] {
  const tree: ApprovalBranch[] = [];
  for (const item of items.filter((i) => i.status === 'pending')) {
    let branch = tree.find((b) => b.requestedBy === item.requestedBy);
    if (!branch) tree.push((branch = { requestedBy: item.requestedBy, classes: [] }));
    let leaf = branch.classes.find((c) => c.cls === item.cls);
    if (!leaf) branch.classes.push((leaf = { cls: item.cls, items: [] }));
    leaf.items.push(item);
  }
  return tree;
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optStr = (v: unknown) => v === undefined || isStr(v);
const isStepLike = (v: unknown) => isObject(v) && isStr(v.id) && isStr(v.name) && isStr(v.action) && isNum(v.x) && isNum(v.y);

/** A stored queue entry is well formed. */
export function isApprovalItem(v: unknown): v is ApprovalItem {
  return isObject(v) && isStr(v.id) && isNum(v.time) && isStr(v.requestedBy) && KINDS.includes(v.kind as ApprovalKind)
    && OPERATION_CLASSES.includes(v.cls as OperationClass) && isStr(v.summary) && isStr(v.context) && isStr(v.goal)
    && STATUSES.includes(v.status as ApprovalStatus) && (v.step === undefined || isStepLike(v.step))
    && optStr(v.proposalId) && optStr(v.edit) && optStr(v.stale) && optStr(v.note);
}
