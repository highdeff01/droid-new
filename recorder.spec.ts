import { describe, expect, it } from 'vitest';
import { MAX_STEP_DELAY_MS, continuesScroll, keyCombo, keyStep, scrollDirection, scrollStep, stepDelay } from './recorder.js';

const key = (k: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) => ({ key: k, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

describe('keyCombo', () => {
  it('names a plain key the way pyautogui presses it', () => {
    expect(keyCombo(key('Tab'))).toBe('tab');
    expect(keyCombo(key('ArrowLeft'))).toBe('left');
    expect(keyCombo(key('F5'))).toBe('f5');
    expect(keyCombo(key('Q'))).toBe('q');
  });

  it('prefixes held modifiers in hotkey order', () => {
    expect(keyCombo(key('S', { shiftKey: true, ctrlKey: true }))).toBe('ctrl+shift+s');
    expect(keyCombo(key('Delete', { altKey: true, ctrlKey: true }))).toBe('ctrl+alt+delete');
    expect(keyCombo(key('d', { metaKey: true }))).toBe('win+d');
  });

  it('ignores modifier-only presses and keys pyautogui cannot press', () => {
    expect(keyCombo(key('Shift', { shiftKey: true }))).toBeNull();
    expect(keyCombo(key('Control', { ctrlKey: true }))).toBeNull();
    expect(keyCombo(key('Dead'))).toBeNull();
    expect(keyCombo(key('Unidentified'))).toBeNull();
  });
});

describe('recorded steps', () => {
  it('builds a key step carrying the combo', () => {
    expect(keyStep('k1', 'ctrl+z')).toMatchObject({ id: 'k1', action: 'key', text: 'ctrl+z', name: 'Press ctrl+z', status: 'pending' });
  });

  it('builds a scroll step at the wheel position with its direction', () => {
    expect(scrollStep('s1', 0.3, 0.7, -120)).toMatchObject({ action: 'scroll', x: 0.3, y: 0.7, text: 'up' });
    expect(scrollStep('s2', 0.3, 0.7, 53)).toMatchObject({ text: 'down', name: 'Scroll down' });
    expect(scrollDirection(-1)).toBe('up');
  });

  it('merges a same-direction wheel burst into one gesture only', () => {
    const last = scrollStep('s1', 0.5, 0.5, 100);
    expect(continuesScroll(last, 40, 120)).toBe(true);
    expect(continuesScroll(last, -40, 120)).toBe(false);
    expect(continuesScroll(last, 40, 900)).toBe(false);
    expect(continuesScroll(keyStep('k', 'enter'), 40, 10)).toBe(false);
    expect(continuesScroll(undefined, 40, 10)).toBe(false);
  });
});

describe('stepDelay', () => {
  it('measures the human pause and caps a long one', () => {
    expect(stepDelay(10_730, 10_000)).toBe(730);
    expect(stepDelay(5, 10)).toBe(0);
    expect(stepDelay(100_000, 0)).toBe(MAX_STEP_DELAY_MS);
  });
});
