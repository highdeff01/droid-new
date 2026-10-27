import { describe, expect, it } from 'vitest';
import { MATCHED } from './drift.js';
import type { Frame, SavedCard } from './types.js';
import type { MappedElement } from './element-map-studio.js';
import {
  afterFire,
  afterSkip,
  createTrigger,
  elementPresent,
  fireGate,
  isTrigger,
  observeElement,
  outcomeText,
  resolveTarget,
  scheduleDue,
} from './triggers.js';
import type { ElementTrigger, ScheduleTrigger, Trigger, TriggerDraft } from './triggers.js';

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  }
  (globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataPolyfill;
}

const W = 320;
const H = 180;
const BOX = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };

/** Over/under the MATCHED threshold relative to a mid-gray base, so pixel values straddle the match boundary. */
const BASE = 128;
const OVER = BASE + Math.ceil(MATCHED * 255) + 1;
const UNDER = BASE + Math.floor(MATCHED * 255) - 1;

/** A 320x180 buffer with `inside` inside BOX and `outside` elsewhere. */
function boxImage(inside: number, outside = 0): ImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  const x0 = Math.floor(BOX.x * W);
  const x1 = Math.min(W, Math.ceil((BOX.x + BOX.w) * W));
  const y0 = Math.floor(BOX.y * H);
  const y1 = Math.min(H, Math.ceil((BOX.y + BOX.h) * H));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = x >= x0 && x < x1 && y >= y0 && y < y1 ? inside : outside;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return new ImageData(data, W, H);
}

const frame = (id: number, data: ImageData): Frame => ({ id, time: id, url: '', data, srcW: 1920, srcH: 1080, source: 'demo' } as Frame);

const elementWithTemplate = (templateData: ImageData): MappedElement => ({
  id: 'e1',
  name: 'Element',
  box: BOX,
  mappedAt: 0,
  frame: frame(0, templateData),
});

const elementNoTemplate = (): MappedElement => ({ id: 'e1', name: 'Element', box: BOX, mappedAt: 0 });

describe('observeElement', () => {
  it('first frame is a baseline (no events)', () => {
    const el = elementWithTemplate(boxImage(BASE));
    const { events } = observeElement(el, undefined, frame(1, boxImage(BASE)));
    expect(events).toEqual([]);
  });

  it('appear fires when template-matching region goes from absent to present', () => {
    const el = elementWithTemplate(boxImage(BASE));
    const { snapshot } = observeElement(el, undefined, frame(1, boxImage(OVER)));
    expect(snapshot.present).toBe(false);
    const { events } = observeElement(el, snapshot, frame(2, boxImage(UNDER)));
    expect(events).toEqual(['appear']);
  });

  it('disappear on present->absent', () => {
    const el = elementWithTemplate(boxImage(BASE));
    const { snapshot } = observeElement(el, undefined, frame(1, boxImage(UNDER)));
    expect(snapshot.present).toBe(true);
    const { events } = observeElement(el, snapshot, frame(2, boxImage(OVER)));
    expect(events).toEqual(['disappear']);
  });

  it('change fires when box pixels differ beyond MATCHED even without a template (present null)', () => {
    const el = elementNoTemplate();
    const { snapshot } = observeElement(el, undefined, frame(1, boxImage(0)));
    expect(snapshot.present).toBeNull();
    const { events } = observeElement(el, snapshot, frame(2, boxImage(255)));
    expect(events).toEqual(['change']);
  });

  it('a change outside the box fires nothing', () => {
    const el = elementNoTemplate();
    const { snapshot } = observeElement(el, undefined, frame(1, boxImage(50, 10)));
    const { events } = observeElement(el, snapshot, frame(2, boxImage(50, 200)));
    expect(events).toEqual([]);
  });

  it('elementPresent returns null without a template frame', () => {
    const el = elementNoTemplate();
    expect(elementPresent(el, frame(1, boxImage(100)))).toBeNull();
  });
});

