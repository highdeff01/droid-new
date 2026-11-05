import { describe, expect, it } from 'vitest';
import { AUTO_RECALIBRATE_AFTER, remapMeasurement, remapStep, runMeasureQuery, tallyGrounding, type SavedMeasurement } from './use-measure.js';
import { measurePath } from './ruler.js';
import type { Calibration } from './calibration.js';
import type { MappedElement } from './element-map.js';
import type { Frame, WorkflowStep } from './types.js';

const frame = (srcW: number, srcH: number): Frame => ({ id: 1, time: 0, url: '', data: {} as ImageData, srcW, srcH, source: 'desktop' });
const map: MappedElement[] = [
  { name: 'Files icon', x: 0.1, y: 0.2, origin: 'annotation' },
  { name: 'Game icon', x: 0.4, y: 0.6, origin: 'flow' },
];
const doubled: Calibration = { method: 'pair', scaleX: 2, scaleY: 2, from: { x: 0.1, y: 0.1 }, to: { x: 0.1, y: 0.1 }, resolutionChanged: false, drift: true, detail: '' };

describe('runMeasureQuery', () => {
  it('measures between two named elements in native pixels of the live frame', () => {
    const r = runMeasureQuery('files icon to game icon', map, frame(1000, 500));
    expect(r.labels).toEqual(['Files icon', 'Game icon']);
    expect(r.measurement.segments[0]).toMatchObject({ dxPx: 300, dyPx: 200, px: 361 });
    expect(r.measurement.totalPx).toBe(361);
    expect(r.line).toContain('Files icon → Game icon');
  });

  it('measures element to edge and a three-point polyline total', () => {
    const edge = runMeasureQuery('Game icon to right edge', map, frame(1000, 500));
    expect(edge.measurement.totalPx).toBe(600);
    const path = runMeasureQuery('0,0 to 300,0 to 300,400', map, frame(1000, 500));
    expect(path.measurement.segments.map((s) => s.px)).toEqual([300, 400]);
    expect(path.measurement.totalPx).toBe(700);
  });

  it('throws loudly naming an unknown element instead of inventing a point', () => {
    expect(() => runMeasureQuery('Files icon to Trash', map, frame(1000, 500))).toThrow(/Unknown element "Trash".*no coordinate invented/);
  });
});

describe('remapStep / remapMeasurement', () => {
  it('rescales a step target and its corrected target around the anchor', () => {
    const s: WorkflowStep = { id: 's', name: 'x', action: 'click', x: 0.2, y: 0.3, correctedX: 0.3, correctedY: 0.3, status: 'pending' };
    const r = remapStep(doubled, s);
    expect(r.x).toBeCloseTo(0.3);
    expect(r.y).toBeCloseTo(0.5);
    expect(r.correctedX).toBeCloseTo(0.5);
  });

  it('leaves a step without a corrected target uncorrected', () => {
    const r = remapStep(doubled, { id: 's', name: 'x', action: 'move', x: 0.1, y: 0.1, status: 'pending' });
    expect(r.correctedX).toBeUndefined();
  });

  it('re-measures a saved measurement on the live screen size', () => {
    const measurement = measurePath([{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }], 1000, 500);
    const saved: SavedMeasurement = { id: 'm', by: 'You', labels: [], measurement, line: '' };
    const r = remapMeasurement(doubled, saved, frame(2000, 1000));
    expect(r.measurement.totalPx).toBe(400);
    expect(r.line).toContain('400px');
  });
});

describe('tallyGrounding', () => {
  it(`triggers once after ${AUTO_RECALIBRATE_AFTER} consecutive failures and resets`, () => {
    const first = tallyGrounding(0, { ok: false });
    expect(first).toEqual({ count: 1, trigger: false });
    expect(tallyGrounding(first.count, { ok: false })).toEqual({ count: 0, trigger: true });
  });

  it('resets on success and ignores halted (refused) steps', () => {
    expect(tallyGrounding(1, { ok: true })).toEqual({ count: 0, trigger: false });
    expect(tallyGrounding(1, { ok: false, halt: true })).toEqual({ count: 1, trigger: false });
  });
});
