import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Frame } from './types.js';
import { CHANGE_HITS, IDENTIFY_EXAMPLE, IDENTIFY_SCHEMA, IDENTIFY_SYSTEM, characteristics, identifyAndVerify, identifyRequest, iou, mappedDistances, noteChange, parseIdentification, recentlySent, regionStats, type IdentifyInput, type IdentifyLoop } from './identify.js';
import type { MappedElement } from './element-map-studio.js';
import { AiParseError, AiSchemaError, SAMPLE_VIEW, systemText } from './ai.js';

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
    expect(systemText(req.system, SAMPLE_VIEW)).toBe(IDENTIFY_SYSTEM);
    expect(req.frame).toBe(input.frame);
    expect(req.crops?.[0]?.url).toBe('data:image/jpeg;base64,Q1JPUA==');
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
  const reply = (content: string) => ({ content, thinking: null });

  it('resolves the grid point and keeps the thinking', () => {
    const r = parseIdentification({ content: '{"found":true,"name":"Play","cell":"A1","cx":0.5,"cy":0.5,"confidence":0.9}', thinking: 'hmm' }, 'x');
    expect(r).toMatchObject({ found: true, name: 'Play', confidence: 0.9, thinking: 'hmm' });
    if (r.found) expect(r.x).toBeCloseTo(1 / 24);
  });

  it('turns a cell with null x,y into the cell centre (H12 is bottom-right)', () => {
    const r = parseIdentification(reply('{"found":true,"cell":"H12","x":null,"y":null,"confidence":0.8}'), 'Save');
    expect(r).toMatchObject({ found: true, name: 'Save' });
    if (r.found) {
      expect(r.x).toBeCloseTo(23 / 24);
      expect(r.y).toBeCloseTo(15 / 16);
    }
  });

  it('a valid cell wins over x,y; an invalid cell falls back to x,y in view pixels', () => {
    const both = parseIdentification(reply('{"found":true,"cell":"A1","x":400,"y":200,"confidence":0.9}'), 'n');
    if (both.found) expect([both.x, both.y]).toEqual([1 / 24, 1 / 16]);
    const xy = parseIdentification(reply('{"found":true,"cell":"I1","x":240,"y":135,"confidence":0.9}'), 'n');
    if (xy.found) expect([xy.x, xy.y]).toEqual([0.5, 0.5]);
  });

  it('reports not found', () => {
    expect(parseIdentification(reply('{"found":false,"cell":null,"x":null,"y":null,"confidence":0}'), 'x')).toEqual({ found: false, reason: '', thinking: null });
  });

  it('rejects a reply holding no JSON object as AiParseError that never says "prose"', () => {
    for (const content of ['The element is the red button in cell C5, behind a popup.', '[1,2]']) {
      expect(() => parseIdentification(reply(content), 'x')).toThrow(AiParseError);
      expect(() => parseIdentification(reply(content), 'x')).toThrow(/not a JSON object/);
      expect(() => parseIdentification(reply(content), 'x')).not.toThrow(/prose/);
    }
  });

  it('accepts a JSON object after prose', () => {
    expect(parseIdentification(reply('Sure: {"found":true,"cell":"C5","x":null,"y":null,"confidence":0.9}'), 'x').found).toBe(true);
  });

  it('names the wrong field in an AiSchemaError', () => {
    const error = (content: string) => {
      try {
        parseIdentification(reply(content), 'x');
      } catch (e) {
        return e as AiSchemaError;
      }
      throw new Error('expected a schema error');
    };
    expect(error('{"found":true,"cell":"C5"}')).toMatchObject({ field: 'confidence', name: 'AiSchemaError' });
    expect(error('{"found":true,"cell":"C5"}').message).toMatch(/"confidence" must be a number/);
    expect(error('{"confidence":0.2}')).toMatchObject({ field: 'found' });
    expect(error('{"found":true,"cell":"Z99","x":"abc","confidence":0.9}').message).toMatch(/"cell" must be A1..H12 \(got "Z99"\).*"x","y" numbers \(got "abc"/);
    expect(error('{"cell":"C5","confidence":"high"}').message).toMatch(/got "high"/);
  });

  it('accepts a fenced JSON object', () => {
    expect(parseIdentification(reply('```json\n{"found":true,"cell":"B2","x":null,"y":null,"confidence":0.7}\n```'), 'x').found).toBe(true);
  });

  it('rejects found=true with neither a valid cell nor x,y', () => {
    expect(() => parseIdentification(reply('{"found":true,"cell":null,"x":null,"y":null,"confidence":0.95}'), 'x')).toThrow(/no valid cell/);
  });
});

