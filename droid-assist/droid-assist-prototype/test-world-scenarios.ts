/**
 * Persona scenarios for the test world: scripted multi-step goals (prepare Hero and Rose to fight
 * the dragon, or to get married) and a checklist of what the world still lacks for each.
 */
import { itemsIn, wornBy, type World } from './test-world.js';

/** One scripted goal: what each character must wear, exactly. */
export interface Scenario {
  id: string;
  title: string;
  /** The goal text handed to the planner. */
  goal: string;
  /** Item names each character must wear, and nothing else. */
  outfits: Record<string, string[]>;
}

/** One checklist line of a scenario and whether the world satisfies it. */
export interface ScenarioCheck {
  label: string;
  done: boolean;
}

const LEFTOVERS = 'Every item nobody needs is discarded in the Trash or saved in the Bag (none left loose or in the chest)';

/** The persona scenarios. */
export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'dragon',
    title: 'Fight the dragon',
    goal: 'Prepare Hero and Rose to fight the dragon: Hero holds the Sword and wears the Hat and Glasses; walk Rose to the treasure chest, open it, equip her with the Rose sword, Rose hat and Rose glasses, and discard or save in the Bag every item nobody needs.',
    outfits: { Hero: ['Sword', 'Hat', 'Glasses'], Rose: ['Rose sword', 'Rose hat', 'Rose glasses'] },
  },
  {
    id: 'wedding',
    title: 'Get married',
    goal: 'Prepare Hero and Rose to get married: no swords — Hero wears the Hat and Glasses, Rose wears the Rose hat and Rose glasses from the treasure chest (walk her to it to open it); discard or save in the Bag every item nobody needs, the swords included.',
    outfits: { Hero: ['Hat', 'Glasses'], Rose: ['Rose hat', 'Rose glasses'] },
  },
];

/** The scenario whose id or title matches `name` (case-insensitive), or null. */
export const findScenario = (name: string): Scenario | null => {
  const key = name.trim().toLowerCase();
  return SCENARIOS.find((s) => s.id === key || s.title.toLowerCase() === key || key.includes(s.id)) ?? null;
};

/** The checklist lines for one character: each required item worn, and nothing unrequested worn. */
function outfitChecks(w: World, who: string, wanted: string[]): ScenarioCheck[] {
  const worn = wornBy(w, who).map((s) => s.name);
  const extra = worn.filter((n) => !wanted.includes(n));
  return [...wanted.map((n) => ({ label: `${who} wears ${n}`, done: worn.includes(n) })), { label: `${who} wears nothing else`, done: !extra.length }];
}

/** Whether every item nobody wears has been discarded or saved. */
function leftoversHandled(w: World): boolean {
  return w.items.every((i) => i.place.kind === 'worn' || i.place.kind === 'bag' || i.place.kind === 'trash');
}

/** The scenario's checklist against the world: the chest opened, each outfit line, and the leftovers handled. */
export function scenarioProgress(s: Scenario, w: World): ScenarioCheck[] {
  const chest = { label: 'The treasure chest is opened', done: w.chestOpen || !itemsIn(w, 'chest').length };
  const outfits = Object.entries(s.outfits).flatMap(([who, wanted]) => outfitChecks(w, who, wanted));
  return [chest, ...outfits, { label: LEFTOVERS, done: leftoversHandled(w) }];
}

/** Whether the world satisfies every line of the scenario. */
export const scenarioComplete = (s: Scenario, w: World) => scenarioProgress(s, w).every((c) => c.done);

/** The checklist as text lines: "[x] done" / "[ ] still to do". */
export const progressLines = (s: Scenario, w: World) => scenarioProgress(s, w).map((c) => `${c.done ? '[x]' : '[ ]'} ${c.label}`);
