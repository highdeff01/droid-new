/**
 * The quest world: a third demo scene ported from the HighDeff/droid-new-1 demo game. Game tabs
 * (Games / Custom Game / Char 5 / Start Game), Knight Guy (20 kg) and Mage Girl (15 kg), a Priest
 * with a Talk button and a multi-step dialogue that answers "hi", an equippable Sword, Hat and
 * Glasses, a Treasure Chest with items, a Mystery Box that opens on a double-click, a Calculator
 * and a Dragon Gate the box's Golden Key unlocks. Every function is a pure reducer over `Quest`,
 * driven by the demo's click, double-click, drag, type and key events; the scene shares the
 * demo's sidebar icons, Report/Archive and ad popup.
 */
import { calculate } from './planner.js';
import { sameElement } from './rearrange.js';

type Point = { x: number; y: number };
type Rect = Point & { hw: number; hh: number };

/** The game tab that is selected. */
export type QuestTab = 'menu' | 'custom_game' | 'char_select' | 'in_game';
/** The equippable items. */
export type QuestItemName = 'Sword' | 'Hat' | 'Glasses';

/** A hero: home point, own weight and how many steps it walked forward. */
export interface QuestCharacter extends Point {
  name: string;
  weight: number;
  steps: number;
}

/** An equippable item: where it lies, its weight and who wears it (null: on the floor). */
export interface QuestItem extends Point {
  name: QuestItemName;
  weight: number;
  wornBy: string | null;
}

/** The whole quest world. */
export interface Quest {
  tab: QuestTab;
  selectedChar: number;
  started: boolean;
  characters: QuestCharacter[];
  items: QuestItem[];
  /** The Priest's dialogue: open or not, the line shown and whether he was greeted. */
  priest: { talking: boolean; line: number; greeted: boolean };
  chest: { opened: boolean; items: string[] };
  /** What the party carries: chest items and the Golden Key. */
  inventory: string[];
  mysteryBoxOpened: boolean;
  calc: { input: string; display: string; focused: boolean };
  /** Recent typing outside the Calculator, so "hi" typed key by key still greets the Priest. */
  chat: string;
  gateUnlocked: boolean;
}

/** What one event did: the next quest, the log message, whether it succeeded and what a drag grabbed. */
export interface QuestResult {
  quest: Quest;
  message: string;
  ok: boolean;
  grabbed?: string;
}

/** The kinds of quest element; each kind has one click handler. */
export type QuestKind = 'tab' | 'calculator' | 'gate' | 'mystery_box' | 'chest' | 'chest_item' | 'item' | 'character' | 'priest' | 'talk' | 'next';

/** A named element of the quest on screen, with its normalized center and half-size. */
export interface QuestElement extends Rect {
  name: string;
  kind: QuestKind;
}

/** The taskbar button that switches between the Desktop and the quest world. */
export const QUEST_TOGGLE: Rect = { x: 0.16, y: 0.965, hw: 0.045, hh: 0.03 };
/** The game tabs, left to right. */
export const QUEST_TABS: readonly (Rect & { label: string; tab: QuestTab })[] = [
  { label: 'Games', tab: 'menu', x: 0.21, y: 0.145, hw: 0.05, hh: 0.035 },
  { label: 'Custom Game', tab: 'custom_game', x: 0.34, y: 0.145, hw: 0.07, hh: 0.035 },
  { label: 'Char 5', tab: 'char_select', x: 0.47, y: 0.145, hw: 0.05, hh: 0.035 },
  { label: 'Start Game', tab: 'in_game', x: 0.605, y: 0.145, hw: 0.075, hh: 0.035 },
];
export const CALCULATOR: Rect = { x: 0.5, y: 0.22, hw: 0.085, hh: 0.03 };
export const DRAGON_GATE: Rect = { x: 0.78, y: 0.25, hw: 0.05, hh: 0.07 };
export const MYSTERY_BOX: Rect = { x: 0.28, y: 0.45, hw: 0.026, hh: 0.037 };
export const QUEST_CHEST: Rect = { x: 0.72, y: 0.45, hw: 0.03, hh: 0.04 };
export const PRIEST: Rect = { x: 0.65, y: 0.62, hw: 0.025, hh: 0.06 };
export const TALK_BUTTON: Rect = { x: 0.65, y: 0.51, hw: 0.03, hh: 0.02 };
/** The dialogue bubble (normalized box) and its Next button. */
export const DIALOGUE = { x: 0.45, y: 0.28, w: 0.27, h: 0.12 } as const;
export const NEXT_BUTTON: Rect = { x: 0.68, y: 0.38, hw: 0.028, hh: 0.018 };
export const CHARACTER_BOX = { hw: 0.025, hh: 0.07 } as const;
export const QUEST_ITEM_BOX = { hw: 0.025, hh: 0.025 } as const;
/** How far one step forward moves a hero; a click walks three. */
export const QUEST_STEP = 0.03;
/** Where the Priest's dialogue goes: the opening line, the reply to "hi", then advice. */
export const PRIEST_LINES = [
  'Welcome traveler! Speak to me or type "hi".',
  'Greetings hero! Open the chest, wield your sword, and claim destiny.',
  'Proceed eastward, hero! Wield your sword and unlock the ancient mysteries.',
  'The Dragon Gate opens only with the Golden Key from the Mystery Box.',
] as const;
export const GOLDEN_KEY = 'Golden Key';
const CHEST_SLOTS = [{ x: 0.72, y: 0.555 }, { x: 0.78, y: 0.555 }];
const KNIGHT = 'Knight Guy';
const ARENA = { minX: 0.18, maxX: 0.8, minY: 0.2, maxY: 0.8 } as const;

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const inRect = (r: Rect, p: Point) => Math.abs(p.x - r.x) <= r.hw && Math.abs(p.y - r.y) <= r.hh;
const done = (quest: Quest, message: string, grabbed?: string): QuestResult => ({ quest, message, ok: true, ...(grabbed ? { grabbed } : {}) });
const fail = (quest: Quest, message: string): QuestResult => ({ quest, message, ok: false });

