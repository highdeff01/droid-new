/**
 * A synthetic desktop used when no screen is shared: an offline game window whose
 * Play button slowly drifts, plus an intrusive ad popup that appears on a cycle.
 * It gives the drift, sync and error-detection features something real to measure.
 */

/** Ticks per ad cycle in the demo desktop. */
export const AD_CYCLE = 24;

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
export function drawDemoDesktop(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, adDismissed = false) {
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#1e293b');
  bg.addColorStop(1, '#0f172a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // desktop icons
  ['Files', 'Notes', 'Game', 'Calc'].forEach((label, i) => {
    ctx.fillStyle = '#334155';
    ctx.fillRect(w * 0.03, h * (0.06 + i * 0.16), w * 0.05, h * 0.09);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = `${Math.round(h * 0.03)}px sans-serif`;
    ctx.fillText(label, w * 0.03, h * (0.19 + i * 0.16));
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
