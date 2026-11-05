import { useId, useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import styles from './droid-assist.module.css';

/** Tabbed workflow manager: Workflow (primary), Preview, AI Thinking, Settings */
export function WorkflowManager({ engine }: { engine: AssistEngine }) {
  const [activeTab, setActiveTab] = useState<'workflow' | 'preview' | 'thinking' | 'settings'>('workflow');
  const id = useId();
  const { steps, setSteps, draftCard, setDraftCard, timeline, aiStatus, settings } = engine;
  const tabs = ['workflow', 'preview', 'thinking', 'settings'] as const;

  const clock = (ms: number) => new Date(ms).toLocaleTimeString();
  const tabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, tab: (typeof tabs)[number]) => {
    const index = tabs.indexOf(tab);
    const nextIndex = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
        : event.key === 'Home' ? 0
          : event.key === 'End' ? tabs.length - 1 : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    setActiveTab(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  };
  const tabProps = (tab: (typeof tabs)[number]) => ({
    id: `${id}-tab-${tab}`,
    role: 'tab' as const,
    'aria-selected': activeTab === tab,
    'aria-controls': `${id}-panel-${tab}`,
    tabIndex: activeTab === tab ? 0 : -1,
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => tabKeyDown(event, tab),
  });

  return (
    <section className={styles.panel}>
      <div className={styles.tabNav} role="tablist" aria-label="Workflow sections">
        <button
          type="button"
          {...tabProps('workflow')}
          className={`${styles.tab} ${activeTab === 'workflow' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('workflow')}
        >
          📋 Workflow
        </button>
        <button
          type="button"
          {...tabProps('preview')}
          className={`${styles.tab} ${activeTab === 'preview' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('preview')}
        >
          👁️ Preview
        </button>
        <button
          type="button"
          {...tabProps('thinking')}
          className={`${styles.tab} ${activeTab === 'thinking' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('thinking')}
        >
          🤔 AI Thinking
        </button>
        <button
          type="button"
          {...tabProps('settings')}
          className={`${styles.tab} ${activeTab === 'settings' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          ⚙️ Settings
        </button>
      </div>

      {/* Workflow Tab - Primary content */}
      {activeTab === 'workflow' && (
        <div id={`${id}-panel-workflow`} className={styles.tabContent} role="tabpanel" aria-labelledby={`${id}-tab-workflow`} tabIndex={0}>
          <h3>Workflow <small>{steps.length} step(s)</small></h3>
          {!steps.length && <p className={styles.muted}>Record, or type a goal and press ✨ AI plan.</p>}
          
          <ol className={styles.steps}>
            {steps.map((s, i) => (
              <li key={s.id} data-status={s.status}>
                {s.shot ? (
                  <img src={s.shot.url} alt={`After step ${i + 1}`} title="Desktop screenshot after this step ran" />
                ) : s.refFrame ? (
                  <img src={s.refFrame.url} alt="" />
                ) : (
                  <span className={styles.noThumb}>{s.action}</span>
                )}
                <div>
                  <input
                    value={s.name}
                    onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    onFocus={(e) => {
                      e.currentTarget.dataset.was = e.currentTarget.value;
                    }}
                    onBlur={(e) => {
                      const name = e.currentTarget.value.trim();
                      if (name !== (e.currentTarget.dataset.was ?? '').trim()) {
                        engine.knowledge.noteSignal('correction', `renamed step to "${name}"`);
                      }
                    }}
                    aria-label={`Step ${i + 1} name`}
                  />
                  <small>
                    {s.action}
                    {s.target ? ` "${s.target}"` : ''}
                    {(s.action === 'key' || s.action === 'scroll') && s.text ? ` ${s.text}` : ''}
                    {' '}@ {(s.x * 100).toFixed(0)}%,{(s.y * 100).toFixed(0)}%
                    {s.endX !== undefined && s.endY !== undefined ? ` → ${s.endTarget ? `"${s.endTarget}" ` : ''}${(s.endX * 100).toFixed(0)}%,${(s.endY * 100).toFixed(0)}%` : ''}
                    {' '}· {s.status}
                    {s.verifiedAt !== undefined && <b aria-label={`Step ${i + 1} checked off`}> · ✓ {clock(s.verifiedAt)}</b>}
                    {s.delayMs !== undefined && ` · after ${s.delayMs}ms`}
                    {s.driftPx !== undefined && ` · drift ${s.driftPx}px`}
                    {s.drift !== undefined && ` · match ${s.drift.toFixed(3)}`}
                  </small>
                  {(s.beforeFrame || s.afterFrame) && (
                    <span className={styles.evidence} aria-label={`Step ${i + 1} evidence`}>
                      {s.beforeFrame && <img src={s.beforeFrame.url} alt={`Step ${i + 1} before`} title="Before" />}
                      {s.afterFrame && <img src={s.afterFrame.url} alt={`Step ${i + 1} after`} title="After" />}
                    </span>
                  )}
                </div>
                <button type="button" aria-label="Remove step" onClick={() => engine.removeStep(i)}>
                  ✕
                </button>
              </li>
            ))}
          </ol>

          {draftCard && (
            <div className={styles.card}>
              <input
                value={draftCard.name}
                onChange={(e) => setDraftCard({ ...draftCard, name: e.target.value })}
                aria-label="Workflow name"
                placeholder="Workflow name"
              />
              <textarea
                value={draftCard.description}
                onChange={(e) => setDraftCard({ ...draftCard, description: e.target.value })}
                aria-label="Workflow description"
                placeholder="Workflow description"
              />
              <button type="button" className={styles.primary} onClick={() => void engine.invoke('workflow.save')}>
                💾 Save
              </button>
            </div>
          )}
        </div>
      )}

      {/* Preview Tab */}
      {activeTab === 'preview' && (
        <div id={`${id}-panel-preview`} className={styles.tabContent} role="tabpanel" aria-labelledby={`${id}-tab-preview`} tabIndex={0}>
          <h3>Preview</h3>
          {!steps.length && <p className={styles.muted}>Add or record workflow steps to preview their captured evidence.</p>}
          <ol className={styles.steps}>
            {steps.map((step, index) => {
              const frame = step.afterFrame ?? step.shot ?? step.refFrame;
              return (
                <li key={step.id} data-status={step.status}>
                  {frame ? <img src={frame.url} alt={`Preview after step ${index + 1}`} /> : <span className={styles.noThumb}>{step.action}</span>}
                  <div>
                    <b>{step.name}</b>
                    <small>{step.status} · {(step.x * 100).toFixed(0)}%, {(step.y * 100).toFixed(0)}%</small>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* AI Thinking Tab */}
      {activeTab === 'thinking' && (
        <div id={`${id}-panel-thinking`} className={styles.tabContent} role="tabpanel" aria-labelledby={`${id}-tab-thinking`} tabIndex={0}>
          <h3>AI Thinking <small>{settings.aiModel}</small></h3>
          {aiStatus.state === 'offline' && <p className={styles.muted} role="alert">{aiStatus.detail}</p>}
          {!timeline.length && <p className={styles.muted}>No AI calls yet.</p>}
          <ul className={styles.log}>
            {timeline.map((e) => (
              <li key={e.id} data-tone={e.error ? 'error' : 'info'}>
                <time>{clock(e.time)}</time> <b>{e.kind}</b> {e.text || e.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div id={`${id}-panel-settings`} className={styles.tabContent} role="tabpanel" aria-labelledby={`${id}-tab-settings`} tabIndex={0}>
          <h3>Display Settings</h3>
          <label className={styles.setting}>
            <input type="checkbox" checked={settings.showTrail} onChange={(e) => engine.setSettings((current) => ({ ...current, showTrail: e.target.checked }))} />
            Show cursor trail
          </label>
          <label className={styles.setting}>
            <input type="checkbox" checked={settings.showGrid} onChange={(e) => engine.setSettings((current) => ({ ...current, showGrid: e.target.checked }))} />
            Show screen grid
          </label>
        </div>
      )}
    </section>
  );
}
