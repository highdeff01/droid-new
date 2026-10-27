/**
 * The test world: a second demo scene for user and AI testing. Boxes (some open a small window,
 * some are just boxes), a Notes typing area and a working calculator, two characters that walk,
 * stand still or are dragged, equippable items with placement detection and weight physics, a
 * treasure chest a character must stand near to open, and a Trash and a Bag for leftover items.
 * Every function is a pure reducer over `World`, driven by the demo's click, double-click,
 * drag, type, key and tick events.
 */
import { calculate } from './planner.js';
import { sameElement } from './rearrange.js';
import { CHARACTER_SIZE, ITEM_SIZE, findItemSpec, loadOf, onCharacter, placementFor, slotText, slotZone, speedFactor, type Gender, type ItemSpec, type Point, type Wearer } from './test-world-items.js';

/** Where an item is: loose on the floor, in the chest, saved in the Bag, discarded in the Trash, or worn by a character. */
export type ItemPlace = { kind: 'floor'; x: number; y: number } | { kind: 'chest' } | { kind: 'bag' } | { kind: 'trash' } | { kind: 'worn'; who: string };

/** One item instance in the world. */
export interface WorldItem {
  spec: ItemSpec;
  place: ItemPlace;
}

/** A character: where it stands, who it is, and whether it walks (and which way). */
export interface Character extends Point {
  name: string;
  gender: Gender;
  walking: boolean;
  dir: 1 | -1;
}

/** A box on the floor: what its window shows when opened, or null when it is just a box. */
export interface WorldBox extends Point {
  label: string;
  content: string[] | null;
}

/** What a small window is for: the Notes typing area, the calculator, or a box's content. */
export type WindowKind = 'notes' | 'calc' | 'box';

/** An open window: its typed input and the lines it shows. The last window is the focused one. */
export interface WorldWindow {
  title: string;
  kind: WindowKind;
  input: string;
  lines: string[];
}

/** The whole test world. */
export interface World {
  characters: Character[];
  items: WorldItem[];
  boxes: WorldBox[];
  windows: WorldWindow[];
  chestOpen: boolean;
}

/** What one event did: the next world, the log message, whether it succeeded and what a drag grabbed. */
export interface WorldResult {
  world: World;
  message: string;
  ok: boolean;
  grabbed?: string;
}

/** A named element of the world with its normalized center and half-size, for the element map. */
export interface WorldElement extends Point {
  name: string;
  hw: number;
  hh: number;
}

type Rect = Point & { hw: number; hh: number };

/** The taskbar button that switches between the Desktop and the test World (both scenes draw it). */
export const WORLD_TOGGLE: Rect = { x: 0.06, y: 0.965, hw: 0.045, hh: 0.03 };
/** Whether `p` is on the taskbar World/Desktop button. */
export const onWorldToggle = (p: Point) => Math.abs(p.x - WORLD_TOGGLE.x) <= WORLD_TOGGLE.hw && Math.abs(p.y - WORLD_TOGGLE.y) <= WORLD_TOGGLE.hh;
/** The treasure chest. */
export const CHEST: Rect = { x: 0.86, y: 0.5, hw: 0.05, hh: 0.06 };
/** Where an item is dropped to discard it. */
export const TRASH: Rect = { x: 0.94, y: 0.84, hw: 0.035, hh: 0.05 };
/** Where an item is dropped to save it for later; a drag from it takes the last saved item out. */
export const BAG: Rect = { x: 0.84, y: 0.84, hw: 0.035, hh: 0.05 };
/** Half-size of a box. */
export const BOX_SIZE = { hw: 0.03, hh: 0.05 } as const;
/** The Notes and Calc icons that open the typing area and the calculator. */
export const WORLD_ICONS: readonly (Rect & { label: string; kind: 'notes' | 'calc' })[] = [
  { label: 'Notes', kind: 'notes', x: 0.055, y: 0.105, hw: 0.025, hh: 0.045 },
  { label: 'Calc', kind: 'calc', x: 0.055, y: 0.265, hw: 0.025, hh: 0.045 },
];
/** Horizontal distance within which a character can reach the chest. */
export const CHEST_REACH = 0.15;
/** Distance a walking, unloaded character covers per tick (normalized). */
export const WALK_STEP = 0.01;
/** The band characters walk in. */
const WALK_RANGE = { min: 0.22, max: 0.72 } as const;
const FLOOR_BOTTOM = 0.93;

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const inRect = (p: Point, r: Rect) => Math.abs(p.x - r.x) <= r.hw && Math.abs(p.y - r.y) <= r.hh;
const clampTo = (p: Point, hw: number, hh: number): Point => ({ x: Math.min(1 - hw, Math.max(hw, p.x)), y: Math.min(FLOOR_BOTTOM - hh, Math.max(hh, p.y)) });
const spec = (name: string) => findItemSpec(name)!;
const result = (world: World, message: string, ok = true, grabbed?: string): WorldResult => ({ world, message, ok, ...(grabbed ? { grabbed } : {}) });