describe('parseIdentification: missing "found"', () => {
  const reply = (content: string) => ({ content, thinking: null });

  it('infers found=true from a cell with fractional x,y (the live-log reply)', () => {
    const r = parseIdentification(reply('{ "cell": "B5", "x": 0.37, "y": 0.2, "confidence": 0.99 }'), 'Files');
    expect(r).toMatchObject({ found: true, name: 'Files', x: 0.37, y: 0.2, confidence: 0.99 });
    const live = parseIdentification(reply('{ "cell": "B5", "x": 0.083, "y": 0.458, "confidence": 0.99 }'), 'Files');
    expect(live).toMatchObject({ found: true, x: 4.5 / 12, y: 1.5 / 8 });
  });

  it('infers found=true from x,y alone', () => {
    expect(parseIdentification(reply('{"x":0.6,"y":0.7,"confidence":0.8}'), 'n')).toMatchObject({ found: true, x: 0.6, y: 0.7 });
  });

  it('reads yes/no words and recognized not-found shapes as found=false', () => {
    expect(parseIdentification(reply('{"found":"no","confidence":0}'), 'n').found).toBe(false);
    expect(parseIdentification(reply('{"status":"not_found","reason":"gone"}'), 'n')).toEqual({ found: false, reason: 'gone', thinking: null });
    expect(parseIdentification(reply('{"cell":null,"x":null,"y":null}'), 'n').found).toBe(false);
    expect(parseIdentification(reply('{"found":"yes","cell":"A1","confidence":0.7}'), 'n').found).toBe(true);
  });

  it('keeps an explicit found=false even when a location is present', () => {
    expect(parseIdentification(reply('{"found":false,"cell":"C5","confidence":0.1}'), 'n').found).toBe(false);
  });
});

describe('parseIdentification: coordinate normalization', () => {
  const reply = (content: string) => ({ content, thinking: null });
  const point = (content: string) => {
    const r = parseIdentification(reply(content), 'n');
    if (!r.found) throw new Error('expected found');
    return r;
  };

  it('reads values up to the grid size as grid units (x/12, y/8)', () => {
    const r = point('{"x":3.78,"y":6.4,"confidence":1}');
    expect(r.x).toBeCloseTo(3.78 / 12);
    expect(r.y).toBeCloseTo(0.8);
  });

  it('reads values above the grid size up to 100 as percent', () => {
    const r = point('{"x":56,"y":40,"confidence":0.9}');
    expect(r.x).toBeCloseTo(0.56);
    expect(r.y).toBeCloseTo(0.4);
  });

  it('reads values above 100 as pixels of the view the model saw', () => {
    expect(point('{"x":150,"y":135,"confidence":0.9}')).toMatchObject({ x: 150 / 480, y: 0.5 });
    expect(parseIdentification({ ...reply('{"x":640,"y":180,"confidence":0.9}'), view: { w: 1280, h: 720 } }, 'n')).toMatchObject({ x: 0.5, y: 0.25 });
  });

  it('normalizes each axis on its own', () => {
    const r = point('{"x":0.5,"y":6.4,"confidence":0.9}');
    expect(r.x).toBe(0.5);
    expect(r.y).toBeCloseTo(0.8);
  });

  it('uses the converted point when it lies in the named cell', () => {
    const r = point('{"cell":"G4","x":3.78,"y":6.4,"confidence":1}');
    expect(r.x).toBeCloseTo(3.78 / 12);
    expect(r.note).toBeUndefined();
  });

  it('prefers the named cell centre when the point disagrees, and notes the discrepancy', () => {
    const r = point('{"cell":"D9","x":3.78,"y":6.4,"confidence":1}');
    expect(r.x).toBeCloseTo(8.5 / 12);
    expect(r.y).toBeCloseTo(3.5 / 8);
    expect(r.note).toMatch(/fall in G4, not the named cell D9/);
  });
});

describe('parseIdentification: findings array', () => {
  const reply = (content: string) => ({ content, thinking: null });

  it('reports a popup finding as the blocker', () => {
    const r = parseIdentification(reply('{"findings":[{"kind":"popup","label":"Cookie consent","cell":"D6"}]}'), 'n');
    expect(r).toMatchObject({ found: false, blocker: 'a popup ("Cookie consent") in D6' });
  });

  it('uses the coordinates of a located target finding', () => {
    const r = parseIdentification(reply('{"findings":[{"kind":"text","label":"hint"},{"kind":"target","cell":"C5","confidence":0.8}]}'), 'n');
    expect(r).toMatchObject({ found: true, confidence: 0.8 });
    if (r.found) expect(r.x).toBeCloseTo(4.5 / 12);
  });

  it('a popup wins over a located target; findings with nothing located are not found', () => {
    expect(parseIdentification(reply('{"findings":[{"kind":"target","cell":"C5","confidence":0.9},{"kind":"popup"}]}'), 'n')).toMatchObject({ found: false, blocker: 'a popup' });
    expect(parseIdentification(reply('{"findings":[{"kind":"text"}]}'), 'n')).toMatchObject({ found: false, reason: 'no finding located the element' });
  });
});

