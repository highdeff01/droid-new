import { describe, expect, it, vi } from 'vitest';
import { AiError, AiParseError } from './ai.js';
import type { AskFn } from './ai.js';
import type { BusMessage } from './agent-bus.js';
import type { WorkflowStep } from './types.js';
import { DISAGREEMENT_THRESHOLD, detectDisagreements, resolveDisagreement, resolutionBrief, settleByTests, toResolution, type Disagreement, type Report, type Ruling } from './resolution-center.js';

const step = (over: Partial<WorkflowStep> = {}): WorkflowStep => ({ id: 's', name: 'Step', action: 'click', x: 0, y: 0, status: 'pending', ...over });
const msg = (over: Partial<BusMessage> = {}): BusMessage => ({ id: 'm', time: 0, from: 'drift', to: 'popup', element: { name: 'X', x: 0, y: 0 }, status: 'queued', ...over });
const ask = (content: string, thinking: string | null = null) => vi.fn<AskFn>(async () => ({ content, thinking }));

describe('detectDisagreements', () => {
  it('matches an element case/space-insensitively across the main plan and a bus report', () => {
    const steps = [step({ target: 'Save button', x: 0.2, y: 0.3 })];
    const bus = [msg({ from: 'drift', time: 500, element: { name: 'save  BUTTON', x: 0.6, y: 0.3 } })];
    const disagreements = detectDisagreements(steps, bus, DISAGREEMENT_THRESHOLD);
    expect(disagreements).toHaveLength(1);
    const [d] = disagreements;
    expect(d.element).toBe('Save button');
    expect(d.spread).toBeCloseTo(0.4, 5);
    expect(d.reports.map((r) => r.reporter).sort()).toEqual(['drift', 'main']);
  });

  it('is not a disagreement when the reports are within the threshold', () => {
    const steps = [step({ target: 'Save button', x: 0.2, y: 0.3 })];
    const bus = [msg({ from: 'drift', time: 500, element: { name: 'Save button', x: 0.23, y: 0.3 } })];
    expect(detectDisagreements(steps, bus)).toEqual([]);
  });

  it('does not treat a single reporter\'s fan-out or a repeat report as a disagreement', () => {
    const fanOut = [
      msg({ id: 'm1', from: 'drift', to: 'popup', time: 100, element: { name: 'Vault icon', x: 0.9, y: 0.9 } }),
      msg({ id: 'm2', from: 'drift', to: 'habits', time: 100, element: { name: 'Vault icon', x: 0.9, y: 0.9 } }),
      msg({ id: 'm3', from: 'drift', to: 'screen', time: 100, element: { name: 'Vault icon', x: 0.9, y: 0.9 } }),
    ];
    expect(detectDisagreements([], fanOut)).toEqual([]);

    const repeated = [
      msg({ id: 'm4', from: 'drift', to: 'popup', time: 100, element: { name: 'Vault icon', x: 0.1, y: 0.1 } }),
      msg({ id: 'm5', from: 'drift', to: 'popup', time: 200, element: { name: 'Vault icon', x: 0.9, y: 0.9 } }),
    ];
    expect(detectDisagreements([], repeated)).toEqual([]);
  });

  it('finds a disagreement between two bus agents with no plan involved', () => {
    const bus = [
      msg({ id: 'm1', from: 'screen', to: 'popup', time: 1, element: { name: 'Trash icon', x: 0.1, y: 0.1 } }),
      msg({ id: 'm2', from: 'coords', to: 'popup', time: 2, element: { name: 'Trash icon', x: 0.9, y: 0.9 } }),
    ];
    const disagreements = detectDisagreements([], bus);
    expect(disagreements).toHaveLength(1);
    expect(disagreements[0].reports.map((r) => r.reporter).sort()).toEqual(['coords', 'screen']);
  });

  it('respects a custom threshold', () => {
    const bus = [
      msg({ id: 'm1', from: 'screen', to: 'popup', time: 1, element: { name: 'Trash icon', x: 0.1, y: 0.1 } }),
      msg({ id: 'm2', from: 'coords', to: 'popup', time: 2, element: { name: 'Trash icon', x: 0.2, y: 0.1 } }),
    ];
    expect(detectDisagreements([], bus, 0.15)).toEqual([]);
    expect(detectDisagreements([], bus, 0.05)).toHaveLength(1);
  });
});

