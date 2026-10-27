import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_H, SAMPLE_W, VIEW_H, VIEW_W } from './capture-api.js';
import { displayLabel, physicalOrigin, pickDisplay, pickSource } from './display-select.js';

const PRIMARY = { id: 1, label: '', size: { width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 };
const SECONDARY = { id: 2, label: 'DELL U2720Q', size: { width: 2560, height: 1440 }, bounds: { x: 1920, y: -200, width: 2560, height: 1440 }, scaleFactor: 2 };
const DISPLAYS = [PRIMARY, SECONDARY];

/** A fake NativeImage that records the sizes it was resized to. */
function image(tag: string, empty = false) {
  const resized: Array<{ width: number; height: number }> = [];
  const self = {
    tag,
    resized,
    isEmpty: () => empty,
    resize: (size: { width: number; height: number }) => { resized.push(size); return self; },
    toJPEG: () => Buffer.from(tag),
    toBitmap: () => Buffer.alloc(SAMPLE_W * SAMPLE_H * 4),
    toDataURL: () => `data:image/png;base64,${tag}`,
  };
  return self;
}

const electron = vi.hoisted(() => ({
  getAllDisplays: vi.fn(),
  getPrimaryDisplay: vi.fn(),
  getSources: vi.fn(),
}));
vi.mock('electron', () => ({
  screen: { getAllDisplays: electron.getAllDisplays, getPrimaryDisplay: electron.getPrimaryDisplay },
  desktopCapturer: { getSources: electron.getSources },
}));

const { grabScreen, listDisplays } = await import('./screen-grab.js');

function setScreens(displays = DISPLAYS, sources = [
  { display_id: '1', name: 'Screen 1', thumbnail: image('one') },
  { display_id: '2', name: 'Screen 2', thumbnail: image('two') },
]) {
  electron.getAllDisplays.mockReturnValue(displays);
  electron.getPrimaryDisplay.mockReturnValue(displays[0]);
  electron.getSources.mockResolvedValue(sources);
  return sources;
}

beforeEach(() => vi.clearAllMocks());

describe('display selection', () => {
  it('picks the chosen display, else the primary when none is chosen or it was unplugged', () => {
    expect(pickDisplay(DISPLAYS, PRIMARY, '2')).toBe(SECONDARY);
    expect(pickDisplay(DISPLAYS, PRIMARY, null)).toBe(PRIMARY);
    expect(pickDisplay(DISPLAYS, PRIMARY, '999')).toBe(PRIMARY);
  });

  it('matches sources by display_id, by position when ids are empty, else the first source', () => {
    const a = { display_id: '1', name: 'a' };
    const b = { display_id: '2', name: 'b' };
    expect(pickSource([a, b], DISPLAYS, SECONDARY)).toBe(b);
    const blankA = { display_id: '', name: 'a' };
    const blankB = { display_id: '', name: 'b' };
    expect(pickSource([blankA, blankB], DISPLAYS, SECONDARY)).toBe(blankB);
    expect(pickSource([blankA], DISPLAYS, SECONDARY)).toBe(blankA);
    expect(pickSource([], DISPLAYS, SECONDARY)).toBeUndefined();
  });

  it('labels displays and places them in physical pixels', () => {
    expect(displayLabel(PRIMARY, 0, 1)).toBe('Display 1 (primary)');
    expect(displayLabel(SECONDARY, 1, 1)).toBe('DELL U2720Q');
    expect(physicalOrigin(SECONDARY)).toEqual({ x: 3840, y: -400 });
  });
});

describe('grabScreen capture routing', () => {
  it('captures the chosen secondary display at its own physical size and origin', async () => {
    const [, second] = setScreens();
    const frame = await grabScreen('2');
    expect(frame.url).toBe(`data:image/jpeg;base64,${Buffer.from('two').toString('base64')}`);
    expect({ srcW: frame.srcW, srcH: frame.srcH, originX: frame.originX, originY: frame.originY }).toEqual({ srcW: 5120, srcH: 2880, originX: 3840, originY: -400 });
    expect(second.thumbnail.resized).toEqual([{ width: VIEW_W, height: VIEW_H }, { width: SAMPLE_W, height: SAMPLE_H }]);
    expect(frame.pixels).toHaveLength(SAMPLE_W * SAMPLE_H * 4);
  });

  it('captures the primary when nothing is chosen', async () => {
    setScreens();
    const frame = await grabScreen(null);
    expect(frame.url).toContain(Buffer.from('one').toString('base64'));
    expect([frame.srcW, frame.srcH, frame.originX, frame.originY]).toEqual([1920, 1080, 0, 0]);
  });

  it('falls back to the primary without throwing when the chosen display was unplugged', async () => {
    setScreens([PRIMARY], [{ display_id: '1', name: 'Screen 1', thumbnail: image('one') }]);
    const frame = await grabScreen('2');
    expect([frame.srcW, frame.srcH, frame.originX, frame.originY]).toEqual([1920, 1080, 0, 0]);
  });

  it('throws when no source or an empty image comes back', async () => {
    setScreens(DISPLAYS, []);
    await expect(grabScreen(null)).rejects.toThrow('No screen source available to capture');
    setScreens(DISPLAYS, [{ display_id: '1', name: 'Screen 1', thumbnail: image('one', true) }]);
    await expect(grabScreen(null)).rejects.toThrow('Screen "Screen 1" returned an empty image');
  });
});

describe('listDisplays', () => {
  it('lists every display with label, physical resolution, primary flag and a live thumbnail', async () => {
    setScreens();
    expect(await listDisplays()).toEqual([
      { id: '1', label: 'Display 1 (primary)', width: 1920, height: 1080, primary: true, thumbnail: 'data:image/png;base64,one' },
      { id: '2', label: 'DELL U2720Q', width: 5120, height: 2880, primary: false, thumbnail: 'data:image/png;base64,two' },
    ]);
  });
});
