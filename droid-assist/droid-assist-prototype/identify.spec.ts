import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Frame } from './types.js';
import { CHANGE_HITS, IDENTIFY_SYSTEM, characteristics, identifyAndVerify, identifyRequest, iou, mappedDistances, noteChange, parseIdentification, recentlySent, regionStats, type IdentifyInput, type IdentifyLoop } from './identify.js';
import type { MappedElement } from './element-map.js';

/** A w x h buffer filled with one colour, with an optional coloured rectangle (pixel coords). */
function buffer(w: number, h: number, bg: [number, number, number], rect?: { x: number; y: number; w: number; h: number; c: [number, number, number] }): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inRect = rect && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      const c = inRect ? rect.c : bg;
      data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
    }
  }
  return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData;
}

const frame = (data: ImageData): Frame => ({ id: 1, time: 0, url: 'data:image/jpeg;base64,QUJD', data, srcW: 1920, srcH: 1080, source: 'screen' });
const mapped = (name: string, x: number, y: number): MappedElement => ({ id: name, name, box: { x: x - 0.05, y: y - 0.05, w: 0.1, h: 0.1 }, mappedAt: 0 });

describe('regionStats', () => {
  it('measures mean, dominant colour share and contrast of the region', () => {
    const data = buffer(100, 100, [0, 0, 0], { x: 0, y: 0, w: 50, h: 100, c: [255, 0, 0] });
    const s = regionStats(data, { x: 0, y: 0, w: 1, h: 1 });
    expect(s.mean).toEqual([128, 0, 0]);
    expect(s.dominantShare).toBeCloseTo(0.5);
    expect(s.contrast).toBeGreaterThan(0.1);
    const flat = regionStats(data, { x: 0, y: 0, w: 0.4, h: 1 });
    expect(flat.mean).toEqual([255, 0, 0]);
    expect(flat.dominant).toEqual([252, 4, 4]);
    expect(flat.dominantShare).toBe(1);
    expect(flat.contrast).toBeCloseTo(0, 5);
  });
});

describe('identification request', () => {
  const data = buffer(320, 180, [16, 16, 16], { x: 160, y: 90, w: 32, h: 18, c: [0, 128, 255] });
  const input: IdentifyInput = {
    reason: 'new_element',
    box: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
    frame: frame(data),
    crop: { ...frame(data), url: 'data:image/jpeg;base64,Q1JPUA==' },
    mapped: [mapped('Far', 0.95, 0.95), mapped('Near', 0.5, 0.5)],
  };

  it('carries crop, boundary, size, colour, grid cells and distances nearest first; no text when none', () => {
    const req = identifyRequest(input);
    expect(req.system).toBe(IDENTIFY_SYSTEM);
    expect(req.frame?.url).toBe('data:image/jpeg;base64,Q1JPUA==');
    expect(req.json).toBe(true);
    expect(req.prompt).toContain('Boundary box: x=0.500, y=0.500, w=0.100, h=0.100');
    expect(req.prompt).toContain('(960, 540)px to (1152, 648)px');
    expect(req.prompt).toContain('Size: 192x108px on a 1920x1080 screen');
    expect(req.prompt).toContain('dominant #0484fc');
    expect(req.prompt).toContain('planner cell E7');
    expect(req.prompt).toContain('element-map cells R9C13..R10C15');
    expect(req.prompt.indexOf('"Near"')).toBeLessThan(req.prompt.indexOf('"Far"'));
    expect(req.prompt).not.toContain('Text / label');
  });

  it('includes the text when known and the feedback of a failed try', () => {
    const req = identifyRequest({ ...input, text: 'Play button', reason: 'not_clicked' }, 'no template match');
    expect(req.prompt).toContain('Text / label: "Play button"');
    expect(req.prompt).toContain('was not clicked');
    expect(req.prompt).toContain('Your previous proposal failed: no template match');
  });

  it('says plainly when nothing is mapped', () => {
    expect(characteristics({ ...input, mapped: [] }).join('\n')).toContain('none mapped yet');
  });

  it('measures pixel distances to mapped elements', () => {
    const d = mappedDistances({ x: 0.5, y: 0.5 }, [mapped('A', 0.6, 0.5), mapped('B', 0.5, 0.5)], 1000, 1000);
    expect(d.map((x) => [x.name, x.px, x.dxPx])).toEqual([['B', 0, 0], ['A', 100, 100]]);
  });
});