const mainReport: Report = { reporter: 'main', element: { name: 'Save button', x: 0.2, y: 0.3 }, time: 2000 };
const driftReport: Report = { reporter: 'drift', element: { name: 'Save button', x: 0.6, y: 0.3 }, time: 500 };
const disagreement: Disagreement = { id: 'dis:save button', element: 'Save button', reports: [mainReport, driftReport], spread: 0.4 };

describe('resolveDisagreement', () => {
  it('asks with json:true and a prompt listing each reporter, returning the ruling and thinking', async () => {
    const fn = ask(JSON.stringify({ winner: 'drift', workflow: ['click Save'], info: 'moved', needs_test: false }), 'why');
    const ruling = await resolveDisagreement(fn, disagreement, null);
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ json: true, frame: null }));
    const prompt = fn.mock.calls[0][0].prompt;
    expect(prompt).toContain('main');
    expect(prompt).toContain('drift');
    expect(ruling).toEqual({ winner: 'drift', workflow: ['click Save'], info: 'moved', needsTest: false, thinking: 'why' });
  });

  it('needs a test when the model names no winner', async () => {
    const fn = ask(JSON.stringify({ winner: null, workflow: [], info: '', needs_test: false }));
    const ruling = await resolveDisagreement(fn, disagreement, null);
    expect(ruling.winner).toBeNull();
    expect(ruling.needsTest).toBe(true);
  });

  it('rejects a winner that is not one of the reporters', async () => {
    const fn = ask(JSON.stringify({ winner: 'popup', workflow: [], info: '', needs_test: false }));
    await expect(resolveDisagreement(fn, disagreement, null)).rejects.toBeInstanceOf(AiError);
  });

  it('rejects a prose reply with no JSON object', async () => {
    const fn = ask('I believe the drift report is correct because it matches the layout.');
    await expect(resolveDisagreement(fn, disagreement, null)).rejects.toBeInstanceOf(AiParseError);
  });
});

describe('settleByTests', () => {
  const reports: Report[] = [
    { reporter: 'main', element: { name: 'X', x: 0, y: 0 }, time: 1 },
    { reporter: 'drift', element: { name: 'X', x: 0, y: 0 }, time: 2 },
    { reporter: 'screen', element: { name: 'X', x: 0, y: 0 }, time: 3 },
  ];
  const d: Disagreement = { id: 'dis:x', element: 'X', reports, spread: 0.5 };

  it('returns the first report whose test passes and does not test the rest', async () => {
    const test = vi.fn(async (r: Report) => r.reporter === 'drift');
    await expect(settleByTests(d, test)).resolves.toEqual(reports[1]);
    expect(test).toHaveBeenCalledTimes(2);
  });

  it('returns null when no report passes', async () => {
    const test = vi.fn(async () => false);
    await expect(settleByTests(d, test)).resolves.toBeNull();
    expect(test).toHaveBeenCalledTimes(3);
  });
});

describe('resolutionBrief', () => {
  const ruling: Ruling = { winner: 'drift', workflow: ['click Save', 'verify'], info: 'moved', needsTest: false, thinking: null };

  it('carries the element, the winner coordinates and the workflow and info when there is a winner', () => {
    const brief = resolutionBrief(disagreement, driftReport, ruling);
    expect(brief).toContain('"Save button"');
    expect(brief).toContain('x=0.600, y=0.300');
    expect(brief).toContain('click Save → verify');
    expect(brief).toContain('moved');
  });

  it('says unresolved when there is no winner', () => {
    expect(resolutionBrief(disagreement, null, null)).toContain('unresolved');
  });
});

describe('toResolution', () => {
  it('carries the via and the brief', () => {
    const ruling: Ruling = { winner: 'drift', workflow: ['click Save'], info: 'moved', needsTest: false, thinking: null };
    const res = toResolution(disagreement, 'ai', driftReport, ruling, 1234);
    expect(res).toMatchObject({ element: 'Save button', via: 'ai', winner: driftReport, time: 1234, brief: resolutionBrief(disagreement, driftReport, ruling) });
  });
});
