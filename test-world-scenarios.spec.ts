import { describe, expect, it } from 'vitest';
import { findScenario, progressLines, scenarioComplete, scenarioProgress } from './test-world-scenarios.js';
import { CHEST, initialWorld, TRASH, BAG, worldDoubleClick, worldDrag, type ItemPlace, type World, type WorldResult } from './test-world.js';
import { slotZone } from './test-world-items.js';

const dragon = findScenario('dragon')!;
const wedding = findScenario('wedding')!;

/** Sets one item's place by name on a copy of `w`. */
function withPlace(w: World, name: string, place: ItemPlace): World {
  return { ...w, items: w.items.map((i) => (i.spec.name === name ? { ...i, place } : i)) };
}

/** Sets several items' places by name on a copy of `w`. */
function withPlaces(w: World, placements: Record<string, ItemPlace>): World {
  return Object.entries(placements).reduce((acc, [name, place]) => withPlace(acc, name, place), w);
}

/** Hero and Rose dressed to fight the dragon, chest opened, the spares split between the Trash and the Bag. */
function dragonReadyWorld(): World {
  return {
    ...withPlaces(initialWorld(), {
      Sword: { kind: 'worn', who: 'Hero' },
      Hat: { kind: 'worn', who: 'Hero' },
      Glasses: { kind: 'worn', who: 'Hero' },
      'Rose sword': { kind: 'worn', who: 'Rose' },
      'Rose hat': { kind: 'worn', who: 'Rose' },
      'Rose glasses': { kind: 'worn', who: 'Rose' },
      Armor: { kind: 'trash' },
      'Spare hat': { kind: 'bag' },
    }),
    chestOpen: true,
  };
}

/** Hero and Rose dressed for the wedding (no swords), chest opened, the spares split between the Trash and the Bag. */
function weddingReadyWorld(): World {
  return {
    ...withPlaces(initialWorld(), {
      Hat: { kind: 'worn', who: 'Hero' },
      Glasses: { kind: 'worn', who: 'Hero' },
      'Rose hat': { kind: 'worn', who: 'Rose' },
      'Rose glasses': { kind: 'worn', who: 'Rose' },
      Sword: { kind: 'trash' },
      'Rose sword': { kind: 'bag' },
      Armor: { kind: 'trash' },
      'Spare hat': { kind: 'bag' },
    }),
    chestOpen: true,
  };
}

describe('findScenario', () => {
  it('finds the dragon scenario by id', () => {
    expect(findScenario('dragon')?.id).toBe('dragon');
  });

  it('finds the wedding scenario by its exact title, case-insensitively', () => {
    expect(findScenario('Get married')?.id).toBe('wedding');
  });

  it('finds the wedding scenario from a phrase containing its id', () => {
    expect(findScenario('prepare for the wedding')?.id).toBe('wedding');
  });

  it('returns null for an unknown scenario', () => {
    expect(findScenario('tea party')).toBeNull();
  });
});

describe('scenarioProgress', () => {
  it('has every dragon line undone on the initial world except "wears nothing else"', () => {
    const lines = scenarioProgress(dragon, initialWorld());
    const done = lines.filter((c) => c.done).map((c) => c.label);
    const undone = lines.filter((c) => !c.done).map((c) => c.label);
    expect(done).toEqual(['Hero wears nothing else', 'Rose wears nothing else']);
    expect(undone).toEqual([
      'The treasure chest is opened',
      'Hero wears Sword',
      'Hero wears Hat',
      'Hero wears Glasses',
      'Rose wears Rose sword',
      'Rose wears Rose hat',
      'Rose wears Rose glasses',
      'Every item nobody needs is discarded in the Trash or saved in the Bag (none left loose or in the chest)',
    ]);
  });

  it('marks the dragon outfit lines done once Hero and Rose wear their dragon gear', () => {
    const lines = scenarioProgress(dragon, dragonReadyWorld());
    expect(lines.filter((c) => !c.done)).toEqual([]);
  });

  it('marks the wedding "wears nothing else" lines undone while swords are still worn', () => {
    const lines = scenarioProgress(wedding, dragonReadyWorld());
    const byLabel = Object.fromEntries(lines.map((c) => [c.label, c.done]));
    expect(byLabel['Hero wears nothing else']).toBe(false);
    expect(byLabel['Rose wears nothing else']).toBe(false);
  });

  it('marks the leftovers line undone when an item is left loose on the floor', () => {
    const loose = withPlace(weddingReadyWorld(), 'Spare hat', { kind: 'floor', x: 0.5, y: 0.85 });
    const lines = scenarioProgress(wedding, loose);
    const leftovers = lines.find((c) => c.label.startsWith('Every item nobody needs'));
    expect(leftovers?.done).toBe(false);
  });

  it('formats progress lines with a "[x]" or "[ ]" prefix', () => {
    const lines = progressLines(dragon, initialWorld());
    expect(lines.every((l) => l.startsWith('[x] ') || l.startsWith('[ ] '))).toBe(true);
    expect(progressLines(dragon, dragonReadyWorld()).every((l) => l.startsWith('[x] '))).toBe(true);
  });
});

