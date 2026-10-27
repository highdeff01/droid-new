import { describe, expect, it, vi } from 'vitest';
import type { AskFn } from './ai.js';
import { SAMPLE_VIEW, systemText } from './ai.js';
import type { Frame } from './types.js';
import { findingProposal, scanScreen, scanSummary, type ScanResult } from './initiative-scan.js';

const frame = { id: 1, url: 'data:image/jpeg;base64,QUJD' } as Frame;
const ask = (reply: Record<string, unknown>, thinking: string | null = null): AskFn =>
  vi.fn(async () => ({ content: JSON.stringify(reply), thinking }));

describe('scanScreen', () => {
  it('sends json:true and the frame, with a system prompt naming the initiative scanner', async () => {
    const fn = ask({ findings: [] });
    await scanScreen(fn, frame, [], 'goal', []);
    const call = (fn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call).toMatchObject({ frame, json: true });
    expect(systemText(call.system, SAMPLE_VIEW)).toContain('initiative scanner');
  });

  it('keeps valid findings of kinds popup, changed and incomplete', async () => {
    const fn = ask({
      findings: [
        { kind: 'popup', text: 'A dialog is blocking the screen' },
        { kind: 'changed', text: 'The sidebar changed' },
        { kind: 'incomplete', text: 'A form was left half-filled' },
      ],
    });
    const result = await scanScreen(fn, frame, [], 'goal', []);
    expect(result.findings.map((f) => f.kind)).toEqual(['popup', 'changed', 'incomplete']);
  });

  it('attaches a click step at the resolved grid cell, with the target', async () => {
    const fn = ask({
      findings: [{ kind: 'popup', text: 'Close the dialog', action: 'click', target: 'Close button', cell: 'A1', cx: 0.5, cy: 0.5 }],
    });
    const result = await scanScreen(fn, frame, [], 'goal', []);
    expect(result.findings[0].step).toMatchObject({ action: 'click', target: 'Close button', x: 1 / 24, y: 1 / 16 });
  });

  it('drops a finding with an unknown kind', async () => {
    const fn = ask({ findings: [{ kind: 'bogus', text: 'should be dropped' }] });
    const result = await scanScreen(fn, frame, [], 'goal', []);
    expect(result.findings).toEqual([]);
  });

  it('drops a finding with blank text', async () => {
    const fn = ask({ findings: [{ kind: 'popup', text: '   ' }] });
    const result = await scanScreen(fn, frame, [], 'goal', []);
    expect(result.findings).toEqual([]);
  });

  it('drops the step for a type action with no input', async () => {
    const fn = ask({
      findings: [{ kind: 'incomplete', text: 'Field needs a value', action: 'type', target: 'Name field', cell: 'A1', cx: 0.5, cy: 0.5 }],
    });
    const result = await scanScreen(fn, frame, [], 'goal', []);
    expect(result.findings[0].step).toBeUndefined();
  });

  it('returns nextScanSec when next_scan_sec is a positive number', async () => {
    const fn = ask({ findings: [], next_scan_sec: 15 });
    const result = await scanScreen(fn, frame, [], 'goal', []);
    expect(result.nextScanSec).toBe(15);
  });

  it('omits nextScanSec when next_scan_sec is absent or not positive', async () => {
    const fn = ask({ findings: [], next_scan_sec: 0 });
    const result = await scanScreen(fn, frame, [], 'goal', []);
    expect(result.nextScanSec).toBeUndefined();
  });
});

describe('findingProposal', () => {
  it('is category scan with text "[kind] text"', () => {
    const p = findingProposal({ kind: 'popup', text: 'A dialog appeared' });
    expect(p).toMatchObject({ category: 'scan', text: '[popup] A dialog appeared' });
  });

  it('carries the step over when the finding has one', () => {
    const step = { id: 's1', name: 'Scan: click "X"', action: 'click' as const, x: 0.1, y: 0.1, status: 'pending' as const };
    const p = findingProposal({ kind: 'changed', text: 'Something changed', step });
    expect(p.step).toBe(step);
  });

  it('omits step when the finding has none', () => {
    const p = findingProposal({ kind: 'incomplete', text: 'A state was left incomplete' });
    expect(p.step).toBeUndefined();
  });
});

describe('scanSummary', () => {
  it('mentions the finding count', () => {
    const r: ScanResult = { findings: [{ kind: 'popup', text: 'x' }, { kind: 'changed', text: 'y' }], thinking: null };
    expect(scanSummary(r)).toContain('2 finding');
  });

  it('mentions the next scan seconds when present', () => {
    const r: ScanResult = { findings: [], thinking: null, nextScanSec: 20 };
    expect(scanSummary(r)).toContain('20s');
  });
});