describe('identifyAndVerify', () => {
  afterEach(() => vi.useRealTimers());
  const found = { found: true as const, name: 'Play', x: 0.4, y: 0.4, confidence: 0.9, reason: '', thinking: null };

  function loop(over: Partial<IdentifyLoop>): IdentifyLoop & { logs: string[] } {
    const logs: string[] = [];
    return { identify: vi.fn(async () => found), verify: vi.fn(async () => ({ ok: false as const, message: 'no match' })), aborted: () => false, log: (m) => logs.push(m), logs, ...over };
  }

  it('accepts the agent-corrected point, not the raw proposal', async () => {
    const l = loop({ verify: vi.fn(async () => ({ ok: true as const, x: 0.42, y: 0.43, message: 'ok' })) });
    expect(await identifyAndVerify(l)).toEqual({ verified: true, name: 'Play', x: 0.42, y: 0.43, tries: 1 });
  });

  it('dispatches the move to the verified point at once, in the first try', async () => {
    const move = vi.fn(async () => ({ ok: true, message: 'moved' }));
    const l = loop({ verify: vi.fn(async () => ({ ok: true as const, x: 0.42, y: 0.43, message: 'ok' })), move });
    const out = await identifyAndVerify(l);
    expect(move).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledWith({ name: 'Play', x: 0.42, y: 0.43 });
    expect(out).toMatchObject({ verified: true, tries: 1, moved: { ok: true } });
    expect(l.logs.join('\n')).not.toMatch(/Could not find/);
  });

  it('retries an unparseable reply quoting the exact schema and a filled example, then verifies and moves', async () => {
    const identify = vi.fn().mockRejectedValueOnce(new AiParseError('The button is red, in C5, behind a popup.')).mockResolvedValueOnce(found);
    const move = vi.fn(async () => ({ ok: true, message: 'moved' }));
    const l = loop({ identify, move, verify: vi.fn(async () => ({ ok: true as const, x: 0.4, y: 0.4, message: 'ok' })) });
    const out = await identifyAndVerify(l);
    expect(identify).toHaveBeenCalledTimes(2);
    const feedback = identify.mock.calls[1][0] as string;
    expect(feedback).toContain(IDENTIFY_SCHEMA);
    expect(feedback).toContain(IDENTIFY_EXAMPLE);
    expect(feedback).toContain('held no JSON object');
    expect(feedback).not.toMatch(/prose/);
    expect(out).toMatchObject({ verified: true, tries: 2 });
    expect(move).toHaveBeenCalledTimes(1);
  });

  it('names the wrong field in the retry after a schema error', async () => {
    const identify = vi.fn().mockRejectedValueOnce(new AiSchemaError('confidence', '"confidence" must be a number 0..1 (got nothing)')).mockResolvedValueOnce(found);
    await identifyAndVerify(loop({ identify, verify: vi.fn(async () => ({ ok: true as const, x: 0.4, y: 0.4, message: 'ok' })) }));
    expect(identify.mock.calls[1][0]).toMatch(/"confidence" field was wrong/);
    expect(identify.mock.calls[1][0]).toContain(IDENTIFY_SCHEMA);
  });

  it('stops at once on a popup blocker without burning the remaining tries', async () => {
    const identify = vi.fn(async () => ({ found: false as const, reason: '', blocker: 'a popup ("Update")', thinking: null }));
    const l = loop({ identify });
    const out = await identifyAndVerify(l);
    expect(identify).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ verified: false, tries: 1, blocker: 'a popup ("Update")' });
    expect(l.logs.join('\n')).not.toMatch(/Could not find/);
  });

  it('logs a cell/point discrepancy before verifying', async () => {
    const l = loop({ identify: vi.fn(async () => ({ ...found, note: 'x,y fall in G4, not the named cell D9' })), verify: vi.fn(async () => ({ ok: true as const, x: 0.4, y: 0.4, message: 'ok' })) });
    await identifyAndVerify(l);
    expect(l.logs[0]).toMatch(/not the named cell D9/);
  });

  it('never verifies or moves a low-confidence or not-found identification', async () => {
    const move = vi.fn(async () => ({ ok: true, message: 'moved' }));
    const low = loop({ identify: vi.fn(async () => ({ ...found, confidence: 0.05 })), move });
    expect((await identifyAndVerify(low)).verified).toBe(false);
    expect(low.verify).not.toHaveBeenCalled();
    expect(low.logs[0]).toContain('below');
    const none = loop({ identify: vi.fn(async () => ({ found: false as const, reason: 'gone', thinking: null })), move });
    expect((await identifyAndVerify(none)).verified).toBe(false);
    expect(move).not.toHaveBeenCalled();
  });

  it('does not move once aborted after verification', async () => {
    let aborted = false;
    const move = vi.fn(async () => ({ ok: true, message: 'moved' }));
    const l = loop({ aborted: () => aborted, move, verify: vi.fn(async () => { aborted = true; return { ok: true as const, x: 0.4, y: 0.4, message: 'ok' }; }) });
    await identifyAndVerify(l);
    expect(move).not.toHaveBeenCalled();
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
