import { describe, expect, it } from 'vitest';
import { GOLDEN_KEY, PRIEST_LINES, QUEST_TABS, findQuestElement, initialQuest, questClick, questContext, questDoubleClick, questDrag, questElements, questKey, questType, weightOf, type Quest } from './quest-world.js';

const at = (q: Quest, name: string) => {
  const el = findQuestElement(q, name);
  if (!el) throw new Error(`no ${name}`);
  return { x: el.x, y: el.y };
};
const click = (q: Quest, name: string) => questClick(q, at(q, name));

describe('quest world elements', () => {
  it('names every ported element and grounds each to a point the click reducer handles', () => {
    const q = initialQuest();
    const names = questElements(q).map((e) => e.name);
    for (const n of ['Games', 'Custom Game', 'Char 5', 'Start Game', 'Calculator', 'Dragon Gate', 'Mystery Box', 'Treasure Chest', 'Sword', 'Hat', 'Glasses', 'Knight Guy', 'Mage Girl', 'Talk', 'Priest']) {
      expect(names).toContain(n);
      expect(questClick(q, at(q, n)).message).not.toMatch(/hit nothing/);
    }
    expect(QUEST_TABS.map((t) => t.label)).toEqual(['Games', 'Custom Game', 'Char 5', 'Start Game']);
  });

  it('finds elements by loose names', () => {
    const q = initialQuest();
    expect(findQuestElement(q, 'the Sword')?.name).toBe('Sword');
    expect(findQuestElement(q, 'talk button')?.name).toBe('Talk');
    expect(findQuestElement(q, 'nothing here')).toBeNull();
  });
});

describe('quest world reducers', () => {
  it('gives the heroes their own weights', () => {
    const q = initialQuest();
    expect(weightOf(q, 'Knight Guy')).toBe(20);
    expect(weightOf(q, 'Mage Girl')).toBe(15);
  });

  it('switches tabs, selects Char 5 and starts the game without relabelling the tab', () => {
    let q = click(initialQuest(), 'Custom Game').quest;
    expect(q.tab).toBe('custom_game');
    q = click(q, 'Char 5').quest;
    expect(q).toMatchObject({ tab: 'char_select', selectedChar: 5 });
    q = click(q, 'Start Game').quest;
    expect(q).toMatchObject({ tab: 'in_game', started: true });
    expect(findQuestElement(q, 'Start Game')).not.toBeNull();
  });

  it('runs the Priest dialogue: Talk, "hi", Next to the end, then closes', () => {
    let q = click(initialQuest(), 'Talk').quest;
    expect(q.priest).toMatchObject({ talking: true, line: 0 });
    const hi = questType(q, 'hi');
    expect(hi.ok).toBe(true);
    expect(hi.message).toContain(PRIEST_LINES[1]);
    q = hi.quest;
    expect(q.priest).toMatchObject({ line: 1, greeted: true });
    q = click(q, 'Next').quest;
    expect(q.priest.line).toBe(2);
    q = click(q, 'Next').quest;
    expect(q.priest.line).toBe(3);
    q = click(q, 'Next').quest;
    expect(q.priest.talking).toBe(false);
    expect(findQuestElement(q, 'Next')?.name).not.toBe('Next');
  });

  it('greets on "hi" typed key by key, but not inside another word', () => {
    let q = initialQuest();
    q = questType(q, 'h').quest;
    const r = questType(q, 'i');
    expect(r.quest.priest.greeted).toBe(true);
    const word = questType(initialQuest(), 'this');
    expect(word.ok).toBe(false);
    expect(word.quest.priest.greeted).toBe(false);
  });

  it('equips Sword, Hat and Glasses on click with their weights', () => {
    let q = click(initialQuest(), 'Sword').quest;
    q = click(q, 'Hat').quest;
    const r = click(q, 'Glasses');
    expect(r.quest.items.every((i) => i.wornBy === 'Knight Guy')).toBe(true);
    expect(weightOf(r.quest, 'Knight Guy')).toBe(33);
    expect(r.message).toMatch(/33 kg/);
    expect(findQuestElement(r.quest, 'Sword')?.kind).not.toBe('item');
  });

  it('equips an item dragged onto Mage Girl and names what the drag grabbed', () => {
    const q = initialQuest();
    const r = questDrag(q, at(q, 'Hat'), at(q, 'Mage Girl'));
    expect(r).toMatchObject({ ok: true, grabbed: 'Hat' });
    expect(r.quest.items.find((i) => i.name === 'Hat')?.wornBy).toBe('Mage Girl');
    expect(weightOf(r.quest, 'Mage Girl')).toBe(17);
  });

  it('drags a hero and grabs nothing off the elements', () => {
    const q = initialQuest();
    const r = questDrag(q, at(q, 'Knight Guy'), { x: 0.3, y: 0.3 });
    expect(r).toMatchObject({ ok: true, grabbed: 'Knight Guy' });
    expect(findQuestElement(r.quest, 'Knight Guy')).toMatchObject({ x: 0.3, y: 0.3 });
    expect(questDrag(q, { x: 0.2, y: 0.75 }, { x: 0.3, y: 0.3 }).ok).toBe(false);
  });

  it('opens the chest to show its items and takes one', () => {
    let q = click(initialQuest(), 'Treasure Chest').quest;
    expect(q.chest.opened).toBe(true);
    q = click(q, 'Crown').quest;
    expect(q.inventory).toContain('Crown');
    expect(q.chest.items).toEqual(['Magic Potion']);
  });

  it('keeps the Dragon Gate locked until the Mystery Box is double-clicked', () => {
    let q = initialQuest();
    expect(click(q, 'Dragon Gate')).toMatchObject({ ok: false });
    q = click(q, 'Mystery Box').quest;
    expect(q.mysteryBoxOpened).toBe(false);
    expect(click(q, 'Dragon Gate').quest.gateUnlocked).toBe(false);
    q = questDoubleClick(q, at(q, 'Mystery Box')).quest;
    expect(q.inventory).toContain(GOLDEN_KEY);
    const gate = click(q, 'Dragon Gate');
    expect(gate.ok).toBe(true);
    expect(gate.quest.gateUnlocked).toBe(true);
  });

  it('evaluates Calculator input on "=" and on Enter', () => {
    let q = click(initialQuest(), 'Calculator').quest;
    q = questType(q, '6*7=').quest;
    expect(q.calc.display).toBe('6*7 = 42');
    q = questType(q, '10-4').quest;
    const r = questKey(q, 'Enter');
    expect(r.ok).toBe(true);
    expect(r.quest.calc.display).toBe('10-4 = 6');
  });

  it('routes a bare expression to the Calculator and rejects other typing', () => {
    expect(questType(initialQuest(), '2+3=').quest.calc.display).toBe('2+3 = 5');
    expect(questType(initialQuest(), 'banana').ok).toBe(false);
    expect(questKey(initialQuest(), 'Enter').ok).toBe(false);
  });

  it('walks a clicked hero three steps forward', () => {
    const q = initialQuest();
    const r = click(q, 'Knight Guy');
    expect(r.quest.characters[0].steps).toBe(3);
    expect(findQuestElement(r.quest, 'Knight Guy')!.x).toBeCloseTo(0.44);
  });

  it('describes the scene for the planner', () => {
    const lines = questContext(initialQuest()).join('\n');
    expect(lines).toMatch(/Games \/ Custom Game \/ Char 5 \/ Start Game/);
    expect(lines).toMatch(/Knight Guy .* 20 kg/);
    expect(lines).toMatch(/Mage Girl .* 15 kg/);
    expect(lines).toMatch(/Dragon Gate locked/);
  });
});
