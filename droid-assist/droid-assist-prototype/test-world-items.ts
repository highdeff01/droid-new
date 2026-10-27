/**
 * Equippable items of the test world: what each weighs, which slot of which character it fits,
 * where those slots sit on a character, whether a drop places an item correctly, and how the
 * carried load slows a character down.
 */

/** A normalized point on the demo screen. */
export type Point = { x: number; y: number };

/** Where on a character an item is worn. */
export type Slot = 'hand' | 'head' | 'eyes' | 'body';

/** Which character an item is made for. */
export type Gender = 'male' | 'female';

/** One kind of equippable item. */
export interface ItemSpec {
  name: string;
  slot: Slot;
  gender: Gender;
  /** Kilograms the item adds to its wearer's load. */
  weight: number;
}

/** Every equippable item: the male set, its female (Rose) counterpart and two spares. */
export const ITEM_CATALOG: readonly ItemSpec[] = [
  { name: 'Sword', slot: 'hand', gender: 'male', weight: 6 },
  { name: 'Hat', slot: 'head', gender: 'male', weight: 1 },
  { name: 'Glasses', slot: 'eyes', gender: 'male', weight: 0.5 },
  { name: 'Rose sword', slot: 'hand', gender: 'female', weight: 4 },
  { name: 'Rose hat', slot: 'head', gender: 'female', weight: 1 },
  { name: 'Rose glasses', slot: 'eyes', gender: 'female', weight: 0.5 },
  { name: 'Armor', slot: 'body', gender: 'male', weight: 13 },
  { name: 'Spare hat', slot: 'head', gender: 'male', weight: 1 },
];

/** Kilograms at which a character can no longer move; a load reaching it is refused. */
export const MAX_LOAD = 20;
/** Half-size of an item on the screen (normalized). */
export const ITEM_SIZE = { hw: 0.025, hh: 0.035 } as const;
/** Half-size of a character's body (normalized, around its center). */
export const CHARACTER_SIZE = { hw: 0.04, hh: 0.15 } as const;

/** One slot's zone: its offset from the character's center and its half-size. */
interface Zone {
  dx: number;
  dy: number;
  hw: number;
  hh: number;
}

/** Slot zones relative to the character's center: the hat above the head, glasses over the eyes, the sword in the right hand. */
const SLOT_ZONES: Record<Slot, Zone> = {
  head: { dx: 0, dy: -0.19, hw: 0.035, hh: 0.035 },
  eyes: { dx: 0, dy: -0.11, hw: 0.03, hh: 0.025 },
  hand: { dx: 0.06, dy: 0, hw: 0.025, hh: 0.04 },
  body: { dx: 0, dy: 0.03, hw: 0.03, hh: 0.05 },
};
const SLOTS = Object.keys(SLOT_ZONES) as Slot[];
const SLOT_TEXT: Record<Slot, string> = { hand: 'in the hand', head: 'on the head', eyes: 'on the eyes', body: 'on the body' };

const inBox = (p: Point, c: Point, hw: number, hh: number) => Math.abs(p.x - c.x) <= hw && Math.abs(p.y - c.y) <= hh;

/** The item named `name` (case-insensitive), or null. */
export const findItemSpec = (name: string): ItemSpec | null => ITEM_CATALOG.find((i) => i.name.toLowerCase() === name.trim().toLowerCase()) ?? null;

/** Where `slot` is on a character standing at `c`: its center and half-size. */
export function slotZone(c: Point, slot: Slot): Point & { hw: number; hh: number } {
  const z = SLOT_ZONES[slot];
  return { x: c.x + z.dx, y: c.y + z.dy, hw: z.hw, hh: z.hh };
}

/** The slot of a character at `c` whose zone contains `p`, or null. */
export function slotAt(c: Point, p: Point): Slot | null {
  return SLOTS.find((s) => {
    const z = slotZone(c, s);
    return inBox(p, z, z.hw, z.hh);
  }) ?? null;
}

/** Whether `p` is on a character at `c`: on its body or on one of its slot zones. */
export const onCharacter = (c: Point, p: Point) => slotAt(c, p) !== null || inBox(p, c, CHARACTER_SIZE.hw, CHARACTER_SIZE.hh);

/** Total kilograms of `items`. */
export const loadOf = (items: readonly ItemSpec[]) => items.reduce((sum, i) => sum + i.weight, 0);

/**
 * How fast a character carrying `load` kg moves relative to unloaded: 1 − load / MAX_LOAD.
 * Throws RangeError for a negative load or one at or over MAX_LOAD (the character could not move).
 */
export function speedFactor(load: number): number {
  if (!(load >= 0 && load < MAX_LOAD)) throw new RangeError(`A load of ${load} kg is outside 0–${MAX_LOAD} kg`);
  return 1 - load / MAX_LOAD;
}

/** A character an item can be placed on: where it stands, who it is and what it already wears. */
export interface Wearer extends Point {
  name: string;
  gender: Gender;
  worn: readonly ItemSpec[];
}

/** A placement verdict: the slot and new load when correct, the reason when rejected. */
export type Placement = { ok: true; slot: Slot; load: number } | { ok: false; reason: string };

/**
 * Whether dropping `item` at `drop` places it correctly on `wearer`: the drop must be inside the
 * zone of the item's own slot, the item must match the wearer's gender, the slot must be free and
 * the new load must stay under MAX_LOAD.
 */
export function placementFor(item: ItemSpec, wearer: Wearer, drop: Point): Placement {
  const slot = slotAt(wearer, drop);
  if (!slot) return { ok: false, reason: `${item.name} was dropped on ${wearer.name} but not on any slot` };
  if (slot !== item.slot) return { ok: false, reason: `${item.name} belongs ${SLOT_TEXT[item.slot]}, not ${SLOT_TEXT[slot]}` };
  if (item.gender !== wearer.gender) return { ok: false, reason: `${item.name} is a ${item.gender} item and ${wearer.name} needs ${wearer.gender} items` };
  const taken = wearer.worn.find((w) => w.slot === slot);
  if (taken) return { ok: false, reason: `${wearer.name} already wears ${taken.name} ${SLOT_TEXT[slot]}` };
  const load = loadOf(wearer.worn) + item.weight;
  if (load >= MAX_LOAD) return { ok: false, reason: `${wearer.name} would carry ${load} kg — the limit is under ${MAX_LOAD} kg` };
  return { ok: true, slot, load };
}

/** Text of where an item in `slot` is worn ("in the hand"). */
export const slotText = (slot: Slot) => SLOT_TEXT[slot];
