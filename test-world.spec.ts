import { describe, expect, it } from 'vitest';
import { BAG, CHEST, CHEST_REACH, TRASH, WALK_STEP, WORLD_ICONS, findWorldElement, initialWorld, itemPoint, itemsIn, loadFor, windowClose, windowRect, wornBy, worldClick, worldContext, worldDoubleClick, worldDrag, worldElements, worldKey, worldTick, worldType, type World } from './test-world.js';
import { slotZone } from './test-world-items.js';

const char = (w: World, name: string) => w.characters.find((c) => c.name === name)!;
const item = (w: World, name: string) => w.items.find((i) => i.spec.name === name)!;
const at = (w: World, name: string) => itemPoint(w, item(w, name))!;
const equip = (w: World, name: string, who: string, slot: 'hand' | 'head' | 'eyes') => worldDrag(w, at(w, name), slotZone(char(w, who), slot));
const icon = (label: string) => WORLD_ICONS.find((i) => i.label === label)!;
/** Rose walked next to the chest and the chest opened. */
function chestOpened(): World {
  const w = initialWorld();
  const rose = char(w, 'Rose');
  const moved = worldDrag(w, rose, { x: CHEST.x - 0.1, y: rose.y }).world;
  return worldDoubleClick(moved, CHEST).world;
}

describe('worldDrag', () => {
  it('equips the sword in the hero hand and adds its weight', () => {
    const r = equip(initialWorld(), 'Sword', 'Hero', 'hand');
    expect(r.ok).toBe(true);
    expect(r.grabbed).toBe('Sword');
    expect(wornBy(r.world, 'Hero').map((s) => s.name)).toEqual(['Sword']);
    expect(loadFor(r.world, 'Hero')).toBe(6);
  });

  it('rejects the hat in the hand and leaves it where it was', () => {
    const w = initialWorld();
    const before = at(w, 'Hat');
    const r = equip(w, 'Hat', 'Hero', 'hand');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/^Rejected/);
    expect(item(r.world, 'Hat').place).toEqual({ kind: 'floor', ...before });
  });

  it('places the glasses over the eyes', () => {
    const r = equip(initialWorld(), 'Glasses', 'Hero', 'eyes');
    expect(r.ok).toBe(true);
    expect(item(r.world, 'Glasses').place).toEqual({ kind: 'worn', who: 'Hero' });
  });

  it('carries a loaded character only speedFactor of the drag', () => {
    const w = equip(initialWorld(), 'Sword', 'Hero', 'hand').world;
    const hero = char(w, 'Hero');
    const r = worldDrag(w, hero, { x: hero.x + 0.1, y: hero.y });
    expect(char(r.world, 'Hero').x - hero.x).toBeCloseTo(0.07);
  });

  it('discards to the Trash, saves to the Bag and takes the last saved item back out', () => {
    let w = chestOpened();
    w = worldDrag(w, at(w, 'Spare hat'), TRASH).world;
    expect(itemsIn(w, 'trash').map((i) => i.spec.name)).toEqual(['Spare hat']);
    w = worldDrag(w, at(w, 'Armor'), BAG).world;
    expect(itemsIn(w, 'bag').map((i) => i.spec.name)).toEqual(['Armor']);
    const r = worldDrag(w, BAG, { x: 0.5, y: 0.85 });
    expect(r.grabbed).toBe('Armor');
    expect(item(r.world, 'Armor').place).toEqual({ kind: 'floor', x: 0.5, y: 0.85 });
  });

  it('grabs nothing on an empty point', () => {
    expect(worldDrag(initialWorld(), { x: 0.5, y: 0.2 }, { x: 0.6, y: 0.2 }).ok).toBe(false);
  });
});

describe('worldTick', () => {
  it('walks at a speed scaled by the load and stops when clicked again', () => {
    let w = worldClick(initialWorld(), char(initialWorld(), 'Hero')).world;
    const x0 = char(w, 'Hero').x;
    w = worldTick(w);
    expect(char(w, 'Hero').x - x0).toBeCloseTo(WALK_STEP);
    w = equip(w, 'Sword', 'Hero', 'hand').world;
    const x1 = char(w, 'Hero').x;
    w = worldTick(w);
    expect(char(w, 'Hero').x - x1).toBeCloseTo(WALK_STEP * 0.7);
    w = worldClick(w, char(w, 'Hero')).world;
    const x2 = char(w, 'Hero').x;
    expect(char(worldTick(w), 'Hero').x).toBe(x2);
  });
});

