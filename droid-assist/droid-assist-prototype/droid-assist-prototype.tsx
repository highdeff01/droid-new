import { Routes, Route } from 'react-router-dom';
import { useAssist } from './use-assist.js';
import { Stage } from './stage.js';
import { Hud } from './hud.js';
import { ActionHistoryPanel, AgentsPanel, AiHelpPanel, AiHistoryPanel, BlacklistPanel, BriefingPanel, CapabilitiesPanel, ComparisonGallery, ElementMapPanel, ElementsPanel, ErrorsPanel, LearnedCoordsPanel, LibraryPanel, LogPanel, LoopControlPanel, PatternsPanel, QwenThinkingPanel, RulerPanel, SettingsPanel, SupervisorPanel, WatcherPanel, WorkflowPanel, SnipGalleryPanel, SectionsPanel, WakePanel } from './panels.js';
import { AgentBusPanel, AgentCrewPanel, SubagentReportPanel, CrewPanel, ResolutionPanel } from './bus-panels.js';
import { TriggersPanel } from './triggers-panel.js';
import { ProjectsPanel } from './projects-panel.js';
import { AccessPathsPanel } from './access-paths-panel.js';
import { ApprovalsPanel } from './approvals-panel.js';
import { StatsPanel } from './stats-panel.js';
import { OperationMemoryPanel, MemoryPanel } from './memory-panel.js';
import { LiveBriefingPanel } from './live-briefing-panel.js';
import { AiResponsesPanel } from './ai-responses-panel.js';
import { CurrentOperationPanel, PopupPanel } from './attention-panels.js';
import { ArtifactsPanel } from './capabilities-panel.js';
import { PersonaPanel } from './persona-panel.js';
import { KnowledgePanel, PortfoliosPanel, ProfilePanel } from './knowledge-panel.js';
import { VariationsPanel } from './variations-panel.js';
import { InventoryPanel, RetestPanel, RoutesPanel, SelfTestPanel } from './screen-ai-panels.js';
import { InitiativePanel } from './initiative-panel.js';
import { GoalsPanel } from './goals-panel.js';
import { CurrentOperationPanel as OperationProgressPanel } from './current-operation-panel.js';
import { SystemPanel } from './system-panel.js';
import { NotificationsPanel } from './notifications-panel.js';
import { DatabasePanel } from './database-panel.js';
import { PresentationPanel } from './presentation-panel.js';
import { NotificationStack } from './notification-stack.js';
import { OperationsPanel } from './operations-panel.js';
import { OperationsPanel as OpsAgentsPanel } from './ops-panel.js';
import { PanelBoard } from './panel-board.js';
import { movePanel, type PanelArea, type PanelId } from './panel-layout.js';
import type { AssistEngine } from './use-assist.js';
import styles from './droid-assist.module.css';

/** Every user-arrangeable panel by its layout id; the panels themselves render unchanged. */
const PANELS: Record<PanelId, (props: { engine: AssistEngine }) => JSX.Element | null> = {
  workflow: WorkflowPanel, operationProgress: OperationProgressPanel, selfTest: SelfTestPanel, aiResponses: AiResponsesPanel,
  variations: VariationsPanel, persona: PersonaPanel, ruler: RulerPanel, elements: ElementsPanel,
  elementMap: ElementMapPanel, snipGallery: SnipGalleryPanel, inventory: InventoryPanel, routes: RoutesPanel, retest: RetestPanel,
  sections: SectionsPanel, learnedCoords: LearnedCoordsPanel, library: LibraryPanel, patterns: PatternsPanel, blacklist: BlacklistPanel,
  operationMemory: OperationMemoryPanel, knowledge: KnowledgePanel, profile: ProfilePanel, stats: StatsPanel, memory: MemoryPanel,
  goals: GoalsPanel, notifications: NotificationsPanel, system: SystemPanel, watcher: WatcherPanel, wake: WakePanel,
  initiative: InitiativePanel, triggers: TriggersPanel, projects: ProjectsPanel, approvals: ApprovalsPanel, artifacts: ArtifactsPanel,
  presentation: PresentationPanel, operations: OperationsPanel,
  comparisonGallery: ComparisonGallery, aiHelp: AiHelpPanel, briefing: BriefingPanel, aiHistory: AiHistoryPanel,
  qwenThinking: QwenThinkingPanel, supervisor: SupervisorPanel, agents: AgentsPanel, portfolios: PortfoliosPanel,
  loopControl: LoopControlPanel, capabilities: CapabilitiesPanel, settings: SettingsPanel, agentBus: AgentBusPanel, crew: CrewPanel,
  agentCrew: AgentCrewPanel, opsAgents: OpsAgentsPanel, subagentReport: SubagentReportPanel, resolution: ResolutionPanel,
  log: LogPanel, errors: ErrorsPanel, actionHistory: ActionHistoryPanel, database: DatabasePanel,
};

/** The Droid Assist workspace: live screen + overlay, HUDs, workflow, gallery, agents and log. */
function AssistScreen() {
  const engine = useAssist();
  const layout = engine.settings.panelLayout;
  const onMove = (id: PanelId, area: PanelArea, before: PanelId | null) =>
    engine.setSettings((s) => ({ ...s, panelLayout: movePanel(s.panelLayout, id, area, before) }));
  const renderPanel = (id: PanelId) => {
    const Panel = PANELS[id];
    return <Panel engine={engine} />;
  };
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
      <NotificationStack engine={engine} />
      <main className={styles.main}>
        <Hud engine={engine} />
        <LiveBriefingPanel engine={engine} />
        <CurrentOperationPanel engine={engine} />
        <PopupPanel engine={engine} />
        <div className={styles.work}>
          <Stage engine={engine} />
          <PanelBoard area="side" ids={layout.side} className={styles.side} renderPanel={renderPanel} onMove={onMove} />
        </div>
        <PanelBoard area="bottom" ids={layout.bottom} className={styles.bottom} renderPanel={renderPanel} onMove={onMove} />
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
