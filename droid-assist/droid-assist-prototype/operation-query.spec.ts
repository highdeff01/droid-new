import { describe, expect, it } from 'vitest';
import type { OperationRecord } from './operation-db.js';
import { exportOperations, operationLine, queryOperations, relatedLines, relatedOperations } from './operation-query.js';

const rec = (id: string, time: number, over: Partial<OperationRecord> = {}): OperationRecord => ({
  id, time, project: 'Invoice flow', agent: 'Replay', section: 'executor', category: 'track', op: 'click', element: 'Save button', input: 'click "Save button"', output: 'Clicked', ok: true, ...over,
});

const records = [
  rec('a', 100),
  rec('b', 200, { category: 'error', op: 'bridge', errorKind: 'bridge', element: undefined, input: 'export the report', output: 'Bridge refused the connection', ok: false, agent: 'Errors', section: 'bridge' }),
  rec('c', 300, { category: 'element', op: 'map', element: 'Export menu', input: 'box at (10%, 10%)', output: 'Mapped', project: 'Report', agent: 'Element map', section: 'elementMap' }),
  rec('d', 400, { category: 'capture', op: 'source', element: undefined, input: 'desktop', output: 'Capturing the desktop', project: 'Report', agent: 'Capture', section: 'capture' }),
];
const ids = (rs: OperationRecord[]) => rs.map((r) => r.id);

describe('queryOperations', () => {
  it('returns everything newest first by default', () => {
    expect(ids(queryOperations(records))).toEqual(['d', 'c', 'b', 'a']);
  });

  it('filters by element, project and agent case-insensitively', () => {
    expect(ids(queryOperations(records, { element: 'export' }))).toEqual(['c']);
    expect(ids(queryOperations(records, { project: 'report' }))).toEqual(['d', 'c']);
    expect(ids(queryOperations(records, { agent: 'element' }))).toEqual(['c']);
    expect(ids(queryOperations(records, { section: 'capture' }))).toEqual(['d']);
  });

  it('filters by exact operation type, category and error kind', () => {
    expect(ids(queryOperations(records, { op: 'map' }))).toEqual(['c']);
    expect(ids(queryOperations(records, { category: 'capture' }))).toEqual(['d']);
    expect(ids(queryOperations(records, { errorKind: 'bridge' }))).toEqual(['b']);
    expect(ids(queryOperations(records, { errorKind: 'drift' }))).toEqual([]);
  });

  it('filters by an inclusive time range and searches free text', () => {
    expect(ids(queryOperations(records, { since: 200, until: 300 }))).toEqual(['c', 'b']);
    expect(ids(queryOperations(records, { text: 'REFUSED' }))).toEqual(['b']);
  });

  it('combines filters and honours the limit', () => {
    expect(ids(queryOperations(records, { project: 'invoice', category: 'track' }))).toEqual(['a']);
    expect(ids(queryOperations(records, { limit: 2 }))).toEqual(['d', 'c']);
  });
});

describe('cross-reference', () => {
  it('pulls prior operations, elements and errors relevant to an idea', () => {
    expect(ids(relatedOperations('Export the report from the menu', records))).toEqual(expect.arrayContaining(['b', 'c']));
    expect(ids(relatedOperations('Export the report from the menu', records))).not.toContain('a');
  });

  it('returns nothing for an unrelated or empty idea', () => {
    expect(relatedOperations('water the plants', records)).toEqual([]);
    expect(relatedOperations('  ', records)).toEqual([]);
  });

  it('renders related records as prompt lines with outcome and scope', () => {
    expect(operationLine(records[1])).toBe('- [error/bridge] export the report → FAILED: Bridge refused the connection (Errors, bridge)');
    expect(relatedLines('save button', records, 1)).toEqual(['- [track/click] "Save button" click "Save button" → ok: Clicked (Replay, executor)']);
  });
});

describe('exportOperations', () => {
  it('wraps the matching records in a versioned envelope', () => {
    const out = exportOperations(records, { project: 'Report' }, new Date(0));
    expect(out).toEqual({ format: 'droid-assist-operations', version: 1, exportedAt: '1970-01-01T00:00:00.000Z', query: { project: 'Report' }, records: [records[3], records[2]] });
  });

  it('exports every record when no limit is set', () => {
    const many = Array.from({ length: 250 }, (_, i) => rec(`r${i}`, i));
    expect(exportOperations(many).records).toHaveLength(250);
  });
});
