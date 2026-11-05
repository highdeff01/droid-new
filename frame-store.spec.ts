import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { StoredFrame } from './frame-codec.js';
import { loadStoredFrames, pruneCorruptFrames, putStoredFrame, resetFrameStore } from './frame-store.js';

const frame = (id: number): StoredFrame => ({ id, time: id, url: `data:image/jpeg;base64,${id}`, srcW: 960, srcH: 540, source: 'demo' });

describe('frame store', () => {
  beforeEach(async () => {
    await resetFrameStore();
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('droid-assist');
      req.onsuccess = req.onerror = resolve;
    });
  });

  it('keeps the newest frames up to the cap and prunes the oldest', async () => {
    for (let id = 1; id <= 8; id++) await putStoredFrame(frame(id), 5);
    const stored = await loadStoredFrames(30);
    expect(stored.map((f) => f.id)).toEqual([8, 7, 6, 5, 4]);
  });

  it('survives a reconnect (app restart)', async () => {
    await putStoredFrame(frame(1), 10);
    await putStoredFrame(frame(2), 10);
    await resetFrameStore();
    expect(await loadStoredFrames(10)).toEqual([frame(2), frame(1)]);
  });

  it('loads at most `limit` frames, newest first', async () => {
    for (let id = 1; id <= 4; id++) await putStoredFrame(frame(id), 10);
    expect((await loadStoredFrames(2)).map((f) => f.id)).toEqual([4, 3]);
  });

  it('falls back to an empty gallery when IndexedDB fails to open', async () => {
    const original = indexedDB.open.bind(indexedDB);
    indexedDB.open = () => { throw new Error('blocked'); };
    try {
      await resetFrameStore();
      await expect(putStoredFrame(frame(1), 10)).resolves.toBeUndefined();
      await expect(loadStoredFrames(10)).resolves.toEqual([]);
    } finally {
      indexedDB.open = original;
      await resetFrameStore();
    }
  });

  it('pruneCorruptFrames removes invalid records and reports the count', async () => {
    await putStoredFrame(frame(1), 10);
    await putStoredFrame(frame(2), 10);
    await resetFrameStore();

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('droid-assist', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('frames', 'readwrite');
      tx.objectStore('frames').put({ id: 99, junk: true });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    await expect(pruneCorruptFrames()).resolves.toBe(1);
    expect((await loadStoredFrames(10)).map((f) => f.id).sort()).toEqual([1, 2]);
    await expect(pruneCorruptFrames()).resolves.toBe(0);
  });
});
