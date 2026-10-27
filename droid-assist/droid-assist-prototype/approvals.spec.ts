import { describe, expect, it } from 'vitest';
import type { ActionRecord, Frame, LearnedPattern, WorkflowStep } from './types.js';
import type { WatchProposal } from './watcher.js';
import {
  APPROVAL_LIMIT,
  CLASS_LABEL,
  DEFAULT_OPERATION_POLICY,
  OPERATION_CLASSES,
  STALE_AFTER_MS,
  approvalTree,
  classifyStep,
  conditionsBlock,
  decisionLesson,
  editedStep,
  enqueue,
  filterPoint,
  isApprovalItem,
  needsApproval,
  resolve,
  runCheck,
  sanitizePolicy,
  withinHours,
} from './approvals.js';
import type { ApprovalDraft, ApprovalItem, CheckContext, FilterContext, OperationPolicy } from './approvals.js';

const step = (overrides: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id: 's1',
  name: '',
  action: 'click',
  x: 0.5,
  y: 0.5,
  status: 'pending',
  ...overrides,
});

describe('classifyStep', () => {
  it('names an administrator command as admin_cmd', () => {
    expect(classifyStep(step({ name: 'Open PowerShell as administrator' }))).toBe('admin_cmd');
  });

  it('a sudo step text is admin_cmd', () => {
    expect(classifyStep(step({ text: 'sudo rm -rf /tmp/x' }))).toBe('admin_cmd');
  });

  it('a system path target is system_file', () => {
    expect(classifyStep(step({ target: 'C:\\Windows\\System32\\drivers\\etc\\hosts' }))).toBe('system_file');
  });

  it('editing the registry is system_file', () => {
    expect(classifyStep(step({ name: 'edit the registry' }))).toBe('system_file');
  });

  it('saving a .docx is important_doc', () => {
    expect(classifyStep(step({ name: 'Save contract.docx' }))).toBe('important_doc');
  });

  it('a .xlsx name is important_doc', () => {
    expect(classifyStep(step({ name: 'budget.xlsx' }))).toBe('important_doc');
  });

  it('sending an email is the email class', () => {
    expect(classifyStep(step({ name: 'Send the email to Bob' }))).toBe('email');
  });

  it('an Outlook target is the email class', () => {
    expect(classifyStep(step({ target: 'Outlook' }))).toBe('email');
  });

  it('a plain click is screen input', () => {
    expect(classifyStep(step({ name: 'click the Play button' }))).toBe('input');
  });

  it('needsApproval is true for every class except input', () => {
    for (const cls of OPERATION_CLASSES) expect(needsApproval(cls)).toBe(cls !== 'input');
  });
});

describe('withinHours / conditionsBlock', () => {
  it('null hours allow any hour', () => {
    expect(withinHours(null, 0)).toBe(true);
    expect(withinHours(null, 23)).toBe(true);
  });

  it('start === end allows any hour', () => {
    expect(withinHours({ start: 5, end: 5 }, 0)).toBe(true);
    expect(withinHours({ start: 5, end: 5 }, 23)).toBe(true);
  });

  it('9-17 allows 9 and 16, refuses 17 and 8', () => {
    const h = { start: 9, end: 17 };
    expect(withinHours(h, 9)).toBe(true);
    expect(withinHours(h, 16)).toBe(true);
    expect(withinHours(h, 17)).toBe(false);
    expect(withinHours(h, 8)).toBe(false);
  });

  it('a wrapped 22-6 allows 23 and 3, refuses 12', () => {
    const h = { start: 22, end: 6 };
    expect(withinHours(h, 23)).toBe(true);
    expect(withinHours(h, 3)).toBe(true);
    expect(withinHours(h, 12)).toBe(false);
  });

  it('returns a reason for a class not allowed', () => {
    const policy: OperationPolicy = { hours: null, allowedClasses: ['input'], scope: '' };
    expect(conditionsBlock(policy, 'admin_cmd', new Date())).toContain(CLASS_LABEL.admin_cmd);
  });

  it('returns a reason outside the allowed hours', () => {
    const policy: OperationPolicy = { hours: { start: 9, end: 17 }, allowedClasses: [...OPERATION_CLASSES], scope: '' };
    expect(conditionsBlock(policy, 'input', new Date(2024, 0, 1, 20))).toContain('outside the allowed hours');
  });

  it('is null when the class is allowed and in hours', () => {
    const policy: OperationPolicy = { hours: { start: 9, end: 17 }, allowedClasses: [...OPERATION_CLASSES], scope: '' };
    expect(conditionsBlock(policy, 'input', new Date(2024, 0, 1, 10))).toBeNull();
  });

  it('sanitizePolicy round-trips a valid policy', () => {
    const policy: OperationPolicy = { hours: { start: 9, end: 17 }, allowedClasses: ['input', 'email'], scope: 'foo' };
    expect(sanitizePolicy(policy)).toEqual(policy);
  });

  it("sanitizePolicy replaces bad hours, classes and scope with the fallback's", () => {
    const bad = { hours: 'nope', allowedClasses: ['bogus'], scope: 123 };
    expect(sanitizePolicy(bad, DEFAULT_OPERATION_POLICY)).toEqual(DEFAULT_OPERATION_POLICY);
  });
});

