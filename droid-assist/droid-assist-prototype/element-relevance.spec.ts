import { describe, it, expect } from 'vitest';
import {
  logSightings,
  perspective,
  planLanes,
  monitorChanges,
  SIGHTING_LIMIT,
  MOVE_EPSILON,
  RELEVANCE_EPSILON,
  type Sighting,
  type Lane,
  type ElementReport,
} from './element-relevance.js';

function sighting(name: string, x: number, y: number, relevance: number, firstTurn: number, turn: number): Sighting {
  return { name, x, y, relevance, firstTurn, turn };
}

function report(name: string, x: number, y: number, relevance: number): ElementReport {
  return { name, x, y, relevance };
}

describe('logSightings', () => {
  it('merges a report into an existing sighting by case-insensitive trimmed name, updating position, relevance and turn, keeping firstTurn, using the latest spelling', () => {
    const log1 = logSightings([], [report('Enemy', 0.1, 0.2, 0.3)], 1);
    const log2 = logSightings(log1, [report('  ENEMY  ', 0.5, 0.6, 0.9)], 2);
    expect(log2).toEqual([{ name: 'ENEMY', x: 0.5, y: 0.6, relevance: 0.9, firstTurn: 1, turn: 2 }]);
  });

  it('adds a report as a new sighting when its name does not match an existing one', () => {
    const log1 = logSightings([], [report('Enemy', 0.1, 0.2, 0.9)], 1);
    const log2 = logSightings(log1, [report('Door', 0.7, 0.3, 0.6)], 2);
    const names = log2.map((s) => s.name);
    expect(names).toContain('Enemy');
    expect(names).toContain('Door');
  });

  it('ignores reports with blank or whitespace-only names', () => {
    const log = logSightings([], [report('', 0.1, 0.1, 0.5), report('   ', 0.2, 0.2, 0.5), report('Door', 0.3, 0.3, 0.5)], 1);
    expect(log.map((s) => s.name)).toEqual(['Door']);
  });

  it('clamps x, y and relevance above 1 down to 1', () => {
    const [sighted] = logSightings([], [report('Enemy', 1.7, 1.2, 1.7)], 1);
    expect(sighted).toMatchObject({ x: 1, y: 1, relevance: 1 });
  });

  it('clamps x, y and relevance below 0 up to 0', () => {
    const [sighted] = logSightings([], [report('Enemy', -0.3, -0.1, -0.3)], 1);
    expect(sighted).toMatchObject({ x: 0, y: 0, relevance: 0 });
  });

  it('puts the most recently updated sighting first while leaving untouched sightings in their prior order', () => {
    const log1 = logSightings([], [report('Enemy', 0.1, 0.1, 0.9), report('Health potion', 0.2, 0.2, 0.5), report('Door', 0.3, 0.3, 0.4)], 1);
    const log2 = logSightings(log1, [report('Health potion', 0.25, 0.25, 0.55)], 2);
    expect(log2.map((s) => s.name)).toEqual(['Health potion', 'Enemy', 'Door']);
  });

  it('caps the log at SIGHTING_LIMIT, keeping the earliest-reported elements of the turn', () => {
    const reports = Array.from({ length: SIGHTING_LIMIT + 5 }, (_, i) => report(`Minimap ${i}`, 0.1, 0.1, 0.5));
    const log = logSightings([], reports, 1);
    expect(log).toHaveLength(SIGHTING_LIMIT);
    expect(log[0].name).toBe('Minimap 0');
    expect(log[SIGHTING_LIMIT - 1].name).toBe(`Minimap ${SIGHTING_LIMIT - 1}`);
  });
});

describe('perspective', () => {
  const turn3Log: Sighting[] = [
    sighting('Enemy', 0.5, 0.5, 0.9, 3, 3),
    sighting('Door', 0.6, 0.2, 0.6, 2, 3),
    sighting('Health potion', 0.1, 0.1, 0.4, 1, 3),
    sighting('Minimap', 0.95, 0.05, 0.2, 1, 3),
    sighting('Key', 0.0, 0.0, 0.3, 2, 2),
  ];

  it('sets focus to the highest-relevance element seen this turn', () => {
    expect(perspective(turn3Log, 3).focus?.name).toBe('Enemy');
  });

  it('sets candidates to the other this-turn elements with relevance >= 0.5, sorted descending', () => {
    expect(perspective(turn3Log, 3).candidates.map((s) => s.name)).toEqual(['Door']);
  });

  it('sets peripheral to the this-turn elements below 0.5 relevance', () => {
    expect(perspective(turn3Log, 3).peripheral.map((s) => s.name)).toEqual(['Health potion', 'Minimap']);
  });

  it('sets gone to elements last seen on an earlier turn', () => {
    expect(perspective(turn3Log, 3).gone.map((s) => s.name)).toEqual(['Key']);
  });

  it('sets focus to null and summary to "Nothing important in view" when nothing was seen this turn', () => {
    const view = perspective(turn3Log, 4);
    expect(view.focus).toBeNull();
    expect(view.summary).toBe('Nothing important in view');
  });

  it('starts the summary with Focus "<name>" when something is in view', () => {
    expect(perspective(turn3Log, 3).summary.startsWith('Focus "Enemy"')).toBe(true);
  });
});