describe('worldDoubleClick', () => {
  it('opens the chest only with a character within reach', () => {
    const w = initialWorld();
    expect(w.characters.every((c) => Math.abs(c.x - CHEST.x) > CHEST_REACH)).toBe(true);
    const r = worldDoubleClick(w, CHEST);
    expect(r.ok).toBe(false);
    expect(r.world.chestOpen).toBe(false);
    const open = chestOpened();
    expect(open.chestOpen).toBe(true);
    expect(itemsIn(open, 'chest').every((i) => itemPoint(open, i))).toBe(true);
  });

  it('lets female items fit only the female character', () => {
    const w = chestOpened();
    expect(equip(w, 'Rose sword', 'Rose', 'hand').ok).toBe(true);
    const wrong = equip(w, 'Rose sword', 'Hero', 'hand');
    expect(wrong.ok).toBe(false);
    expect(wrong.message).toMatch(/female/);
  });

  it('opens a box with content and reports a plain box', () => {
    const w = initialWorld();
    const gift = w.boxes.find((b) => b.label === 'Gift box')!;
    const crate = w.boxes.find((b) => b.label === 'Crate')!;
    const opened = worldDoubleClick(w, gift);
    expect(opened.ok).toBe(true);
    expect(opened.world.windows.map((x) => x.title)).toEqual(['Gift box']);
    const plain = worldDoubleClick(w, crate);
    expect(plain.ok).toBe(false);
    expect(plain.message).toMatch(/just a box/);
    expect(plain.world.windows).toEqual([]);
    const dragged = worldDrag(w, crate, { x: 0.3, y: 0.3 });
    expect(dragged.world.boxes.find((b) => b.label === 'Crate')).toMatchObject({ x: 0.3, y: 0.3 });
  });

  it('closes a window from its close button and focuses one clicked inside', () => {
    let w = worldDoubleClick(initialWorld(), icon('Notes')).world;
    w = worldDoubleClick(w, icon('Calc')).world;
    const focused = worldClick(w, { x: windowRect(0).x + 0.01, y: 0.15 }).world;
    expect(focused.windows.at(-1)!.title).toBe('Notes');
    const closed = worldClick(w, windowClose(1)).world;
    expect(closed.windows.map((x) => x.title)).toEqual(['Notes']);
  });
});

describe('worldType', () => {
  it('types into Notes with Enter and Backspace', () => {
    let w = worldDoubleClick(initialWorld(), icon('Notes')).world;
    w = worldType(w, 'hello').world;
    expect(w.windows.at(-1)!.input).toBe('hello');
    w = worldType(worldKey(w, 'Enter').world, 'xy').world;
    expect(w.windows.at(-1)!.lines).toEqual(['hello', 'xy']);
    w = worldKey(w, 'Backspace').world;
    expect(w.windows.at(-1)!.lines).toEqual(['hello', 'x']);
  });

  it('evaluates the calculator on Enter or =', () => {
    const w = worldDoubleClick(initialWorld(), icon('Calc')).world;
    const r = worldKey(worldType(w, '12*3').world, 'Enter');
    expect(r.ok).toBe(true);
    expect(r.message).toContain('36');
    expect(r.world.windows.at(-1)!.lines[0]).toContain('= 36');
    expect(worldType(w, '2+2=').message).toContain('= 4');
    expect(worldType(w, 'abc=').ok).toBe(false);
  });

  it('fails with no focused window', () => {
    expect(worldType(initialWorld(), 'hi').ok).toBe(false);
  });
});

describe('worldElements', () => {
  it('lists slots, fixtures and boxes and resolves names', () => {
    const w = initialWorld();
    const names = worldElements(w).map((e) => e.name);
    for (const n of ['Hero hand', 'Rose head', 'Treasure chest', 'Trash', 'Bag', 'Gift box', 'Notes icon']) expect(names).toContain(n);
    expect(findWorldElement(w, 'sword')?.name).toBe('Sword');
    expect(findWorldElement(w, 'the trash')?.name).toBe('Trash');
  });

  it('describes load and speed in the planning context', () => {
    const lines = worldContext(equip(initialWorld(), 'Sword', 'Hero', 'hand').world);
    expect(lines.find((l) => l.includes('Hero'))).toMatch(/load 6 kg, speed 70%/);
  });

  it('a click on empty floor hits nothing', () => {
    expect(worldClick(initialWorld(), { x: 0.5, y: 0.2 }).message).toMatch(/nothing/);
  });
});