/** The test world as it starts: Hero and Rose standing, the male set on the floor, the female set and spares in the closed chest. */
export function initialWorld(): World {
  const floor = (name: string, x: number): WorldItem => ({ spec: spec(name), place: { kind: 'floor', x, y: 0.85 } });
  const chest = (name: string): WorldItem => ({ spec: spec(name), place: { kind: 'chest' } });
  return {
    characters: [
      { name: 'Hero', gender: 'male', x: 0.35, y: 0.55, walking: false, dir: 1 },
      { name: 'Rose', gender: 'female', x: 0.6, y: 0.55, walking: false, dir: -1 },
    ],
    items: [floor('Sword', 0.3), floor('Hat', 0.38), floor('Glasses', 0.46), chest('Rose sword'), chest('Rose hat'), chest('Rose glasses'), chest('Armor'), chest('Spare hat')],
    boxes: [
      { label: 'Gift box', x: 0.14, y: 0.42, content: ['A letter:', 'Meet Rose at the chapel.'] },
      { label: 'Crate', x: 0.14, y: 0.58, content: null },
      { label: 'Toolbox', x: 0.14, y: 0.74, content: ['A map:', 'The dragon sleeps in the north cave.'] },
    ],
    windows: [],
    chestOpen: false,
  };
}

/** Screen box of the window at stack index `i` (top-left corner and size). */
export const windowRect = (i: number) => ({ x: 0.2 + i * 0.05, y: 0.04, w: 0.3, h: 0.22 });
/** The close button of the window at stack index `i`. */
export const windowClose = (i: number): Rect => {
  const r = windowRect(i);
  return { x: r.x + r.w - 0.015, y: r.y + 0.025, hw: 0.015, hh: 0.025 };
};
/** Where the `i`th chest item shows while the chest is open: a row above the chest. */
export const chestSlot = (i: number): Point => ({ x: 0.7 + i * 0.06, y: 0.25 });

/** The items `who` wears. */
export const wornBy = (w: World, who: string) => w.items.filter((i) => i.place.kind === 'worn' && i.place.who === who).map((i) => i.spec);
/** Kilograms `who` carries. */
export const loadFor = (w: World, who: string) => loadOf(wornBy(w, who));
/** The items in one place kind (chest, bag or trash), in order. */
export const itemsIn = (w: World, kind: 'chest' | 'bag' | 'trash') => w.items.filter((i) => i.place.kind === kind);

/** Where an item shows on screen, or null when it is hidden (bag, trash, closed chest). */
export function itemPoint(w: World, item: WorldItem): Point | null {
  const p = item.place;
  if (p.kind === 'floor') return { x: p.x, y: p.y };
  if (p.kind === 'chest') return w.chestOpen ? chestSlot(itemsIn(w, 'chest').indexOf(item)) : null;
  if (p.kind !== 'worn') return null;
  const c = w.characters.find((ch) => ch.name === p.who);
  return c ? slotZone(c, item.spec.slot) : null;
}

