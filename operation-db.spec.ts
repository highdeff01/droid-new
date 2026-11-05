import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OPERATION_DB, clearOperations, isOperationRecord, loadOperations, putOperation, resetOperationDb, type OperationRecord } from './operation-db.js';

const rec = (id: string, time: number, over: Partial<OperationRecord> = {}): OperationRecord => ({
  id, time, project: 'Report', agent: 'Replay', section: 'executor', category: 'track', op: 'click', element: 'Save', input: 'click "Save"', output: 'Clicked', ok: true, ...over,
});

const deleteDb = () => new Promise<void>((resolve) => {
  const req = indexedDB.deleteDatabase(OPERATION_DB);
  req.onsuccess = () => resolve();
  req.onerror = () => resolve();
});

describe('operation database', () => {
  beforeEach(async () => {
    await resetOperationDb();
    await deleteDb();
  });

  it('stores input and output of each operation and loads them newest first', async () => {
    await putOperation(rec('a', 1));
    await putOperation(rec('b', 3, { category: 'error', op: 'bridge', errorKind: 'bridge', ok: false, output: 'refused' }));
    await putOperation(rec('c', 2, { category: 'capture', op: 'source' }));
    const all = await loadOperations();
    expect(all.map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(all[0]).toMatchObject({ errorKind: 'bridge', input: 'click "Save"', output: 'refused', ok: false });
  });

  it('prunes the oldest records beyond the limit', async () => {
    for (const [i, id] of ['x', 'y', 'z', 'w'].entries()) await putOperation(rec(id, 10 - i), 2);
    expect((await loadOperations()).map((r) => r.id)).toEqual(['x', 'y']);
  });

  it('clears every record', async () => {
    await putOperation(rec('a', 1));
    await clearOperations();
    expect(await loadOperations()).toEqual([]);
  });

  it('keeps the frame database untouched by living under its own name', () => {
    expect(OPERATION_DB).not.toBe('droid-assist');
  });

  it('validates the schema of stored records', () => {
    expect(isOperationRecord(rec('a', 1))).toBe(true);
    expect(isOperationRecord({ ...rec('a', 1), category: 'other' })).toBe(false);
    expect(isOperationRecord({ ...rec('a', 1), ok: 'yes' })).toBe(false);
    expect(isOperationRecord(null)).toBe(false);
  });
});
