/**
 * Draws the test world scene and the taskbar World/Desktop toggle with plain fillRect/fillText,
 * so every element is visible to template matching and the AI's screenshot.
 */
import { BAG, BOX_SIZE, CHEST, TRASH, WORLD_ICONS, WORLD_TOGGLE, itemPoint, itemsIn, loadFor, windowClose, windowRect, type Character, type World } from './test-world.js';
import { CHARACTER_SIZE, ITEM_SIZE, speedFactor, type ItemSpec } from './test-world-items.js';

type Ctx = CanvasRenderingContext2D;
type Rect = { x: number; y: number; hw: number; hh: number };

/** Fill color per item, distinct so items are told apart; female items share a rose tint. */
const ITEM_COLORS: Record<string, string> = {
  Sword: '#cbd5e1', Hat: '#7c3aed', Glasses: '#0ea5e9', 'Rose sword': '#fda4af', 'Rose hat': '#db2777', 'Rose glasses': '#f472b6', Armor: '#78716c', 'Spare hat': '#a78bfa',
};
const CHARACTER_COLORS: Record<Character['gender'], string> = { male: '#2563eb', female: '#e11d48' };

const font = (ctx: Ctx, h: number, size: number, bold = false) => {
  ctx.font = `${bold ? 'bold ' : ''}${Math.round(h * size)}px sans-serif`;
};

/** Fills a centered box and writes `label` under (or in) it. */
function box(ctx: Ctx, w: number, h: number, r: Rect, color: string, label: string) {
  ctx.fillStyle = color;
  ctx.fillRect((r.x - r.hw) * w, (r.y - r.hh) * h, r.hw * 2 * w, r.hh * 2 * h);
  ctx.fillStyle = '#e2e8f0';
  font(ctx, h, 0.026);
  ctx.fillText(label, (r.x - r.hw) * w, (r.y + r.hh + 0.03) * h);
}

/** The taskbar button that switches scenes; it reads the scene it switches to. */
export function drawWorldToggle(ctx: Ctx, w: number, h: number, inWorld: boolean) {
  ctx.fillStyle = '#0f766e';
  ctx.fillRect((WORLD_TOGGLE.x - WORLD_TOGGLE.hw) * w, (WORLD_TOGGLE.y - WORLD_TOGGLE.hh) * h, WORLD_TOGGLE.hw * 2 * w, WORLD_TOGGLE.hh * 2 * h);
  ctx.fillStyle = '#ecfeff';
  font(ctx, h, 0.028, true);
  ctx.fillText(inWorld ? 'Desktop' : 'World', (WORLD_TOGGLE.x - WORLD_TOGGLE.hw + 0.006) * w, (WORLD_TOGGLE.y + 0.01) * h);
}

/** A character as a body with a head, its name and its load / speed. */
function drawCharacter(ctx: Ctx, w: number, h: number, world: World, c: Character) {
  ctx.fillStyle = CHARACTER_COLORS[c.gender];
  ctx.fillRect((c.x - CHARACTER_SIZE.hw) * w, (c.y - CHARACTER_SIZE.hh + 0.07) * h, CHARACTER_SIZE.hw * 2 * w, (CHARACTER_SIZE.hh * 2 - 0.07) * h);
  ctx.fillStyle = '#fcd34d';
  ctx.fillRect((c.x - 0.025) * w, (c.y - CHARACTER_SIZE.hh) * h, 0.05 * w, 0.07 * h);
  ctx.fillStyle = '#f8fafc';
  font(ctx, h, 0.026, true);
  ctx.fillText(c.name, (c.x - CHARACTER_SIZE.hw) * w, (c.y + CHARACTER_SIZE.hh + 0.035) * h);
  const load = loadFor(world, c.name);
  font(ctx, h, 0.022);
  ctx.fillText(`${load} kg · ${Math.round(speedFactor(load) * 100)}%${c.walking ? ' · walking' : ''}`, (c.x - CHARACTER_SIZE.hw) * w, (c.y + CHARACTER_SIZE.hh + 0.07) * h);
}

/** An item at its on-screen point (floor, open chest, or the slot of its wearer). */
function drawItem(ctx: Ctx, w: number, h: number, spec: ItemSpec, at: { x: number; y: number }) {
  box(ctx, w, h, { ...at, ...ITEM_SIZE }, ITEM_COLORS[spec.name] ?? '#94a3b8', spec.name);
}

/** The chest, Trash and Bag with what they hold. */
function drawContainers(ctx: Ctx, w: number, h: number, world: World) {
  box(ctx, w, h, CHEST, world.chestOpen ? '#ca8a04' : '#854d0e', world.chestOpen ? 'Chest (open)' : 'Treasure chest');
  box(ctx, w, h, TRASH, '#475569', `Trash (${itemsIn(world, 'trash').length})`);
  box(ctx, w, h, BAG, '#9a3412', `Bag (${itemsIn(world, 'bag').length})`);
}

/** The open windows, the focused (last) one drawn on top, each with its title bar, close button and lines. */
function drawWindows(ctx: Ctx, w: number, h: number, world: World) {
  world.windows.forEach((win, i) => {
    const r = windowRect(i);
    const close = windowClose(i);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(r.x * w, r.y * h, r.w * w, r.h * h);
    ctx.fillStyle = i === world.windows.length - 1 ? '#1d4ed8' : '#64748b';
    ctx.fillRect(r.x * w, r.y * h, r.w * w, 0.05 * h);
    ctx.fillStyle = '#fff';
    font(ctx, h, 0.028, true);
    ctx.fillText(win.title, (r.x + 0.008) * w, (r.y + 0.036) * h);
    ctx.fillStyle = '#dc2626';
    ctx.fillRect((close.x - close.hw) * w, (close.y - close.hh) * h, close.hw * 2 * w, close.hh * 2 * h);
    ctx.fillStyle = '#0f172a';
    font(ctx, h, 0.026);
    win.lines.slice(-4).forEach((line, j) => ctx.fillText(line, (r.x + 0.01) * w, (r.y + 0.09 + j * 0.04) * h));
  });
}

/** Draws the test world for tick `t`: floor, icons, boxes, containers, characters, items, windows and the taskbar. */
export function drawTestWorld(ctx: Ctx, w: number, h: number, t: number, world: World) {
  ctx.fillStyle = '#14532d';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#166534';
  ctx.fillRect(0, 0.7 * h, w, 0.23 * h);
  WORLD_ICONS.forEach((ic) => box(ctx, w, h, ic, ic.kind === 'notes' ? '#22c55e' : '#fde047', ic.label));
  world.boxes.forEach((b) => box(ctx, w, h, { ...b, ...BOX_SIZE }, b.content ? '#b45309' : '#57534e', b.label));
  drawContainers(ctx, w, h, world);
  world.characters.forEach((c) => drawCharacter(ctx, w, h, world, c));
  world.items.forEach((item) => {
    const at = itemPoint(world, item);
    if (at) drawItem(ctx, w, h, item.spec, at);
  });
  drawWindows(ctx, w, h, world);
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, h * 0.93, w, h * 0.07);
  drawWorldToggle(ctx, w, h, true);
  ctx.fillStyle = '#94a3b8';
  ctx.font = `${Math.round(h * 0.03)}px monospace`;
  ctx.fillText(`12:${String(Math.floor(t / 2) % 60).padStart(2, '0')}`, w * 0.92, h * 0.975);
}
