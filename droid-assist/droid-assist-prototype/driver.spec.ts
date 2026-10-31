import { describe, expect, it } from 'vitest';
import { BOSS, drivingFlag, drivingLine, enqueueSuggestion, handWheel, isDriving, isSimultaneous, newDriving, suggestionLine, takeSuggestion, takeWheel } from './driver.js';

describe('driving', () => {
  it('starts with droid-new driving, because it is the boss', () => {
    const d = newDriving(1000);
    expect(d.driver).toBe(BOSS);
    expect(d.since).toBe(1000);
    expect(isDriving(d, 'droid-new')).toBe(true);
    expect(isDriving(d, 'droid-main')).toBe(false);
  });

  it('passes the wheel to droid-main on a handoff and back on a take-back', () => {
    const handed = handWheel('took over step 1', 2000);
    expect(handed.driver).toBe('droid-main');
    expect(takeWheel('droid-new took it back', 3000).driver).toBe('droid-new');
  });

  it('treats a command from the non-driving app as simultaneous', () => {
    const d = newDriving(1);
    expect(isSimultaneous(d, 'droid-main')).toBe(true);
    expect(isSimultaneous(d, 'droid-new')).toBe(false);
    expect(isSimultaneous(handWheel('handoff', 2), 'droid-new')).toBe(true);
  });

  it('names the driver in the UI flag and the log line', () => {
    expect(drivingFlag(newDriving(1))).toBe('Driving: droid-new');
    expect(drivingFlag(handWheel('handoff', 1))).toBe('Driving: droid-main');
    expect(drivingLine(handWheel('took over step 1', 1))).toContain('Now driving: droid-main');
  });
});

describe('suggestions', () => {
  it('queues a simultaneous command newest-first and never applies it', () => {
    const q = enqueueSuggestion([], 'pause', undefined, 'stop for a second', 10);
    const q2 = enqueueSuggestion(q, 'mode', 'background', 'switch mode', 20);
    expect(q2).toHaveLength(2);
    expect(q2[0].command).toBe('mode');
    expect(q2[0].mode).toBe('background');
    expect(q2[1].command).toBe('pause');
    expect(q2[0].from).toBe('droid-main');
  });

  it('takes one suggestion out by id, leaving the rest', () => {
    const q = enqueueSuggestion(enqueueSuggestion([], 'pause', undefined, '', 10), 'stop', undefined, '', 20);
    const { queue, taken } = takeSuggestion(q, q[0].id);
    expect(taken?.command).toBe('stop');
    expect(queue).toHaveLength(1);
    expect(queue[0].command).toBe('pause');
  });

  it('returns null when the id is unknown', () => {
    expect(takeSuggestion(enqueueSuggestion([], 'pause', undefined, '', 10), 'nope').taken).toBeNull();
  });

  it('names the suggestion in the log line', () => {
    const q = enqueueSuggestion([], 'mode', 'app', 'user asked', 10);
    const line = suggestionLine(q[0]);
    expect(line).toContain('droid-main suggested "mode → app"');
    expect(line).toContain('queued for droid-new');
    expect(line).toContain('user asked');
  });
});