const filterCtx = (overrides: Partial<FilterContext> = {}): FilterContext => ({
  policy: { hours: null, allowedClasses: [...OPERATION_CLASSES], scope: 'play the music video' },
  goal: '',
  patterns: [],
  autoAct: true,
  now: new Date(2024, 0, 1, 10),
  ...overrides,
});

describe('filterPoint', () => {
  it('auto-acts an in-scope point', () => {
    expect(filterPoint('Play the video', filterCtx()).route).toBe('auto');
  });

  it('routes an out-of-scope point to approval', () => {
    expect(filterPoint('Close the newsletter popup', filterCtx()).route).toBe('approval');
  });

  it('routes to approval when scope and goal are both empty', () => {
    const r = filterPoint('Play the video', filterCtx({ policy: { hours: null, allowedClasses: [...OPERATION_CLASSES], scope: '' }, goal: '' }));
    expect(r.route).toBe('approval');
    expect(r.reason).toBe('no project scope or goal set');
  });

  it('falls back to the goal when scope is empty', () => {
    const r = filterPoint('Play the video', filterCtx({ policy: { hours: null, allowedClasses: [...OPERATION_CLASSES], scope: '' }, goal: 'play the music video' }));
    expect(r.route).toBe('auto');
  });

  it('routes a point against a similar avoid LearnedPattern to approval', () => {
    const patterns: LearnedPattern[] = [{ id: 'p1', kind: 'avoid', pattern: 'play the music video', context: '', time: 0 }];
    expect(filterPoint('Play the video', filterCtx({ patterns })).route).toBe('approval');
  });

  it('never auto-runs an admin-class point, even in scope', () => {
    const r = filterPoint('Run cmd as administrator to play the video', filterCtx());
    expect(r.route).toBe('approval');
  });

  it('is blocked when the class is not an allowed operation class', () => {
    const r = filterPoint('Play the video', filterCtx({ policy: { hours: null, allowedClasses: ['email'], scope: 'play the music video' } }));
    expect(r.route).toBe('blocked');
  });

  it('is blocked outside the allowed hours', () => {
    const r = filterPoint('Play the video', filterCtx({ policy: { hours: { start: 9, end: 17 }, allowedClasses: [...OPERATION_CLASSES], scope: 'play the music video' }, now: new Date(2024, 0, 1, 20) }));
    expect(r.route).toBe('blocked');
  });

  it('routes to approval when Auto act is off', () => {
    expect(filterPoint('Play the video', filterCtx({ autoAct: false })).route).toBe('approval');
  });
});

const draft = (overrides: Partial<ApprovalDraft> = {}): ApprovalDraft => ({
  requestedBy: 'Screen watcher',
  kind: 'operation',
  cls: 'admin_cmd',
  summary: 'Run cmd',
  context: 'ctx',
  goal: 'goal',
  ...overrides,
});

