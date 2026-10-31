import { describe, expect, it } from 'vitest';
import { enqueue, resolve } from './approvals.js';
import type { ApprovalItem } from './approvals.js';
import { CODE_FIX_REQUESTER, UNKNOWN_FILE, codeFixPayload, diagnose, errorApp, interceptError, type JointError } from './joint-errors.js';
import type { InterceptPayload } from './main-bridge-protocol.js';

const error = (overrides: Partial<JointError> = {}): JointError => ({ app: 'droid-new', kind: 'step', message: 'Button not found', ...overrides });

describe('diagnose', () => {
  it.each(['step', 'drift', 'bridge'] as const)('a droid-new %s error becomes a fix_script against the failing step', (kind) => {
    const result = diagnose(error({ kind, step: 'Submit', goal: 'Checkout flow' }));
    expect(result.kind).toBe('fix_script');
    expect(result.app).toBe('droid-new');
    if (result.kind !== 'fix_script') return;
    expect(result.context.element).toBe('Submit');
    expect(result.context.flow).toBe('Checkout flow');
    expect(result.context.problem).toBe('Button not found');
  });

  it('a droid-new error with no step uses the error kind as the element', () => {
    const result = diagnose(error({ kind: 'drift', step: undefined }));
    if (result.kind !== 'fix_script') throw new Error('expected fix_script');
    expect(result.context.element).toBe('drift');
  });

  it('a droid-new error with no goal gets flow "(no flow)"', () => {
    const result = diagnose(error({ goal: undefined }));
    if (result.kind !== 'fix_script') throw new Error('expected fix_script');
    expect(result.context.flow).toBe('(no flow)');
  });

  it('a droid-main error becomes a code_fix draft queued for approval', () => {
    const result = diagnose(error({ app: 'droid-main', kind: 'main-app', message: 'TypeError: x is undefined', file: 'src/app.ts' }));
    expect(result.kind).toBe('code_fix');
    expect(result.app).toBe('droid-main');
    if (result.kind !== 'code_fix') return;
    expect(result.draft.cls).toBe('system_file');
    expect(result.draft.kind).toBe('operation');
    expect(result.draft.requestedBy).toBe(CODE_FIX_REQUESTER);
    expect(result.draft.summary).toContain('src/app.ts');
  });

  it('a droid-main error with no file names UNKNOWN_FILE in the summary', () => {
    const result = diagnose(error({ app: 'droid-main', kind: 'main-app', message: 'Crash', file: undefined }));
    if (result.kind !== 'code_fix') throw new Error('expected code_fix');
    expect(result.draft.summary).toContain(UNKNOWN_FILE);
  });
});

describe('interceptError', () => {
  it('a console_error intercept becomes a droid-main error with the message prefixed and the file carried', () => {
    const payload: InterceptPayload = { kind: 'console_error', message: 'ReferenceError: x', file: 'src/app.ts' };
    const result = interceptError(payload, 'goal');
    expect(result.app).toBe('droid-main');
    expect(result.kind).toBe('main-app');
    expect(result.message).toBe('Console error: ReferenceError: x');
    expect(result.file).toBe('src/app.ts');
  });

  it('an error_occurred intercept keeps the message as is', () => {
    const payload: InterceptPayload = { kind: 'error_occurred', message: 'Something broke' };
    const result = interceptError(payload, 'goal');
    expect(result.message).toBe('Something broke');
  });
});

describe('errorApp', () => {
  it('main-app errors belong to droid-main', () => {
    expect(errorApp('main-app')).toBe('droid-main');
  });

  it.each(['ai', 'step', 'drift', 'bridge', 'watcher', 'test'] as const)('%s errors belong to droid-new', (kind) => {
    expect(errorApp(kind)).toBe('droid-new');
  });
});

describe('codeFixPayload', () => {
  const queueFrom = (e: JointError): { items: ApprovalItem[]; item: ApprovalItem } => {
    const correction = diagnose(e);
    if (correction.kind !== 'code_fix') throw new Error('expected code_fix');
    const { items, item } = enqueue([], correction.draft, 1000);
    return { items, item };
  };

  it('a pending item has no payload yet', () => {
    const { item } = queueFrom(error({ app: 'droid-main', kind: 'main-app', message: 'Crash', file: 'a.ts' }));
    expect(codeFixPayload(item)).toBeNull();
  });

  it('an approved item becomes a payload with the default fix text and the approval id', () => {
    const { items, item } = queueFrom(error({ app: 'droid-main', kind: 'main-app', message: 'Crash', file: 'a.ts' }));
    const approved = resolve(items, item.id, 'approved')[0];
    const payload = codeFixPayload(approved);
    expect(payload).toEqual({ file: 'a.ts', problem: 'Crash', fix: 'Fix "Crash" in a.ts', approvalId: item.id });
  });

  it('an edited item uses the edit text as the fix', () => {
    const { items, item } = queueFrom(error({ app: 'droid-main', kind: 'main-app', message: 'Crash', file: 'a.ts' }));
    const edited = resolve(items, item.id, 'edited', 'Guard against null before use')[0];
    const payload = codeFixPayload(edited);
    expect(payload?.fix).toBe('Guard against null before use');
  });

  it('an item from another requester is not a joint code fix', () => {
    const { items, item } = queueFrom(error({ app: 'droid-main', kind: 'main-app', message: 'Crash', file: 'a.ts' }));
    const approved = resolve(items, item.id, 'approved')[0];
    const other: ApprovalItem = { ...approved, requestedBy: 'Screen watcher' };
    expect(codeFixPayload(other)).toBeNull();
  });

  it('a rejected item has no payload', () => {
    const { items, item } = queueFrom(error({ app: 'droid-main', kind: 'main-app', message: 'Crash', file: 'a.ts' }));
    const rejected = resolve(items, item.id, 'rejected')[0];
    expect(codeFixPayload(rejected)).toBeNull();
  });
});