/** Whether `p` is on the taskbar Quest/Desktop button. */
export const onQuestToggle = (p: Point) => inRect(QUEST_TOGGLE, p);

/** The quest world at its start. */
export function initialQuest(): Quest {
  return {
    tab: 'menu',
    selectedChar: 1,
    started: false,
    characters: [{ name: KNIGHT, x: 0.35, y: 0.65, weight: 20, steps: 0 }, { name: 'Mage Girl', x: 0.42, y: 0.65, weight: 15, steps: 0 }],
    items: [{ name: 'Sword', x: 0.52, y: 0.45, weight: 10, wornBy: null }, { name: 'Hat', x: 0.58, y: 0.45, weight: 2, wornBy: null }, { name: 'Glasses', x: 0.64, y: 0.45, weight: 1, wornBy: null }],
    priest: { talking: false, line: 0, greeted: false },
    chest: { opened: false, items: ['Crown', 'Magic Potion'] },
    inventory: [],
    mysteryBoxOpened: false,
    calc: { input: '', display: '25 + 75 = 100', focused: false },
    chat: '',
    gateUnlocked: false,
  };
}

/** Where a hero stands now: its home point moved forward by its steps, kept in the arena. */
export const characterPoint = (c: QuestCharacter): Point => ({ x: Math.min(ARENA.maxX, c.x + c.steps * QUEST_STEP), y: c.y });
/** The items `who` wears. */
export const wornItems = (q: Quest, who: string) => q.items.filter((i) => i.wornBy === who);
/** A hero's own weight plus what it wears. */
export const weightOf = (q: Quest, who: string) => (q.characters.find((c) => c.name === who)?.weight ?? 0) + wornItems(q, who).reduce((s, i) => s + i.weight, 0);
/** Where the chest's `i`-th item shows once it is open. */
export const chestSlot = (i: number): Point => CHEST_SLOTS[i] ?? CHEST_SLOTS[CHEST_SLOTS.length - 1];

/**
 * Every element of the quest on screen, topmost first: the dialogue's Next button, tabs,
 * Calculator, Dragon Gate, Mystery Box, chest and its items, floor items, heroes, Talk and Priest.
 */
