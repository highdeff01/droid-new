/**
 * Draws the quest world scene and its taskbar Quest/Desktop button with plain fillRect/fillText,
 * so every element is visible to template matching and the AI's screenshot. Equipped items are
 * drawn on their wearer.
 */
import { CALCULATOR, CHARACTER_BOX, DIALOGUE, DRAGON_GATE, MYSTERY_BOX, NEXT_BUTTON, PRIEST, PRIEST_LINES, QUEST_CHEST, QUEST_ITEM_BOX, QUEST_TABS, QUEST_TOGGLE, TALK_BUTTON, characterPoint, chestSlot, weightOf, wornItems, type Quest, type QuestCharacter, type QuestItemName } from './quest-world.js';

type Ctx = CanvasRenderingContext2D;
type Rect = { x: number; y: number; hw: number; hh: number };

const ITEM_COLORS: Record<QuestItemName, string> = { Sword: '#94a3b8', Hat: '#3b82f6', Glasses: '#ec4899' };
const HERO_COLORS: Record<string, string> = { 'Knight Guy': '#2563eb', 'Mage Girl': '#db2777' };

const font = (ctx: Ctx, h: number, size: number, bold = false) => {
  ctx.font = `${bold ? 'bold ' : ''}${Math.round(h * size)}px sans-serif`;
};

/** Fills a centered box and writes `label` inside it. */
function box(ctx: Ctx, w: number, h: number, r: Rect, color: string, label: string, ink = '#ffffff') {
  ctx.fillStyle = color;
  ctx.fillRect((r.x - r.hw) * w, (r.y - r.hh) * h, r.hw * 2 * w, r.hh * 2 * h);
  ctx.fillStyle = ink;
  font(ctx, h, 0.022, true);
  ctx.fillText(label, (r.x - r.hw + 0.004) * w, (r.y + 0.008) * h);
}

/** The taskbar button that switches to the quest (or back to the Desktop). */
export function drawQuestToggle(ctx: Ctx, w: number, h: number, inQuest: boolean) {
  box(ctx, w, h, QUEST_TOGGLE, '#7c3aed', inQuest ? 'Desktop' : 'Quest', '#f5f3ff');
}

/** The game window, its title bar and the four tabs. */
function drawWindow(ctx: Ctx, w: number, h: number, q: Quest) {
  ctx.fillStyle = '#064e3b';
  ctx.fillRect(0.16 * w, 0.08 * h, 0.68 * w, 0.74 * h);
  ctx.fillStyle = '#047857';
  ctx.fillRect(0.16 * w, 0.08 * h, 0.68 * w, 0.025 * h);
  ctx.fillStyle = '#065f46';
  ctx.fillRect(0.17 * w, 0.19 * h, 0.66 * w, 0.62 * h);
  QUEST_TABS.forEach((t) => box(ctx, w, h, t, t.tab === 'in_game' ? '#f59e0b' : q.tab === t.tab ? '#10b981' : '#1f2937', t.label, t.tab === 'in_game' ? '#111827' : '#ffffff'));
}

/** The Calculator, Dragon Gate, Mystery Box and Treasure Chest with its items. */
function drawProps(ctx: Ctx, w: number, h: number, q: Quest) {
  box(ctx, w, h, CALCULATOR, q.calc.focused ? '#1e293b' : '#0f172a', q.calc.display || 'Calc: Type expr', '#38bdf8');
  box(ctx, w, h, DRAGON_GATE, q.gateUnlocked ? '#16a34a' : '#7f1d1d', q.gateUnlocked ? 'Gate open' : 'Dragon Gate');
  box(ctx, w, h, MYSTERY_BOX, q.mysteryBoxOpened ? '#fbbf24' : '#b45309', q.mysteryBoxOpened ? 'Key Open!' : 'Box (2x)');
  box(ctx, w, h, QUEST_CHEST, q.chest.opened ? '#ca8a04' : '#78350f', q.chest.opened ? 'Chest [Open]' : 'Chest', '#fef08a');
  if (q.chest.opened) q.chest.items.forEach((name, i) => box(ctx, w, h, { ...chestSlot(i), ...QUEST_ITEM_BOX }, '#a16207', name));
}

/** What a hero wears, drawn on it: Hat above the head, Glasses on the face, Sword at the hand. */
const GEAR: Record<QuestItemName, (ctx: Ctx, x: number, y: number) => void> = {
  Hat: (ctx, x, y) => {
    ctx.fillStyle = '#1e3a8a';
    ctx.fillRect(x - 16, y - 55, 32, 12);
  },
  Glasses: (ctx, x, y) => {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x - 10, y - 38, 20, 6);
  },
  Sword: (ctx, x, y) => {
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(x + 18, y - 20, 6, 40);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(x + 14, y, 14, 5);
  },
};

/** A hero as a body and head with its gear, name and total weight. */
function drawHero(ctx: Ctx, w: number, h: number, q: Quest, c: QuestCharacter) {
  const at = characterPoint(c);
  const x = at.x * w;
  const y = at.y * h;
  ctx.fillStyle = HERO_COLORS[c.name] ?? '#64748b';
  ctx.fillRect(x - CHARACTER_BOX.hw * w, y - 25, CHARACTER_BOX.hw * 2 * w, 25 + CHARACTER_BOX.hh * h);
  ctx.fillStyle = '#fed7aa';
  ctx.fillRect(x - 12, y - 46, 24, 20);
  wornItems(q, c.name).forEach((i) => GEAR[i.name](ctx, x, y));
  ctx.fillStyle = '#ffffff';
  font(ctx, h, 0.022, true);
  ctx.fillText(`${c.name} (${weightOf(q, c.name)}kg)`, x - 0.04 * w, y + (CHARACTER_BOX.hh + 0.035) * h);
}

/** The Priest, his Talk button and, while talking, the dialogue bubble with its Next button. */
function drawPriest(ctx: Ctx, w: number, h: number, q: Quest) {
  box(ctx, w, h, PRIEST, '#8b5cf6', 'Priest');
  box(ctx, w, h, TALK_BUTTON, '#10b981', 'Talk', '#064e3b');
  if (!q.priest.talking) return;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(DIALOGUE.x * w, DIALOGUE.y * h, DIALOGUE.w * w, DIALOGUE.h * h);
  ctx.fillStyle = '#111827';
  font(ctx, h, 0.022, true);
  ctx.fillText('Elder Priest:', (DIALOGUE.x + 0.008) * w, (DIALOGUE.y + 0.035) * h);
  font(ctx, h, 0.018);
  ctx.fillText(PRIEST_LINES[q.priest.line], (DIALOGUE.x + 0.008) * w, (DIALOGUE.y + 0.07) * h, DIALOGUE.w * w - 8);
  box(ctx, w, h, NEXT_BUTTON, '#3b82f6', 'Next');
}

/** Draws the quest world (sidebar icons, Report/Archive and ad are the demo's, drawn by the caller). */
export function drawQuestWorld(ctx: Ctx, w: number, h: number, q: Quest) {
  drawWindow(ctx, w, h, q);
  drawProps(ctx, w, h, q);
  q.items.filter((i) => !i.wornBy).forEach((i) => box(ctx, w, h, { x: i.x, y: i.y, ...QUEST_ITEM_BOX }, ITEM_COLORS[i.name], i.name));
  q.characters.forEach((c) => drawHero(ctx, w, h, q, c));
  drawPriest(ctx, w, h, q);
}
