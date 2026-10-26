import { Routes, Route } from 'react-router-dom';
import { useAssist } from './use-assist.js';
import { Stage } from './stage.js';
import { Hud } from './hud.js';
import { ActionHistoryPanel, AiHelpPanel, ComparisonGallery, ElementsPanel, ErrorsPanel, LibraryPanel, LogPanel, LoopControlPanel, PatternsPanel, QwenThinkingPanel, RulerPanel, SettingsPanel, WatcherPanel, WorkflowPanel } from './panels.js';
import styles from './droid-assist.module.css';

/** The Droid Assist workspace: live screen + overlay, HUDs, workflow, gallery, agents and log. */
function AssistScreen() {
  const engine = useAssist();
  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <svg className={styles.logo} viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="#0891b2" />
            <circle cx="16" cy="16" r="7" fill="none" stroke="#fff" strokeWidth="2.5" />
            <circle cx="16" cy="16" r="2.5" fill="#f472b6" />
          </svg>
          <span>Droid Assist <small>accessibility · screen AI · automation</small></span>
        </div>
      </header>
      <main className={styles.main}>
        <Hud engine={engine} />
        <div className={styles.work}>
          <Stage engine={engine} />
          <div className={styles.side}>
            <WorkflowPanel engine={engine} />
            <RulerPanel engine={engine} />
            <ElementsPanel engine={engine} />
            <LibraryPanel engine={engine} />
            <PatternsPanel engine={engine} />
            <WatcherPanel engine={engine} />
          </div>
        </div>
        <div className={styles.bottom}>
          <ComparisonGallery engine={engine} />
          <AiHelpPanel engine={engine} />
          <QwenThinkingPanel engine={engine} />
          <LoopControlPanel engine={engine} />
          <SettingsPanel engine={engine} />
          <LogPanel engine={engine} />
          <ErrorsPanel engine={engine} />
          <ActionHistoryPanel engine={engine} />
        </div>
      </main>
    </div>
  );
}

/** App router. */
export function DroidAssistPrototype() {
  return (
    <Routes>
      <Route path="/" element={<AssistScreen />} />
    </Routes>
  );
}