export function questElements(q: Quest): QuestElement[] {
  const next: QuestElement[] = q.priest.talking ? [{ name: 'Next', kind: 'next', ...NEXT_BUTTON }] : [];
  const tabs = QUEST_TABS.map((t): QuestElement => ({ name: t.label, kind: 'tab', x: t.x, y: t.y, hw: t.hw, hh: t.hh }));
  const fixed: QuestElement[] = [
    { name: 'Calculator', kind: 'calculator', ...CALCULATOR },
    { name: 'Dragon Gate', kind: 'gate', ...DRAGON_GATE },
    { name: 'Mystery Box', kind: 'mystery_box', ...MYSTERY_BOX },
    { name: 'Treasure Chest', kind: 'chest', ...QUEST_CHEST },
  ];
  const loot = q.chest.opened ? q.chest.items.map((name, i): QuestElement => ({ name, kind: 'chest_item', ...chestSlot(i), ...QUEST_ITEM_BOX })) : [];
  const items = q.items.filter((i) => !i.wornBy).map((i): QuestElement => ({ name: i.name, kind: 'item', x: i.x, y: i.y, ...QUEST_ITEM_BOX }));
  const heroes = q.characters.map((c): QuestElement => ({ name: c.name, kind: 'character', ...characterPoint(c), ...CHARACTER_BOX }));
  const priest: QuestElement[] = [{ name: 'Talk', kind: 'talk', ...TALK_BUTTON }, { name: 'Priest', kind: 'priest', ...PRIEST }];
  return [...next, ...tabs, ...fixed, ...loot, ...items, ...heroes, ...priest];
}

/** The topmost element under `p`, or null. */
export const questElementAt = (q: Quest, p: Point): QuestElement | null => questElements(q).find((e) => inRect(e, p)) ?? null;

/** The element named `name` (exact, case-insensitive, first; then the same-element rule), or null. */
export function findQuestElement(q: Quest, name: string): QuestElement | null {
  const all = questElements(q);
  const key = name.trim().toLowerCase();
  return all.find((e) => e.name.toLowerCase() === key) ?? all.find((e) => sameElement(e.name, name)) ?? null;
}

const withPriest = (q: Quest, priest: Partial<Quest['priest']>): Quest => ({ ...q, priest: { ...q.priest, ...priest } });
const withCalc = (q: Quest, calc: Partial<Quest['calc']>): Quest => ({ ...q, calc: { ...q.calc, ...calc } });

/** A tab click: Char 5 selects character 5, Start Game starts the game. */
function clickTab(q: Quest, el: QuestElement): QuestResult {
  const tab = QUEST_TABS.find((t) => t.label === el.name)!;
  const next: Quest = { ...q, tab: tab.tab, ...(tab.tab === 'char_select' ? { selectedChar: 5 } : {}), ...(tab.tab === 'in_game' ? { started: true } : {}) };
  const said: Record<QuestTab, string> = { menu: 'Switched to the Games tab', custom_game: 'Opened Custom Game mode', char_select: 'Selected Character 5 (Shadow Rogue)', in_game: 'Started the Quest Adventure game' };
  return done(next, said[tab.tab]);
}

/** Opens the dialogue at its first line. */
const talk = (q: Quest): QuestResult => done(withPriest(q, { talking: true, line: 0 }), `Priest: "${PRIEST_LINES[0]}"`);

/** Next advances the dialogue; past its last line it closes. */
function nextLine(q: Quest): QuestResult {
  const line = q.priest.line + 1;
  if (line >= PRIEST_LINES.length) return done(withPriest(q, { talking: false, line: 0 }), 'Closed the Priest dialogue');
  return done(withPriest(q, { line }), `Priest: "${PRIEST_LINES[line]}"`);
}

/** Opens the chest, showing its items. */
const openChest = (q: Quest): QuestResult =>
  q.chest.opened ? fail(q, 'The Treasure Chest is already open') : done({ ...q, chest: { ...q.chest, opened: true } }, `Opened the Treasure Chest: ${q.chest.items.join(', ') || 'empty'}`);

/** Takes an item out of the open chest into the inventory. */
const takeChestItem = (q: Quest, el: QuestElement): QuestResult =>
  done({ ...q, chest: { ...q.chest, items: q.chest.items.filter((i) => i !== el.name) }, inventory: [...q.inventory, el.name] }, `Took ${el.name} from the Treasure Chest`);

/** Puts floor item `name` on `who`. */
function equip(q: Quest, name: string, who: string): QuestResult {
  const items = q.items.map((i) => (i.name === name ? { ...i, wornBy: who } : i));
  const next = { ...q, items };
  return done(next, `Equipped ${name} to ${who} — ${who} now weighs ${weightOf(next, who)} kg`, name);
}

