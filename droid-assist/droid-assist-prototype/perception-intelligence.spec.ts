import { describe, expect, it } from 'vitest';
import type { ActionRecord, Frame, WorkflowStep } from './types.js';
import type { InventoryElement } from './screen-inventory.js';
import {
  auditCommands, classifyPageTransition, descriptorDistance, frameChangeRatio, learnVisualPrototype,
  matchVisualPrototype, outcomeRates, prospectPoints, relateElements, visualDescriptor,
} from './perception-intelligence.js';

const element = (name: string, x: number, y: number, state: InventoryElement['state'] = 'static'): InventoryElement => ({
  id: name, name, known: true, kind: 'button', box: { x, y, w: 0.12, h: 0.06 },
  cell: 'A1', mapCells: 'R1C1', state,
});
const frame = (id: number, value = 80): Frame => {
  const data = { width: 32, height: 18, data: new Uint8ClampedArray(32 * 18 * 4) };
  for (let i = 0; i < data.data.length; i += 4) {
    data.data[i] = value; data.data[i + 1] = value; data.data[i + 2] = value; data.data[i + 3] = 255;
  }
  return { id, time: id * 1000, url: '', data: data as unknown as ImageData, srcW: 1920, srcH: 1080, source: 'desktop' };
};
const step = (over: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id: 's1', name: 'Click Save', action: 'click', x: 0.5, y: 0.5, status: 'done', ...over,
});

describe('visual perception intelligence', () => {
  it('extracts a stable appearance descriptor and compares it', () => {
    const a = visualDescriptor(frame(1, 50), { x: 0, y: 0, w: 1, h: 1 });
    const b = visualDescriptor(frame(2, 50), { x: 0, y: 0, w: 1, h: 1 });
    expect(a).toHaveLength(16);
    expect(descriptorDistance(a, b)).toBe(0);
    expect(frameChangeRatio(frame(1, 50), frame(2, 50))).toBe(0);
    expect(frameChangeRatio(frame(1, 50), frame(2, 200))).toBe(1);
  });

  it('does not learn an image prototype from an unverified or failed outcome', () => {
    const input = { name: 'Save', kind: 'button' as const, descriptor: [0.2, 0.3], frameId: 1, verifiedSuccess: false, at: 10 };
    expect(learnVisualPrototype([], input)).toEqual([]);
    const learned = learnVisualPrototype([], { ...input, verifiedSuccess: true });
    expect(learned[0]).toMatchObject({ name: 'Save', samples: 1, verifiedSuccesses: 1, lastFrameId: 1 });
    expect(matchVisualPrototype(learned, 'button', [0.2, 0.3])?.distance).toBe(0);
    expect(matchVisualPrototype(learned, 'input', [0.2, 0.3])).toBeNull();
  });

  it('tracks geometric relationships without claiming semantic causality', () => {
    const relations = relateElements([element('Panel', 0.1, 0.1), element('Save', 0.12, 0.12), element('Cancel', 0.8, 0.12)]);
    expect(relations.some(r => r.kind === 'contains' || r.kind === 'overlaps')).toBe(true);
    expect(relations.some(r => r.kind === 'aligned-y')).toBe(true);
    expect(relations.every(r => r.evidence.includes('frame geometry'))).toBe(true);
  });

  it('distinguishes likely navigation from content changing on the same page', () => {
    expect(classifyPageTransition([element('Home', 0.1, 0.1), element('Save', 0.3, 0.1)], [element('Home', 0.1, 0.1), element('Save', 0.3, 0.1)], 0.3)).toBe('content-shift');
    expect(classifyPageTransition([element('Home', 0.1, 0.1), element('Save', 0.3, 0.1)], [element('Profile', 0.6, 0.1), element('Settings', 0.8, 0.1)], 0.4)).toBe('navigation-likely');
  });

  it('audits pending, running and completed-without-screenshot commands', () => {
    const audits = auditCommands([
      step({ id: 'pending', name: 'Pending', status: 'pending' }),
      step({ id: 'running', name: 'Running', status: 'running' }),
      step({ id: 'done', name: 'Done', status: 'done' }),
    ], 50_000, 10_000);
    expect(audits.map(a => a.issue)).toEqual(['possibly-missed', 'unverified', 'unverified']);
  });

  it('computes success percentages only from explicit after-frame verification', () => {
    const rates = outcomeRates([], [
      step({ id: 'a', target: 'Save', status: 'done', verifiedAt: 10, afterFrame: frame(1) }),
      step({ id: 'b', target: 'Save', status: 'failed', verifiedAt: 20, afterFrame: frame(2) }),
      step({ id: 'c', target: 'Save', status: 'done' }),
    ]);
    expect(rates).toEqual([{ target: 'Save', attempts: 2, verifiedSuccesses: 1, verifiedFailures: 1, successPercent: 50, confidence: 'low' }]);
  });

  it('creates prospect points for missed commands and moving elements', () => {
    const audits = auditCommands([step({ name: 'Save', target: 'Save', status: 'failed' })]);
    const points = prospectPoints([element('Save', 0.4, 0.3, 'moved')], [], audits);
    expect(points[0]).toMatchObject({ priority: 'high', reason: expect.stringContaining('failed') });
    expect(points.some(p => p.reason.includes('Reconfirm Save'))).toBe(true);
  });
});