const elementTrigger = (overrides: Partial<ElementTrigger> = {}): ElementTrigger => ({
  id: 't1',
  name: 'Test trigger',
  kind: 'element',
  elementId: 'e1',
  event: 'appear',
  enabled: true,
  cooldownSec: 30,
  maxRuns: 0,
  runs: 0,
  target: { kind: 'draft' },
  ...overrides,
});

const scheduleTrigger = (overrides: Partial<ScheduleTrigger> = {}): ScheduleTrigger => ({
  id: 's1',
  name: 'Scheduled trigger',
  kind: 'schedule',
  at: 1000,
  everySec: 10,
  enabled: true,
  cooldownSec: 0,
  maxRuns: 0,
  runs: 0,
  target: { kind: 'draft' },
  ...overrides,
});

describe('fireGate', () => {
  it('null when enabled and never fired', () => {
    expect(fireGate(elementTrigger(), 1_000_000)).toBeNull();
  });

  it(`'cooldown' reason when now < lastFired + cooldownSec*1000`, () => {
    const t = elementTrigger({ lastFired: 1000, cooldownSec: 30 });
    const skip = fireGate(t, 11_000);
    expect(skip?.reason).toBe('cooldown');
    expect(skip?.detail).toContain('20 s');
  });

  it('null at/after cooldown end', () => {
    const t = elementTrigger({ lastFired: 1000, cooldownSec: 30 });
    expect(fireGate(t, 31_000)).toBeNull();
  });

  it(`'limit' reason when maxRuns>0 and runs>=maxRuns`, () => {
    const t = elementTrigger({ maxRuns: 3, runs: 3 });
    expect(fireGate(t, 0)).toEqual({ reason: 'limit', detail: 'run limit 3 reached' });
  });

  it('maxRuns 0 = unlimited', () => {
    const t = elementTrigger({ maxRuns: 0, runs: 999 });
    expect(fireGate(t, 0)).toBeNull();
  });

  it(`'disabled' when enabled=false`, () => {
    const t = elementTrigger({ enabled: false });
    expect(fireGate(t, 0)?.reason).toBe('disabled');
  });
});

describe('afterFire / afterSkip / scheduleDue', () => {
  it('afterFire increments runs, sets lastFired, disables at run limit', () => {
    const t = elementTrigger({ maxRuns: 2, runs: 1 });
    const fired = afterFire(t, 5000);
    expect(fired.runs).toBe(2);
    expect(fired.lastFired).toBe(5000);
    expect(fired.enabled).toBe(false);
  });

  it('recurring schedule advances `at` past now by whole intervals (missed backlog -> single advance beyond now)', () => {
    const t = scheduleTrigger({ at: 1000, everySec: 10 });
    const fired = afterFire(t, 26_000) as ScheduleTrigger;
    expect(fired.at).toBe(31_000);
    expect(fired.at).toBeGreaterThan(26_000);
  });

  it('one-shot schedule (everySec 0) disables after firing', () => {
    const t = scheduleTrigger({ at: 1000, everySec: 0 });
    const fired = afterFire(t, 2000);
    expect(fired.enabled).toBe(false);
  });

  it('afterSkip advances a due schedule without counting a run', () => {
    const t = scheduleTrigger({ at: 1000, everySec: 10, runs: 0 });
    const skipped = afterSkip(t, 26_000) as ScheduleTrigger;
    expect(skipped.at).toBe(31_000);
    expect(skipped.runs).toBe(0);
    expect(skipped.lastFired).toBeUndefined();
  });

  it('afterSkip leaves element triggers unchanged', () => {
    const t = elementTrigger();
    expect(afterSkip(t, 999_999)).toEqual(t);
  });

  it('scheduleDue is false before `at`', () => {
    expect(scheduleDue(scheduleTrigger({ at: 1000 }), 999)).toBe(false);
  });

  it('scheduleDue is true at and after `at`', () => {
    expect(scheduleDue(scheduleTrigger({ at: 1000 }), 1000)).toBe(true);
    expect(scheduleDue(scheduleTrigger({ at: 1000 }), 2000)).toBe(true);
  });

  it('scheduleDue is false when disabled', () => {
    expect(scheduleDue(scheduleTrigger({ at: 1000, enabled: false }), 2000)).toBe(false);
  });
});