describe('planLanes', () => {
  it('plans an act lane on the focus with recapture true, followed by one monitor lane per peripheral element with recapture false', () => {
    const view = perspective(
      [
        sighting('Enemy', 0.5, 0.5, 0.9, 1, 1),
        sighting('Health potion', 0.1, 0.1, 0.4, 1, 1),
        sighting('Minimap', 0.9, 0.1, 0.2, 1, 1),
      ],
      1,
    );
    const lanes = planLanes(view);
    expect(lanes).toEqual([
      { kind: 'act', element: view.focus, recapture: true, label: expect.any(String) },
      { kind: 'monitor', element: view.peripheral[0], recapture: false, label: expect.any(String) },
      { kind: 'monitor', element: view.peripheral[1], recapture: false, label: expect.any(String) },
    ]);
  });

  it('plans no lanes when there is no focus', () => {
    const view = perspective([sighting('Key', 0, 0, 0.3, 1, 1)], 2);
    expect(planLanes(view)).toEqual([]);
  });
});

describe('monitorChanges', () => {
  const actLane: Lane = { kind: 'act', element: sighting('Enemy', 0.5, 0.5, 0.9, 1, 2), recapture: true, label: 'Act on "Enemy", then recapture' };
  const healthPotionLane: Lane = { kind: 'monitor', element: sighting('Health potion', 0.1, 0.1, 0.4, 1, 2), recapture: false, label: 'watch' };
  const minimapLane: Lane = { kind: 'monitor', element: sighting('Minimap', 0.9, 0.1, 0.2, 1, 2), recapture: false, label: 'watch' };
  const doorLane: Lane = { kind: 'monitor', element: sighting('Door', 0.6, 0.2, 0.45, 1, 2), recapture: false, label: 'watch' };
  const keyLane: Lane = { kind: 'monitor', element: sighting('Key', 0.0, 0.0, 0.1, 1, 2), recapture: false, label: 'watch' };
  const lanes = [actLane, healthPotionLane, minimapLane, doorLane, keyLane];

  function changeFor(name: string, nextLog: Sighting[]) {
    return monitorChanges(lanes, nextLog, 3).find((c) => c.name === name);
  }

  it('reports vanished when a monitored element is not seen on the next turn', () => {
    const nextLog: Sighting[] = [
      sighting('Enemy', 0.5, 0.5, 0.9, 1, 3),
      sighting('Minimap', 0.9, 0.1, 0.2, 1, 3),
      sighting('Door', 0.6, 0.2, 0.45, 1, 3),
      sighting('Key', 0.0, 0.0, 0.1, 1, 3),
    ];
    expect(changeFor('Health potion', nextLog)?.change).toBe('vanished');
  });

  it('reports moved when a monitored element moved more than MOVE_EPSILON', () => {
    const nextLog: Sighting[] = [
      sighting('Health potion', 0.1, 0.1, 0.4, 1, 3),
      sighting('Minimap', 0.9 - (MOVE_EPSILON + 0.05), 0.1, 0.2, 1, 3),
      sighting('Door', 0.6, 0.2, 0.45, 1, 3),
      sighting('Key', 0.0, 0.0, 0.1, 1, 3),
    ];
    expect(changeFor('Minimap', nextLog)?.change).toBe('moved');
  });

  it('reports relevance when a monitored element relevance changed more than RELEVANCE_EPSILON', () => {
    const nextLog: Sighting[] = [
      sighting('Health potion', 0.1, 0.1, 0.4, 1, 3),
      sighting('Minimap', 0.9, 0.1, 0.2, 1, 3),
      sighting('Door', 0.6, 0.2, 0.45 + RELEVANCE_EPSILON + 0.1, 1, 3),
      sighting('Key', 0.0, 0.0, 0.1, 1, 3),
    ];
    expect(changeFor('Door', nextLog)?.change).toBe('relevance');
  });

  it('reports nothing for an unchanged monitored element and never reports the act lane', () => {
    const nextLog: Sighting[] = [
      sighting('Enemy', 0.5, 0.5, 0.9, 1, 3),
      sighting('Health potion', 0.1, 0.1, 0.4, 1, 3),
      sighting('Minimap', 0.9, 0.1, 0.2, 1, 3),
      sighting('Door', 0.6, 0.2, 0.45, 1, 3),
      sighting('Key', 0.0, 0.0, 0.1, 1, 3),
    ];
    const changes = monitorChanges(lanes, nextLog, 3);
    expect(changes.find((c) => c.name === 'Key')).toBeUndefined();
    expect(changes.find((c) => c.name === 'Enemy')).toBeUndefined();
  });
});
