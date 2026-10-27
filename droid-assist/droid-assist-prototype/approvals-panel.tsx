import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { CLASS_LABEL, OPERATION_CLASSES, hoursText, type ApprovalBranch, type ApprovalItem, type OperationClass } from './approvals.js';
import styles from './droid-assist.module.css';

/** One queued item: context, stale flag, note, and the approve/edit/reject actions. */
function ApprovalItemRow({ engine, item }: { engine: AssistEngine; item: ApprovalItem }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.edit ?? item.step?.text ?? item.summary);
  return (
    <li role="treeitem">
      <b>{item.summary}</b>
      <small> · {item.context} · queued {new Date(item.time).toLocaleTimeString()}</small>
      {item.stale ? <div className={styles.muted}>Stale: {item.stale}</div> : null}
      {item.note ? <div className={styles.muted}>{item.note}</div> : null}
      {editing ? (
        <>
          <input value={text} onChange={(e) => setText(e.target.value)} aria-label={`Edit ${item.summary}`} />
          <button type="button" aria-label={`Save edit ${item.summary}`} onClick={() => void engine.editItem(item.id, text)}>Save</button>
        </>
      ) : (
        <button type="button" aria-label={`Edit ${item.summary}`} onClick={() => setEditing(true)}>Edit</button>
      )}
      <button type="button" aria-label={`Approve ${item.summary}`} onClick={() => void engine.approveItem(item.id)}>Approve</button>
      <button type="button" aria-label={`Reject ${item.summary}`} onClick={() => engine.rejectItem(item.id)}>Reject</button>
    </li>
  );
}

/** One operation-class leaf: its label, then the pending items queued under it. */
function ClassNode({ engine, cls, items }: { engine: AssistEngine; cls: OperationClass; items: ApprovalItem[] }) {
  return (
    <li role="treeitem">
      {CLASS_LABEL[cls]}
      <ul>
        {items.map((item) => <ApprovalItemRow key={item.id} engine={engine} item={item} />)}
      </ul>
    </li>
  );
}

/** One requester branch: who asked, then its operation classes. */
function RequesterNode({ engine, branch }: { engine: AssistEngine; branch: ApprovalBranch }) {
  return (
    <li role="treeitem">
      {branch.requestedBy}
      <ul>
        {branch.classes.map((c) => <ClassNode key={c.cls} engine={engine} cls={c.cls} items={c.items} />)}
      </ul>
    </li>
  );
}

/** The last 10 decided items (approved, rejected or edited), newest queued first. */
function DecidedList({ approvals }: { approvals: ApprovalItem[] }) {
  const decided = approvals.filter((a) => a.status !== 'pending').slice(0, 10);
  return (
    <ul className={styles.log}>
      {decided.map((item) => <li key={item.id}>{item.summary} · {item.status}</li>)}
    </ul>
  );
}

/** The user's operation conditions: allowed classes, allowed hours and the project scope. */
function ConditionsEditor({ engine }: { engine: AssistEngine }) {
  const { operationPolicy } = engine.settings;
  const toggleClass = (cls: OperationClass) => {
    const allowedClasses = operationPolicy.allowedClasses.includes(cls)
      ? operationPolicy.allowedClasses.filter((c) => c !== cls)
      : OPERATION_CLASSES.filter((c) => operationPolicy.allowedClasses.includes(c) || c === cls);
    engine.setOperationPolicy({ allowedClasses });
  };
  return (
    <div>
      {OPERATION_CLASSES.map((cls) => (
        <label key={cls}>
          <input type="checkbox" checked={operationPolicy.allowedClasses.includes(cls)} onChange={() => toggleClass(cls)} aria-label={CLASS_LABEL[cls]} /> {CLASS_LABEL[cls]}
        </label>
      ))}
      <label>
        <input
          type="checkbox"
          checked={operationPolicy.hours === null}
          onChange={(e) => engine.setOperationPolicy({ hours: e.target.checked ? null : { start: 9, end: 17 } })}
          aria-label="Any time"
        /> Any time
      </label>
      {operationPolicy.hours ? (
        <>
          <input
            type="number"
            min={0}
            max={23}
            value={operationPolicy.hours.start}
            onChange={(e) => engine.setOperationPolicy({ hours: { start: Number(e.target.value), end: operationPolicy.hours!.end } })}
            aria-label="Allowed from hour"
          />
          <input
            type="number"
            min={0}
            max={23}
            value={operationPolicy.hours.end}
            onChange={(e) => engine.setOperationPolicy({ hours: { start: operationPolicy.hours!.start, end: Number(e.target.value) } })}
            aria-label="Allowed until hour"
          />
        </>
      ) : null}
      <small>{hoursText(operationPolicy.hours)}</small>
      <input value={operationPolicy.scope} onChange={(e) => engine.setOperationPolicy({ scope: e.target.value })} aria-label="Project scope" />
    </div>
  );
}

/** Approvals: the pending tree, a run-check button, recent decisions, and the operation conditions. */
export function ApprovalsPanel({ engine }: { engine: AssistEngine }) {
  const { approvals, approvalTree } = engine;
  const pending = approvalTree.reduce((n, b) => n + b.classes.reduce((m, c) => m + c.items.length, 0), 0);
  return (
    <section className={styles.panel} aria-label="Approvals">
      <h3>
        Approvals <small>{pending} pending</small>
        <button type="button" aria-label="Run check" onClick={() => engine.runApprovalCheck()}>Run check</button>
      </h3>
      {approvalTree.length === 0 ? (
        <p className={styles.muted}>No pending approvals</p>
      ) : (
        <ul role="tree">
          {approvalTree.map((branch) => <RequesterNode key={branch.requestedBy} engine={engine} branch={branch} />)}
        </ul>
      )}
      <DecidedList approvals={approvals} />
      <ConditionsEditor engine={engine} />
    </section>
  );
}
