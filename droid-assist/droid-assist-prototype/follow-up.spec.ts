import { describe, expect, it } from 'vitest';
import { followUpText, runFollowUp, MAX_FOLLOW_UP_PASSES, type CheckResult } from './follow-up.js';

interface Item {
  id: string;
  label: string;
}

const items: Item[] = [
  { id: 'a', label: 'Slide A' },
  { id: 'b', label: 'Slide B' },
  { id: 'c', label: 'Slide C' },
];

describe('runFollowUp', () => {
  it('re-checks only the item that failed on pass 1 and resolves it on pass 2', async () => {
    const attempts: Record<string, number> = {};
    const check = async (item: Item): Promise<CheckResult> => {
      attempts[item.id] = (attempts[item.id] ?? 0) + 1;
      if (item.id === 'b' && attempts[item.id] === 1) return { ok: false, reason: 'not ready' };
      return { ok: true, reason: 'ok' };
    };
    const report = await runFollowUp(items, (i) => i.label, check);
    expect(report.done).toBe(true);
    expect(report.passes).toBe(2);
    expect(report.items.every((i) => i.state === 'verified')).toBe(true);
    expect(report.items.find((i) => i.id === 'b')?.attempts).toBe(2);
    expect(report.items.find((i) => i.id === 'a')?.attempts).toBe(1);
    expect(report.items.find((i) => i.id === 'c')?.attempts).toBe(1);
  });

  it('stops at MAX_FOLLOW_UP_PASSES when an item always fails', async () => {
    const check = async (): Promise<CheckResult> => ({ ok: false, reason: 'never ready' });
    const report = await runFollowUp([{ id: 'x', label: 'X' }], (i) => i.label, check);
    expect(report.passes).toBe(MAX_FOLLOW_UP_PASSES);
    expect(report.done).toBe(false);
    expect(report.items[0].state).toBe('unresolved');
  });

  it('counts a throwing check as a failure with reason "check failed"', async () => {
    const check = async (): Promise<CheckResult> => {
      throw new Error('boom');
    };
    const report = await runFollowUp([{ id: 'x', label: 'X' }], (i) => i.label, check, 1);
    expect(report.items[0].state).toBe('unresolved');
    expect(report.items[0].reason).toContain('check failed');
  });

  it('an empty list has 0 passes and is done', async () => {
    const check = async (): Promise<CheckResult> => ({ ok: true, reason: 'ok' });
    const report = await runFollowUp([], (i: Item) => i.label, check);
    expect(report.passes).toBe(0);
    expect(report.done).toBe(true);
  });
});

describe('followUpText', () => {
  it('says nothing left to do when done', async () => {
    const check = async (): Promise<CheckResult> => ({ ok: true, reason: 'ok' });
    const report = await runFollowUp(items, (i) => i.label, check);
    expect(followUpText('My Deck', report)).toContain('nothing left to do');
  });

  it('lists the unresolved labels when not done', async () => {
    const check = async (): Promise<CheckResult> => ({ ok: false, reason: 'broken' });
    const report = await runFollowUp([{ id: 'a', label: 'Slide A' }], (i) => i.label, check, 1);
    const text = followUpText('My Deck', report);
    expect(text).toContain('"Slide A": broken');
    expect(text).not.toContain('nothing left to do');
  });
});
