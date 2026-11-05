import { describe, expect, it } from 'vitest';
import { ATTRACT_STEP, SETTLE_TICKS, approach, direction, radarStatus, radarStatusText, radarTick, startRadar, type RadarState } from './radar.js';

const W = 1920;
const H = 1080;

describe('direction', () => {
  it('names the 8-way screen direction (y grows downward)', () => {
    expect(direction(100, 0)).toBe('right');
    expect(direction(0, 100)).toBe('down');
    expect(direction(-100, -100)).toBe('up-left');
    expect(direction(0, 0)).toBe('on target');
  });
});

describe('approach', () => {
  it('takes at most one capped step, never past the target', () => {
    const p = approach({ x: 0, y: 0 }, { x: 0.6, y: 0 });
    expect(p.x).toBeCloseTo(ATTRACT_STEP);
    expect(approach({ x: 0.5, y: 0.5 }, { x: 0.52, y: 0.5 })).toEqual({ x: 0.52, y: 0.5 });
  });
});

describe('radarTick', () => {
  const start = () => startRadar({ name: 'Bird', x: 0.5, y: 0.5, action: 'click' });

  it('pulses live distance and direction when close', () => {
    const { event } = radarTick(start(), { x: 0.45, y: 0.5 }, { x: 0.5, y: 0.5 }, W, H);
    expect(event).toMatchObject({ kind: 'pulse', distancePx: 96, direction: 'right' });
  });

  it('attracts with a slow capped step when far', () => {
    const { event } = radarTick(start(), { x: 0.1, y: 0.5 }, { x: 0.7, y: 0.5 }, W, H);
    expect(event.kind).toBe('attract');
    if (event.kind === 'attract') expect(event.to.x).toBeCloseTo(0.1 + ATTRACT_STEP);
  });

  it('follows a moving target, then settles once it stops: adjusted move then the action', () => {
    let s: RadarState = start();
    const cursor = { x: 0.5, y: 0.5 };
    const path = [0.5, 0.51, 0.52, 0.53];
    for (const x of path) {
      const r = radarTick(s, cursor, { x, y: 0.5 }, W, H);
      expect(r.event.kind).toBe('pulse');
      s = r.state;
    }
    const kinds: string[] = [];
    for (let i = 0; i < SETTLE_TICKS; i++) {
      const r = radarTick(s, cursor, { x: 0.53, y: 0.5 }, W, H);
      kinds.push(r.event.kind);
      s = r.state;
      if (r.event.kind === 'settle') expect(r.event).toMatchObject({ to: { x: 0.53, y: 0.5 }, action: 'click' });
    }
    expect(kinds).toEqual([...Array(SETTLE_TICKS - 1).fill('pulse'), 'settle']);
  });

  it('aims pulses at where an in-motion target will be on the next capture', () => {
    const cursor = { x: 0.5, y: 0.5 };
    const first = radarTick(start(), cursor, { x: 0.5, y: 0.5 }, W, H, 1000);
    const { event } = radarTick(first.state, cursor, { x: 0.52, y: 0.5 }, W, H, 1250);
    expect(event).toMatchObject({ kind: 'pulse', direction: 'right', distancePx: Math.round(0.04 * W) });
    if (event.kind === 'pulse') expect(event.predicted!.x).toBeCloseTo(0.54);
  });

  it('attracts toward the predicted point of a fast target, not its last sighting', () => {
    const cursor = { x: 0.1, y: 0.5 };
    const first = radarTick(start(), cursor, { x: 0.7, y: 0.3 }, W, H, 0);
    const { event } = radarTick(first.state, cursor, { x: 0.7, y: 0.4 }, W, H, 500);
    expect(event.kind).toBe('attract');
    if (event.kind === 'attract') {
      expect(event.predicted).toEqual({ x: expect.closeTo(0.7), y: expect.closeTo(0.5) });
      expect(event.to.y).toBeCloseTo(0.5);
      expect(event.to.x).toBeCloseTo(0.1 + ATTRACT_STEP);
    }
  });
});

describe('radarStatus', () => {
  const t = { name: 'Bird', x: 0.5, y: 0.5, action: 'click' as const };

  it('has all four parts and names the latest AI response', () => {
    const { event } = radarTick(startRadar(t), { x: 0.45, y: 0.5 }, { x: 0.5, y: 0.5 }, W, H);
    const s = radarStatus(t, event, ['Identified "Bird" at E7', 'older']);
    const text = radarStatusText(s);
    expect(text).toMatch(/Doing: .+ · Could be doing: .+ · Doing wrong: .+ · Better next: .+/);
    expect(s.next).toContain('Identified "Bird" at E7');
  });

  it('calls out a recent prose / failed response as what is going wrong', () => {
    const { event } = radarTick(startRadar(t), { x: 0.1, y: 0.5 }, { x: 0.7, y: 0.5 }, W, H);
    expect(radarStatus(t, event, ['AI reply was not a JSON object: no {...} object found in the reply']).wrong).toContain('did not give a usable location');
  });
});