/** Moves `item` to `place`, appending it last so the Bag's last saved item is the newest. */
const placeItem = (w: World, item: WorldItem, place: ItemPlace): World => ({ ...w, items: [...w.items.filter((i) => i !== item), { ...item, place }] });

/** `c` as a wearer, leaving out `except` (an item being moved off it). */
const wearerOf = (w: World, c: Character, except: WorldItem): Wearer => ({ ...c, worn: w.items.filter((i) => i !== except && i.place.kind === 'worn' && i.place.who === c.name).map((i) => i.spec) });

const speedText = (w: World, who: string) => `load ${loadFor(w, who)} kg, speed ${pct(speedFactor(loadFor(w, who)))}`;

/** Places a grabbed item on a character: correct placement equips it, a wrong one is rejected and nothing moves. */
function dropOnCharacter(w: World, item: WorldItem, c: Character, to: Point): WorldResult {
  const verdict = placementFor(item.spec, wearerOf(w, c, item), to);
  if (!verdict.ok) return result(w, `Rejected: ${verdict.reason}`, false);
  const next = placeItem(w, item, { kind: 'worn', who: c.name });
  return result(next, `Placed ${item.spec.name} ${slotText(verdict.slot)} of ${c.name} — correct (${speedText(next, c.name)})`, true, item.spec.name);
}

/** Drops a grabbed item at `to`: into the Trash, the Bag or the chest, onto a character, or loose on the floor. */
function dropItem(w: World, item: WorldItem, to: Point): WorldResult {
  const name = item.spec.name;
  if (inRect(to, TRASH)) return result(placeItem(w, item, { kind: 'trash' }), `Discarded ${name} in the Trash`, true, name);
  if (inRect(to, BAG)) return result(placeItem(w, item, { kind: 'bag' }), `Saved ${name} in the Bag for later`, true, name);
  const c = w.characters.find((ch) => onCharacter(ch, to));
  if (c) return dropOnCharacter(w, item, c, to);
  if (inRect(to, CHEST)) return result(placeItem(w, item, { kind: 'chest' }), `Put ${name} in the treasure chest`, true, name);
  const at = clampTo(to, ITEM_SIZE.hw, ITEM_SIZE.hh);
  return result(placeItem(w, item, { kind: 'floor', ...at }), `Dragged ${name} to (${pct(at.x)}, ${pct(at.y)})`, true, name);
}

/** The visible item under `p`: a worn item's slot zone, or an item's own box. */
function itemUnder(w: World, p: Point): WorldItem | null {
  return [...w.items].reverse().find((item) => {
    const at = itemPoint(w, item);
    if (!at) return false;
    return item.place.kind === 'worn' ? inRect(p, at as Rect) : inRect(p, { ...at, ...ITEM_SIZE });
  }) ?? null;
}

const grabItem = (w: World, from: Point, to: Point) => {
  const item = itemUnder(w, from);
  return item ? dropItem(w, item, to) : null;
};

const grabFromBag = (w: World, from: Point, to: Point) => {
  const last = itemsIn(w, 'bag').at(-1);
  return last && inRect(from, BAG) ? dropItem(w, last, to) : null;
};

const grabBox = (w: World, from: Point, to: Point) => {
  const box = w.boxes.find((b) => inRect(from, { ...b, ...BOX_SIZE }));
  if (!box) return null;
  const moved = { ...box, ...clampTo(to, BOX_SIZE.hw, BOX_SIZE.hh) };
  return result({ ...w, boxes: w.boxes.map((b) => (b === box ? moved : b)) }, `Dragged "${box.label}" to (${pct(moved.x)}, ${pct(moved.y)})`, true, box.label);
};

