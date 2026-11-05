import { describe, expect, it } from 'vitest';
import { bestPosition, classifyMotion, currentPosition, dossierLine, findDossier, medianDwell, nextPosition, previousPosition, pruneDossiers, recordObservation, recordOutcome, recordTest, setMove, setPreferred, type PositionDossier, type PositionObservation } from './position-dossier.js';

const see = (list: PositionDossier[], x: number, y: number, time: number, by: PositionObservation['by'] = 'user') => recordObservation(list, { name: 'Save', x, y, time, by });
const one = (list: PositionDossier[]) => findDossier(list, 'save')!;

describe('recordObservation', () => {
  it('creates a static dossier on the first sighting and counts frequency', () => {
    const d = one(see(see([], 0.2, 0.3, 1000), 0.2, 0.305, 2000));
    expect(d.timesSeen).toBe(2);
    expect(d.lastSeen).toBe(2000);
    expect(d.visits).toHaveLength(1);
    expect(currentPosition(d)).toMatchObject({ x: 0.2, y: 0.3, since: 1000 });
    expect(previousPosition(d)).toBeNull();
    expect(classifyMotion(d)).toBe('static');
  });

  it('closes the stay and opens a new one when the element moves, recording dwell timestamps', () => {
    const d = one(see(see([], 0.2, 0.3, 1000), 0.6, 0.7, 9000));
    expect(d.visits[0]).toMatchObject({ x: 0.2, y: 0.3, since: 1000, until: 9000 });
    expect(previousPosition(d)).toMatchObject({ x: 0.2, y: 0.3 });
    expect(currentPosition(d)).toMatchObject({ x: 0.6, y: 0.7, since: 9000 });
    expect(medianDwell(d)).toBe(8000);
    expect(classifyMotion(d)).toBe('moved-by-user');
  });

  it('attributes moves to the AI', () => {
    const d = one(see(see([], 0.2, 0.3, 1000), 0.6, 0.7, 9000, 'ai'));
    expect(d.moves).toEqual({ user: 0, ai: 1 });
    expect(classifyMotion(d)).toBe('moved-by-ai');
  });

  it('classifies an element that moves often and briefly as in motion and predicts its next position', () => {
    let list: PositionDossier[] = [];
    [[0.1, 0.1], [0.5, 0.5], [0.1, 0.1], [0.5, 0.5], [0.1, 0.1]].forEach(([x, y], i) => (list = see(list, x, y, i * 1000)));
    const d = one(list);
    expect(classifyMotion(d)).toBe('in-motion');
    expect(nextPosition(d)).toMatchObject({ x: 0.5, y: 0.5 });
  });

  it('ignores a blank name', () => {
    expect(recordObservation([], { name: ' ', x: 0, y: 0, time: 1, by: 'user' })).toEqual([]);
  });
});

describe('move, preferred and best positions', () => {
  it('uses an explicit move position as the next position and clears it once reached', () => {
    const list = setMove(see([], 0.2, 0.3, 1000), 'Save', { x: 0.8, y: 0.8 });
    expect(nextPosition(one(list))).toEqual({ x: 0.8, y: 0.8 });
    expect(one(see(list, 0.8, 0.8, 2000)).move).toBeUndefined();
  });

  it('sets and clears a preferred position only on a known element', () => {
    expect(setPreferred([], 'Save', { x: 0.1, y: 0.1, by: 'user' })).toEqual([]);
    const list = setPreferred(see([], 0.2, 0.3, 1000), 'Save', { x: 0.4, y: 0.4, by: 'ai' });
    expect(one(list).preferred).toEqual({ x: 0.4, y: 0.4, by: 'ai' });
    expect(one(setPreferred(list, 'Save', null)).preferred).toBeUndefined();
  });

  it('picks the spot with the highest success rate among spots tried at least twice', () => {
    let list = see([], 0.2, 0.3, 1000);
    list = recordOutcome(list, 'Save', { x: 0.2, y: 0.3 }, false, 2);
    list = recordOutcome(list, 'Save', { x: 0.2, y: 0.3 }, true, 3);
    list = recordOutcome(list, 'Save', { x: 0.7, y: 0.7 }, true, 4);
    list = recordOutcome(list, 'Save', { x: 0.7, y: 0.7 }, true, 5);
    list = recordOutcome(list, 'Save', { x: 0.9, y: 0.9 }, true, 6);
    expect(bestPosition(one(list))).toMatchObject({ x: 0.7, y: 0.7, attempts: 2, successes: 2 });
  });
});

describe('recordTest', () => {
  it('keeps planned vs actual landing points newest first', () => {
    let list = recordTest([], 'Save', { x: 0.2, y: 0.2 }, { x: 0.22, y: 0.2 }, 1);
    list = recordTest(list, 'Save', { x: 0.3, y: 0.3 }, { x: 0.32, y: 0.3 }, 2);
    expect(one(list).tests.map((t) => t.time)).toEqual([2, 1]);
    expect(one(list).tests[0]).toEqual({ planned: { x: 0.3, y: 0.3 }, actual: { x: 0.32, y: 0.3 }, time: 2 });
  });
});

describe('pruneDossiers and dossierLine', () => {
  it('keeps the most recently seen dossiers', () => {
    const list = [1, 3, 2].flatMap((t) => recordObservation([], { name: `e${t}`, x: 0.1, y: 0.1, time: t, by: 'user' }));
    expect(pruneDossiers(list, 2).map((d) => d.name)).toEqual(['e3', 'e2']);
  });

  it('summarises motion, positions and frequency', () => {
    const line = dossierLine(one(see(see([], 0.2, 0.3, 1000), 0.6, 0.7, 9000)));
    expect(line).toContain('"Save" moved-by-user, seen 2×');
    expect(line).toContain('now (60.0%, 70.0%)');
    expect(line).toContain('was (20.0%, 30.0%)');
  });
});
