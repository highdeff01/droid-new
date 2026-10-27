import { describe, expect, it } from 'vitest';
import { gatherSource, gatherSources, parseSourceRequests, type SourceDeps, type SourceRequest } from './presentation-sources.js';
import type { Frame } from './types.js';

const imageData = () =>
  (typeof ImageData !== 'undefined'
    ? new ImageData(320, 180)
    : { data: new Uint8ClampedArray(320 * 180 * 4), width: 320, height: 180 }) as ImageData;

const shot = (): Frame => ({
  id: 1,
  time: 0,
  url: 'data:image/jpeg;base64,' + 'A'.repeat(40),
  data: imageData(),
  srcW: 1920,
  srcH: 1080,
  source: 'demo',
});

const failDeps: SourceDeps = {
  app: async () => ({ ok: false, reason: 'should not be called' }),
  web: async () => ({ ok: false, reason: 'should not be called' }),
  pc: async () => ({ ok: false, reason: 'should not be called' }),
  demo: async () => ({ ok: false, reason: 'should not be called' }),
};

describe('gatherSources', () => {
  it('skips an app source with the bridge-offline reason and keeps a demo slide', async () => {
    const requests: SourceRequest[] = [{ kind: 'app', subject: 'Notes' }, { kind: 'demo' }];
    const deps: SourceDeps = {
      ...failDeps,
      app: async () => ({ ok: false, reason: 'bridge offline' }),
      demo: async () => ({ ok: true, value: shot() }),
    };
    const { specs, skipped } = await gatherSources(requests, deps);
    expect(skipped).toContain('app source skipped — bridge offline');
    expect(specs).toHaveLength(1);
    const demoSpec = specs[0];
    expect(demoSpec.items).toEqual([
      { kind: 'screenshot', frame: expect.any(Object) },
      { kind: 'note', text: 'Snapshot of the virtual demo environment' },
    ]);
  });

  it('turns web findings into research items with a source', async () => {
    const deps: SourceDeps = { ...failDeps, web: async () => ({ ok: true, value: ['finding one', 'finding two'] }) };
    const { specs } = await gatherSources([{ kind: 'web', subject: 'cats' }], deps);
    expect(specs[0].items).toEqual([
      { kind: 'research', text: 'finding one', source: 'side research: cats' },
      { kind: 'research', text: 'finding two', source: 'side research: cats' },
    ]);
  });

  it('skips an empty web result', async () => {
    const deps: SourceDeps = { ...failDeps, web: async () => ({ ok: true, value: [] }) };
    const { specs, skipped } = await gatherSources([{ kind: 'web', subject: 'nothing' }], deps);
    expect(specs).toEqual([]);
    expect(skipped).toEqual(['web source skipped — research on "nothing" found nothing']);
  });

  it('skips a throwing pc dep with its message', async () => {
    const deps: SourceDeps = {
      ...failDeps,
      pc: async () => {
        throw new Error('pc exploded');
      },
    };
    const { skipped } = await gatherSources([{ kind: 'pc' }], deps);
    expect(skipped).toEqual(['pc source skipped — pc exploded']);
  });

  it('uses the default title per kind when none is given', async () => {
    const deps: SourceDeps = {
      app: async () => ({ ok: true, value: shot() }),
      web: async () => ({ ok: true, value: ['f'] }),
      pc: async () => ({ ok: true, value: shot() }),
      demo: async () => ({ ok: true, value: shot() }),
    };
    const { specs } = await gatherSources(
      [{ kind: 'app', subject: 'Notes' }, { kind: 'web', subject: 'cats' }, { kind: 'pc' }, { kind: 'demo' }],
      deps,
    );
    expect(specs.map((s) => s.title)).toEqual(['Notes (connected app)', 'Research: cats', 'On the PC', 'In the demo world']);
  });

  it('uses the given title over the default', async () => {
    const deps: SourceDeps = { ...failDeps, app: async () => ({ ok: true, value: shot() }) };
    const { specs } = await gatherSources([{ kind: 'app', subject: 'Notes', title: 'Custom Title' }], deps);
    expect(specs[0].title).toBe('Custom Title');
  });

  it('preserves the order of requests among specs and among skipped', async () => {
    const requests: SourceRequest[] = [
      { kind: 'app', subject: 'Notes' },
      { kind: 'web', subject: 'cats' },
      { kind: 'web', subject: 'empty' },
      { kind: 'pc' },
      { kind: 'demo' },
    ];
    const deps: SourceDeps = {
      app: async () => ({ ok: false, reason: 'bridge offline' }),
      web: async (topic) => (topic === 'cats' ? { ok: true, value: ['f1'] } : { ok: true, value: [] }),
      pc: async () => {
        throw new Error('pc exploded');
      },
      demo: async () => ({ ok: true, value: shot() }),
    };
    const { specs, skipped } = await gatherSources(requests, deps);
    expect(specs.map((s) => s.title)).toEqual(['Research: cats', 'In the demo world']);
    expect(skipped).toEqual([
      'app source skipped — bridge offline',
      'web source skipped — research on "empty" found nothing',
      'pc source skipped — pc exploded',
    ]);
  });
});

describe('gatherSource', () => {
  it('resolves a single request directly', async () => {
    const deps: SourceDeps = { ...failDeps, pc: async () => ({ ok: true, value: shot() }) };
    const g = await gatherSource({ kind: 'pc' }, deps);
    expect(g.ok).toBe(true);
  });
});

describe('parseSourceRequests', () => {
  it('keeps app/web/pc/demo entries', () => {
    const raw = [{ kind: 'app', subject: 'Notes' }, { kind: 'web', subject: 'cats' }, { kind: 'pc' }, { kind: 'demo' }];
    expect(parseSourceRequests(raw)).toEqual(raw);
  });

  it('drops entries with an unknown kind', () => {
    expect(parseSourceRequests([{ kind: 'app' }, { kind: 'bogus' }])).toEqual([{ kind: 'app' }]);
  });

  it('returns [] for non-array input', () => {
    expect(parseSourceRequests('not an array')).toEqual([]);
    expect(parseSourceRequests(null)).toEqual([]);
    expect(parseSourceRequests({ kind: 'app' })).toEqual([]);
  });
});
