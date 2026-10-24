import { desktopCapturer, screen } from 'electron';
import { SAMPLE_H, SAMPLE_W, VIEW_H, VIEW_W, type NativeFrame } from './capture-api.js';
import { bgraToRgba } from './capture-loop.js';

/**
 * Screenshots the primary display with desktopCapturer — no permission prompt. Only a
 * VIEW_W×VIEW_H thumbnail is requested, which keeps a grab fast enough for 250 ms ticks.
 * Throws when no screen source or an empty image comes back.
 */
export async function grabPrimaryScreen(): Promise<NativeFrame> {
  const display = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: VIEW_W, height: VIEW_H } });
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  if (!source) throw new Error('No screen source available to capture');
  if (source.thumbnail.isEmpty()) throw new Error(`Screen "${source.name}" returned an empty image`);
  const view = source.thumbnail.resize({ width: VIEW_W, height: VIEW_H });
  const sample = source.thumbnail.resize({ width: SAMPLE_W, height: SAMPLE_H });
  return {
    time: Date.now(),
    url: `data:image/jpeg;base64,${view.toJPEG(70).toString('base64')}`,
    pixels: bgraToRgba(new Uint8Array(sample.toBitmap())),
    srcW: Math.round(display.size.width * display.scaleFactor),
    srcH: Math.round(display.size.height * display.scaleFactor),
  };
}
