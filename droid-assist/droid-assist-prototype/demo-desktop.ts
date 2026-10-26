/**
 * A synthetic desktop used when no screen is shared: an offline game window whose
 * Play button slowly drifts, plus an intrusive ad popup that appears on a cycle.
 * It gives the drift, sync and error-detection features something real to measure.
 */

/** Ticks per ad cycle in the demo desktop. */
export const AD_CYCLE = 24;

type Point = { x: number; y: number };

/** The draggable "Report" file icon: its home position (normalized center) and half-size. */
export const DEMO_FILE = { x: 0.9, y: 0.2, hw: 0.03, hh: 0.05 } as const;
/** The "Archive" folder the file can be dropped onto (normalized box). */
export const DEMO_ARCHIVE = { x: 0.85, y: 0.6, w: 0.12, h: 0.18 } as const;

/** Where the draggable file is and whether it has been filed into the Archive folder. */
export interface DemoFile {
  x: number;
  y: number;
  archived: boolean;
}

/** The draggable file at its home position. */
export const initialDemoFile = (): DemoFile => ({ x: DEMO_FILE.x, y: DEMO_FILE.y, archived: false });

/** Where the Report file shows on the desktop: its own position, or the Archive folder once filed. */
export const demoFileAt = (file: DemoFile): Point => (file.archived ? { x: DEMO_ARCHIVE.x + DEMO_ARCHIVE.w / 2, y: DEMO_ARCHIVE.y + DEMO_ARCHIVE.h / 2 } : { x: file.x, y: file.y });

const inArchive = (p: Point) => p.x >= DEMO_ARCHIVE.x && p.x <= DEMO_ARCHIVE.x + DEMO_ARCHIVE.w && p.y >= DEMO_ARCHIVE.y && p.y <= DEMO_ARCHIVE.y + DEMO_ARCHIVE.h;
const onFile = (file: DemoFile, p: Point) => !file.archived && Math.abs(p.x - file.x) <= DEMO_FILE.hw && Math.abs(p.y - file.y) <= DEMO_FILE.hh;

/**
 * A drag on the demo desktop from `from` to `to`: grabbing the file moves it to the drop
 * point (dropping it on the Archive folder files it); anything else grabs nothing.
 */
export function demoDrag(file: DemoFile, from: Point, to: Point): { file: DemoFile; moved: boolean; message: string } {
  if (!onFile(file, from)) return { file, moved: false, message: 'Drag grabbed nothing — no draggable item at the start point' };
  if (inArchive(to)) return { file: { ...file, archived: true }, moved: true, message: 'Dragged "Report" into the Archive folder' };
  const x = Math.min(1 - DEMO_FILE.hw, Math.max(DEMO_FILE.hw, to.x));
  const y = Math.min(0.93 - DEMO_FILE.hh, Math.max(DEMO_FILE.hh, to.y));
  return { file: { x, y, archived: false }, moved: true, message: `Dragged "Report" to (${(x * 100).toFixed(0)}%, ${(y * 100).toFixed(0)}%)` };
}

/** Half-size of a rearrangeable desktop icon (normalized). */
export const DEMO_ICON = { hw: 0.025, hh: 0.045 } as const;

/** One rearrangeable desktop icon in the left sidebar, at its normalized center. */
export interface DemoIcon {
  label: string;
  x: number;
  y: number;
  /** Fill color, distinct per icon so template matching can tell them apart. */
  color: string;
}

/** Colors with luminances ~105/137/172/215, far apart from each other and the ~40 background, so templates never confuse them. */
const ICON_COLORS: Record<string, string> = { Files: '#2f6fdf', Notes: '#22c55e', Game: '#d08cf0', Calc: '#fde047' };

/** The sidebar icons in their home order (Files, Notes, Game, Calc) top to bottom. */
export const initialDemoIcons = (): DemoIcon[] => ['Files', 'Notes', 'Game', 'Calc'].map((label, i) => ({ label, x: 0.055, y: 0.105 + i * 0.16, color: ICON_COLORS[label] }));

/** The icon whose box contains `p`, or null. */
export const iconAt = (icons: DemoIcon[], p: Point): DemoIcon | null => icons.find((i) => Math.abs(p.x - i.x) <= DEMO_ICON.hw && Math.abs(p.y - i.y) <= DEMO_ICON.hh) ?? null;

/** The icon named `label` (case-insensitive, "files icon" finds Files), or null. */
export const findIcon = (icons: DemoIcon[], label: string): DemoIcon | null => icons.find((i) => new RegExp(`\\b${i.label}\\b`, 'i').test(label)) ?? null;

/** A drop point kept on the desktop, above the taskbar. */
const keepOnDesktop = (to: Point): Point => ({ x: Math.min(1 - DEMO_ICON.hw, Math.max(DEMO_ICON.hw, to.x)), y: Math.min(0.93 - DEMO_ICON.hh, Math.max(DEMO_ICON.hh, to.y)) });

/** A drag on the sidebar: grabbing an icon at `from` moves it to `to`; anything else grabs nothing. */
export function moveIcon(icons: DemoIcon[], from: Point, to: Point): { icons: DemoIcon[]; moved: DemoIcon | null } {
  const grabbed = iconAt(icons, from);
  if (!grabbed) return { icons, moved: null };
  const moved = { ...grabbed, ...keepOnDesktop(to) };
  return { icons: icons.map((i) => (i === grabbed ? moved : i)), moved };
}

