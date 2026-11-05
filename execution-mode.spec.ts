import { describe, expect, it } from 'vitest';
import {
  AI_MODES,
  DEFAULT_EXECUTION_MODE,
  EXECUTION_MODES,
  MODE_IDS,
  modeCaptureMs,
  modeChangeText,
  modeStatus,
  resolveAiDirective,
  sanitizeMode,
} from './execution-mode.js';

describe('sanitizeMode', () => {
  it.each(['parallel', 'thoughtful', 'aggressive', 'watching', 'reacting', 'tracking'] as const)(
    'keeps a known mode %s',
    (mode) => {
      expect(sanitizeMode(mode)).toBe(mode);
    },
  );

  it.each([undefined, 42, 'turbo', '', null])('falls back to the default for %p', (value) => {
    expect(sanitizeMode(value)).toBe(DEFAULT_EXECUTION_MODE);
    expect(sanitizeMode(value)).toBe('thoughtful');
  });
});

describe('MODE_IDS and AI_MODES', () => {
  it('MODE_IDS lists all six execution modes', () => {
    expect(MODE_IDS).toEqual(['parallel', 'thoughtful', 'aggressive', 'watching', 'reacting', 'tracking']);
  });

  it('AI_MODES excludes aggressive and includes the other five', () => {
    expect(AI_MODES).not.toContain('aggressive');
    expect(AI_MODES).toEqual(expect.arrayContaining(['parallel', 'thoughtful', 'watching', 'reacting', 'tracking']));
    expect(AI_MODES).toHaveLength(5);
  });
});

describe('EXECUTION_MODES profiles', () => {
  it('thoughtful is the pre-existing behaviour', () => {
    expect(EXECUTION_MODES.thoughtful).toMatchObject({ stepGapMs: 1500, crew: 1, grounding: 'plan' });
  });

  it('parallel splits work across a larger, faster crew', () => {
    expect(EXECUTION_MODES.parallel.crew).toBe(3);
    expect(EXECUTION_MODES.parallel.stepGapMs).toBeLessThan(EXECUTION_MODES.thoughtful.stepGapMs);
  });

  it('aggressive acts immediately and is not AI-settable', () => {
    expect(EXECUTION_MODES.aggressive.grounding).toBe('immediate');
    expect(EXECUTION_MODES.aggressive.aiSettable).toBe(false);
  });

  it('watching paces slower than thoughtful', () => {
    expect(EXECUTION_MODES.watching.stepGapMs).toBeGreaterThan(EXECUTION_MODES.thoughtful.stepGapMs);
  });

  it('tracking saves element proposals as they are seen', () => {
    expect(EXECUTION_MODES.tracking.trackElements).toBe(true);
  });
});

describe('modeCaptureMs', () => {
  it('leaves thoughtful unchanged at its base factor', () => {
    expect(modeCaptureMs('thoughtful', 500)).toBe(500);
  });

  it('scales watching cadence by its factor', () => {
    expect(modeCaptureMs('watching', 500)).toBe(2000);
  });

  it('clamps watching to the maximum capture interval', () => {
    expect(modeCaptureMs('watching', 1000)).toBe(2000);
  });

  it('clamps reacting to the minimum capture interval', () => {
    expect(modeCaptureMs('reacting', 400)).toBe(250);
  });

  it('scales watching cadence within range', () => {
    expect(modeCaptureMs('watching', 300)).toBe(1200);
  });
});

describe('modeChangeText', () => {
  it('names the actor, both mode labels and the reason when the AI switches', () => {
    const text = modeChangeText('thoughtful', 'watching', 'user is watching a movie', 'ai');
    expect(text).toContain('AI');
    expect(text).toContain('Thoughtful');
    expect(text).toContain('Watching');
    expect(text).toContain('user is watching a movie');
  });

  it('starts with "User" when the user switches', () => {
    const text = modeChangeText('thoughtful', 'watching', 'user is watching a movie', 'user');
    expect(text.startsWith('User')).toBe(true);
  });
});

describe('modeStatus', () => {
  it('shows just the mode label with no last change', () => {
    const status = modeStatus('parallel', null);
    expect(status).toContain('Parallel / fast');
    expect(status).not.toContain('last change');
  });

  it('includes the last change text when there was one', () => {
    const status = modeStatus('parallel', 'user is watching a movie');
    expect(status).toContain('user is watching a movie');
  });
});

describe('resolveAiDirective', () => {
  it('accepts a known, AI-settable mode different from the current one', () => {
    expect(resolveAiDirective('thoughtful', { mode: 'watching', reason: 'movie' })).toEqual({
      kind: 'accepted',
      mode: 'watching',
      reason: 'movie',
    });
  });

  it('treats a directive for the current mode as a no-op', () => {
    expect(resolveAiDirective('thoughtful', { mode: 'thoughtful', reason: '' })).toEqual({ kind: 'same' });
  });

  it('rejects a mode the AI may not set', () => {
    const result = resolveAiDirective('thoughtful', { mode: 'aggressive', reason: '' });
    expect(result.kind).toBe('rejected');
    expect((result as { text: string }).text).toMatch(/rejected/);
  });

  it('rejects an unknown mode', () => {
    const result = resolveAiDirective('thoughtful', { mode: 'warp', reason: '' });
    expect(result.kind).toBe('rejected');
    expect((result as { text: string }).text).toContain('warp');
  });
});