/** A hero walks three steps forward; Mage Girl follows Knight Guy when he gets too far ahead. */
function stepForward(q: Quest, el: QuestElement): QuestResult {
  let characters = q.characters.map((c) => (c.name === el.name ? { ...c, steps: c.steps + 3 } : c));
  const knight = characters.find((c) => c.name === KNIGHT)!;
  if (el.name === KNIGHT) characters = characters.map((c) => (c.name !== KNIGHT && Math.abs(characterPoint(knight).x - characterPoint(c).x) > 0.15 ? { ...c, steps: Math.max(c.steps, knight.steps - 1) } : c));
  return done({ ...q, characters }, `Moved ${el.name} 3 steps forward`);
}

/** The gate opens only with the Golden Key. */
const openGate = (q: Quest): QuestResult => {
  if (q.gateUnlocked) return done(q, 'The Dragon Gate is already open');
  if (!q.inventory.includes(GOLDEN_KEY)) return fail(q, 'The Dragon Gate is locked — it needs the Golden Key from the Mystery Box');
  return done({ ...q, gateUnlocked: true }, 'Unlocked the Dragon Gate with the Golden Key — victory!');
};

/** Opens the Mystery Box: the Golden Key goes into the inventory. */
const openMysteryBox = (q: Quest): QuestResult =>
  q.mysteryBoxOpened ? fail(q, 'The Mystery Box is already open') : done({ ...q, mysteryBoxOpened: true, inventory: [...q.inventory, GOLDEN_KEY] }, 'Opened the Mystery Box: found the Golden Key');

const CLICK: Record<QuestKind, (q: Quest, el: QuestElement) => QuestResult> = {
  tab: clickTab,
  calculator: (q) => done(withCalc(q, { focused: true }), 'Focused the Calculator — typing goes there'),
  gate: openGate,
  mystery_box: (q) => done(q, q.mysteryBoxOpened ? 'The Mystery Box is open and empty' : 'The Mystery Box rattles — double-click it to open'),
  chest: openChest,
  chest_item: takeChestItem,
  item: (q, el) => equip(q, el.name, KNIGHT),
  character: stepForward,
  priest: talk,
  talk,
  next: nextLine,
};

/** A click: the element under `p` acts; a click anywhere but the Calculator takes its focus. */
export function questClick(q: Quest, p: Point): QuestResult {
  const el = questElementAt(q, p);
  if (!el) return fail(q, 'Click hit nothing in the quest world');
  return CLICK[el.kind](el.kind === 'calculator' ? q : withCalc(q, { focused: false }), el);
}

/** A double-click opens the Mystery Box; anywhere else it acts as a click. */
export function questDoubleClick(q: Quest, p: Point): QuestResult {
  return questElementAt(q, p)?.kind === 'mystery_box' ? openMysteryBox(q) : questClick(q, p);
}

/** The hero whose drop zone (generous, so a drop on head or hand counts) contains `p`. */
const heroAt = (q: Quest, p: Point) => q.characters.find((c) => inRect({ ...characterPoint(c), hw: 0.05, hh: 0.1 }, p)) ?? null;

/** Drags a floor item: onto a hero equips it, elsewhere it is put down at the drop point. */
function dragItem(q: Quest, name: string, to: Point): QuestResult {
  const hero = heroAt(q, to);
  if (hero) return equip(q, name, hero.name);
  const at = { x: clamp(to.x, ARENA.minX, ARENA.maxX), y: clamp(to.y, ARENA.minY, ARENA.maxY) };
  return done({ ...q, items: q.items.map((i) => (i.name === name ? { ...i, ...at } : i)) }, `Dragged ${name} to (${pct(at.x)}, ${pct(at.y)})`, name);
}

/** Drags a hero to the drop point; its walked steps reset. */
function dragHero(q: Quest, name: string, to: Point): QuestResult {
  const at = { x: clamp(to.x, ARENA.minX, ARENA.maxX), y: clamp(to.y, ARENA.minY, 0.75) };
  return done({ ...q, characters: q.characters.map((c) => (c.name === name ? { ...c, ...at, steps: 0 } : c)) }, `Dragged ${name} to (${pct(at.x)}, ${pct(at.y)})`, name);
}

/** A drag from `from` to `to`: grabs a floor item or a hero; anything else grabs nothing. */
export function questDrag(q: Quest, from: Point, to: Point): QuestResult {
  const el = questElementAt(q, from);
  if (el?.kind === 'item') return dragItem(q, el.name, to);
  if (el?.kind === 'character') return dragHero(q, el.name, to);
  return fail(q, 'Drag grabbed nothing in the quest world');
}

