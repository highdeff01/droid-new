import { describe, expect, it, vi } from 'vitest';
import {
  FAIL_THRESHOLD,
  MAX_FIX_STEPS,
  failureKey,
  fixMethodFor,
  fixScriptText,
  generateFixScript,
  needsFix,
  noteResult,
  parseFixScript,
  saveFixMethod,
  type FixContext,
  type FixScript,
} from './fix-script.js';
import type { AskFn } from './ai.js';

const ctx: FixContext = { element: 'Export button', flow: 'Export report', problem: 'element not found' };
const reply = (body: unknown): AskFn => vi.fn(async () => ({ content: JSON.stringify(body), thinking: null }));

/** A fix script the model proposed for `ctx`. */
async function aiScript(): Promise<FixScript> {
  const s = await generateFixScript(ctx, [], reply({ reason: 'reopen', steps: [{ action: 'key', text: 'Escape', name: 'Dismiss' }, { action: 'wait', name: 'Settle' }] }), null);
  if (!s) throw new Error('expected an AI fix script');
  return s;
}

describe('failure counting', () => {
  it('needs a fix after FAIL_THRESHOLD consecutive failures and resets on success', () => {
    const k = failureKey('Export Button', 'export report');
    expect(k).toBe(failureKey('export button', 'Export Report'));
    let c = noteResult({}, k, false);
    expect(needsFix(c, k)).toBe(false);
    c = noteResult(c, k, true);
    c = noteResult(c, k, false);
    expect(needsFix(c, k)).toBe(false);
    c = noteResult(c, k, false);
    expect(FAIL_THRESHOLD).toBe(2);
    expect(needsFix(c, k)).toBe(true);
    expect(needsFix(noteResult(c, k, true), k)).toBe(false);
  });
});

describe('parseFixScript bounds', () => {
  it('keeps only click/type/key/wait and at most MAX_FIX_STEPS steps', () => {
    const steps = [
      { action: 'drag', name: 'nope' },
      { action: 'open_app', name: 'nope' },
      ...Array.from({ length: 14 }, (_, i) => ({ action: i % 2 ? 'wait' : 'key', text: 'Escape', name: `s${i}` })),
    ];
    const r = parseFixScript(JSON.stringify({ reason: 'r', steps }));
    expect(r.steps).toHaveLength(MAX_FIX_STEPS);
    expect(MAX_FIX_STEPS).toBe(10);
    expect(r.steps.every((s) => ['click', 'type', 'key', 'wait'].includes(s.action))).toBe(true);
  });
  it('reads click points as pixels of the 480x270 view and drops clicks without a point', () => {
    const r = parseFixScript('ok {"steps":[{"action":"click","target":"Menu","x":240,"y":135},{"action":"click","target":"Nowhere"},{"action":"type","text":"hi"}]}');
    expect(r.steps).toHaveLength(2);
    expect(r.steps[0]).toMatchObject({ action: 'click', target: 'Menu', x: 0.5, y: 0.5 });
    expect(r.steps[1]).toMatchObject({ action: 'type', text: 'hi' });
  });
});

describe('generateFixScript', () => {
  it('uses the model script when it answers', async () => {
    const s = await aiScript();
    expect(s.source).toBe('ai');
    expect(s.steps).toHaveLength(2);
  });
  it('proposes nothing — no canned template — when the model fails, answers nothing usable, or is off', async () => {
    const failing: AskFn = vi.fn(async () => { throw new Error('down'); });
    expect(await generateFixScript(ctx, [], failing, null)).toBeNull();
    expect(await generateFixScript(ctx, [], reply({ steps: [{ action: 'drag' }] }), null)).toBeNull();
    expect(await generateFixScript(ctx, [], null, null)).toBeNull();
  });
  it('offers a saved fix method of the same element and flow first, without asking the model', async () => {
    const methods = saveFixMethod([], await aiScript(), true, 1);
    const ask = reply({ steps: [] });
    const s = await generateFixScript({ ...ctx, element: 'EXPORT BUTTON', flow: 'export REPORT' }, methods, ask, null);
    expect(s?.source).toBe('memory');
    expect(ask).not.toHaveBeenCalled();
    expect(s?.steps.map((x) => x.id)).not.toEqual(methods[0].steps.map((x) => x.id));
  });
  it('uses a saved fix method even when the model is off', async () => {
    const methods = saveFixMethod([], await aiScript(), true, 1);
    expect((await generateFixScript(ctx, methods, null, null))?.source).toBe('memory');
  });
});

describe('fix methods', () => {
  it('saves only a script that worked and counts later uses against the same key', async () => {
    const script = await aiScript();
    expect(saveFixMethod([], script, false)).toEqual([]);
    let m = saveFixMethod([], script, true, 1);
    m = saveFixMethod(m, { ...script, context: { ...ctx, flow: 'EXPORT REPORT' } }, false, 2);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ uses: 2, successes: 1, element: 'Export button' });
    expect(fixMethodFor(m, 'export button', 'other flow')).toBeNull();
    expect(fixScriptText(script)).toContain('ai fix for "Export button"');
  });
});