/** Draws the Archive folder and, unless filed, the draggable Report file. */
function drawDraggable(ctx: CanvasRenderingContext2D, w: number, h: number, file: DemoFile) {
  ctx.fillStyle = '#a16207';
  ctx.fillRect(DEMO_ARCHIVE.x * w, DEMO_ARCHIVE.y * h, DEMO_ARCHIVE.w * w, DEMO_ARCHIVE.h * h);
  ctx.fillStyle = '#fef3c7';
  ctx.font = `${Math.round(h * 0.03)}px sans-serif`;
  ctx.fillText(file.archived ? 'Archive (1)' : 'Archive', DEMO_ARCHIVE.x * w + 6, (DEMO_ARCHIVE.y + DEMO_ARCHIVE.h) * h - 8);
  if (file.archived) return;
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect((file.x - DEMO_FILE.hw) * w, (file.y - DEMO_FILE.hh) * h, DEMO_FILE.hw * 2 * w, DEMO_FILE.hh * 2 * h);
  ctx.fillStyle = '#1e293b';
  ctx.fillText('Report', (file.x - DEMO_FILE.hw) * w + 2, file.y * h + 4);
}

/** Normalized position of the game's Play button at tick `t` (it drifts). */
export function demoPlayButton(t: number) {
  return { x: 0.5 + Math.sin(t / 14) * 0.05, y: 0.62 };
}

/** Whether the ad popup is visible at tick `t`, and where its close button is. */
export function demoAd(t: number) {
  const phase = t % AD_CYCLE;
  // The ad deliberately covers the PLAY button, so a replay must deal with it.
  return { visible: phase >= 15 && phase < 21, x: 0.42, y: 0.3, w: 0.4, h: 0.4, closeX: 0.8, closeY: 0.335 };
}

/** Draws the demo desktop for tick `t` onto a canvas context of size w×h. */
export function drawDemoDesktop(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, adDismissed = false, file: DemoFile = initialDemoFile(), icons: DemoIcon[] = initialDemoIcons()) {
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#1e293b');
  bg.addColorStop(1, '#0f172a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // desktop icons (rearrangeable: drawn wherever the layout puts them)
  icons.forEach((icon) => {
    ctx.fillStyle = icon.color;
    ctx.fillRect((icon.x - DEMO_ICON.hw) * w, (icon.y - DEMO_ICON.hh) * h, DEMO_ICON.hw * 2 * w, DEMO_ICON.hh * 2 * h);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = `${Math.round(h * 0.03)}px sans-serif`;
    ctx.fillText(icon.label, (icon.x - DEMO_ICON.hw) * w, (icon.y + DEMO_ICON.hh + 0.04) * h);
  });

  // game window
  const gx = w * 0.18, gy = h * 0.1, gw = w * 0.64, gh = h * 0.72;
  ctx.fillStyle = '#0b3b3a';
  ctx.fillRect(gx, gy, gw, gh);
  ctx.fillStyle = '#115e59';
  ctx.fillRect(gx, gy, gw, h * 0.06);
  ctx.fillStyle = '#ecfeff';
  ctx.font = `bold ${Math.round(h * 0.035)}px sans-serif`;
  ctx.fillText('Puzzle Quest — offline', gx + 10, gy + h * 0.042);
  ctx.font = `bold ${Math.round(h * 0.07)}px sans-serif`;
  ctx.fillText('PUZZLE QUEST', gx + gw * 0.27, gy + gh * 0.32);

  const play = demoPlayButton(t);
  const bw = w * 0.16, bh = h * 0.09;
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(play.x * w - bw / 2, play.y * h - bh / 2, bw, bh);
  ctx.fillStyle = '#1c1917';
  ctx.font = `bold ${Math.round(h * 0.045)}px sans-serif`;
  ctx.fillText('PLAY', play.x * w - bw * 0.2, play.y * h + bh * 0.18);

  // taskbar + clock (changes every tick, like a real screen)
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, h * 0.93, w, h * 0.07);
  ctx.fillStyle = '#94a3b8';
  ctx.font = `${Math.round(h * 0.03)}px monospace`;
  ctx.fillText(`12:${String(Math.floor(t / 2) % 60).padStart(2, '0')}`, w * 0.92, h * 0.975);

  drawDraggable(ctx, w, h, file);

  const ad = demoAd(t);
  if (ad.visible && !adDismissed) {
    ctx.fillStyle = '#be123c';
    ctx.fillRect(ad.x * w, ad.y * h, ad.w * w, ad.h * h);
    ctx.fillStyle = '#fde047';
    ctx.font = `bold ${Math.round(h * 0.05)}px sans-serif`;
    ctx.fillText('MEGA OFFER!!!', ad.x * w + 14, ad.y * h + h * 0.12);
    ctx.font = `${Math.round(h * 0.032)}px sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.fillText('Buy 9999 gems now', ad.x * w + 14, ad.y * h + h * 0.2);
    ctx.fillStyle = '#fff';
    ctx.fillRect(ad.closeX * w - 10, ad.closeY * h - 10, 20, 20);
    ctx.fillStyle = '#be123c';
    ctx.font = `bold ${Math.round(h * 0.035)}px sans-serif`;
    ctx.fillText('×', ad.closeX * w - 6, ad.closeY * h + 7);
  }
}
