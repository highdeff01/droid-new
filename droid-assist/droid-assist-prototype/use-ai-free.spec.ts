import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAiFree, type AiFreeHookDeps } from './use-ai-free.js';
import { boxFrame, boxImage } from './test-frames.js';
import type { OutboundPayloads, OutboundType } from './main-bridge-protocol.js';
import type { WorkflowStep } from './types.js';

const step = (id: string): WorkflowStep => ({ id, name: id, action: 'click', x: 0.5, y: 0.5, target: id, status: 'pending' });

/** A screen that never changes: every step fails verification. */
function host(mainOk = true) {
  const sends: string[] = [];
  const main: Array<{ type: OutboundType; payload: unknown }> = [];
  let n = 0;
  const deps: AiFreeHookDeps = {
    addLog: () => undefined,
    route: () => ({
      capture: async () => boxFrame(boxImage([{ x: 40, y: 40 }]), ++n),
      send: async (s) => {
        sends.push(s.id);
        return { ok: true, message: 'completed' };
      },
    }),
    learned: () => null,
    onVerified: () => undefined,
    replan: async () => null,
    ask: () => null,
    renderScene: () => null,
    saveOperation: () => undefined,
    loadSteps: () => undefined,
    steps: () => [],
    goal: () => 'goal',
    frames: () => [],
    retries: () => 0,
    stopped: () => null,
    busy: () => false,
    sendMain: vi.fn(async <K extends OutboundType>(type: K, payload: OutboundPayloads[K]) => {
      main.push({ type, payload });
      return { ok: mainOk, message: mainOk ? 'taking over' : 'busy' };
    }),
    mainConnected: () => true,
    tellAi: () => undefined,
  };
  return { deps, sends, main };
}

afterEach(cleanup);

describe('useAiFree takeover', () => {
  it('hands a step that failed verification to droid-main and stops acting once droid-main accepts it', async () => {
    const h = host();
    const { result } = renderHook(() => useAiFree(h.deps));
    await act(() => result.current.runAiFreeSteps([step('a'), step('b'), step('c')], 'goal'));
    const request = h.main.find((m) => m.type === 'takeover_request');
    expect(request?.payload).toMatchObject({ stepIndex: 0, remaining: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] });
    expect(h.sends).toEqual(['a']);
  });

  it('keeps acting when droid-main refuses the handoff', async () => {
    const h = host(false);
    const { result } = renderHook(() => useAiFree(h.deps));
    await act(() => result.current.runAiFreeSteps([step('a'), step('b')], 'goal'));
    expect(h.main.filter((m) => m.type === 'takeover_request')).toHaveLength(2);
    expect(h.sends).toEqual(['a', 'b']);
  });
});
