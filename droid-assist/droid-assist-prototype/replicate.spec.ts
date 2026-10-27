import { describe, expect, it } from 'vitest';
import type { Frame } from './types.js';
import { extractReplica, parseReplicaNaming, replicaLine, replicaToFamiliar, replicaToMapped, replicateRequest } from './replicate.js';

/** A 20x10 buffer of `bg` with the right half painted `fg`. */
function buffer(bg: [number, number, number], fg: [number, number, number]): ImageData {
  const w = 20;
  const h = 10;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...(x >= 10 ? fg : bg), 255], (y * w + x) * 4);
  return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData;
}
const frame: Frame = { id: 1, time: 0, url: 'data:image/jpeg;base64,QUJD', data: buffer([0, 0, 0], [255, 0, 0]), srcW: 1600, srcH: 900, source: 'desktop' };
const CROP = 'data:image/jpeg;base64,Q1JPUA==';

describe('extractReplica', () => {
  it('extracts crop, native size, bounds, colours and text of the region', () => {
    const r = extractReplica(frame, { x: 0.5, y: 0.2, w: 0.25, h: 0.5 }, CROP, '  Red button ', ' Buy ', 42);
    expect(r).toMatchObject({ name: 'Red button', crop: CROP, text: 'Buy', time: 42, size: { w: 400, h: 450 }, bounds: { x0: 800, y0: 180, x1: 1200, y1: 630 } });
    expect(r.colors.mean).toBe('#ff0000');
    expect(r.colors.dominantShare).toBe(1);
    expect(r.colors.contrast).toBe(0);
  });

  it('names an unnamed replica generically', () => {
    expect(extractReplica(frame, { x: 0, y: 0, w: 0.1, h: 0.1 }, CROP, ' ').name).toBe('Replicated element');
  });
});

describe('replica as memory', () => {
  const r = extractReplica(frame, { x: 0.5, y: 0.2, w: 0.25, h: 0.5 }, CROP, 'Red button', '', 7);
  it('becomes a mapped element with its boundary and a familiar element at its centre with the crop patch', () => {
    expect(replicaToMapped(r)).toEqual({ id: r.id, name: 'Red button', box: r.box, mappedAt: 7 });
    expect(replicaToMapped(r, frame).frame).toBe(frame);
    expect(replicaToFamiliar(r)).toEqual({ id: r.id, name: 'Red button', x: 0.625, y: 0.45, patch: CROP, lastSeen: 7 });
  });
  it('describes itself in one briefing line', () => {
    expect(replicaLine(r)).toBe('[Replica] "Red button" 400x450px at (800, 180)..(1200, 630)px, colours mean #ff0000 dominant #fc0404 (100%), contrast 0.000');
  });
});

describe('AI naming', () => {
  it('sends the crop and reads the name and text, falling back to the hint', () => {
    const crop = { ...frame, url: CROP };
    expect(replicateRequest(crop, 'the buy button')).toMatchObject({ frame: crop, json: true, prompt: 'The element to replicate: the buy button' });
    expect(parseReplicaNaming({ content: '{"name":"Buy button","text":"Buy now"}', thinking: null }, 'hint')).toEqual({ name: 'Buy button', text: 'Buy now' });
    expect(parseReplicaNaming({ content: '{"name":"","text":3}', thinking: null }, ' buy ')).toEqual({ name: 'buy', text: '' });
  });
});