describe('enqueue', () => {
  it('adds a pending item with an id and time, stripping screenshots from its step', () => {
    const s = step({ refFrame: {} as Frame, shot: {} as Frame });
    const { item, added } = enqueue([], draft({ step: s }), 1000);
    expect(added).toBe(true);
    expect(item.id).toBeTruthy();
    expect(item.time).toBe(1000);
    expect(item.status).toBe('pending');
    expect(item.step).not.toHaveProperty('refFrame');
    expect(item.step).not.toHaveProperty('shot');
  });

  it('keeps newest first across multiple enqueues', () => {
    let items: ApprovalItem[] = [];
    ({ items } = enqueue(items, draft({ summary: 'first' }), 1000));
    ({ items } = enqueue(items, draft({ summary: 'second' }), 2000));
    expect(items.map((i) => i.summary)).toEqual(['second', 'first']);
  });

  it('does not queue a duplicate pending request twice', () => {
    const first = enqueue([], draft(), 1000);
    const second = enqueue(first.items, draft(), 2000);
    expect(second.added).toBe(false);
    expect(second.items).toHaveLength(1);
    expect(second.item).toBe(first.item);
  });

  it('caps the queue at APPROVAL_LIMIT', () => {
    let items: ApprovalItem[] = [];
    for (let i = 0; i < APPROVAL_LIMIT + 5; i++) ({ items } = enqueue(items, draft({ summary: `item ${i}` }), i));
    expect(items).toHaveLength(APPROVAL_LIMIT);
  });
});

const pendingItem = (overrides: Partial<ApprovalItem> = {}): ApprovalItem => ({
  id: 'a',
  time: 1000,
  requestedBy: 'Screen watcher',
  kind: 'operation',
  cls: 'admin_cmd',
  summary: 'Run cmd',
  context: 'ctx',
  goal: 'goal',
  status: 'pending',
  ...overrides,
});

describe('resolve', () => {
  it('sets status, decidedAt and edit only on the pending item, clearing stale', () => {
    const pending = pendingItem({ id: 'a', stale: 'old' });
    const other = pendingItem({ id: 'b', status: 'approved' });
    const result = resolve([pending, other], 'a', 'approved', 'new text', 5000);
    expect(result[0]).toMatchObject({ id: 'a', status: 'approved', decidedAt: 5000, edit: 'new text', stale: undefined });
    expect(result[1]).toBe(other);
  });
});

describe('decisionLesson', () => {
  it('a rejected decision is an avoid lesson', () => {
    expect(decisionLesson(pendingItem({ status: 'rejected' })).kind).toBe('avoid');
  });

  it('an approved decision is an add lesson', () => {
    expect(decisionLesson(pendingItem({ status: 'approved' })).kind).toBe('add');
  });

  it('an edited decision is an add lesson', () => {
    expect(decisionLesson(pendingItem({ status: 'edited', edit: 'new text' })).kind).toBe('add');
  });
});

describe('editedStep', () => {
  it("replaces a step's text when it has one", () => {
    expect(editedStep(step({ text: 'old' }), 'new').text).toBe('new');
  });

  it("replaces a step's name when it has no text", () => {
    expect(editedStep(step({ name: 'Click X' }), 'Click Y').name).toBe('Click Y');
  });
});

describe('isApprovalItem', () => {
  it('accepts an enqueued item', () => {
    expect(isApprovalItem(enqueue([], draft()).item)).toBe(true);
  });

  it('rejects a malformed item', () => {
    expect(isApprovalItem({ id: 'x' })).toBe(false);
  });
});

const checkCtx = (overrides: Partial<CheckContext> = {}): CheckContext => ({
  now: 10_000,
  goal: 'goal',
  steps: [],
  history: [],
  proposals: [],
  ...overrides,
});

const proposal = (overrides: Partial<WatchProposal> = {}): WatchProposal => ({
  id: 'p1',
  time: 0,
  kind: 'close_popup',
  text: 't',
  status: 'pending',
  ...overrides,
});