describe('createTrigger / resolveTarget / isTrigger / outcomeText', () => {
  it('zeroes runs, enables, trims name, clamps negative/fractional numbers to whole >=0', () => {
    const draft: TriggerDraft = {
      kind: 'element',
      name: '  My Trigger  ',
      elementId: 'e1',
      event: 'appear',
      cooldownSec: -5.7,
      maxRuns: 3.9,
      target: { kind: 'draft' },
    };
    const t = createTrigger(draft, 'id1');
    expect(t).toMatchObject({ id: 'id1', name: 'My Trigger', enabled: true, runs: 0, cooldownSec: 0, maxRuns: 3 });
  });

  it('clamps a schedule draft\'s everySec to a whole non-negative number', () => {
    const draft: TriggerDraft = {
      kind: 'schedule',
      name: 'Nightly',
      at: 1000,
      everySec: -2.5,
      cooldownSec: 0,
      maxRuns: 0,
      target: { kind: 'draft' },
    };
    const t = createTrigger(draft, 'id2') as ScheduleTrigger;
    expect(t.everySec).toBe(0);
  });

  it('errors when the target is a draft but there is no draft card', () => {
    expect(resolveTarget({ kind: 'draft' }, [], null)).toEqual({ error: 'no draft card — plan a goal first' });
  });

  it('errors when the target card was deleted', () => {
    const cards: SavedCard[] = [];
    expect(resolveTarget({ kind: 'card', cardId: 'missing' }, cards, null)).toEqual({ error: 'its saved flow was deleted' });
  });

  it('accepts a created element trigger', () => {
    const draft: TriggerDraft = { kind: 'element', name: 'E', elementId: 'e1', event: 'appear', cooldownSec: 0, maxRuns: 0, target: { kind: 'draft' } };
    expect(isTrigger(createTrigger(draft, 'id1'))).toBe(true);
  });

  it('accepts a created schedule trigger', () => {
    const draft: TriggerDraft = { kind: 'schedule', name: 'S', at: 1000, everySec: 10, cooldownSec: 0, maxRuns: 0, target: { kind: 'draft' } };
    expect(isTrigger(createTrigger(draft, 'id2'))).toBe(true);
  });

  it('rejects an element trigger with a bad event', () => {
    const t = { ...elementTrigger(), event: 'bogus' };
    expect(isTrigger(t)).toBe(false);
  });

  it('rejects an element trigger missing elementId', () => {
    const { elementId, ...rest } = elementTrigger();
    expect(isTrigger(rest)).toBe(false);
  });

  it('rejects a trigger with negative cooldown', () => {
    const t = { ...elementTrigger(), cooldownSec: -1 };
    expect(isTrigger(t)).toBe(false);
  });

  it('outcomeText(null) is error tone', () => {
    const { text, tone } = outcomeText(null);
    expect(tone).toBe('error');
    expect(text).toContain('refused');
  });

  it('dry-run text mentions "dry run"', () => {
    const { text, tone } = outcomeText({ ok: 1, total: 1, dryRun: true, stopped: false });
    expect(text).toContain('dry run');
    expect(tone).toBe('ok');
  });

  it('all steps ok gives "ok" tone', () => {
    const { tone } = outcomeText({ ok: 2, total: 2, dryRun: false, stopped: false });
    expect(tone).toBe('ok');
  });

  it('partial run gives "warn" tone', () => {
    const { tone } = outcomeText({ ok: 1, total: 2, dryRun: false, stopped: false });
    expect(tone).toBe('warn');
  });
});
