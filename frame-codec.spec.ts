import { describe, expect, it } from 'vitest';
import { isStoredFrame, toStoredFrame } from './frame-codec.js';
import type { Frame } from './types.js';

const frame = (source: Frame['source']): Frame => ({ id: 1, time: 2, url: 'data:image/jpeg;base64,AA', data: {} as ImageData, srcW: 1280, srcH: 720, source });

describe('isStoredFrame', () => {
  it.each(['demo', 'screen', 'desktop', 'main-app'] as const)('accepts a stored %s frame, so its template replays on any source', (source) => {
    expect(isStoredFrame(toStoredFrame(frame(source)))).toBe(true);
  });

  it('rejects an unknown source or a non-image url', () => {
    expect(isStoredFrame({ ...toStoredFrame(frame('screen')), source: 'printer' })).toBe(false);
    expect(isStoredFrame({ ...toStoredFrame(frame('screen')), url: 'http://x' })).toBe(false);
  });
});
