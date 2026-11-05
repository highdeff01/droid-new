import { describe, expect, it } from 'vitest';
import { CHARACTER_SIZE, findItemSpec, loadOf, placementFor, slotAt, slotZone, speedFactor, type ItemSpec, type Wearer } from './test-world-items.js';

const sword = findItemSpec('Sword')!;
const hat = findItemSpec('Hat')!;
const spareHat = findItemSpec('Spare hat')!;
const glasses = findItemSpec('Glasses')!;
const roseHat = findItemSpec('Rose hat')!;
const armor = findItemSpec('Armor')!;

/** A male wearer standing at a fixed point, wearing whatever `worn` names. */
const hero = (worn: ItemSpec[] = []): Wearer => ({ x: 0.5, y: 0.5, name: 'Hero', gender: 'male', worn });
/** A female wearer standing at the same point. */
const heroine = (worn: ItemSpec[] = []): Wearer => ({ x: 0.5, y: 0.5, name: 'Heroine', gender: 'female', worn });

describe('placementFor', () => {
  it('accepts a sword dropped in the hand zone of a male wearer', () => {
    const w = hero();
    expect(placementFor(sword, w, slotZone(w, 'hand'))).toEqual({ ok: true, slot: 'hand', load: 6 });
  });

  it('accepts a hat dropped on the head zone', () => {
    const w = hero();
    expect(placementFor(hat, w, slotZone(w, 'head'))).toEqual({ ok: true, slot: 'head', load: 1 });
  });

  it('accepts glasses dropped on the eyes zone', () => {
    const w = hero();
    expect(placementFor(glasses, w, slotZone(w, 'eyes'))).toEqual({ ok: true, slot: 'eyes', load: 0.5 });
  });

  it('rejects a sword dropped on the head zone', () => {
    const w = hero();
    const result = placementFor(sword, w, slotZone(w, 'head'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/hand/);
  });

  it('rejects a hat dropped on the hand zone', () => {
    const w = hero();
    expect(placementFor(hat, w, slotZone(w, 'hand')).ok).toBe(false);
  });

  it('rejects glasses dropped on the head zone', () => {
    const w = hero();
    expect(placementFor(glasses, w, slotZone(w, 'head')).ok).toBe(false);
  });

  it('rejects a rose hat dropped on a male head', () => {
    const w = hero();
    const result = placementFor(roseHat, w, slotZone(w, 'head'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/female/);
  });

  it('rejects a hat dropped on a female head', () => {
    const w = heroine();
    expect(placementFor(hat, w, slotZone(w, 'head')).ok).toBe(false);
  });

  it('rejects a drop on the character body but not on any slot', () => {
    const w = hero();
    expect(placementFor(sword, w, { x: w.x, y: w.y + CHARACTER_SIZE.hh }).ok).toBe(false);
  });

  it('rejects a second hat dropped on an occupied head slot', () => {
    const w = hero([hat]);
    expect(placementFor(spareHat, w, slotZone(w, 'head')).ok).toBe(false);
  });

  it('rejects a drop that would push the load to the limit', () => {
    const w = hero([armor, sword]);
    expect(placementFor(hat, w, slotZone(w, 'head')).ok).toBe(false);
  });

  it('accepts a drop that keeps the load under the limit', () => {
    const w = hero([armor]);
    expect(placementFor(sword, w, slotZone(w, 'hand'))).toEqual({ ok: true, slot: 'hand', load: 19 });
  });
});

describe('speedFactor', () => {
  it('is 1 for no load', () => {
    expect(speedFactor(0)).toBe(1);
  });

  it('is 0.75 for a 5 kg load', () => {
    expect(speedFactor(5)).toBeCloseTo(0.75);
  });

  it('is 0.5 for a 10 kg load', () => {
    expect(speedFactor(10)).toBeCloseTo(0.5);
  });

  it('is close to 0.05 for a 19 kg load', () => {
    expect(speedFactor(19)).toBeCloseTo(0.05);
  });

  it('throws RangeError at the 20 kg load limit', () => {
    expect(() => speedFactor(20)).toThrow(RangeError);
  });

  it('throws RangeError above the load limit', () => {
    expect(() => speedFactor(25)).toThrow(RangeError);
  });

  it('throws RangeError for a negative load', () => {
    expect(() => speedFactor(-1)).toThrow(RangeError);
  });
});

describe('loadOf', () => {
  it('sums the weights of the given items', () => {
    expect(loadOf([armor, sword])).toBe(19);
  });
});

describe('slotAt', () => {
  it('returns null for a point away from the character', () => {
    expect(slotAt(hero(), { x: 0, y: 0 })).toBeNull();
  });
});

describe('findItemSpec', () => {
  it('finds an item regardless of letter case', () => {
    expect(findItemSpec('sword')?.name).toBe('Sword');
    expect(findItemSpec('SWORD')?.name).toBe('Sword');
  });

  it('returns null for an unknown name', () => {
    expect(findItemSpec('Shield')).toBeNull();
  });
});