/** Dragging a character carries it only `speedFactor` of the way: a loaded character stops short. */
const grabCharacter = (w: World, from: Point, to: Point) => {
  const c = w.characters.find((ch) => inRect(from, { ...ch, ...CHARACTER_SIZE }));
  if (!c) return null;
  const factor = speedFactor(loadFor(w, c.name));
  const moved = { ...c, ...clampTo({ x: c.x + (to.x - from.x) * factor, y: c.y + (to.y - from.y) * factor }, CHARACTER_SIZE.hw, CHARACTER_SIZE.hh) };
  const next = { ...w, characters: w.characters.map((ch) => (ch === c ? moved : ch)) };
  return result(next, `Dragged ${c.name} to (${pct(moved.x)}, ${pct(moved.y)}) — carried at ${pct(factor)} speed under ${loadFor(w, c.name)} kg`, true, c.name);
};

const GRABBERS: ((w: World, from: Point, to: Point) => WorldResult | null)[] = [grabItem, grabFromBag, grabBox, grabCharacter];

/** A drag from `from` to `to`: moves an item (placing, discarding, saving or storing it), a box or a character. */
export function worldDrag(w: World, from: Point, to: Point): WorldResult {
  for (const grab of GRABBERS) {
    const r = grab(w, from, to);
    if (r) return r;
  }
  return result(w, 'Drag grabbed nothing — no draggable item at the start point', false);
}

/** Stack index of the window under `p` (topmost first), or -1. */
function windowAt(w: World, p: Point): number {
  for (let i = w.windows.length - 1; i >= 0; i--) {
    const r = windowRect(i);
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return i;
  }
  return -1;
}

/** Brings the window at `i` to the front (focus). */
const focusWindow = (w: World, i: number): World => ({ ...w, windows: [...w.windows.filter((_, j) => j !== i), w.windows[i]] });

/** A click inside the window at `i`: its close button closes it, anywhere else focuses it. */
function clickWindow(w: World, i: number, p: Point): WorldResult {
  const win = w.windows[i];
  if (inRect(p, windowClose(i))) return result({ ...w, windows: w.windows.filter((_, j) => j !== i) }, `Closed the ${win.title} window`);
  return result(focusWindow(w, i), `Focused the ${win.title} window`);
}

/** A single click: on a window (close or focus), on a character (toggle walking / standing still), else nothing. */
export function worldClick(w: World, p: Point): WorldResult {
  const i = windowAt(w, p);
  if (i >= 0) return clickWindow(w, i, p);
  const c = w.characters.find((ch) => inRect(p, { ...ch, ...CHARACTER_SIZE }));
  if (!c) return result(w, 'Click hit nothing interactive', false);
  const moved = { ...c, walking: !c.walking };
  return result({ ...w, characters: w.characters.map((ch) => (ch === c ? moved : ch)) }, `${c.name} ${moved.walking ? 'starts walking' : 'stands still'}`);
}

/** Opens (or focuses, when already open) the window titled `title`. */
function openWindow(w: World, kind: WindowKind, title: string, lines: string[]): World {
  const i = w.windows.findIndex((win) => win.title === title);
  return i >= 0 ? focusWindow(w, i) : { ...w, windows: [...w.windows, { title, kind, input: '', lines }] };
}

const WINDOW_START: Record<'notes' | 'calc', string[]> = { notes: ['Type here…'], calc: ['Type an expression, then = or Enter'] };

/** Double-clicking a box: one with content opens its window, one without is reported as just a box. */
function openBox(w: World, box: WorldBox): WorldResult {
  if (!box.content) return result(w, `"${box.label}" is just a box — it does not open`, false);
  return result(openWindow(w, 'box', box.label, box.content), `Opened "${box.label}": ${box.content.join(' ')}`);
}

