import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAssist } from './use-assist.js';
import type { WorkflowStep } from './types.js';

vi.mock('./grounding.js', async (orig) => ({ ...(await orig<typeof import('./grounding.js')>()), boxedFrames: vi.fn(async (f: unknown) => ({ full: f, crop: f })) }));

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('AI intention notifications (demo desktop, AI offline)', () => {
  const click: WorkflowStep = { id: 'c', name: 'Open files', target: 'files icon', action: 'click', x: 0.5, y: 0.62, status: 'pending' };
  const type: WorkflowStep = { id: 't', name: 'Type name', target: 'name field', action: 'type', text: 'hello', x: 0.3, y: 0.2, status: 'pending' };

  it('a replay states the intention of each click and typing action in the notification center and records an attempt for each', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    act(() => result.current.setGoal('rename the file'));
    act(() => result.current.setSteps([click, type]));
    await act(() => result.current.replay(false));
    const intents = result.current.notifications.filter((n) => n.category === 'intent').map((n) => n.title);
    expect(intents.some((t) => t.startsWith('Moving to files icon (50%, 62%) to click it because '))).toBe(true);
    expect(intents.some((t) => t.startsWith('Typing "hello" into name field (30%, 20%) because '))).toBe(true);
    const attempts = result.current.attempts;
    expect(attempts.map((a) => a.stepId)).toEqual(['c', 't']);
    expect(attempts.every((a) => a.end !== undefined)).toBe(true);
    expect(attempts[0].to).toEqual({ x: 0.5, y: 0.62 });
  }, 20_000);
});
