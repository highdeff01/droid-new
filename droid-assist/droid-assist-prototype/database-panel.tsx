import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { OPERATION_CATEGORIES, type OperationCategory, type OperationRecord } from './operation-db.js';
import { queryOperations, type OperationQuery } from './operation-query.js';
import styles from './droid-assist.module.css';

/** Error kinds offered in the filter. */
const ERROR_KINDS = ['ai', 'step', 'drift', 'bridge', 'watcher', 'test'];
/** The text filters, by query field and label. */
const TEXT_FILTERS: Array<{ key: 'text' | 'element' | 'project' | 'agent' | 'section' | 'op'; label: string }> = [
  { key: 'text', label: 'Search' },
  { key: 'element', label: 'Element' },
  { key: 'project', label: 'Project' },
  { key: 'agent', label: 'Agent' },
  { key: 'section', label: 'Section' },
  { key: 'op', label: 'Operation' },
];

/** A datetime-local value as ms, undefined when empty. */
const timeOf = (value: string) => (value ? new Date(value).getTime() : undefined);
/** Drops empty fields so the query (and its export) holds only the filters in use. */
const compact = (q: OperationQuery): OperationQuery => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')) as OperationQuery;

/** One stored operation: time, category/op, element, input → output, scope. */
function OperationItem({ r }: { r: OperationRecord }) {
  return (
    <li data-tone={r.ok ? 'ok' : 'error'}>
      <time>{new Date(r.time).toLocaleTimeString()}</time> <b>{r.category}/{r.errorKind ?? r.op}</b>
      {r.element ? ` "${r.element}"` : ''} {r.input || '(no input)'} → {r.output}
      <small> · {r.project} · {r.agent} · {r.section}</small>
    </li>
  );
}

/** The operation database: search and filter every recorded operation, export the matches as JSON, clear. */
export function DatabasePanel({ engine }: { engine: AssistEngine }) {
  const { operations } = engine;
  const [filters, setFilters] = useState<Record<string, string>>({});
  const set = (key: string) => (e: { target: { value: string } }) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const query = compact({
    ...Object.fromEntries(TEXT_FILTERS.map(({ key }) => [key, filters[key]?.trim()])),
    category: (filters.category || undefined) as OperationCategory | undefined,
    errorKind: filters.errorKind || undefined,
    since: timeOf(filters.since ?? ''),
    until: timeOf(filters.until ?? ''),
  });
  const shown = queryOperations(operations, query);
  return (
    <section className={styles.panel} aria-label="Database">
      <h3>Database <small>{shown.length} of {operations.length} operation(s)</small></h3>
      <div className={styles.row}>
        {TEXT_FILTERS.map(({ key, label }) => (
          <input key={key} aria-label={label} placeholder={label} value={filters[key] ?? ''} onChange={set(key)} />
        ))}
        <select aria-label="Category" value={filters.category ?? ''} onChange={set('category')}>
          <option value="">All categories</option>
          {OPERATION_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select aria-label="Error kind" value={filters.errorKind ?? ''} onChange={set('errorKind')}>
          <option value="">Any error kind</option>
          {ERROR_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input type="datetime-local" aria-label="Since" value={filters.since ?? ''} onChange={set('since')} />
        <input type="datetime-local" aria-label="Until" value={filters.until ?? ''} onChange={set('until')} />
      </div>
      <div className={styles.row}>
        <button type="button" onClick={() => engine.exportOperations(query)} disabled={!shown.length}>Export JSON</button>
        <button type="button" onClick={() => setFilters({})}>Reset filters</button>
        <button type="button" onClick={engine.clearOperations} disabled={!operations.length}>Clear</button>
      </div>
      {shown.length ? (
        <ul className={styles.log}>{shown.map((r) => <OperationItem key={r.id} r={r} />)}</ul>
      ) : (
        <p className={styles.muted}>No operations match.</p>
      )}
    </section>
  );
}