/** Double-clicking the chest: it opens only while a character stands within reach. */
function openChest(w: World): WorldResult {
  if (w.chestOpen) return result(w, `The treasure chest is already open: ${chestText(w)}`);
  const near = w.characters.find((c) => Math.abs(c.x - CHEST.x) <= CHEST_REACH);
  if (!near) return result(w, `Chest blocked — no character within reach (stand within ${pct(CHEST_REACH)} of it)`, false);
  const next = { ...w, chestOpen: true };
  return result(next, `${near.name} opened the treasure chest: ${chestText(next)}`);
}

const chestText = (w: World) => itemsIn(w, 'chest').map((i) => i.spec.name).join(', ') || 'empty';

/** A double-click: opens a box, the Notes or Calc icon, or the chest; focuses a window; otherwise acts as a click. */
export function worldDoubleClick(w: World, p: Point): WorldResult {
  const i = windowAt(w, p);
  if (i >= 0) return clickWindow(w, i, p);
  const icon = WORLD_ICONS.find((ic) => inRect(p, ic));
  if (icon) return result(openWindow(w, icon.kind, icon.label, WINDOW_START[icon.kind]), `Opened ${icon.label}`);
  const box = w.boxes.find((b) => inRect(p, { ...b, ...BOX_SIZE }));
  if (box) return openBox(w, box);
  if (inRect(p, CHEST)) return openChest(w);
  return worldClick(w, p);
}

/** Replaces the focused (last) window. */
const withFocused = (w: World, win: WorldWindow): World => ({ ...w, windows: [...w.windows.slice(0, -1), win] });

/** Evaluates the calculator's input: its window shows the result line and the input clears. */
function evaluate(win: WorldWindow): { win: WorldWindow; message: string; ok: boolean } {
  const v = calculate(win.input);
  if (v === null) return { win: { ...win, input: '', lines: [`"${win.input}" is not valid`] }, message: `Calculator: "${win.input}" is not a valid expression`, ok: false };
  return { win: { ...win, input: '', lines: [`${win.input} = ${v}`] }, message: `Calculator: ${win.input} = ${v}`, ok: true };
}

/** Types `text` into the calculator: "=" evaluates what was typed before it. */
function typeCalc(win: WorldWindow, text: string): { win: WorldWindow; message: string; ok: boolean } {
  let out = { win, message: '', ok: true };
  for (const ch of text) out = ch === '=' ? evaluate(out.win) : { win: { ...out.win, input: out.win.input + ch, lines: [out.win.input + ch] }, message: '', ok: true };
  return out.message ? out : { ...out, message: `Calculator input: ${out.win.input}` };
}

/** Types `text` into the focused window: Notes appends it, the calculator takes an expression; nothing focused fails. */
export function worldType(w: World, text: string): WorldResult {
  const win = w.windows.at(-1);
  if (!win) return result(w, 'Typing went nowhere — no window is focused', false);
  if (win.kind === 'calc') {
    const r = typeCalc(win, text);
    return result(withFocused(w, r.win), r.message, r.ok);
  }
  if (win.kind === 'box') return result(w, `The ${win.title} window does not take typing`, false);
  const input = win.input + text;
  return result(withFocused(w, { ...win, input, lines: input.split('\n') }), `Typed "${text}" into ${win.title}`);
}

/** A key press on the focused window: Enter evaluates the calculator or breaks a Notes line, Backspace deletes. */
export function worldKey(w: World, key: string): WorldResult {
  const win = w.windows.at(-1);
  if (!win) return result(w, `Key ${key} went nowhere — no window is focused`, false);
  if (key === 'Enter' && win.kind === 'calc') {
    const r = evaluate(win);
    return result(withFocused(w, r.win), r.message, r.ok);
  }
  if (key === 'Enter') return worldType(w, '\n');
  if (key !== 'Backspace' || win.kind === 'box') return result(w, `Key ${key} has no effect in ${win.title}`, false);
  const input = win.input.slice(0, -1);
  return result(withFocused(w, { ...win, input, lines: win.kind === 'notes' ? input.split('\n') : [input] }), `Deleted a character in ${win.title}`);
}

