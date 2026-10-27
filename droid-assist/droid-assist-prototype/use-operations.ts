import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadText } from './action-history.js';
import { OPERATION_LIMIT, clearOperations as clearStore, loadOperations, putOperation, type OperationRecord } from './operation-db.js';
import { buildOperation, type OperationDraft, type OperationScope } from './operation-log.js';
import { RELATED_LIMIT, exportOperations as exportEnvelope, relatedLines, type OperationQuery } from './operation-query.js';

/** Records loaded from the store merged under the ones written before the load finished, newest first. */
function mergeLoaded(current: OperationRecord[], stored: OperationRecord[]): OperationRecord[] {
  const ids = new Set(current.map((r) => r.id));
  return [...current, ...stored.filter((r) => !ids.has(r.id))].sort((a, b) => b.time - a.time).slice(0, OPERATION_LIMIT);
}

/**
 * The operation database in the engine: every recorded operation is kept in memory (newest
 * first, pruned to OPERATION_LIMIT) and written to IndexedDB in the background.
 */
export function useOperations() {
  const [operations, setOperations] = useState<OperationRecord[]>([]);
  const ref = useRef(operations);
  const publish = (next: OperationRecord[]) => {
    ref.current = next;
    setOperations(next);
  };

  useEffect(() => {
    let live = true;
    void loadOperations().then((stored) => live && publish(mergeLoaded(ref.current, stored)));
    return () => {
      live = false;
    };
  }, []);

  /** Records one operation in memory and in the store. */
  const record = useCallback((scope: OperationScope, draft: OperationDraft) => {
    const rec = buildOperation(scope, draft);
    publish([rec, ...ref.current].slice(0, OPERATION_LIMIT));
    void putOperation(rec);
  }, []);

  /** Prompt lines of the prior operations relevant to any of `texts` (an idea, a step target, the goal), deduplicated. */
  const related = useCallback((...texts: string[]) => [...new Set(texts.flatMap((t) => relatedLines(t, ref.current)))].slice(0, RELATED_LIMIT), []);

  /** Downloads the records matching `q` as a JSON export. */
  const exportOperations = useCallback((q: OperationQuery = {}) => {
    const out = exportEnvelope(ref.current, q);
    downloadText(`droid-operations-${out.exportedAt.replace(/[:.]/g, '-')}.json`, JSON.stringify(out, null, 2), 'application/json');
    return out.records.length;
  }, []);

  /** Deletes every operation from memory and the store. */
  const clearOperations = useCallback(() => {
    publish([]);
    void clearStore();
  }, []);

  return { operations, record, related, exportOperations, clearOperations };
}
