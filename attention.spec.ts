import { describe, expect, it } from 'vitest';
import { IDLE_ATTENTION, focusOn, isPopupEntry, isPopupLine, scopeLines } from './attention.js';

describe('popup quarantine', () => {
  it('recognises popup lines by source or message, in any case', () => {
    expect(isPopupLine('[Popup watcher] New content appeared')).toBe(true);
    expect(isPopupLine('[Auto-Actor] Close POP-UP (ad): clicked')).toBe(true);
    expect(isPopupLine('[Drift monitor] sync green')).toBe(false);
    expect(isPopupEntry({ source: 'Screen-change responder', message: 'Change at (1%, 2%): [popup] an ad' })).toBe(true);
    expect(isPopupEntry({ source: 'You', message: 'clicked Save' })).toBe(false);
  });

  it('keeps popup lines for the popup stage only', () => {
    const lines = ['[Popup watcher] Popup gone', '[Drift monitor] Sync red', '[AI help] Popups cleared'];
    expect(scopeLines(lines, 'planner')).toEqual(['[Drift monitor] Sync red']);
    expect(scopeLines(lines, 'supervisor')).toEqual(['[Drift monitor] Sync red']);
    expect(scopeLines(lines, 'popup')).toEqual(lines);
  });
});

describe('focusOn', () => {
  it('moves the focus and stamps when it moved', () => {
    expect(focusOn(IDLE_ATTENTION, 'Grounding "Save"', 'AI', 7)).toEqual({ focus: 'Grounding "Save"', source: 'AI', since: 7 });
  });

  it('keeps the since-time while the focus stays the same', () => {
    const a = focusOn(IDLE_ATTENTION, 'Point out', 'Point-out auto-run', 3);
    expect(focusOn(a, 'Point out', 'Point-out auto-run', 9)).toBe(a);
    expect(focusOn(a, 'Point out', 'AI', 9).since).toBe(9);
  });
});