/** One walking step for `c`: its speed scaled by its load, turning around at the edges of its band. */
function walk(w: World, c: Character): Character {
  if (!c.walking) return c;
  const x = c.x + c.dir * WALK_STEP * speedFactor(loadFor(w, c.name));
  if (x > WALK_RANGE.max) return { ...c, x: WALK_RANGE.max, dir: -1 };
  if (x < WALK_RANGE.min) return { ...c, x: WALK_RANGE.min, dir: 1 };
  return { ...c, x };
}

/** Advances the world one tick: walking characters move at their weight-adjusted speed. */
export const worldTick = (w: World): World => ({ ...w, characters: w.characters.map((c) => walk(w, c)) });

/** Every element of the world on screen, for the element map: characters and their slots, items, boxes, chest, Trash, Bag, icons, windows. */
export function worldElements(w: World): WorldElement[] {
  const slots = w.characters.flatMap((c) => [{ ...c, ...CHARACTER_SIZE }, ...(['hand', 'head', 'eyes'] as const).map((s) => ({ name: `${c.name} ${s}`, ...slotZone(c, s) }))]);
  const items = w.items.flatMap((i) => {
    const at = itemPoint(w, i);
    return at ? [{ name: i.spec.name, x: at.x, y: at.y, ...ITEM_SIZE }] : [];
  });
  const fixed = [{ name: 'Treasure chest', ...CHEST }, { name: 'Trash', ...TRASH }, { name: 'Bag', ...BAG }, { name: 'World button', ...WORLD_TOGGLE }];
  const windows = w.windows.map((win, i) => {
    const r = windowRect(i);
    return { name: `${win.title} window`, x: r.x + r.w / 2, y: r.y + r.h / 2, hw: r.w / 2, hh: r.h / 2 };
  });
  return [...slots, ...items, ...w.boxes.map((b) => ({ name: b.label, x: b.x, y: b.y, ...BOX_SIZE })), ...WORLD_ICONS.map((ic) => ({ ...ic, name: `${ic.label} icon` })), ...fixed, ...windows];
}

/** The element named `name` (exact first, then the same-element rule), or null. */
export function findWorldElement(w: World, name: string): WorldElement | null {
  const all = worldElements(w);
  const key = name.trim().toLowerCase();
  return all.find((e) => e.name.toLowerCase() === key) ?? all.find((e) => sameElement(e.name, name)) ?? null;
}

const placeText = (p: ItemPlace) => (p.kind === 'floor' ? `on the floor at (${pct(p.x)}, ${pct(p.y)})` : p.kind === 'worn' ? `worn by ${p.who}` : `in the ${p.kind === 'chest' ? 'chest' : p.kind === 'bag' ? 'Bag' : 'Trash'}`);

/** The world's state as planning-context lines: characters with load and speed, every item and where it is, the chest and windows. */
export function worldContext(w: World): string[] {
  const chars = w.characters.map((c) => `[Test world] ${c.name} (${c.gender}) at (${pct(c.x)}, ${pct(c.y)}), ${c.walking ? 'walking' : 'standing still'}, wears ${wornBy(w, c.name).map((s) => `${s.name} (${s.slot})`).join(', ') || 'nothing'}, ${speedText(w, c.name)}`);
  const items = w.items.map((i) => `[Test world] ${i.spec.name} — ${i.spec.gender} ${i.spec.slot} item, ${i.spec.weight} kg, ${placeText(i.place)}`);
  const chest = `[Test world] Treasure chest ${w.chestOpen ? 'open' : 'closed (a character must stand within reach to open it)'}`;
  const windows = w.windows.length ? [`[Test world] Open windows: ${w.windows.map((win) => win.title).join(', ')}; typing goes to ${w.windows.at(-1)!.title}`] : [];
  return [...chars, ...items, chest, ...windows];
}
