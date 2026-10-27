import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AskFn } from './ai.js';
import { OPERATION_DB, loadOperations, resetOperationDb } from './operation-db.js';
import { elementDraft, errorDraft } from './operation-log.js';
import { proposeStep } from './proposal.js';
import type { Frame, WorkflowStep } from './types.js';
import { useOperations } from './use-operations.js';
import { observeScreen } from './watcher.js';

const frame = { id: 1, url: 'data:image/jpeg;base64,QUJD' } as Frame;
const step: WorkflowStep = { id: 's', name: 'Open export', action: 'click', target: 'Export menu', x: 0.2, y: 0.3, status: 'pending' };
const ask = (content: string) => vi.fn<AskFn>(async () => ({ content, thinking: null }));
const scope = { project: 'Report', agent: 'Element map', section: 'elementMap' };

const deleteDb = () => new Promise<void>((resolve) => {
  const req = indexedDB.deleteDatabase(OPERATION_DB);
  req.onsuccess = () => resolve();
  req.onerror = () => resolve();
});

describe('cross-reference injection into the AI prompts', () => {
  it('appends prior operations to the idea (watcher) prompt', async () => {
    const fn = ask('{"notes":[],"proposals":[]}');
    await observeScreen(fn, frame, [], [], 'export the report', ['- [error/bridge] export → FAILED: refused (Errors, bridge)']);
    expect(fn.mock.calls[0][0].prompt).toContain('Prior operations (from the operation database):\n- [error/bridge] export → FAILED: refused');
  });

  it('leaves the watcher prompt unchanged without prior operations', async () => {
    const fn = ask('{"notes":[],"proposals":[]}');
    await observeScreen(fn, frame, [], [], 'goal');
    expect(fn.mock.calls[0][0].prompt).not.toContain('Prior operations');
  });

  it('appends prior operations to the executor proposal prompt', async () => {
    const fn = ask('{"ready":true,"why":"it opens the export menu"}');
    await proposeStep(fn, frame, step, { goal: 'export', change: null, patterns: [], related: ['- [element/map] "Export menu" box → ok: mapped (Element map, elementMap)'] });
    expect(fn.mock.calls[0][0].prompt).toMatch(/Prior operations on this \(from the operation database\):\n- \[element\/map\] "Export menu"/);
  });
});

describe('useOperations', () => {
  beforeEach(async () => {
    await resetOperationDb();
    await deleteDb();
  });

  it('writes each recorded operation to IndexedDB and pulls the relevant ones for an idea', async () => {
    const { result } = renderHook(() => useOperations());
    act(() => {
      result.current.record(scope, elementDraft('map', 'Export menu', 'box', 'mapped'));
      result.current.record({ ...scope, agent: 'Errors', section: 'bridge' }, errorDraft({ kind: 'bridge', message: 'Bridge refused the connection', goal: 'export the report' }));
      result.current.record(scope, elementDraft('map', 'Play button', 'box', 'mapped'));
    });
    expect(result.current.operations).toHaveLength(3);
    await waitFor(async () => expect(await loadOperations()).toHaveLength(3));
    const lines = result.current.related('Export the report');
    expect(lines.some((l) => l.includes('Export menu'))).toBe(true);
    expect(lines.some((l) => l.includes('Bridge refused'))).toBe(true);
    expect(lines.some((l) => l.includes('Play button'))).toBe(false);
  });

  it('loads stored operations on mount and clears them', async () => {
    const first = renderHook(() => useOperations());
    act(() => first.result.current.record(scope, elementDraft('map', 'Export menu', 'box', 'mapped')));
    await waitFor(async () => expect(await loadOperations()).toHaveLength(1));
    first.unmount();
    const { result } = renderHook(() => useOperations());
    await waitFor(() => expect(result.current.operations).toHaveLength(1));
    act(() => result.current.clearOperations());
    expect(result.current.operations).toEqual([]);
    await waitFor(async () => expect(await loadOperations()).toEqual([]));
  });
});
