import { desktopCapturer, screen } from 'electron';
import { SAMPLE_H, SAMPLE_W, THUMB_H, THUMB_W, VIEW_H, VIEW_W, type DisplayInfo, type NativeFrame } from './capture-api.js';
import { bgraToRgba } from './capture-loop.js';
import { displayLabel, physicalOrigin, physicalSize, pickDisplay, pickSource } from './display-select.js';

/** Every connected display with its label, physical resolution and a small live thumbnail. */
export async function listDisplays(): Promise<DisplayInfo[]> {
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: THUMB_W, height: THUMB_H } });
  return displays.map((d, i) => {
    const source = pickSource(sources, displays, d);
    const { width, height } = physicalSize(d);
    const thumbnail = source && !source.thumbnail.isEmpty() ? source.thumbnail.toDataURL() : '';
    return { id: String(d.id), label: displayLabel(d, i, primaryId), width, height, primary: d.id === primaryId, thumbnail };
  });
}

/**
 * Screenshots the chosen display (the primary when none is chosen or it was unplugged) with
 * desktopCapturer — no permission prompt. Only a VIEW_W×VIEW_H thumbnail is requested, which
 * keeps a grab fast enough for 250 ms ticks; the frame stays in the fixed view/sample space.
 * Throws when no screen source or an empty image comes back.
 */
export async function grabScreen(selectedId: string | null): Promise<NativeFrame> {
  const displays = screen.getAllDisplays();
  const display = pickDisplay(displays, screen.getPrimaryDisplay(), selectedId);
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: VIEW_W, height: VIEW_H } });
  const source = pickSource(sources, displays, display);
  if (!source) throw new Error('No screen source available to capture');
  if (source.thumbnail.isEmpty()) throw new Error(`Screen "${source.name}" returned an empty image`);
  const view = source.thumbnail.resize({ width: VIEW_W, height: VIEW_H });
  const sample = source.thumbnail.resize({ width: SAMPLE_W, height: SAMPLE_H });
  const size = physicalSize(display);
  const origin = physicalOrigin(display);
  return {
    time: Date.now(),
    url: `data:image/jpeg;base64,${view.toJPEG(70).toString('base64')}`,
    pixels: bgraToRgba(new Uint8Array(sample.toBitmap())),
    srcW: size.width,
    srcH: size.height,
    originX: origin.x,
    originY: origin.y,
  };
}
