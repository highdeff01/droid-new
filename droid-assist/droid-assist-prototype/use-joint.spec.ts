import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalItem } from './approvals.js';
import { CODE_FIX_REQUESTER } from './joint-errors.js';
import type { MainBridge } from './main-bridge.js';
import type { Frame } from './types.js';
import { DIAGNOSE_WINDOW_MS, JOINT_CAPABILITY, createJointEngine, type JointDeps } from './use-joint.js';

const frame = (time: number, url = 'data:image/jpeg;base64,main'): Frame => ({ id: time, time, url, data: {} as ImageData, srcW: 480, srcH: 270, source: 'main-app' });

function setup(overrides: Partial<JointDeps> = {}, connected = true) {
  let t = 10_000;
  const sent: Array<{ type: string; payload: unknown }> = [];
  const requests: Array<{ type: string; payload: unknown }> = [];
  const bridge = {
    start: () => {},
    stop: () => {},
    state: () => ({ status: connected ? 'connected' : 'off' }),
    send: vi.fn(),
    request: vi.fn(async (type: string, payload: unknown) => {
      requests.push({ type, payload });
      return { ok: true, message: 'main did it' };
    }),
  } as unknown as MainBridge;
  const deps: JointDeps = {
    addLog: vi.fn(),
    bridge: () => bridge,
    queue: vi.fn((d) => ({ ...d, id: 'apv1', time: t, status: 'pending' }) as ApprovalItem),
    fixScript: vi.fn(),
    record: vi.fn(),
    history: async () => [],
    target: () => 'droid-main',
    busy: () => false,
    local: vi.fn(async () => ({ ok: true, message: 'planned' })),
    localFrame: () => frame(t, 'data:image/jpeg;base64,local'),
    lines: () => [],
    verify: vi.fn(async () => ({ ok: true, reason: 'matches' })),
    pending: () => 0,
    halt: () => null,
    now: () => t,
    ...overrides,
  };
  const engine = createJointEngine(() => deps);
  vi.mocked(bridge.send).mockImplementation(async (type, payload) => {
    sent.push({ type, payload });
    if (type === 'request_frame') queueMicrotask(() => engine.onFrame(frame(t, 'data:image/jpeg;base64,fresh')));
    return { ok: connected, message: connected ? 'sent' : 'not connected' };
  });
  return { engine, deps, sent, requests, advance: (ms: number) => { t += ms; }, now: () => t };
}

afterEach(() => vi.useRealTimers());

describe('cross-app error handling', () => {
  it('a droid-new step failure proposes a bounded fix script and queues nothing', () => {
    const { engine, deps } = setup();
    engine.onError({ app: 'droid-new', kind: 'step', message: 'Save not found', step: 'Save', goal: 'save file' });
    expect(deps.fixScript).toHaveBeenCalledWith({ element: 'Save', flow: 'save file', problem: 'Save not found' });
    expect(deps.queue).not.toHaveBeenCalled();
  });

  it('a droid-main console error queues a system-file code fix and sends nothing yet', () => {
    const { engine, deps, sent } = setup();
    engine.onError({ app: 'droid-main', kind: 'main-app', message: 'Console error: x is undefined', file: 'src/page.tsx', goal: 'g' });
    expect(deps.queue).toHaveBeenCalledWith(expect.objectContaining({ requestedBy: CODE_FIX_REQUESTER, cls: 'system_file' }));
    expect(deps.fixScript).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it('leaves AI, watcher and test errors to the existing resolution center', () => {
    const { engine, deps } = setup();
    engine.onError({ app: 'droid-new', kind: 'ai', message: 'AI timed out' });
    engine.onError({ app: 'droid-new', kind: 'watcher', message: 'watcher failed' });
    expect(deps.fixScript).not.toHaveBeenCalled();
    expect(deps.queue).not.toHaveBeenCalled();
  });

  it('diagnoses the same error once per window', () => {
    const { engine, deps, advance } = setup();
    const e = { app: 'droid-new' as const, kind: 'drift' as const, message: 'drift red' };
    engine.onError(e);
    engine.onError(e);
    expect(deps.fixScript).toHaveBeenCalledTimes(1);
    advance(DIAGNOSE_WINDOW_MS);
    engine.onError(e);
    expect(deps.fixScript).toHaveBeenCalledTimes(2);
  });

  it('sends code_fix to droid-main only once the code fix is approved', async () => {
    const { engine, sent } = setup();
    const item: ApprovalItem = { id: 'apv9', time: 1, requestedBy: CODE_FIX_REQUESTER, kind: 'operation', cls: 'system_file', summary: 'Code fix in src/a.ts: boom', context: '', goal: '', status: 'rejected' };
    await engine.onDecided(item);
    expect(sent).toHaveLength(0);
    await engine.onDecided({ ...item, status: 'approved' });
    expect(sent).toEqual([{ type: 'code_fix', payload: { file: 'src/a.ts', problem: 'boom', fix: 'Fix "boom" in src/a.ts', approvalId: 'apv9' } }]);
  });
});

describe('joint run', () => {
  it('droid-main without the capability: droid-new does both halves, records them with its app', async () => {
    const { engine, deps, requests } = setup({ target: () => 'droid-new' });
    engine.onStatus({ load: 0, capabilities: [] });
    await engine.run('Open the files panel');
    expect(requests).toHaveLength(0);
    expect(deps.local).toHaveBeenCalledWith('calculate', expect.any(String));
    expect(deps.local).toHaveBeenCalledWith('perform', expect.any(String));
    const records = vi.mocked(deps.record).mock.calls.map(([d]) => d);
    expect(records.length).toBeGreaterThanOrEqual(2);
    expect(records.every((r) => r.app === 'droid-new' && r.op === 'joint')).toBe(true);
  });

  it('droid-main performs on its own screen and is verified against a frame newer than the operation', async () => {
    const { engine, deps, requests, sent } = setup();
    engine.onFrame(frame(0, 'data:image/jpeg;base64,old'));
    engine.onStatus({ load: 0, capabilities: [JOINT_CAPABILITY] });
    const verify = vi.mocked(deps.verify);
    await engine.run('Open the files panel');
    expect(requests.some((r) => (r.payload as { role: string }).role === 'perform')).toBe(true);
    expect(sent.some((s) => s.type === 'request_frame')).toBe(true);
    expect(verify).toHaveBeenCalled();
    expect(verify.mock.calls.every(([, f]) => f?.url === 'data:image/jpeg;base64,fresh')).toBe(true);
    const performed = vi.mocked(deps.record).mock.calls.map(([d]) => d).find((d) => d.input.startsWith('perform'));
    expect(performed?.app).toBe('droid-main');
  });

  it('never chooses a disconnected droid-main, even when it has the capability', async () => {
    const { engine, deps } = setup({ busy: () => false }, false);
    const local = vi.mocked(deps.local);
    engine.onStatus({ load: 0, capabilities: [JOINT_CAPABILITY] });
    await engine.run('anything');
    expect(local).toHaveBeenCalled();
    expect(vi.mocked(deps.addLog).mock.calls.some(([, m]) => m.includes('droid-new arbitrates'))).toBe(true);
  });
});