describe('parseIdentification', () => {
  it('resolves the grid point and keeps the thinking', () => {
    const r = parseIdentification({ content: '{"found":true,"name":"Play","cell":"A1","cx":0.5,"cy":0.5,"reason":"r"}', thinking: 'hmm' }, 'x');
    expect(r).toMatchObject({ found: true, name: 'Play', thinking: 'hmm' });
    if (r.found) expect(r.x).toBeCloseTo(1 / 24);
  });

  it('reports not found and rejects non-JSON', () => {
    expect(parseIdentification({ content: '{"found":false,"reason":"gone"}', thinking: null }, 'x')).toEqual({ found: false, reason: 'gone', thinking: null });
    expect(() => parseIdentification({ content: 'nope', thinking: null }, 'x')).toThrow();
  });
});

describe('identifyAndVerify', () => {
  afterEach(() => vi.useRealTimers());
  const found = { found: true as const, name: 'Play', x: 0.4, y: 0.4, reason: '', thinking: null };

  function loop(over: Partial<IdentifyLoop>): IdentifyLoop & { logs: string[] } {
    const logs: string[] = [];
    return { identify: vi.fn(async () => found), verify: vi.fn(async () => ({ ok: false as const, message: 'no match' })), aborted: () => false, log: (m) => logs.push(m), logs, ...over };
  }

  it('accepts the agent-corrected point, not the raw proposal', async () => {
    const l = loop({ verify: vi.fn(async () => ({ ok: true as const, x: 0.42, y: 0.43, message: 'ok' })) });
    expect(await identifyAndVerify(l)).toEqual({ verified: true, name: 'Play', x: 0.42, y: 0.43, tries: 1 });
  });

  it('stops after 3 failed tries, logs plainly and resolves unverified', async () => {
    const l = loop({});
    const out = await identifyAndVerify(l);
    expect(out).toMatchObject({ verified: false, tries: 3 });
    expect(l.identify).toHaveBeenCalledTimes(3);
    expect(l.logs.at(-1)).toMatch(/Could not find or verify the element after 3 tries \/ 30s/);
  });

  it('passes the failure back as feedback on the next try', async () => {
    const l = loop({});
    await identifyAndVerify(l);
    expect((l.identify as ReturnType<typeof vi.fn>).mock.calls[1][0]).toContain('failed the agent test: no match');
  });

  it('a model failure counts as a failed try and never throws', async () => {
    const l = loop({ identify: vi.fn(async () => { throw new Error('AI endpoint HTTP 500'); }) });
    const out = await identifyAndVerify(l);
    expect(out.verified).toBe(false);
    expect(l.verify).not.toHaveBeenCalled();
    expect(l.logs.some((m) => m.includes('AI endpoint HTTP 500'))).toBe(true);
  });

  it('stops at the 30 s window when a try hangs', async () => {
    vi.useFakeTimers();
    const l = loop({ identify: vi.fn(() => new Promise<never>(() => undefined)) });
    const p = identifyAndVerify(l);
    await vi.advanceTimersByTimeAsync(30_000);
    const out = await p;
    expect(out).toMatchObject({ verified: false, tries: 1 });
    expect(l.identify).toHaveBeenCalledTimes(1);
    expect(l.logs.at(-1)).toContain('giving up');
  });

  it('stops before the next try once aborted', async () => {
    let calls = 0;
    const l = loop({ aborted: () => calls >= 1, identify: vi.fn(async () => { calls++; return found; }) });
    const out = await identifyAndVerify(l);
    expect(l.identify).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ verified: false });
  });
});

describe('change tracking', () => {
  const box = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };

  it('reports a new region, then constant after repeated changes, once per streak', () => {
    let hits = noteChange([], box, 0);
    expect(hits.kind).toBe('new');
    for (let i = 1; i < CHANGE_HITS - 1; i++) {
      hits = noteChange(hits.hits, box, i * 100);
      expect(hits.kind).toBe('repeat');
    }
    hits = noteChange(hits.hits, { ...box, x: 0.11 }, 1000);
    expect(hits.kind).toBe('constant');
    expect(noteChange(hits.hits, box, 1100).kind).toBe('new');
  });

  it('measures overlap and suppresses re-sending within 30 s', () => {
    expect(iou(box, box)).toBeCloseTo(1);
    expect(iou(box, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 })).toBe(0);
    expect(recentlySent([{ box, time: 0 }], box, 29_000)).toBe(true);
    expect(recentlySent([{ box, time: 0 }], box, 31_000)).toBe(false);
  });
});
