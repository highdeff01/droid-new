import type { OperationCategory, OperationRecord } from './operation-db.js';
import { similarity } from './planner.js';

/** Default number of records a query returns. */
export const QUERY_LIMIT = 200;
/** Prior operations pulled into an AI prompt by default. */
export const RELATED_LIMIT = 6;
/** Least goal-word coverage for a record to count as related. */
export const RELATED_MIN = 0.34;

/** A filter over the operation database; every field is optional and they combine with AND. */
export interface OperationQuery {
  /** Case-insensitive substring of element, op, agent, input or output. */
  text?: string;
  /** Case-insensitive substrings of the scope fields. */
  element?: string;
  project?: string;
  agent?: string;
  section?: string;
  /** Exact matches. */
  op?: string;
  category?: OperationCategory;
  errorKind?: string;
  /** Inclusive time bounds (ms since epoch). */
  since?: number;
  until?: number;
  /** Maximum records returned (newest first); default QUERY_LIMIT. */
  limit?: number;
}

/** The export envelope of a query's records. */
export interface OperationExport {
  format: 'droid-assist-operations';
  version: 1;
  exportedAt: string;
  query: OperationQuery;
  records: OperationRecord[];
}

const contains = (value: string | undefined, needle: string) => (value ?? '').toLowerCase().includes(needle.toLowerCase());
const searchable = (r: OperationRecord) => [r.element, r.op, r.agent, r.input, r.output].join('\n');

type Check = (r: OperationRecord, q: OperationQuery) => boolean;

/** One check per query field; an unset field passes. */
const CHECKS: Check[] = [
  (r, q) => !q.text || contains(searchable(r), q.text),
  (r, q) => !q.element || contains(r.element, q.element),
  (r, q) => !q.project || contains(r.project, q.project),
  (r, q) => !q.agent || contains(r.agent, q.agent),
  (r, q) => !q.section || contains(r.section, q.section),
  (r, q) => !q.op || r.op === q.op,
  (r, q) => !q.category || r.category === q.category,
  (r, q) => !q.errorKind || r.errorKind === q.errorKind,
  (r, q) => q.since === undefined || r.time >= q.since,
  (r, q) => q.until === undefined || r.time <= q.until,
];

/** Whether a record passes every set field of the query. */
export const matchesQuery = (r: OperationRecord, q: OperationQuery) => CHECKS.every((check) => check(r, q));

/** The records matching `q`, newest first, at most `q.limit` (default QUERY_LIMIT). */
export function queryOperations(records: OperationRecord[], q: OperationQuery = {}): OperationRecord[] {
  return records.filter((r) => matchesQuery(r, q)).sort((a, b) => b.time - a.time).slice(0, q.limit ?? QUERY_LIMIT);
}

/** Prior operations relevant to `text` (an idea, goal or step): best goal-word coverage first, ties newest first. */
export function relatedOperations(text: string, records: OperationRecord[], limit = RELATED_LIMIT, min = RELATED_MIN): OperationRecord[] {
  if (!text.trim()) return [];
  return records
    .map((r) => ({ r, score: similarity(text, searchable(r)) }))
    .filter((s) => s.score >= min)
    .sort((a, b) => b.score - a.score || b.r.time - a.r.time)
    .slice(0, limit)
    .map((s) => s.r);
}

/** One prompt line of a prior operation. */
export function operationLine(r: OperationRecord): string {
  const kind = r.errorKind ? `${r.category}/${r.errorKind}` : `${r.category}/${r.op}`;
  const element = r.element ? ` "${r.element}"` : '';
  return `- [${kind}]${element} ${r.input || '(no input)'} → ${r.ok ? 'ok' : 'FAILED'}: ${r.output} (${r.agent}, ${r.section})`;
}

/** Prompt lines of the prior operations relevant to `text`. */
export const relatedLines = (text: string, records: OperationRecord[], limit = RELATED_LIMIT) => relatedOperations(text, records, limit).map(operationLine);

/** The export envelope of the records matching `q` (no row limit unless the query sets one). */
export function exportOperations(records: OperationRecord[], q: OperationQuery = {}, now = new Date()): OperationExport {
  return { format: 'droid-assist-operations', version: 1, exportedAt: now.toISOString(), query: q, records: queryOperations(records, { ...q, limit: q.limit ?? records.length }) };
}
