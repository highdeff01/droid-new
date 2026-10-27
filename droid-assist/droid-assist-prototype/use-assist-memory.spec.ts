import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAssist } from './use-assist.js';

// jsdom has no canvas: the boxed full frame and zoomed crop are the frame itself here.
vi.mock('./grounding.js', async (orig) => ({ ...(await orig<typeof import('./grounding.js')>()), boxedFrames: vi.fn(async (f: unknown) => ({ full: f, crop: f })) }));

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  }
  (globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataPolyfill;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const SHOT = 'data:image/jpeg;base64,RkFJTA==';
const failure = { id: 'fail_1', time: 1, operation: 'export the quarterly report as pdf', actor: 'Replay', what: 'Step "Print to PDF" (click on Print menu) did not complete', steps: ['"Print to PDF" (click on Print menu)'], targets: ['Print menu'], shots: [SHOT] };
const avoid = { id: 'p1', kind: 'avoid', pattern: 'never use the browser print dialog', context: 'export quarterly report pdf', time: 2 };

/** Stubs the model: every call gets a one-step plan; returns the user turns sent. */
function stubPlanner() {
  const sent: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ role: string; content: string }> };
    const last = body.messages?.at(-1);
    if (last?.role === 'user') sent.push(last.content);
    const steps = [{ name: 'Open File menu', action: 'click', target: 'File menu', x: 0.1, y: 0.1 }];
    return new Response(JSON.stringify({ message: { role: 'assistant', content: JSON.stringify({ steps }) } }), { status: 200 });
  }));
  return sent;
}

async function mount() {
  const { result } = renderHook(() => useAssist());
  await act(async () => {});
  return result;
}

describe('operation memory on every AI turn', () => {
  it('injects the BLACKLISTED methods and similar failures of the operation into the prompt', async () => {
    localStorage.setItem('droid-assist.patterns', JSON.stringify([avoid]));
    localStorage.setItem('droid-assist.memory', JSON.stringify({ failures: [failure], notes: [{ id: 'note_1', time: 3, operation: 'export quarterly report', text: 'Use File > Export, not Print' }] }));
    const sent = stubPlanner();
    const result = await mount();
    act(() => result.current.setGoal('Export the quarterly report to PDF'));
    await act(() => result.current.autoPlan());
    const turn = sent.find((s) => s.includes('OPERATION MEMORY')) ?? '';
    expect(turn).toContain('Goal: Export the quarterly report to PDF');
    expect(turn).toContain('BLACKLISTED');
    expect(turn).toContain('never use the browser print dialog');
    expect(turn).toContain('"Print to PDF" (click on Print menu) failed in "export the quarterly report as pdf"');
    expect(turn).toContain('Use File > Export, not Print');
    // Kept out of the history: the stored conversation never repeats the block.
    expect(result.current.aiHistory.some((h) => h.content.includes('BLACKLISTED'))).toBe(false);
  });

  it('sends no blacklist for an unrelated operation', async () => {
    localStorage.setItem('droid-assist.patterns', JSON.stringify([avoid]));
    localStorage.setItem('droid-assist.memory', JSON.stringify({ failures: [failure], notes: [] }));
    const sent = stubPlanner();
    const result = await mount();
    act(() => result.current.setGoal('Play the welcome video'));
    await act(() => result.current.autoPlan());
    const turn = sent.find((s) => s.includes('OPERATION MEMORY')) ?? '';
    expect(turn).toContain('Goal: Play the welcome video');
    expect(turn).not.toContain('BLACKLISTED');
  });
});

describe('failure-reminder triggers', () => {
  it('surfaces a similar failed operation with its screenshot when planning starts', async () => {
    localStorage.setItem('droid-assist.memory', JSON.stringify({ failures: [failure], notes: [] }));
    stubPlanner();
    const result = await mount();
    act(() => result.current.setGoal('Export the quarterly report to PDF'));
    await act(() => result.current.autoPlan());
    const reminder = result.current.log.find((l) => l.source === 'Memory');
    expect(reminder?.message).toMatch(/^Planner — a similar operation failed before.*Print to PDF/);
    expect(reminder?.shots).toEqual([SHOT]);
  });

  it('does not fire for an unrelated operation', async () => {
    localStorage.setItem('droid-assist.memory', JSON.stringify({ failures: [failure], notes: [] }));
    stubPlanner();
    const result = await mount();
    await act(() => result.current.autoPlan('Play the welcome video'));
    expect(result.current.log.some((l) => l.source === 'Memory')).toBe(false);
  });

  it('saves a failed subagent slice as a reminder and hands it to the subagent assigned the same work next time', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const result = await mount();
    const calc = { kind: 'link' as const, items: ['Calc'], goal: 'test Calc' };
    await act(() => result.current.testRoutes(calc));
    expect(result.current.memory.failures[0]).toMatchObject({ actor: 'Subagent 1', targets: ['Calc'] });
    expect(JSON.parse(localStorage.getItem('droid-assist.memory')!).failures).toHaveLength(1);
    await act(() => result.current.testRoutes(calc));
    expect(result.current.log.some((l) => l.source === 'Memory' && /^Subagent 1 — a similar operation failed before/.test(l.message))).toBe(true);
  });
});

describe('notes and the panel groups', () => {
  it('keeps notes per operation and forgets them', async () => {
    const result = await mount();
    act(() => result.current.addOperationNote('Rename the project folder', 'Press F2 instead of right-click'));
    expect(result.current.operations.map((g) => [g.operation, g.notes.map((n) => n.text)])).toEqual([['Rename the project folder', ['Press F2 instead of right-click']]]);
    act(() => result.current.forgetMemory(result.current.memory.notes[0].id));
    expect(result.current.operations).toEqual([]);
  });
});
