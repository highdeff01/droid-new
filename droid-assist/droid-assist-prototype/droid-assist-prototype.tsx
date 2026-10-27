import { Routes, Route } from 'react-router-dom';
import { useAssist } from './use-assist.js';
import { Stage } from './stage.js';
import { Hud } from './hud.js';
import { ActionHistoryPanel, AgentsPanel, AiHelpPanel, AiHistoryPanel, BriefingPanel, CapabilitiesPanel, ComparisonGallery, ElementMapPanel, ElementsPanel, ErrorsPanel, LearnedCoordsPanel, LibraryPanel, LogPanel, LoopControlPanel, PatternsPanel, QwenThinkingPanel, RulerPanel, SettingsPanel, SupervisorPanel, WatcherPanel, WorkflowPanel } from './panels.js';
import { ActionHistoryPanel, AgentsPanel, AiHelpPanel, AiHistoryPanel, BriefingPanel, ComparisonGallery, ElementMapPanel, ElementsPanel, SnipGalleryPanel, ErrorsPanel, LearnedCoordsPanel, LibraryPanel, LogPanel, LoopControlPanel, PatternsPanel, QwenThinkingPanel, RulerPanel, SettingsPanel, SupervisorPanel, WatcherPanel, WorkflowPanel } from './panels.js';
import { AgentBusPanel, SubagentReportPanel } from './bus-panels.js';
import { TriggersPanel } from './triggers-panel.js';
import { AccessPathsPanel } from './access-paths-panel.js';
import { ApprovalsPanel } from './approvals-panel.js';
import { StatsPanel } from './stats-panel.js';
import { OperationMemoryPanel } from './memory-panel.js';
import { LiveBriefingPanel } from './live-briefing-panel.js';
import { ArtifactsPanel } from './capabilities-panel.js';
import { KnowledgePanel, PortfoliosPanel, ProfilePanel } from './knowledge-panel.js';
import { VariationsPanel } from './variations-panel.js';
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
        <LiveBriefingPanel engine={engine} />
        <div className={styles.work}>
          <Stage engine={engine} />
          <div className={styles.side}>
            <WorkflowPanel engine={engine} />
            <VariationsPanel engine={engine} />
            <RulerPanel engine={engine} />
            <ElementsPanel engine={engine} />
            <ElementMapPanel engine={engine} />
            <SnipGalleryPanel engine={engine} />
            <LearnedCoordsPanel engine={engine} />
            <LibraryPanel engine={engine} />
            <PatternsPanel engine={engine} />
            <OperationMemoryPanel engine={engine} />
            <KnowledgePanel engine={engine} />
            <ProfilePanel engine={engine} />
            <StatsPanel engine={engine} />
            <WatcherPanel engine={engine} />
            <TriggersPanel engine={engine} />
            <ApprovalsPanel engine={engine} />
            <ArtifactsPanel engine={engine} />
          </div>
        </div>
        <div className={styles.bottom}>
          <ComparisonGallery engine={engine} />
          <AiHelpPanel engine={engine} />
          <BriefingPanel engine={engine} />
          <AiHistoryPanel engine={engine} />
          <QwenThinkingPanel engine={engine} />
          <SupervisorPanel engine={engine} />
          <AgentsPanel engine={engine} />
          <PortfoliosPanel engine={engine} />
          <LoopControlPanel engine={engine} />
          <CapabilitiesPanel engine={engine} />
          <SettingsPanel engine={engine} />
          <AgentBusPanel engine={engine} />
          <SubagentReportPanel engine={engine} />
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