describe('runCheck', () => {
  it('flags a pending item whose proposal is no longer listed', () => {
    const item = pendingItem({ proposalId: 'p1' });
    const { flagged } = runCheck([item], checkCtx({ now: item.time + 1 }));
    expect(flagged[0].stale).toBe('its proposal is no longer listed');
  });

  it('flags a pending item whose proposal was already accepted or dismissed', () => {
    const item = pendingItem({ proposalId: 'p1' });
    const { flagged } = runCheck([item], checkCtx({ now: item.time + 1, proposals: [proposal({ status: 'accepted' })] }));
    expect(flagged[0].stale).toBe('its proposal was already accepted');
  });

  it('flags a pending item whose step ran again in history after it was queued', () => {
    const s = step({ id: 's1', action: 'click', x: 0.5, y: 0.5 });
    const item = pendingItem({ step: s, planned: true, time: 1000, goal: 'goal' });
    const record: ActionRecord = { id: 'r1', time: 2000, action: 'click', x: 960, y: 540, srcW: 1920, srcH: 1080, source: 'Replay', via: 'demo', ok: true, message: '' };
    const { flagged } = runCheck([item], checkCtx({ now: 3000, goal: 'goal', history: [record] }));
    expect(flagged[0].stale).toBe('the same operation already ran after it was queued');
  });

  it('flags a pending item whose goal changed', () => {
    const item = pendingItem({ goal: 'old goal', time: 1000 });
    const { flagged } = runCheck([item], checkCtx({ now: 1500, goal: 'new goal' }));
    expect(flagged[0].stale).toContain('the goal changed to "new goal"');
  });

  it('flags a pending item whose planned step left the plan', () => {
    const s = step({ id: 's1' });
    const item = pendingItem({ step: s, planned: true, time: 1000, goal: 'goal' });
    const { flagged } = runCheck([item], checkCtx({ now: 1500, goal: 'goal', steps: [] }));
    expect(flagged[0].stale).toBe('its step is no longer in the plan');
  });

  it('flags a pending item older than STALE_AFTER_MS', () => {
    const item = pendingItem({ time: 1000, goal: '' });
    const { flagged } = runCheck([item], checkCtx({ now: 1000 + STALE_AFTER_MS + 1, goal: '' }));
    expect(flagged[0].stale).toBe('queued over 30 minutes — check it is still wanted');
  });

  it('leaves a still-needed item unflagged, clearing an earlier stale flag', () => {
    const item = pendingItem({ time: 1000, goal: 'goal', stale: 'old reason' });
    const { items, flagged } = runCheck([item], checkCtx({ now: 1500, goal: 'goal' }));
    expect(flagged).toHaveLength(0);
    expect(items[0].stale).toBeUndefined();
  });

  it('ignores decided items', () => {
    const item = pendingItem({ status: 'approved', time: 1000 });
    const { items, flagged } = runCheck([item], checkCtx({ now: 1000 + STALE_AFTER_MS + 1 }));
    expect(flagged).toHaveLength(0);
    expect(items[0]).toBe(item);
  });

  it('returns the full flagged list', () => {
    const stale = pendingItem({ id: 'a', time: 1000, goal: '' });
    const ok = pendingItem({ id: 'b', time: 1500, goal: 'goal' });
    const { flagged } = runCheck([stale, ok], checkCtx({ now: 1000 + STALE_AFTER_MS + 1, goal: 'goal' }));
    expect(flagged.map((i) => i.id)).toEqual(['a']);
  });
});

describe('approvalTree', () => {
  it('groups pending items by requester then class, preserving order and omitting decided items', () => {
    const items: ApprovalItem[] = [
      pendingItem({ id: 'a', requestedBy: 'Alice', cls: 'admin_cmd' }),
      pendingItem({ id: 'b', requestedBy: 'Alice', cls: 'email' }),
      pendingItem({ id: 'c', requestedBy: 'Bob', cls: 'admin_cmd' }),
      pendingItem({ id: 'd', requestedBy: 'Alice', cls: 'admin_cmd' }),
      pendingItem({ id: 'e', requestedBy: 'Alice', cls: 'admin_cmd', status: 'approved' }),
    ];
    const tree = approvalTree(items);
    expect(tree.map((b) => b.requestedBy)).toEqual(['Alice', 'Bob']);
    expect(tree[0].classes.map((c) => c.cls)).toEqual(['admin_cmd', 'email']);
    expect(tree[0].classes[0].items.map((i) => i.id)).toEqual(['a', 'd']);
    expect(tree[1].classes[0].items.map((i) => i.id)).toEqual(['c']);
  });
});