/** Evaluates the Calculator's input. */
function evaluate(q: Quest): QuestResult {
  const expr = q.calc.input.trim();
  const v = calculate(expr);
  if (v === null) return fail(withCalc(q, { input: '', display: `"${expr}" is not valid` }), `Calculator: "${expr}" is not a valid expression`);
  return done(withCalc(q, { input: '', display: `${expr} = ${v}` }), `Calculator: ${expr} = ${v}`);
}

/** Types into the Calculator: "=" evaluates what was typed before it. */
function typeCalc(q: Quest, text: string): QuestResult {
  let out = done(q, '');
  for (const ch of text) out = ch === '=' ? evaluate(out.quest) : done(withCalc(out.quest, { input: out.quest.calc.input + ch, display: out.quest.calc.input + ch }), '');
  return out.message ? out : { ...out, message: `Calculator input: ${out.quest.calc.input}` };
}

const GREETING = /\b(hi|hello)\b/i;
const EXPRESSION = /^[0-9+\-*/(). =]+$/;
/** How much recent typing the Priest listens to. */
const CHAT_LIMIT = 24;

/**
 * Typing: into the focused Calculator; else "hi" (whole word, in this text or the recent typing) greets
 * the Priest; else an expression goes to the Calculator; anything else is rejected but kept as recent typing.
 */
export function questType(q: Quest, text: string): QuestResult {
  if (q.calc.focused) return typeCalc(q, text);
  const chat = (q.chat + text).slice(-CHAT_LIMIT);
  if (GREETING.test(text) || GREETING.test(chat)) return done({ ...withPriest(q, { talking: true, line: 1, greeted: true }), chat: '' }, `Typed "${text}" — Priest replied: "${PRIEST_LINES[1]}"`);
  if (EXPRESSION.test(text.trim())) return typeCalc(withCalc({ ...q, chat: '' }, { focused: true }), text);
  return fail({ ...q, chat }, `Typing "${text}" went nowhere — focus the Calculator or greet the Priest with "hi"`);
}

/** A key press: Enter evaluates and Backspace deletes in the focused Calculator; nothing else takes keys. */
export function questKey(q: Quest, key: string): QuestResult {
  if (!q.calc.focused) return fail(q, `Key ${key} went nowhere — the Calculator is not focused`);
  if (key === 'Enter') return evaluate(q);
  if (key !== 'Backspace') return fail(q, `Key ${key} has no effect in the Calculator`);
  const input = q.calc.input.slice(0, -1);
  return done(withCalc(q, { input, display: input }), 'Deleted a character in the Calculator');
}

const heroLine = (q: Quest, c: QuestCharacter) => {
  const at = characterPoint(c);
  const worn = wornItems(q, c.name).map((i) => i.name).join(', ') || 'nothing';
  return `[Quest world] ${c.name} at (${pct(at.x)}, ${pct(at.y)}), ${weightOf(q, c.name)} kg (own ${c.weight} kg), wears ${worn}`;
};

/** The quest's state as planning-context lines: tabs, heroes, items, the Priest, chest, box, gate and Calculator. */
export function questContext(q: Quest): string[] {
  const items = q.items.map((i) => `[Quest world] ${i.name} (${i.weight} kg) ${i.wornBy ? `worn by ${i.wornBy}` : `on the floor at (${pct(i.x)}, ${pct(i.y)}) — click equips it to ${KNIGHT}, drag it onto a hero to equip that hero`}`);
  return [
    `[Quest world] Tabs: ${QUEST_TABS.map((t) => t.label).join(' / ')}; selected tab ${q.tab}, character ${q.selectedChar}, game ${q.started ? 'started' : 'not started'}`,
    ...q.characters.map((c) => heroLine(q, c)),
    ...items,
    `[Quest world] Priest ${q.priest.talking ? `is talking: "${PRIEST_LINES[q.priest.line]}" (Next advances)` : 'is silent (click Talk, or type "hi")'}`,
    `[Quest world] Treasure Chest ${q.chest.opened ? `open, holding ${q.chest.items.join(', ') || 'nothing'}` : 'closed'}; inventory: ${q.inventory.join(', ') || 'empty'}`,
    `[Quest world] Mystery Box ${q.mysteryBoxOpened ? 'open' : 'closed (double-click opens it)'}; Dragon Gate ${q.gateUnlocked ? 'unlocked' : 'locked (needs the Golden Key)'}`,
    `[Quest world] Calculator shows "${q.calc.display}"${q.calc.focused ? ' and has focus' : ''}`,
  ];
}
