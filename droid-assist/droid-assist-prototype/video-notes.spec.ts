import { describe, expect, it } from 'vitest';
import { addNote, notableMoment, timestamp, toKnowledge } from './video-notes.js';
import { startSession } from './video-notes.js';
import type { Frame } from './types.js';

const frame = (fill: number): Frame => {
  const data = (typeof ImageData !== 'undefined'
    ? new ImageData(320, 180)
    : { data: new Uint8ClampedArray(320 * 180 * 4), width: 320, height: 180 }) as ImageData;
  data.data.fill(fill);
  return { id: 1, time: 0, url: 'data:image/jpeg;base64,' + 'A'.repeat(40), data, srcW: 1920, srcH: 1080, source: 'demo' };
};

describe('addNote', () => {
  it('offsets are now-started and never decrease even when now goes backwards', () => {
    const s = startSession('Movie', 1000);
    const s1 = addNote(s, 'first', 1500);
    expect(s1.notes[0].offsetMs).toBe(500);
    const s2 = addNote(s1, 'second', 900);
    expect(s2.notes[1].offsetMs).toBe(500);
  });

  it('keeps a screenshot only when given', () => {
    const s = startSession('Movie', 1000);
    const withShot = addNote(s, 'note', 2000, 'data:image/jpeg;base64,x');
    expect(withShot.notes[0].screenshot).toBe('data:image/jpeg;base64,x');
    const withoutShot = addNote(s, 'note', 2000);
    expect(withoutShot.notes[0].screenshot).toBeUndefined();
  });
});

describe('notableMoment', () => {
  it('false for first frame (prev null)', () => {
    expect(notableMoment(null, frame(100))).toBe(false);
  });

  it('false for identical frames', () => {
    expect(notableMoment(frame(100), frame(100))).toBe(false);
  });

  it('true for very different pixel buffers', () => {
    expect(notableMoment(frame(0), frame(255))).toBe(true);
  });
});

describe('timestamp', () => {
  it('65000 -> 1:05', () => {
    expect(timestamp(65000)).toBe('1:05');
  });
});

describe('toKnowledge', () => {
  it("maps a session to a kind 'video' entry with its notes", () => {
    const s = addNote(startSession('Movie', 1000), 'note', 1500);
    const entry = toKnowledge(s);
    expect(entry).toMatchObject({ id: s.id, kind: 'video', title: 'Movie', time: 1000, notes: s.notes });
  });
});