describe('scenarioComplete', () => {
  it('is false for the initial world', () => {
    expect(scenarioComplete(dragon, initialWorld())).toBe(false);
    expect(scenarioComplete(wedding, initialWorld())).toBe(false);
  });

  it('is true for the dragon scenario once Hero and Rose are dressed for battle and the spares handled', () => {
    expect(scenarioComplete(dragon, dragonReadyWorld())).toBe(true);
  });

  it('is false for the wedding scenario on a world dressed for the dragon (swords worn)', () => {
    expect(scenarioComplete(wedding, dragonReadyWorld())).toBe(false);
  });

  it('is true for the wedding scenario once Hero and Rose are dressed for the ceremony and the swords are gone', () => {
    expect(scenarioComplete(wedding, weddingReadyWorld())).toBe(true);
  });

  it('is false for the dragon scenario on a world dressed for the wedding (no swords worn)', () => {
    expect(scenarioComplete(dragon, weddingReadyWorld())).toBe(false);
  });

  it('is false once a handled item is left loose on the floor', () => {
    const loose = withPlace(weddingReadyWorld(), 'Spare hat', { kind: 'floor', x: 0.5, y: 0.85 });
    expect(scenarioComplete(wedding, loose)).toBe(false);
  });

  it('drives the dragon scenario to completion using only worldDrag and worldDoubleClick', () => {
    const HERO = { x: 0.35, y: 0.55 };
    const ROSE_AT_CHEST = { x: 0.72, y: 0.55 };
    let w = initialWorld();
    const step = (r: WorldResult) => {
      expect(r.ok).toBe(true);
      w = r.world;
    };

    // Walk Rose within reach of the chest by dragging her.
    const rose = w.characters.find((c) => c.name === 'Rose')!;
    step(worldDrag(w, { x: rose.x, y: rose.y }, ROSE_AT_CHEST));

    // Equip Hero with the male set from the floor.
    step(worldDrag(w, { x: 0.3, y: 0.85 }, slotZone(HERO, 'hand')));
    step(worldDrag(w, { x: 0.38, y: 0.85 }, slotZone(HERO, 'head')));
    step(worldDrag(w, { x: 0.46, y: 0.85 }, slotZone(HERO, 'eyes')));

    // Open the treasure chest now that Rose stands within reach.
    step(worldDoubleClick(w, { x: CHEST.x, y: CHEST.y }));

    // Equip Rose from the chest (each item becomes the frontmost chest slot once the prior one is taken).
    step(worldDrag(w, { x: 0.7, y: 0.25 }, slotZone(ROSE_AT_CHEST, 'hand')));
    step(worldDrag(w, { x: 0.7, y: 0.25 }, slotZone(ROSE_AT_CHEST, 'head')));
    step(worldDrag(w, { x: 0.7, y: 0.25 }, slotZone(ROSE_AT_CHEST, 'eyes')));

    // Discard the Armor and save the Spare hat for later.
    step(worldDrag(w, { x: 0.7, y: 0.25 }, { x: TRASH.x, y: TRASH.y }));
    step(worldDrag(w, { x: 0.7, y: 0.25 }, { x: BAG.x, y: BAG.y }));

    expect(scenarioComplete(dragon, w)).toBe(true);
  });
});
