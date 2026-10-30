import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActionRecord, Annotation, AssistSettings, FamiliarElement, Frame, Habit, InputAction, LearnedPattern, LogEntry, SavedCard, ScreenSource, StepAction, SyncLevel, TrailPoint, WorkflowStep } from './types.js';
import { POINTER_ACTIONS } from './types.js';
import { MATCHED, SAMPLE_H, SAMPLE_W, SEARCH_RADIUS, STABLE, boundingBox, boxDistance, correctDrift, diffCells, frameDistance, largestCluster, matchTemplate, syncLevelFor, type DriftThresholds } from './drift.js';
import { AD_CYCLE, demoAd, demoDrag, demoFileAt, demoPlayButton, drawDemoDesktop, findIcon, initialDemoFile, initialDemoIcons, moveIcon, type DemoFile, type DemoIcon } from './demo-desktop.js';
import { AI_PLAN_SOURCE, calculate, generateCard, patternLine, planFromGoal, planRemaining, relevantPatterns, relocateTarget, replanDrag, replanStep, uid } from './planner.js';
import { checkMoved, sameElement, verifyArrangement, type Expectation, type MovedElement } from './rearrange.js';
import { AI_VIEWS, AiCancelled, AiError, AiParseError, isRepeatLimit, DEFAULT_AI_MODEL, DEFAULT_AI_TIMEOUT_MS, DEFAULT_AI_URL, DEFAULT_AI_VIEW, createAiSession, linkSignals, pingAi, stripThinking, thinkingOnlyNotice } from './ai.js';
import { OVERLAP_PREFIX, firstValid } from './ai-overlap.js';
import { STAGE_LABEL, appContextSections, escalationNotice, suggestedGoal, type EscalationEvent, type EscalationHooks } from './ai-escalation.js';
import type { AiReply, AiStatus, AskFn, AskRequest, AutoSaveFn, HistoryChangeFn } from './ai.js';
import { HISTORY_WINDOW_DEFAULT, historyChangeText } from './ai-history.js';
import { DEFAULT_STAGES, createStageControllers, stageOff, toggleMessage, type StageId } from './loop-control.js';
import { DEFAULT_AI_MAX_IN_FLIGHT, createAiQueue, type AiQueue, type AiQueueStats } from './ai-queue.js';
import { confirmTarget, decidePopup, describeScreen, judgeStep, reflectOn, verifyGoal, type GoalCheck, type PopupDecision, type StepResult, type TargetCheck, type Thought } from './assist-ai.js';
import { DEFAULT_GRID_OPACITY } from './grid-overlay.js';
import { MARKER_OF, createCursorAnimator, type CursorAnimator } from './cursor-path.js';
import { defaultWhy, intentionDraft, intentionText } from './intention.js';
import { ATTEMPT_LIMIT, type OperationAttempt } from './current-operation.js';
import { DEFAULT_MAX_ITERATIONS, autoContinue, judgeCheck, type ContinueStop, type RunReport } from './auto-continue.js';
import { DEFAULT_CHANGE_CELLS, assessChange, changeText, detectChange, type ChangeAssessment, type ScreenChange } from './screen-change.js';
import { localProposal, proposalText, proposeStep, type Proposal, type ProposalContext } from './proposal.js';
import { addEntry, verdictText, type ThinkingEntry, type ThoughtKind } from './thinking-timeline.js';
import { radarStatus, radarStatusText, radarTick, startRadar, type RadarEvent, type RadarState, type RadarTarget } from './radar.js';
import { predictNextPosition, selfMoveSightings } from './mobility.js';
import { BRIDGE_REQUIRED, captureDesktop, checkBridge, dragEnd, pointerAction, selfTestBridge, sendNative, type BridgeResult } from './bridge.js';
import { DRY_RUN, dragEndError, groundTarget, runStep, type Grounding, type SendFn, type StepDeps, type StepOutcome } from './run-step.js';
import { NO_SOURCE, captureLabel, captureStatus, stepPlan, type FrameProvider, type StepPlan } from './capture-source.js';
import { DEFAULT_STEP_RETRIES, avoidPattern, describeAttempt, runLadder, type Attempt } from './retry-ladder.js';
import { boxedFrames, patchAt, renderView, zoomBox, zoomFrame } from './grounding.js';
import { parseCommand, type CommandName } from './commands.js';
import { createPlanGuard } from './plan-guard.js';
import { createScreenCapture, fullJpeg, monitorInterval, type CapturedImage, type ScreenCapture } from './capture.js';
import { DEFAULT_ABORT_HOTKEY, DEFAULT_ACTION_BUDGET, createBudget, dispatchState, matchesHotkey, spendAction, type ActionBudget, type HotkeyEvent, sanitizeBudget } from './safety.js';
import { continuesScroll, keyCombo, keyStep, scrollStep, stepDelay, SCROLL_MERGE_MS } from './recorder.js';
import { loadAvoidRules, saveAvoidRules } from './storage.js';
import { DEFAULT_AVOID_TTL_HOURS, deadlockRules, isBlocking, recordFailure, ruleLine, ruleScope, ttlMs, withoutRules, type AvoidRule } from './blacklist.js';
import { LOG_LIMIT, loadCards, loadElementMap, loadFamiliar, loadHabits, loadLog, loadOperationMemory, loadPatterns, loadRunSummaries, loadSettings, loadTriggers, loadWatcher, saveCards, saveElementMap, saveFamiliar, saveHabits, saveLog, saveOperationMemory, savePatterns, saveRunSummaries, saveSettings, saveTriggers, saveWatcher, loadAccessPaths, saveAccessPaths, loadRouteProfiles, loadFixMethods, saveRouteProfiles, saveFixMethods, loadDossiers, saveDossiers, loadScreenSections, saveScreenSections, loadPersonas, savePersonas, loadOpsState, saveOpsState } from './storage.js';
import { DEFAULT_PANEL_LAYOUT } from './panel-layout.js';
import { mirrorMode, mirrorStep, type MirrorEvent } from './mirror-input.js';
import { addEntry as addPortfolioEntry, createPersona, upsertPersona, type Persona, type PortfolioKind } from './persona.js';
import { logSightings, monitorChanges, perspective, planLanes, type ElementReport, type Lane, type Perspective, type Sighting } from './element-relevance.js';
import { askPlayTurn, type PlayTurn } from './play-turn.js';
import { TRIGGER_LIMIT, TRIGGER_TICK_MS, afterFire, afterSkip, conditionText, createTrigger, fireGate, observeElement, outcomeText, resolveTarget, scheduleDue, type ElementSnapshot, type ElementTrigger, type RunOutcome, type ScheduleTrigger, type Trigger, type TriggerDraft, targetText } from './triggers.js';
import { appendSummary, runSummary, type RunSummary, runTotals } from './run-stats.js';
import { addTest, mergeNotes, mergeProposals, observeScreen, patchProposal, proposalStep, recallNotes, reorderSteps, type NoteKind, type Observation, type ProposalKind, type WatchProposal, type WatcherState } from './watcher.js';
import { DEFAULT_WAKE_MS } from './wake.js';
import type { DecisionHandlers, WakeDecision } from './wake-decision.js';
import { useWake } from './use-wake.js';
import { forgetElement, listElements, rememberElement, type ScreenElement } from './elements.js';
import { gridRef } from './grid.js';
import { POINTER_LIMIT, detectDwell, dwellObservation, findFamiliar, learnCoordinate, learnedSeed, learnedTargets, type CoordObservation } from './coords.js';
import { boxCenter, mapContext, mapElement, mappedLine, toFamiliar, unmapElement, type MappedElement, type PerformFn } from './element-map-studio.js';
import { scanElements } from './auto-scan.js';
import { catchPlan, mergeScan, motionOf, motionTiming, trackingContext, type ActorInput, type ScanMerge } from './element-tracking.js';
import { navigateStep, parsePerformProposal, performRequest, performText, resolveMappedStep, setPerform } from './element-perform.js';
import { RESEARCH_SYSTEM, trainElement, type TrainingDeps, type TrainingReport } from './element-training.js';
import { cropFrame, identifyAndVerify, identifyRequest, noteChange, parseIdentification, recentlySent, type AgentCheck, type ChangeHit, type IdentifyInput, type IdentifyOutcome, type IdentifyReason, type Identification } from './identify.js';
import type { Box, StepVerdict } from './assist-ai.js';
import { decodeFrames, toStoredFrame } from './frame-codec.js';
import { loadStoredFrames, putStoredFrame, pruneCorruptFrames } from './frame-store.js';
import { appendHistory, clearHistory, downloadText, historyToCsv, historyToJson, loadHistory } from './action-history.js';
import { REVERSE_ACTOR, reverseOffer } from './reverse.js';
import { CREW_SIZE_DEFAULT, parseIntercept } from './crew.js';
import { useCrew } from './use-crew.js';
import { failurePattern, flowCard, learnPatterns, mergePatterns, newPattern, runVerdict, upsertCard } from './flow-memory.js';
import { NO_ASSESSMENT, SUPERVISOR_INTERVAL_MS, SUPERVISOR_REPLAN_LIMIT, SUPERVISOR_TICK_MS, applyFixes, executorBusy as supervisorExecutorBusy, habitPatterns, haltText, isConfident, replanFeedback, reviewDecision, reviewRun, reviewText, staleFixes, type PendingFix, type SupervisorReview, type SupervisorState } from './supervisor.js';
import { BUS_AGENTS, BUS_AGENT_IDS, elementLine, forward, isGridLabel, markHandled, predefine, type BusAgentId, type BusMessage, type ForwardedElement } from './agent-bus.js';
import { isTestGoal, listSections, parseTestSpec, planSubagents, reportPatterns, runSubagents, summaryText, type SubagentOutcome, type SubagentReport, type SubagentTask, type TestRequest } from './subagents.js';
import { useErrorForwarding } from './use-error-forwarding.js';
import { useApprovals } from './use-approvals.js';
import { DEFAULT_OPERATION_POLICY, decisionLesson, editedStep, type ApprovalItem, type OperationPolicy } from './approvals.js';
import { buildElementMap } from './element-map.js';
import type { Calibration } from './calibration.js';
import { remapStep, useMeasure } from './use-measure.js';
import { anchoredHabit, habitLine, recordOutcome, relevantHabits, seedFromAnchor, strengthenHabit, togglePin } from './habits.js';
import { addBriefing, briefingIssues, briefingText, buildBriefing, type Briefing } from './briefing.js';
import { addSnip, clampBox, parseSnipArgs, snipFrame, snipText, type Snip, type SnipBy, type SnipSize, type SnipSource } from './snip.js';
import { fromSnip, reroute, targetRegion, toSnip, type RerouteDecision, type RerouteDeps } from './reroute.js';
import { reviewBriefing, type ReviewDeps } from './briefing-review.js';
import type { Knowledge } from './cross-reference.js';
import { useKnowledge } from './use-knowledge.js';
import { useVariations } from './use-variations.js';
import { FAILURE_CONTEXT_LIMIT, RECENT_LINES, addFailure, addNote as addOperationMemoryNote, failureFromRun, failureLine, forget, memoryBlock, newFailure, objectiveText, operationGroups, similarFailures, type FailureRecord, type OperationMemory } from './operation-memory.js';
import { toStep } from './project.js';
import { useProjects } from './use-projects.js';
import { findWorldElement, initialWorld, onWorldToggle, worldClick, worldContext, worldDoubleClick, worldDrag, worldKey, worldTick, worldType, type World, type WorldResult } from './test-world.js';
import { findQuestElement, initialQuest, onQuestToggle, questClick, questContext, questDoubleClick, questDrag, questElementAt, questKey, questType, type Quest, type QuestResult } from './quest-world.js';
import { findScenario, progressLines, scenarioComplete } from './test-world-scenarios.js';
import { MAX_DISCOVERY, OBJECTIVE_TONE, chainReport, discoverTarget, isChainGoal, locateTarget, objectiveLine, planChain, type ChainObjective, type ChainPlan, type ChainRun, type DiscoveryMove } from './chain.js';
import { applyReach, currentPath, deletePath, editPath, isHopAction, learnPaths, parseHops, pathLine, pathOutcome, pathSteps, reachTarget, relevantPaths, runPath, usablePath, type AccessProfile, type Reach } from './access-paths.js';
import { useResolution } from './use-resolution.js';
import { AUTO_RETRY_LABEL, AUTO_RETRY_TICK_MS, countAttempts, retryDue, retryText, type RetryCounts } from './auto-retry.js';
import { DISAGREEMENT_THRESHOLD } from './resolution-center.js';
import { dropGoal, loadGoals, projectId, queueGoal, saveGoals, settleGoal, startGoal, type GoalRecord } from './goal-objectives.js';
import { DEFAULT_GOAL_STALL, type GoalSource } from './goal-tracer.js';
import { ALL_PROJECTS, addUserNote, loadKnowledge, markInjected, noteLine, pendingNotesFor, saveKnowledge, type UserNote } from './knowledge-store.js';
import { MAIN_AI, markPreferred, type PreferredShot } from './live-briefing.js';
import { LIVE_SETTINGS, applyLiveSetting, capabilityPrompt, permission, requesterName, type AgentId, type CapabilityRequest, type LiveSetting, type Params, type Requester } from './capabilities.js';
import { useCapabilities, type CapabilityDeps } from './use-capabilities.js';
import { useCapabilityRegistry } from './use-capability-registry.js';
import type { AssistStatus } from './main-app-bridge.js';
import { backupFileName, exportBackup } from './backup.js';

/** The main AI and the main Droid app as capability requesters. */
const AI: Requester = { kind: 'ai' };
const MAIN_APP: Requester = { kind: 'main-app' };
import { usePacks } from './use-packs.js';
import { buildInventory, inventoryLines, type InventoryElement } from './screen-inventory.js';
import { plotRoutes, recordProfileResult, resolveHop, routeSteps, routeText, saveProfile, type Route, type RouteProfile } from './route-plot.js';
import { FAIL_THRESHOLD, failureKey, fixScriptText, generateFixScript, needsFix, noteResult, saveFixMethod, type FixContext, type FixMethod, type FixScript } from './fix-script.js';
import { refreshStep, retestSummary, retestText, retestedSteps, runRetest, selectSteps, type RetestStepResult, type RetestSummary } from './retest.js';
import { findDossier, recordObservation as recordSighting, recordOutcome as recordPositionOutcome, recordTest, setMove, setPreferred, type Mover, type PositionDossier } from './position-dossier.js';
import { compensate, seedPoint } from './position-compensation.js';
import { buildMemory, memoryLines } from './enhanced-memory.js';
import { addSection, buildProfiles, changeInScope, createSection, inScope, findSection, parseBoxArg, parseSectionProposals, recordEvent, removeSection, scopeLines, scopeSections, scopedMapped, sectionMemoryLines, sectionsRequest, type ScreenSection, type SectionEvent } from './sections.js';
import { extractReplica, parseReplicaNaming, replicaLine, replicaToFamiliar, replicaToMapped, replicateRequest, type Replica } from './replicate.js';
import { DEFAULT_SIDE_TEST_MODE, busFeedback, feedbackLine, findingsToNotes, runSideTest, sentinelScan, splitSideArgs, textFindings, type SentinelAlert, type SideTestDeps, type SideTestPlan, type SideTestResult, type WatchedPosition } from './side-test.js';
import { DEFAULT_AUTO_APPLY as DEFAULT_INITIATIVE_AUTO_APPLY, DEFAULT_SCAN_SEC, DEFAULT_STRESS_CYCLES } from './initiative.js';
import { useInitiative } from './use-initiative.js';
import { testTargets } from './self-test.js';
import { autoSideTestPlan, correctionFix, interactionKey, noteInteraction, pointBox, routeTrail, sideTestDue, type Interactions } from './auto-populate.js';
import { runSelfTest, selfTestText, type SelfTestReport } from './self-test-run.js';
import { useGoalTracer } from './use-goal-tracer.js';
import { DEFAULT_AUTO_ACT, actionStep, actionText, diskSuggestion, habitSuggestions, suggestWithAi, type AssistNotification } from './notifications.js';
import { DEFAULT_BREAK_MINUTES, backgroundTestsAllowed, breakPeriodMs, breakText, relaxInterval, relaxStep } from './relax.js';
import { DEFAULT_SYSTEM_REFRESH_SEC, diskLow, formatBytes, recentOperations } from './system-info.js';
import { recoverStorage, recoveryFile, recoveryFileName, recoveryText, restoreLastGood, snapshotLastGood, type RecoveryReport } from './recovery.js';
import { useNotifications } from './use-notifications.js';
import { useSystemInfo } from './use-system-info.js';
import type { CaptureInput } from './error-forwarding.js';
import { LOG_CAPTURE_WINDOW_MS, logErrorKind } from './error-forwarding.js';
import { ERRORS_SOURCE } from './use-error-forwarding.js';
import { captureDraft, elementDraft, errorDraft, errorSection, ideaDraft, projectOf, trackDraft, type OperationDraft } from './operation-log.js';
import { useOperationDatabase, useOperations } from './use-operations.js';
import { usePresentations } from './use-presentations.js';
import { askResearch } from './presentation-caps.js';
import type { Got } from './presentation-sources.js';
import { drawWorldScreen, worldImageAt } from './presentation-project.js';
import { DEFAULT_EXECUTION_MODE, EXECUTION_MODES, modeCaptureMs, modeChangeText, modeStatus, resolveAiDirective, type ExecutionMode, type ModeActor, type ModeDirective } from './execution-mode.js';
import { DEFAULT_AUTO_APPLY, autoApplyDecision, bestGrounding, groundGoal, groundedStep, groundingShift, judgeCandidate, judgmentText, type KnownGrounding, type HeldCandidate, type Judgment } from './aggressive.js';
import { NOT_CONNECTED, createMainBridge, defaultBridgeMode, type MainBridge, type MainBridgeConfig, type MainBridgeState } from './main-bridge.js';
import type { FramePayload, InboundMessage, InterceptKind, InterceptPayload, JointRole, ResultPayload, RunScriptPayload } from './main-bridge-protocol.js';
import { JOINT_SOURCE, useJoint } from './use-joint.js';
import { errorApp, interceptError } from './joint-errors.js';
import { CROSS_REFERENCE_LINES } from './joint-followup.js';
import { loadOperations } from './operation-db.js';
import { DEFAULT_OPERATION_RETRIES } from './operation-retry.js';
import { DEFAULT_PLAYBACK_WINDOW_SEC } from './playback.js';
import { CREW_AGENTS, createScreenLock, decideCrew, reportNote, runCrew, type CrewAgent, type CrewCommand, type CrewDecision, type CrewReport, type CrewStop } from './agent-crew.js';
import { runLiveDrag, type DragIntervention, type LiveDragResult, type SwarmAgent } from './drag-swarm.js';
import { OPS_AGENTS, OPS_SYSTEM, addEvidence, addOpsReport, changeKey, changeLine, dedupeLog, enabledOps, loopReport, mapDelta, markEvidence, monitorChange, opsAgent, opsFor, parseOpsTarget, patchOpsAgent, shouldReport, tagLog, type MonitorChange, type OpsAgentId, type OpsState, type TestCandidate } from './operations.js';
import { createOpsWorkers, type Applied, type OpsWorkResult } from './ops-workers.js';
import { placeWindow } from './window-placement.js';
import { AI_RECHECK_MS, BREAKER_IDLE, PAUSE_POLL_MS, conflictDetails, dispatchKey, gateStep, modePauseText, pauseReason, strike, type Breaker, type GateBlock } from './dispatch-gate.js';
import { CADENCE_MS, CADENCE_TICK_MS, addReports, dueAgents, reportContext, type AgentReport, type CadenceAgent } from './agent-cadence.js';
import { activityReports } from './agent-activity.js';
import { IDLE_ATTENTION, focusOn, scopeLines as scopeAttention, type Attention } from './attention.js';
import { NO_BACKOFF, backoffStatus, backoffText, clearBackoff, noteRepeatLimit, repeatLimitLine, type AiBackoff } from './ai-backoff.js';
import { ABORT_HINT, ABORTED_REFUSAL, DEFAULT_ABORT_AUTO_CLEAR_MIN, refusedWhileAborted, useAbortAutoClear } from './abort-latch.js';
import { checkoffSummary, completeText, incompleteText, workflowComplete } from './workflow-progress.js';

const DEMO_W = 960;
const DEMO_H = 540;
/** How often background suggestions (habits, disk, AI) are made. */
const SUGGEST_TICK_MS = 10 * 60_000;
/** Shortest time between automatic section proposals. */
const SECTIONS_AUTO_MS = 5 * 60_000;
/** Most recent ruler measurements given to the planner as context. */
const MEASURED_CONTEXT = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** Log text of a failed model call: a user cancel says so, anything else is the endpoint failure after `what`. */
const aiFailure = (what: string, error: unknown) => (error instanceof AiCancelled ? `AI call cancelled by the user — ${what.replace(/^AI unavailable — /, '')}` : `${what}: ${errorText(error)}`);
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

/** Draws a source into a Frame: a 480×270 display JPEG, the full-resolution JPEG for the model and the 320×180 drift buffer. */
function toFrame(src: CanvasImageSource, srcW: number, srcH: number, id: number, source: Frame['source']): Frame {
  const small = document.createElement('canvas');
  small.width = SAMPLE_W;
  small.height = SAMPLE_H;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(src, 0, 0, SAMPLE_W, SAMPLE_H);
  const view = document.createElement('canvas');
  view.width = 480;
  view.height = 270;
  view.getContext('2d')!.drawImage(src, 0, 0, 480, 270);
  return { id, time: Date.now(), url: view.toDataURL('image/jpeg', 0.7), full: fullJpeg(src, srcW, srcH), data: sctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H), srcW, srcH, source };
}

/** A JPEG/PNG data URL decoded and drawn into a Frame; a zero size falls back to the image's own. */
async function imageFrame(dataUrl: string, width: number, height: number, id: number, source: Frame['source']): Promise<Frame> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return toFrame(img, width || img.naturalWidth, height || img.naturalHeight, id, source);
}

/** A real desktop screenshot from the bridge as a Frame; throws with the bridge's reason. */
async function desktopFrame(bridgeUrl: string, token: string, id: number): Promise<Frame> {
  const shot = await captureDesktop(bridgeUrl, token);
  if (!shot.ok) throw new Error(shot.message);
  return imageFrame(shot.frame.image, shot.frame.width, shot.frame.height, id, 'desktop');
}

/** The main app bridge's connection settings. */
const mainBridgeConfig = (s: AssistSettings): MainBridgeConfig => ({
  enabled: s.mainBridgeEnabled,
  mode: s.mainBridgeMode,
  host: s.mainBridgeHost,
  port: s.mainBridgePort,
  url: s.mainBridgeUrl,
  token: s.mainBridgeToken,
  backoffMinMs: s.mainBridgeBackoffMinMs,
  backoffMaxMs: s.mainBridgeBackoffMaxMs,
});

/** One workflow step as a run_script command for the main app (normalized coordinates). */
const runScriptPayload = ({ name, action, x, y, endX, endY, text, target }: WorkflowStep): RunScriptPayload => ({ name, action, x, y, endX, endY, text, target });

/** Bus recipients of an intercept that carries no position: agents that only take notes, never a point. */
const NOTE_ONLY_AGENTS: BusAgentId[] = ['progress', 'goal', 'supervisor'];

/** Workflow actions that are real mouse/keyboard input, as recorded in the action history. */
const INPUT_ACTIONS: Partial<Record<StepAction, InputAction>> = { click: 'click', double_click: 'double_click', move: 'move', drag: 'drag', scroll: 'scroll', type: 'type', key: 'key' };

/** A history message that says nothing was dispatched: prefixed with DRY_RUN unless the step's message already says it. */
const dryRunMessage = (message: string, simulated: boolean) => {
  const label = message.includes(DRY_RUN) ? message : `${DRY_RUN} — ${message}`;
  return simulated ? `${label} (simulated on the demo desktop)` : label;
};

/** Where a history record ran, as the reversal error names it. */
const VIA_LABEL: Record<ActionRecord['via'], string> = { bridge: 'desktop bridge', 'main-app': 'main Droid app', demo: 'demo desktop' };

/** Steps the browser itself answers on the demo desktop (no screen input). */
const LOCAL_ACTIONS: Partial<Record<StepAction, (step: WorkflowStep) => Promise<{ ok: boolean; message: string }>>> = {
  calc: async (s) => {
    const v = calculate(s.text ?? '');
    return v === null ? { ok: false, message: `"${s.text ?? ''}" is not a valid expression` } : { ok: true, message: `${s.text} = ${v}` };
  },
  search: async (s) => {
    window.open(`https://duckduckgo.com/?q=${encodeURIComponent(s.text ?? '')}`, '_blank', 'noopener');
    return { ok: true, message: `Opened a search for "${s.text ?? ''}"` };
  },
  wait: async () => {
    await sleep(800);
    return { ok: true, message: 'Waited' };
  },
};

/** One step's real result plus whether the run must stop (abort, disarm, budget) and, for a drag, what it grabbed and moved. */
type Performed = StepOutcome & { halt?: boolean; grabbed?: string; moved?: MovedElement; replanned?: boolean; paused?: boolean };

/** Auto Act's continuation state: the goal it verifies, checks in a row without progress, rounds made. */
type AutoLoop = { goal: string; stalls: number; iteration: number };

const refused = (step: WorkflowStep, message: string): Performed => ({ ok: false, executed: false, halt: true, message, target: { x: step.x, y: step.y } });

/** What one simulated input did on the demo: its log message and whether it hit something. */
type DemoOutcome = { message: string; ok: boolean };
/** A Desktop-scene message as an outcome: a blocked target or a miss is not ok. */
const desktopOutcome = (message: string): DemoOutcome => ({ message, ok: !/blocked|nothing/.test(message) });
/** The actor name the Apply agent dispatches under; it records its own before/after evidence. */
const OPS_APPLY_ACTOR = 'Apply agent';

const at = (x: number, y: number) => `(${(x * 100).toFixed(1)}%, ${(y * 100).toFixed(1)}%)`;
/** Timeline text of a popup decision. */
const popupSummary = (d: PopupDecision) => (d.close ? `Close the popup at ${at(d.x, d.y)} — ${d.reason}` : `Leave it — ${d.reason}`);
/** The executor's verdict on a step before dispatch: run it as proposed, wait, or fail honestly. */
type Justified = { kind: 'go'; step: WorkflowStep; proposal: Proposal } | { kind: 'wait'; reason: string; waitMs?: number } | { kind: 'fail'; reason: string };
/** Describes the pending step for the screen-change responder. */
const describeNext = (s: WorkflowStep | undefined) => (s ? `"${s.name}" — ${s.action} "${s.target ?? s.name}" at ${at(s.correctedX ?? s.x, s.correctedY ?? s.y)}` : null);
/**
 * The step a proposal runs: a local proposal or a first proposal of a template-recorded step runs as
 * planned (the template locates the target); otherwise at the proposed point, dropping a stale template on a re-proposal.
 */
function adopt(step: WorkflowStep, p: Proposal, redo: boolean): WorkflowStep {
  if (p.source === 'local' || (step.refFrame && !redo)) return step;
  return { ...step, x: p.x, y: p.y, ...(redo ? { refFrame: undefined, correctedX: undefined, correctedY: undefined } : {}) };
}
/** Timeline text of a model plan; null for a reused saved flow (no model call). */
const planSummary = (r: { source: string; steps: WorkflowStep[] }) => (r.source.startsWith(AI_PLAN_SOURCE) ? `${r.steps.length} step(s): ${r.steps.map((s) => `${s.action} "${s.target ?? s.name}"`).join(' → ')}` : null);
/** Timeline text of a grounding check on a zoomed crop. */
const checkSummary = (step: WorkflowStep, p: { x: number; y: number }) => (c: TargetCheck) => `${c.visible ? 'Target confirmed' : 'Target not'} at ${at(p.x, p.y)} for "${step.target ?? step.name}" — ${c.reason}`;
/** Timeline and log text of an auto-continue goal check. */
const goalSummary = (c: GoalCheck) => `${c.complete ? 'Goal COMPLETE' : 'Goal not complete'}${c.complete ? '' : c.progress ? ' (progress made)' : ' (no progress)'} — ${c.reason}`;
/** One-line text of a plan's steps. */
const stepsText = (steps: WorkflowStep[]) => steps.map((s) => `${s.action} "${s.target ?? s.name}"`).join(' → ');
/** Log tone of each way an auto-continue loop ends. */
const STOP_TONE: Record<ContinueStop, LogEntry['tone']> = { complete: 'ok', aborted: 'warn', halted: 'error', cap: 'warn', 'no-progress': 'warn' };

/** Log source of a multi-element chain run. */
const CHAIN = 'Chain';
/** Timeline text of a chain breakdown. */
const chainSummary = (p: ChainPlan) => `${p.objectives.length} objective(s): ${p.objectives.map((o) => o.name).join(' → ')}`;
/** Timeline and log text of a discovery decision. */
const discoverySummary = (m: DiscoveryMove) => {
  if (m.kind === 'found') return `found at ${at(m.x, m.y)} — ${m.why}`;
  if (m.kind === 'explore') return `${m.step.action} "${m.step.target ?? m.step.name}"${m.step.text ? ` ${m.step.text}` : ''} to reveal it — ${m.why}`;
  return `gave up — ${m.why}`;
};

/** Timeline text of a watcher observation. */
const observationSummary = (o: Observation) => `${o.notes.length} note(s), ${o.proposals.length} proposal(s)${o.notes.length ? `: ${o.notes.map((n) => n.text).join('; ')}` : ''}`;

/** Actors whose recorded input is the user's own; every other actor is an AI/agent. */
const USER_ACTORS: ReadonlySet<string> = new Set(['You', 'Recorder']);
/** Most recent user/AI inputs kept for move attribution. */
const ACTOR_INPUT_LIMIT = 50;
/** Log text of one auto-scan that changed the map; null when nothing changed. */
const scanSummary = (r: ScanMerge): string | null => {
  if (!r.added && !r.moved.length) return null;
  const moves = r.moved.map(({ element, move }) => `"${element.name}" moved ${at(boxCenter(move.from).x, boxCenter(move.from).y)} → ${at(boxCenter(move.to).x, boxCenter(move.to).y)} (${move.cause === 'self' ? 'by itself' : `by the ${move.cause === 'user' ? 'user' : 'AI'}`})`);
  return [`${r.added} new, ${r.seen} seen, ${r.moved.length} moved`, ...moves].join(' · ');
};

/** Default settings. */
export const DEFAULT_SETTINGS: AssistSettings = {
  crewSize: CREW_SIZE_DEFAULT,
  gallerySize: 10,
  checkpoints: 6,
  captureMs: 500,
  changeCells: DEFAULT_CHANGE_CELLS,
  driftStable: STABLE,
  driftMatched: MATCHED,
  driftRadius: SEARCH_RADIUS,
  monitorMode: 'app',
  executionMode: DEFAULT_EXECUTION_MODE,
  autoApply: DEFAULT_AUTO_APPLY,
  displayId: null,
  watchMs: 5000,
  wakeMs: DEFAULT_WAKE_MS,
  autoAct: false,
  aiHelp: true,
  showTrail: true,
  showGrid: true,
  gridLabels: false,
  gridOpacity: DEFAULT_GRID_OPACITY,
  bridgeUrl: '',
  bridgeToken: '',
  abortHotkey: DEFAULT_ABORT_HOTKEY,
  abortAutoClearMin: DEFAULT_ABORT_AUTO_CLEAR_MIN,
  actionBudget: DEFAULT_ACTION_BUDGET,
  aiUrl: DEFAULT_AI_URL,
  aiModel: DEFAULT_AI_MODEL,
  aiView: DEFAULT_AI_VIEW,
  aiThink: false,
  autoContinue: true,
  liveDrag: false,
  maxIterations: DEFAULT_MAX_ITERATIONS,
  stepRetries: DEFAULT_STEP_RETRIES,
  avoidTtlHours: DEFAULT_AVOID_TTL_HOURS,
  operationRetries: DEFAULT_OPERATION_RETRIES,
  playbackWindowSec: DEFAULT_PLAYBACK_WINDOW_SEC,
  aiMaxInFlight: DEFAULT_AI_MAX_IN_FLIGHT,
  aiTimeoutMs: DEFAULT_AI_TIMEOUT_MS,
  aiHistoryWindow: HISTORY_WINDOW_DEFAULT,
  goalStall: DEFAULT_GOAL_STALL,
  masterPrompt: '',
  aiOverlap: false,
  stages: DEFAULT_STAGES,
  errorUrl: '',
  errorForwarding: false,
  errorToken: '',
  operationPolicy: DEFAULT_OPERATION_POLICY,
  autoScan: true,
  trainMode: 'background',
  sideTestMode: DEFAULT_SIDE_TEST_MODE,
  scanSec: DEFAULT_SCAN_SEC,
  selfTestMode: 'background',
  stressCycles: DEFAULT_STRESS_CYCLES,
  initiativeAutoApply: DEFAULT_INITIATIVE_AUTO_APPLY,
  relaxMode: false,
  breakMinutes: DEFAULT_BREAK_MINUTES,
  systemRefreshSec: DEFAULT_SYSTEM_REFRESH_SEC,
  notifyAutoAct: DEFAULT_AUTO_ACT,
  systemFolders: [],
  panelLayout: DEFAULT_PANEL_LAYOUT,
  mainBridgeEnabled: true,
  mainBridgeMode: 'listen',
  mainBridgeHost: '127.0.0.1',
  mainBridgePort: 8787,
  mainBridgeUrl: '',
  mainBridgeToken: '',
  mainBridgeBackoffMinMs: 1000,
  mainBridgeBackoffMaxMs: 30000,
};

/** A background agent the user can toggle; each also has an inbox on the inter-agent bus. */
export interface Agent {
  id: Exclude<BusAgentId, 'habits'> | 'identify' | 'goalTracer';
  name: string;
  description: string;
  on: boolean;
}

/**
 * The assistant engine: screen capture (demo, screen share, desktop bridge), monitor modes,
 * visual error detection, recording, grounded real input, replay, Auto Act, AI plan/help,
 * slash commands, action history and saved workflows.
 */
export function useAssist() {
  /** Startup recovery runs before any store is loaded, so every loader reads repaired data. */
  const [recovery, setRecovery] = useState<RecoveryReport>(() => recoverStorage());
  const [settings, setSettings] = useState<AssistSettings>(() => loadSettings({ ...DEFAULT_SETTINGS, mainBridgeMode: defaultBridgeMode() }));
  const [source, setSource] = useState<ScreenSource>('demo');
  /** The app the assistant is attached to via /use. */
  const [target, setTarget] = useState<string | null>(null);
  const [history, setHistory] = useState<ActionRecord[]>(() => loadHistory());
  /** Normalized point the last executed pointer action left the cursor at: the previously-focused point of the next action. */
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  /** The last action written to the history, so a side test can backtrack exactly what it did. */
  const lastRecordRef = useRef<ActionRecord | null>(null);
  const [reversing, setReversing] = useState(false);
  const [shotCount, setShotCount] = useState(0);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [pinned, setPinned] = useState<Frame[]>([]);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [trail, setTrail] = useState<TrailPoint[]>([]);
  const [recording, setRecording] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [sync, setSync] = useState<{ level: SyncLevel; detail: string }>({ level: 'idle', detail: 'No active step' });
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  /** Every performStep call (one attempt each), oldest first, for the Current operation panel. */
  const [attempts, setAttempts] = useState<OperationAttempt[]>([]);
  const attemptsRef = useRef<OperationAttempt[]>([]);
  /** The planner's recorded \"why\" per step id, set from its proposal before the step runs. */
  const intentWhyRef = useRef(new Map<string, string>());
  const animatorRef = useRef<CursorAnimator | null>(null);
  /** The AI cursor animator: every frame of a movement moves the cursor and extends the trail. */
  const animator = () => (animatorRef.current ??= createCursorAnimator({
    frame: (p) => {
      const t = Date.now();
      setCursor(p);
      setTrail((trail) => [...trail, { x: p.x, y: p.y, t }].slice(-1500));
    },
    mark: (p) => setTrail((t) => [...t, p].slice(-1500)),
  }));
  /** Shows one attempt at `p` as a humanized AI cursor movement. */
  const aim = (p: { x: number; y: number }) => animator().aim(p);
  const [log, setLog] = useState<LogEntry[]>(loadLog);
  const [cards, setCards] = useState<SavedCard[]>([]);
  /** Lessons learned from finished runs, fed into future planning. */
  const [patterns, setPatterns] = useState<LearnedPattern[]>(loadPatterns);
  const [familiar, setFamiliar] = useState<FamiliarElement[]>(loadFamiliar);
  const [elementMap, setElementMap] = useState<MappedElement[]>([]);
  const [mapMode, setMapMode] = useState(false);
  const [mapDraft, setMapDraft] = useState<Box | null>(null);
  /** Snipped regions (AI, agents, reroutes, user), newest first, in memory. */
  const [snips, setSnips] = useState<Snip[]>([]);
  /** The user is dragging a region to snip on the stage. */
  const [snipMode, setSnipMode] = useState(false);
  /** Per-target, per-app habits learned from every executed step, applied to planning and grounding. */
  const [habits, setHabits] = useState<Habit[]>(() => loadHabits());
  const [avoidRules, setAvoidRules] = useState<AvoidRule[]>(loadAvoidRules);
  /** One summary per finished run (newest first), for the Stats panel. */
  const [runs, setRuns] = useState<RunSummary[]>(loadRunSummaries);
  /** Per-element position dossiers (positions, dwell, moves, best/preferred, planned vs actual), persisted. */
  const [dossiers, setDossiers] = useState<PositionDossier[]>(loadDossiers);
  /** The Screen watcher's notes, proposals and test results (persisted). */
  const [watcher, setWatcher] = useState<WatcherState>(loadWatcher);
  const [triggers, setTriggers] = useState<Trigger[]>(loadTriggers);
  /** Per-operation memory: failure reminders with screenshots, and the user's notes (persisted). */
  const [memory, setMemory] = useState<OperationMemory>(loadOperationMemory);
  /** Per-target, per-app access paths (versioned), tried before fresh grounding. */
  const [accessPaths, setAccessPaths] = useState<AccessProfile[]>(loadAccessPaths);
  const accessPathsRef = useRef<AccessProfile[]>(accessPaths);
  /** Targets whose saved path was already counted during the current run (not re-counted when the run is learned). */
  const pathCountedRef = useRef(new Set<string>());
  /** Named screen sections with their per-section histories (persisted), and the sections the goal is secluded to. */
  const [sections, setSections] = useState<ScreenSection[]>(loadScreenSections);
  const [scope, setScope] = useState<string[]>([]);
  /** Elements the AI replicated by itself, newest first; side-test results, newest first. */
  const [replicas, setReplicas] = useState<Replica[]>([]);
  const [sideResults, setSideResults] = useState<SideTestResult[]>([]);
  const [highlight, setHighlight] = useState<{ x: number; y: number; label: string } | null>(null);
  const [draftCard, setDraftCard] = useState<{ name: string; description: string } | null>(null);
  const [goal, setGoal] = useState('');
  const [progress, setProgress] = useState({ done: 0, manual: 0 });
  const [agents, setAgents] = useState<Agent[]>([
    { id: 'popup', name: 'Popup watcher', description: 'Flags ads & intrusive popups, auto-closes when Auto act is on', on: true },
    { id: 'drift', name: 'Drift monitor', description: 'Cross-checks every frame against the active step', on: true },
    { id: 'progress', name: 'Progress tracker', description: 'Counts verified steps toward the goal', on: true },
    { id: 'goal', name: 'Goal reviewer', description: 'Reviews the goal after each run and suggests what is next', on: true },
    { id: 'identify', name: 'Element identifier', description: 'Sends missed, unproposed, new or changing elements to the AI and agent-tests the answer (3 tries / 30 s)', on: true },
    { id: 'screen', name: BUS_AGENTS.screen, description: 'Observes forwarded elements on the live screen', on: true },
    { id: 'coords', name: 'Coordinate learner', description: 'Learns target coordinates from cursor dwell and verified actions; seeds grounding with them', on: true },
    { id: 'supervisor', name: 'Supervisor', description: 'Reviews all agents, screenshots and thinking; applies confident fixes, performs them if the executor does not, and splits link/route tests into subagents', on: true },
    { id: 'sidetest', name: BUS_AGENTS.sidetest, description: 'Runs side research and experiment → backtrack → main tests on other windows; reports results on the bus', on: true },
    { id: 'goalTracer', name: 'Goal tracer', description: 'Traces the active goal live from step outcomes, screenshot verdicts and agent reports; flags off-path runs, stalls and completion', on: true },
  ]);
  /** The inter-agent message bus: every forwarded element in each recipient's inbox, newest first. */
  const [bus, setBus] = useState<BusMessage[]>([]);
  /** Elements the coordinate learner predefined from forwards, newest first. */
  const [knownElements, setKnownElements] = useState<ForwardedElement[]>([]);
  /** The latest link/route subagent test report; null before the first. */
  const [subReport, setSubReport] = useState<SubagentReport | null>(null);
  const [subRunning, setSubRunning] = useState(false);
  /** The agent crew the main AI commands (/crew) and whether a crew run is going. */
  const [crewAgents, setCrewAgents] = useState<CrewAgent[]>(() => CREW_AGENTS.map((id) => ({ id, status: 'waiting', task: null, lastReport: null })));
  const [crewRunning, setCrewRunning] = useState(false);
  /** The Operations agents: statuses, reports and the before/after evidence trail (persisted), and whether an /ops run is going. */
  const [ops, setOps] = useState<OpsState>(loadOpsState);
  const [opsRunning, setOpsRunning] = useState(false);
  /** Every agent's live activity reports on the cadence, newest first (kept out of the activity log). */
  const [agentReports, setAgentReports] = useState<AgentReport[]>([]);
  const agentReportsRef = useRef<AgentReport[]>([]);
  /** When each cadence agent last reported. */
  const reportedAtRef = useRef<Record<string, number>>({});
  /** What the AI is focused on right now. */
  const [attention, setAttention] = useState<Attention>(IDLE_ATTENTION);
  /** Point out runs by itself every CADENCE_MS until stopped. */
  const [pointOutAuto, setPointOutAuto] = useState(false);
  /** The coordinate agents of the running (or last) live drag. */
  const [swarm, setSwarm] = useState<SwarmAgent[]>([]);
  const [liveDragging, setLiveDragging] = useState(false);
  const [plays, setPlays] = useState(0);
  const [armed, setArmed] = useState(false);
  /** The last health check or bridge call reached the PC (and the PC did not fail it). */
  const [bridgeOnline, setBridgeOnline] = useState(false);
  /** The main Droid app's connection: off, waiting for it, connecting, connected or failed with the last error. */
  const [mainBridge, setMainBridge] = useState<MainBridgeState>({ status: 'off', lastError: null, peer: null });
  const mainBridgeRef = useRef<MainBridge | null>(null);
  const [aborted, setAborted] = useState(false);
  /** When the ABORTED latch was set (for the HUD banner); null while clear. */
  const [abortedAt, setAbortedAt] = useState<number | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus>({ state: 'checking', detail: 'Connecting to the AI endpoint…' });
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  /** Model calls in flight (planning, reflecting, deciding, verifying). */
  const [aiCalls, setAiCalls] = useState(0);
  /** Shared AI queue: calls waiting for a slot and calls running against the endpoint. */
  const [aiQueue, setAiQueue] = useState<AiQueueStats>({ queued: 0, inFlight: 0 });
  /** An auto-continue loop is running. */
  const [continuing, setContinuing] = useState(false);
  /** Per-step Qwen thinking timeline, newest first: thought, reflection and verdict of every AI call. */
  const [timeline, setTimeline] = useState<ThinkingEntry[]>([]);
  /** Pre-action briefings, newest first (in memory, BRIEFING_LIMIT), one per dispatched step. */
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  /** The multi-element chain being run or last run: its objective breakdown and completion report. */
  const [chain, setChain] = useState<ChainRun | null>(null);
  const chainRef = useRef<ChainRun | null>(null);
  /** Objective records (persisted): the current objective, next goals and settled ones. */
  const [objectives, setObjectives] = useState<GoalRecord[]>(() => loadGoals());
  /** User notes in the knowledge store (persisted), injected once into each targeted project's next AI call. */
  const [userNotes, setUserNotes] = useState<UserNote[]>(() => loadKnowledge());
  /** Key frames the main AI and the agents marked as preferred, newest first. */
  const [preferred, setPreferredShots] = useState<PreferredShot[]>([]);
  /** The last execution-mode change as logged, shown in every briefing; null before the first. */
  const [modeChange, setModeChange] = useState<string | null>(null);
  const modeChangeRef = useRef<string | null>(null);
  /** The AI-down circuit breaker of pack/workflow runs (strikes and why dispatch is paused). */
  const [breaker, setBreaker] = useState<Breaker>(BREAKER_IDLE);
  const breakerRef = useRef<Breaker>(BREAKER_IDLE);
  /** Steps already escalated to the planner for a blocked dispatch this run (once each). */
  const escalatedRef = useRef<Set<string>>(new Set());
  /** The goal the current run verifies (the main goal, or one derived for a pack run). */
  const runGoalRef = useRef('');
  /** Aggressive-mode candidates held for the user's Apply, newest first. */
  const [candidates, setCandidates] = useState<HeldCandidate[]>([]);
  const candidatesRef = useRef<HeldCandidate[]>([]);
  /** Candidates auto-applied since the plan started (bounded by autoApply.maxPerRun). */
  const autoAppliedRef = useRef(0);
  /** Steps whose aggressive candidate the user dismissed: they get the normal proposal. */
  const dismissedGroundingRef = useRef(new Set<string>());
  const [captureLost, setCaptureLost] = useState<string | null>(null);
  const [supervisor, setSupervisor] = useState<SupervisorState>({ status: 'idle', detail: 'No review yet', review: null, applied: false });
  /** The full-screen reading of the newest frame: every detected element. */
  const [inventory, setInventory] = useState<InventoryElement[]>([]);
  const inventoryRef = useRef<InventoryElement[]>([]);
  const inventoryFrameRef = useRef<Frame | null>(null);
  /** The ranked routes last plotted for the goal. */
  const [routes, setRoutes] = useState<Route[]>([]);
  const routesRef = useRef<Route[]>([]);
  /** Reusable access-path profiles: routes that reached a goal (persisted). */
  const [routeProfiles, setRouteProfiles] = useState<RouteProfile[]>(loadRouteProfiles);
  const routeProfilesRef = useRef(routeProfiles);
  /** Fix scripts that repaired an element/flow, offered first next time (persisted). */
  const [fixMethods, setFixMethods] = useState<FixMethod[]>(loadFixMethods);
  const fixMethodsRef = useRef(fixMethods);
  /** Consecutive failures per element/flow, for when to propose a fix script. */
  const failuresRef = useRef<Record<string, number>>({});
  /** Uses and failures per target since the last automatic side tests, and when each target was last side-tested. */
  const interactionsRef = useRef<Interactions>({});
  const sideTestedRef = useRef<Record<string, number>>({});
  /** When sections were last proposed automatically. */
  const sectionsProposedAtRef = useRef(0);
  const [selfTestReport, setSelfTestReport] = useState<SelfTestReport | null>(null);
  /** The fix script awaiting review in the pre-action briefing; null when none. */
  const [pendingFix, setPendingFix] = useState<FixScript | null>(null);
  const pendingFixRef = useRef<FixScript | null>(null);
  /** The last retest's per-step results and verdict; null before the first. */
  const [retest, setRetest] = useState<{ results: RetestStepResult[]; summary: RetestSummary } | null>(null);

  const demoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureRef = useRef<ScreenCapture | null>(null);
  const tickRef = useRef(0);
  /** The demo desktop's draggable Report file. */
  const demoFileRef = useRef<DemoFile>(initialDemoFile());
  /** The demo desktop's rearrangeable sidebar icons. */
  const demoIconsRef = useRef<DemoIcon[]>(initialDemoIcons());
  /** The test world's state, and whether it (rather than the Desktop) is the shown demo scene. */
  const worldRef = useRef<World>(initialWorld());
  const worldOnRef = useRef(false);
  /** The quest world's state, and whether it (rather than the Puzzle Quest window) is the shown Desktop scene. */
  const questRef = useRef<Quest>(initialQuest());
  const questOnRef = useRef(false);
  /** The arrangement the current plan asks for (from the planner's "expect"). */
  const expectRef = useRef<Expectation[]>([]);
  const dismissedCycleRef = useRef(-1);
  const framesRef = useRef<Frame[]>([]);
  const stepsRef = useRef<WorkflowStep[]>([]);
  const settingsRef = useRef(settings);
  const sourceRef = useRef(source);
  /** Set when the user explicitly picks the demo desktop; the bridge then no longer takes over. */
  const demoChosenRef = useRef(false);
  const popupRef = useRef<Annotation | null>(null);
  const popupBaseRef = useRef<Frame | null>(null);
  const popupFrameRef = useRef<Frame | null>(null);
  /** The popup the model already ruled on, so it is asked once per popup. */
  const popupDecidedRef = useRef<string | null>(null);
  const abortRef = useRef(false);
  const autoBusyRef = useRef(false);
  const pollBusyRef = useRef(false);
  const lastPollErrorAt = useRef(0);
  const frameId = useRef(Date.now());
  const restoredIdsRef = useRef(new Set<number>());
  const cardsHydratedRef = useRef(false);
  const lastStepAt = useRef(0);
  const armedRef = useRef(armed);
  const abortedRef = useRef(aborted);
  const autoBudgetRef = useRef<ActionBudget>(createBudget(settings.actionBudget));
  /** Mirror input: the preview is interactive (user gestures dispatch as input) while on. */
  const [mirrorOn, setMirrorOn] = useState(false);
  const mirrorOnRef = useRef(false);
  /** One action budget per mirror session, fresh each time mirror input is switched on. */
  const mirrorBudgetRef = useRef<ActionBudget>(createBudget(settings.actionBudget));
  /** The last mirrored wheel gesture, so a burst of wheel events dispatches one scroll. */
  const mirrorScrollRef = useRef<{ dir: 'up' | 'down'; at: number } | null>(null);
  /** Stage modes that take precedence over mirror input, current as of the last render. */
  const stageModeRef = useRef({ ruler: false, map: false });
  /** Bridge reachability as of the last render, so mirror input dispatches only when its badge says LIVE. */
  const mirrorBridgeRef = useRef(false);
  /** Trims and resets of the AI history land here (wired to the log once addLog exists). */
  const historyChangeRef = useRef<HistoryChangeFn>(() => undefined);
  /** Each 100-message milestone of the AI archive lands here (wired to the auto-save once addLog exists). */
  const autoSaveRef = useRef<AutoSaveFn>(() => undefined);
  /** The thinking-on escalation hooks of the session, set below once the app-context sources exist. */
  const escalationRef = useRef<Required<EscalationHooks>>({ appContext: async () => ({ sections: [] }), onStage: () => undefined });
  const aiSessionRef = useRef(createAiSession(typeof sessionStorage === 'undefined' ? null : sessionStorage, renderView, (c) => historyChangeRef.current(c), {
    appContext: () => escalationRef.current.appContext(),
    onStage: (e) => escalationRef.current.onStage(e),
  }, (archive) => autoSaveRef.current(archive), typeof localStorage === 'undefined' ? null : localStorage));
  const [aiHistory, setAiHistory] = useState(() => aiSessionRef.current.history());
  /** Cancels every in-flight model call when aborted; replaced by a fresh one after each cancel. */
  const aiCtrlRef = useRef(new AbortController());
  /** Loop control: one controller per stage, so unchecking a stage cancels only its in-flight calls. */
  const stageCtrlsRef = useRef(createStageControllers());
  /** Shared model-call queue: executor/grounding first, pipeline next, agents last; at most aiMaxInFlight running. */
  const [aiQueueApi] = useState(() => createAiQueue(settings.aiMaxInFlight, setAiQueue, settings.aiTimeoutMs));
  const aiQueueRef = useRef<AiQueue>(aiQueueApi);
  const aiStatusRef = useRef(aiStatus);
  const logRef = useRef(log);
  const goalRef = useRef(goal);
  const userNotesRef = useRef(userNotes);
  const replayingRef = useRef(false);
  const recordingRef = useRef(false);
  /** Time of the last recorded input (or of recording start), for each recorded step's measured human pause. */
  const lastInputRef = useRef(0);
  /** Hands each recorded step to the workflow pack being recorded (set once the packs hook exists). */
  const packCaptureRef = useRef<(step: WorkflowStep) => void>(() => undefined);
  const cardsRef = useRef<SavedCard[]>([]);
  const patternsRef = useRef<LearnedPattern[]>(patterns);
  /** Re-plan loop guard for autoPlan, the plan in flight, and step status changes made by execution. */
  const planGuardRef = useRef(createPlanGuard());
  const planningRef = useRef(false);
  const statusChangesRef = useRef(0);
  const habitsRef = useRef<Habit[]>(habits);
  const avoidRulesRef = useRef<AvoidRule[]>(avoidRules);
  const familiarRef = useRef<FamiliarElement[]>(familiar);
  const dossiersRef = useRef<PositionDossier[]>(dossiers);
  /** Ids of the steps whose systematic position offset was already applied (once per step). */
  const offsetStepsRef = useRef(new Set<string>());
  /** Live cursor positions over the stage, for the coordinate learner's dwell detection. */
  const pointerRef = useRef<TrailPoint[]>([]);
  /** Start time of the last dwell the coordinate learner handled, so each rest is observed once. */
  const dwellSeenRef = useRef(-1);
  const targetRef = useRef(target);
  const sectionsRef = useRef<ScreenSection[]>(sections);
  const scopeRef = useRef<string[]>(scope);
  /** Whether any step of the current Auto Act run was only a dry run (such a run is never saved). */
  const autoDryRef = useRef(false);
  /** This app session (one page load), stamped on every run summary. */
  const sessionRef = useRef(uid('session'));
  /** When the current run started; null between runs. */
  const runStartRef = useRef<number | null>(null);
  /** The saved flow (card id) the current steps came from or were saved as; null for a fresh plan. */
  const flowRef = useRef<string | null>(null);
  /** Auto Act's verify → plan → continue loop while it is running; null between loops. */
  const autoLoopRef = useRef<AutoLoop | null>(null);
  const timelineRef = useRef(timeline);
  const syncRef = useRef(sync);
  const progressRef = useRef(progress);
  /** Corrections the supervisor applied that the executor has not carried out yet. */
  const pendingFixesRef = useRef<PendingFix[]>([]);
  const supervisorBusyRef = useRef(false);
  /** Set while the supervisor itself moves the pointer; Auto Act waits for it. */
  const supervisorMovingRef = useRef(false);
  const lastReviewAt = useRef(Date.now());
  /** Routes an error-tone log line into the Errors list (assigned once error forwarding exists). */
  const logErrorRef = useRef<(from: string, message: string, time: number) => void>(() => undefined);
  /** Automatic main-retry attempts by step id; a new manual run starts the counts afresh. */
  const retryCountsRef = useRef<RetryCounts>(new Map());
  /** Set while the automatic main retry is re-running steps. */
  const autoRetryBusyRef = useRef(false);
  /** Supervisor re-plans since the last plan_ok review or new plan (the convergence guard's count). */
  const replansRef = useRef(0);
  /** Set when the convergence guard stopped the run: periodic reviews pause until a new plan. */
  const supervisorHaltedRef = useRef(false);
  /** "[Opportunity]" notes already proposed as steps for the current plan (lower-cased). */
  const opportunitiesRef = useRef<Set<string>>(new Set());
  const supervisorRef = useRef(supervisor);
  const busRef = useRef<BusMessage[]>([]);
  /** The crew's API, for callbacks defined before the crew hook runs. */
  const crewApiRef = useRef<ReturnType<typeof useCrew> | null>(null);
  const knownRef = useRef<ForwardedElement[]>([]);
  /** True while link/route subagents hold the screen; Auto Act pauses meanwhile. */
  const subRunningRef = useRef(false);
  const crewRef = useRef<CrewAgent[]>([]);
  const crewRunningRef = useRef(false);
  /** Real input from crew agents goes through one lock: two agents never move the pointer at once. */
  const screenLockRef = useRef(createScreenLock());
  const opsRef = useRef(ops);
  const opsRunningRef = useRef(false);
  /** The Monitor agent's last seen change, last reported change, and the element-map names it last saw. */
  const opsChangeRef = useRef<MonitorChange | null>(null);
  const opsReportedRef = useRef<{ key: string; time: number } | null>(null);
  const opsMapNamesRef = useRef<string[]>([]);
  /** Real-input budget of commands given to single Operations agents, renewed by each /ops run. */
  const opsBudgetRef = useRef<ActionBudget>(createBudget(settings.actionBudget));
  /** The last action the Apply agent dispatched, for the Recheck and Reapply agents. */
  const opsAppliedRef = useRef<Applied | null>(null);
  /** The user's pending live-drag intervention (re-aim or release), taken before the next segment. */
  const dragControlRef = useRef<DragIntervention | null>(null);
  const liveDragRef = useRef(false);
  const elementMapRef = useRef<MappedElement[]>([]);
  /** Recent user and AI inputs, for blaming element moves on whoever caused them. */
  const actorInputsRef = useRef<ActorInput[]>([]);
  /** True while an element training session runs. */
  const trainingRef = useRef(false);
  /** Set by Stop: the running training session ends after its current action. */
  const trainStopRef = useRef(false);
  const [training, setTraining] = useState<TrainingReport | null>(null);
  const mapHydratedRef = useRef(false);
  const changeHitsRef = useRef<ChangeHit[]>([]);
  const identifySentRef = useRef<Array<{ box: Box; time: number }>>([]);
  const identifyBusyRef = useRef(false);
  const watcherRef = useRef(watcher);
  const triggersRef = useRef(triggers);
  const memoryRef = useRef(memory);
  /** The slice goal of the subagent running now; null otherwise (AI turns then belong to the goal). */
  const operationRef = useRef<string | null>(null);
  /** A triggered run is in flight; no other trigger fires until it finishes. */
  const triggerBusyRef = useRef(false);
  /** The frame id element triggers last evaluated, and each watched element's state on it. */
  const triggerFrameRef = useRef<number | null>(null);
  const elementSnapsRef = useRef(new Map<string, ElementSnapshot>());
  const aiBusyRef = useRef(aiBusy);
  aiBusyRef.current = aiBusy;
  /** A watcher observation or test is in flight; ticks never overlap and Auto Act waits for it. */
  const watchBusyRef = useRef(false);
  /** Real-input budget of the watcher's armed tests, renewed each time the watcher is switched on. */
  const watchBudgetRef = useRef<ActionBudget>(createBudget(settings.actionBudget));
  /** The AI initiative's after-run hook (workarounds, workflow packs), set once the initiative layer exists. */
  const afterRunRef = useRef<(goal: string, steps: WorkflowStep[], opts: { dryRun: boolean; stopped: boolean }) => Promise<void>>(async () => undefined);
  /** The frame the next material screen change is measured against. */
  const changeBaseRef = useRef<Frame | null>(null);
  /** The in-flight change assessment; the executor waits for it before proposing. */
  const changeBusyRef = useRef<Promise<void> | null>(null);
  /** The latest change assessment and when it was made. */
  const lastChangeRef = useRef<{ at: number; assessment: ChangeAssessment } | null>(null);
  /** When the current plan was made (planned, loaded or recorded). */
  const planAtRef = useRef(0);
  /** A stale-plan assessment already answered by a re-proposal. */
  const staleHandledRef = useRef<ChangeAssessment | null>(null);
  /** Steps that already used their one re-proposal. */
  const reproposedRef = useRef(new Set<string>());
  /** Portfolios, user-habit profile and knowledge sections; entries are attributed to the operation running now. */
  const kb = useKnowledge({
    source: () => ({ operation: goalRef.current.trim(), opId: planAtRef.current ? `plan_${planAtRef.current}` : null }),
    model: () => settingsRef.current.aiModel,
  });
  const { recordAi, recordFor } = kb;
  /** The goal the current steps were planned for; a plan for another goal supersedes it. */
  const plannedGoalRef = useRef('');
  /** Background variations: superseded goals keep running, inside every guardrail, while the main executor is idle. */
  const variations = useVariations({
    // The main project is the goal its steps were planned or loaded for; the typed goal only while nothing is planned.
    main: () => ({ goal: plannedGoalRef.current || goalRef.current, steps: stepsRef.current }),
    setMain: (nextGoal, nextSteps) => {
      goalRef.current = nextGoal;
      setGoal(nextGoal);
      stepsRef.current = nextSteps;
      setSteps(nextSteps);
      plannedGoalRef.current = nextGoal.trim();
    },
    blocked: () => variationHold(),
    runStep: (step, actor, budget) => performStep(step, actor, budget, !armedRef.current),
    budgetLimit: () => settingsRef.current.actionBudget,
    log: (message, tone) => addLog('Variations', message, tone),
    record: kb.recordWith,
    mergeRecords: kb.reattributeVariation,
    forgetRecords: kb.forgetVariation,
  });
  /**
   * Before the main steps are replaced for `nextGoal`: when it is another goal than the one the
   * current steps belong to, those steps keep running as a background variation.
   */
  const steerPrevious = (nextGoal: string) => {
    if (plannedGoalRef.current.toLowerCase() !== nextGoal.trim().toLowerCase()) variations.supersede(plannedGoalRef.current, stepsRef.current, nextGoal);
    plannedGoalRef.current = nextGoal.trim();
  };
  const agentsListRef = useRef(agents);

  supervisorRef.current = supervisor;
  agentsListRef.current = agents;
  timelineRef.current = timeline;
  syncRef.current = sync;
  progressRef.current = progress;
  settingsRef.current = settings;
  sourceRef.current = source;
  aiStatusRef.current = aiStatus;
  logRef.current = log;
  goalRef.current = goal;
  userNotesRef.current = userNotes;
  stepsRef.current = steps;
  armedRef.current = armed;
  abortedRef.current = aborted;
  replayingRef.current = replaying;
  recordingRef.current = recording;
  cardsRef.current = cards;
  patternsRef.current = patterns;
  habitsRef.current = habits;
  /** Every store cross-referenced into one queryable memory view (Memory panel, briefing, AI context). */
  const enhancedMemory = useMemo(() => buildMemory({ cards, habits, patterns, runs, tests: watcher.tests, dossiers }), [cards, habits, patterns, runs, watcher.tests, dossiers]);
  const enhancedMemoryRef = useRef(enhancedMemory);
  enhancedMemoryRef.current = enhancedMemory;
  familiarRef.current = familiar;
  targetRef.current = target;
  scopeRef.current = scope;

  const intervalMs = relaxInterval(monitorInterval(settings.monitorMode, modeCaptureMs(settings.executionMode, settings.captureMs)), settings.relaxMode);

  // Persistence: settings, log and cards.
  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => aiQueueRef.current.setLimit(settings.aiMaxInFlight), [settings.aiMaxInFlight]);
  useEffect(() => aiQueueRef.current.setTimeoutMs(settings.aiTimeoutMs), [settings.aiTimeoutMs]);
  useEffect(() => saveLog(log), [log]);
  useEffect(() => savePatterns(patterns), [patterns]);
  useEffect(() => saveFamiliar(familiar), [familiar]);
  useEffect(() => saveHabits(habits), [habits]);
  useEffect(() => saveAvoidRules(avoidRules), [avoidRules]);
  useEffect(() => saveRunSummaries(runs), [runs]);
  useEffect(() => void saveGoals(objectives), [objectives]);
  useEffect(() => void saveKnowledge(userNotes), [userNotes]);
  useEffect(() => saveDossiers(dossiers), [dossiers]);
  useEffect(() => saveWatcher(watcher), [watcher]);
  useEffect(() => saveTriggers(triggers), [triggers]);
  useEffect(() => saveOperationMemory(memory), [memory]);
  useEffect(() => saveAccessPaths(accessPaths), [accessPaths]);
  useEffect(() => saveRouteProfiles(routeProfiles), [routeProfiles]);
  useEffect(() => saveFixMethods(fixMethods), [fixMethods]);
  useEffect(() => saveScreenSections(sections), [sections]);
  useEffect(() => saveOpsState(ops), [ops]);
  useEffect(() => {
    if (cardsHydratedRef.current) saveCards(cards);
  }, [cards]);
  useEffect(() => {
    if (mapHydratedRef.current) saveElementMap(elementMap);
  }, [elementMap]);

  // Hydrate saved cards, the element map and the recent frame gallery.
  useEffect(() => {
    let live = true;
    void loadElementMap().then((stored) => {
      if (!live) return;
      mapHydratedRef.current = true;
      elementMapRef.current = [...elementMapRef.current, ...stored.filter((s) => !elementMapRef.current.some((x) => x.id === s.id))];
      setElementMap(elementMapRef.current);
    });
    void loadCards().then((stored) => {
      if (!live) return;
      cardsHydratedRef.current = true;
      setCards((c) => [...c, ...stored.filter((s) => !c.some((x) => x.id === s.id))]);
    });
    const { gallerySize } = settingsRef.current;
    void loadStoredFrames(gallerySize).then(decodeFrames).then((restored) => {
      if (!live || !restored.length) return;
      restored.forEach((f) => restoredIdsRef.current.add(f.id));
      framesRef.current = [...framesRef.current, ...restored].slice(0, gallerySize);
      setFrames(framesRef.current);
    }).catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  /** An operation note taken by an agent, tagged with its source and the current goal (deduplicated, persisted). */
  const takeNote = useCallback((kind: NoteKind, text: string, source: string) => {
    watcherRef.current = { ...watcherRef.current, notes: mergeNotes(watcherRef.current.notes, [{ kind, text, source, ...(goalRef.current.trim() ? { op: goalRef.current.trim() } : {}) }]).notes };
    setWatcher(watcherRef.current);
  }, []);

  /**
   * Every engine event lands here, tagged with its project; an error line is also kept as an 'error' note
   * so errors stay recallable. With the Logging agent on, each entry is tagged with its operation and an
   * entry identical to the newest is folded into it instead of duplicated.
   */
  const addLog = useCallback((from: string, message: string, tone: LogEntry['tone'] = 'info', shots?: string[]) => {
    const project = projectId(goalRef.current);
    const entry: LogEntry = { id: uid('log'), time: Date.now(), source: from, message, tone, ...(shots?.length ? { shots } : {}), ...(project ? { project } : {}) };
    if (tone === 'error') {
      takeNote('error', message, from);
      if (from !== ERRORS_SOURCE) logErrorRef.current(from, message, entry.time);
    }
    if (!settingsRef.current.stages.opsLogging) return setLog((l) => [entry, ...l].slice(0, LOG_LIMIT));
    const tagged = tagLog(entry, operationRef.current ?? goalRef.current);
    setLog((l) => dedupeLog(l, tagged, LOG_LIMIT));
  }, [takeNote]);

  /** The operation an AI turn belongs to: a subagent's slice while one runs, else the goal. */
  const operationNow = () => operationRef.current ?? goalRef.current;

  /**
   * The operation memory sent with every AI turn: goal, current objective, notes, blacklist, similar
   * failures and recent activity (left out when the turn's context already is the recent log).
   */
  const operationMemoryBlock = (contextIsLog: boolean, stage: StageId) => {
    const running = stepsRef.current.find((s) => s.status === 'running');
    const recent = contextIsLog ? [] : scopeAttention(logRef.current.slice(0, RECENT_LINES).map((l) => `[${l.source}] ${l.message}`), stage);
    const targets = stepsRef.current.map((s) => s.target ?? s.name);
    return memoryBlock({ operation: operationNow(), objective: running ? objectiveText(running) : null, recent, targets, blocked: avoidRulesRef.current.filter((r) => isBlocking(r)).map((r) => `${ruleScope(r)} — ${r.reason}`) }, { patterns: patternsRef.current, habits: habitsRef.current, memory: memoryRef.current });
  };

  /** Saves a failed operation as a reminder (with its screenshots) and logs it. */
  const rememberFailure = useCallback((failure: FailureRecord) => {
    memoryRef.current = addFailure(memoryRef.current, failure);
    setMemory(memoryRef.current);
    addLog('Memory', `Saved failure reminder for "${failure.operation}": ${failure.what}`, 'warn', failure.shots);
  }, [addLog]);

  /** Trigger: surfaces the failures of operations like `operation` as it starts; the AI gets them with every turn. */
  const remindFailures = (operation: string, actor: string) => {
    similarFailures(operation, memoryRef.current.failures).slice(0, FAILURE_CONTEXT_LIMIT)
      .forEach((f) => addLog('Memory', `${actor} — a similar operation failed before, adjusting: ${failureLine(f)}`, 'warn', f.shots));
  };

  /** What runs for every new notification: auto-act (assigned below, once the executor exists). */
  const onNotifiedRef = useRef<(n: AssistNotification) => void>(() => undefined);
  const notifier = useNotifications((n) => onNotifiedRef.current(n));
  const { notify } = notifier;

  // Startup recovery: corrupted payloads go to a recovery file; a clean scan becomes the last good export.
  useEffect(() => {
    if (recovery.corrupt.length) {
      try {
        downloadText(recoveryFileName(recovery.time), JSON.stringify(recoveryFile(recovery), null, 2), 'application/json');
      } catch (error) {
        addLog('Recovery', `Recovery file could not be saved: ${errorText(error)}`, 'error');
      }
      addLog('Recovery', recoveryText(recovery), 'warn');
      notify({ source: 'Recovery', category: 'errors', severity: 'critical', title: `Corrupted data recovered: ${recovery.corrupt.map((c) => c.label).join(', ')}` });
    } else {
      snapshotLastGood();
    }
    void pruneCorruptFrames().then((n) => {
      if (!n) return;
      setRecovery((r) => ({ ...r, prunedFrames: n }));
      addLog('Recovery', `${n} corrupt screenshot record(s) removed`, 'warn');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Settings Restore: replaces every store with the last good export (the caller reloads the app). */
  const restoreLastGoodExport = useCallback((): { ok: boolean; message: string } => {
    try {
      const restored = restoreLastGood();
      const r = restored ? { ok: true, message: `Restored the last good export from ${restored.exportedAt}` } : { ok: false, message: 'No last good export to restore from — export a backup first' };
      addLog('Recovery', r.message, r.ok ? 'ok' : 'warn');
      return r;
    } catch (error) {
      addLog('Recovery', `Restore failed: ${errorText(error)}`, 'error');
      return { ok: false, message: `Restore failed: ${errorText(error)}` };
    }
  }, [addLog]);

  /** Every trim or reset of the AI conversation history is logged and shown. */
  historyChangeRef.current = (change) => {
    setAiHistory(aiSessionRef.current.history());
    addLog('AI history', historyChangeText(change), change.reason === 'manual' ? 'info' : 'warn');
  };

  /** Every 100 archived AI messages (the archive itself persists in localStorage across sessions): all data is saved as the last good backup. */
  autoSaveRef.current = (archive) => {
    try {
      snapshotLastGood();
      addLog('AI history', `Auto-saved all data at ${archive.length} archived AI message(s)`, 'ok');
    } catch (error) {
      addLog('AI history', `Auto-save failed at ${archive.length} archived AI message(s): ${errorText(error)}`, 'error');
    }
  };

  /** Keeps only the newest `keep` messages of the AI conversation. */
  const trimAiHistory = useCallback((keep: number) => aiSessionRef.current.trim(keep), []);

  /** Cancels in-flight model calls and clears the AI conversation entirely. */
  const resetAiSession = useCallback(() => {
    aiCtrlRef.current.abort();
    aiCtrlRef.current = new AbortController();
    aiSessionRef.current.reset();
  }, []);

  /** Error forwarding: reports carry the recent log and the current frame. */
  const errorForwarding = useErrorForwarding(settings, addLog, () => ({ log: logRef.current, frame: framesRef.current[0] ?? null }), (what, ok) =>
    notify({ source: 'Error forwarding', category: 'errors', severity: ok ? 'info' : 'warning', title: `${what} ${ok ? 'delivered' : 'not delivered'}` }));
  /** The approval system: the dispatch gate, the point filter, the queue and its run-check. */
  const approvals = useApprovals(settings, () => patternsRef.current, addLog);
  /** The operation database: every element, track, capture, error and idea operation with its input and output. */
  const operationDb = useOperationDatabase();
  const recordRaw = operationDb.record;
  /** Records an operation by `agent` in `section`, scoped to the loaded flow (else the goal). */
  const recordOp = useCallback((agent: string, section: string, draft: OperationDraft) => {
    const flow = cardsRef.current.find((c) => c.id === flowRef.current)?.name;
    recordRaw({ project: projectOf(flow, goalRef.current), agent, section }, draft);
  }, [recordRaw]);
  /** The joint engine over the main app bridge: cross-app error diagnosis, app selection, follow-up and memory. */
  const joint = useJoint({
    addLog,
    bridge: () => mainBridgeRef.current,
    queue: approvals.queue,
    fixScript: (ctx) => void proposeFix(ctx),
    record: (draft) => recordOp(JOINT_SOURCE, 'mainBridge', draft),
    history: loadOperations,
    target: () => (sourceRef.current === 'main-app' ? 'droid-main' : 'droid-new'),
    busy: () => executorBusy(),
    local: (role, text) => jointLocal(role, text),
    localFrame: () => framesRef.current[0] ?? null,
    lines: (app) => logRef.current.filter((l) => (l.source === 'Main app') === (app === 'droid-main')).slice(0, CROSS_REFERENCE_LINES).map((l) => `${l.source}: ${l.message}`),
    verify: async (action, frame) => {
      const check = await verifyGoal(askFor('autoContinue'), frame, action.expect, []);
      return { ok: check.complete, reason: check.reason };
    },
    pending: (g) => approvals.items.filter((i) => i.status === 'pending' && i.goal === g).length,
    halt: () => (abortedRef.current ? ABORTED_REFUSAL : aiOnline() ? null : 'AI offline — joint follow-up cannot verify'),
  });
  const forwardError = errorForwarding.capture;
  /** When the last explicit capture was made; an error log line close to it is the same failure. */
  const explicitCaptureAt = useRef(0);
  /** Lists (and forwards when configured) an error and records it in the operation database. */
  const recordError = useCallback((input: CaptureInput) => {
    forwardError(input);
    recordOp('Errors', errorSection(input.kind), errorDraft(input));
  }, [forwardError, recordOp]);
  /** Captures an error for forwarding, records it in the operation database and diagnoses it for a correction. */
  const captureError = useCallback((input: CaptureInput & { file?: string }) => {
    explicitCaptureAt.current = Date.now();
    recordError(input);
    joint.onError({ ...input, app: errorApp(input.kind) });
  }, [recordError, joint]);
  /** Every error-tone log line lands in the Errors list, unless an explicit capture of it was made alongside. */
  logErrorRef.current = (from, message, time) => queueMicrotask(() => {
    if (Math.abs(explicitCaptureAt.current - time) < LOG_CAPTURE_WINDOW_MS) return;
    recordError({ kind: logErrorKind(from), message: `[${from}] ${message}`, goal: goalRef.current });
  });

  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  /** The element map the ruler and the measure action resolve names against. */
  const measureMap = useCallback(() => buildElementMap(annotationsRef.current, stepsRef.current, cardsRef.current), []);

  /** Recalibration drift: workflow steps and saved flows move into the live layout. */
  const rescaleStored = useCallback((cal: Calibration) => {
    stepsRef.current = stepsRef.current.map((s) => remapStep(cal, s));
    setSteps(stepsRef.current);
    cardsRef.current = cardsRef.current.map((c) => ({ ...c, steps: c.steps.map((s) => remapStep(cal, s)) }));
    setCards(cardsRef.current);
  }, []);

  const needBaseline = useCallback((title: string) => {
    notify({ source: 'Calibration', category: 'errors', severity: 'warning', title });
  }, [notify]);
  const ruler = useMeasure({ frames, framesRef, elementMap: measureMap, addLog, rescale: rescaleStored, onNeedBaseline: needBaseline });
  /** Recent measurement lines (newest last) the planner reads as context. */
  const measuredRef = useRef<string[]>([]);
  /** Measures via the ruler (logged by it) and keeps the result line for planning context; throws loudly. */
  const measureFor = useCallback((text: string, by: string): string => {
    const line = ruler.measureQuery(text, by);
    measuredRef.current = [...measuredRef.current, `Measured (${by}): ${line}`].slice(-MEASURED_CONTEXT);
    return line;
  }, [ruler.measureQuery]);

  const aiCheckSeqRef = useRef(0);
  /** Pings `url`+`model` with the health check and shows the result; a result overtaken by a newer check is dropped. */
  const checkAi = useCallback(async (url: string, model: string, think: boolean): Promise<AiStatus> => {
    const seq = ++aiCheckSeqRef.current;
    setAiStatus({ state: 'checking', detail: `Connecting to ${url}…` });
    const status = await pingAi({ url, model, think });
    if (seq !== aiCheckSeqRef.current) return status;
    setAiStatus(status);
    addLog('AI', status.detail, status.state === 'online' ? 'ok' : 'error');
    if (status.state !== 'online') captureError({ kind: 'ai', message: status.detail });
    return status;
  }, [addLog, captureError]);

  // AI endpoint health: at startup and whenever the endpoint or model changes.
  useEffect(() => {
    void checkAi(settings.aiUrl, settings.aiModel, settings.aiThink);
    return () => {
      aiCheckSeqRef.current++;
    };
  }, [settings.aiUrl, settings.aiModel, settings.aiThink, checkAi]);

  /** One-click Connect: saves the settings as they stand and pings their endpoint+model. */
  const connectAi = useCallback(() => {
    const s = settingsRef.current;
    saveSettings(s);
    return checkAi(s.aiUrl, s.aiModel, s.aiThink);
  }, [checkAi]);

  /** Marks user notes as received by `project`'s AI call and logs the injection. */
  const injectNotes = useCallback((notes: UserNote[], project: string) => {
    const ids = notes.map((n) => n.id);
    userNotesRef.current = markInjected(userNotesRef.current, ids, project);
    setUserNotes(userNotesRef.current);
    addLog('Knowledge', `Injected ${notes.length} user note(s) into ${project ? `"${project}"` : 'the next AI call'}`, 'info');
  }, [addLog]);

  /** Adds a user note to the knowledge store for `project` (ALL_PROJECTS for every running project). */
  const addNote = useCallback((text: string, project: string) => {
    if (!text.trim()) return;
    userNotesRef.current = addUserNote(userNotesRef.current, text, project);
    setUserNotes(userNotesRef.current);
    const target = userNotesRef.current[0].project;
    addLog('Dashboard', `Note for ${target === ALL_PROJECTS ? 'all projects' : `"${target}"`}: ${text.trim()}`, 'info');
  }, [addLog]);

  /** Queues a next goal on the goal tracer. */
  const queueNextGoal = useCallback((text: string) => setObjectives((g) => queueGoal(g, text)), []);
  /** Drops a goal record from the goal tracer. */
  const removeGoal = useCallback((id: string) => setObjectives((g) => dropGoal(g, id)), []);
  /** Marks a frame as a preferred key frame on behalf of `by`. */
  const preferFrame = useCallback((frame: Frame, by: string, reason: string) => setPreferredShots((p) => markPreferred(p, frame, by, reason)), []);

  // AI status changes are notifications: going offline, and coming back online after being offline.
  const aiWasRef = useRef<AiStatus['state']>('checking');
  useEffect(() => {
    const was = aiWasRef.current;
    if (aiStatus.state === 'checking' || aiStatus.state === was) return;
    aiWasRef.current = aiStatus.state;
    if (aiStatus.state === 'offline') notify({ source: 'AI', category: 'ai', severity: 'warning', title: `AI went offline — ${aiStatus.detail}` });
    else if (was === 'offline') notify({ source: 'AI', category: 'ai', severity: 'info', title: `AI back online — ${aiStatus.detail}` });
  }, [aiStatus, notify]);

  /** Whether a loop-control stage is checked; read live so a toggle applies mid-run. */
  const stageOn = (id: StageId) => settingsRef.current.stages[id];

  /** The Goal tracer agent's checkbox, read live (the agents list is declared with the state above). */
  const tracerAgentOn = () => agentsListRef.current.some((a) => a.id === 'goalTracer' && a.on);
  /** The live Goal tracer: on while both its loop-control stage and its agent are checked. */
  const { goals, tracer } = useGoalTracer({
    enabled: () => stageOn('goalTracer') && tracerAgentOn(),
    stallLimit: () => settingsRef.current.goalStall,
    notify: (message, tone) => addLog('Goal tracer', message, tone),
  });
  /** Where a run's goal came from: the typed goal is the user's, anything the engine derived is the AI's. */
  const goalSource = (text: string): GoalSource => (text.trim() && text.trim() === goalRef.current.trim() ? 'user' : 'ai');
  /** Starts tracing a run that has no active goal (a recorded or edited plan). */
  const traceRun = (runGoal: string) => tracer.ensure({ goal: runGoal, source: goalSource(runGoal), steps: stepsRef.current, workflowId: flowRef.current });

  /** The drift thresholds and search radius from Settings; read live so a change applies mid-run. */
  const driftThresholds = (): DriftThresholds => {
    const { driftStable, driftMatched, driftRadius } = settingsRef.current;
    return { stable: driftStable, matched: driftMatched, radius: driftRadius };
  };
  /** The step's template matched on `live` at its recorded point with the Settings radius, and its sync level. */
  const driftCheck = (step: WorkflowStep, live: Frame) => {
    const t = driftThresholds();
    const r = matchTemplate(step.refFrame!.data, live.data, step.x, step.y, { radius: t.radius });
    return { r, level: syncLevelFor(r, t) };
  };

  /**
   * Every escalation stage failed: the thinking is the response (labelled thinking-only on the
   * timeline), the log says plainly that content was never produced, and a workflow proposal derived
   * from the thinking and the goal is added to the Screen watcher for the user to accept (queue as the goal) or dismiss.
   */
  const thinkingOnlyOutput = useCallback((thinking: string, stage: StageId) => {
    const text = escalationNotice(thinking);
    setTimeline((t) => addEntry(t, { step: `AI (${stage}) · thinking only`, kind: 'thought', text, thinking }));
    addLog('AI', `Content was never produced for this ${stage} call — the model's thinking is shown as the response.`, 'warn');
    captureError({ kind: 'ai', message: `AI returned empty content for this ${stage} call — content was never produced, only thinking`, goal: goalRef.current });
    const goal = suggestedGoal(thinking, goalRef.current);
    const { proposals, added } = mergeProposals(watcherRef.current.proposals, [{ kind: 'workflow', text: `Suggested next workflow from the AI's thinking: ${goal}`, target: goal }]);
    watcherRef.current = { ...watcherRef.current, proposals };
    setWatcher(watcherRef.current);
    if (added.length) addLog('Screen watcher', `Proposed workflow from thinking-only reply: ${goal} — Accept to queue it as the goal`, 'info');
  }, [addLog, captureError]);

  /**
   * Repeat-limit 500 backoff: the rephrased retry inside chat() failed too, so calls are held for
   * 15s, 30s, 60s, 120s then 300s, the badge says so, the failure is counted in the log, and the
   * endpoint is re-pinged when the wait ends. A good reply ends it.
   */
  const aiBackoffRef = useRef<AiBackoff>(NO_BACKOFF);
  const aiBackoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startBackoff = useCallback(() => {
    const now = Date.now();
    const b = noteRepeatLimit(aiBackoffRef.current, now);
    aiBackoffRef.current = b;
    setAiStatus(backoffStatus(b, now));
    addLog('AI', repeatLimitLine(b, now), 'warn');
    captureError({ kind: 'ai', message: `AI repeat-limit 500 #${b.total} — ${backoffText(b, now)}`, goal: goalRef.current });
    if (aiBackoffTimerRef.current) clearTimeout(aiBackoffTimerRef.current);
    aiBackoffTimerRef.current = setTimeout(() => {
      aiBackoffTimerRef.current = null;
      const { aiUrl, aiModel, aiThink } = settingsRef.current;
      void checkAi(aiUrl, aiModel, aiThink);
    }, b.until - now);
  }, [addLog, captureError, checkAi]);
  const endBackoff = useCallback(() => {
    if (!aiBackoffRef.current.streak) return;
    addLog('AI', `Endpoint answering again after ${aiBackoffRef.current.streak} repeat-limit 500(s) in a row — backoff ended (${aiBackoffRef.current.total} repeat-limit 500(s) this session)`, 'ok');
    aiBackoffRef.current = clearBackoff(aiBackoffRef.current);
    if (aiBackoffTimerRef.current) clearTimeout(aiBackoffTimerRef.current);
    aiBackoffTimerRef.current = null;
  }, [addLog]);
  useEffect(() => () => {
    if (aiBackoffTimerRef.current) clearTimeout(aiBackoffTimerRef.current);
  }, []);

  /** One model call of `stage` through the shared queue, with the current settings (master prompt included). */
  const queuedAsk = useCallback((req: AskRequest, stage: StageId, signal: AbortSignal): Promise<AiReply> => aiQueueRef.current.run(stage, (timeoutMs) => {
    const { aiUrl, aiModel, aiView, masterPrompt, aiThink, aiHistoryWindow } = settingsRef.current;
    return aiSessionRef.current.ask({ url: aiUrl, model: aiModel, view: AI_VIEWS[aiView], timeoutMs, masterPrompt, think: aiThink, historyWindow: aiHistoryWindow }, { ...req, signal });
  }, signal), []);

  /**
   * Every model call, made on behalf of a loop-control `stage`: with session history and the recent
   * log, cancellable through aiCtrlRef (abort) and the stage's own controller (unchecking it).
   * With overlap mode on, a second, freshly worded call races it through the same queue (so the
   * in-flight cap holds); the first valid answer wins and the other is cancelled. A thinking-only
   * reply is shown on the timeline and the log as the answer, with what happened and a next step.
   * An unchecked stage is refused as a cancel. A failure marks the AI offline and is rethrown; a cancel is rethrown as is.
   */
  const askAi = useCallback(async (req: AskRequest, stage: StageId): Promise<AiReply> => {
    if (!settingsRef.current.stages[stage]) throw new AiCancelled(stageOff(stage));
    if (aiBackoffRef.current.until > Date.now()) throw new AiError(`AI call held — ${backoffText(aiBackoffRef.current, Date.now())}`);
    const memory = operationMemoryBlock(req.context === undefined, stage);
    const project = projectId(goalRef.current);
    const injected = pendingNotesFor(userNotesRef.current, project);
    const recent = req.context ?? logRef.current.slice(0, 8).map((l) => `[${l.source}] ${l.message}`);
    const findings = scopeAttention([...reportContext(agentReportsRef.current), ...recent], stage);
    const context = [...injected.map(noteLine), ...memoryLines(enhancedMemoryRef.current, currentOperation()), ...findings];
    const signal = linkSignals(aiCtrlRef.current.signal, stageCtrlsRef.current.signal(stage), req.signal);
    const ctxReq = { ...req, context, memory };
    setAiCalls((n) => n + 1);
    try {
      const reply = settingsRef.current.aiOverlap
        ? await firstValid([
          (s) => queuedAsk(ctxReq, stage, linkSignals(signal, s)),
          (s) => queuedAsk({ ...ctxReq, prompt: `${OVERLAP_PREFIX}${req.prompt}` }, stage, linkSignals(signal, s)),
        ])
        : await queuedAsk(ctxReq, stage, signal);
      setAiHistory(aiSessionRef.current.history());
      endBackoff();
      if (injected.length) injectNotes(injected, project);
      const { aiModel } = settingsRef.current;
      if (aiStatusRef.current.state !== 'online') setAiStatus({ state: 'online', detail: `Connected · ${aiModel}` });
      if (reply.answeredBy === 'thinking-only') thinkingOnlyOutput(reply.content, stage);
      else if (reply.thinkingOnly) {
        const text = thinkingOnlyNotice(reply.content);
        setTimeline((t) => addEntry(t, { step: `AI (${stage})`, kind: 'thought', text, thinking: reply.thinking }));
        addLog('AI', text, 'warn');
        captureError({ kind: 'ai', message: `AI returned empty content for this ${stage} call — ${text}`, goal: goalRef.current });
      }
      return reply;
    } catch (error) {
      if (isRepeatLimit(error)) startBackoff();
      else if (!(error instanceof AiCancelled)) {
        setAiStatus({ state: 'offline', detail: `AI unavailable — ${errorText(error)}` });
        captureError({ kind: 'ai', message: `AI unavailable — ${errorText(error)}`, goal: goalRef.current });
      }
      throw error;
    } finally {
      setAiCalls((n) => n - 1);
    }
  }, [addLog, captureError, queuedAsk, injectNotes, thinkingOnlyOutput, startBackoff, endBackoff]);

  /** The AskFn of one loop-control stage. */
  const askFor = useCallback((stage: StageId): AskFn => (req) => askAi(req, stage), [askAi]);

  /** Cancels the in-flight model calls at once; later calls get a fresh controller. */
  const cancelAi = useCallback(() => {
    aiCtrlRef.current.abort();
    aiCtrlRef.current = new AbortController();
    aiSessionRef.current.cancel();
  }, []);

  const aiOnline = () => aiStatusRef.current.state === 'online';

  const note = useCallback((entry: Omit<ThinkingEntry, 'id' | 'time'>) => {
    const project = projectId(goalRef.current);
    setTimeline((t) => addEntry(t, project ? { ...entry, project } : entry));
  }, []);

  /**
   * A reply that held no JSON is logged as an AI parse failure with its truncated raw text — never shown as an answer —
   * and counts toward the session's stale-context guard.
   */
  const reportParseFailure = useCallback((step: string, error: unknown) => {
    if (!(error instanceof AiParseError)) return;
    addLog('AI parse', `Unparseable reply for "${step}" (raw, truncated): ${error.raw}`, 'error');
    aiSessionRef.current.noteParse(false);
  }, [addLog]);

  /**
   * Runs one AI decision and records its initial thinking on the timeline, or the failure
   * when the call fails (rethrown). `summary` returning null means no model call was made.
   */
  const thought = useCallback(async <T extends Thought>(step: string, call: () => Promise<T>, summary: (r: T) => string | null, kind: ThoughtKind = 'thought'): Promise<T> => {
    setAttention((a) => focusOn(a, step, 'AI'));
    try {
      const r = await call();
      const text = summary(r);
      if (text !== null) {
        note({ step, kind, text, thinking: r.thinking });
        aiSessionRef.current.noteParse(true);
      }
      return r;
    } catch (error) {
      note({ step, kind, text: '', thinking: null, error: errorText(error) });
      reportParseFailure(step, error);
      throw error;
    }
  }, [note, reportParseFailure]);

  /**
   * Reflect-after-step: the model's reflection and final verdict on an executed step go on the
   * timeline and the verdict into the activity log. A failure is logged as such — never invented.
   * Resolves the verdict, or null when the reflection failed.
   */
  const reflectAfter = useCallback(async (step: WorkflowStep, frame: Frame | null, result: StepResult, logSource: string): Promise<StepVerdict | null> => {
    if (!settingsRef.current.stages.reflect) return null;
    try {
      const reflection = await reflectOn(askFor('reflect'), frame, step, result, goalRef.current);
      note({ step: step.name, kind: 'reflection', text: reflection.text, thinking: reflection.thinking });
      if (!settingsRef.current.stages.verdict) return null;
      const verdict = await judgeStep(askFor('verdict'), frame, step, result, goalRef.current, reflection.raw);
      const text = verdictText(verdict);
      note({ step: step.name, kind: 'verdict', text, thinking: verdict.thinking });
      addLog(logSource, `Verdict on "${step.name}": ${text}`, verdict.success ? 'ok' : 'warn');
      recordAi('result', `Verdict on "${step.name}": ${text}`, verdict.success);
      return verdict;
    } catch (error) {
      note({ step: step.name, kind: 'verdict', text: '', thinking: null, error: errorText(error) });
      reportParseFailure(step.name, error);
      addLog(logSource, aiFailure(`No verdict for "${step.name}" — AI reflection failed`, error), 'error');
      return null;
    }
  }, [addLog, askFor, note, reportParseFailure, recordAi]);

  /** Replaces the habits (persisted by the effect above). */
  const commitHabits = useCallback((next: Habit[]) => {
    habitsRef.current = next;
    setHabits(next);
  }, []);

  /** The app/window the habits of this moment belong to. */
  const habitContext = () => targetRef.current ?? '';
  const habitTarget = (step: WorkflowStep) => step.target ?? step.name;

  /** A step's reflect verdict updates its habit: attempt, success and the verdict's lessons. */
  const learnHabit = (step: WorkflowStep, verdict: StepVerdict) => {
    if (!stageOn('coords') || isGridLabel(habitTarget(step))) return;
    commitHabits(recordOutcome(habitsRef.current, { target: habitTarget(step), context: habitContext(), success: verdict.success, avoid: verdict.pattern_avoid, add: verdict.pattern_add }));
    const lessons = [verdict.pattern_avoid && `avoid ${verdict.pattern_avoid}`, verdict.pattern_add && `add ${verdict.pattern_add}`].filter(Boolean);
    if (lessons.length) kb.recordFor('coords', 'method', `"${habitTarget(step)}": ${lessons.join('; ')}`);
  };

  /** A verified target point strengthens its habit's remembered coordinates. */
  const strengthen = (live: Frame, step: WorkflowStep, p: { x: number; y: number }) => {
    if (!stageOn('coords') || isGridLabel(habitTarget(step))) return;
    commitHabits(strengthenHabit(habitsRef.current, habitTarget(step), habitContext(), live.data, p));
  };

  /** A reliable habit's remembered position of the step's target, found on `live` by template match. */
  const habitSeed = (live: Frame, step: WorkflowStep) => {
    if (!stageOn('coords')) return null;
    const habit = anchoredHabit(habitsRef.current, habitTarget(step), habitContext());
    return habit?.anchor ? seedFromAnchor(habit.anchor, live.data) : null;
  };

  const deleteHabit = (id: string) => commitHabits(habitsRef.current.filter((h) => h.id !== id));
  const pinHabit = (id: string) => commitHabits(togglePin(habitsRef.current, id));

  /** Replaces the access-path profiles (persisted by the effect above). */
  const commitAccessPaths = useCallback((next: AccessProfile[]) => {
    accessPathsRef.current = next;
    setAccessPaths(next);
  }, []);
  /** A hand edit of a profile's path (one hop per line); false when the text is not a valid path. */
  const editAccessPath = (id: string, text: string) => {
    const hops = parseHops(text);
    if (hops) commitAccessPaths(editPath(accessPathsRef.current, id, hops));
    return hops !== null;
  };
  const deleteAccessPath = (id: string) => commitAccessPaths(deletePath(accessPathsRef.current, id));
  /** A real path run counts toward the profile (a repaired path becomes its new version) and feeds the target's habit. */
  const countPath = (profile: AccessProfile, reach: Reach<Performed>) => {
    commitAccessPaths(applyReach(accessPathsRef.current, profile, reach));
    if (stageOn('coords')) commitHabits(recordOutcome(habitsRef.current, pathOutcome(profile, reach.via === 'path' && reach.out.ok, reach.failedHop)));
  };

  /** Replaces the sections (ref and state together). */
  const commitSections = (next: ScreenSection[]) => {
    sectionsRef.current = next;
    setSections(next);
  };

  /** Appends a log or change event to the sections it concerns (every section when it has no box). */
  const sectionEvent = (event: SectionEvent) => {
    if (sectionsRef.current.length) commitSections(recordEvent(sectionsRef.current, event));
  };

  /**
   * The planning/grounding context under goal seclusion: the goal scope, the mapped elements inside it
   * and the cross-referenced section memory (profiles, logs, shared patterns).
   */
  const sectionContext = (): string[] => {
    const secs = sectionsRef.current;
    const mapped = scopedMapped(secs, scopeRef.current, elementMapRef.current);
    const profiles = buildProfiles(secs, mapped, familiarRef.current, framesRef.current[0]);
    return [...scopeLines(secs, scopeRef.current), ...mapContext(mapped), ...sectionMemoryLines(profiles)];
  };
  /** True when a point lies inside the goal scope (always true with no scope). */
  const pointInScope = (p: { x: number; y: number }) => inScope(sectionsRef.current, scopeRef.current, p);
  /** The known elements inside the goal scope, as planner context lines. */
  const knownInScope = () => knownRef.current.filter(pointInScope).map(elementLine);

  /**
   * The AI grounding pass run-step uses: confirm on a zoomed crop, re-ask the planner once.
   * Each check and the re-ask record their thinking on the step's timeline.
   */
  const grounding: Grounding = {
    confirm: async (live, step, p) => {
      if (!pointInScope(p)) return { visible: false, reason: `${at(p.x, p.y)} is outside the goal scope (${scopeRef.current.join(', ')})`, thinking: null };
      const crop = await zoomFrame(live, p);
      const check = await thought(step.name, () => confirmTarget(askFor('grounding'), live, crop, step), checkSummary(step, p));
      if (check.visible) forwardElement('drift', { name: step.target ?? step.name, x: p.x, y: p.y });
      return check;
    },
    relocate: async (live, step, feedback) => {
      const { point } = await thought(step.name, async () => {
        const crop = await zoomFrame(live, step).catch(() => undefined);
        const next = await relocateTarget(askFor('grounding'), live, step, feedback, [...sectionContext(), ...inventoryLines(inventoryRef.current)], crop);
        return { point: next && pointInScope(next) ? next : null, thinking: next?.thinking ?? null };
      }, (r) => (r.point ? `Re-planned "${step.target ?? step.name}" at ${at(r.point.x, r.point.y)}` : `Re-planned: "${step.target ?? step.name}" is not visible`));
      return point;
    },
  };

  /** Adds learned patterns (newest first, deduplicated) to the persisted store. */
  const addPatterns = useCallback((added: LearnedPattern[]) => {
    patternsRef.current = mergePatterns(patternsRef.current, added);
    setPatterns(patternsRef.current);
  }, []);

  const deletePattern = (id: string) => {
    patternsRef.current = patternsRef.current.filter((p) => p.id !== id);
    setPatterns(patternsRef.current);
  };

  const commitAvoidRules = (next: AvoidRule[]) => {
    avoidRulesRef.current = next;
    setAvoidRules(next);
  };

  /** One fresh on-screen failure of `step` struck on its structured blacklist rule (a dismissal only ever gets a cooldown). */
  const strikeAvoid = (step: WorkflowStep, message: string, source: 'habit' | 'test') => {
    commitAvoidRules(recordFailure(avoidRulesRef.current, { step, message, source, ttl: ttlMs(settingsRef.current.avoidTtlHours), obstacle: popupRef.current ?? undefined }));
  };

  /** Clears one blacklist rule by id, or every rule for 'all'; the result says what was cleared. */
  const clearBlacklist = (id = 'all') => {
    const rules = avoidRulesRef.current;
    const gone = id === 'all' ? rules : rules.filter((r) => r.id === id);
    if (!gone.length) return id === 'all' ? 'blacklist already empty' : `no blacklist entry "${id}"`;
    commitAvoidRules(withoutRules(rules, gone));
    const what = id === 'all' ? `all ${gone.length} blacklist entr${gone.length === 1 ? 'y' : 'ies'}` : `blacklist entry ${ruleScope(gone[0])}`;
    addLog('Blacklist', `Cleared ${what}`, 'ok');
    return `cleared ${what}`;
  };

  /**
   * Deadlock resolution before `step` is gated: with a popup/overlay detected, the blocking
   * dismissal rules for it are expired so the dismissal is re-attempted with fresh grounding.
   */
  const breakDeadlock = (step: WorkflowStep, actor: string) => {
    const stuck = deadlockRules(avoidRulesRef.current, step, !!popupRef.current, Date.now(), popupRef.current ?? undefined);
    if (!stuck.length) return;
    commitAvoidRules(withoutRules(avoidRulesRef.current, stuck));
    addLog(actor, `Deadlock cleared — a popup/overlay blocks the screen and its dismissal was blacklisted; expired ${stuck.map(ruleScope).join(', ')} — "${step.name}" re-attempts with fresh grounding`, 'warn');
  };

  /** Stores `card` in the Library through upsertCard: a near-duplicate of the same flow is replaced in place. */
  const commitCard = useCallback((card: SavedCard) => {
    const { cards: next, replaced } = upsertCard(cardsRef.current, card);
    cardsRef.current = next;
    setCards(next);
    return { saved: next[0], replaced };
  }, []);

  /** Saves a successful run as a card, replacing a near-duplicate of the same flow. */
  const autoSaveFlow = useCallback((runGoal: string, runSteps: WorkflowStep[]) => {
    const { saved, replaced } = commitCard(flowCard(runGoal, runSteps));
    flowRef.current = saved.id;
    addLog('Library', `Flow saved: "${saved.name}" (${runSteps.length} step(s), drift-corrected)${replaced ? ` — updated the existing "${replaced.name}"` : ''}`, 'ok');
  }, [addLog, commitCard]);

  /** Appends the finished run's summary (goal, steps, duration, outcome, flow) to the persisted run records. */
  const recordRun = useCallback((runGoal: string, runSteps: WorkflowStep[], opts: { dryRun: boolean; stopped: boolean }) => {
    const startedAt = runStartRef.current ?? Date.now();
    runStartRef.current = null;
    const summary = runSummary({ goal: runGoal, steps: runSteps, startedAt, ...opts, session: sessionRef.current, flowId: flowRef.current });
    setRuns((r) => appendSummary(r, summary));
    tracer.emit({ kind: 'run', runId: summary.id, outcome: summary.outcome, flowId: flowRef.current });
    if (summary.outcome === 'success') notify({ source: 'Goals', category: 'goal', severity: 'info', title: `Goal completed: ${runGoal || '(no goal)'}` });
    if (summary.outcome === 'failed') notify({ source: 'Goals', category: 'goal', severity: 'warning', title: `Goal failed: ${runGoal || '(no goal)'}` });
  }, [tracer, notify]);

  /**
   * Run memory: a successful real run is saved as a flow; a failed one records its failure
   * pattern instead. Either way the model is asked for lessons; its failure never blocks saving.
   * Every finished run, remembered or not, leaves a run summary.
   */
  const learnFromRun = useCallback(async (runSteps: WorkflowStep[], opts: { dryRun: boolean; stopped: boolean }) => {
    const verdict = runVerdict(runSteps, opts);
    const runGoal = goalRef.current.trim();
    if (verdict === 'success' && stageOn('workflowCreation')) autoSaveFlow(runGoal, runSteps);
    if (verdict === 'success' && stageOn('coords')) commitAccessPaths(learnPaths(accessPathsRef.current, runSteps, habitContext(), Date.now(), [...pathCountedRef.current]));
    pathCountedRef.current.clear();
    recordRun(runGoal, runSteps, opts);
    await afterRunRef.current(runGoal, runSteps, opts);
    if (verdict === 'ignored' || !stageOn('supervisor')) return;
    if (verdict === 'failed') {
      const lesson = failurePattern(runGoal, runSteps);
      addPatterns([lesson]);
      addLog('Patterns', `Run failed — not saved as a flow. Learned: avoid ${lesson.pattern}`, 'warn');
      rememberFailure(failureFromRun(runGoal, 'Replay', runSteps, framesRef.current[0] ?? null));
    }
    try {
      const learned = await learnPatterns(askFor('supervisor'), runGoal, runSteps, verdict);
      if (learned.length) addPatterns(learned);
      for (const p of learned) recordFor('supervisor', 'method', `${p.kind} ${p.pattern}`);
      addLog('Patterns', learned.length ? `AI learned ${learned.length} pattern(s): ${learned.map((p) => `${p.kind} "${p.pattern}"`).join('; ')}` : 'AI found no new pattern in this run', 'info');
    } catch (error) {
      addLog('Patterns', `AI unavailable — no patterns learned from this run: ${errorText(error)}`, 'warn');
    }
  }, [addLog, addPatterns, askFor, autoSaveFlow, recordRun, rememberFailure, commitAccessPaths]);

  const triggerAbort = useCallback((reason: string) => {
    abortRef.current = true;
    abortedRef.current = true;
    cancelAi();
    setAborted(true);
    setAbortedAt(Date.now());
    setSettings((s) => ({ ...s, autoAct: false }));
    notify({ source: 'Safety', category: 'abort', severity: 'critical', title: `Automation aborted (${reason})` });
    mirrorOnRef.current = false;
    setMirrorOn(false);
    addLog('Safety', `ABORTED (${reason}) — Auto Act, replay, auto-continue, mirror input, AI play, monitor automation and in-flight AI calls halted; ${ABORT_HINT} to resume`, 'error');
  }, [addLog, cancelAi, notify]);

  const clearAbort = useCallback((how = 'by the user') => {
    abortedRef.current = false;
    setAborted(false);
    setAbortedAt(null);
    addLog('Safety', `Abort cleared ${how} — automation may run again`, 'warn');
  }, [addLog]);
  useAbortAutoClear(aborted, settings.abortAutoClearMin, clearAbort);

  const toggleArmed = () => {
    const next = !armedRef.current;
    armedRef.current = next;
    setArmed(next);
    addLog('Safety', next ? 'Real input ARMED — runs will dispatch to the PC' : 'Real input DISARMED — runs execute as dry runs', next ? 'warn' : 'ok');
  };

  // Emergency-stop hotkey, captured at window level so it fires even inside inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matchesHotkey(e, settings.abortHotkey)) return;
      e.preventDefault();
      triggerAbort(`hotkey ${settings.abortHotkey}`);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [settings.abortHotkey, triggerAbort]);

  // Each switch-on of Auto Act starts a new run with a fresh budget.
  useEffect(() => {
    if (settings.autoAct) autoBudgetRef.current = createBudget(settingsRef.current.actionBudget);
  }, [settings.autoAct]);

  /**
   * Checked before every real dispatch: refuses (and halts the run) when aborted, when real
   * input was disarmed mid-run, or when the run's action budget is spent.
   */
  const gateRealInput = useCallback((budget: ActionBudget): string | null => {
    if (abortedRef.current) return `Aborted — real input not sent; ${ABORT_HINT}`;
    if (!armedRef.current) return 'Real input disarmed — not sent';
    if (spendAction(budget)) return null;
    addLog('Safety', `Action budget reached: ${budget.limit} real input action(s) this run — stopping`, 'error');
    notify({ source: 'Safety', category: 'budget', severity: 'warning', title: `Action budget of ${budget.limit} reached — run stopped` });
    return `Action budget of ${budget.limit} exceeded — not sent`;
  }, [addLog, notify]);

  /**
   * Loop control: checks or unchecks one stage. Unchecking cancels that stage's in-flight model
   * calls at once. Every toggle is logged with its time. Guardrails are not stages and stay on.
   */
  const toggleStage = (id: StageId, on: boolean) => {
    settingsRef.current = { ...settingsRef.current, stages: { ...settingsRef.current.stages, [id]: on } };
    setSettings((s) => ({ ...s, stages: { ...s.stages, [id]: on } }));
    if (!on) {
      aiQueueRef.current.drain(id);
      stageCtrlsRef.current.cancel(id);
    }
    addLog('Loop control', toggleMessage(id, on), on ? 'ok' : 'warn');
    if (settingsRef.current.stages.opsLoopControl) addLog('Loop-control agent', loopReport(settingsRef.current.stages, runningStages()).text, 'info');
  };

  /** Replaces the position dossiers. */
  const commitDossiers = (next: PositionDossier[]) => {
    dossiersRef.current = next;
    setDossiers(next);
  };

  /** Coordinate learner: records one observation in the familiar memory and the target's dossier, and logs a target that moved. */
  const learnCoords = (obs: CoordObservation, by: Mover = 'user') => {
    commitDossiers(recordSighting(dossiersRef.current, { name: obs.name, x: obs.x, y: obs.y, time: obs.time, by }));
    const { list, moved } = learnCoordinate(familiarRef.current, obs);
    familiarRef.current = list;
    setFamiliar((latest) => learnCoordinate(latest, obs).list);
    if (moved) addLog('Coordinate learner', `"${moved.name}" moved (${pct(moved.from.x)}, ${pct(moved.from.y)}) → (${pct(moved.to.x)}, ${pct(moved.to.y)}) — coordinates updated`, 'info');
  };

  /**
   * Switches the execution mode (user from the HUD, or the AI contextually) and logs who changed it,
   * from what, to what and why. Re-selecting the current mode logs nothing. Never touches arming,
   * the budget or the auto-apply bounds.
   */
  const setMode = (mode: ExecutionMode, reason: string, by: ModeActor) => {
    const from = settingsRef.current.executionMode;
    if (mode === from) return;
    settingsRef.current = { ...settingsRef.current, executionMode: mode };
    setSettings((s) => ({ ...s, executionMode: mode }));
    const text = `${modeChangeText(from, mode, reason, by)}${modePauseText(from, mode)}`;
    modeChangeRef.current = text;
    setModeChange(text);
    addLog('Mode', text, 'info');
  };

  /** Applies the AI's mode directive when it may set that mode; a refused one is logged as rejected. */
  const applyAiMode = (d: ModeDirective) => {
    const r = resolveAiDirective(settingsRef.current.executionMode, d);
    if (r.kind === 'accepted') setMode(r.mode, r.reason, 'ai');
    else if (r.kind === 'rejected') addLog('Mode', r.text, 'warn');
  };


  /** The learned position of the step's target on `live` (learner on, anchor matched), or null. */
  const learnedPoint = (live: Frame, step: WorkflowStep) => {
    if (!stageOn('coords')) return null;
    const name = step.target ?? step.name;
    const el = findFamiliar(familiarRef.current, name);
    return el ? learnedSeed(el, live.data, seedPoint(findDossier(dossiersRef.current, name)) ?? el) : null;
  };

  /** The executor is running (Auto Act, replay, a running step, or an AI command): the learner pauses. */
  const executorBusy = () => autoBusyRef.current || replayingRef.current || aiBusyRef.current || stepsRef.current.some((s) => s.status === 'running');

  /** Why background variations must hold their real-input work now (abort, unchecked stages, main executor busy), or null. */
  const variationHold = (): string | null => {
    if (abortedRef.current) return `Aborted — background variations hold; ${ABORT_HINT}`;
    if (!stageOn('variations')) return stageOff('variations');
    if (!stageOn('executor')) return stageOff('executor');
    return executorBusy() ? 'Main executor needs the screen — background variations paused' : null;
  };

  /** Dwell learning on a new frame: the cursor resting over a learned target re-observes it there. */
  const learnFromDwell = (frame: Frame) => {
    if (!stageOn('coords') || executorBusy()) return;
    const now = Date.now();
    const dwell = detectDwell(pointerRef.current, now);
    if (!dwell || dwell.since === dwellSeenRef.current) return;
    dwellSeenRef.current = dwell.since;
    const obs = dwellObservation(familiarRef.current, dwell, frame, now);
    if (obs) learnCoords(obs);
  };

  /** Outcome learning: an executed pointer action teaches its target's coordinates, on the frame it was aimed on. */
  const learnFromOutcome = (step: WorkflowStep, out: Performed, frame: Frame | null) => {
    if (!stageOn('coords') || !out.executed || !POINTER_ACTIONS.has(step.action)) return;
    const name = step.target ?? step.name;
    commitDossiers(recordPositionOutcome(dossiersRef.current, name, out.target, out.ok, Date.now()));
    if (out.ok) learnCoords({ name, x: out.target.x, y: out.target.y, frame, time: Date.now() });
  };

  /** A verified drag moved its element: the AI moved it to `to`. */
  const learnAiMove = (name: string, to: { x: number; y: number }) => {
    if (stageOn('coords')) commitDossiers(recordSighting(dossiersRef.current, { name, ...to, time: Date.now(), by: 'ai' }));
  };

  /** Where a drag step is supposed to move its element, recorded in the element's dossier. */
  const planMove = (step: WorkflowStep) => {
    if (stageOn('coords') && step.endX !== undefined && step.endY !== undefined) commitDossiers(setMove(dossiersRef.current, step.target ?? step.name, { x: step.endX, y: step.endY }));
  };

  /** The user sets (or with null clears) the preferred position of a tracked element. */
  const preferPosition = (name: string, p: { x: number; y: number } | null) => commitDossiers(setPreferred(dossiersRef.current, name, p && { ...p, by: 'user' }));

  /** The operation the AI's memory is gathered for: the run goal, else the running step's target. */
  const currentOperation = () => goalRef.current || (stepsRef.current.find((s) => s.status === 'running')?.target ?? '');

  const agentOn = useCallback((id: Agent['id']) => agents.find((a) => a.id === id)?.on ?? false, [agents]);
  const agentsRef = useRef(agentOn);
  agentsRef.current = agentOn;

  /** What each recipient does with a forwarded element; the returned note is shown on its inbox message. */
  const busHandlers: Record<BusAgentId, (e: ForwardedElement, from: BusAgentId) => string> = {
    coords: (e) => {
      if (isGridLabel(e.name)) return `Skipped "${e.name}" — an unnamed grid region is never predefined`;
      knownRef.current = predefine(knownRef.current, e);
      setKnownElements(knownRef.current);
      return `Predefined "${e.name}" at ${at(e.x, e.y)} — fed into planning`;
    },
    habits: (e, from) => {
      if (isGridLabel(e.name)) return `Skipped "${e.name}" — an unnamed grid region is never a habit`;
      addPatterns([newPattern('add', `"${e.name}" is at ${at(e.x, e.y)} (found by ${BUS_AGENTS[from]})`, goalRef.current)]);
      return `Recorded "${e.name}" as a habit`;
    },
    screen: (e) => {
      const box: Annotation = { id: uid('ann'), x: Math.max(0, e.x - (e.w ?? 0.04) / 2), y: Math.max(0, e.y - (e.h ?? 0.04) / 2), w: e.w ?? 0.04, h: e.h ?? 0.04, label: `Watching: ${e.name}`, tone: 'info', actX: e.x, actY: e.y };
      setAnnotations((a) => [box, ...a.filter((x) => x.label !== box.label)].slice(0, 6));
      return `Observing "${e.name}" on the live screen`;
    },
    popup: (e) => `Noted "${e.name}" — not a popup to flag`,
    drift: (e) => `Will cross-check "${e.name}" at ${at(e.x, e.y)}`,
    progress: (e) => `Noted "${e.name}" as reachable`,
    goal: (e) => `Noted "${e.name}" for goal review`,
    supervisor: (e) => `Noted "${e.name}" for link/route tests`,
    sidetest: (e) => `Noted "${e.name}" for side tests`,
    mainApp: (e, from) => {
      const bridge = mainBridgeRef.current;
      if (bridge?.state().status !== 'connected') return `${NOT_CONNECTED} ("${e.name}")`;
      void bridge.send('intercept_notice', { from: BUS_AGENTS[from], element: { name: e.name, x: e.x, y: e.y } });
      return `Sent "${e.name}" to the main app as an intercept notice`;
    },
    operations: (e) => `Monitor agent tracks "${e.name}" at ${at(e.x, e.y)}; testing agent can test it`,
  };

  /** Why no project may take a turn now: a guardrail (abort, disarmed, executor kill-switch) or its loop-control stage; null = go on. */
  const projectHalt = (): string | null => {
    if (abortedRef.current) return ABORTED_REFUSAL;
    if (!armedRef.current) return 'Real input is disarmed';
    if (!stageOn('executor')) return stageOff('executor');
    if (!stageOn('projects')) return stageOff('projects');
    return aiOnline() ? null : 'AI offline';
  };

  /** The live frame the project's AI calls look at. */
  const projectFrame = () => framesRef.current[0] ?? null;

  const projectEngine = useProjects({
    log: (message, tone) => addLog('Projects', message, tone),
    halt: projectHalt,
    busy: () => triggerBusyRef.current || executorBusy(),
    plan: async ({ goal: projectGoal, context, why, steps: planned }) => {
      const ask = askFor('planner');
      const plan = why
        ? await planRemaining(ask, projectGoal, projectFrame(), planned.map(toStep), [why, ...context].join('\n'), patternsRef.current)
        : await planFromGoal(projectGoal, cardsRef.current, projectFrame(), ask, context, patternsRef.current);
      return plan.steps;
    },
    run: (p, dryRun) => {
      stepsRef.current = p.steps.map(toStep);
      setSteps(stepsRef.current);
      return runReplay(dryRun, { label: `Project "${p.name}"`, goal: p.goal });
    },
    check: (p) => verifyGoal(askFor('projects'), projectFrame(), p.goal, stepsRef.current),
    research: async (p, question) => {
      const frame = projectFrame();
      if (!frame) throw new Error('no live screen to research on');
      return (await describeScreen(askFor('projects'), frame, question, p.goal)).answer;
    },
    learn: ({ habit, pattern }) => {
      commitHabits(recordOutcome(habitsRef.current, habit));
      addPatterns([pattern]);
    },
    maxRetries: () => settingsRef.current.stepRetries,
  });
  const projectInjectRef = useRef(projectEngine.injectRunning);
  projectInjectRef.current = projectEngine.injectRunning;

  /** Whether a bus recipient handles a message now: habits and the main app always, the Operations agents while their Monitor is on, others while switched on. */
  const recipientOn = (id: BusAgentId) => (id === 'habits' || id === 'mainApp' ? true : id === 'operations' ? stageOn('opsMonitor') : agentsRef.current(id));

  /**
   * Forwards a discovered element from one agent into the inboxes of the others (all of them by
   * default) for forward testing and predefining. Each recipient that is on handles it at once;
   * an off agent keeps it queued.
   */
  const forwardElement = useCallback((from: BusAgentId, element: ForwardedElement, to?: BusAgentId[]) => {
    const { bus: next, queued } = forward(busRef.current, from, element, to);
    let updated = next;
    const replies: string[] = [];
    queued.forEach((m) => {
      if (!recipientOn(m.to)) return;
      const reply = busHandlers[m.to](element, from);
      replies.push(`${BUS_AGENTS[m.to]}: ${reply}`);
      updated = markHandled(updated, m.id, reply);
    });
    busRef.current = updated;
    setBus(updated);
    if (replies.length) note({ step: `${BUS_AGENTS[from]} → "${element.name}"`, kind: 'reply', text: replies.join('\n'), thinking: null });
    const shot = framesRef.current[0];
    if (shot) preferFrame(shot, BUS_AGENTS[from], `found "${element.name}"`);
    crewApiRef.current?.observeElement(element);
    addLog('Agent bus', `${BUS_AGENTS[from]} forwarded "${element.name}" at ${at(element.x, element.y)} to ${queued.length} agent(s)`, 'info');
    projectInjectRef.current('agent', BUS_AGENTS[from], `Found "${element.name}" at ${at(element.x, element.y)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addLog, note, preferFrame]);

  const adDismissed = () => Math.floor(tickRef.current / AD_CYCLE) === dismissedCycleRef.current;

  /** Notes one user or AI input at `p`, kept for MOVE_BLAME_MS-scale move attribution (last ACTOR_INPUT_LIMIT). */
  const noteInput = (p: { x: number; y: number }, actor: ActorInput['actor']) => {
    actorInputsRef.current = [...actorInputsRef.current, { time: Date.now(), x: p.x, y: p.y, actor }].slice(-ACTOR_INPUT_LIMIT);
  };

  /**
   * Appends one mouse/keyboard action to the persistent history, with the pointer's prior point, screen size and prior text for reversal.
   * Only real bridge/main-app dispatches are recorded as such; a verified-but-not-sent step or a demo simulation is a labeled dry run.
   */
  const recordAction = useCallback((step: WorkflowStep, out: StepOutcome, actor: string, via: ActionRecord['via'], srcW: number, srcH: number) => {
    const kind = INPUT_ACTIONS[step.action];
    if (!kind) return;
    const simulated = via === 'demo' && out.executed;
    const dryRun = via === 'demo' || !out.executed;
    const end = kind === 'drag' ? dragEnd(step, srcW, srcH) : null;
    const px = (p: { x: number; y: number }) => ({ x: Math.round(p.x * srcW), y: Math.round(p.y * srcH) });
    const prev = lastPointerRef.current ? px(lastPointerRef.current) : null;
    const message = dryRun ? dryRunMessage(out.message, simulated) : out.message;
    const rec: ActionRecord = { id: uid('act'), time: Date.now(), action: kind, ...px(out.target), ...(end ? { endX: end.x, endY: end.y } : {}), ...(prev ? { prevX: prev.x, prevY: prev.y } : {}), srcW, srcH, text: step.text, ...(step.priorText !== undefined ? { priorText: step.priorText } : {}), source: actor, via, ok: out.ok, message, ...(via === 'bridge' && out.executed && out.check && !out.check.changed ? { dispatched: true } : {}), ...(dryRun ? { dryRun } : {}), ...(simulated ? { simulated } : {}) };
    if (out.executed && POINTER_ACTIONS.has(step.action)) lastPointerRef.current = out.end ?? out.target;
    if (out.executed) noteInput(out.target, USER_ACTORS.has(actor) ? 'user' : 'ai');
    lastRecordRef.current = rec;
    setHistory((h) => appendHistory(h, rec));
    recordOp(actor, 'executor', trackDraft(step, out));
  }, [recordOp]);

  /** A click on the ad popup while it shows: closes it on its ×, is blocked anywhere else on it; null off the ad. */
  const adClick = (x: number, y: number): string | null => {
    const t = tickRef.current;
    const ad = demoAd(t);
    if (!ad.visible || adDismissed()) return null;
    if (Math.abs(x - ad.closeX) < 0.03 && Math.abs(y - ad.closeY) < 0.05) {
      dismissedCycleRef.current = Math.floor(t / AD_CYCLE);
      return 'Closed the ad popup';
    }
    return x >= ad.x && x <= ad.x + ad.w && y >= ad.y && y <= ad.y + ad.h ? 'Click landed on the ad (blocked target)' : null;
  };

  /** Applies a click to the demo desktop (dismiss the ad, press Play). */
  const desktopClick = useCallback((x: number, y: number): string => {
    const onAd = adClick(x, y);
    if (onAd) return onAd;
    const play = demoPlayButton(tickRef.current);
    if (Math.abs(x - play.x) < 0.08 && Math.abs(y - play.y) < 0.045) {
      setPlays((p) => p + 1);
      return 'Pressed PLAY';
    }
    return 'Click hit nothing interactive';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The test world while it is the shown scene; null on the Desktop scene. */
  const activeWorld = (): World | null => (worldOnRef.current ? worldRef.current : null);

  /** The quest world while it is the shown scene (the test World is not); null otherwise. */
  const activeQuest = (): Quest | null => (questOnRef.current && !worldOnRef.current ? questRef.current : null);

  /** The shown scene's planning-context lines: the test world's or the quest's; none on the plain Desktop. */
  const worldLines = () => {
    const world = activeWorld();
    if (world) return worldContext(world);
    const quest = activeQuest();
    return quest ? questContext(quest) : [];
  };

  /** Applies a world event: keeps its next state and returns its message and verdict. */
  const applyWorld = (r: WorldResult): DemoOutcome => {
    worldRef.current = r.world;
    return { message: r.message, ok: r.ok };
  };

  /** Applies a quest event: keeps its next state and returns its message and verdict. */
  const applyQuest = (r: QuestResult): DemoOutcome => {
    questRef.current = r.quest;
    return { message: r.message, ok: r.ok };
  };

  /** A click on the quest scene: the ad popup first (it covers the arena), then the quest element under it. */
  const questSceneClick = (quest: Quest, p: { x: number; y: number }, double: boolean): DemoOutcome => {
    const onAd = adClick(p.x, p.y);
    if (onAd) return desktopOutcome(onAd);
    return applyQuest(double ? questDoubleClick(quest, p) : questClick(quest, p));
  };

  /** The taskbar Quest/Desktop button (drawn on the Desktop scenes only): switches the quest on or off. */
  const toggleQuest = (): DemoOutcome => {
    questOnRef.current = !questOnRef.current;
    return { message: questOnRef.current ? 'Switched to the Quest world' : 'Switched to the Desktop', ok: true };
  };

  /**
   * A click or double-click on the demo: the taskbar World/Desktop and Quest buttons switch scenes; in the test
   * world it goes to the world (a double-click opens boxes, icons and the chest); in the quest it goes to the quest
   * (a double-click opens the Mystery Box); on the Desktop it dismisses the ad or presses Play.
   */
  const demoClick = useCallback((x: number, y: number, double = false): DemoOutcome => {
    const p = { x, y };
    if (onWorldToggle(p)) {
      worldOnRef.current = !worldOnRef.current;
      return { message: worldOnRef.current ? 'Switched to the test World' : 'Switched to the Desktop', ok: true };
    }
    const world = activeWorld();
    if (world) return applyWorld(double ? worldDoubleClick(world, p) : worldClick(world, p));
    if (onQuestToggle(p)) return toggleQuest();
    const quest = activeQuest();
    if (quest) return questSceneClick(quest, p, double);
    return desktopOutcome(desktopClick(x, y));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktopClick]);

  /** Typing on the demo: into the test world's focused window or the quest (Calculator, Priest); the Desktop has nowhere to type. */
  const demoType = (text: string): DemoOutcome => {
    const world = activeWorld();
    if (world) return applyWorld(worldType(world, text));
    const quest = activeQuest();
    return quest ? applyQuest(questType(quest, text)) : { message: 'type simulated on the demo desktop', ok: true };
  };

  /** A key press on the demo: to the test world's focused window or the quest's Calculator; the Desktop ignores it. */
  const demoKey = (key: string): DemoOutcome => {
    const world = activeWorld();
    if (world) return applyWorld(worldKey(world, key));
    const quest = activeQuest();
    return quest ? applyQuest(questKey(quest, key)) : { message: 'key simulated on the demo desktop', ok: true };
  };

  /** A stage key press on the demo: a printable character types it, any other key is pressed. */
  const demoTextKey = (key: string): DemoOutcome => (key.length === 1 ? demoType(key) : demoKey(key));

  /**
   * Applies a drag to the demo desktop: grabbing a sidebar icon moves it; on the quest scene grabbing an item
   * or hero moves (or equips) it; grabbing the Report file moves (or archives) it. Names what it grabbed.
   */
  const applyDemoDrag = useCallback((from: { x: number; y: number }, to: { x: number; y: number }): { message: string; grabbed: string | null } => {
    const world = activeWorld();
    if (world) {
      const r = worldDrag(world, from, to);
      worldRef.current = r.world;
      return { message: r.message, grabbed: r.ok ? r.grabbed ?? null : null };
    }
    const icon = moveIcon(demoIconsRef.current, from, to);
    if (icon.moved) {
      demoIconsRef.current = icon.icons;
      return { message: `Dragged "${icon.moved.label}" to (${pct(icon.moved.x)}, ${pct(icon.moved.y)})`, grabbed: icon.moved.label };
    }
    const quest = activeQuest();
    const q = quest ? questDrag(quest, from, to) : null;
    if (q?.ok) {
      questRef.current = q.quest;
      return { message: q.message, grabbed: q.grabbed ?? null };
    }
    const r = demoDrag(demoFileRef.current, from, to);
    demoFileRef.current = r.file;
    return { message: r.message, grabbed: r.moved ? 'Report' : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The quest item or hero a drag starting at `from` would grab on the shown quest scene; null off the quest or on nothing draggable. */
  const questGrabTarget = (from: { x: number; y: number }): string | null => {
    const quest = activeQuest();
    const el = quest ? questElementAt(quest, from) : null;
    return el && (el.kind === 'item' || el.kind === 'character') ? el.name : null;
  };

  /** Decoded images of the presentation embedded in the demo world, by data URL. */
  const worldImagesRef = useRef(new Map<string, HTMLImageElement>());
  /** Draws the shown demo scene (Desktop or test World) at the current tick, with the embedded presentation on its in-world screen. */
  const drawDemo = (ctx: CanvasRenderingContext2D) => {
    drawDemoDesktop(ctx, DEMO_W, DEMO_H, tickRef.current, adDismissed(), demoFileRef.current, demoIconsRef.current, activeWorld(), activeQuest());
    const embed = studio.currentEmbed();
    if (!embed) return;
    const url = embed.images[worldImageAt(embed, tickRef.current)];
    const cache = worldImagesRef.current;
    if (!cache.has(url)) cache.set(url, Object.assign(new Image(), { src: url }));
    const img = cache.get(url)!;
    drawWorldScreen(ctx, DEMO_W, DEMO_H, embed.title, img.complete && img.naturalWidth ? img : null);
  };

  /** A fresh frame of the demo desktop as it is right now; null when there is no canvas to draw on. */
  const demoSnapshot = (): Frame | null => {
    const c = demoCanvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return null;
    drawDemo(ctx);
    return toFrame(c, DEMO_W, DEMO_H, ++frameId.current, 'demo');
  };

  /** Each demo step action's simulated effect at `p`; an action without one is reported as simulated. */
  const DEMO_EFFECTS: Partial<Record<StepAction, (step: WorkflowStep, p: { x: number; y: number }) => DemoOutcome>> = {
    click: (_, p) => demoClick(p.x, p.y),
    double_click: (_, p) => demoClick(p.x, p.y, true),
    move: (_, p) => ({ message: `Moved the cursor to (${pct(p.x)}, ${pct(p.y)})`, ok: true }),
    drag: (step, p) => {
      const r = applyDemoDrag(p, { x: step.endX ?? p.x, y: step.endY ?? p.y });
      return { message: r.message, ok: !!r.grabbed };
    },
    type: (step) => demoType(step.text ?? ''),
    key: (step) => demoKey(step.text ?? ''),
  };

  /** The simulated effect of a step on the demo desktop at `p`. */
  const demoEffect = (step: WorkflowStep, p: { x: number; y: number }): DemoOutcome => DEMO_EFFECTS[step.action]?.(step, p) ?? { message: `${step.action} simulated on the demo desktop`, ok: true };

  /** A drag on the demo desktop, with the frames around it and the element it grabbed. */
  const demoDragStep = (step: WorkflowStep, p: { x: number; y: number }, live: Frame | undefined): Performed => {
    const pre = demoSnapshot() ?? live;
    const end = { x: step.endX!, y: step.endY! };
    const { message, grabbed } = applyDemoDrag(p, end);
    return { ok: !!grabbed, executed: !!grabbed, message, target: p, end, live: pre, shot: demoSnapshot() ?? undefined, grabbed: grabbed ?? undefined };
  };

  /** Where the shown quest puts a pointer step's named target (the live element table), or null off the quest or for an unknown name. */
  const questTargetPoint = (step: WorkflowStep): { x: number; y: number } | null => {
    const quest = activeQuest();
    const el = quest && step.target && POINTER_ACTIONS.has(step.action) ? findQuestElement(quest, step.target) : null;
    return el ? { x: el.x, y: el.y } : null;
  };

  /** Performs a step on the demo desktop: grounded on a learned point, the quest's named element or a template match, then simulated. */
  const performOnDemo = async (step: WorkflowStep, dryRun: boolean): Promise<Performed> => {
    const local = LOCAL_ACTIONS[step.action];
    if (local) return { ...(await local(step)), executed: true, target: { x: step.x, y: step.y } };
    const badEnd = dragEndError(step);
    if (badEnd) return { ok: false, executed: false, message: badEnd, target: { x: step.x, y: step.y } };
    const live = framesRef.current[0];
    let p = { x: step.x, y: step.y };
    const seeded = live && POINTER_ACTIONS.has(step.action) ? learnedPoint(live, step) ?? habitSeed(live, step) : null;
    const named = seeded ? null : questTargetPoint(step);
    if (seeded) p = seeded;
    else if (named) p = named;
    else if (step.refFrame && live) {
      const { r, level } = driftCheck(step, live);
      if (level === 'red') return { ok: false, executed: false, message: `Target of "${step.name}" not found on the demo screen (best match ${r.matchDistance.toFixed(3)}) — not executed`, target: p };
      p = { x: step.x + r.dx, y: step.y + r.dy };
    }
    if (POINTER_ACTIONS.has(step.action)) {
      aim({ x: step.x, y: step.y });
      aim(p);
      await animator().idle();
    }
    if (dryRun) return { ok: true, executed: false, message: `verified on the demo screen — ${DRY_RUN}`, target: p, ...(step.action === 'drag' ? { end: { x: step.endX!, y: step.endY! } } : {}) };
    if (step.action === 'drag') return demoDragStep(step, p, live);
    const { message, ok } = demoEffect(step, p);
    if (ok && live && POINTER_ACTIONS.has(step.action)) strengthen(live, step, p);
    return { ok, executed: ok, message, target: p };
  };

  /**
   * The one execution path every feature uses. Demo: simulated on the demo canvas. Otherwise
   * real input via run-step (live desktop frame, drift correction, AI grounding of named
   * targets, bridge dispatch, re-verify), gated by abort, arm and the run's budget.
   */
  const performStep = async (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean): Promise<Performed> => {
    if (abortedRef.current) return refused(step, `Aborted — real input not sent; ${ABORT_HINT}`);
    if (!stageOn('executor')) return refused(step, `${stageOff('executor')} — not executed`);
    // Avoid entries gate every dispatch, agent tests and trigger hops included; stale-map gating is perform's (it can re-ground).
    breakDeadlock(step, actor);
    const block = gateStep(step, knowledge(), avoidRulesRef.current, false);
    if (block) {
      addLog(actor, `"${step.name}" not dispatched — ${block.reason}`, 'error');
      captureError({ kind: 'step', message: `"${step.name}" not dispatched — ${block.reason}`, goal: goalRef.current, step: step.name });
      return refused(step, `Blocked — ${block.reason} — not executed`);
    }
    const attempt = beginAttempt(step, actor);
    const out = await performAction(step, actor, budget, dryRun);
    endAttempt(attempt.id, out.ok);
    return out;
  };

  /** One attempt's action past the abort and executor gates: measure, the approval gate, snip or real input. */
  const performAction = async (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean): Promise<Performed> => {
    if (step.action === 'measure') return measureStep(step, actor);
    const held = dryRun ? null : approvals.gate(step, actor, { goal: goalRef.current, planned: stepsRef.current.some((s) => s.id === step.id) });
    if (held) return refused(step, held);
    if (step.action === 'snip') return snipStep(step);
    const before = framesRef.current[0] ?? null;
    const out = await performInput(step, actor, budget, dryRun);
    ruler.noteGrounding(out);
    if (out.ok) markOutcome(step, out);
    if (step.target) learnFromOutcome(step, out, before);
    noteTargetUse(step, out, actor);
    await animator().idle();
    return out;
  };

  /** Counts a named pointer step's use and failure toward an automatic side test (the side tester's own steps excepted). */
  const noteTargetUse = (step: WorkflowStep, out: Performed, actor: string) => {
    if (!step.target || out.halt || actor === 'Side tester' || !POINTER_ACTIONS.has(step.action)) return;
    interactionsRef.current = noteInteraction(interactionsRef.current, step.target, out.target, out.ok);
  };

  /**
   * Records one attempt (cursor before → step target) and, for an AI actor, states its intention
   * in the notification center: "Moving to X to click it because …".
   */
  const beginAttempt = (step: WorkflowStep, actor: string): OperationAttempt => {
    const why = intentWhyRef.current.get(step.id) || defaultWhy(step, goalRef.current);
    const intent = intentionText(step, why);
    const tries = attemptsRef.current.filter((a) => a.stepId === step.id).length + 1;
    const to = { x: step.correctedX ?? step.x, y: step.correctedY ?? step.y };
    const attempt: OperationAttempt = { id: uid('attempt'), stepId: step.id, name: step.name, action: step.action, actor, intent, from: animator().where(), to, start: Date.now() };
    attemptsRef.current = [...attemptsRef.current, attempt].slice(-ATTEMPT_LIMIT);
    setAttempts(attemptsRef.current);
    if (!USER_ACTORS.has(actor)) notify(intentionDraft(intent, tries));
    return attempt;
  };

  const endAttempt = (id: string, ok: boolean) => {
    attemptsRef.current = attemptsRef.current.map((a) => (a.id === id ? { ...a, end: Date.now(), ok } : a));
    setAttempts(attemptsRef.current);
  };

  /**
   * The marker an attempt that succeeded (executed or dry run alike) leaves on the trail: a drag
   * travels start → end with a click dot at each, a click/double-click gets a click dot at its
   * target, typing gets a typing marker where the cursor is; other actions leave only their path.
   */
  const markOutcome = (step: WorkflowStep, out: Performed) => {
    const a = animator();
    if (step.action === 'drag' && out.end) {
      aim(out.target);
      a.mark('click');
      aim(out.end);
      a.mark('click');
      return;
    }
    const kind = MARKER_OF[step.action];
    if (!kind) return;
    if (kind === 'click') aim(out.target);
    a.mark(kind);
  };

  /** The measure action: no input is sent and no budget spent; the result (or the loud error) goes to the log and the model. */
  /** A planned "snip" step: the AI or an agent screenshots the region its text names (else around its point). */
  const snipStep = async (step: WorkflowStep): Promise<Performed> => {
    const req = parseSnipArgs(step.text ?? '');
    const box = 'error' in req ? targetRegion(step) : req.box;
    const s = 'error' in req ? await snip(box, { label: step.name }) : await snip(box, { size: req.size, displayId: req.displayId, label: step.name });
    return { ok: !!s, executed: false, message: s ? `Snipped ${snipText(s)}` : `"${step.name}": nothing to snip`, target: { x: step.x, y: step.y } };
  };

  const measureStep = (step: WorkflowStep, actor: string): Performed => {
    const target = { x: step.x, y: step.y };
    try {
      return { ok: true, executed: true, message: measureFor(step.text ?? step.target ?? step.name, actor), target };
    } catch (error) {
      return { ok: false, executed: false, message: `Measurement failed — ${errorText(error)}`, target };
    }
  };

  /**
   * The main Droid app's answer to one located step: sent as a run_script command at the
   * drift-corrected (and grounded) point, so the mirror runs the same pipeline as the local screen.
   */
  const sendToMainApp: SendFn = async (step) => {
    const at = { ...step, x: step.correctedX ?? step.x, y: step.correctedY ?? step.y };
    const result = await (mainBridgeRef.current?.request('run_script', runScriptPayload(at)) ?? Promise.resolve({ ok: false, message: NOT_CONNECTED }));
    return { ok: result.ok, message: `Main app: ${result.message}` };
  };

  /**
   * The live frame a step is located and re-verified on: the source's own latest captured frame
   * (Electron, getDisplayMedia or the main-app mirror), else a fresh desktop bridge screenshot.
   */
  const stepFrame = async (frames: FrameProvider): Promise<Frame> => {
    if (frames !== 'captured') return desktopFrame(settingsRef.current.bridgeUrl, settingsRef.current.bridgeToken, ++frameId.current);
    const own = framesRef.current[0];
    if (!own) throw new Error(`no frame captured yet from the ${captureLabel(sourceRef.current, captureRef.current?.kind)}`);
    return own;
  };

  /** The step pipeline's host for the current source: its frames, its input route and the gates. */
  const stepDeps = (plan: StepPlan, actor: string, budget: ActionBudget, dryRun: boolean): StepDeps => {
    const { bridgeUrl, bridgeToken, checkpoints } = settingsRef.current;
    return {
      bridgeUrl,
      bridgeToken,
      capture: () => stepFrame(plan.frames),
      send: plan.input === 'main-app' ? sendToMainApp : undefined,
      attempts: Math.max(1, checkpoints),
      retryMs: 400,
      drift: driftThresholds(),
      dispatch: !dryRun,
      log: (m, tone) => addLog(actor, m, tone),
      grounding: aiOnline() && stageOn('grounding') ? grounding : undefined,
      seed: habitSeed,
      learned: learnedPoint,
      onVerified: strengthen,
      aim,
      gateRetry: dryRun ? undefined : () => gateRealInput(budget),
    };
  };

  /** History gets real dispatches and verified dry runs; refused or unverified steps leave nothing. */
  const historyWorthy = (out: Performed, dryRun: boolean) => out.executed || (dryRun && out.ok);

  /** Records a step's result on its route: a main-app failure is a main-app error; a desktop step is history and bridge health. */
  const noteRoute = (plan: StepPlan, step: WorkflowStep, out: Performed, actor: string, dryRun: boolean) => {
    if (plan.input === 'main-app') {
      if (out.bridgeFailed) captureError({ kind: 'main-app', message: out.message, goal: goalRef.current, step: step.name });
      return;
    }
    if (historyWorthy(out, dryRun)) recordAction(step, out, actor, 'bridge', out.live?.srcW ?? 1920, out.live?.srcH ?? 1080);
    noteBridge(step, out, actor);
  };

  /**
   * A real-input step on the current capture source. The source only provides the frames and the
   * input route (see capture-source): every source runs the same pipeline — locate and drift-correct
   * on its live frames, AI grounding, corrected retry and re-verify. The demo simulates only dry runs
   * or when no bridge is configured; a dry run on captured frames needs no bridge. A failure is loud.
   */
  const dispatchInput = async (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean): Promise<Performed> => {
    const plan = stepPlan(sourceRef.current, { dryRun, bridgeUrl: settingsRef.current.bridgeUrl });
    if (!plan) return refused(step, NO_SOURCE);
    if (plan.input === 'demo') {
      const out = await performOnDemo(step, dryRun);
      if (historyWorthy(out, dryRun)) recordAction(step, out, actor, 'demo', DEMO_W, DEMO_H);
      return out;
    }
    const local = plan.input === 'main-app' ? LOCAL_ACTIONS[step.action] : undefined;
    if (local) return { ...(await local(step)), executed: true, target: { x: step.x, y: step.y } };
    if (plan.needsBridge && !settingsRef.current.bridgeUrl) return refused(step, BRIDGE_REQUIRED);
    const gate = dryRun ? null : gateRealInput(budget);
    if (gate) return refused(step, gate);
    if (!dryRun && plan.input === 'desktop-bridge' && step.action === 'drag' && settingsRef.current.liveDrag && stageOn('dragTrackers')) return performLiveDrag(step, actor);
    const out = await runStep(relaxStep(step, settingsRef.current.relaxMode), stepDeps(plan, actor, budget, dryRun));
    noteRoute(plan, step, out, actor, dryRun);
    return out;
  };

  /**
   * The step with its target's dossier factored in: the preferred/predicted/best position (unless a
   * recorded template locates it), a wait to catch an in-motion element, and a systematic offset once per step.
   */
  const compensateStep = async (step: WorkflowStep, actor: string): Promise<WorkflowStep> => {
    if (!stageOn('coords') || !POINTER_ACTIONS.has(step.action)) return step;
    const c = compensate(findDossier(dossiersRef.current, step.target ?? step.name), step, { x: step.x, y: step.y }, offsetStepsRef.current, Date.now());
    if (c.offset) offsetStepsRef.current.add(step.id);
    if (!c.notes.length) return step;
    addLog(actor, `"${step.name}": position dossier — ${c.notes.join('; ')}`, 'info');
    if (c.waitMs) await sleep(c.waitMs);
    const moved = !step.refFrame && (c.point.x !== step.x || c.point.y !== step.y);
    return moved ? { ...step, x: c.point.x, y: c.point.y, correctedX: undefined, correctedY: undefined } : step;
  };

  /** Records where an executed pointer step was planned against where it actually landed. */
  const noteLanding = (step: WorkflowStep, out: Performed) => {
    if (!stageOn('coords') || !out.executed || !out.ok || !POINTER_ACTIONS.has(step.action)) return;
    commitDossiers(recordTest(dossiersRef.current, step.target ?? step.name, { x: step.x, y: step.y }, out.target, Date.now()));
  };

  /** A real-input step with its target's position dossier factored in before and its landing recorded after. */
  const performInput = async (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean): Promise<Performed> => {
    const planned = await compensateStep(step, actor);
    const out = await dispatchInput(planned, actor, budget, dryRun);
    noteLanding(planned, out);
    return out;
  };

  /** Why a live drag must let go before its next segment: abort, disarm or Stop plan; null to go on. */
  const liveDragHalt = (): string | null => {
    if (abortedRef.current) return 'Aborted';
    if (!armedRef.current) return 'Real input disarmed';
    return abortRef.current ? 'Plan stopped' : null;
  };

  /** Main-AI freeflow during a live drag: asks the planner once where the lost drop target is now. */
  const relocateDrop = async (step: WorkflowStep, lostAt: { x: number; y: number }) => {
    const frame = framesRef.current[0];
    if (!frame || !aiOnline() || !stageOn('planner')) return null;
    const target = { ...step, action: 'move' as const, x: lostAt.x, y: lostAt.y, target: step.endTarget ?? `${step.name} drop point` };
    const found = await relocateTarget(askFor('planner'), frame, target, 'the drop target moved while the drag was in progress');
    return found && { x: found.x, y: found.y };
  };

  /**
   * Live parallel drag (Live drag setting + 'dragTrackers' stage, armed bridge only): the coordinate-agent
   * swarm tracks every segment on the live frames and the executor sends press → corrected segment moves →
   * release. The guardrails are checked before every segment and the button is always released on a stop.
   */
  const performLiveDrag = async (step: WorkflowStep, actor: string): Promise<Performed> => {
    const { bridgeUrl, bridgeToken } = settingsRef.current;
    const end = { x: step.endX ?? step.x, y: step.endY ?? step.y };
    const start = { x: step.correctedX ?? step.x, y: step.correctedY ?? step.y };
    let before: Frame;
    try {
      before = framesRef.current[0] ?? await desktopFrame(bridgeUrl, bridgeToken, ++frameId.current);
    } catch (error) {
      return { ok: false, executed: false, halt: true, bridgeFailed: true, message: `${BRIDGE_REQUIRED} (unreachable: ${errorText(error)})`, target: start };
    }
    const origin = { x: before.originX ?? 0, y: before.originY ?? 0 };
    const send = (input: 'mouse_down' | 'move' | 'mouse_up', p: { x: number; y: number }) => sendNative(bridgeUrl, { id: step.id, name: step.name }, [pointerAction(input, p, before.srcW, before.srcH, origin)], { token: bridgeToken, pollMs: 50, timeoutMs: 10000 });
    dragControlRef.current = null;
    liveDragRef.current = true;
    setLiveDragging(true);
    let res: LiveDragResult;
    try {
      res = await runLiveDrag({
        start, end, send,
        ref: step.refFrame?.data ?? before.data,
        drift: driftThresholds(),
        live: () => framesRef.current[0]?.data ?? null,
        halt: liveDragHalt,
        intervention: () => {
          const ask = dragControlRef.current;
          dragControlRef.current = null;
          return ask;
        },
        relocate: (lostAt) => relocateDrop(step, lostAt),
        onAgents: setSwarm,
        log: (m) => addLog(actor, m, 'info'),
      });
    } finally {
      liveDragRef.current = false;
      setLiveDragging(false);
    }
    const shot = await desktopFrame(bridgeUrl, bridgeToken, ++frameId.current).catch(() => undefined);
    const out: Performed = { ok: res.ok, executed: res.pressed, halt: res.halted, message: res.message, target: start, end: res.releasedAt, live: before, shot, bridgeFailed: !res.pressed };
    if (out.executed) recordAction(step, out, actor, 'bridge', before.srcW, before.srcH);
    noteBridge(step, out, actor);
    return out;
  };

  /** Tracks the bridge's reachability from a bridge step; a bridge failure is logged and forwarded as a bridge error. */
  const noteBridge = (step: WorkflowStep, out: Performed, actor: string) => {
    if (out.executed) setBridgeOnline(true);
    if (!out.bridgeFailed) return;
    setBridgeOnline(false);
    addLog(actor, `Bridge error — "${step.name}" FAILED, nothing was simulated: ${out.message}`, 'error');
    captureError({ kind: 'bridge', message: out.message, goal: goalRef.current, step: step.name });
  };

  /** Remembers the element `name` at `p` in the familiar-elements memory, with a patch of `frame` around it. */
  const rememberAt = async (name: string, p: { x: number; y: number }, frame: Frame | null | undefined) => {
    const patch = frame ? await patchAt(frame, p).catch(() => undefined) : undefined;
    familiarRef.current = rememberElement(familiarRef.current, { id: uid('el'), name, x: p.x, y: p.y, patch, lastSeen: Date.now() });
    setFamiliar(familiarRef.current);
    recordOp('Familiar elements', 'elementMap', elementDraft('remember', name, `point ${gridRef(p)}`, patch ? 'remembered with a screen patch' : 'remembered'));
  };

  /**
   * Familiar-elements memory: a pointer step whose target was verified or used is remembered
   * by name with its point, a small patch of the screen around it and the time. A drag is
   * remembered at its drop point, and only once the move was verified (see performDrag).
   */
  const rememberTarget = async (step: WorkflowStep, out: Performed) => {
    if (!out.ok || !POINTER_ACTIONS.has(step.action) || step.action === 'drag' || !stageOn('elementMap')) return;
    await rememberAt(step.target ?? step.name, out.target, out.shot ?? framesRef.current[0]);
  };

  const forgetFamiliar = (id: string) => {
    const el = familiarRef.current.find((f) => f.id === id);
    setFamiliar((list) => forgetElement(list, id));
    if (el) recordOp('Familiar elements', 'elementMap', elementDraft('forget', el.name, `id ${id}`, 'forgotten'));
  };

  /**
   * Before a navigate step on an always-in-motion element: waits per its observed timing so it is
   * caught where expected. When it waits for the next move, returns where that move should land
   * (velocity of its last two self moves extrapolated one move ahead); otherwise null.
   */
  const catchOnTime = async (step: WorkflowStep, actor: string): Promise<{ x: number; y: number } | null> => {
    const el = step.mappedId ? elementMapRef.current.find((e) => e.id === step.mappedId) : undefined;
    if (!el || motionOf(el).kind !== 'in_motion') return null;
    const timing = motionTiming(el);
    const plan = catchPlan(timing, Date.now());
    const predicted = plan.waitMs && timing ? predictNextPosition(selfMoveSightings(el), timing.meanMs / 1000) : null;
    addLog(actor, `"${el.name}" is always in motion: ${plan.reason}${predicted ? ` — aiming at its predicted spot ${gridRef(predicted)}` : ''}`, 'info');
    if (plan.waitMs) await sleep(plan.waitMs);
    return predicted;
  };

  /**
   * Reaches a click step's target by its saved access path first (no re-planning); a failed hop
   * falls back to `fresh` grounding. A real run counts the path's use, saves a repaired path and
   * feeds the path's success or failure back into the target's habit.
   */
  const reachByPath = async (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean, fresh: () => Promise<Performed>): Promise<Performed> => {
    const profile = isHopAction(step.action) && step.target ? usablePath(accessPathsRef.current, step.target, habitContext()) : null;
    const reached = stepsRef.current.filter((s) => s.status === 'done' && s.target).map((s) => s.target!);
    const reach = await reachTarget(step, profile, { runHop: (s) => performStep(s, actor, budget, dryRun), fallback: fresh, reached, log: (m, tone) => addLog(actor, m, tone) });
    if (!profile || dryRun || reach.via === 'fresh' || reach.out.halt) return reach.out;
    countPath(profile, reach);
    pathCountedRef.current.add(profile.target);
    return reach.out;
  };

  /**
   * Screenshot-verification agent, for every executed step of any actor: its before/after frames go to
   * the frame store and the evidence trail with the step, carrying the pipeline's own re-verify result.
   * The Apply agent records its own (with its recheck verdict).
   */
  const recordStepEvidence = (step: WorkflowStep, out: Performed, before: Frame | null, after: Frame | null) => {
    if (!out.executed || !stageOn('opsScreenshots')) return;
    [before, after].forEach((f) => f && void putStoredFrame(toStoredFrame(f), settingsRef.current.gallerySize).catch(() => undefined));
    const verdict = out.check ? (out.check.changed ? 'effect' : 'no-effect') : null;
    updateOps((s) => {
      const next = addEvidence(s, { op: operationNow(), step: step.name, action: step.action, x: out.target.x, y: out.target.y, beforeId: before?.id ?? null, afterId: after?.id ?? null, before: before?.url ?? null, after: after?.url ?? null });
      return markEvidence(next, next.evidence[0].id, verdict);
    });
  };

  /** Why `step` may not dispatch at all (blacklisted target+point, stale coordinates), or null. */
  const dispatchBlock = (step: WorkflowStep): GateBlock | null => gateStep(step, knowledge(), avoidRulesRef.current, true);

  /** Why pack/workflow dispatch is paused now (Watching mode, AI-down breaker), or null. */
  const dispatchPaused = () => pauseReason(settingsRef.current.executionMode, breakerRef.current);

  const commitBreaker = (b: Breaker) => {
    breakerRef.current = b;
    setBreaker(b);
  };

  /** One unresolved iteration with the AI endpoint down; at the limit (or at once when `hard`) the run pauses, with a notification. */
  const strikeBreaker = (hard: boolean, why: string) => {
    const next = strike(breakerRef.current, aiOnline(), hard);
    if (next === breakerRef.current) return;
    commitBreaker(next);
    if (!next.paused) return addLog('Runs', `AI endpoint down — unresolved iteration ${next.strikes}: ${why}`, 'warn');
    addLog('Runs', `${next.paused} — ${why}; resumes when the AI health check succeeds, or on Resume`, 'error');
    notify({ source: 'Runs', category: 'ai', severity: 'warning', title: `Run ${next.paused}` });
  };

  /** Clears the breaker; a paused run is announced as resumed. */
  const resumeRuns = (why: string) => {
    const was = breakerRef.current;
    commitBreaker(BREAKER_IDLE);
    if (!was.paused) return;
    addLog('Runs', `Resumed — ${why}; dispatch re-opened`, 'ok');
    notify({ source: 'Runs', category: 'ai', severity: 'info', title: `Runs resumed — ${why}` });
  };

  /** The user's Resume of a run the AI-down breaker paused. */
  const resumeRun = () => resumeRuns('resumed by the user');

  // A healthy AI endpoint clears the breaker (resuming a paused run); while it holds a run paused the endpoint is re-checked.
  useEffect(() => {
    if (aiStatus.state === 'online') {
      if (breakerRef.current !== BREAKER_IDLE) resumeRuns('AI endpoint health check succeeded');
      return undefined;
    }
    if (!breaker.paused) return undefined;
    const id = setInterval(() => void connectAi(), AI_RECHECK_MS);
    return () => clearInterval(id);
  }, [breaker.paused, aiStatus.state]);

  /** A blocked step's briefing: rebuilt on the live frame, marked blocked with why, and logged. */
  const noteBlocked = async (step: WorkflowStep, proposal: Proposal, block: GateBlock, actor: string) => {
    addLog(actor, `"${step.name}" not dispatched — ${block.reason}`, 'error');
    captureError({ kind: 'step', message: `"${step.name}" not dispatched — ${block.reason}`, goal: goalRef.current, step: step.name });
    if (stageOn('briefing')) await publishBriefing({ ...buildBriefingFor(step, proposal), outcome: 'blocked', blocked: block.reason });
  };

  /** The planner's one re-plan of a blocked step, told the conflicts; null when already escalated or still blocked. */
  const escalateBlocked = async (step: WorkflowStep, actor: string, block: GateBlock): Promise<WorkflowStep | null> => {
    const key = dispatchKey(step);
    if (escalatedRef.current.has(key)) return null;
    escalatedRef.current.add(key);
    const next = await replanFailed(step, `dispatch blocked: ${block.reason}; conflicts: ${conflictDetails(step, knowledge()) || 'none other'}`).catch((error: unknown) => {
      addLog(actor, aiFailure(`Re-plan of blocked "${step.name}" failed`, error), 'warn');
      return null;
    });
    const still = next && dispatchBlock(next);
    addLog(actor, next && !still ? `"${step.name}" re-planned after the block — ${next.action} "${next.target ?? next.name}" at ${at(next.x, next.y)}` : `"${step.name}": the re-plan could not verify an unblocked alternative${still ? ` (${still.reason})` : ''}`, next && !still ? 'ok' : 'warn');
    return next && !still ? next : null;
  };

  /**
   * A blocked step with the AI endpoint down: a strike on the breaker (stale coordinates pause the
   * run at once, nothing can re-ground them); never dispatched.
   */
  const holdBlocked = (step: WorkflowStep, block: GateBlock): Performed => {
    strikeBreaker(block.kind === 'stale', `"${step.name}" ${block.reason}`);
    const paused = breakerRef.current.paused;
    const what = block.kind === 'stale' ? 'stale-blocked' : 'blocked';
    return { ok: false, executed: false, halt: !!paused, paused: !!paused, message: `"${step.name}" ${what} — ${block.reason} — AI endpoint down, no re-grounding or re-plan possible — not executed${paused ? `; run ${paused}` : ''}`, target: { x: step.x, y: step.y } };
  };

  /**
   * Dispatch-time gate of `perform`: a blocked step is noted in the log and briefing and escalated
   * once to the planner when the AI is up (its re-plan dispatches only when unblocked, else the step
   * fails with why and the run moves on); with the AI down it is held (see holdBlocked).
   */
  const gateDispatch = async (step: WorkflowStep, actor: string, proposal: Proposal): Promise<{ step: WorkflowStep } | { out: Performed }> => {
    breakDeadlock(step, actor);
    const block = dispatchBlock(step);
    if (!block) return { step };
    await noteBlocked(step, proposal, block, actor);
    if (!aiOnline()) return { out: holdBlocked(step, block) };
    const next = await escalateBlocked(step, actor, block);
    if (next) return { step: next };
    return { out: { ok: false, executed: false, message: `"${step.name}" failed — ${block.reason}; the planner's re-plan could not produce a verifiable alternative — not executed`, target: { x: step.x, y: step.y } } };
  };

  /**
   * performStep (with element identification on a miss), then reflect-after-step: every step the
   * pipeline ran gets the model's reflection and verdict, and the verdict of a step that really
   * ran (not a dry run) updates its habit. No step is dispatched without a recorded proposal for
   * it (intent before action). The verdict is returned so subagents can judge their own steps.
   */
  const perform = async (planned: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean, proposal: Proposal | null, ladder = true): Promise<Performed & { verdict?: StepVerdict | null }> => {
    if (!proposal?.ready) return refused(planned, `No recorded proposal for "${planned.name}" — not executed`);
    const predicted = await catchOnTime(planned, actor);
    const mapped = resolveMappedStep(planned, elementMapRef.current);
    const resolved = predicted && !('error' in mapped) ? { ...mapped, ...predicted } : mapped;
    if ('error' in resolved) return refused(planned, `${resolved.error} — not executed`);
    const gated = await gateDispatch(resolved, actor, proposal);
    if ('out' in gated) return gated.out;
    const { step } = gated;
    if (proposal.why.trim()) intentWhyRef.current.set(step.id, proposal.why);
    const before = framesRef.current[0] ?? null;
    const fresh = () => (ladder ? performWithRetries(step, actor, budget, dryRun) : performIdentified(step, actor, budget, dryRun));
    const out = await reachByPath(step, actor, budget, dryRun, fresh);
    // Named targets are learned in performStep; an unnamed planned step is learned under its step name.
    if (!step.target) learnFromOutcome(step, out, before);
    kb.recordFor(actor, 'result', `"${step.name}": ${out.message}`, out.ok);
    void rememberTarget(step, out);
    if (actor !== OPS_APPLY_ACTOR) recordStepEvidence(step, out, before, out.shot ?? null);
    if (!out.ok && !out.bridgeFailed) captureError({ kind: actor === 'Self-test' ? 'watcher' : 'step', message: out.message, goal: goalRef.current, step: step.name });
    if (out.halt || !aiOnline()) return out;
    const verdict = await reflectAfter(step, out.shot ?? framesRef.current[0] ?? null, out, actor);
    if (verdict && !dryRun) learnHabit(step, verdict);
    return { ...out, verdict };
  };

  /** Why the retry ladder may not climb another rung (abort, kill-switch, executor unchecked); null when it may. */
  const ladderStopped = (): string | null => {
    if (abortedRef.current) return 'Aborted — no further attempts';
    if (abortRef.current) return 'Run stopped — no further attempts';
    return stageOn('executor') ? null : `${stageOff('executor')} — no further attempts`;
  };

  /** The planner's one re-plan of a step that failed after its retries, with its thinking on the step's timeline. */
  const replanFailed = async (step: WorkflowStep, why: string): Promise<WorkflowStep | null> => {
    if (!aiOnline() || !stageOn('planner')) {
      addLog('Planner', `No re-plan for "${step.name}" — ${aiOnline() ? stageOff('planner') : 'AI offline'}`, 'warn');
      return null;
    }
    const frame = await liveFrame().catch(() => framesRef.current[0] ?? null);
    const { next } = await thought(step.name, async () => {
      const r = await replanStep(askFor('planner'), frame, step, why, patternsRef.current);
      return { next: r?.step ?? null, thinking: r?.thinking ?? null };
    }, (r) => (r.next ? `Re-planned "${step.name}": ${r.next.action} "${r.next.target ?? r.next.name}" at ${at(r.next.x, r.next.y)}` : `Re-plan: "${step.target ?? step.name}" is not visible`));
    return next;
  };

  /**
   * One attempt of the ladder: logged with its verify result and corrected coordinates, and shown
   * on the step's timeline once the ladder is climbed (a first-try success is not a retry story).
   */
  const noteAttempt = (actor: string, step: WorkflowStep, a: Attempt) => {
    const text = describeAttempt(a, settingsRef.current.stepRetries);
    addLog(actor, `"${step.name}": ${text}`, a.ok ? 'ok' : 'warn');
    if (a.n > 1 || !a.ok) note({ step: step.name, kind: 'attempt', text, thinking: null });
  };

  /**
   * A step that failed after its retries and re-plan teaches its habit an advisory avoid lesson and
   * strikes its structured blacklist rule (action + target + point; it blocks only on repeated fresh failures).
   */
  const learnFailure = (step: WorkflowStep, attempts: Attempt[]) => {
    if (!stageOn('coords')) return;
    const lesson = avoidPattern(step, attempts);
    commitHabits(recordOutcome(habitsRef.current, { target: habitTarget(step), context: habitContext(), success: false, avoid: lesson }));
    const last = attempts[attempts.length - 1];
    // Scoped to where the last attempt aimed, so a re-grounded point elsewhere is not blocked.
    const aimed = last ? { ...step, x: last.at.x, y: last.at.y, correctedX: undefined, correctedY: undefined } : step;
    strikeAvoid(aimed, last?.message ?? lesson, 'habit');
  };

  /**
   * performIdentified through the per-step retry ladder: on failure the target is re-verified on
   * a fresh live frame and re-corrected (drift, grounding) by the same pipeline and retried
   * (Settings: retries per failed step), then the planner re-plans it once. Every attempt goes
   * through the run's guardrails and spends budget like any action.
   */
  const performWithRetries = async (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean): Promise<Performed> => {
    const { out, attempts, exhausted } = await runLadder(step, {
      retries: settingsRef.current.stepRetries ?? DEFAULT_STEP_RETRIES,
      run: (s) => performIdentified(s, actor, budget, dryRun),
      stopped: ladderStopped,
      replan: (s, why) => rerouteFailed(actor, s, why),
      onAttempt: (s, a) => noteAttempt(actor, s, a),
      log: (m, tone) => addLog(actor, m, tone),
    });
    const replanned = attempts.some((a) => a.kind === 'replan');
    tracer.emit({ kind: 'retries', count: attempts.length - 1 });
    if (!exhausted) return { ...out, replanned };
    addLog(actor, `"${step.name}": failed after ${attempts.length} attempt(s) — marked failed, avoid pattern recorded`, 'error');
    learnFailure(step, attempts);
    return { ...out, replanned, message: `${out.message} (failed after ${attempts.length} attempt(s))` };
  };

  /** Whether the element identifier may send a request now. */
  const identifierReady = () => stageOn('identify') && aiOnline() && !abortedRef.current;

  /** A live frame to verify against: a fresh desktop screenshot via the bridge, else the latest monitor frame. */
  const liveFrame = async (): Promise<Frame | null> => {
    const { bridgeUrl, bridgeToken } = settingsRef.current;
    if (sourceRef.current === 'bridge' && bridgeUrl) return desktopFrame(bridgeUrl, bridgeToken, ++frameId.current);
    return framesRef.current[0] ?? null;
  };

  /** Recent log lines and this operation's notes, newest first; with `since`, only those after it. */
  const recentInfo = (since = 0) => [
    ...logRef.current.filter((l) => l.time > since).slice(0, 8).map((l) => `[${l.source}] ${l.message}`),
    ...recallNotes(watcherRef.current.notes, { op: goalRef.current.trim() }).filter((n) => n.time > since).slice(0, 5).map((n) => `[note: ${n.kind}] ${n.text}`),
  ];

  /** Wake and continue: the backup-watched wait, the wake decision and parallel context workflows. */
  const wake = useWake({
    settings: () => settingsRef.current,
    frames: () => framesRef.current,
    info: recentInfo,
    errorSince: (since) => logRef.current.find((l) => l.tone === 'error' && l.time > since),
    capture: liveFrame,
    askFor,
    stageOn,
    thought,
    addLog,
    takeNote,
    handlers: () => wakeHandlers,
    runMove: (step) => performStep(step, 'Context workflow', autoBudgetRef.current, !armedRef.current),
    goal,
    aborted,
    isAborted: () => abortedRef.current,
  });
  /** Each escalation attempt goes to the thinking timeline and the activity log. */
  const noteEscalation = (e: EscalationEvent) => {
    note({ step: `Escalation: ${STAGE_LABEL[e.stage]}`, kind: 'attempt', text: e.detail, thinking: e.thinking });
    addLog('AI escalation', e.detail, e.ok ? 'ok' : 'warn');
  };

  /** More app material for the app-context re-ask: a fresh screenshot, goal/steps, mapped elements, the log and habits. */
  const appContext = async () => {
    const frame = await liveFrame().catch(() => null);
    const sections = appContextSections({
      goal: goalRef.current,
      steps: stepsRef.current.map((s, i) => `${i + 1}. ${s.action} "${s.target ?? s.name}" [${s.status}]`),
      elements: mapContext(elementMapRef.current),
      log: logRef.current.slice(0, 12).map((l) => `[${l.source}] ${l.message}`),
      habits: relevantHabits(goalRef.current, habitContext(), habitsRef.current).map(habitLine),
    });
    return { sections, frame: frame?.url ?? null };
  };
  escalationRef.current = { appContext, onStage: noteEscalation };

  /**
   * The agent test of a proposal: a dry-run move to the proposed point, verified against the
   * live frame by drift/template matching (template = the frame the AI saw). With the bridge it
   * runs through the gated pipeline (real move only when `dryRun` is false: armed, not aborted,
   * within budget); otherwise it is verify-only against the latest captured frame.
   */
  const agentTest = async (input: IdentifyInput, id: Extract<Identification, { found: true }>, budget: ActionBudget, dryRun: boolean): Promise<AgentCheck & { live?: Frame }> => {
    const move: WorkflowStep = { id: uid('agent'), name: `Agent test "${id.name}"`, action: 'move', target: id.name, x: id.x, y: id.y, refFrame: input.frame, status: 'pending' };
    const plan = stepPlan(sourceRef.current, { dryRun, bridgeUrl: settingsRef.current.bridgeUrl });
    if (plan && (!plan.needsBridge || settingsRef.current.bridgeUrl)) {
      const out = await performStep(move, 'Element identifier', budget, dryRun);
      if (!out.ok) return { ok: false, message: out.message };
      return { ok: true, x: out.target.x, y: out.target.y, message: `${dryRun ? 'dry-run move' : 'move'} verified at ${gridRef(out.target)} — ${out.message}`, live: out.shot ?? framesRef.current[0] };
    }
    const live = await liveFrame();
    if (!live) return { ok: false, message: 'no live frame to verify against' };
    const c = correctDrift(input.frame.data, live.data, id.x, id.y, live.srcW, live.srcH);
    aim(id);
    aim(c);
    if (c.level === 'red') return { ok: false, message: `no template match on the live frame (best ${c.matchDistance.toFixed(3)})` };
    await animator().idle();
    return { ok: true, x: c.x, y: c.y, message: `dry-run move verified on the live frame at ${gridRef(c)} (drift ${c.driftPx}px, match ${c.matchDistance.toFixed(3)})`, live };
  };

  /**
   * Sends the AI an identification request for `box` (crop, size, colour stats, text, boundary,
   * distances to mapped elements and grid cells) and agent-tests each proposal: at most 3 tries
   * within 30 s. With `moveDry` set, the verified point is moved to at once through performStep
   * (a dry run when `moveDry` is true). A verified element is remembered as familiar; a miss is logged plainly.
   */
  const identifyElement = async (reason: IdentifyReason, box: Box, text: string | undefined, budget: ActionBudget, dryRun: boolean, moveDry?: boolean): Promise<(IdentifyOutcome & { live?: Frame }) | null> => {
    const frame = framesRef.current[0];
    if (!frame) return null;
    const label = text ?? `region at ${gridRef(boxCenter(box))}`;
    const input: IdentifyInput = { reason, box, frame, crop: await cropFrame(frame, box).catch(() => frame), text, mapped: elementMapRef.current };
    const log = (m: string, tone: LogEntry['tone']) => addLog('Element identifier', `"${label}": ${m}`, tone);
    log(`sending an identification request to the AI (${reason.replace('_', ' ')})`, 'info');
    let live: Frame | undefined;
    const move = moveDry === undefined ? undefined : (p: { name: string; x: number; y: number }) =>
      performStep({ id: uid('move'), name: `Move to "${p.name}"`, action: 'move', target: p.name, x: p.x, y: p.y, refFrame: live ?? frame, status: 'pending' }, 'Element identifier', budget, moveDry);
    const outcome = await identifyAndVerify({
      identify: (feedback) => thought(`Identify: ${label}`, async () => parseIdentification(await askFor('identify')(identifyRequest(input, feedback)), label), (r) => (r.found ? `Identified "${r.name}" at ${gridRef(r)} (confidence ${r.confidence.toFixed(2)})${r.reason ? ` — ${r.reason}` : ''}` : `Not identified — ${r.reason || 'no reason given'}`)),
      verify: async (id) => {
        const check = await agentTest(input, id, budget, dryRun);
        live = check.live;
        return check;
      },
      move,
      aborted: () => abortedRef.current,
      log,
    });
    if (outcome.verified) {
      setFamiliar((list) => rememberElement(list, { id: uid('el'), name: outcome.name, x: outcome.x, y: outcome.y, lastSeen: Date.now() }));
      void replicateRegion(box, outcome.name, 'Element identifier', false);
    }
    return { ...outcome, live };
  };

  /** The box to describe for a step's target: the mapped element under its point, else a small square around it. */
  const stepBox = (step: WorkflowStep): Box => {
    const p = { x: step.x, y: step.y };
    const mapped = elementMapRef.current.find((e) => p.x >= e.box.x && p.x <= e.box.x + e.box.w && p.y >= e.box.y && p.y <= e.box.y + e.box.h);
    const f = framesRef.current[0];
    return mapped?.box ?? zoomBox(p, f ? f.srcW / f.srcH : 16 / 9, 0.08);
  };

  /**
   * performStep with identification: a pointer step the planner gave no point for is identified
   * first; a pointer step that was not clicked / not accepted is identified and, once verified,
   * re-run at the corrected coordinates. A miss returns the original outcome (the plan continues).
   */
  const performIdentified = async (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean): Promise<Performed> => {
    let run = step;
    if (step.unlocated && POINTER_ACTIONS.has(step.action) && identifierReady()) {
      const found = await identifyElement('not_proposed', stepBox(step), step.target ?? step.name, budget, true);
      if (found?.verified) run = { ...step, x: found.x, y: found.y, unlocated: false, refFrame: found.live ?? step.refFrame };
    }
    const out = await performStep(run, actor, budget, dryRun);
    if (out.ok || out.halt || !POINTER_ACTIONS.has(step.action) || !identifierReady()) return out;
    const reason: IdentifyReason = /not located|not be verified|not found/.test(out.message) ? 'not_accepted' : 'not_clicked';
    const found = await identifyElement(reason, stepBox(run), step.target ?? step.name, budget, true);
    if (!found?.verified) return out;
    addLog(actor, `"${step.name}": continuing at the verified point ${gridRef(found)} (${pct(found.x)}, ${pct(found.y)})`, 'ok');
    return performStep({ ...run, x: found.x, y: found.y, correctedX: undefined, correctedY: undefined, refFrame: found.live ?? run.refFrame }, actor, budget, dryRun);
  };

  /**
   * New or constantly-changing content (same frame-diff clusters as the popup watcher): sent
   * for identification once per region per 30 s. The agent test only moves the real mouse while
   * Auto Act runs armed; otherwise it is a dry run.
   */
  const watchChanges = (prev: Frame, cur: Frame) => {
    const cells = largestCluster(diffCells(prev.data, cur.data));
    const box = cells.length >= 6 ? boundingBox(cells) : null;
    if (!box || !changeInScope(sectionsRef.current, scopeRef.current, box)) return;
    const now = Date.now();
    const noted = noteChange(changeHitsRef.current, box, now);
    changeHitsRef.current = noted.hits;
    if (noted.kind === 'repeat' || identifyBusyRef.current || !identifierReady() || recentlySent(identifySentRef.current, box, now)) return;
    identifySentRef.current = [{ box, time: now }, ...identifySentRef.current].slice(0, 20);
    identifyBusyRef.current = true;
    const dry = !(armedRef.current && settingsRef.current.autoAct);
    void identifyElement(noted.kind === 'new' ? 'new_element' : 'changing_element', box, undefined, autoBudgetRef.current, dry).finally(() => {
      identifyBusyRef.current = false;
    });
  };

  /** The radar's tracked element and its budget; null when no suggested element is being tracked. */
  const radarRef = useRef<{ state: RadarState; budget: ActionBudget; busy: boolean } | null>(null);

  /** Starts the radar on a suggested / user-pointed element, replacing any earlier target. */
  const startTracking = (target: RadarTarget) => {
    radarRef.current = { state: startRadar(target), budget: createBudget(settingsRef.current.actionBudget), busy: false };
    addLog('Radar', `tracking "${target.name}" at ${gridRef(target)} until it stops, then ${target.action}`, 'info');
  };

  /** The radar status of one event goes to the thinking timeline, built from the AI's recent responses. */
  const noteRadar = (target: RadarTarget, event: RadarEvent) => {
    const recent = timelineRef.current.filter((e) => !e.step.startsWith('Radar')).slice(0, 5).map((e) => e.error ?? e.text).filter(Boolean);
    note({ step: `Radar: ${target.name}`, kind: 'movement', text: radarStatusText(radarStatus(target, event, recent)), thinking: null });
  };

  /** The radar event's movement: attract takes one slow step, settle the adjusted move and then the action. */
  const radarMove = async (target: RadarTarget, event: RadarEvent, budget: ActionBudget) => {
    if (event.kind !== 'attract' && event.kind !== 'settle') return;
    const dry = !armedRef.current;
    const at = { x: event.to.x, y: event.to.y };
    const move = await performStep({ id: uid('radar'), name: `Radar ${event.kind} "${target.name}"`, action: 'move', target: target.name, ...at, status: 'pending' }, 'Radar', budget, dry);
    if (event.kind !== 'settle' || !move.ok || target.action === 'move') return;
    const act = await performStep({ id: uid('radar'), name: `${target.action} "${target.name}"`, action: target.action, target: target.name, ...at, status: 'pending' }, 'Radar', budget, dry);
    addLog('Radar', `${target.action} on "${target.name}": ${act.message}`, act.ok ? 'ok' : 'warn');
  };

  /**
   * One radar tick per capture: re-finds the tracked element on the new frame (template match
   * from the previous frame), measures cursor/target distance and acts on the event. Runs only
   * while armed; stops on disarm, an abort, the identify stage unchecked in Loop control, once settled or expired.
   */
  const radarFrame = (prev: Frame, cur: Frame) => {
    const r = radarRef.current;
    if (!r || r.busy) return;
    if (abortedRef.current || !armedRef.current || !stageOn('identify')) {
      radarRef.current = null;
      return;
    }
    const t = r.state.target;
    const c = correctDrift(prev.data, cur.data, t.x, t.y, cur.srcW, cur.srcH);
    const seen = c.level === 'red' ? { x: t.x, y: t.y } : { x: c.x, y: c.y };
    const tick = radarTick(r.state, lastPointerRef.current ?? seen, seen, cur.srcW, cur.srcH);
    r.state = tick.state;
    noteRadar(tick.state.target, tick.event);
    if (tick.event.kind === 'settle' || tick.event.kind === 'expired') radarRef.current = null;
    r.busy = true;
    void radarMove(tick.state.target, tick.event, r.budget).finally(() => {
      r.busy = false;
    });
  };

  /** Element map: the user's drawn boxes, persisted and fed into the familiar-elements memory. */
  const setMap = (next: MappedElement[]) => {
    elementMapRef.current = next;
    setElementMap(next);
  };

  const toggleMapMode = () => {
    setMapMode((m) => !m);
    setMapDraft(null);
  };

  /** Names the drawn box and maps it on the current frame; also remembered as a familiar element. */
  const saveMapped = async (name: string) => {
    if (!mapDraft || !name.trim()) return;
    setMapDraft(null);
    await mapBox(name, mapDraft);
  };

  /** Maps `box` as `name` on the current frame and remembers it as a familiar element. */
  const mapBox = async (name: string, box: Box) => {
    const frame = framesRef.current[0];
    const el: MappedElement = { id: uid('map'), name: name.trim(), box, mappedAt: Date.now(), ...(frame ? { frame } : {}) };
    setMap(mapElement(elementMapRef.current, el));
    const patch = frame ? await patchAt(frame, boxCenter(el.box)).catch(() => undefined) : undefined;
    setFamiliar((list) => rememberElement(list, toFamiliar(el, Date.now(), patch)));
    addLog('Element map', `Mapped "${el.name}" at ${gridRef(boxCenter(el.box))} (${pct(el.box.w)} x ${pct(el.box.h)} of the screen)`, 'ok');
    recordOp('Element map', 'elementMap', elementDraft('map', el.name, `box ${pct(el.box.x)}, ${pct(el.box.y)} ${pct(el.box.w)} x ${pct(el.box.h)}`, `mapped at ${gridRef(boxCenter(el.box))}`));
  };

  const deleteMapped = (id: string) => {
    const el = elementMapRef.current.find((m) => m.id === id);
    setMap(unmapElement(elementMapRef.current, id));
    if (el) recordOp('Element map', 'elementMap', elementDraft('unmap', el.name, `id ${id}`, 'unmapped'));
  };

  /**
   * Auto-scan: every identifiable element on `frame` (default: the latest) is merged into the map —
   * seen again, moved (old position kept as a ghost, the move blamed on the user, the AI or nobody)
   * or newly mapped. Changes are logged with the frame as evidence.
   */
  const scanNow = (frame: Frame | undefined = framesRef.current[0]) => {
    if (!frame) return addLog('Element map', 'Nothing to scan — no captured frame yet', 'warn');
    const r = mergeScan(elementMapRef.current, scanElements(frame.data), frame.time, actorInputsRef.current, () => uid('auto'));
    setMap(r.map);
    const text = scanSummary(r);
    if (text) addLog('Auto-scan', text, r.moved.length ? 'warn' : 'info', [frame.url]);
  };

  /** Sets (null clears) the perform function of a mapped element, as chosen by the user or the AI. */
  const setElementPerform = (id: string, p: PerformFn | null) => {
    const el = elementMapRef.current.find((e) => e.id === id);
    if (!el) return;
    const next = setPerform(elementMapRef.current, id, p);
    if (next === elementMapRef.current) return addLog('Element map', `Perform for "${el.name}" is incomplete — not set`, 'warn');
    setMap(next);
    addLog('Element map', p ? `"${el.name}" performs ${performText(p, next)} (set by ${p.source === 'ai' ? 'the AI' : 'you'})` : `Cleared the perform of "${el.name}"`, 'ok');
  };

  /** Appends a workflow step "auto-navigate to the element, then perform its function". */
  const addNavigateStep = (id: string) => {
    const el = elementMapRef.current.find((e) => e.id === id);
    if (!el) return;
    const step = navigateStep(el, elementMapRef.current);
    if ('error' in step) return addLog('Workflow', step.error, 'warn');
    stepsRef.current = [...stepsRef.current, step];
    setSteps(stepsRef.current);
    addLog('Workflow', `Added "${step.name}"`, 'ok');
  };

  /** Asks the AI for an element's perform function; a proposal to train it starts training when the trainer agent is on. */
  const proposePerform = async (id: string) => {
    const el = elementMapRef.current.find((e) => e.id === id);
    const frame = framesRef.current[0];
    if (!el || !frame) return addLog('Element map', 'No element or frame to propose a perform for', 'warn');
    if (!aiOnline() || !stageOn('trainer')) return addLog('Element map', `No AI perform for "${el.name}" — ${aiOnline() ? stageOff('trainer') : 'AI offline'}`, 'warn');
    try {
      const crop = await cropFrame(frame, el.box).catch(() => frame);
      const r = await thought(`Perform for "${el.name}"`, async () => parsePerformProposal(await askFor('trainer')(performRequest(el, frame, crop))), (p) => `Proposed ${performText(p.perform)} for "${el.name}"${p.perform.reason ? ` — ${p.perform.reason}` : ''}${p.train ? ' (suggests training)' : ''}`);
      setElementPerform(id, r.perform);
      if (r.train) void trainMapped(id, 'AI');
    } catch (error) {
      addLog('Element map', aiFailure(`AI unavailable — no perform for "${el.name}"`, error), 'error');
    }
  };

  /** The guarded executor, screenshots, AI research and stop signal a training session runs with. */
  const trainingDeps = (budget: ActionBudget, dryRun: boolean): TrainingDeps => ({
    perform: (step) => performStep(step, 'Trainer', budget, dryRun),
    capture: async () => (sourceRef.current === 'demo' ? demoSnapshot() : liveFrame().catch(() => framesRef.current[0] ?? null)),
    research: async (el, frame, related) => {
      if (!aiOnline()) return null;
      const reply = await askFor('trainer')({ system: RESEARCH_SYSTEM, prompt: `${mappedLine(el)}\nIt opened ${related.length} new element(s): ${related.map((d) => d.kind).join(', ') || 'none'}.`, frame });
      return stripThinking(reply.content) || null;
    },
    stopped: () => trainStopRef.current || abortedRef.current,
    progress: setTraining,
  });

  /**
   * Trains a mapped element: an exclusive session that performs it, explores what it opened and
   * researches it, in the foreground (Auto Act pauses, the element is highlighted) or on its own
   * background task per Settings. Disarmed is a dry run; Stop or the emergency abort ends it.
   */
  const trainMapped = async (id: string, by = 'You') => {
    const el = elementMapRef.current.find((e) => e.id === id);
    if (!el) return;
    if (abortedRef.current) return addLog('Trainer', refusedWhileAborted('Training'), 'error');
    if (!stageOn('trainer')) return addLog('Trainer', `Training "${el.name}" refused — ${stageOff('trainer')}`, 'warn');
    if (trainingRef.current) return addLog('Trainer', 'A training session is already running', 'warn');
    const mode = settingsRef.current.trainMode;
    const foreground = mode === 'foreground';
    trainingRef.current = true;
    trainStopRef.current = false;
    if (foreground) {
      subRunningRef.current = true;
      setHighlight({ ...boxCenter(el.box), label: `Training ${el.name}` });
    }
    addLog('Trainer', `Training "${el.name}" in the ${mode} (started by ${by})${armedRef.current ? '' : ' — real input disarmed: dry run'}`, 'info');
    try {
      const report = await trainElement(el, elementMapRef.current, mode, trainingDeps(createBudget(settingsRef.current.actionBudget), !armedRef.current));
      if (report.related.length) setMap(mergeScan(elementMapRef.current, report.related, Date.now(), [], () => uid('auto')).map);
      addLog('Trainer', `Training "${el.name}": ${report.status} — ${report.entries.filter((e) => e.ok).length}/${report.entries.length} action(s) ok, ${report.related.length} related element(s)${report.research ? ` · ${report.research}` : ''}`, report.status === 'pass' ? 'ok' : 'warn', report.entries.flatMap((e) => (e.shot ? [e.shot.url] : [])));
    } finally {
      trainingRef.current = false;
      if (foreground) {
        subRunningRef.current = false;
        setHighlight(null);
      }
    }
  };

  /**
   * The image a snip of `displayId` is cut from: the live frame for the captured display (or none
   * named), else a native full-resolution grab of that display (desktop app only).
   */
  const snipSource = async (displayId: string | null): Promise<SnipSource | null> => {
    if (displayId === null || displayId === settingsRef.current.displayId) return framesRef.current[0] ?? null;
    if (!window.droidNative) throw new Error(`display ${displayId} can only be snipped in the desktop app`);
    return { ...(await window.droidNative.grabDisplay(displayId)), source: 'screen' };
  };

  /**
   * Programmatic snip for the AI and agents: a crop of any region of the live screen (or of any
   * display) at any size, kept in the snip gallery and shown on the thinking timeline. Null when
   * there is nothing to snip; a failure is logged, never thrown.
   */
  const snip = async (region: Box, opts: { size?: Partial<SnipSize>; displayId?: string | null; by?: SnipBy; label?: string } = {}): Promise<Snip | null> => {
    const { size = {}, displayId = null, by = 'ai', label = 'AI snip' } = opts;
    const box = clampBox(region);
    try {
      const src = box && (await snipSource(displayId));
      if (!box || !src) {
        addLog('Snip', `${label}: ${box ? 'no live screen to snip' : 'the region is outside the screen'}`, 'warn');
        return null;
      }
      const s: Snip = { id: uid('snip'), time: Date.now(), box, frame: await snipFrame(src, box, ++frameId.current, size), by, label, displayId };
      setSnips((list) => addSnip(list, s));
      note({ step: label, kind: 'snip', text: snipText(s), thinking: null, frame: s.frame });
      addLog('Snip', snipText(s), 'ok');
      return s;
    } catch (error) {
      addLog('Snip', `${label} failed — ${errorText(error)}`, 'error');
      return null;
    }
  };

  const toggleSnipMode = () => setSnipMode((m) => !m);

  /** The user's dragged region (null when too small) is snipped into the gallery. */
  const userSnip = async (box: Box | null) => {
    setSnipMode(false);
    if (box) await snip(box, { by: 'user', label: 'User snip' });
  };

  /** Saves a snip of the captured display to the element map as `name`. */
  const snipToMap = (id: string, name: string) => {
    const s = snips.find((x) => x.id === id);
    if (s && !s.displayId && name.trim()) void mapBox(name, s.box);
  };

  /** /snip x,y,w,h [WxH] [display <id>]: snips that region. */
  const snipCommand = async (args: string) => {
    const req = parseSnipArgs(args);
    if ('error' in req) {
      addLog('/snip', req.error, 'warn');
      return;
    }
    await snip(req.box, { size: req.size, displayId: req.displayId, label: '/snip' });
  };

  /**
   * Where the element map puts `name`: the live layout on the demo desktop (sidebar icons, the
   * Report file), else a familiar element seen at or after `since` (an older entry predates the drag being checked).
   */
  const mapAt = (name: string, since = 0): { x: number; y: number } | null => {
    if (sourceRef.current === 'demo') {
      const world = activeWorld();
      const el = world ? findWorldElement(world, name) : null;
      if (el) return { x: el.x, y: el.y };
      const icon = world ? null : findIcon(demoIconsRef.current, name);
      if (icon) return { x: icon.x, y: icon.y };
      const quest = activeQuest();
      const part = quest ? findQuestElement(quest, name) : null;
      if (part) return { x: part.x, y: part.y };
      if (!world && /\breport\b/i.test(name)) return demoFileAt(demoFileRef.current);
    }
    const el = familiarRef.current.find((f) => sameElement(f.name, name) && (f.lastSeen ?? 0) >= since);
    return el ? { x: el.x, y: el.y } : null;
  };

  /** The element a performed drag was meant to move: grabbed at its start, intended at its drop point. */
  const movedBy = (step: WorkflowStep, out: Performed): MovedElement => ({ name: step.target ?? out.grabbed ?? step.name, from: out.target, to: out.end ?? { x: step.endX ?? out.target.x, y: step.endY ?? out.target.y }, before: out.live ?? null });

  /** The move check after a drag, on the post-drag frame plus the element map; recorded as a 'check' entry. */
  const checkDrag = (step: WorkflowStep, moved: MovedElement, out: Performed, since: number) => {
    const r = checkMoved(moved, out.shot ?? null, mapAt(moved.name, since));
    note({ step: step.name, kind: 'check', text: `${r.moved ? 'PASS' : 'FAIL'} — "${moved.name}" ${r.moved ? 'is at' : 'is not at'} the drop point ${at(moved.to.x, moved.to.y)}: ${r.detail}`, thinking: null });
    return r;
  };

  /**
   * The one retry of a drag that missed: re-planned by the AI on the post-drag frame, or, with the
   * AI offline, the same drop regrabbing the element where it was sighted. Null: the AI no longer sees it.
   */
  const retryDrag = async (step: WorkflowStep, feedback: string, frame: Frame | null, sighted: { x: number; y: number } | null): Promise<WorkflowStep | null> => {
    if (!aiOnline()) return sighted ? { ...step, x: sighted.x, y: sighted.y, refFrame: undefined } : step;
    const { next } = await thought(step.name, async () => {
      const r = await replanDrag(askFor('planner'), frame, step, feedback);
      return { next: r?.step ?? null, thinking: r?.thinking ?? null };
    }, (r) => (r.next ? `Re-planned the drag: ${at(r.next.x, r.next.y)} → ${at(r.next.endX ?? r.next.x, r.next.endY ?? r.next.y)}` : `Re-plan: "${step.target ?? step.name}" is not visible`));
    return next;
  };

  /** A drag that did not land after its retry: failed, with why. */
  const missed = (out: Performed, moved: MovedElement, why: string): Performed => ({ ...out, ok: false, executed: false, moved, message: `${out.message} — but "${moved.name}" did not land at ${at(moved.to.x, moved.to.y)}: ${why}` });

  /**
   * A drag through the gated pipeline, then the move check on the live frame. A miss is
   * re-planned (or retried) once through the same pipeline, spending budget; a second miss fails.
   * The retry ladder runs only on the first attempt and its one re-plan is the step's only one:
   * a drag the ladder already re-planned is not re-planned again.
   */
  const performDrag = async (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean, proposal: Proposal | null): Promise<Performed & { verdict?: StepVerdict | null }> => {
    let current = step;
    planMove(step);
    for (let attempt = 1; ; attempt++) {
      const since = Date.now();
      const out = await perform(current, actor, budget, dryRun, proposal, attempt === 1);
      if (!out.executed) return out;
      const moved = movedBy(current, out);
      const check = checkDrag(current, moved, out, since);
      if (check.moved) {
        void rememberAt(moved.name, check.at ?? moved.to, out.shot);
        learnAiMove(moved.name, check.at ?? moved.to);
        return { ...out, moved };
      }
      if (out.replanned) return missed(out, moved, `${check.detail} (already re-planned once by the retry ladder)`);
      if (attempt === 2 || abortRef.current) return missed(out, moved, `${check.detail}${attempt === 2 ? ' (failed after one retry)' : ' (stopped, no retry)'}`);
      addLog(actor, `"${moved.name}" did not land at its drop point (${check.detail}) — retrying once`, 'warn');
      try {
        const next = await retryDrag(current, check.detail, out.shot ?? framesRef.current[0] ?? null, check.at);
        if (!next) return missed(out, moved, 'the re-plan no longer sees the element');
        current = next;
      } catch (error) {
        return missed(out, moved, `re-plan failed (AI unavailable: ${errorText(error)})`);
      }
    }
  };

  /** Runs a step: a drag with its move check and retry, anything else as is. */
  const execute = (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean, proposal: Proposal | null): Promise<Performed & { verdict?: StepVerdict | null }> => (step.action === 'drag' ? performDrag : perform)(step, actor, budget, dryRun, proposal);

  /** A fresh frame for the final verification pass: the demo canvas, the source's own latest frame or a bridge screenshot (null with the reason logged). */
  const finalFrame = async (label: string): Promise<Frame | null> => {
    if (sourceRef.current === 'demo') return demoSnapshot();
    try {
      const frame = await liveFrame();
      if (!frame) throw new Error(`no frame captured yet from the ${captureLabel(sourceRef.current, captureRef.current?.kind)}`);
      return frame;
    } catch (error) {
      addLog(label, `Verification has no final screenshot: ${errorText(error)}`, 'error');
      return null;
    }
  };

  /**
   * The verification pass after a rearrangement: every moved element is re-detected on a fresh
   * frame and the requested arrangement checked, one PASS/FAIL log entry (before/after screenshots)
   * and one 'check' entry per element.
   */
  /** The verification pass; resolves whether every element passed. */
  const verifyRearrangement = async (moved: MovedElement[], label: string): Promise<boolean> => {
    const final = await finalFrame(label);
    const verdicts = verifyArrangement(moved, expectRef.current, final, (name) => mapAt(name));
    for (const v of verdicts) {
      const text = `${v.pass ? 'PASS' : 'FAIL'} "${v.element}" — ${v.detail}`;
      addLog('Verify', text, v.pass ? 'ok' : 'error', [v.before?.url, final?.url].filter((u): u is string => !!u));
      note({ step: `Verify "${v.element}"`, kind: 'check', text, thinking: null });
    }
    const passed = verdicts.filter((v) => v.pass).length;
    const confirmed = passed === verdicts.length;
    addLog('Verify', `Arrangement ${confirmed ? 'confirmed' : 'NOT confirmed'}: ${passed}/${verdicts.length} element(s) pass`, confirmed ? 'ok' : 'error');
    return confirmed;
  };

  /**
   * Test click: highlights the element on the preview; while armed, clicks its exact point
   * through the same gated pipeline (abort, arm, a fresh one-click budget). Disarmed is a dry run.
   */
  const testClick = async (el: ScreenElement) => {
    setHighlight({ x: el.x, y: el.y, label: el.name });
    setTimeout(() => setHighlight((h) => (h && h.x === el.x && h.y === el.y ? null : h)), 3000);
    const where = `${gridRef(el)} (${pct(el.x)}, ${pct(el.y)})`;
    if (!armedRef.current) {
      addLog('Test click', `"${el.name}" highlighted at ${where} — real input disarmed, ${DRY_RUN}`, 'info');
      return;
    }
    // Guardrails first: an aborted engine reports the abort from performStep, never the stage.
    if (!abortedRef.current && !stageOn('subagents')) {
      addLog('Test click', `"${el.name}" highlighted at ${where} — ${stageOff('subagents')}, nothing sent`, 'warn');
      return;
    }
    const step: WorkflowStep = { id: uid('test'), name: `Test click "${el.name}"`, action: 'click', x: el.x, y: el.y, status: 'pending' };
    const before = framesRef.current[0] ?? null;
    const out = await performStep(step, 'Test click', createBudget(settingsRef.current.actionBudget), false);
    learnFromOutcome({ ...step, target: el.name }, out, before);
    if (out.executed) void rememberTarget({ ...step, target: el.name }, out);
    addLog('Test click', `"${el.name}" at ${where}: ${out.message}`, out.ok ? 'ok' : 'error');
  };

  /**
   * Test-runs a saved access path as the Path tester agent through the same gated pipeline as
   * Test click (abort, arm, subagents stage, a fresh budget); disarmed it is a dry run. A real
   * test-run counts toward the path and its target's habit.
   */
  const testAccessPath = async (id: string) => {
    const profile = accessPathsRef.current.find((p) => p.id === id);
    if (!profile) return;
    const actor = 'Path tester';
    const dryRun = !armedRef.current;
    if (!dryRun && !abortedRef.current && !stageOn('subagents')) {
      addLog(actor, `"${profile.target}" — ${stageOff('subagents')}, nothing sent`, 'warn');
      return;
    }
    const budget = createBudget(settingsRef.current.actionBudget);
    const run = await runPath(pathSteps(profile, []), (s) => performStep(s, actor, budget, dryRun));
    const ok = run.ok && !!run.last;
    addLog(actor, `"${profile.target}" path v${currentPath(profile).version}: ${ok ? 'reached' : `failed at hop ${(run.failedHop ?? 0) + 1}`} — ${run.last?.message ?? 'no hop ran'}`, ok ? 'ok' : 'error');
    if (dryRun || run.last?.halt) return;
    countPath(profile, { via: 'path', out: run.last!, failedHop: run.failedHop });
  };

  /**
   * Mirror input: one gesture on the preview (by the user or the AI) as real input through
   * performStep — armed it dispatches to the PC through the bridge, disarmed it is a labeled dry run;
   * abort, the executor stage and the budget refuse it. Never a simulated success.
   */
  const mirrorInput = async (ev: MirrorEvent, actor = 'Mirror', budget = mirrorBudgetRef.current): Promise<Performed> => {
    const step = mirrorStep(ev, uid('mirror'));
    // Same condition as the mirror badge: LIVE only when armed with a connected bridge, otherwise a labeled dry run.
    const dryRun = !armedRef.current || !mirrorBridgeRef.current;
    const out = await performStep(step, actor, budget, dryRun);
    const message = dryRun && !out.message.includes(DRY_RUN) ? `${out.message} — ${DRY_RUN}` : out.message;
    addLog(actor, `${dryRun ? 'DRY RUN · ' : ''}${step.name}: ${message}`, out.ok ? (dryRun ? 'info' : 'ok') : 'error');
    return out;
  };
  /** The current mirrorInput, for the stable stage callbacks. */
  const mirrorRef = useRef(mirrorInput);
  mirrorRef.current = mirrorInput;

  /** Switches the preview between passive and interactive; each switch-on is a new session with a fresh budget. Refused while aborted. */
  const toggleMirror = () => {
    const next = !mirrorOnRef.current;
    if (next && abortedRef.current) {
      addLog('Mirror', `Aborted — mirror input stays off; ${ABORT_HINT}`, 'warn');
      return;
    }
    mirrorOnRef.current = next;
    setMirrorOn(next);
    if (next) mirrorBudgetRef.current = createBudget(settingsRef.current.actionBudget);
    const how = armedRef.current ? 'clicks, drags, scrolls and keys on the preview go to the PC' : `real input disarmed, every input is a ${DRY_RUN}`;
    addLog('Mirror', next ? `Mirror input ON — ${how}` : 'Mirror input OFF — passive preview', next ? 'warn' : 'ok');
  };

  /** A wheel event on the interactive mirror: one scroll per same-direction burst (refs only, so stable across renders). */
  const mirrorScroll = (x: number, y: number, deltaY: number) => {
    const now = Date.now();
    const dir = deltaY < 0 ? 'up' : 'down';
    const last = mirrorScrollRef.current;
    mirrorScrollRef.current = { dir, at: now };
    if (last && last.dir === dir && now - last.at < SCROLL_MERGE_MS) return;
    void mirrorRef.current({ kind: 'scroll', x, y, deltaY });
  };

  const [personas, setPersonas] = useState<Persona[]>(loadPersonas);
  const personasRef = useRef(personas);
  const [personaId, setPersonaId] = useState<string | null>(null);
  const personaIdRef = useRef<string | null>(null);
  /** The element-relevance log, the current perspective and its parallel lanes. */
  const [sightings, setSightings] = useState<Sighting[]>([]);
  const [playView, setPlayView] = useState<Perspective>(() => perspective([], 0));
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [playing, setPlaying] = useState(false);
  const playRef = useRef({ turn: 0, sightings: [] as Sighting[], view: perspective([], 0), lanes: [] as Lane[], budget: createBudget(settings.actionBudget) });

  /** Replaces the personas in state and storage. */
  const commitPersonas = (next: Persona[]) => {
    personasRef.current = next;
    setPersonas(next);
    savePersonas(next);
  };

  /** Plays as persona `id` (null for none): a fresh play session with an empty element log and a fresh budget. */
  const selectPersona = (id: string | null) => {
    personaIdRef.current = id;
    setPersonaId(id);
    playRef.current = { turn: 0, sightings: [], view: perspective([], 0), lanes: [], budget: createBudget(settingsRef.current.actionBudget) };
    setSightings([]);
    setPlayView(playRef.current.view);
    setLanes([]);
  };

  /** Creates and selects a persona; a blank name is refused in the log. */
  const addPersona = (name: string, character: string) => {
    const p = createPersona(uid('persona'), name, character);
    if (!p) {
      addLog('Persona', 'A persona needs a name', 'warn');
      return;
    }
    commitPersonas(upsertPersona(personasRef.current, p));
    selectPersona(p.id);
    addLog('Persona', `Created persona "${p.name}"`, 'ok');
  };

  const deletePersona = (id: string) => {
    commitPersonas(personasRef.current.filter((p) => p.id !== id));
    if (personaIdRef.current === id) selectPersona(null);
  };

  /** Adds one portfolio entry to persona `id` and persists it. */
  const notePortfolio = (id: string, kind: PortfolioKind, text: string) => {
    const p = personasRef.current.find((x) => x.id === id);
    if (p) commitPersonas(upsertPersona(personasRef.current, addPortfolioEntry(p, kind, text)));
  };

  /** Cross-references a turn's element reports into the log, perspective and lanes; the side agents report changes. */
  const crossReferenceTurn = (reports: ElementReport[]) => {
    const s = playRef.current;
    const turn = s.turn + 1;
    const next = logSightings(s.sightings, reports, turn);
    const view = perspective(next, turn);
    const changes = monitorChanges(s.lanes, next, turn);
    playRef.current = { ...s, turn, sightings: next, view, lanes: planLanes(view) };
    setSightings(next);
    setPlayView(view);
    setLanes(playRef.current.lanes);
    addLog('Perspective', `Turn ${turn}: ${view.summary}`);
    changes.forEach((c) => addLog('Side agent', c.detail, 'warn'));
    return view;
  };

  /**
   * One AI play turn as the selected persona: the model sees the latest captured frame (recaptured
   * after the previous act lane), logs the important elements with position and relevance, and takes
   * one action through the mirror. The outcome goes to the persona's portfolio. Null when refused.
   */
  const playTurn = async (): Promise<Performed | null> => {
    const persona = personasRef.current.find((p) => p.id === personaIdRef.current);
    if (!persona) {
      addLog('AI play', 'Select or create a persona before AI play', 'warn');
      return null;
    }
    if (abortedRef.current) {
      addLog('AI play', refusedWhileAborted('AI play'), 'error');
      return null;
    }
    let reply: PlayTurn;
    try {
      reply = await askPlayTurn(askFor('executor'), persona, playRef.current.view, goalRef.current, framesRef.current[0] ?? null);
    } catch (error) {
      reportParseFailure(`Play turn as ${persona.name}`, error);
      addLog('AI play', aiFailure('AI unavailable — no play turn', error), 'error');
      return null;
    }
    const view = crossReferenceTurn(reply.elements);
    note({ step: `Play turn ${view.turn} · ${persona.name}`, kind: 'thought', text: view.summary, thinking: reply.thinking });
    const out = reply.action ? await mirrorInput(reply.action, `AI play · ${persona.name}`, playRef.current.budget) : null;
    const did = reply.did || (reply.action ? mirrorStep(reply.action, 'x').name : 'Waited');
    notePortfolio(persona.id, 'did', out ? `${did} — ${out.ok ? '' : 'FAILED: '}${out.message}` : did);
    notePortfolio(persona.id, 'learned', reply.learned);
    if (!out || out.ok) notePortfolio(persona.id, 'achieved', reply.achieved);
    return out ?? { ok: true, executed: false, message: 'Waited', target: { x: 0.5, y: 0.5 } };
  };

  /** Plays up to `turns` turns; stops at abort, a refused or halted turn. */
  const playTurns = async (turns: number) => {
    setPlaying(true);
    try {
      for (let i = 0; i < turns && !abortedRef.current; i++) {
        const out = await playTurn();
        if (!out || out.halt) break;
      }
    } finally {
      setPlaying(false);
    }
  };

  const elements = listElements(steps, annotations, familiar);
  /** The newest real action and how it reverses; null when there is none or the newest is itself a reversal. */
  const reverse = reverseOffer(history);

  /**
   * Reverses the most recent real action: its inverse steps run through performStep (abort,
   * executor stage, arm and a fresh budget), as a dry run unless armed. Before and after
   * screenshots go into the log; a non-invertible action is reported as "cannot reverse".
   */
  const reverseLast = async () => {
    const offer = reverseOffer(history);
    if (!offer) return addLog(REVERSE_ACTOR, 'Nothing to reverse — no real action since the last reversal', 'warn');
    const { record, reversal } = offer;
    if (!reversal.ok) return addLog(REVERSE_ACTOR, `Cannot reverse ${record.action} at (${record.x}, ${record.y})px — ${reversal.reason}`, 'warn');
    const via: ActionRecord['via'] = sourceRef.current === 'demo' || sourceRef.current === 'main-app' ? sourceRef.current : 'bridge';
    if (record.via !== via) return addLog(REVERSE_ACTOR, `Cannot reverse — the ${record.action} ran on the ${VIA_LABEL[record.via]}, which is not the current screen source`, 'error');
    const dryRun = !armedRef.current;
    setReversing(true);
    try {
      const before = await finalFrame(REVERSE_ACTOR);
      const budget = createBudget(settingsRef.current.actionBudget);
      const results: string[] = [];
      let ok = true;
      for (const step of reversal.steps) {
        const out = await performStep(step, REVERSE_ACTOR, budget, dryRun);
        results.push(out.message);
        ok = out.ok;
        if (!out.ok) break;
      }
      const after = await finalFrame(REVERSE_ACTOR);
      const mode = dryRun ? 'dry run (real input disarmed), nothing sent' : ok ? 'reversed' : 'reversal failed';
      const shots = [before?.url, after?.url].filter((u): u is string => !!u);
      addLog(REVERSE_ACTOR, `${mode}: ${record.action} at (${record.x}, ${record.y})px — ${reversal.summary} — ${results.join('; ')}`, ok ? (dryRun ? 'info' : 'ok') : 'error', shots);
    } finally {
      setReversing(false);
    }
  };
  /** Targets the coordinate learner has observed, newest first. */
  const learned = learnedTargets(familiar);

  const updateStep = (index: number, patch: Partial<WorkflowStep>) => {
    if (patch.status && patch.status !== stepsRef.current[index]?.status) statusChangesRef.current++;
    const rerun = patch.status === 'running' ? { verifiedAt: undefined } : {};
    stepsRef.current = stepsRef.current.map((st, i) => (i === index ? { ...st, ...rerun, ...patch } : st));
    setSteps(stepsRef.current);
  };

  /** Workflow checkoff: "workflow complete" when the verified step checks off the last one, a red report when a step failed. */
  const reportCheckoff = (index: number, out: Performed, verified: boolean) => {
    const summary = checkoffSummary(stepsRef.current);
    if (verified && workflowComplete(summary)) addLog('Workflow', completeText(summary), 'ok');
    else if (!out.ok) addLog('Workflow', incompleteText(stepsRef.current, index, out.message), 'error');
  };

  /** Writes a real outcome onto its step: done only when executed, failed otherwise; the tracer sees the step, then its screenshot verdict. */
  const applyOutcome = (index: number, out: Performed & { verdict?: StepVerdict | null }, dryRun: boolean, before: Frame | null = null) => {
    const c = out.correction;
    const measured = { correctedX: out.target.x, correctedY: out.target.y, drift: c?.matchDistance, driftPx: c?.driftPx };
    if (dryRun && out.ok) {
      updateStep(index, { status: 'pending', ...measured });
      return;
    }
    const evidence = out.executed ? { beforeFrame: before ?? undefined, afterFrame: out.shot ?? framesRef.current[0] } : {};
    const verifiedAt = out.executed && out.verdict?.success ? Date.now() : undefined;
    updateStep(index, { status: out.executed ? 'done' : 'failed', verifiedAt, ...measured, ...(out.shot ? { shot: out.shot } : {}), ...evidence });
    reportCheckoff(index, out, verifiedAt !== undefined);
    const step = stepsRef.current[index];
    if (step) {
      tracer.emit({ kind: 'step', stepId: step.id, name: step.name, ok: out.ok, executed: out.executed, detail: out.message });
      if (out.verdict) tracer.emit({ kind: 'verdict', stepId: step.id, name: step.name, success: out.verdict.success });
    }
    if (!out.executed) return;
    if (stageOn('progress')) setProgress((p) => ({ ...p, done: p.done + 1 }));
    if (step) sectionEvent({ time: Date.now(), kind: 'log', text: `${step.name}: ${out.message}`, box: pointBox(out.target) });
    if (step && out.ok && out.verdict?.success !== false) saveStepRoute(index);
  };

  /**
   * Route accumulation: a verified executed step on a named target saves the element → element path
   * the run took to reach it as that target's access-path profile (coordinate learner stage).
   */
  const saveStepRoute = (index: number) => {
    const step = stepsRef.current[index];
    if (!step?.target || !stageOn('coords') || !POINTER_ACTIONS.has(step.action)) return;
    const hops = routeTrail(stepsRef.current, index);
    commitProfiles(recordProfileResult(saveProfile(routeProfilesRef.current, step.target, hops), step.target, true));
    addLog('Routes', `Access path to "${step.target}" saved: ${hops.map((h) => h.name).join(' → ')}`, 'info');
  };

  /** Shows the supervisor's state in its panel and logs it. */
  const superviseReport = (state: SupervisorState, tone: LogEntry['tone']) => {
    supervisorRef.current = state;
    setSupervisor(state);
    addLog('Supervisor', state.detail, tone);
  };

  /** Applies a confident review: step fixes onto the plan (awaiting the executor) and habits into the pattern store. */
  const applyReview = (review: SupervisorReview) => {
    stepsRef.current = applyFixes(stepsRef.current, review.stepFixes);
    setSteps(stepsRef.current);
    const now = Date.now();
    const fixed = new Set(review.stepFixes.map((f) => f.stepId));
    pendingFixesRef.current = [...pendingFixesRef.current.filter((p) => !fixed.has(p.stepId)), ...[...fixed].map((stepId) => ({ stepId, appliedAt: now }))];
    if (review.habits.length) addPatterns(habitPatterns(review.habits, goalRef.current, now));
  };

  /** Puts `steps` in place of the plan and re-traces it, keeping the traced state of retained steps. */
  const replacePlan = (steps: WorkflowStep[]) => {
    stepsRef.current = steps;
    setSteps(steps);
    tracer.emit({ kind: 'plan', steps, append: false, keep: true });
  };

  /**
   * Supervisor re-plan: the planner plans the rest of the goal from the live frame with the review's
   * problem, strategy, blacklist and opportunities injected; its steps replace every step not done.
   */
  const supervisorReplan = async (review: SupervisorReview) => {
    const n = replansRef.current;
    const runGoal = runGoalOf();
    try {
      const plan = await thought(`Supervisor re-plan #${n}: ${runGoal}`, () => planRemaining(askFor('planner'), runGoal, framesRef.current[0] ?? null, stepsRef.current, replanFeedback(review), patternsRef.current, capabilityPrompt(capabilities.registry.list, AI)), (r) => `${r.steps.length} step(s): ${stepsText(r.steps)}`);
      await runAiRequests(plan.capabilities);
      pendingFixesRef.current = [];
      review.opportunities.forEach((o) => opportunitiesRef.current.add(o.toLowerCase()));
      replacePlan([...stepsRef.current.filter((s) => s.status === 'done'), ...plan.steps]);
      addLog('Supervisor', `Re-plan ${n}/${SUPERVISOR_REPLAN_LIMIT} from the review: ${plan.steps.length} step(s) replace the pending steps — ${stepsText(plan.steps)}`, 'warn');
    } catch (error) {
      addLog('Supervisor', aiFailure(`AI unavailable — the supervisor's re-plan of "${runGoal}" was not made`, error), 'error');
    }
  };

  /** Proposes the review's new "[Opportunity]" notes as the immediate next steps, before the first pending step. */
  const proposeOpportunities = async (review: SupervisorReview) => {
    const fresh = review.opportunities.filter((o) => !opportunitiesRef.current.has(o.toLowerCase()));
    if (!fresh.length) return;
    fresh.forEach((o) => opportunitiesRef.current.add(o.toLowerCase()));
    const what = fresh.join('; ');
    try {
      const plan = await thought(`Supervisor opportunity: ${what}`, () => planRemaining(askFor('planner'), what, framesRef.current[0] ?? null, [], `Supervisor [Opportunity] toward "${runGoalOf()}" — plan only these immediate next steps`, patternsRef.current), (r) => `${r.steps.length} step(s): ${stepsText(r.steps)}`);
      const steps = stepsRef.current;
      const first = steps.findIndex((s) => s.status !== 'done');
      const cut = first < 0 ? steps.length : first;
      replacePlan([...steps.slice(0, cut), ...plan.steps, ...steps.slice(cut)]);
      addLog('Supervisor', `Opportunity proposed as the next step(s): ${what} — ${stepsText(plan.steps)}`, 'info');
    } catch (error) {
      addLog('Supervisor', aiFailure(`AI unavailable — opportunity "${what}" not planned`, error), 'warn');
    }
  };

  /** Convergence guard tripped: stop the run, Auto Act and AI calls, and say why the goal cannot proceed. */
  const haltSupervisor = (review: SupervisorReview) => {
    supervisorHaltedRef.current = true;
    abortRef.current = true;
    cancelAi();
    pendingFixesRef.current = [];
    setSettings((s) => ({ ...s, autoAct: false }));
    const text = haltText(goalRef.current.trim() || runGoalOf(), review, replansRef.current);
    note({ step: 'Supervisor', kind: 'review', text, thinking: null });
    addLog('Supervisor', `${text}. Run stopped — make a new plan to continue.`, 'error');
  };

  /** Acts on a review: an OK plan resets the guard and takes its opportunities; a rejection re-plans or halts; an unassessed review acts on nothing. */
  const actOnReview = async (review: SupervisorReview, applied: boolean) => {
    if (review.assessment === NO_ASSESSMENT) return;
    // A reply without an assessment is no verdict at all: it neither approves nor rejects the plan.
    if (review.assessment === NO_ASSESSMENT) return undefined;
    if (review.planOk) {
      replansRef.current = 0;
      return proposeOpportunities(review);
    }
    tracer.emit({ kind: 'deviation', cause: 'review', text: `supervisor says the plan needs updates — ${review.problem || review.assessment}` });
    if (reviewDecision(review, replansRef.current) === 'halt') return haltSupervisor(review);
    replansRef.current++;
    if (!applied) return supervisorReplan(review);
    return proposeOpportunities(review);
  };

  /**
   * The supervisor's review: consolidates every agent's output, the gallery screenshots and the
   * thinking timeline into one structured AI question. With the AI down it says so and does nothing.
   */
  const superviseRun = async () => {
    if (!agentsRef.current('supervisor') || supervisorBusyRef.current || abortedRef.current) return;
    lastReviewAt.current = Date.now();
    if (aiStatusRef.current.state === 'offline') {
      superviseReport({ status: 'offline', detail: `AI endpoint is down — no supervisor review was made, nothing applied (${aiStatusRef.current.detail})`, review: null, applied: false }, 'error');
      return;
    }
    supervisorBusyRef.current = true;
    setSupervisor((s) => ({ ...s, status: 'reviewing', detail: 'Reviewing agents, screenshots and thinking…' }));
    try {
      const input = { goal: goalRef.current, steps: stepsRef.current, log: logRef.current, timeline: timelineRef.current, frames: framesRef.current, sync: syncRef.current, progress: progressRef.current };
      const review = await reviewRun(askFor('supervisor'), input);
      const applied = isConfident(review);
      if (applied) applyReview(review);
      const text = reviewText(review, applied);
      note({ step: 'Supervisor', kind: 'review', text, thinking: review.thinking });
      superviseReport({ status: 'done', detail: text, review, applied }, review.planOk ? 'ok' : 'warn');
      await actOnReview(review, applied);
    } catch (error) {
      note({ step: 'Supervisor', kind: 'review', text: '', thinking: null, error: errorText(error) });
      superviseReport({ status: aiOnline() ? 'error' : 'offline', detail: `AI unavailable — no supervisor review, nothing applied: ${errorText(error)}`, review: null, applied: false }, 'error');
    } finally {
      supervisorBusyRef.current = false;
    }
  };

  /** Performs one correction the executor left unapplied; dry run unless armed, inside the run budget. */
  const superviseMove = async (fix: PendingFix, budget: ActionBudget): Promise<boolean> => {
    pendingFixesRef.current = pendingFixesRef.current.filter((p) => p.stepId !== fix.stepId);
    const idx = stepsRef.current.findIndex((s) => s.id === fix.stepId);
    const step = stepsRef.current[idx];
    const dry = !armedRef.current;
    updateStep(idx, { status: 'running' });
    const out = await perform(step, 'Supervisor', budget, dry, recordLocal('Supervisor', step, `the executor left "${step.name}" unapplied, so the supervisor performs it`));
    applyOutcome(idx, out, dry);
    const message = `Executor left "${step.name}" unapplied — supervisor ${dry ? 'dry run' : 'performed it'} at ${at(out.target.x, out.target.y)}: ${out.message}`;
    note({ step: step.name, kind: 'movement', text: message, thinking: null });
    addLog(dry ? 'Supervisor (dry run)' : 'Supervisor', message, out.ok ? 'ok' : 'error');
    return !out.halt;
  };

  /** Carries out corrections the executor has not applied within the window; pauses while it is mid-step. */
  const superviseMovement = async () => {
    pendingFixesRef.current = pendingFixesRef.current.filter((p) => stepsRef.current.some((s) => s.id === p.stepId && s.status !== 'done'));
    const stale = staleFixes(pendingFixesRef.current, stepsRef.current, Date.now());
    if (!stale.length || supervisorMovingRef.current || abortedRef.current) return;
    if (supervisorExecutorBusy({ autoBusy: autoBusyRef.current, replaying: replayingRef.current, recording: recordingRef.current, steps: stepsRef.current })) return;
    supervisorMovingRef.current = true;
    const budget = createBudget(settingsRef.current.actionBudget);
    try {
      for (const fix of stale) {
        if (abortedRef.current || !(await superviseMove(fix, budget))) break;
      }
    } finally {
      supervisorMovingRef.current = false;
    }
  };

  /** True when the automatic review may run now: Supervisor stage on, AI up, and no pipeline AI call waiting in the queue. */
  const reviewAllowed = () => stageOn('supervisor') && aiOnline() && aiQueueRef.current.stats().queued === 0;

  /** One supervisor tick: movement for unapplied corrections, then the automatic periodic review when due. */
  const superviseTick = () => {
    if (!agentsRef.current('supervisor')) return;
    void superviseMovement();
    const due = Date.now() - lastReviewAt.current >= SUPERVISOR_INTERVAL_MS;
    if (stepsRef.current.length && !supervisorHaltedRef.current && due && reviewAllowed()) void superviseRun();
  };
  const superviseTickRef = useRef(superviseTick);
  superviseTickRef.current = superviseTick;

  useEffect(() => {
    const id = setInterval(() => superviseTickRef.current(), SUPERVISOR_TICK_MS);
    return () => clearInterval(id);
  }, []);

  /** Flags `box` as a popup: the popup watcher's special case, which the AI then rules on (decidePopup). */
  const flagPopup = useCallback((prev: Frame, cur: Frame, box: ScreenChange['box']) => {
    popupBaseRef.current = prev;
    popupFrameRef.current = cur;
    const ann: Annotation = { id: uid('ann'), ...box, label: 'New popup / UI mismatch', tone: 'error' };
    popupRef.current = ann;
    setAnnotations((a) => [ann, ...a.filter((x) => x.tone !== 'error')].slice(0, 6));
    if (stageOn('popup')) addLog('Popup watcher', `New content appeared at (${pct(box.x)}, ${pct(box.y)}) — the AI decides whether it is a popup to close`, 'warn');
  }, [addLog]);

  /** True (and clears the flag) once a flagged popup is gone or replaced; false while it is still there. */
  const popupStillShown = useCallback((cur: Frame): boolean => {
    const popup = popupRef.current;
    if (!popup || !popupBaseRef.current || !popupFrameRef.current) return false;
    const backToClean = boxDistance(popupBaseRef.current.data, cur.data, popup) < 0.06;
    const popupChanged = boxDistance(popupFrameRef.current.data, cur.data, popup) > 0.15;
    if (!backToClean && !popupChanged) return true;
    popupRef.current = null;
    popupBaseRef.current = null;
    popupFrameRef.current = null;
    setAnnotations((a) => a.filter((x) => x.tone !== 'error'));
    if (stageOn('popup')) addLog('Popup watcher', 'Popup gone — area matches the clean screen again', 'ok');
    return false;
  }, [addLog]);

  /** The latest change assessment made after the current plan, or null when the screen has not changed since. */
  const currentChange = (): ChangeAssessment | null => {
    const last = lastChangeRef.current;
    return last && last.at >= planAtRef.current ? last.assessment : null;
  };

  /**
   * Screen-change responder: the AI is shown the full frame with the changed region boxed plus a
   * zoomed crop, and says what changed and whether it affects the plan. A popup becomes the popup
   * watcher's special case; any other change is recorded and boxed. A failed assessment falls back to the popup flag.
   */
  const respondToChange = async (prev: Frame, cur: Frame, change: ScreenChange) => {
    const next = describeNext(stepsRef.current.find((s) => s.status === 'pending' || s.status === 'running'));
    const where = `(${pct(change.box.x)}, ${pct(change.box.y)}) ${pct(change.box.w)}×${pct(change.box.h)}`;
    try {
      const a = await thought('Screen change', async () => {
        const { full, crop } = await boxedFrames(cur, change.box);
        return assessChange(askFor('screenResponder'), full, crop, change, { goal: goalRef.current, next });
      }, changeText, 'change');
      lastChangeRef.current = { at: Date.now(), assessment: a };
      addLog('Screen-change responder', `Change at ${where}: ${changeText(a)}`, a.stale ? 'warn' : 'info');
      if (a.kind === 'popup') flagPopup(prev, cur, change.box);
      else setAnnotations((list) => [{ id: uid('ann'), ...change.box, label: `Changed: ${a.summary}`, tone: 'warn' as const }, ...list.filter((x) => x.tone === 'error')].slice(0, 6));
    } catch (error) {
      addLog('Screen-change responder', `Change at ${where} not assessed — AI unavailable: ${errorText(error)}`, 'error');
      flagPopup(prev, cur, change.box);
    }
  };

  /**
   * Visual change detection: each frame is compared with the frame the last change was measured at
   * (the last assessed change, or the previous frame when nothing changed); a cluster of changed cells
   * at least the Settings threshold in size is a material change. Frames arriving during an assessment
   * are compared after it, so a second change is not lost. With the responder on and the AI online the
   * change is assessed; otherwise it is flagged as a popup for the AI to rule on, as before.
   */
  const watchScreen = (prev: Frame, cur: Frame) => {
    if (popupStillShown(cur) || changeBusyRef.current) return;
    const base = changeBaseRef.current ?? prev;
    changeBaseRef.current = cur;
    const change = detectChange(base.data, cur.data, settingsRef.current.changeCells);
    if (!change || !changeInScope(sectionsRef.current, scopeRef.current, change.box)) return;
    sectionEvent({ time: cur.time, kind: 'change', text: `screen changed (${change.cells} cells) at ${gridRef(boxCenter(change.box))}`, box: change.box });
    if (!stageOn('screenResponder') || !aiOnline()) {
      flagPopup(base, cur, change.box);
      return;
    }
    changeBusyRef.current = respondToChange(base, cur, change).finally(() => {
      changeBusyRef.current = null;
    });
  };

  /** The planning context a proposal for `step` by `actor` is justified against; `redo` marks a re-proposal. */
  const proposalContext = (actor: string, step: WorkflowStep, redo?: string): ProposalContext => ({
    goal: goalRef.current,
    change: currentChange(),
    patterns: [...relevantPatterns(goalRef.current, patternsRef.current).map(patternLine), ...crossReference(actor, goalRef.current)],
    related: operationDb.related(`${step.name} ${step.target ?? ''}`, goalRef.current),
    redo,
  });

  /**
   * The knowledge sections and user profile cross-referenced before `actor` runs `operation`, with
   * the agent sections of every enabled agent taking part; the matched sections are logged.
   */
  const crossReference = (actor: string, operation: string): string[] => {
    const party = [actor, ...agents.filter((a) => a.on).map((a) => a.id)];
    const matched = kb.matchedSections(operation, party);
    if (matched.length) addLog(actor, `Cross-referenced knowledge section(s) before "${operation}": ${matched.join(', ')}`, 'info');
    return kb.contextFor(operation, party);
  };

  /** Writes a proposal to the activity log (the timeline entry is recorded where the proposal is made). */
  const logProposal = (actor: string, step: WorkflowStep, p: Proposal, redo: boolean) =>
    addLog(actor, `${redo ? 'Re-proposal' : 'Proposal'} for "${step.name}": ${proposalText(p)}`, p.ready ? 'info' : 'warn');

  /** Records a proposal made without a separate model call (AI offline, a popup ruling, a /use request). */
  const recordLocal = (actor: string, step: WorkflowStep, why: string): Proposal => {
    const p = localProposal(step, why, currentChange());
    note({ step: step.name, kind: 'proposal', text: proposalText(p), thinking: null });
    logProposal(actor, step, p, false);
    return p;
  };

  /** The model's what/why for `step` on the live screen, recorded on the timeline and in the log. */
  const proposeNow = async (actor: string, step: WorkflowStep, redo?: string): Promise<Proposal> => {
    const frame = framesRef.current[0] ?? null;
    const p = await thought(step.name, () => proposeStep(askFor('executor'), frame, step, proposalContext(actor, step, redo)), proposalText, 'proposal');
    logProposal(actor, step, p, !!redo);
    return p;
  };

  /** Why the pending step must be re-proposed (drift monitor red, or the responder says the plan is stale), or null. */
  const redoReason = (step: WorkflowStep): string | null => {
    const live = framesRef.current[0];
    if (step.refFrame && live && stageOn('drift') && driftCheck(step, live).level === 'red') {
      return 'the drift monitor reports RED — the recorded target is no longer where the plan put it';
    }
    const change = currentChange();
    if (change?.stale && staleHandledRef.current !== change) return `the screen-change responder says the plan is stale: ${change.summary}`;
    return null;
  };

  /** The one re-proposal a step gets; a second need, or a re-proposal that is still not ready, fails honestly. */
  const repropose = async (actor: string, step: WorkflowStep, reason: string): Promise<Justified> => {
    if (reproposedRef.current.has(step.id)) return { kind: 'fail', reason: `"${step.name}" already had its one re-proposal and ${reason} — not executed` };
    reproposedRef.current.add(step.id);
    const change = currentChange();
    if (change?.stale) staleHandledRef.current = change;
    if (!aiOnline()) return { kind: 'fail', reason: `"${step.name}" must be re-proposed (${reason}) but the AI is offline — not executed` };
    const p = await proposeNow(actor, step, reason);
    if (!p.ready) return { kind: 'fail', reason: `"${step.name}" could not be justified after re-proposal: ${p.why} — not executed` };
    return { kind: 'go', step: adopt(step, p, true), proposal: p };
  };

  /** Replaces the held aggressive candidates. */
  const putCandidates = (list: HeldCandidate[]) => {
    candidatesRef.current = list;
    setCandidates(list);
  };

  /** Asks the AI to judge a grounded candidate; an unreachable AI or unusable reply is null (the candidate is held). */
  const judge = async (step: WorkflowStep, g: KnownGrounding): Promise<Judgment | null> => {
    if (!aiOnline()) return null;
    try {
      return await thought(step.name, () => judgeCandidate(askFor('executor'), framesRef.current[0] ?? null, step, g, goalRef.current), judgmentText);
    } catch (error) {
      addLog('Aggressive', aiFailure(`AI judgment of "${step.name}" failed — held for your Apply`, error), 'warn');
      return null;
    }
  };

  /**
   * Aggressive mode, no thinking first: a pointer step whose target is already known is aimed at
   * the best grounding at once, then sent to the AI for one judgment. It runs now only when the AI
   * judges it fair and in scope within the user's auto-apply bounds; otherwise it is held for Apply.
   * Null when nothing grounds the target (the normal proposal runs).
   */
  const justifyAggressive = async (actor: string, step: WorkflowStep): Promise<Justified | null> => {
    if (EXECUTION_MODES[settingsRef.current.executionMode].grounding !== 'immediate' || !POINTER_ACTIONS.has(step.action) || dismissedGroundingRef.current.has(step.id)) return null;
    if (candidatesRef.current.some((c) => c.stepId === step.id)) return { kind: 'wait', reason: `a candidate for "${step.name}" is held for your Apply` };
    const g = bestGrounding(step.target ?? step.name, knowledge());
    if (!g) return null;
    const candidate = groundedStep(step, g);
    const proposal = recordLocal(actor, candidate, `aggressive mode — grounded at once on the ${g.source} element "${g.name}", no planning first`);
    const j = await judge(candidate, g);
    const d = j ? autoApplyDecision(j, groundingShift(step, g), autoAppliedRef.current, settingsRef.current.autoApply) : { apply: false, reason: 'held for your Apply — no AI judgment' };
    addLog('Aggressive', `"${step.name}": ${d.reason}`, d.apply ? 'ok' : 'warn');
    if (d.apply) {
      autoAppliedRef.current += 1;
      return { kind: 'go', step: candidate, proposal };
    }
    putCandidates([{ id: uid('cand'), time: Date.now(), stepId: step.id, step: candidate, proposal, reason: d.reason }, ...candidatesRef.current]);
    return { kind: 'wait', reason: `"${step.name}" ${d.reason}` };
  };

  /**
   * Intent before action: waits for an in-flight change assessment, then records a what/why proposal
   * for `step`. Drift red or a stale plan goes straight to the one re-proposal; a not-ready first
   * proposal waits when `canWait` (Auto Act), otherwise gets the re-proposal. Offline, a local proposal is recorded.
   * Aggressive mode first tries the known grounding without a proposal call.
   */
  const justifyProposal = async (actor: string, step: WorkflowStep, canWait: boolean): Promise<Justified> => {
    await changeBusyRef.current;
    const aggressive = await justifyAggressive(actor, step);
    if (aggressive) return aggressive;
    const reason = redoReason(step);
    if (reason) return repropose(actor, step, reason);
    if (!aiOnline()) {
      const why = `AI offline — running the planned step as recorded${goalRef.current ? ` toward "${goalRef.current}"` : ''}; drift correction still checks the target`;
      return { kind: 'go', step, proposal: recordLocal(actor, step, why) };
    }
    const p = await proposeNow(actor, step);
    if (p.ready) return { kind: 'go', step: adopt(step, p, false), proposal: p };
    return canWait ? { kind: 'wait', reason: p.why, waitMs: p.waitMs } : repropose(actor, step, `the first proposal was not ready: ${p.why}`);
  };

  /** What the briefing cross-references the plan against. */
  const knowledge = (): Knowledge => ({
    map: elementMapRef.current, familiar: familiarRef.current, habits: habitsRef.current, patterns: patternsRef.current,
    failures: memoryRef.current.failures, dossiers: dossiersRef.current, memory: enhancedMemoryRef.current, context: habitContext(),
  });

  /** A fresh briefing of `step` with `proposal` on the live frame. */
  const buildBriefingFor = (step: WorkflowStep, proposal: Proposal) => buildBriefing({
    goal: goalRef.current.trim() || runGoalRef.current, steps: stepsRef.current, step, proposal, live: framesRef.current[0] ?? null,
    knowledge: knowledge(), thresholds: driftThresholds(), online: aiOnline(), goalProgress: tracer.briefingLine(),
    mode: modeStatus(settingsRef.current.executionMode, modeChangeRef.current),
  });

  /** Records a briefing (newest first) with zoomed crops of the planned point on the live and reference frames. */
  const publishBriefing = async (b: Briefing) => {
    setBriefings((list) => addBriefing(list, b));
    const p = { x: b.objectives.x, y: b.objectives.y };
    const { live, reference } = b.comparison;
    const [liveCrop, referenceCrop] = await Promise.all([live, reference].map((f) => (f ? zoomFrame(f, p).catch(() => undefined) : undefined)));
    setBriefings((list) => list.map((x) => (x.id === b.id && x.revisions.length === b.revisions.length ? { ...x, liveCrop, referenceCrop } : x)));
  };

  /**
   * What a reroute routes through: a fresh snip of the target region, re-identified by the
   * grounding agent on that snip, the known access paths, and the planner's re-plan.
   */
  const rerouteDeps = (): RerouteDeps => ({
    online: aiOnline() && stageOn('grounding'),
    knowledge: knowledge(),
    snip: async (box) => (await snip(box, { by: 'reroute', label: 'Reroute snip' }))?.frame ?? null,
    identify: async (step, crop, box) => {
      const p = await grounding.relocate(crop, { ...step, ...toSnip(box, { x: step.correctedX ?? step.x, y: step.correctedY ?? step.y }), correctedX: undefined, correctedY: undefined }, 'reroute: re-identify the target on this fresh snip of its region');
      return p && fromSnip(box, p);
    },
    replan: replanFailed,
  });

  /** Shows a mid-run reroute in the pre-action briefing of the rerouted step before it dispatches. */
  const publishReroute = async (d: RerouteDecision, why: string) => {
    if (!stageOn('briefing') || d.kind === 'none') return;
    const b = buildBriefingFor(d.step, localProposal(d.step, `rerouted mid-run: ${why}`));
    const revision = { time: Date.now(), kind: d.kind === 'replan' ? 'replan' as const : 'reroute' as const, text: d.text, ...(d.snip ? { snip: d.snip } : {}) };
    await publishBriefing({ ...b, revisions: [revision], outcome: briefingIssues(b).length ? 'unresolved' : 'corrected' });
  };

  /**
   * The retry ladder's last rung: reroute the failed step mid-run (fresh snip → alternate access
   * path → re-plan) and brief the decision; null when nothing was found (the run goes on).
   */
  const rerouteFailed = async (actor: string, step: WorkflowStep, why: string): Promise<WorkflowStep | null> => {
    const d = await reroute(step, why, rerouteDeps());
    addLog(actor, `"${step.name}": ${d.text}`, d.kind === 'none' ? 'warn' : 'ok');
    await publishReroute(d, why);
    return d.kind === 'none' ? null : d.step;
  };

  /** The routes the review takes: the ruler, the grounding agent on a zoomed crop, and the executor's re-plan. */
  const reviewDeps = (actor: string): ReviewDeps => ({
    online: aiOnline(),
    groundingOn: stageOn('grounding'),
    hasBaseline: ruler.baseline !== null,
    recalibrate: (reason, step) => {
      const cal = ruler.recalibrateNow(reason);
      return cal && { drift: cal.drift, detail: cal.detail, step: cal.drift ? remapStep(cal, step) : step };
    },
    reground: async (step, feedback) => {
      const live = framesRef.current[0];
      return live ? grounding.relocate(live, step, `pre-action briefing: ${feedback}`) : null;
    },
    reroute: (step, why) => reroute(step, why, { ...rerouteDeps(), replan: undefined }),
    replan: async (step, reason) => {
      const p = await proposeNow(actor, step, reason);
      return p.ready ? { step: adopt(step, p, true), proposal: p } : null;
    },
    rebuild: buildBriefingFor,
    publish: publishBriefing,
  });

  /**
   * Pre-action briefing of a step that is about to run: objectives, screenshot comparison and
   * cross-reference are recorded, then reviewed and updated (recalibrate → re-ground → re-plan)
   * before it dispatches. Skipped when the Briefing stage is unchecked; a failed review runs the plan as it stood.
   */
  const brief = async (actor: string, go: Extract<Justified, { kind: 'go' }>): Promise<Justified> => {
    if (!stageOn('briefing')) return go;
    const first = buildBriefingFor(go.step, go.proposal);
    await publishBriefing(first);
    try {
      const r = await reviewBriefing({ briefing: first, step: go.step, proposal: go.proposal }, reviewDeps(actor));
      if (r.briefing.outcome !== 'clear') await publishBriefing(r.briefing);
      addLog(actor, `Briefing for "${go.step.name}": ${briefingText(r.briefing)}`, r.briefing.outcome === 'unresolved' ? 'warn' : 'info');
      // A step the dispatch gate will block strikes there; striking here too would count one iteration twice.
      if (r.briefing.outcome === 'unresolved' && !dispatchBlock(r.step)) strikeBreaker(false, `briefing of "${go.step.name}" unresolved — it needs re-grounding or a re-plan`);
      return { kind: 'go', step: r.step, proposal: r.proposal };
    } catch (error) {
      addLog(actor, aiFailure(`Briefing review for "${go.step.name}" failed — running the plan as briefed`, error), 'error');
      return go;
    }
  };

  /** Intent before action, then the pre-action briefing of a step that will run. */
  const justify = async (actor: string, step: WorkflowStep, canWait: boolean): Promise<Justified> => {
    const j = await justifyProposal(actor, step, canWait);
    return j.kind === 'go' ? brief(actor, j) : j;
  };

  /** Starts a new plan: a fresh baseline for "changed since the plan" and fresh re-proposal allowances. */
  const markPlan = () => {
    autoLoopRef.current = null;
    flowRef.current = null;
    tracer.release();
    planAtRef.current = Date.now();
    replansRef.current = 0;
    supervisorHaltedRef.current = false;
    opportunitiesRef.current = new Set();
    reproposedRef.current = new Set();
    staleHandledRef.current = null;
    autoAppliedRef.current = 0;
    dismissedGroundingRef.current = new Set();
    putCandidates([]);
  };

  /** Auto-Actor popup handling: the model rules once per flagged region; a close is a grounded click. */
  const autoClosePopup = async (frame: Frame, popup: Annotation, dry: boolean) => {
    popupDecidedRef.current = popup.id;
    const d = await thought('Popup', () => decidePopup(askFor('popup'), frame, popup), popupSummary);
    if (!d.close) {
      addLog('Auto-Actor', `AI left the new content alone: ${d.reason}`, 'info');
      return;
    }
    const close: WorkflowStep = { id: uid('close'), name: 'Close popup', action: 'click', target: 'close (X) button of the popup', x: d.x, y: d.y, status: 'pending' };
    forwardElement('popup', { name: close.target!, x: d.x, y: d.y });
    const proposal = recordLocal('Auto-Actor', close, `the popup blocks the goal, so it is closed first — ${d.reason}`);
    const out = await perform(close, 'Auto-Actor', autoBudgetRef.current, dry, proposal);
    addLog('Auto-Actor', `Close popup (${d.reason}): ${out.message}`, out.ok ? 'ok' : 'error');
    if (out.halt) setSettings((s) => ({ ...s, autoAct: false }));
  };

  /**
   * A step whose aggressive candidate waits for the user's Apply: it stays pending and the run halts
   * there, never recorded as a failure (no lesson, no failed flow).
   */
  const holdForApply = (idx: number, actor: string, reason: string): Performed => {
    const step = stepsRef.current[idx];
    updateStep(idx, { status: 'pending' });
    addLog(actor, `Paused — ${reason}`, 'warn');
    return { ok: false, executed: false, halt: true, message: `Paused for your Apply — ${reason}`, target: { x: step.x, y: step.y } };
  };

  /** Marks a step that could not be justified as failed, with the reason in the log. */
  const failUnjustified = (idx: number, actor: string, reason: string): Performed => {
    const step = stepsRef.current[idx];
    updateStep(idx, { status: 'failed' });
    addLog(actor, reason, 'error');
    return { ok: false, executed: false, message: reason, target: { x: step.x, y: step.y } };
  };

  /** Ends Auto Act's continuation loop with why; false, so the finished run is reviewed. */
  const endAutoLoop = (loop: AutoLoop, stop: ContinueStop, detail: string): boolean => {
    autoLoopRef.current = null;
    addLog('Auto-continue', `Auto Act stopped after ${loop.iteration} continuation(s): ${detail}`, STOP_TONE[stop]);
    return false;
  };

  /**
   * Auto Act's continuation once no step is pending: verify the goal, and while it is not complete
   * plan the remaining steps for the next frames to run. Stops for the same reasons as replay's
   * loop (judgeCheck), on abort and when Auto Act was turned off (budget halt). True when it planned more.
   */
  const continueAutoAct = async (): Promise<boolean> => {
    if (!continueEnabled() || !settingsRef.current.autoAct || abortedRef.current) return false;
    const loop = autoLoopRef.current ?? { goal: runGoalOf(), stalls: 0, iteration: 0 };
    autoLoopRef.current = loop;
    const ran = stepsRef.current;
    setContinuing(true);
    try {
      const check = await checkGoal(loop.goal, ran, loop.iteration);
      if (abortedRef.current || !settingsRef.current.autoAct) return endAutoLoop(loop, 'aborted', 'Stopped by abort or Auto Act was turned off');
      const verdict = judgeCheck(check, loop.stalls, loop.iteration, settingsRef.current.maxIterations);
      if (verdict.stop) return endAutoLoop(loop, verdict.stop, verdict.detail);
      loop.stalls = verdict.stalls;
      loop.iteration += 1;
      await planNext(loop.goal, ran, check, loop.iteration);
      if (!stepsRef.current.length) return endAutoLoop(loop, 'no-progress', 'the re-plan found no remaining steps');
      return true;
    } catch (error) {
      autoLoopRef.current = null;
      addLog('Auto-continue', aiFailure('AI unavailable — Auto Act continuation stopped', error), 'error');
      return false;
    } finally {
      setContinuing(false);
    }
  };

  /** Auto-Actor step execution: a recorded what/why proposal for the next step, then it runs grounded. */
  const autoRunStep = async (frame: Frame, idx: number, dry: boolean) => {
    const next = stepsRef.current[idx];
    const j = await justify('Auto-Actor', next, true);
    if (!settingsRef.current.autoAct) {
      addLog('Auto-Actor', `Auto Act was stopped while proposing "${next.name}" — not executed`, 'warn');
      return;
    }
    if (j.kind === 'wait') {
      setSync({ level: 'yellow', detail: `AI is waiting on "${next.name}": ${j.reason}` });
      wake.arm(next.name, j.reason, j.waitMs);
      return;
    }
    if (j.kind === 'fail') failUnjustified(idx, 'Auto-Actor', j.reason);
    else {
      if (runStartRef.current === null) traceRun(runGoalOf());
      runStartRef.current ??= Date.now();
      updateStep(idx, { status: 'running' });
      const out = await perform(j.step, 'Auto-Actor', autoBudgetRef.current, dry, j.proposal);
      applyOutcome(idx, out, dry, frame);
      trackFailure(next, out);
      addLog(dry ? 'Auto-Actor (dry run)' : 'Auto-Actor', `${next.name}: ${out.message}`, out.ok ? 'ok' : 'error');
      if (out.halt) {
        setSettings((s) => ({ ...s, autoAct: false }));
        addLog('Auto-Actor', 'Auto Act stopped', 'error');
      }
    }
    if (dry) autoDryRef.current = true;
    if (!stepsRef.current.some((s) => s.status === 'pending')) {
      if (await continueAutoAct()) return;
      const dryRun = autoDryRef.current;
      autoDryRef.current = false;
      void learnFromRun(stepsRef.current, { dryRun, stopped: false });
      void superviseRun();
      void autoSideTests();
    }
  };

  /** Auto Act: with the AI online, the model handles popups and runs the next pending step. Disarmed = dry run. */
  const autoAct = async (frame: Frame) => {
    const { autoAct: on } = settingsRef.current;
    if (!on || abortedRef.current || autoBusyRef.current || watchBusyRef.current || replayingRef.current || recordingRef.current || supervisorMovingRef.current || subRunningRef.current || wake.waiting() || !stageOn('screenResponder')) return;
    if (!aiOnline() || Date.now() - lastStepAt.current < 1500) return;
    if (!on || abortedRef.current || autoBusyRef.current || watchBusyRef.current || replayingRef.current || recordingRef.current || supervisorMovingRef.current || subRunningRef.current || !stageOn('screenResponder')) return;
    if (!aiOnline() || Date.now() - lastStepAt.current < EXECUTION_MODES[settingsRef.current.executionMode].stepGapMs) return;
    autoBusyRef.current = true;
    try {
      const dry = !armedRef.current;
      const popup = popupRef.current;
      const idx = stepsRef.current.findIndex((s) => s.status === 'pending');
      if (popup && popupDecidedRef.current !== popup.id && stageOn('popup')) await autoClosePopup(frame, popup, dry);
      else if (idx >= 0) await autoRunStep(frame, idx, dry);
    } catch (error) {
      addLog('Auto-Actor', aiFailure('AI unavailable — nothing executed', error), 'error');
    } finally {
      lastStepAt.current = Date.now();
      autoBusyRef.current = false;
    }
  };

  /** Monitor analysis of one frame: count, gallery, store, error detection, sync status, Auto Act. */
  const processFrame = (frame: Frame) => {
    const prev = framesRef.current.find((f) => !restoredIdsRef.current.has(f.id));
    framesRef.current = [frame, ...framesRef.current].slice(0, settingsRef.current.gallerySize);
    setFrames(framesRef.current);
    setShotCount((n) => n + 1);
    readScreen(frame);
    void putStoredFrame(toStoredFrame(frame), settingsRef.current.gallerySize).catch(() => undefined);
    if (prev) {
      watchChanges(prev, frame);
      radarFrame(prev, frame);
      watchScreen(prev, frame);
      if (stageOn('opsMonitor')) monitorFrame(prev, frame);
    }
    learnFromDwell(frame);
    if (settingsRef.current.autoScan) scanNow(frame);
    const next = stepsRef.current.find((s) => s.status === 'pending' || s.status === 'running');
    if (next?.refFrame && stageOn('drift')) {
      const { r, level } = driftCheck(next, frame);
      setSync({ level, detail: `"${next.name}": region ${r.regionDistance.toFixed(3)}, best ${r.matchDistance.toFixed(3)}${level === 'yellow' ? `, drift (${(r.dx * 100).toFixed(1)}%, ${(r.dy * 100).toFixed(1)}%)` : ''}` });
      if (level === 'red') {
        captureError({ kind: 'drift', message: `Drift red: target of "${next.name}" not found on the live screen`, goal: goalRef.current, step: next.name });
        tracer.emit({ kind: 'deviation', cause: 'drift', text: `drift monitor: target of "${next.name}" not found on the live screen` });
      }
    } else if (!next) {
      setSync({ level: 'idle', detail: 'No active step' });
    }
    void autoAct(frame);
  };
  const processRef = useRef(processFrame);
  processRef.current = processFrame;

  /** Only background mode keeps watching and controlling while the page is hidden. */
  const pausedWhileHidden = () => typeof document !== 'undefined' && document.hidden && settingsRef.current.monitorMode !== 'background';

  // Demo desktop render loop.
  useEffect(() => {
    if (source !== 'demo') return undefined;
    const id = setInterval(() => {
      tickRef.current += 1;
      if (worldOnRef.current) worldRef.current = worldTick(worldRef.current);
      const c = demoCanvasRef.current;
      if (c) drawDemo(c.getContext('2d')!);
    }, 400);
    return () => clearInterval(id);
    // drawDemo reads only refs, so the first render's closure stays current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // Demo monitor at the mode's interval.
  useEffect(() => {
    if (source !== 'demo') return undefined;
    const id = setInterval(() => {
      const c = demoCanvasRef.current;
      if (c && !pausedWhileHidden()) processRef.current(toFrame(c, DEMO_W, DEMO_H, ++frameId.current, 'demo'));
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, source]);

  // Bridge monitor: a real desktop screenshot at the mode's interval; failures are logged, never faked.
  useEffect(() => {
    if (source !== 'bridge') return undefined;
    const id = setInterval(() => {
      if (pollBusyRef.current || pausedWhileHidden()) return;
      pollBusyRef.current = true;
      desktopFrame(settingsRef.current.bridgeUrl, settingsRef.current.bridgeToken, ++frameId.current)
        .then((f) => processRef.current(f))
        .catch((error) => {
          if (Date.now() - lastPollErrorAt.current < 5000) return;
          lastPollErrorAt.current = Date.now();
          addLog('Monitor', `Desktop screenshot failed: ${errorText(error)}`, 'error');
          captureError({ kind: 'bridge', message: `Desktop screenshot failed: ${errorText(error)}` });
        })
        .finally(() => {
          pollBusyRef.current = false;
        });
    }, intervalMs);
    return () => clearInterval(id);
  }, [addLog, captureError, intervalMs, source]);

  // The running screen capture follows the monitor mode's interval live.
  useEffect(() => {
    captureRef.current?.setInterval(intervalMs);
  }, [intervalMs]);

  // The running native capture follows the chosen display live (Settings or the HUD quick-switch).
  useEffect(() => {
    captureRef.current?.selectDisplay(settings.displayId);
  }, [settings.displayId]);

  useEffect(() => () => captureRef.current?.stop(), []);

  /**
   * Appends a recorded step carrying its measured human pause (ms since the previous recorded
   * input, or since recording started), so replay reproduces the original timing.
   */
  const appendRecorded = useCallback((step: WorkflowStep) => {
    const now = Date.now();
    const recorded = { ...step, delayMs: stepDelay(now, lastInputRef.current) };
    stepsRef.current = [...stepsRef.current, recorded];
    lastInputRef.current = now;
    setSteps(stepsRef.current);
    packCaptureRef.current({ ...recorded, refFrame: recorded.refFrame ?? framesRef.current[0] });
  }, []);
  /** Whether stage gestures go to the mirror: mirror on and no ruler or element-map mode (recording is checked first by each handler). */
  stageModeRef.current = { ruler: ruler.on, map: mapMode };
  mirrorBridgeRef.current = bridgeOnline;
  const mirroring = () => mirrorOnRef.current && !stageModeRef.current.ruler && !stageModeRef.current.map;

  /** Stage pointer input: trail while recording. */
  const onStageMove = useCallback((x: number, y: number) => {
    pointerRef.current = [...pointerRef.current, { x, y, t: Date.now() }].slice(-POINTER_LIMIT);
    if (recordingRef.current) setTrail((t) => [...t, { x, y, t: Date.now() }].slice(-1500));
  }, []);

  /** Stage click: in Ruler mode adds a ruler point; while recording becomes a step (Alt+click records a hover/move); on the demo it acts. */
  const onStageClick = (x: number, y: number, hover = false) => {
    if (ruler.on) {
      ruler.addPoint({ x, y });
      return;
    }
    const frame = framesRef.current[0];
    if (recordingRef.current) {
      const n = stepsRef.current.length + 1;
      setTrail((t) => [...t, { x, y, t: Date.now(), click: !hover }]);
      appendRecorded({ id: uid('step'), name: hover ? `Move ${n}` : `Click ${n}`, action: hover ? 'move' : 'click', x, y, refFrame: frame, status: 'pending' });
      addLog('Recorder', `Captured ${hover ? 'mouse move' : 'click'} at (${pct(x)}, ${pct(y)}) with screenshot`, 'info');
      return;
    }
    if (mirroring()) {
      void mirrorRef.current({ kind: 'click', x, y });
      return;
    }
    if (sourceRef.current === 'demo' && !hover) {
      noteInput({ x, y }, 'user');
      addLog('You', demoClick(x, y).message);
    }
  };

  /** Stage double-click on the demo (not while recording or measuring): opens boxes, icons and the chest in the test world. */
  const onStageDoubleClick = (x: number, y: number) => {
    if (ruler.on || recordingRef.current || sourceRef.current !== 'demo') return;
    addLog('You', demoClick(x, y, true).message);
  };

  /**
   * Key press on the focused stage: recorded as a key step while recording, dispatched while mirror input is on,
   * otherwise sent to the demo's focused window. The abort hotkey is never any of them.
   */
  const onStageKey = useCallback((e: HotkeyEvent) => {
    if (matchesHotkey(e, settingsRef.current.abortHotkey)) return;
    const combo = keyCombo(e);
    if (recordingRef.current) {
      if (!combo) return;
      appendRecorded(keyStep(uid('step'), combo));
      addLog('Recorder', `Captured key ${combo}`, 'info');
      return;
    }
    if (mirroring()) {
      if (combo) void mirrorRef.current({ kind: 'key', combo });
      return;
    }
    if (sourceRef.current === 'demo' && (worldOnRef.current || questOnRef.current)) addLog('You', demoTextKey(e.key).message);
  }, [addLog, appendRecorded]);

  /** Mouse wheel at (x, y): one scroll step (recorded or mirrored) per gesture (same-direction wheel events in a burst merge). */
  const onStageScroll = useCallback((x: number, y: number, deltaY: number) => {
    if (deltaY === 0) return;
    if (!recordingRef.current) {
      if (mirroring()) mirrorScroll(x, y, deltaY);
      return;
    }
    const now = Date.now();
    const last = stepsRef.current[stepsRef.current.length - 1];
    if (continuesScroll(last, deltaY, now - lastInputRef.current)) {
      lastInputRef.current = now;
      return;
    }
    const step = scrollStep(uid('step'), x, y, deltaY);
    appendRecorded({ ...step, refFrame: framesRef.current[0] });
    addLog('Recorder', `Captured scroll ${step.text} at (${pct(x)}, ${pct(y)})`, 'info');
  }, [addLog, appendRecorded]);

  /**
   * Stage drag (mousedown → move → mouseup): while recording becomes a drag step with both
   * endpoints and the latest screenshot as the template of its start region; on the demo it acts.
   */
  const onStageDrag = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
    if (recordingRef.current) {
      const n = stepsRef.current.length + 1;
      setTrail((t) => [...t, { x: from.x, y: from.y, t: Date.now(), click: true }, { x: to.x, y: to.y, t: Date.now(), click: true }].slice(-1500));
      const grabbed = sourceRef.current === 'demo' ? questGrabTarget(from) : null;
      const step: WorkflowStep = { id: uid('step'), name: grabbed ? `Drag ${grabbed}` : `Drag ${n}`, action: 'drag', x: from.x, y: from.y, endX: to.x, endY: to.y, refFrame: framesRef.current[0], status: 'pending', ...(grabbed ? { target: grabbed } : {}) };
      appendRecorded(step);
      addLog('Recorder', `Captured drag${grabbed ? ` of "${grabbed}"` : ''} from (${pct(from.x)}, ${pct(from.y)}) to (${pct(to.x)}, ${pct(to.y)}) with screenshot`, 'info');
      return;
    }
    if (mirroring()) {
      void mirrorRef.current({ kind: 'drag', x: from.x, y: from.y, endX: to.x, endY: to.y });
      return;
    }
    if (sourceRef.current === 'demo') addLog('You', applyDemoDrag(from, to).message);
  }, [addLog, applyDemoDrag, appendRecorded]);

  /** Live-write: typed text becomes a "type" step while recording, and is typed on the PC while mirror input is on. */
  const onStageType = useCallback((text: string) => {
    if (!text) return;
    if (mirroring() && !recordingRef.current) {
      void mirrorRef.current({ kind: 'type', text });
      return;
    }
    if (!recordingRef.current) return;
    appendRecorded({ id: uid('step'), name: `Type "${text}"`, action: 'type', x: 0.5, y: 0.5, text, status: 'pending' });
    addLog('Recorder', `Captured typing: "${text}"`);
  }, [addLog, appendRecorded]);

  const toggleRecording = () => {
    if (recording) {
      setRecording(false);
      addLog('Recorder', `Stopped — ${steps.length} step(s), ${trail.length} trail points`, 'ok');
      setDraftCard(generateCard(steps, goal));
      return;
    }
    setTrail([]);
    lastInputRef.current = Date.now();
    setRecording(true);
    markPlan();
    addLog('Recorder', 'Live recording started — click to record clicks, Alt+click to record a mouse move, keys and the mouse wheel on the focused stage record key and scroll steps');
  };

  /** AI help during replay: the model rules on the popup covering `step` and closes it as a grounded click. */
  const clearCoveringPopup = async (popup: Annotation, step: WorkflowStep, budget: ActionBudget, dryRun: boolean): Promise<boolean> => {
    const live = framesRef.current[0];
    if (!live) return false;
    try {
      const d = await thought(step.name, () => decidePopup(askFor('popup'), live, popup), popupSummary);
      if (!d.close) {
        addLog('AI help', `AI says the region over "${step.name}" is not a popup to close: ${d.reason}`, 'warn');
        return false;
      }
      const close: WorkflowStep = { id: uid('close'), name: 'Close popup', action: 'click', target: 'close (X) button of the popup', x: d.x, y: d.y, status: 'pending' };
      const proposal = recordLocal('AI help', close, `the popup covers "${step.name}", so it is closed before that step — ${d.reason}`);
      const out = await perform(close, 'AI help', budget, dryRun, proposal);
      addLog('AI help', `Popup covers "${step.name}" — ${out.message}`, out.ok ? 'ok' : 'error');
      await sleep(settingsRef.current.captureMs * 2 + 200);
      return out.ok;
    } catch (error) {
      addLog('AI help', `AI unavailable — popup not cleared: ${errorText(error)}`, 'error');
      return false;
    }
  };

  /** True when the flagged popup covers the step's point. */
  const coveredBy = (popup: Annotation | null, s: WorkflowStep): popup is Annotation =>
    !!popup && s.x >= popup.x && s.x <= popup.x + popup.w && s.y >= popup.y && s.y <= popup.y + popup.h;

  /** Runs one replay step, clearing a covering popup first when AI help is on, after a recorded what/why proposal. */
  const replayStep = async (i: number, budget: ActionBudget, dryRun: boolean, label: string, pin?: { x: number; y: number }): Promise<Performed & { verdict?: StepVerdict | null }> => {
    const planned = stepsRef.current[i];
    setActiveIndex(i);
    updateStep(i, { status: 'running' });
    const popup = popupRef.current;
    if (coveredBy(popup, planned) && !(settingsRef.current.aiHelp && stageOn('popup') && aiOnline() && (await clearCoveringPopup(popup, planned, budget, dryRun)))) {
      const out: Performed = { ok: false, executed: false, message: `"${planned.name}" is covered by a popup${settingsRef.current.aiHelp ? ' the AI did not clear' : ' (enable AI help to clear it)'} — not executed`, target: { x: planned.x, y: planned.y } };
      updateStep(i, { status: 'drift' });
      addLog(label, out.message, 'error');
      captureError({ kind: 'drift', message: out.message, goal: goalRef.current, step: planned.name });
      tracer.emit({ kind: 'deviation', cause: 'popup', text: `popup watcher: "${planned.name}" is covered by a popup` });
      return out;
    }
    let j: Justified;
    try {
      j = await justify(label, planned, false);
    } catch (error) {
      return failUnjustified(i, label, `No proposal for "${planned.name}" — AI unavailable: ${errorText(error)} — not executed`);
    }
    if (j.kind === 'wait') return holdForApply(i, label, j.reason);
    if (j.kind !== 'go') return failUnjustified(i, label, j.reason);
    const paused = dispatchPaused();
    if (paused) {
      updateStep(i, { status: 'pending' });
      return { ok: false, executed: false, halt: true, paused: true, message: `"${planned.name}" held — run ${paused} — not executed`, target: { x: planned.x, y: planned.y } };
    }
    if (abortRef.current) {
      updateStep(i, { status: 'pending' });
      return { ok: false, executed: false, halt: true, message: `Stopped before "${planned.name}" — not executed`, target: { x: planned.x, y: planned.y } };
    }
    const before = framesRef.current[0] ?? null;
    const out = await execute(pin ? { ...j.step, ...pin } : j.step, label, budget, dryRun, j.proposal);
    if (out.paused) {
      updateStep(i, { status: 'pending' });
      addLog(label, `${planned.name}: ${out.message}`, 'warn');
      return out;
    }
    applyOutcome(i, out, dryRun, before);
    addLog(label, `${planned.name}: ${out.message}`, out.ok ? 'ok' : 'error');
    trackFailure(planned, out);
    return out;
  };

  /**
   * Replay: every step through the grounded pipeline (template drift check, AI target check,
   * dispatch, re-verify). Self-test, or any run while disarmed, verifies but sends nothing.
   */
  const replay = async (selfTest = false) => {
    await runReplay(selfTest, { label: selfTest ? 'Self-test' : 'Replay', goal: runGoalOf() });
  };

  /** droid-new's half of a joint operation: calculate plans the steps, perform runs them as the replay pipeline does. */
  const jointLocal = async (role: JointRole, text: string): Promise<ResultPayload> => {
    if (role === 'calculate') {
      const planned = await autoPlan(text);
      return { ok: planned, message: planned ? `planned ${stepsText(stepsRef.current)}` : 'no plan made' };
    }
    const out = await runReplay(!armedRef.current, { label: JOINT_SOURCE, goal: text });
    return out ? { ok: !out.stopped && out.ok === out.total, message: `${out.ok}/${out.total} step(s) ${out.dryRun ? 'verified (dry run)' : 'executed'}` } : { ok: false, message: 'run refused before any step' };
  };

  /** Whether the desktop bridge answers its health check; a failure is logged and captured. */
  const bridgeReady = async (label: string): Promise<boolean> => {
    const health = await checkBridge(settingsRef.current.bridgeUrl, settingsRef.current.bridgeToken);
    setBridgeOnline(health.ok);
    if (health.ok) return true;
    addLog(label, `${health.message} — no step was executed`, 'error');
    captureError({ kind: 'bridge', message: health.message, goal: goalRef.current });
    return false;
  };

  /**
   * How the current source runs a run's steps, or null with the refusal logged: no source, or the
   * main-app mirror without its main app. Whether the desktop bridge must answer is `needsBridge`
   * (bridge screenshots or real input on the local screen); captured-frame dry runs need no bridge.
   */
  const runPlan = (label: string, dryRun: boolean): StepPlan | null => {
    const plan = stepPlan(sourceRef.current, { dryRun, bridgeUrl: settingsRef.current.bridgeUrl });
    if (!plan) addLog(label, NO_SOURCE, 'error');
    else if (plan.input === 'main-app' && mainBridgeRef.current?.state().status !== 'connected') addLog(label, `${NOT_CONNECTED} — no step was executed`, 'error');
    else return plan;
    return null;
  };

  /** Starts a run: clears the stop flag and the per-run memory and shows the run as replaying. */
  const beginRun = () => {
    abortRef.current = false;
    retryCountsRef.current = new Map();
    runStartRef.current = Date.now();
    reproposedRef.current = new Set();
    escalatedRef.current = new Set();
    replayingRef.current = true;
    setReplaying(true);
  };

  /** Ends a run: no active step, not replaying. */
  const endRun = () => {
    setActiveIndex(null);
    runGoalRef.current = '';
    replayingRef.current = false;
    setReplaying(false);
  };

  /**
   * The replay pipeline shared by the Replay buttons and triggered runs. `label` names the run in the
   * log and `goal` is what auto-continue verifies. Resolves the steps verified or executed, or null
   * when the run was refused before any step (nothing to run, ABORTED, bridge down).
   */
  const runReplay = async (selfTest: boolean, { label, goal: runGoal }: { label: string; goal: string }): Promise<RunOutcome | null> => {
    if (!stepsRef.current.length) {
      addLog(label, 'Nothing to replay — record or plan a workflow first', 'warn');
      return null;
    }
    if (abortedRef.current) {
      addLog('Safety', refusedWhileAborted(label), 'error');
      return null;
    }
    const dryRun = selfTest || !armedRef.current;
    const plan = runPlan(label, dryRun);
    if (!plan || (plan.needsBridge && !(await bridgeReady(label)))) return null;
    if (dryRun && !selfTest) addLog('Safety', `Real input disarmed — ${label} runs as a ${DRY_RUN}`, 'warn');
    remindFailures(runGoal, label);
    const budget = createBudget(settingsRef.current.actionBudget);
    runGoalRef.current = runGoal;
    beginRun();
    abortRef.current = false;
    traceRun(runGoal);
    void autoProposeSections();
    runStartRef.current = Date.now();
    reproposedRef.current = new Set();
    replayingRef.current = true;
    setReplaying(true);
    const shots: Frame[] = [];
    const looping = continueEnabled() && !selfTest;
    const { ran, ok } = looping ? await continueToGoal(runGoal, budget, dryRun, label, shots) : await runSteps(budget, dryRun, label, shots);
    endRun();
    const picks = shots.map((f, i) => ({ f, score: i === 0 ? 1 : frameDistance(shots[i - 1].data, f.data) })).sort((a, b) => b.score - a.score).slice(0, 3).map((p) => p.f);
    if (picks.length) setPinned(picks);
    picks.forEach((f) => preferFrame(f, MAIN_AI, 'most informative change of the run'));
    if (!dryRun && runGoal.trim()) setObjectives((g) => settleGoal(g, runGoal, ok === ran.length && ran.length > 0));
    if (candidatesRef.current.length) {
      addLog(label, `Run paused — ${candidatesRef.current.length} aggressive candidate(s) wait for your Apply; not reviewed or learned from as a failure`, 'info');
      return { ok, total: ran.length, dryRun, stopped: abortRef.current };
    }
    if (stageOn('goal')) {
      const total = ran.length;
      const what = dryRun ? 'verified on screen (not dispatched)' : 'executed';
      addLog('Goal reviewer', ok === total ? `All ${total} steps ${what}${runGoal ? ` for "${runGoal}"` : ''}` : `${ok}/${total} ${what} — re-plan the failed steps or let AI help clear blockers`, ok === total ? 'ok' : 'warn');
      kb.recordFor('goal', 'result', `${ok}/${total} step(s) ${what}`, ok === total);
      for (const s of kb.suggestions(goalRef.current)) {
        addLog('Goal reviewer', `Suggestion: ${s}`, 'info');
        kb.recordFor('goal', 'note', `Suggestion: ${s}`);
      }
    }
    if (!abortRef.current) await confirmGoal(runGoal, ran, dryRun);
    // ■ Stop or a spent action budget both end the run as stopped (callers hold, never retry, a stopped run).
    const stopped = abortRef.current || (!dryRun && budget.used >= budget.limit && ok < ran.length);
    await learnFromRun(ran, { dryRun, stopped });
    await superviseRun();
    if (!stopped) await autoSideTests();
    return { ok, total: ran.length, dryRun, stopped };
  };

  /**
   * Holds a pack/workflow run between steps while dispatch is paused (Watching mode, AI-down breaker),
   * logging each new reason once; false when Stop or ABORTED ended the wait.
   */
  const waitWhilePaused = async (label: string): Promise<boolean> => {
    const ended = () => abortRef.current || abortedRef.current;
    let logged: string | null = null;
    for (let why = dispatchPaused(); why && !ended(); why = dispatchPaused()) {
      if (why !== logged) addLog(label, `Run ${why} — waiting before the next step`, 'warn');
      logged = why;
      await sleep(PAUSE_POLL_MS);
    }
    if (logged && !ended()) addLog(label, 'Run resumed — dispatching the next step', 'ok');
    return !ended();
  };

  /** One pass over the current steps in order, checking abortRef between steps. */
  const runSteps = async (budget: ActionBudget, dryRun: boolean, label: string, shots: Frame[]): Promise<RunReport & { ok: number }> => {
    stepsRef.current = stepsRef.current.map((st) => ({ ...st, status: 'pending' as const }));
    setSteps(stepsRef.current);
    const moved: MovedElement[] = [];
    let ok = 0;
    addLog(label, dryRun ? `Verifying ${stepsRef.current.length} step(s) on the live screen — no input is sent` : `Performing ${stepsRef.current.length} step(s) as real input`);
    for (let i = 0; i < stepsRef.current.length && !abortRef.current; i++) {
      if (!(await waitWhilePaused(label))) break;
      const out = await replayStep(i, budget, dryRun, label);
      if (out.paused) {
        i--;
        continue;
      }
      if (out.ok) ok++;
      if (out.shot) shots.push(out.shot);
      if (out.moved) moved.push(out.moved);
      if (out.halt) return { ran: stepsRef.current, halt: out.message, ok };
    }
    // An arrangement the verification pass did not confirm is a failed run: never saved as a reusable flow.
    const arranged = moved.length ? await verifyRearrangement(moved, label) : true;
    if (!arranged) stepsRef.current = stepsRef.current.map((s) => (s.action === 'drag' ? { ...s, status: 'failed' as const } : s));
    return { ran: stepsRef.current, halt: null, ok };
  };

  /** Whether runs continue until the goal is verified: the setting, its loop stage, and the AI to verify with. */
  const continueEnabled = () => settingsRef.current.autoContinue && stageOn('autoContinue') && aiOnline();

  /** The goal a run verifies: the goal text, else the draft card's description or name, else the plan's steps. */
  const runGoalOf = () => goalRef.current.trim() || draftCard?.description.trim() || draftCard?.name.trim() || `Complete the plan: ${stepsText(stepsRef.current)}`;

  /** Auto-continue check: the model verifies the goal on the live frame; timeline + log. */
  const checkGoal = async (runGoal: string, ran: WorkflowStep[], n: number): Promise<GoalCheck> => {
    const check = await thought(`Verify goal #${n + 1}: ${runGoal}`, () => verifyGoal(askFor('autoContinue'), framesRef.current[0] ?? null, runGoal, ran), goalSummary);
    addLog('Auto-continue', `Iteration ${n + 1} check: ${goalSummary(check)}`, check.complete ? 'ok' : 'info');
    return tracer.check(check);
  };

  /**
   * The Goal tracer's completion check at a run's end: when every traced step is verified and no goal check
   * was made, it confirms the goal on the live screen (its own stage, so unchecking it cancels the call).
   */
  const confirmGoal = async (runGoal: string, ran: WorkflowStep[], dryRun: boolean) => {
    const g = tracer.active();
    if (!g || dryRun || g.progress < 100 || g.lastCheck || !aiOnline()) return;
    try {
      tracer.check(await verifyGoal(askFor('goalTracer'), framesRef.current[0] ?? null, runGoal, ran));
    } catch (error) {
      addLog('Goal tracer', aiFailure(`AI unavailable — completion of "${runGoal}" not confirmed on screen`, error), 'warn');
    }
  };

  /** Auto-continue re-plan: the model plans the remaining steps, which become the next run; timeline + log. */
  const planNext = async (runGoal: string, ran: WorkflowStep[], check: GoalCheck, n: number) => {
    const plan = await thought(`Continue #${n}: ${runGoal}`, () => planRemaining(askFor('planner'), runGoal, framesRef.current[0] ?? null, ran, check.reason, patternsRef.current, capabilityPrompt(capabilities.registry.list, AI)), (r) => `${r.steps.length} step(s): ${stepsText(r.steps)}`);
    await runAiRequests(plan.capabilities);
    stepsRef.current = plan.steps;
    setSteps(plan.steps);
    tracer.emit({ kind: 'plan', steps: plan.steps, append: true });
    addLog('Auto-continue', `Iteration ${n} plan: ${plan.steps.length} step(s) — ${stepsText(plan.steps)}`, 'info');
  };

  /**
   * Replay with auto-continue: run, verify the goal, re-plan the rest and run again until the goal
   * is verified, the budget or abort stops it, two checks show no progress, or the cap is reached.
   * Resolves every step run across the iterations.
   */
  const continueToGoal = async (runGoal: string, budget: ActionBudget, dryRun: boolean, label: string, shots: Frame[]) => {
    const all: WorkflowStep[] = [];
    let ok = 0;
    setContinuing(true);
    try {
      const result = await autoContinue({
        maxIterations: settingsRef.current.maxIterations,
        aborted: () => abortRef.current,
        run: async () => {
          const r = await runSteps(budget, dryRun, label, shots);
          all.push(...r.ran);
          ok += r.ok;
          return r;
        },
        verify: (ran, n) => checkGoal(runGoal, ran, n),
        plan: (ran, check, n) => planNext(runGoal, ran, check, n),
      });
      addLog('Auto-continue', `Stopped after ${result.iterations} continuation(s): ${result.detail}`, STOP_TONE[result.stop]);
    } catch (error) {
      addLog('Auto-continue', aiFailure('AI unavailable — auto-continue stopped', error), 'error');
    } finally {
      setContinuing(false);
    }
    return { ran: all, ok };
  };

  /** Full-screen reading of `frame`: every detectable element, classified against the previous reading. */
  const readScreen = (frame: Frame) => {
    const next = buildInventory({ frame, mapped: elementMapRef.current, familiar: familiarRef.current, prev: inventoryRef.current, prevFrame: inventoryFrameRef.current });
    inventoryRef.current = next;
    inventoryFrameRef.current = frame;
    setInventory(next);
  };

  const commitProfiles = (next: RouteProfile[]) => {
    routeProfilesRef.current = next;
    setRouteProfiles(next);
  };

  /** Plots ranked routes to `text` (the goal by default) from the screen reading and the saved access paths. */
  const plotRoute = (text = goalRef.current): Route[] => {
    const next = text.trim() ? plotRoutes(text, inventoryRef.current, routeProfilesRef.current) : [];
    routesRef.current = next;
    setRoutes(next);
    addLog('Routes', next.length ? `${next.length} route(s) to "${text.trim()}": ${next.map(routeText).join(' | ')}` : `No route to "${text.trim()}" in the screen reading — use AI plan for fresh grounding`, next.length ? 'info' : 'warn');
    return next;
  };

  /** A route as steps at their elements' current positions; a hop gone from the screen is left to fresh grounding. */
  const routeToSteps = (route: Route): WorkflowStep[] => routeSteps(route).map((s, i) => {
    const where = resolveHop(route.hops[i], inventoryRef.current);
    return where.kind === 'inventory' ? { ...s, x: where.x, y: where.y } : { ...s, unlocated: true };
  });

  /** Runs plotted route `index` through the replay pipeline; a real run that reaches the goal is saved as its access-path profile. */
  const runRoute = async (index = 0) => {
    const route = routesRef.current[index];
    const text = goalRef.current.trim();
    if (!route || !text) {
      addLog('Routes', 'Type a goal and plot a route first', 'warn');
      return;
    }
    applyPlan(text, routeToSteps(route), `Route ${routeText(route)}`);
    const out = await runReplay(false, { label: 'Route', goal: text });
    if (!out) return;
    autoRouteTest(route);
    if (out.dryRun) return;
    const ok = !out.stopped && out.total > 0 && out.ok === out.total;
    commitProfiles(ok ? recordProfileResult(saveProfile(routeProfilesRef.current, text, route.hops), text, true) : recordProfileResult(routeProfilesRef.current, text, false));
    addLog('Routes', ok ? `Route reached "${text}" — saved as its access-path profile` : `Route did not reach "${text}" — its profile records the miss`, ok ? 'ok' : 'warn');
  };

  const commitFixMethods = (next: FixMethod[]) => {
    fixMethodsRef.current = next;
    setFixMethods(next);
  };

  const showFix = (script: FixScript | null) => {
    pendingFixRef.current = script;
    setPendingFix(script);
  };

  /** Generates the fix script for a stuck element/flow (memory → AI → local) and holds it for review. */
  const proposeFix = async (ctx: FixContext) => {
    const ask = aiOnline() && stageOn('executor') ? askFor('executor') : null;
    const script = await generateFixScript(ctx, fixMethodsRef.current, ask, framesRef.current[0] ?? null, inventoryLines(inventoryRef.current));
    if (!script) return addLog('Fix script', `"${ctx.element}" failed ${FAIL_THRESHOLD}× in a row (${ctx.problem}) — AI unavailable and no saved fix method — no fix script proposed`, 'error');
    showFix(script);
    addLog('Fix script', `"${ctx.element}" failed ${FAIL_THRESHOLD}× in a row (${ctx.problem}) — proposed ${fixScriptText(script)}; review it in the pre-action briefing before it runs`, 'warn');
  };

  /** Counts a step's result per element/flow; at FAIL_THRESHOLD failures in a row a fix script is proposed. A guardrail refusal is not counted. */
  const trackFailure = (step: WorkflowStep, out: Performed) => {
    if (out.halt && !out.executed) return;
    const ctx: FixContext = { element: step.target ?? step.name, flow: goalRef.current.trim() || 'current flow', problem: out.message };
    const k = failureKey(ctx.element, ctx.flow);
    const failedBefore = (failuresRef.current[k] ?? 0) > 0;
    failuresRef.current = noteResult(failuresRef.current, k, out.ok);
    if (out.ok && failedBefore && out.executed) rememberCorrection(ctx, step);
    if (needsFix(failuresRef.current, k) && !pendingFixRef.current) void proposeFix(ctx);
  };

  /** A step that really succeeded after failing on the same element and flow is remembered as its fix method (workarounds stage). */
  const rememberCorrection = (ctx: FixContext, step: WorkflowStep) => {
    if (!stageOn('workarounds')) return;
    commitFixMethods(saveFixMethod(fixMethodsRef.current, correctionFix(ctx, step), true));
    addLog('Fix script', `Corrected approach for "${ctx.element}" resolved the obstacle — remembered as its fix method`, 'ok');
  };

  /** One fix step through the pre-action briefing and the normal grounded pipeline. */
  const runFixStep = async (step: WorkflowStep, budget: ActionBudget, dryRun: boolean): Promise<Performed> => {
    const j: Justified = await justify('Fix script', step, false).catch((error: unknown) => ({ kind: 'fail' as const, reason: `No proposal for "${step.name}": ${errorText(error)} — not executed` }));
    if (j.kind !== 'go') {
      addLog('Fix script', j.reason, 'error');
      return { ok: false, executed: false, message: j.reason, target: { x: step.x, y: step.y } };
    }
    const out = await execute(j.step, 'Fix script', budget, dryRun, j.proposal);
    addLog('Fix script', `${step.name}: ${out.message}`, out.ok ? 'ok' : 'error');
    return out;
  };

  /** Runs every step of `script` in order until one fails, the run halts or Stop is pressed; true when all passed. */
  const runFixSteps = async (script: FixScript, budget: ActionBudget, dryRun: boolean) => {
    for (const step of script.steps) {
      if (abortRef.current) return false;
      const out = await runFixStep(step, budget, dryRun);
      if (!out.ok || out.halt) return false;
    }
    return true;
  };

  /** Runs the reviewed fix script inside the guardrails (ABORTED, arm/disarm, budget, executor stage); a real success is saved as the fix method. */
  const runFixScript = async () => {
    const script = pendingFixRef.current;
    if (!script) return;
    if (abortedRef.current || replayingRef.current) {
      addLog('Safety', abortedRef.current ? refusedWhileAborted('Fix script') : 'Fix script waits — a run is in progress', 'error');
      return;
    }
    showFix(null);
    const dryRun = !armedRef.current;
    if (dryRun) addLog('Safety', `Real input disarmed — the fix script runs as a ${DRY_RUN}`, 'warn');
    abortRef.current = false;
    replayingRef.current = true;
    setReplaying(true);
    const ok = await runFixSteps(script, createBudget(settingsRef.current.actionBudget), dryRun).finally(() => {
      replayingRef.current = false;
      setReplaying(false);
    });
    if (!dryRun) commitFixMethods(saveFixMethod(fixMethodsRef.current, script, ok));
    if (ok) failuresRef.current = noteResult(failuresRef.current, failureKey(script.context.element, script.context.flow), true);
    addLog('Fix script', `${ok ? 'Repaired' : 'Did not repair'} "${script.context.element}"${dryRun ? ' (dry run — not saved)' : ok ? ' — saved as its fix method' : ''}`, ok ? 'ok' : 'error');
    if (ok && !dryRun && !abortedRef.current) {
      addLog('Retest', `Retesting the flow after the repair of "${script.context.element}"`, 'info');
      await retestFlow();
    }
  };

  /** Drops the fix script under review without running it. */
  const dismissFix = () => {
    if (pendingFixRef.current) addLog('Fix script', `Dismissed the fix for "${pendingFixRef.current.context.element}"`, 'info');
    showFix(null);
  };

  /** One retested step: re-pointed to the live screen, its covering popup noted, then replayed. */
  const retestStep = async (s: WorkflowStep, i: number, budget: ActionBudget, dryRun: boolean) => {
    updateStep(i, s);
    const obstacle = coveredBy(popupRef.current, s) ? 'a popup covers the target' : null;
    const out = await replayStep(i, budget, dryRun, 'Retest');
    return { ok: out.ok, executed: out.executed || (dryRun && out.ok), message: out.message, halt: !!out.halt || abortRef.current, obstacle };
  };

  /** Feeds a retest into habits (one outcome per executed step, its obstacle as a lesson) and run statistics. */
  const recordRetest = (flow: WorkflowStep[], results: RetestStepResult[], dryRun: boolean) => {
    const context = habitContext();
    if (stageOn('coords')) commitHabits(results.filter((r) => r.executed).reduce((h, r) => recordOutcome(h, { target: r.target, context, success: r.ok, avoid: r.ok ? null : r.obstacle }), habitsRef.current));
    const ran = new Set(results.map((r) => r.index));
    recordRun(`Retest: ${goalRef.current.trim() || 'flow'}`, retestedSteps(flow, results).filter((_, i) => ran.has(i)), { dryRun, stopped: abortRef.current });
  };

  /**
   * Route back: re-runs the whole flow (or the selected 0-based steps) for retesting, each step
   * brought up to date with the screen reading (moved elements, popups) first; per-step results and
   * a pass/fail summary go to the Retest panel, habits and run statistics.
   */
  const retestFlow = async (indices: number[] = []) => {
    const flow = stepsRef.current;
    if (!flow.length || abortedRef.current || replayingRef.current) {
      addLog('Retest', !flow.length ? 'Nothing to retest — record or plan a flow first' : abortedRef.current ? refusedWhileAborted('Retest') : 'Retest waits — a run is in progress', 'warn');
      return null;
    }
    const selected = selectSteps(flow.length, indices);
    const dryRun = !armedRef.current;
    const budget = createBudget(settingsRef.current.actionBudget);
    abortRef.current = false;
    runStartRef.current = Date.now();
    replayingRef.current = true;
    setReplaying(true);
    addLog('Retest', `Routing back over ${selected.length} of ${flow.length} step(s)${dryRun ? ` as a ${DRY_RUN}` : ''}`);
    const results = await runRetest(flow, selected, { prepare: (s) => refreshStep(s, inventoryRef.current), perform: (s, i) => retestStep(s, i, budget, dryRun) }).finally(() => {
      setActiveIndex(null);
      replayingRef.current = false;
      setReplaying(false);
    });
    const summary = retestSummary(results, selected.length);
    setRetest({ results, summary });
    recordRetest(flow, results, dryRun);
    const obstacles = results.filter((r) => r.obstacle).map((r) => `step ${r.index + 1}: ${r.obstacle}`);
    addLog('Retest', `${retestText(summary)}${obstacles.length ? ` — obstacles: ${obstacles.join('; ')}` : ''}`, summary.pass ? 'ok' : 'error');
    return summary;
  };

  /** Replay's ■ Stop: ends the run between steps and cancels the in-flight AI call. */
  const stop = () => {
    abortRef.current = true;
    trainStopRef.current = true;
    cancelAi();
    wake.cancel('stopped by user');
    addLog(subRunningRef.current ? 'Supervisor' : 'Replay', subRunningRef.current ? 'Stopped by user — the running subagent ends and the rest are aborted' : 'Stopped by user', 'warn');
  };

  /** AI Stop: the emergency-stop path, which also cancels the in-flight model call. */
  const stopAi = () => triggerAbort('AI stop button');

  /** The coordinated crew the main AI commands: sentinels, path checkers, adjusters, test runners and monitors. */
  const crew = useCrew({
    crewSize: settings.crewSize,
    goal,
    steps,
    history,
    addLog,
    performStep,
    newBudget: () => createBudget(settingsRef.current.actionBudget),
    isArmed: () => armedRef.current,
    hasFrames: () => framesRef.current.length > 0,
    knowledge,
    stopRun: stop,
    sendResult: (requester, element, report) => {
      const to: BusAgentId = (BUS_AGENT_IDS as string[]).includes(requester) && requester !== 'supervisor' ? (requester as BusAgentId) : 'goal';
      const { bus: next, queued } = forward(busRef.current, 'supervisor', element, [to]);
      busRef.current = queued.reduce((b, m) => markHandled(b, m.id, `Crew test result for ${requester}: ${report}`), next);
      setBus(busRef.current);
      note({ step: `Crew test for ${requester}: "${element.name}"`, kind: 'test', text: report, thinking: null });
    },
  });
  useEffect(() => {
    crewApiRef.current = crew;
  });
  /**
   * Stop plan: halts the current plan, agent crew and live drag — the run-stop flag is set, in-flight
   * and queued AI calls are cancelled, crew agents park and a live drag releases the mouse — without
   * disarming, latching ABORTED, turning Auto Act off or stopping the monitor and the watchers.
   */
  const stopPlan = () => {
    abortRef.current = true;
    cancelAi();
    if (liveDragRef.current) dragControlRef.current = { kind: 'release' };
    addLog('Stop plan', `Plan stopped by user — in-flight AI calls cancelled${crewRunningRef.current ? ', crew agents parked' : ''}${liveDragRef.current ? ', live drag released' : ''}; real input stays ${armedRef.current ? 'armed' : 'disarmed'}, monitor and watchers keep running`, 'warn');
  };

  /** User intervention in a live drag: re-aim the drop point, or (null) release at once. */
  const interveneDrag = (point: { x: number; y: number } | null) => {
    if (!liveDragRef.current) return addLog('Live drag', 'No live drag in progress — nothing to adjust', 'warn');
    dragControlRef.current = point ? { kind: 'aim', point } : { kind: 'release' };
    addLog('Live drag', point ? `User re-aims the drop point to ${at(point.x, point.y)}` : 'User releases the drag now', 'warn');
  };

  /** The crew run must stop: Stop plan, abort, or the crew or planner stage unchecked. */
  const crewStopped = () => abortRef.current || abortedRef.current || !stageOn('crew') || !stageOn('planner');

  /** An agent report goes to the Screen watcher notes. */
  const noteCrewReport = (report: CrewReport) => {
    const merged = mergeNotes(watcherRef.current.notes, [reportNote(report)], Date.now());
    updateWatcher((w) => ({ ...w, notes: merged.notes }));
    addLog('Agent crew', `${report.agent} reports on "${report.task}": ${report.found}`, report.ok ? 'ok' : 'warn');
  };

  /**
   * One crew agent works one command on its own thread: it plans the task on the live frame through
   * its own 'crew' AI call, then runs each step grounded through the guarded pipeline — its real input
   * serialized behind the screen lock — and reports what it found.
   */
  const runCrewAgent = async (command: CrewCommand, budget: ActionBudget, dryRun: boolean): Promise<CrewReport> => {
    const label = `Crew ${command.agent}`;
    const report = (ok: boolean, found: string, point?: { x: number; y: number }): CrewReport => ({ agent: command.agent, task: command.task, ok, found, ...(point ? { point } : {}) });
    const plan = await thought(`${label}: ${command.task}`, () => planFromGoal(command.task, [], framesRef.current[0] ?? null, askFor('crew'), knownRef.current.map(elementLine), patternsRef.current), planSummary);
    if (!plan.steps.length) return report(true, plan.thinking ?? 'nothing to act on — the task needs no input');
    let point: { x: number; y: number } | undefined;
    for (const step of plan.steps) {
      if (crewStopped()) return report(false, `parked before "${step.name}" — nothing more sent`, point);
      const out = await screenLockRef.current(async () => {
        const local = recordLocal(label, step, `the main AI asked ${command.agent} to "${command.task}"`);
        const briefed = await brief(label, { kind: 'go', step, proposal: local });
        return briefed.kind === 'go' ? execute(briefed.step, label, budget, dryRun, briefed.proposal) : refused(step, `"${step.name}" not justified by the pre-action briefing`);
      });
      if (!out.ok) return report(false, `${step.name}: ${out.message}`, point);
      point = out.target;
    }
    return report(true, `${plan.steps.length} step(s) ${dryRun ? `verified (${DRY_RUN})` : 'done'}: ${stepsText(plan.steps)}`, point);
  };

  /** Log tone of each way a crew run ends. */
  const CREW_TONE: Record<CrewStop, LogEntry['tone']> = { done: 'ok', stopped: 'warn', cap: 'warn', stalled: 'warn' };

  /**
   * "/crew <goal>": the AI-directed command loop. The main AI (planner stage) thinks, commands crew
   * agents, they work in parallel (each with its own queued AI call and grounding) and report back,
   * then wait for its next command — until done, stalled, Max iterations rounds, or Stop plan / abort.
   */
  const runCrewGoal = async (text: string) => {
    if (abortedRef.current) return addLog('Agent crew', refusedWhileAborted('Crew'), 'error');
    if (crewRunningRef.current) return addLog('Agent crew', 'A crew run is already going', 'warn');
    if (!stageOn('crew') || !stageOn('planner')) return addLog('Agent crew', `${stageOff(stageOn('crew') ? 'planner' : 'crew')} — no crew run`, 'warn');
    const dryRun = !armedRef.current;
    const budget = createBudget(settingsRef.current.actionBudget);
    abortRef.current = false;
    crewRunningRef.current = true;
    setCrewRunning(true);
    addLog('Agent crew', `Crew of ${CREW_AGENTS.length} for "${text}"${dryRun ? ' (real input disarmed: dry run)' : ''}`, 'info');
    try {
      await withAi(async () => {
        const out = await runCrew({
          agents: CREW_AGENTS,
          maxRounds: settingsRef.current.maxIterations,
          decide: (reports, round) => thought(`Crew round ${round}: ${text}`, () => decideCrew(askFor('planner'), framesRef.current[0] ?? null, text, crewRef.current, reports), (d: CrewDecision) => `${d.done ? 'DONE' : `${d.commands.length} command(s)`}: ${d.commands.map((c) => `${c.agent} → ${c.task}`).join('; ') || d.summary}`),
          work: (c) => runCrewAgent(c, budget, dryRun),
          shouldStop: crewStopped,
          onAgents: (agents) => {
            crewRef.current = agents;
            setCrewAgents(agents);
          },
          onReport: noteCrewReport,
          onDecision: (d, round) => {
            if (d.ignored.length) addLog('Agent crew', `Round ${round}: ignored command(s) for ${d.ignored.join(', ')} (unknown agent or a second command)`, 'warn');
          },
        });
        addLog('Agent crew', `Crew ${out.stop} after ${out.rounds} round(s), ${out.reports.length} report(s) — ${out.summary}`, CREW_TONE[out.stop]);
      });
    } catch (error) {
      addLog('Agent crew', aiFailure('AI unavailable — crew stopped', error), 'error');
    } finally {
      crewRunningRef.current = false;
      setCrewRunning(false);
    }
  };

  /** Runs `fn` with the AI busy flag set. */
  const withAi = async (fn: () => Promise<void>) => {
    setAiBusy(true);
    try {
      await fn();
    } finally {
      setAiBusy(false);
    }
  };

  /** Applies one change to the Operations state. */
  const updateOps = (fn: (s: OpsState) => OpsState) => {
    opsRef.current = fn(opsRef.current);
    setOps(opsRef.current);
  };

  /**
   * One Operations agent's report: kept with its operation, logged under the agent's name, and put on
   * the bus (Screen watcher and Supervisor) when it acted at a point.
   */
  const recordOpsReport = (agent: OpsAgentId, task: string, r: OpsWorkResult) => {
    const op = operationNow();
    updateOps((s) => addOpsReport(s, { agent, task, ok: r.ok, found: r.found, op }));
    addLog(opsAgent(agent).name, `Report on "${task}": ${r.found}`, r.ok ? 'ok' : 'warn');
    if (r.point) forwardElement('operations', { name: `${opsAgent(agent).name}: ${task}`, ...r.point }, ['screen', 'supervisor']);
  };

  /** Stages doing work right now, for the Loop-control agent's report. */
  const runningStages = (): StageId[] => {
    const busy: Array<[StageId, boolean]> = [
      ['executor', executorBusy()], ['planner', planningRef.current], ['crew', crewRunningRef.current], ['screenWatcher', watchBusyRef.current],
      ['supervisor', supervisorBusyRef.current], ['identify', identifyBusyRef.current], ['subagents', subRunningRef.current],
      ...OPS_AGENTS.map((a): [StageId, boolean] => [a.stage, opsRef.current.agents.some((x) => x.id === a.id && x.status === 'working')]),
    ];
    return busy.filter(([, on]) => on).map(([id]) => id);
  };

  /** Everything the testing agent can name: watcher proposals, mapped, familiar and bus-known elements. */
  const testCandidates = (): TestCandidate[] => [
    ...watcherRef.current.proposals.flatMap((p) => (p.target && p.x !== undefined && p.y !== undefined ? [{ name: p.target, x: p.x, y: p.y, proposalId: p.id }] : [])),
    ...elementMapRef.current.map((m) => ({ name: m.name, ...boxCenter(m.box) })),
    ...familiarRef.current.map((f) => ({ name: f.name, x: f.x, y: f.y })),
    ...knownRef.current.map((k) => ({ name: k.name, x: k.x, y: k.y })),
  ];

  /** Why Operations work must not start: abort or Stop plan; null when it may. */
  const opsHalted = (): string | null => {
    if (abortedRef.current) return 'Aborted';
    return abortRef.current ? 'Plan stopped' : null;
  };

  /** A fresh frame for evidence: the demo canvas as it is now, else a bridge screenshot or the newest monitor frame. */
  const evidenceFrame = async (): Promise<Frame | null> => (sourceRef.current === 'demo' ? demoSnapshot() : liveFrame());

  /** The Operations agents wired to the engine; every dispatch goes through the same guarded pipeline as any step. */
  const opsWorker = createOpsWorkers({
    op: operationNow,
    stageOn,
    halted: opsHalted,
    report: recordOpsReport,
    lastChange: () => opsChangeRef.current,
    mapNames: () => elementMapRef.current.map((m) => m.name),
    log: () => logRef.current,
    candidates: testCandidates,
    test: (step, proposalId, dryRun) => testStep(step, { proposalId, context: step.target ?? step.name, source: 'Testing agent' }, dryRun, opsBudgetRef.current),
    armed: () => armedRef.current,
    plan: async (task) => (await thought(`Apply agent: ${task}`, () => planFromGoal(task, [], framesRef.current[0] ?? null, askFor('opsApply'), knownRef.current.map(elementLine), patternsRef.current), planSummary)).steps,
    apply: (step) => screenLockRef.current(async () => {
      const local = recordLocal(OPS_APPLY_ACTOR, step, `the main AI asked the Apply agent to apply "${step.name}"`);
      const briefed = await brief(OPS_APPLY_ACTOR, { kind: 'go', step, proposal: local });
      return briefed.kind === 'go' ? execute(briefed.step, OPS_APPLY_ACTOR, opsBudgetRef.current, !armedRef.current, briefed.proposal) : refused(step, `"${step.name}" not justified by the pre-action briefing`);
    }),
    capture: evidenceFrame,
    store: (f) => void putStoredFrame(toStoredFrame(f), settingsRef.current.gallerySize).catch(() => undefined),
    addEvidence: (e) => {
      updateOps((s) => addEvidence(s, e));
      return opsRef.current.evidence[0].id;
    },
    markEvidence: (id, verdict) => updateOps((s) => markEvidence(s, id, verdict)),
    correct: (ref, live, p) => correctDrift(ref.data, live.data, p.x, p.y, live.srcW, live.srcH, driftThresholds()),
    replan: async (step, why) => {
      addLog('Reapply agent', `Escalating "${step.name}" to the main AI for a re-plan — ${why}`, 'warn');
      return replanFailed(step, why);
    },
    retries: () => settingsRef.current.stepRetries ?? DEFAULT_STEP_RETRIES,
    stages: () => settingsRef.current.stages,
    running: runningStages,
    toggle: toggleStage,
    place: (command) => placeWindow(command),
    lastApplied: opsAppliedRef,
  });

  /** One command to one Operations agent: it works (status working), reports, then waits for the next command. */
  const workOps = async (agent: OpsAgentId, task: string): Promise<OpsWorkResult> => {
    updateOps((s) => patchOpsAgent(s, agent, { status: 'working', task }));
    const r = await opsWorker(agent, task);
    recordOpsReport(agent, task, r);
    updateOps((s) => patchOpsAgent(s, agent, { status: opsHalted() ? 'parked' : 'waiting' }));
    return r;
  };

  /** The /ops run must stop: Stop plan, abort or the planner (main AI) unchecked. */
  const opsStopped = () => !!opsHalted() || !stageOn('planner');

  /**
   * "/ops <goal>": the main AI (planner stage) commands the enabled Operations agents in the crew loop —
   * assign → work → report → wait — until done, stalled, Max iterations rounds, or Stop plan / abort.
   * "/ops <agent>: <task>" commands one agent directly.
   */
  const runOps = async (text: string) => {
    if (abortedRef.current) return addLog('Operations', refusedWhileAborted('Operations'), 'error');
    if (opsRunningRef.current) return addLog('Operations', 'An Operations run is already going', 'warn');
    const target = parseOpsTarget(text);
    abortRef.current = false;
    opsBudgetRef.current = createBudget(settingsRef.current.actionBudget);
    opsRunningRef.current = true;
    setOpsRunning(true);
    try {
      if ('agent' in target) await workOps(target.agent, target.task);
      else await delegateOps(target.goal);
    } finally {
      opsRunningRef.current = false;
      setOpsRunning(false);
    }
  };

  /** The main AI's command loop over the enabled Operations agents. */
  const delegateOps = async (goalText: string) => {
    const roster = enabledOps(settingsRef.current.stages);
    if (!stageOn('planner') || !roster.length) return addLog('Operations', `${stageOn('planner') ? 'Every Operations agent is unchecked in Loop control' : stageOff('planner')} — no Operations run`, 'warn');
    operationRef.current = goalText;
    addLog('Operations', `Main AI delegates "${goalText}" to ${roster.length} Operations agent(s)${armedRef.current ? '' : ' (real input disarmed: dry run)'}`, 'info');
    try {
      await withAi(async () => {
        const out = await runCrew({
          agents: roster,
          maxRounds: settingsRef.current.maxIterations,
          decide: (reports, round) => thought(`Operations round ${round}: ${goalText}`, () => decideCrew(askFor('planner'), framesRef.current[0] ?? null, goalText, opsRef.current.agents.filter((a) => roster.includes(a.id as OpsAgentId)), reports, OPS_SYSTEM), (d: CrewDecision) => `${d.done ? 'DONE' : `${d.commands.length} command(s)`}: ${d.commands.map((c) => `${c.agent} → ${c.task}`).join('; ') || d.summary}`),
          work: async (c) => ({ agent: c.agent, task: c.task, ...(await opsWorker(c.agent as OpsAgentId, c.task)) }),
          shouldStop: opsStopped,
          onAgents: (agents) => updateOps((s) => ({ ...s, agents: s.agents.map((a) => agents.find((x) => x.id === a.id) ?? a) })),
          onReport: (r) => recordOpsReport(r.agent as OpsAgentId, r.task, r),
          onDecision: (d, round) => {
            if (d.ignored.length) addLog('Operations', `Round ${round}: ignored command(s) for ${d.ignored.join(', ')} (unknown or disabled agent, or a second command)`, 'warn');
          },
        });
        addLog('Operations', `Operations ${out.stop} after ${out.rounds} round(s), ${out.reports.length} report(s) — ${out.summary}`, CREW_TONE[out.stop]);
      });
    } catch (error) {
      addLog('Operations', aiFailure('AI unavailable — Operations run stopped', error), 'error');
    } finally {
      operationRef.current = null;
    }
  };

  /**
   * Monitor agent, on every new frame: a material change (DEFAULT_CHANGE_CELLS cells) is recorded and,
   * once per change, reported to the log and the bus with the mapped elements it touches; element-map
   * additions and removals are reported too.
   */
  const monitorFrame = (prev: Frame, frame: Frame) => {
    const map = elementMapRef.current;
    const names = map.map((m) => m.name);
    const delta = mapDelta(opsMapNamesRef.current, names);
    opsMapNamesRef.current = names;
    if (delta.added.length || delta.removed.length) addLog('Monitor agent', `Element map changed: ${delta.added.length ? `added ${delta.added.join(', ')}` : ''}${delta.added.length && delta.removed.length ? '; ' : ''}${delta.removed.length ? `removed ${delta.removed.join(', ')}` : ''}`, 'info');
    const change = monitorChange(prev.data, frame.data, map, settingsRef.current.changeCells);
    if (!change) return;
    opsChangeRef.current = change;
    const now = Date.now();
    if (!shouldReport(opsReportedRef.current, change, now)) return;
    opsReportedRef.current = { key: changeKey(change), time: now };
    addLog('Monitor agent', `Screen change: ${changeLine(change)}`, 'info');
    map.filter((m) => change.elements.includes(m.name)).forEach((m) => forwardElement('operations', { name: m.name, ...boxCenter(m.box), w: m.box.w, h: m.box.h }));
  };

  /** What the re-plan guard compares: the newest frame and how many step statuses execution changed. */
  const screenState = () => `${framesRef.current[0]?.id ?? 'none'}:${statusChangesRef.current}`;

  /** Applies a plan's steps as the current workflow and logs them (with the arrangement, when the goal asked for one). */
  const applyPlan = (text: string, planned: WorkflowStep[], why: string, arrangement = '') => {
    steerPrevious(text);
    stepsRef.current = planned;
    setSteps(planned);
    markPlan();
    tracer.begin({ goal: text, source: goalSource(text), steps: planned });
    setDraftCard(generateCard(planned, text));
    addLog('Planner', `${why}: ${planned.length} step(s) — ${planned.map((s) => `${s.action} "${s.target ?? s.name}"`).join(' → ')}${arrangement}${armedRef.current ? '' : ' (real input disarmed: replay / Auto Act run it as a dry run)'}`, 'ok');
    autoPlotRoutes(text);
  };

  /** A goal was set: plots candidate routes to it from the mapped elements and saved paths (planner stage), logged when one is found. */
  const autoPlotRoutes = (text: string) => {
    if (!stageOn('planner') || !text.trim()) return;
    const next = plotRoutes(text, inventoryRef.current, routeProfilesRef.current);
    if (!next.length) return;
    routesRef.current = next;
    setRoutes(next);
    addLog('Routes', `Auto-plotted ${next.length} route(s) to "${text.trim()}": ${next.map(routeText).join(' | ')}`, 'info');
  };

  /** Proposes screen sections while a run operates: AI online, a frame, the identify stage on, at most once per SECTIONS_AUTO_MS. */
  const autoProposeSections = async () => {
    if (!stageOn('identify') || !aiOnline() || !framesRef.current[0] || abortedRef.current) return;
    if (Date.now() - sectionsProposedAtRef.current < SECTIONS_AUTO_MS) return;
    sectionsProposedAtRef.current = Date.now();
    await proposeSections();
  };

  /**
   * AI plan: reuse a similar saved flow (drift-corrected), otherwise the model plans from the
   * goal + live frame with the reliable habits and learned patterns relevant to this goal as context.
   * The re-plan guard skips a plan already in flight, a goal whose re-plan came back identical,
   * and re-plans past the cap while the screen is unchanged.
   */
  const autoPlan = async (text = goal): Promise<boolean> => {
    if (!text.trim()) {
      addLog('Planner', 'Type a goal first', 'warn');
      return false;
    }
    if (!stageOn('planner')) {
      addLog('Planner', `${stageOff('planner')} — no plan made`, 'warn');
      return false;
    }
    if (planningRef.current) {
      addLog('Planner', `Re-plan guard: a plan for "${text.trim()}" is still being thought out — not starting another`, 'warn');
      return false;
    }
    const grounded = EXECUTION_MODES[settingsRef.current.executionMode].grounding === 'immediate' ? groundGoal(text, knowledge()) : null;
    if (grounded) {
      applyPlan(text, [grounded], 'Aggressive mode: grounded on a known element at once, no planner call');
      return true;
    }
    const gate = planGuardRef.current.before(text, screenState());
    if (!gate.run) {
      if (gate.log) addLog('Planner', `Re-plan guard: ${gate.log}`, 'warn');
      return false;
    }
    const applied = relevantHabits(text, habitContext(), habitsRef.current);
    if (applied.length) addLog('Habits', `Applying ${applied.length} habit(s) to planning: ${applied.map(habitLine).join(' | ')}`, 'info');
    remindFailures(text, 'Planner');
    const paths = relevantPaths(text, habitContext(), accessPathsRef.current);
    if (paths.length) addLog('Access paths', `Applying ${paths.length} saved path(s) to planning: ${paths.map(pathLine).join(' | ')}`, 'info');
    setObjectives((g) => startGoal(g, text));
    let planned = false;
    let requested: CapabilityRequest[] = [];
    planningRef.current = true;
    await withAi(async () => {
      try {
        const plan = await thought(`Plan: ${text}`, () => planFromGoal(text, cardsRef.current, framesRef.current[0] ?? null, askFor('planner'), [EXECUTION_MODES[settingsRef.current.executionMode].hint, ...worldLines(), ...knownInScope(), ...sectionContext(), ...trackingContext(elementMapRef.current), ...inventoryLines(inventoryRef.current), ...measuredRef.current, ...applied.map(habitLine), ...tracer.memory(text)], patternsRef.current, capabilityPrompt(capabilities.registry.list, AI)), planSummary);
        requested = plan.capabilities;
        if (!plan.steps.length) return;
        if (planGuardRef.current.after(plan.steps) === 'duplicate') {
          addLog('Planner', `Re-plan guard: the plan for "${text.trim()}" is identical to the previous one — kept the current steps and will not ask the model again until the screen or a step changes`, 'warn');
          return;
        }
        const { steps: next, source: why, expect } = plan;
        expectRef.current = expect;
        const arrangement = expect.length ? `; arrangement: ${expect.map((e) => `"${e.element}" ${e.relation.replace('_', ' ')} "${e.anchor}"`).join(', ')}` : '';
        applyPlan(text, next, why, arrangement);
        planned = next.length > 0;
        kb.recordAi('work', `Planned ${next.length} step(s) for "${text.trim()}" (${why})`);
        for (const a of agents.filter((x) => x.on)) kb.recordFor(a.id, 'work', `Assigned to "${text.trim()}": ${a.description}`);
        if (planned) savedOps.suggestFor(text);
      } catch (error) {
        addLog('Planner', aiFailure('AI plan failed — no steps created', error), 'error');
      } finally {
        planningRef.current = false;
      }
    });
    await runAiRequests(requested);
    return planned;
  };

  /**
   * "/arrange <goal>": the model plans the rearrangement as drags with the arrangement it asks for
   * (a saved drag flow is never reused: it carries no relations to verify), then it replays at once
   * with the move checks and the final verification pass.
   */
  const arrange = async (text: string) => {
    if (await autoPlan(text)) await replay();
  };

  /** "/move <target>": the model plans one move onto the target, which runs at once through the grounded pipeline. */
  const moveTo = async (name: string) => {
    if (!stageOn('planner')) {
      addLog('/move', `${stageOff('planner')} — nothing executed`, 'warn');
      return;
    }
    await withAi(async () => {
      try {
        const { steps: planned } = await thought(`/move ${name}`, () => planFromGoal(`Move the mouse cursor onto the ${name} (hover, do not click)`, [], framesRef.current[0] ?? null, askFor('planner'), [...sectionContext(), ...inventoryLines(inventoryRef.current)]), planSummary);
        const move = planned.find((s) => s.action === 'move');
        if (!move) {
          addLog('/move', `AI did not plan a mouse move to "${name}" (it proposed ${planned.map((s) => s.action).join(', ')}) — identifying it instead`, 'warn');
          await identifyAndTrack(name, { x: 0, y: 0, w: 1, h: 1 });
          return;
        }
        const step = { ...move, target: move.target ?? name };
        stepsRef.current = [step];
        setSteps(stepsRef.current);
        markPlan();
        const j = await justify('/move', step, false);
        if (j.kind !== 'go') {
          failUnjustified(0, '/move', j.reason);
          return;
        }
        const out = await perform(j.step, '/move', createBudget(settingsRef.current.actionBudget), !armedRef.current, j.proposal);
        applyOutcome(0, out, !armedRef.current);
        addLog('/move', `${step.name}: ${out.message}`, out.ok ? 'ok' : 'error');
        if (out.ok) startTracking({ name, x: out.target.x, y: out.target.y, action: 'move' });
        else if (!out.halt) await identifyAndTrack(name, stepBox(j.step));
      } catch (error) {
        addLog('/move', aiFailure('AI unavailable — nothing executed', error), 'error');
      }
    });
  };

  /** A suggested element the planner could not move to: identified (JSON only), verified, moved to at once, then tracked by the radar. */
  const identifyAndTrack = async (name: string, box: Box) => {
    if (!identifierReady()) return;
    const found = await identifyElement('not_accepted', box, name, createBudget(settingsRef.current.actionBudget), true, !armedRef.current);
    if (found?.verified) startTracking({ name, x: found.x, y: found.y, action: 'move' });
  };

  /** Shows the chain in the briefing panel. */
  const publishChain = (next: ChainRun) => {
    chainRef.current = next;
    setChain(next);
  };

  /** Patches one objective of the current chain. */
  const updateObjective = (i: number, patch: Partial<ChainObjective>) => {
    const run = chainRef.current!;
    publishChain({ ...run, objectives: run.objectives.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  };

  /** The model's objective breakdown of a multi-element goal; null (logged) when the AI failed. */
  const planChainFor = async (text: string): Promise<ChainObjective[] | null> => {
    const context = [...knownRef.current.map(elementLine), ...mapContext(elementMapRef.current)];
    setAiBusy(true);
    try {
      const plan = await thought(`Chain: ${text}`, () => planChain(text, framesRef.current[0] ?? null, askFor('planner'), context), chainSummary);
      return plan.objectives;
    } catch (error) {
      addLog(CHAIN, aiFailure('AI chain plan failed — nothing executed', error), 'error');
      return null;
    } finally {
      setAiBusy(false);
    }
  };

  /** Moves through the plotted path elements that can be located; an unknown one is logged and skipped. Resolves false when the run must stop. */
  const walkPath = async (path: string[], budget: ActionBudget, dryRun: boolean): Promise<boolean> => {
    for (const name of path) {
      const loc = locateTarget(name, elementMapRef.current, familiarRef.current);
      if (!loc) {
        addLog(CHAIN, `Path element "${name}" is not in the element map or learned coordinates — skipped`, 'warn');
        continue;
      }
      const out = await performStep({ id: uid('step'), name: `Pass ${name}`, action: 'move', x: loc.x, y: loc.y, target: name, status: 'pending' }, CHAIN, budget, dryRun);
      if (out.halt) return false;
    }
    return true;
  };

  /** Grounds step `i` on the element map or learned coordinates: the point that pins its input, null when memory does not know it. */
  const placeTarget = (i: number): { x: number; y: number } | null => {
    const s = stepsRef.current[i];
    if (!POINTER_ACTIONS.has(s.action)) return null;
    const loc = locateTarget(s.target ?? s.name, elementMapRef.current, familiarRef.current);
    if (!loc) return null;
    updateStep(i, { x: loc.x, y: loc.y, unlocated: undefined });
    addLog(CHAIN, `Located "${s.target ?? s.name}" from the ${loc.source} at ${at(loc.x, loc.y)}`);
    return { x: loc.x, y: loc.y };
  };

  /**
   * Background discovery of objective `i`'s hidden target: the discovery agent either points at
   * it or proposes one scroll/click that reveals it, run through the guarded executor, up to
   * MAX_DISCOVERY times. Resolves whether the target was found (step `i` now points at it).
   */
  const discover = async (i: number, budget: ActionBudget, dryRun: boolean): Promise<boolean> => {
    const o = chainRef.current!.objectives[i];
    const name = o.step.target ?? o.name;
    const tried: string[] = [];
    for (let n = 0; n < MAX_DISCOVERY && !abortRef.current; n++) {
      let move: DiscoveryMove;
      try {
        move = await thought(`Discover: ${name}`, () => discoverTarget(askFor('planner'), framesRef.current[0] ?? null, o, tried), discoverySummary);
      } catch (error) {
        addLog(CHAIN, aiFailure(`Discovery of "${name}" failed`, error), 'error');
        return false;
      }
      addLog(CHAIN, `Discovery ${n + 1}/${MAX_DISCOVERY} for "${name}": ${discoverySummary(move)}`);
      if (move.kind === 'found') {
        updateStep(i, { x: move.x, y: move.y, unlocated: undefined, refFrame: undefined });
        return true;
      }
      if (move.kind === 'give-up') return false;
      const out = await performStep(move.step, CHAIN, budget, dryRun);
      tried.push(`${move.step.action} "${move.step.target ?? move.step.name}"${move.step.text ? ` ${move.step.text}` : ''}`);
      if (out.halt) return false;
    }
    return false;
  };

  /** Why an objective failed: not found, the step's own failure, or a failure verdict; null when it succeeded. */
  const objectiveFailure = (out: (Performed & { verdict?: StepVerdict | null }) | null): string | null => {
    if (!out) return 'target not found — not on screen and discovery could not reveal it';
    if (!out.ok) return out.message;
    return out.verdict?.success === false ? 'the AI verdict says the step did not succeed' : null;
  };

  /**
   * One objective: walk its path, locate its target (element map → learned coordinates → planner
   * point), run the pre-staged action through the grounded pipeline with screenshots before and
   * after, and discover the target when it is not found. Resolves whether it succeeded.
   */
  const runObjective = async (i: number, budget: ActionBudget, dryRun: boolean): Promise<boolean> => {
    const o = chainRef.current!.objectives[i];
    updateObjective(i, { status: 'running' });
    addLog(CHAIN, `Objective ${i + 1}/${chainRef.current!.objectives.length}: ${o.what} — why: ${o.why}`);
    const before = framesRef.current[0];
    if (!(await walkPath(o.path, budget, dryRun))) return settleObjective(i, refused(o.step, 'Stopped while moving along the path'), before);
    const pin = placeTarget(i) ?? undefined;
    let out = pin || !stepsRef.current[i].unlocated ? await replayStep(i, budget, dryRun, CHAIN, pin) : null;
    if (!out?.ok && !out?.halt && (await discover(i, budget, dryRun))) out = await replayStep(i, budget, dryRun, CHAIN);
    return settleObjective(i, out, before);
  };

  /** Records an objective's outcome and its before/after screenshots; resolves whether it succeeded. */
  const settleObjective = (i: number, out: (Performed & { verdict?: StepVerdict | null }) | null, before: Frame | undefined): boolean => {
    const reason = objectiveFailure(out);
    const s = stepsRef.current[i];
    const after = s.afterFrame ?? out?.shot ?? framesRef.current[0];
    updateObjective(i, { status: reason ? 'failed' : 'done', reason: reason ?? undefined, before: s.beforeFrame ?? before ?? after, after });
    return !reason;
  };

  /** Logs every objective's completion and the chain report: red INCOMPLETE naming the failed objective and why. */
  const reportChain = () => {
    const run = chainRef.current!;
    const report = chainReport(run.objectives);
    publishChain({ ...run, report });
    run.objectives.forEach((o, i) => addLog(CHAIN, objectiveLine(o, i), OBJECTIVE_TONE[o.status]));
    addLog(CHAIN, report.text, report.complete ? 'ok' : 'error');
    if (!report.complete) captureError({ kind: 'step', message: report.text, goal: run.goal, step: report.failed?.name });
  };

  /**
   * A multi-element goal as one workflow: the planner's objective breakdown (what/why per element)
   * becomes the plan, then every objective runs in order under the run's guardrails (arm, budget,
   * kill-switch, loop-control stages). The chain stops at the first failed objective; the rest are
   * reported as not run.
   */
  const runChain = async (text: string) => {
    if (!stageOn('planner')) {
      addLog(CHAIN, `${stageOff('planner')} — no chain planned`, 'warn');
      return;
    }
    if (abortedRef.current) {
      addLog('Safety', refusedWhileAborted('Chain'), 'error');
      return;
    }
    const objectives = await planChainFor(text);
    if (!objectives) return;
    publishChain({ goal: text, objectives, report: null });
    applyPlan(text, objectives.map((o) => o.step), 'Chain breakdown');
    const dryRun = !armedRef.current;
    const plan = runPlan(CHAIN, dryRun);
    if (!plan || (plan.needsBridge && !(await bridgeReady(CHAIN)))) return;
    if (dryRun) addLog('Safety', `Real input disarmed — the chain runs as a ${DRY_RUN}`, 'warn');
    const budget = createBudget(settingsRef.current.actionBudget);
    beginRun();
    let failed = false;
    for (let i = 0; i < objectives.length; i++) {
      if (failed || abortRef.current) updateObjective(i, { status: 'not run', reason: failed ? 'an earlier objective failed' : 'stopped before it ran' });
      else failed = !(await runObjective(i, budget, dryRun));
    }
    endRun();
    reportChain();
  };

  /**
   * One subagent assigned a slice: it first receives the failure reminders of similar operations,
   * its AI turns carry the slice's operation memory, and a failed slice is saved as a reminder.
   */
  const runSubagent = async (task: SubagentTask, dryRun: boolean): Promise<SubagentOutcome> => {
    const label = `Subagent ${task.index + 1}`;
    const record = (what: string, shots: Frame[]) => rememberFailure(newFailure({ operation: task.goal, actor: label, what, steps: [], targets: [task.target], shots: shots.map((f) => f.url) }));
    remindFailures(task.goal, label);
    operationRef.current = task.goal;
    try {
      const out = await subagentPipeline(task, dryRun, label);
      if (out.status === 'fail') record(out.message, out.shots);
      return out;
    } catch (error) {
      record(`Subagent failed: ${errorText(error)}`, framesRef.current.slice(0, 1));
      throw error;
    } finally {
      operationRef.current = null;
    }
  };

  /**
   * One subagent's pipeline: its slice goes through the same pipeline as every run — plan from the slice's
   * goal on the live frame, grounded execution under its own budget slice and the guardrails,
   * reflect and verdict. It passes only when every step ran ok and every verdict says success.
   */
  const subagentPipeline = async (task: SubagentTask, dryRun: boolean, label: string): Promise<SubagentOutcome> => {
    const base = { dry: dryRun, shots: [] as Frame[], thinking: [] as string[] };
    const stopped = () => abortRef.current || abortedRef.current;
    const plan = await thought(`${label}: ${task.label}`, () => planFromGoal(task.goal, [], framesRef.current[0] ?? null, askFor('planner'), [...knownInScope(), ...sectionContext(), ...inventoryLines(inventoryRef.current)], patternsRef.current), planSummary);
    if (plan.thinking) base.thinking.push(plan.thinking);
    const budget = createBudget(task.budget);
    let last: { x: number; y: number } | undefined;
    let verdict: StepVerdict | null | undefined;
    for (const step of plan.steps) {
      if (stopped()) return { ...base, status: 'aborted', message: `Stopped before "${step.name}" — nothing more sent` };
      const local = recordLocal(label, step, `link/route test "${task.goal}", so "${step.name}" is run to verify it`);
      const briefed = await brief(label, { kind: 'go', step, proposal: local });
      if (briefed.kind !== 'go') return { ...base, status: 'fail', message: `${step.name}: not justified by the pre-action briefing` };
      const out = await execute(briefed.step, label, budget, dryRun, briefed.proposal);
      if (out.shot) base.shots.push(out.shot);
      verdict = out.verdict;
      if (verdict?.thinking) base.thinking.push(verdict.thinking);
      if (!out.ok) return { ...base, status: stopped() ? 'aborted' : 'fail', message: `${step.name}: ${out.message}`, avoid: verdict?.pattern_avoid, add: verdict?.pattern_add };
      last = out.target;
      if (!verdict) return { ...base, status: 'fail', message: `${step.name}: no AI verdict — not counted as a pass`, point: last };
      if (!verdict.success) return { ...base, status: 'fail', message: `${step.name}: AI verdict FAILED`, avoid: verdict.pattern_avoid, add: verdict.pattern_add, point: last };
    }
    return { ...base, status: 'pass', message: `${plan.steps.length} step(s) ${dryRun ? `verified (${DRY_RUN})` : 'executed'} and verified`, avoid: verdict?.pattern_avoid, add: verdict?.pattern_add, point: last };
  };

  /** The links or route stops of a request: as given, or listed by the model on the live frame. */
  const sectionsOf = async (req: TestRequest): Promise<string[]> => {
    if (req.items.length) return req.items;
    const { items } = await thought(`Supervisor: ${req.goal}`, () => listSections(askFor('supervisor'), framesRef.current[0] ?? null, req), (r) => `${r.items.length} ${req.kind === 'link' ? 'link(s)' : 'route stop(s)'}: ${r.items.join(', ')}`);
    return items;
  };

  /**
   * Thorough link/route testing: the supervisor subsections the work into one subagent per link
   * or route segment, each with its slice of the action budget, run one at a time (Auto Act
   * pauses) and stoppable by Stop or the emergency abort. Results aggregate into a pass/fail
   * report; its lessons go to the habit system and passed elements to the agent bus.
   */
  const testRoutes = async (req: TestRequest) => {
    if (abortedRef.current) return addLog('Supervisor', refusedWhileAborted('Link/route test'), 'error');
    if (subRunningRef.current) return addLog('Supervisor', 'A link/route test is already running', 'warn');
    if (!agentsRef.current('supervisor')) return addLog('Supervisor', 'Supervisor agent is off — enable it to run link/route tests', 'warn');
    const dryRun = !armedRef.current;
    abortRef.current = false;
    subRunningRef.current = true;
    setSubRunning(true);
    const report = (results: SubagentReport['results'], finished: boolean): SubagentReport => ({ goal: req.goal, kind: req.kind, time: Date.now(), finished, results });
    try {
      await withAi(async () => {
        const items = await sectionsOf(req);
        const tasks = planSubagents(req.kind, items, settingsRef.current.actionBudget);
        addLog('Supervisor', `${tasks.length} subagent(s) for "${req.goal}" — budget slices ${tasks.map((t) => t.budget).join('/')}${dryRun ? ' (real input disarmed: dry run)' : ''}`, 'info');
        setSubReport(report([], false));
        const crew = EXECUTION_MODES[settingsRef.current.executionMode].crew;
        const results = await runSubagents(tasks, (t) => runSubagent(t, dryRun), () => abortRef.current || abortedRef.current, (r) => setSubReport(report(r, false)), crew);
        setSubReport(report(results, true));
        addPatterns(reportPatterns(results, req.goal));
        learnTestHabits(results, req.kind);
        results.forEach((r) => {
          if (r.status === 'pass' && r.point) forwardElement('supervisor', { name: r.target, x: r.point.x, y: r.point.y });
        });
        addLog('Supervisor', `Link/route test "${req.goal}": ${summaryText(results)}`, results.every((r) => r.status === 'pass') ? 'ok' : 'warn');
        const flagged = results.filter((r) => r.status === 'fail' || r.status === 'aborted');
        if (flagged.length) notify({ source: 'Supervisor', category: 'agents', severity: 'warning', title: `Link/route test "${req.goal}": ${flagged.length} of ${results.length} failed or aborted` });
      });
    } catch (error) {
      addLog('Supervisor', `AI unavailable — no subagents run: ${errorText(error)}`, 'error');
    } finally {
      subRunningRef.current = false;
      setSubRunning(false);
    }
  };

  /** A link/route test's passed and failed slices as habit outcomes on their targets (coordinate learner stage). */
  const learnTestHabits = (results: SubagentReport['results'], kind: TestRequest['kind']) => {
    if (!stageOn('coords')) return;
    const context = `${kind}-test:${habitContext()}`;
    const tested = results.filter((r) => r.status === 'pass' || r.status === 'fail');
    commitHabits(tested.reduce((h, r) => recordOutcome(h, { target: r.target, context, success: r.status === 'pass', avoid: r.avoid, add: r.add }), habitsRef.current));
  };

  /**
   * Automatic route test after a workflow used a route: its stops are tested by subagents in the
   * background (never awaited by the run); skipped while another link/route test is running.
   */
  const autoRouteTest = (route: Route) => {
    const stops = route.hops.map((h) => h.name);
    if (stops.length < 2 || subRunningRef.current) return;
    addLog('Supervisor', `Route used — testing ${stops.join(' > ')} in the background; results go into habits`, 'info');
    void testRoutes({ kind: 'route', items: stops, goal: `Auto route test: ${stops.join(' > ')}` });
  };

  /** The step a wake decision concerns: the first pending one. */
  const pendingName = () => stepsRef.current.find((s) => s.status === 'pending')?.name ?? 'the current operation';

  /** Re-plans the remaining steps for a wake decision, with its reason as the goal check. */
  const replanAfterWake = (reason: string) => planNext(runGoalOf(), stepsRef.current, { complete: false, progress: false, reason, thinking: null }, (autoLoopRef.current?.iteration ?? 0) + 1);

  /** What each wake decision does; nothing runs before the AI has decided. */
  const wakeHandlers: DecisionHandlers<Promise<void>> = {
    apply: async () => {
      const frame = framesRef.current[0];
      if (frame) await autoAct(frame);
    },
    reroute: (d: WakeDecision) => replanAfterWake(`reroute after waking — ${d.reason}`),
    stop: async () => {
      setSettings((s) => ({ ...s, autoAct: false }));
      addLog('Wake', 'Auto Act stopped by the AI after waking', 'warn');
    },
    alternate: (d) => replanAfterWake(`use an alternate method: ${d.method} — ${d.reason}`),
    wait: async (d) => {
      wake.arm(pendingName(), d.reason, d.waitMs);
    },
    new: async (d) => {
      goalRef.current = d.goal!;
      setGoal(d.goal!);
      await autoPlan(d.goal!);
    },
    parallel: async (d) => {
      wake.startParallel(d.parallel!, 'AI after waking');
    },
  };

  /** AI help: the model answers a question about the live screen and points out what it means. */
  const askScreen = async (question = 'What on this screen needs my attention, and what should I do next?'): Promise<string> => {
    const f = framesRef.current[0];
    if (!stageOn('screenWatcher')) {
      addLog('AI help', `${stageOff('screenWatcher')} — not asked`, 'warn');
      return '';
    }
    if (!f) {
      addLog('AI help', 'No captured frame yet — share the screen or connect the bridge first', 'warn');
      return '';
    }
    let answered = '';
    await withAi(async () => {
      try {
        const { answer, annotations: items } = await thought(`Ask: ${question}`, () => describeScreen(askFor('screenWatcher'), f, question, goal), (r) => r.answer);
        answered = answer;
        setAiAnswer(answer);
        setAnnotations(items);
        addLog('AI help', answer, 'info');
        items.filter((a) => a.actX !== undefined && a.actY !== undefined).forEach((a) => forwardElement('screen', { name: a.label, x: a.actX!, y: a.actY!, w: a.w, h: a.h }));
      } catch (error) {
        setAiAnswer('');
        addLog('AI help', aiFailure('AI unavailable — no answer', error), 'error');
      }
    });
    return answered;
  };

  /** Point out: the default AI-help question. */
  const explainScreen = () => askScreen();
  const explainRef = useRef(explainScreen);
  explainRef.current = explainScreen;
  const agentListRef = useRef(agents);
  agentListRef.current = agents;

  /** One automatic point-out: skipped while the AI is already answering, so ticks never pile up. */
  const pointOutTick = useCallback(() => {
    if (aiBusyRef.current) return;
    setAttention((a) => focusOn(a, 'Point out (auto)', 'Point out'));
    void explainRef.current();
  }, []);

  /** Point out now, then every CADENCE_MS until stopPointOut. */
  const startPointOut = useCallback(() => {
    setPointOutAuto(true);
    pointOutTick();
  }, [pointOutTick]);
  const stopPointOut = useCallback(() => setPointOutAuto(false), []);

  useEffect(() => {
    if (!pointOutAuto) return undefined;
    const id = setInterval(pointOutTick, CADENCE_MS);
    return () => clearInterval(id);
  }, [pointOutAuto, pointOutTick]);

  /** Every due agent reports what it is doing now; reports go to agentReports and every AI call, never the log. */
  const cadenceTick = useCallback(() => {
    const now = Date.now();
    // An agent with an Agents-panel checkbox reports only while that checkbox is on.
    const panelOn = (a: CadenceAgent) => agentListRef.current.find((x) => x.id === a.id)?.on ?? true;
    const due = dueAgents(settingsRef.current.stages, reportedAtRef.current, now, settingsRef.current.relaxMode).filter(panelOn);
    if (!due.length) return;
    due.forEach((a) => { reportedAtRef.current[a.id] = now; });
    const reports = activityReports(due, {
      goal: goalRef.current, steps: stepsRef.current, sync: syncRef.current, progress: progressRef.current, popup: popupRef.current,
      watcher: watcherRef.current, familiar: familiarRef.current.length, known: knownRef.current.length,
      supervisor: supervisorRef.current, crew: crewRef.current, ops: opsRef.current.agents,
    }, now);
    agentReportsRef.current = addReports(agentReportsRef.current, reports);
    setAgentReports(agentReportsRef.current);
  }, []);

  useEffect(() => {
    const id = setInterval(cadenceTick, CADENCE_TICK_MS);
    return () => clearInterval(id);
  }, [cadenceTick]);

  /** Turns a captured screen image into a Frame and runs the monitor on it. */
  const onScreenImage = (image: CapturedImage) => {
    processRef.current({ id: ++frameId.current, ...image, source: 'screen' });
  };

  /** The capture ended by itself: stop any replay, keep the source and raise a visible error. */
  const onCaptureLost = (reason: string) => {
    captureRef.current = null;
    abortRef.current = true;
    setCaptureLost(reason);
    addLog('Screen', `CAPTURE LOST: ${reason} — monitoring halted. Restart capture or switch to the demo desktop.`, 'error');
    recordOp('Screen', 'capture', captureDraft('lost', sourceRef.current, reason, false));
  };

  /** Switches to a source: stops any running capture and resets the gallery. */
  const attachSource = (next: ScreenSource) => {
    recordOp('Screen', 'capture', captureDraft('source', next, `switched from ${sourceRef.current} to ${next}`));
    captureRef.current?.stop();
    captureRef.current = null;
    demoChosenRef.current = next === 'demo';
    framesRef.current = [];
    setFrames([]);
    setCaptureLost(null);
    sourceRef.current = next;
    setSource(next);
  };

  /** Captures the real screen: Electron native capture, else the browser picker. Resolves whether it started. */
  const shareScreen = async (): Promise<boolean> => {
    const capture = createScreenCapture();
    capture.selectDisplay(settingsRef.current.displayId);
    try {
      await capture.start(monitorInterval(settingsRef.current.monitorMode, modeCaptureMs(settingsRef.current.executionMode, settingsRef.current.captureMs)), { onImage: onScreenImage, onLost: onCaptureLost });
    } catch (error) {
      capture.stop();
      addLog('Screen', `Screen capture failed to start: ${errorText(error)}`, 'error');
      recordOp('Screen', 'capture', captureDraft('start', 'screen', errorText(error), false));
      return false;
    }
    attachSource('screen');
    captureRef.current = capture;
    recordOp('Screen', 'capture', captureDraft('start', 'screen', `${capture.kind} capture started`));
    addLog('Screen', capture.kind === 'native' ? 'Capturing your screen natively — monitoring continues while minimized' : 'Sharing your screen — the AI now sees it', 'ok');
    return true;
  };

  /**
   * Switches the monitor to real desktop screenshots from the bridge, after a health check.
   * `target` connects to a bridge just verified by the wizard, before its settings re-render.
   */
  const connectBridge = async (target?: { url: string; token: string }): Promise<boolean> => {
    const { url, token } = target ?? { url: settingsRef.current.bridgeUrl, token: settingsRef.current.bridgeToken };
    const health = await checkBridge(url, token);
    if (!health.ok) {
      addLog('Bridge', health.message, 'error');
      captureError({ kind: 'bridge', message: health.message });
      notify({ source: 'Bridge', category: 'bridge', severity: 'warning', title: `Desktop bridge connection failed — ${health.message}` });
      return false;
    }
    attachSource('bridge');
    addLog('Bridge', `${health.message} — screenshots now come from the real desktop`, 'ok');
    return true;
  };

  /**
   * Verify real input: one harmless cursor move to the screen centre through the bridge, gated
   * like every real action (abort, arm, executor stage, a one-action budget). Disarmed it is a
   * dry run and sends nothing. Reports and returns the bridge's confirmation or its error.
   */
  const verifyRealInput = async (): Promise<BridgeResult> => {
    const report = (r: BridgeResult, tone: LogEntry['tone'] = r.ok ? 'ok' : 'error') => {
      addLog('Verify real input', r.message, tone);
      return r;
    };
    if (abortedRef.current) return report({ ok: false, message: `Aborted — real input not sent; ${ABORT_HINT}` });
    if (!armedRef.current) return report({ ok: false, message: `Real input disarmed — ${DRY_RUN}` }, 'warn');
    if (!stageOn('executor')) return report({ ok: false, message: `${stageOff('executor')} — not sent` });
    const gate = gateRealInput(createBudget(1));
    if (gate) return report({ ok: false, message: gate });
    const { bridgeUrl, bridgeToken } = settingsRef.current;
    const shot = await captureDesktop(bridgeUrl, bridgeToken);
    const out = shot.ok ? await selfTestBridge(bridgeUrl, bridgeToken, shot.frame.width || 1920, shot.frame.height || 1080) : { ok: false, message: `Real input NOT verified — ${shot.message}` };
    setBridgeOnline(out.ok);
    if (!out.ok) captureError({ kind: 'bridge', message: out.message });
    return report(out);
  };

  /** Element recovery: one re-location of a named element on the live frame (learned anchor first, then the AI). */
  const locateElement = async (name: string): Promise<{ x: number; y: number } | null> => {
    const live = framesRef.current[0];
    if (!live) return null;
    const step: WorkflowStep = { id: uid('step'), name: `Find ${name}`, action: 'move', target: name, x: 0.5, y: 0.5, status: 'pending' };
    const seed = learnedPoint(live, step) ?? habitSeed(live, step);
    if (seed) return { x: seed.x, y: seed.y };
    if (!aiOnline()) return null;
    return grounding.relocate(live, step, `"${name}" was lost; find it on the current screen`).catch(() => null);
  };

  /**
   * Settles a disputed position: an off-screen point fails; with the AI online the target is
   * confirmed on a zoomed crop of the live frame, otherwise the coordinate learner's memory of it
   * must lie within the disagreement threshold of the point.
   */
  const confirmAt = async (name: string, p: { x: number; y: number }): Promise<boolean> => {
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return false;
    const live = framesRef.current[0];
    const step: WorkflowStep = { id: uid('step'), name: `Test ${name}`, action: 'move', target: name, x: p.x, y: p.y, status: 'pending' };
    if (live && aiOnline()) return grounding.confirm(live, step, p).then((c) => c.visible, () => false);
    const known = findFamiliar(familiarRef.current, name);
    return !!known && Math.hypot(known.x - p.x, known.y - p.y) <= DISAGREEMENT_THRESHOLD;
  };

  /** A replay (or self-test) as a recovery result. */
  const replayOutcome = async (selfTest: boolean, label: string) => {
    const out = await runReplay(selfTest, { label, goal: runGoalOf() });
    return out ? { ok: out.ok === out.total && !out.stopped, message: `${out.ok}/${out.total} step(s) ${out.dryRun ? 'verified (dry run)' : 'executed'}` } : { ok: false, message: `${label} refused — see the log` };
  };

  /** True while the automatic main retry must not run: aborted, stopped, paused, executor stage off, or the screen is busy. */
  const autoRetryBlocked = () =>
    abortedRef.current || abortRef.current || !!dispatchPaused() || !stageOn('executor') || autoRetryBusyRef.current || supervisorMovingRef.current
    || supervisorExecutorBusy({ autoBusy: autoBusyRef.current, replaying: replayingRef.current, recording: recordingRef.current, steps: stepsRef.current });

  /** Re-runs one failed or drifted step through the gated pipeline (dry run unless armed); false when the run must halt. */
  const autoRetryStep = async (id: string, budget: ActionBudget): Promise<boolean> => {
    const idx = stepsRef.current.findIndex((s) => s.id === id);
    if (idx < 0) return true;
    const step = stepsRef.current[idx];
    const dry = !armedRef.current;
    updateStep(idx, { status: 'running' });
    const why = `"${step.name}" ${step.status === 'drift' ? 'drifted' : 'failed'}, so the main retry re-runs it automatically`;
    const out = await perform(step, AUTO_RETRY_LABEL, budget, dry, recordLocal(AUTO_RETRY_LABEL, step, why), false);
    applyOutcome(idx, out, dry);
    addLog(dry ? `${AUTO_RETRY_LABEL} (dry run)` : AUTO_RETRY_LABEL, `${step.name}: ${out.message}`, out.ok ? 'ok' : 'error');
    return !out.halt;
  };

  /** One automatic main-retry pass: every failed or drifted step with attempts left, on one budget. */
  const autoRetryTick = async () => {
    if (autoRetryBlocked()) return;
    const limit = settingsRef.current.stepRetries;
    const due = retryDue(stepsRef.current, retryCountsRef.current, limit).map((i) => stepsRef.current[i]);
    if (!due.length) return;
    retryCountsRef.current = countAttempts(retryCountsRef.current, due.map((s) => s.id));
    addLog(AUTO_RETRY_LABEL, retryText(due, retryCountsRef.current, limit), 'info');
    autoRetryBusyRef.current = true;
    const budget = createBudget(settingsRef.current.actionBudget);
    try {
      for (const s of due) {
        if (abortedRef.current || abortRef.current || !(await autoRetryStep(s.id, budget))) break;
      }
    } finally {
      autoRetryBusyRef.current = false;
    }
  };
  const autoRetryTickRef = useRef(autoRetryTick);
  autoRetryTickRef.current = autoRetryTick;

  useEffect(() => {
    const id = setInterval(() => void autoRetryTickRef.current(), AUTO_RETRY_TICK_MS);
    return () => clearInterval(id);
  }, []);

  /** The AI resolution center and recovery operations, on the engine's gated pipeline and memories. */
  const resolution = useResolution({
    steps,
    bus,
    busy: replaying || recording,
    context: habitContext,
    goal: () => goalRef.current,
    addLog,
    ask: askFor('supervisor'),
    aiOnline,
    frame: () => framesRef.current[0] ?? null,
    currentSteps: () => stepsRef.current,
    setPlan: (next) => {
      stepsRef.current = next;
      setSteps(next);
    },
    newBudget: () => createBudget(settingsRef.current.actionBudget),
    perform: async (step, actor, why, budget) => {
      const out = await perform(step, actor, budget, !armedRef.current, recordLocal(actor, step, why), false);
      return { ok: out.ok, message: out.message };
    },
    confirm: confirmAt,
    locate: locateElement,
    forwardElement,
    addPatterns,
    recordHabit: (o) => {
      if (stageOn('coords')) commitHabits(recordOutcome(habitsRef.current, o));
    },
    retry: () => replayOutcome(false, 'Main retry'),
    selfTest: () => replayOutcome(true, 'Main test'),
    fix: async () => {
      await superviseRun();
      return { ok: supervisorRef.current.status === 'done', message: supervisorRef.current.detail };
    },
    connect: () => connectBridge(),
  });

  // Bridge takeover: when a configured bridge answers, frames come from the real desktop unless the user chose the demo.
  useEffect(() => {
    const url = settings.bridgeUrl;
    setBridgeOnline(false);
    if (!url) return undefined;
    let cancelled = false;
    void checkBridge(url, settings.bridgeToken).then((r) => {
      if (cancelled) return;
      setBridgeOnline(r.ok);
      if (!r.ok || demoChosenRef.current || sourceRef.current !== 'demo') return;
      attachSource('bridge');
      addLog('Monitor', 'Desktop bridge online — screenshots now come from the real screen', 'ok');
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.bridgeUrl, settings.bridgeToken, addLog]);

  // Bridge connect/disconnect notifications: every change of reachability after the first answer.
  const bridgeWasRef = useRef(false);
  useEffect(() => {
    if (bridgeOnline === bridgeWasRef.current) return;
    bridgeWasRef.current = bridgeOnline;
    notify(bridgeOnline
      ? { source: 'Bridge', category: 'bridge', severity: 'info', title: 'Desktop bridge connected' }
      : { source: 'Bridge', category: 'bridge', severity: 'warning', title: 'Desktop bridge disconnected' });
  }, [bridgeOnline, notify]);
  /** Switches the stage to the main app's preview frames (only while it is connected). */
  const selectMainApp = (): boolean => {
    if (mainBridgeRef.current?.state().status !== 'connected') {
      addLog('Main app', 'The main app is not connected — its preview cannot be selected', 'warn');
      return false;
    }
    attachSource('main-app');
    void mainBridgeRef.current.send('request_frame', {});
    addLog('Main app', 'Main app preview selected — the AI now sees and acts on it', 'ok');
    return true;
  };

  /** One preview frame from the main app: decoded into a Frame and analysed like any captured frame. */
  const onMainAppFrame = async ({ image, width, height }: FramePayload) => {
    try {
      const frame = await imageFrame(image, width, height, ++frameId.current, 'main-app');
      joint.onFrame(frame);
      if (sourceRef.current === 'main-app') processRef.current(frame);
    } catch (error) {
      addLog('Main app', `Main app frame could not be decoded: ${errorText(error)}`, 'error');
    }
  };

  /** What each intercept kind does beyond going on the agent bus. */
  const INTERCEPT_ROUTES: Record<InterceptKind, (p: InterceptPayload) => void> = {
    element_moved: () => void mainBridgeRef.current?.send('request_frame', {}),
    error_occurred: (p) => captureError(interceptError(p, goalRef.current)),
    test_requested: (p) => void testRoutes(parseTestSpec(p.test ?? '')),
    console_error: (p) => captureError(interceptError(p, goalRef.current)),
  };

  /** An intercept from the main app: logged, put on the agent bus from the main app, then routed by kind. */
  const onMainAppIntercept = (p: InterceptPayload) => {
    addLog('Main app', `Intercept ${p.kind}: ${p.message}`, p.kind === 'error_occurred' || p.kind === 'console_error' ? 'error' : 'info');
    const element = p.element ?? { name: `${p.kind}: ${p.message}`, x: 0.5, y: 0.5 };
    forwardElement('mainApp', element, p.element ? undefined : NOTE_ONLY_AGENTS);
    INTERCEPT_ROUTES[p.kind](p);
  };

  const mainAppHandlers = { onMainAppFrame, onMainAppIntercept, selectMainApp, onMainAppStatus: joint.onStatus };
  const mainAppRef = useRef(mainAppHandlers);
  mainAppRef.current = mainAppHandlers;

  // Main app bridge: starts with the app (listen or dial), reconnects with backoff, restarts when its settings change.
  const mainConfigKey = JSON.stringify(mainBridgeConfig(settings));
  useEffect(() => {
    const onMessage = (m: InboundMessage) => {
      if (m.type === 'frame') void mainAppRef.current.onMainAppFrame(m.payload);
      else if (m.type === 'intercept') mainAppRef.current.onMainAppIntercept(m.payload);
      else if (m.type === 'hello') addLog('Main app', `Hello from ${m.payload.app}`, 'info');
      else if (m.type === 'status') mainAppRef.current.onMainAppStatus(m.payload);
    };
    const onState = (state: MainBridgeState) => {
      setMainBridge(state);
      if (state.status === 'connected' && !demoChosenRef.current && sourceRef.current === 'demo') mainAppRef.current.selectMainApp();
      if (state.status !== 'connected' && sourceRef.current === 'main-app') addLog('Main app', 'Main app preview lost — monitoring paused until it reconnects', 'warn');
    };
    const bridge = createMainBridge(JSON.parse(mainConfigKey) as MainBridgeConfig, { onState, onMessage, onLog: (m, tone) => addLog('Main app', m, tone) });
    mainBridgeRef.current = bridge;
    bridge.start();
    return () => {
      bridge.stop();
      mainBridgeRef.current = null;
    };
  }, [mainConfigKey, addLog]);

  // Report state: the main app hears the engine's source, arming and run state whenever they change while connected.
  useEffect(() => {
    if (mainBridge.status !== 'connected') return;
    void mainBridgeRef.current?.send('report_state', { source, armed, running: replaying, goal: goalRef.current, steps: steps.length });
  }, [mainBridge.status, source, armed, replaying, steps.length]);

  /** "/use <target>": launch/focus the app on the PC via the bridge, or attach to its window via screen share. */
  const attachTarget = async (name: string) => {
    if (settingsRef.current.bridgeUrl && (await connectBridge())) {
      const open: WorkflowStep = { id: uid('step'), name: `Open ${name}`, action: 'open_app', text: name, x: 0.5, y: 0.5, status: 'pending' };
      const proposal = recordLocal('/use', open, `you asked to use "${name}", so it is opened or focused on the PC before anything else`);
      const out = await perform(open, '/use', createBudget(settingsRef.current.actionBudget), !armedRef.current, proposal);
      addLog('/use', out.ok ? `${out.message}; attached to "${name}"` : `Could not open "${name}": ${out.message}`, out.ok ? 'ok' : 'error');
      if (out.ok) setTarget(name);
      return;
    }
    addLog('/use', `No desktop bridge online — pick the "${name}" window to attach to (acting on it needs the bridge)`, 'info');
    if (await shareScreen()) setTarget(name);
  };

  /** Why a notification's action may not run now (abort, executor unchecked, executor busy); null when it may. */
  const actionBlocked = (): string | null => {
    if (abortedRef.current) return ABORTED_REFUSAL;
    if (!stageOn('executor')) return stageOff('executor');
    return executorBusy() ? 'the executor is busy with another run' : null;
  };

  /**
   * Runs a notification's proposed action through the shared pipeline: logged, recorded as a
   * proposal, briefed (when the Briefing stage is on), then performed as real input inside every
   * guardrail — a dry run unless armed, a fresh action budget, the abort latch and loop control.
   */
  const runNotificationAction = async (n: AssistNotification, how: 'Auto-act' | 'Manual'): Promise<void> => {
    if (!n.action) return;
    const actor = 'Notifications';
    const blocked = actionBlocked();
    if (blocked) {
      addLog(actor, `${how} skipped for "${n.title}" — ${blocked}`, 'warn');
      notifier.patch(n.id, { acted: 'skipped' });
      return;
    }
    const dryRun = !armedRef.current;
    addLog(actor, `${how}: ${actionText(n.action)} for "${n.title}"${dryRun ? ' (real input disarmed: dry run)' : ''}`, 'warn');
    const step = actionStep(n.action);
    const proposal = recordLocal(actor, step, `the notification "${n.title}" proposes it${how === 'Auto-act' ? ` and auto-act is on for ${n.category}` : ' and you asked to run it'}`);
    const go = await brief(actor, { kind: 'go', step, proposal });
    if (go.kind !== 'go') return;
    const out = await perform(go.step, actor, createBudget(settingsRef.current.actionBudget), dryRun, go.proposal);
    addLog(actor, `${how} ${out.ok ? 'done' : 'FAILED'}: ${out.message}`, out.ok ? 'ok' : 'error');
    notifier.patch(n.id, { acted: !out.ok ? 'failed' : dryRun ? 'dry-run' : 'done', read: true });
  };

  // Auto-act: a new notification with a proposed action runs it when its category is switched on (default off).
  onNotifiedRef.current = (n) => {
    if (n.action && settingsRef.current.notifyAutoAct[n.category]) void runNotificationAction(n, 'Auto-act');
  };

  /** The notification center's "Run" button. */
  const actOnNotification = async (id: string) => {
    const n = notifier.find(id);
    if (n?.action) await runNotificationAction(n, 'Manual');
  };

  // Relaxation mode: a gentle break reminder every breakMinutes while it is on.
  useEffect(() => {
    if (!settings.relaxMode) return undefined;
    const minutes = settings.breakMinutes;
    const id = setInterval(() => notify({ source: 'Relaxation', category: 'relax', severity: 'info', title: breakText(minutes) }), breakPeriodMs(minutes));
    return () => clearInterval(id);
  }, [settings.relaxMode, settings.breakMinutes, notify]);

  /** System info and user-chosen folder specs for the System panel. */
  const system = useSystemInfo({
    refreshSec: settings.systemRefreshSec,
    folders: settings.systemFolders,
    setFolders: (systemFolders) => setSettings((s) => ({ ...s, systemFolders })),
    native: typeof window === 'undefined' ? undefined : window.droidNative,
  });
  const systemInfoRef = useRef(system.info);
  systemInfoRef.current = system.info;
  const runsRef = useRef(runs);
  runsRef.current = runs;
  /** Suggestion titles already raised by the background tick this session. */
  const suggestedRef = useRef(new Set<string>());

  /** The suggestion context the model sees: recent operations and the computer's state. */
  const suggestionContext = (): string[] => {
    const info = systemInfoRef.current;
    const ops = recentOperations(runsRef.current).map((r) => `- ${new Date(r.time).toString()}: "${r.goal}" ${r.outcome}`);
    const disk = info?.disk ? [`Disk: ${formatBytes(info.disk.freeBytes)} free of ${formatBytes(info.disk.totalBytes)}`] : [];
    return ['Recent operations:', ...(ops.length ? ops : ['- none']), ...(info ? [`Computer: ${info.os}, ${info.cpu.cores} cores`] : []), ...disk];
  };

  /**
   * Suggestions: habits from the run summaries, "disk almost full" and the model's own proposals.
   * The background tick (`once`) raises each title at most once per session; Refresh always asks.
   */
  const refreshSuggestions = useCallback(async (once = false) => {
    const raise = (drafts: ReturnType<typeof habitSuggestions>) => drafts.forEach((d) => {
      if (once && suggestedRef.current.has(d.title)) return;
      suggestedRef.current.add(d.title);
      notify(d);
    });
    const info = systemInfoRef.current;
    raise([...habitSuggestions(runsRef.current), ...(diskLow(info) && info?.disk ? [diskSuggestion(info.disk.freeBytes, info.disk.totalBytes)] : [])]);
    if (!aiOnline() || !stageOn('supervisor')) return;
    try {
      raise(await suggestWithAi(askFor('supervisor'), suggestionContext()));
    } catch (error) {
      addLog('Suggestions', aiFailure('AI unavailable — no suggestions this round', error), 'warn');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify, askFor, addLog]);
  const refreshSuggestionsRef = useRef(refreshSuggestions);
  refreshSuggestionsRef.current = refreshSuggestions;

  // Background suggestions: once the first system read lands, then every SUGGEST_TICK_MS.
  const systemReady = system.info !== null;
  useEffect(() => {
    if (!systemReady) return undefined;
    void refreshSuggestionsRef.current(true);
    const id = setInterval(() => void refreshSuggestionsRef.current(true), SUGGEST_TICK_MS);
    return () => clearInterval(id);
  }, [systemReady]);

  /** "/measure A to B [to C…]": measured on the live frame, drawn, kept and logged; an unknown element is a loud error. */
  const measureCommand = async (query: string) => {
    try {
      measureFor(query, '/measure');
    } catch (error) {
      addLog('/measure', `Measurement failed — ${errorText(error)}`, 'error');
    }
  };

  /** "/scenario <dragon|wedding>": resets and shows the test world, logs the checklist and plans the persona goal. */
  const scenarioCommand = async (name: string) => {
    const scenario = findScenario(name);
    if (!scenario) {
      addLog('/scenario', `Unknown scenario "${name}" — try dragon or wedding`, 'warn');
      return;
    }
    if (sourceRef.current !== 'demo') {
      addLog('/scenario', 'Scenarios run on the demo desktop — switch to the demo first', 'warn');
      return;
    }
    worldRef.current = initialWorld();
    worldOnRef.current = true;
    addLog('/scenario', `${scenario.title}: ${progressLines(scenario, worldRef.current).join(' · ')}`, 'info');
    await autoPlan(scenario.goal);
    addLog('/scenario', `${scenario.title} checklist: ${progressLines(scenario, worldRef.current).join(' · ')}`, scenarioComplete(scenario, worldRef.current) ? 'ok' : 'warn');
  };
  /**
   * AI replication: snips `box` from the live frame (cropFrame), extracts its crop, size, colours, text and
   * bounds, optionally asks the model to name and read it, and saves it as a mapped and familiar element for
   * future grounding. Logged with the crop, kept for the briefing and recorded in the sections it lies in.
   */
  const replicateRegion = async (box: Box, hint: string, actor: string, askName: boolean): Promise<Replica | null> => {
    const frame = framesRef.current[0];
    if (!frame) {
      addLog(actor, `Cannot replicate "${hint}" — no captured frame yet`, 'warn');
      return null;
    }
    const crop = await cropFrame(frame, box).catch(() => null);
    const naming = askName && crop && aiOnline()
      ? await askFor('identify')(replicateRequest(crop, hint)).then((reply) => parseReplicaNaming(reply, hint)).catch(() => ({ name: hint, text: '' }))
      : { name: hint, text: '' };
    const r = extractReplica(frame, box, crop?.url ?? frame.url, naming.name, naming.text);
    setReplicas((list) => [r, ...list.filter((x) => x.name !== r.name)].slice(0, 50));
    setMap(mapElement(elementMapRef.current, replicaToMapped(r, frame)));
    setFamiliar((list) => rememberElement(list, replicaToFamiliar(r)));
    sectionEvent({ time: r.time, kind: 'log', text: `replicated "${r.name}"`, box });
    addLog(actor, replicaLine(r), 'ok', [r.crop]);
    return r;
  };

  /** "/replicate <name> x,y,w,h" or "/replicate <mapped element>": the AI snips and saves the element itself. */
  const replicateCommand = async (arg: string) => {
    const parsed = parseBoxArg(arg);
    const box = parsed?.box ?? elementMapRef.current.find((m) => sameElement(m.name, arg))?.box;
    if (!box) {
      addLog('/replicate', `No region for "${arg}" — give a box: /replicate <name> x,y,w,h`, 'warn');
      return;
    }
    await replicateRegion(box, parsed?.name ?? arg, '/replicate', true);
  };

  /** Element-map studio: saves the drawn box as a named screen section. */
  const saveSection = (name: string) => {
    const section = mapDraft && createSection(name, mapDraft, 'drawn');
    if (!section) return;
    commitSections(addSection(sectionsRef.current, section));
    setMapDraft(null);
    addLog('Sections', `Section "${section.name}" drawn at ${gridRef(boxCenter(section.box))} (${pct(section.box.w)} x ${pct(section.box.h)} of the screen)`, 'ok');
  };

  const deleteSection = (id: string) => commitSections(removeSection(sectionsRef.current, id));

  /** Asks the model to split the live screen into named sections from the element inventory. */
  const proposeSections = async () => {
    const frame = framesRef.current[0];
    if (!frame || !aiOnline()) {
      addLog('Sections', !frame ? 'No captured frame to section yet' : 'AI unavailable — draw sections in the element map instead', 'warn');
      return;
    }
    try {
      const proposed = parseSectionProposals(await askFor('identify')(sectionsRequest(frame, elementMapRef.current, familiarRef.current)));
      commitSections(proposed.reduce(addSection, sectionsRef.current));
      addLog('Sections', proposed.length ? `AI proposed ${proposed.length} section(s): ${proposed.map((s) => s.name).join(', ')}` : 'AI proposed no sections', proposed.length ? 'ok' : 'warn');
    } catch (error) {
      addLog('Sections', aiFailure('AI unavailable — no sections proposed', error), 'error');
    }
  };

  /** "/section <name> x,y,w,h" draws, "/section auto" asks the AI, "/section remove <name>" deletes. */
  const sectionCommand = async (arg: string) => {
    if (arg.trim().toLowerCase() === 'auto') return proposeSections();
    const removal = /^remove\s+(.+)$/i.exec(arg.trim());
    const found = removal && findSection(sectionsRef.current, removal[1]);
    if (removal) {
      if (found) deleteSection(found.id);
      addLog('/section', found ? `Removed section "${found.name}"` : `No section named "${removal[1]}"`, found ? 'ok' : 'warn');
      return;
    }
    const parsed = parseBoxArg(arg);
    const section = parsed && createSection(parsed.name, parsed.box, 'drawn');
    if (!section) {
      addLog('/section', 'Usage: /section <name> x,y,w,h · /section auto · /section remove <name>', 'warn');
      return;
    }
    commitSections(addSection(sectionsRef.current, section));
    addLog('/section', `Section "${section.name}" added`, 'ok');
  };

  /** "/scope <a>, <b>" secludes the goal to those sections; "/scope all" lifts the seclusion. */
  const scopeCommand = async (arg: string) => {
    const names = /^(all|none|clear)$/i.test(arg.trim()) ? [] : arg.split(',').map((n) => n.trim()).filter(Boolean);
    const matched = scopeSections(sectionsRef.current, names).map((s) => s.name);
    const unknown = names.filter((n) => !findSection(sectionsRef.current, n));
    scopeRef.current = matched;
    setScope(matched);
    addLog('/scope', matched.length ? `Goal secluded to ${matched.join(', ')} — grounding, agents and change detection ignore the rest${unknown.length ? ` (unknown: ${unknown.join(', ')})` : ''}` : `Goal scope cleared — the whole screen is in play${unknown.length ? ` (unknown: ${unknown.join(', ')})` : ''}`, unknown.length ? 'warn' : 'ok');
  };

  /** One planned step for a side-test action, from the planner under the goal scope; null without one. */
  const planOne = async (text: string): Promise<WorkflowStep | null> => {
    const plan = await planFromGoal(text, [], framesRef.current[0] ?? null, askFor('sideTests'), sectionContext()).catch(() => null);
    return plan?.steps[0] ?? null;
  };

  /** Research: "<URL> <query>" fetches the page and keeps its sentences matching the query; otherwise the AI researches on the live (side) screen. */
  const researchQuery = async (query: string): Promise<string[]> => {
    try {
      const [first = '', ...words] = query.split(/\s+/);
      if (/^https?:\/\//i.test(first)) return textFindings(await (await fetch(first)).text(), words.join(' ') || first);
      const frame = framesRef.current[0];
      if (!frame || !aiOnline()) return [`no AI or frame to research "${query}"`];
      return [(await describeScreen(askFor('sideTests'), frame, `Research: ${query}. Report what the screen shows about it.`, goalRef.current)).answer];
    } catch (error) {
      return [`research of "${query}" failed: ${errorText(error)}`];
    }
  };

  /** Everything runSideTest touches, routed through the shared guardrails, executor and agent bus. */
  const sideTestDeps = (started: number): SideTestDeps => {
    const before: WatchedPosition[] = knownRef.current.map((e) => ({ name: e.name, x: e.x, y: e.y }));
    const main = targetRef.current ?? '';
    const step = (name: string): WorkflowStep => ({ id: uid('step'), name: `Open ${name}`, action: 'open_app', text: name, x: 0.5, y: 0.5, status: 'pending' });
    return {
      guard: () => ({ aborted: abortedRef.current, armed: armedRef.current, stageOn: stageOn('sideTests') }),
      budget: createBudget(settingsRef.current.actionBudget),
      switchTo: async (t) => {
        const to = t || main;
        if (!to) return { ok: true, message: 'stayed on the main app' };
        const out = await performStep(step(to), 'Side tester', createBudget(1), !armedRef.current);
        return { ok: out.ok, message: out.message };
      },
      act: async (s, dryRun) => {
        lastRecordRef.current = null;
        const out = await performStep(s, 'Side tester', createBudget(1), dryRun);
        return { ok: out.ok, message: out.message, record: out.executed ? lastRecordRef.current ?? undefined : undefined };
      },
      capture: async () => {
        const frame = framesRef.current[0];
        if (!frame || !aiOnline()) return frame ? `frame #${frame.id} captured` : 'no frame captured';
        return (await describeScreen(askFor('sideTests'), frame, 'Describe the result of the last action briefly.', goalRef.current).catch(() => ({ answer: `frame #${frame.id} captured` }))).answer;
      },
      research: researchQuery,
      sentinels: async () => sentinelScan(before, knownRef.current.map((e) => ({ name: e.name, x: e.x, y: e.y })), logRef.current.filter((l) => l.time >= started && l.tone === 'warn' && l.source === 'Popup watcher').map((l) => l.message)),
      onAlert: (a: SentinelAlert) => {
        addLog('Side tester', `Sentinel: ${a.text}`, 'warn');
        forwardElement('sidetest', { name: a.text, x: 0.5, y: 0.5 }, ['popup', 'supervisor']);
        // An urgent sentinel alert hands the live frame to Auto Act (popup handling / next step) when it is on.
        const frame = framesRef.current[0];
        if (frame && settingsRef.current.autoAct) void autoAct(frame);
      },
      log: (m, tone) => addLog('Side tester', m, tone),
    };
  };

  /** Runs one side test inside the guardrails and reports it: notes, the agent bus and feedback to the main AI. */
  const runSide = async (plan: SideTestPlan) => {
    const r = await runSideTest(plan, sideTestDeps(Date.now()));
    setSideResults((list) => [r, ...list].slice(0, 50));
    const notes = mergeNotes(watcherRef.current.notes, findingsToNotes(r));
    updateWatcher((w) => ({ ...w, notes: notes.notes }));
    forwardElement('sidetest', busFeedback(r));
    note({ step: `Side test "${r.name}"`, kind: 'test', text: feedbackLine(r), thinking: null });
    sectionEvent({ time: Date.now(), kind: 'log', text: feedbackLine(r) });
    addLog('Side tester', feedbackLine(r), r.status === 'passed' ? 'ok' : 'warn');
  };

  /**
   * Background side tests of the targets the AI used repeatedly or failed on, after a run: sideTests
   * stage and the Side tester agent on, not aborted; each test runs inside runSideTest's guardrails (arm, budget).
   */
  const autoSideTests = async () => {
    if (abortedRef.current || !stageOn('sideTests') || !agentsRef.current('sidetest')) return;
    const now = Date.now();
    for (const c of sideTestDue(interactionsRef.current, sideTestedRef.current, now)) {
      if (abortedRef.current) return;
      const k = interactionKey(c.name);
      sideTestedRef.current = { ...sideTestedRef.current, [k]: now };
      const { [k]: _done, ...rest } = interactionsRef.current;
      interactionsRef.current = rest;
      await runSide(autoSideTestPlan(c, settingsRef.current.sideTestMode));
    }
  };

  /** Why the self-test must stop now (abort, Stop, self-test or executor stage unchecked), or null. */
  const selfTestStopped = (): string | null => {
    if (abortedRef.current) return `Aborted — self-test stopped; ${ABORT_HINT}`;
    if (abortRef.current) return 'Stopped by the user';
    if (!stageOn('selfTest')) return stageOff('selfTest');
    return stageOn('executor') ? null : stageOff('executor');
  };

  /** Grounds one self-test step on the live frame through the grounding stage (unnamed steps keep their point). */
  const selfTestGround = async (step: WorkflowStep) => {
    const live = framesRef.current[0];
    if (!live) return { ok: false, detail: 'no live frame captured', step };
    if (!step.target || !POINTER_ACTIONS.has(step.action)) return { ok: true, detail: `"${step.name}" needs no grounding`, step };
    if (!aiOnline() || !stageOn('grounding')) return { ok: false, detail: !aiOnline() ? 'AI unavailable — target not grounded' : stageOff('grounding'), step };
    const found = await groundTarget(step, live, { x: step.x, y: step.y }, grounding, (m, tone) => addLog('Self-test', m, tone));
    return 'error' in found ? { ok: false, detail: found.error, step } : { ok: true, detail: `"${step.target}" at ${at(found.point.x, found.point.y)}`, step: { ...step, x: found.point.x, y: found.point.y } };
  };

  /** Verifies the self-test goal on the live frame with the verdict stage's AI; offline it fails (not verified). */
  const selfTestVerify = async (text: string, ran: WorkflowStep[]) => {
    if (!aiOnline() || !stageOn('verdict')) return { ok: false, detail: !aiOnline() ? 'AI unavailable — goal not verified' : stageOff('verdict') };
    const check = await thought(`Self-test: ${text}`, () => verifyGoal(askFor('verdict'), framesRef.current[0] ?? null, text, ran), (c) => c.reason);
    return { ok: check.complete, detail: check.reason || (check.complete ? 'goal achieved' : 'goal not achieved') };
  };

  /**
   * The AI self-test: a real end-to-end run on the live frame — plan the goal (the current one, else a
   * hover of the first test target) → ground every step → execute them through the gated executor (dry
   * run unless armed, one budget) → verify the goal. The report goes to the Self-test panel and the log.
   */
  const runSelfTestNow = async (): Promise<SelfTestReport | null> => {
    if (replayingRef.current) {
      addLog('Self-test', 'Self-test waits — a run is in progress', 'warn');
      return null;
    }
    const first = testTargets(elementMapRef.current, familiarRef.current)[0];
    const text = goalRef.current.trim() || (first ? `Move the mouse cursor onto the ${first.name} (hover, do not click)` : 'Move the mouse cursor to the centre of the screen');
    const dryRun = !armedRef.current;
    const budget = createBudget(settingsRef.current.actionBudget);
    abortRef.current = false;
    beginRun();
    const report = await runSelfTest({
      goal: text,
      dryRun,
      stopped: selfTestStopped,
      plan: async (g) => {
        const p = await thought(`Self-test plan: ${g}`, () => planFromGoal(g, cardsRef.current, framesRef.current[0] ?? null, askFor('planner'), [...sectionContext(), ...inventoryLines(inventoryRef.current)], patternsRef.current), planSummary);
        return { steps: p.steps, detail: p.source };
      },
      ground: selfTestGround,
      execute: async (s) => {
        const out = await performStep(s, 'Self-test', budget, dryRun);
        return { ok: out.ok, detail: out.message };
      },
      verify: selfTestVerify,
    }).finally(endRun);
    setSelfTestReport(report);
    addLog('Self-test', selfTestText(report), report.pass ? 'ok' : 'error');
    if (!report.pass) captureError({ kind: 'watcher', message: `Self-test failed — ${selfTestText(report)}`, goal: goalRef.current });
    return report;
  };

  /** "/sidetest <target> : <experiment> [: <main>]": experiment → capture → backtrack → main, sentinels watching. */
  const sideTestCommand = async (arg: string) => {
    const { target: where, rest } = splitSideArgs(arg);
    const [experimentText, mainText] = rest;
    const experiment = experimentText ? await planOne(experimentText) : null;
    const main = mainText ? await planOne(mainText) : null;
    if (!experiment) {
      addLog('/sidetest', experimentText ? `Could not plan the experiment "${experimentText}" — AI planner unavailable` : 'Usage: /sidetest <target window> : <experimental action> [: <main action>]', 'warn');
      return;
    }
    await runSide({ name: experimentText, target: where, mode: settingsRef.current.sideTestMode, experiment, ...(main ? { main } : {}) });
  };

  /** "/research <window or URL> : <query>": a research-only side test whose findings become watcher notes. */
  const researchCommand = async (arg: string) => {
    const { target: where, rest } = splitSideArgs(arg);
    const query = rest.join(' ');
    const url = /^https?:\/\//i.test(where);
    await runSide({ name: `Research: ${query || where}`, target: url ? '' : where, mode: settingsRef.current.sideTestMode, research: url ? `${where} ${query}`.trim() : query || where });
  };

  /** The capability registry: presentations, scripts, simulations, video notes and computer control on the real-input path. */
  const capDeps: CapabilityDeps = {
    runBriefed: async (actor, step, budget, dryRun) => {
      const briefed = await brief(actor, { kind: 'go', step, proposal: recordLocal(actor, step, `capability request${goalRef.current ? ` toward "${goalRef.current}"` : ''}, so "${step.name}" is run`) });
      if (briefed.kind !== 'go') return { ok: false, executed: false, message: `"${step.name}" not justified by the pre-action briefing` };
      return execute(briefed.step, actor, budget, dryRun, briefed.proposal);
    },
    dryRun: (actor, step) => performStep(step, actor, createBudget(settingsRef.current.actionBudget), true),
    newBudget: () => createBudget(settingsRef.current.actionBudget),
    armed: () => armedRef.current,
    dispatch: () => dispatchState({ armed: armedRef.current, bridgeOnline, executorOn: settingsRef.current.stages.executor, aborted: abortedRef.current }),
    live: () => framesRef.current[0] ?? null,
    ask: (stage) => (aiOnline() ? askFor(stage) : null),
    learn: (outcomes) => commitHabits(outcomes.reduce((list, o) => recordOutcome(list, o), habitsRef.current)),
    app: habitContext,
    log: addLog,
    stageOn,
    toggleStage,
    sleep,
  };
  /** A bridge screenshot as a source Got: read-only, never input. */
  const bridgeShot = async (): Promise<Got<Frame>> => {
    const { bridgeUrl, bridgeToken } = settingsRef.current;
    if (!bridgeUrl) return { ok: false, reason: 'no desktop / main-app bridge configured' };
    return { ok: true, value: await desktopFrame(bridgeUrl, bridgeToken, ++frameId.current) };
  };
  /** The presentation studio: slideshows, movies, projects, approvals, rich notifications and the in-world embed. */
  const studio = usePresentations({
    ...capDeps,
    frames: () => framesRef.current,
    sources: {
      app: bridgeShot,
      web: (topic) => askResearch(capDeps.ask('planner'))(topic),
      pc: async () => {
        const live = framesRef.current[0];
        return live && live.source !== 'demo' ? { ok: true, value: live } : bridgeShot();
      },
      demo: async () => {
        const shot = demoSnapshot();
        return shot ? { ok: true, value: shot } : { ok: false, reason: 'the demo desktop is not on screen' };
      },
    },
  });
  const caps = useCapabilities(capDeps, studio.capabilities);

  /** /crew locate <element> asks its sentinel; /crew test <what> runs a background-then-main test; any other /crew text is a goal for the AI-directed crew. */
  const crewCommand = async (text: string) => {
    const [, verb = '', rest = ''] = /^(\S+)\s*(.*)$/.exec(text.trim()) ?? [];
    if (verb.toLowerCase() === 'locate' && rest) {
      crew.locateElement(rest);
      return;
    }
    if (verb.toLowerCase() === 'test' && rest) {
      await crew.runTest(crew.detectTest('main AI', `run a test "${rest}"`) ?? { from: 'main AI', reason: 'requested', text: rest });
      return;
    }
    await runCrewGoal(text);
  };

  /** /intercept routes an intercept to the crew: it pauses, factors it in and proposes. */
  const interceptCommand = async (text: string) => {
    crew.intercept(parseIntercept(text));
  };

  /** /backtrack <n> moves the cursor back along the last n steps. */
  const backtrackCommand = async (text: string) => {
    const n = Number.parseInt(text, 10);
    if (!Number.isFinite(n) || n < 1) return addLog('/backtrack', 'Usage: /backtrack <number of recent steps>, e.g. /backtrack 3', 'warn');
    await crew.backtrack(n);
  };

  /** Each slash command's runner. */
  const COMMAND_RUNNERS: Record<Exclude<CommandName, 'test'>, (target: string) => Promise<void>> = {
    use: attachTarget, move: moveTo, measure: measureCommand, arrange, scenario: scenarioCommand, do: caps.doCommand, snip: snipCommand,
    crew: crewCommand, intercept: interceptCommand, backtrack: backtrackCommand, ops: runOps, joint: joint.run,
    section: sectionCommand, scope: scopeCommand, replicate: replicateCommand, sidetest: sideTestCommand, research: researchCommand,
  };

  /** Submits the assist input: slash commands run, anything else is planned as a goal. */
  const submitInput = async () => {
    const command = parseCommand(goal);
    if (!command) {
      if (isTestGoal(goal)) await testRoutes(parseTestSpec(goal));
      else if (isChainGoal(goal)) await runChain(goal);
      else await autoPlan(goal);
      return;
    }
    if (command.kind === 'error') {
      addLog('Command', command.message, 'warn');
      return;
    }
    setGoal('');
    kb.noteSignal('command', goal.trim());
    if (command.kind === 'test') await testRoutes(parseTestSpec(command.target));
    else await COMMAND_RUNNERS[command.kind](command.target);
  };

  /** Explicit demo mode. */
  const useDemo = () => {
    attachSource('demo');
    setTarget(null);
    addLog('Screen', 'Demo desktop selected');
  };

  /** Demo mode with the quest world as the shown scene (the test World is switched off). */
  const useQuestWorld = () => {
    useDemo();
    worldOnRef.current = false;
    questOnRef.current = true;
    addLog('Screen', 'Quest world selected as the capture source');
  };

  /** Downloads the action history as JSON or CSV. */
  const exportHistory = (format: 'json' | 'csv') => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (format === 'json') downloadText(`droid-actions-${stamp}.json`, historyToJson(history), 'application/json');
    else downloadText(`droid-actions-${stamp}.csv`, historyToCsv(history), 'text/csv');
    addLog('History', `Exported ${history.length} action(s) as ${format.toUpperCase()}`, 'ok');
  };

  const resetHistory = () => setHistory(clearHistory());

  const updateWatcher = (fn: (w: WatcherState) => WatcherState) => {
    watcherRef.current = fn(watcherRef.current);
    setWatcher(watcherRef.current);
  };

  /** A capture source is live: the demo, the bridge, the connected main app, or a running (not lost) screen capture. */
  const captureLive = () => sourceRef.current === 'demo' || sourceRef.current === 'bridge' || (sourceRef.current === 'main-app' && mainBridgeRef.current?.state().status === 'connected') || (sourceRef.current === 'screen' && !!captureRef.current);

  /**
   * Tests a proposal's on-screen target as a click through the shared pipeline: a dry run unless
   * armed (abort latch and the watcher's budget gate real input). The result goes to the panel and
   * the log; a failed test is learned as an "avoid" pattern.
   */
  const runWatchTest = async (p: WatchProposal) => {
    const step = proposalStep(p);
    if (!step) {
      addLog('Screen watcher', `"${p.text}" has no on-screen target to test`, 'warn');
      return;
    }
    await testStep(step, { proposalId: p.id, context: p.text, source: 'Screen watcher' }, !armedRef.current, watchBudgetRef.current);
  };

  /**
   * The watcher's background-test machinery for one click step (also the Testing agent's): a dry run
   * or a real click through performStep, reflected on, recorded as a watcher test, and a failure
   * learned as an "avoid" pattern.
   */
  const testStep = async (step: WorkflowStep, of: { proposalId: string; context: string; source: string }, dryRun: boolean, budget: ActionBudget) => {
    const tried = `${dryRun ? 'Dry-run' : 'Real'} click on "${step.target}" at ${gridRef(step)}`;
    const actor = dryRun ? `${of.source} (dry run)` : of.source;
    // performStep, not perform: a test must not remember its target as familiar — only Accept does.
    const out = await performStep(step, actor, budget, dryRun);
    if (!out.halt && aiOnline()) await reflectAfter(step, out.shot ?? framesRef.current[0] ?? null, out, actor);
    const verdict = out.ok ? 'passed' : 'failed';
    const proposal = watcherRef.current.proposals.find((x) => x.id === of.proposalId);
    if (proposal) recordOp(actor, 'screenWatcher', ideaDraft('tested', proposal, `${tried} — ${out.message}`, out.ok));
    updateWatcher((w) => ({ ...w, tests: addTest(w.tests, { proposalId: of.proposalId, tried, happened: out.message, verdict, dryRun }), proposals: patchProposal(w.proposals, of.proposalId, { tested: true }) }));
    addLog(of.source, `Test ${verdict}: ${tried} — ${out.message}`, out.ok ? 'ok' : 'warn');
    if (!out.ok) {
      captureError({ kind: 'watcher', message: `${of.source} test failed: ${tried} — ${out.message}`, goal: goalRef.current, step: step.name });
      addPatterns([newPattern('avoid', `${tried} failed — ${out.message}`, of.context)]);
      strikeAvoid(step, out.message, 'test');
      addLog('Patterns', `${of.source} test failed — advisory lesson: avoid ${tried}`, 'warn');
    }
    return { ok: out.ok, message: out.message };
  };

  /** A new proposal with the prior operations relevant to it, recorded as a proposed idea. */
  const crossReferenced = (p: WatchProposal): WatchProposal => {
    const related = operationDb.related(`${p.text} ${p.target ?? ''}`);
    recordOp('Screen watcher', 'screenWatcher', ideaDraft('proposed', p, related.length ? `${related.length} related prior operation(s)` : 'no related prior operations'));
    return related.length ? { ...p, related } : p;
  };

  /** Stores an observation: deduplicated notes and proposals, each new proposal cross-referenced and logged. */
  const recordObservation = (obs: Observation) => {
    const time = Date.now();
    const notes = mergeNotes(watcherRef.current.notes, obs.notes, time);
    const proposals = mergeProposals(watcherRef.current.proposals, obs.proposals, time);
    const added = new Map(proposals.added.map((p) => [p.id, crossReferenced(p)]));
    updateWatcher((w) => ({ ...w, notes: notes.notes, proposals: proposals.proposals.map((p) => added.get(p.id) ?? p) }));
    if (notes.added.length) addLog('Screen watcher', `${notes.added.length} new note(s): ${notes.added.map((n) => n.text).join('; ')}`, 'info');
    proposals.added.forEach((p) => {
      addLog('Screen watcher', `Proposal: ${p.text}`, 'info');
      if (approvals.route({ text: p.text, requestedBy: 'Screen watcher', proposalId: p.id }, goalRef.current) === 'auto') acceptProposal(p.id);
    });
    notes.added.filter((n) => n.kind === 'unusual').forEach((n) => notify({ source: 'Screen watcher', category: 'agents', severity: 'warning', title: `Unusual on screen: ${n.text}` }));
    proposals.added.forEach((p) => addLog('Screen watcher', `Proposal: ${p.text}`, 'info'));
    if (obs.mode) applyAiMode(obs.mode);
    if (EXECUTION_MODES[settingsRef.current.executionMode].trackElements) proposals.added.filter((p) => p.kind === 'familiar').forEach((p) => acceptProposal(p.id));
  };

  /** One watcher round: observe the live frame, record notes/proposals, then background-test one untested proposal. */
  const watchTick = async () => {
    if (!stageOn('screenWatcher') || watchBusyRef.current || executorBusy() || abortedRef.current || !captureLive() || pausedWhileHidden() || !aiOnline()) return;
    const frame = framesRef.current[0];
    if (!frame) return;
    watchBusyRef.current = true;
    try {
      const related = operationDb.related(goalRef.current, ...stepsRef.current.map((s) => s.target ?? s.name));
      recordObservation(await thought('Screen watcher', () => observeScreen(askFor('screenWatcher'), frame, watcherRef.current.notes, stepsRef.current, goalRef.current, related), observationSummary));
      const untested = watcherRef.current.proposals.find((p) => p.status === 'pending' && !p.tested && proposalStep(p));
      if (untested && !backgroundTestsAllowed(settingsRef.current.relaxMode)) addLog('Screen watcher', 'Relaxation mode — background test paused', 'info');
      else if (untested && !executorBusy() && !abortedRef.current) await runWatchTest(untested);
    } catch (error) {
      addLog('Screen watcher', `AI unavailable — no notes this round: ${errorText(error)}`, 'warn');
    } finally {
      watchBusyRef.current = false;
    }
  };
  const watchTickRef = useRef(watchTick);
  watchTickRef.current = watchTick;

  // Screen watcher loop at its own interval while the agent is on; each switch-on renews its budget.
  const watcherOn = settings.stages.screenWatcher;
  useEffect(() => {
    if (!watcherOn) return undefined;
    watchBudgetRef.current = createBudget(settingsRef.current.actionBudget);
    const id = setInterval(() => void watchTickRef.current(), relaxInterval(settings.watchMs, settings.relaxMode));
    return () => clearInterval(id);
  }, [watcherOn, settings.watchMs, settings.relaxMode]);

  /** Applies an accepted proposal through the existing mechanisms; null when it does not apply now. */
  const applyProposal: Record<ProposalKind, (p: WatchProposal) => string | null> = {
    close_popup: (p) => {
      addPatterns([newPattern('add', `Close the returning popup with its ${p.target ?? 'close control'}`, p.text)]);
      return 'added to the close list (learned pattern)';
    },
    familiar: (p) => {
      if (!p.target || p.x === undefined || p.y === undefined) return null;
      setFamiliar((list) => rememberElement(list, { id: uid('el'), name: p.target!, x: p.x!, y: p.y!, lastSeen: Date.now() }));
      return `saved "${p.target}" as a familiar element`;
    },
    workflow: (p) => {
      const next = p.target ?? p.text;
      goalRef.current = next;
      setGoal(next);
      return `queued "${next}" as the goal — press Plan to run it`;
    },
    pattern: (p) => {
      const kind = /^avoid\b/i.test(p.text) ? 'avoid' : 'add';
      addPatterns([newPattern(kind, p.text.replace(/^(avoid|add)\b\s*:?\s*/i, '') || p.text, p.target ?? '')]);
      return `saved as an "${kind}" pattern`;
    },
    reorder: (p) => {
      const next = p.from && p.to ? reorderSteps(stepsRef.current, p.from, p.to) : null;
      if (!next) return null;
      stepsRef.current = next;
      setSteps(next);
      return `moved step ${p.from} to position ${p.to}`;
    },
  };

  const acceptProposal = (id: string) => {
    const p = watcherRef.current.proposals.find((x) => x.id === id && x.status === 'pending');
    if (!p) return;
    const done = applyProposal[p.kind](p);
    if (done === null) {
      addLog('Screen watcher', `Cannot apply "${p.text}" — it does not match the current screen or steps`, 'warn');
      recordOp('Screen watcher', 'screenWatcher', ideaDraft('accepted', p, 'does not match the current screen or steps', false));
      return;
    }
    updateWatcher((w) => ({ ...w, proposals: patchProposal(w.proposals, id, { status: 'accepted' }) }));
    kb.noteSignal('command', p.text);
    addLog('Screen watcher', `Accepted "${p.text}": ${done}`, 'ok');
    recordOp('Screen watcher', 'screenWatcher', ideaDraft('accepted', p, done));
  };

  const dismissProposal = (id: string) => {
    const p = watcherRef.current.proposals.find((x) => x.id === id && x.status === 'pending');
    if (!p) return;
    updateWatcher((w) => ({ ...w, proposals: patchProposal(w.proposals, id, { status: 'dismissed' }) }));
    kb.noteSignal('correction', `dismissed proposal: ${p.text}`);
    addLog('Screen watcher', `Dismissed "${p.text}"`, 'info');
    recordOp('Screen watcher', 'screenWatcher', ideaDraft('dismissed', p, 'dismissed by the user'));
  };

  /** A decision feeds the learned-methods memory (avoid on reject, add on approve/edit). */
  const learnDecision = (item: ApprovalItem) => {
    const lesson = decisionLesson(item);
    addPatterns([newPattern(lesson.kind, lesson.pattern, lesson.context)]);
    addLog('Patterns', `Approval decision — learned: ${lesson.kind} ${lesson.pattern}`, lesson.kind === 'avoid' ? 'warn' : 'ok');
  };

  /**
   * Runs an approved operation through the one dispatch path, so abort, arm and budget still
   * apply; it resolves only when the operation really executed, otherwise the reason is noted.
   */
  const runApproved = async (item: ApprovalItem, step: WorkflowStep, status: 'approved' | 'edited', edit?: string) => {
    if (executorBusy()) {
      approvals.note(item.id, 'Busy running a step — approve again when it finishes');
      return;
    }
    approvals.release(step.id);
    const out = await performStep(step, `Approvals (${item.requestedBy})`, createBudget(settingsRef.current.actionBudget), false);
    approvals.release(step.id, false);
    if (!out.executed) {
      approvals.note(item.id, `Approved but not executed — ${out.message}`);
      addLog('Approvals', `"${item.summary}" approved but not executed — ${out.message}`, 'warn');
      return;
    }
    const decided = approvals.decide(item.id, status, edit);
    if (decided) learnDecision(decided);
  };

  /** Approves (elevates) a pending item, or approves it with the user's edited text. */
  const approveWith = async (id: string, status: 'approved' | 'edited', edit?: string) => {
    const item = approvals.current(id);
    if (!item || item.status !== 'pending') return;
    if (item.step) {
      await runApproved(item, edit === undefined ? item.step : editedStep(item.step, edit), status, edit);
      return;
    }
    if (item.proposalId && edit !== undefined) updateWatcher((w) => ({ ...w, proposals: patchProposal(w.proposals, item.proposalId!, { text: edit }) }));
    if (item.proposalId) acceptProposal(item.proposalId);
    const decided = approvals.decide(id, status, edit);
    if (!decided) return;
    learnDecision(decided);
    await joint.onDecided(decided);
  };

  const approveItem = (id: string) => approveWith(id, 'approved');
  const editItem = (id: string, text: string) => (text.trim() ? approveWith(id, 'edited', text.trim()) : Promise.resolve());

  const rejectItem = (id: string) => {
    const item = approvals.decide(id, 'rejected');
    if (!item) return;
    if (item.proposalId) dismissProposal(item.proposalId);
    learnDecision(item);
  };

  /** The tree's run-check: re-evaluates every pending item against the current goal, plan, history and proposals. */
  const runApprovalCheck = () => approvals.check({ now: Date.now(), goal: goalRef.current, steps: stepsRef.current, history, proposals: watcherRef.current.proposals });

  /** Updates the user's operation conditions. */
  const setOperationPolicy = (change: Partial<OperationPolicy>) => setSettings((s) => ({ ...s, operationPolicy: { ...s.operationPolicy, ...change } }));

  /**
   * Apply on a held aggressive candidate: runs it through the gated pipeline (a dry run unless armed;
   * refused when aborted, over budget or with the executor stage unchecked) and records the outcome on its step.
   */
  const applyCandidate = async (id: string) => {
    const c = candidatesRef.current.find((x) => x.id === id);
    const idx = c ? stepsRef.current.findIndex((s) => s.id === c.stepId && s.status !== 'done' && s.status !== 'running') : -1;
    if (!c) return;
    putCandidates(candidatesRef.current.filter((x) => x.id !== id));
    if (idx < 0) return addLog('Aggressive', `"${c.step.name}" is no longer waiting to run — not applied`, 'warn');
    const dry = !armedRef.current;
    updateStep(idx, { status: 'running' });
    const out = await perform(c.step, 'Aggressive', createBudget(settingsRef.current.actionBudget), dry, c.proposal);
    applyOutcome(idx, out, dry, framesRef.current[0] ?? null);
    addLog(dry ? 'Aggressive (dry run)' : 'Aggressive', `Applied "${c.step.name}": ${out.message}`, out.ok ? 'ok' : 'error');
  };

  /** Dismiss on a held aggressive candidate: dropped, and its step falls back to the normal proposal. */
  const dismissCandidate = (id: string) => {
    const c = candidatesRef.current.find((x) => x.id === id);
    if (!c) return;
    putCandidates(candidatesRef.current.filter((x) => x.id !== id));
    dismissedGroundingRef.current.add(c.stepId);
    addLog('Aggressive', `Dismissed the candidate for "${c.step.name}" — it gets the normal proposal`, 'info');
  };

  /** The Test button: a background test of one proposal, refused while the executor or watcher is busy. */
  const testProposal = async (id: string) => {
    const p = watcherRef.current.proposals.find((x) => x.id === id);
    if (!p) return;
    if (watchBusyRef.current || executorBusy()) {
      addLog('Screen watcher', `Busy running a step — test of "${p.text}" not started`, 'warn');
      return;
    }
    watchBusyRef.current = true;
    try {
      await runWatchTest(p);
    } finally {
      watchBusyRef.current = false;
    }
  };

  /** Stores `draft` with the current steps as a Library card (a saved operation), replacing a near-duplicate flow; returns its id. */
  const storeCard = (draft: { name: string; description: string }) => {
    const { saved, replaced } = commitCard({ id: uid('card'), ...draft, steps: stepsRef.current, savedAt: Date.now() });
    flowRef.current = saved.id;
    addLog('Library', `Saved "${draft.name}"${replaced ? ` — updated the existing "${replaced.name}"` : ''}`, 'ok');
    kb.noteSignal('saved', draft.name);
    setDraftCard(null);
    return saved.id;
  };

  /** Highlights a point on the preview for 3 s. */
  const flash = (h: { x: number; y: number; label: string }) => {
    setHighlight(h);
    setTimeout(() => setHighlight((cur) => (cur && cur.x === h.x && cur.y === h.y ? null : cur)), 3000);
  };

  const initiativeApi = useInitiative({
    settings: () => settingsRef.current,
    stageOn,
    askFor,
    thought,
    addLog,
    aiOnline,
    screenReady: () => captureLive() && !pausedWhileHidden(),
    executorBusy,
    aborted: () => abortedRef.current,
    armed: () => armedRef.current,
    frame: () => framesRef.current[0] ?? null,
    steps: () => stepsRef.current,
    setSteps: (next) => {
      stepsRef.current = next;
      setSteps(next);
    },
    goal: () => goalRef.current,
    performStep,
    highlight: flash,
    testTargets: () => testTargets(elementMapRef.current, familiarRef.current),
    known: () => familiarRef.current,
    cards: () => cardsRef.current,
    saveCard: (card) => {
      commitCard(card);
    },
    recordHabit: (habitName, success) => {
      if (stageOn('coords')) commitHabits(recordOutcome(habitsRef.current, { target: habitName, context: habitContext(), success }));
    },
    recordRun: (runGoal, runSteps, opts, startedAt) => setRuns((r) => appendSummary(r, runSummary({ goal: runGoal, steps: runSteps, startedAt, ...opts, session: sessionRef.current }))),
  });
  afterRunRef.current = initiativeApi.afterRun;

  const saveCard = () => {
    if (draftCard) storeCard(draftCard);
  };

  /** Removes a step at the user's hand: a correction of the plan, recorded in the user profile. */
  const removeStep = (index: number) => {
    const step = stepsRef.current[index];
    if (!step) return;
    stepsRef.current = stepsRef.current.filter((_, j) => j !== index);
    setSteps(stepsRef.current);
    kb.noteSignal('correction', `removed step: ${step.action} "${step.target ?? step.name}"`);
  };

  const loadCard = (card: SavedCard) => {
    steerPrevious(card.name);
    expectRef.current = [];
    stepsRef.current = card.steps.map((s) => ({ ...s, status: 'pending' as const }));
    setSteps(stepsRef.current);
    markPlan();
    flowRef.current = card.id;
    tracer.begin({ goal: card.description.trim() || card.name, source: 'workflow', steps: stepsRef.current, workflowId: card.id });
    addLog('Library', `Loaded "${card.name}"`);
  };

  const setTriggerList = (next: Trigger[]) => {
    triggersRef.current = next;
    setTriggers(next);
  };

  /** Saved operations, playback of the main app's last 30 s, and detect + retry, all running through runReplay. */
  const savedOps = useOperations({
    addLog,
    settings: () => settingsRef.current,
    liveFrame: () => framesRef.current[0] ?? null,
    steps: () => stepsRef.current,
    loadSteps: (name, next, flowId) => {
      loadCard({ id: flowId ?? '', name, description: '', savedAt: 0, steps: next });
      flowRef.current = flowId;
    },
    plan: (text) => autoPlan(text),
    replay: (label, runGoal) => runReplay(false, { label, goal: runGoal }),
    busy: () => triggerBusyRef.current || executorBusy(),
    habits: () => habitsRef.current,
    habitContext,
    runs,
  });
  const patchTrigger = (id: string, fn: (t: Trigger) => Trigger) => setTriggerList(triggersRef.current.map((t) => (t.id === id ? fn(t) : t)));
  const targetLabel = (t: Trigger) => targetText(t.target, cardsRef.current, savedOps.operations);

  /** Creates a trigger from the Triggers panel; appear/disappear need an element mapped with its template frame. */
  const addTrigger = (draft: TriggerDraft) => {
    if (!draft.name.trim()) return addLog('Triggers', 'Name the trigger first', 'warn');
    if (draft.kind === 'schedule' && !(Number.isFinite(draft.at) && draft.at >= 0)) return addLog('Triggers', `"${draft.name.trim()}" not created — set a valid run time`, 'warn');
    if (draft.kind === 'element') {
      const el = elementMapRef.current.find((e) => e.id === draft.elementId);
      if (!el) return addLog('Triggers', `"${draft.name.trim()}" not created — pick a mapped element`, 'warn');
      if (draft.event !== 'change' && !el.frame) return addLog('Triggers', `"${draft.name.trim()}" not created — "${el.name}" was mapped without a live frame, so its presence cannot be judged; re-map it on the live screen`, 'warn');
    }
    const t = createTrigger(draft, uid('trigger'));
    setTriggerList([t, ...triggersRef.current].slice(0, TRIGGER_LIMIT));
    addLog('Triggers', `Created "${t.name}": run ${targetLabel(t)} ${conditionText(t, elementMapRef.current)} (cooldown ${t.cooldownSec} s, ${t.maxRuns ? `at most ${t.maxRuns} run(s)` : 'no run limit'})`, 'ok');
  };

  const toggleTrigger = (id: string) => {
    const t = triggersRef.current.find((x) => x.id === id);
    if (!t) return;
    // Re-enabling a trigger that hit its run limit starts a fresh count.
    patchTrigger(id, (x) => (x.enabled ? { ...x, enabled: false } : { ...x, enabled: true, runs: x.maxRuns && x.runs >= x.maxRuns ? 0 : x.runs }));
    addLog('Triggers', `"${t.name}" ${t.enabled ? 'disabled' : 'enabled'}`, t.enabled ? 'info' : 'ok');
  };

  const deleteTrigger = (id: string) => {
    const t = triggersRef.current.find((x) => x.id === id);
    if (!t) return;
    setTriggerList(triggersRef.current.filter((x) => x.id !== id));
    addLog('Triggers', `Deleted "${t.name}"`, 'info');
  };

  /** The goal a triggered run verifies: the flow's description or name, else the draft card's goal. */
  const triggeredGoal = (card?: SavedCard) => (card ? card.description.trim() || card.name : runGoalOf());

  /**
   * Fires trigger `id` through the same replay pipeline as the Replay button (grounding, execution,
   * reflect, verdict, auto-continue, retry ladder, arm/disarm, budget, abort, loop-control stages).
   * A cooldown, run limit, ABORTED or a missing target skips it (logged; a schedule moves on).
   */
  const fireTrigger = async (id: string, why: string) => {
    const t = triggersRef.current.find((x) => x.id === id);
    if (!t) return;
    if (triggerBusyRef.current || executorBusy()) {
      addLog('Triggers', `"${t.name}" skipped (${why}) — a run is in progress`, 'warn');
      return;
    }
    const now = Date.now();
    const skip = fireGate(t, now);
    const target = resolveTarget(t.target, cardsRef.current, draftCard, savedOps.operations);
    const refusal = skip ? skip.detail : abortedRef.current ? ABORTED_REFUSAL : 'error' in target ? `cannot run — ${target.error}` : null;
    if (refusal !== null || 'error' in target) {
      addLog(!skip && abortedRef.current ? 'Safety' : 'Triggers', `"${t.name}" skipped (${why}): ${refusal}`, skip?.reason === 'cooldown' ? 'info' : 'warn');
      patchTrigger(id, (x) => afterSkip(x, now));
      return;
    }
    const fired = afterFire(t, now);
    patchTrigger(id, () => fired);
    addLog('Triggers', `Fired "${t.name}" (${why}) — running ${target.name}, run ${fired.runs}${fired.maxRuns ? ` of ${fired.maxRuns}` : ''}`, 'info');
    if (!fired.enabled && t.enabled) addLog('Triggers', `"${t.name}" ${fired.kind === 'schedule' && fired.everySec === 0 ? 'was a one-time schedule' : `reached its run limit (${fired.maxRuns})`} — disabled`, 'info');
    if (target.card) loadCard(target.card);
    if (target.operation) savedOps.loadOperation(target.operation);
    triggerBusyRef.current = true;
    try {
      const outcome = await runReplay(false, { label: `Trigger "${t.name}"`, goal: target.operation?.goal ?? triggeredGoal(target.card) });
      if (target.operation) savedOps.countOutcome(target.operation.id, outcome);
      const result = outcomeText(outcome);
      addLog('Triggers', `"${t.name}" result: ${result.text}`, result.tone);
    } finally {
      triggerBusyRef.current = false;
    }
  };

  /** The element triggers whose event the newest frame shows; each frame is evaluated once, the first as a baseline. */
  const elementEvents = (): Array<{ id: string; why: string }> => {
    const frame = framesRef.current[0];
    if (!frame || frame.id === triggerFrameRef.current) return [];
    triggerFrameRef.current = frame.id;
    const watching = triggersRef.current.filter((t): t is ElementTrigger => t.kind === 'element' && t.enabled);
    const snaps = elementSnapsRef.current;
    [...snaps.keys()].filter((id) => !watching.some((t) => t.elementId === id)).forEach((id) => snaps.delete(id));
    const out: Array<{ id: string; why: string }> = [];
    for (const el of elementMapRef.current.filter((e) => watching.some((t) => t.elementId === e.id))) {
      const { snapshot, events } = observeElement(el, snaps.get(el.id), frame);
      snaps.set(el.id, snapshot);
      watching.filter((t) => t.elementId === el.id && events.includes(t.event)).forEach((t) => out.push({ id: t.id, why: `"${el.name}" ${t.event === 'change' ? 'changed' : `${t.event}ed`} on screen` }));
    }
    return out;
  };

  /**
   * One trigger round: element triggers against the live frame (only while the Screen watcher stage
   * is on and a capture is live), then due schedules. During a run, element events are logged as
   * skipped and due schedules wait until the executor is free.
   */
  const triggerTick = async () => {
    const events = stageOn('screenWatcher') && captureLive() && !pausedWhileHidden() ? elementEvents() : [];
    if (triggerBusyRef.current || executorBusy() || dispatchPaused()) {
      events.forEach((e) => addLog('Triggers', `"${triggersRef.current.find((t) => t.id === e.id)?.name}" skipped (${e.why}) — ${dispatchPaused() ? `runs ${dispatchPaused()}` : 'a run is in progress'}`, 'warn'));
      return;
    }
    const now = Date.now();
    const due = triggersRef.current.filter((t): t is ScheduleTrigger => t.kind === 'schedule' && scheduleDue(t, now)).map((t) => ({ id: t.id, why: `scheduled for ${new Date(t.at).toLocaleTimeString()}` }));
    for (const d of [...events, ...due]) await fireTrigger(d.id, d.why);
  };
  const triggerTickRef = useRef(triggerTick);
  triggerTickRef.current = triggerTick;

  // Trigger loop while any trigger is enabled.
  const anyTriggerOn = triggers.some((t) => t.enabled);
  useEffect(() => {
    if (!anyTriggerOn) return undefined;
    const id = setInterval(() => void triggerTickRef.current(), TRIGGER_TICK_MS);
    return () => clearInterval(id);
  }, [anyTriggerOn]);

  /** Keeps a note for an operation; it rides with every AI turn of that kind of operation. */
  const addOperationNote = (operation: string, text: string) => {
    memoryRef.current = addOperationMemoryNote(memoryRef.current, operation, text);
    setMemory(memoryRef.current);
  };

  /** Forgets one failure reminder or note. */
  const forgetMemory = (id: string) => {
    memoryRef.current = forget(memoryRef.current, id);
    setMemory(memoryRef.current);
  };

  /** Every remembered operation with its notes, failures, blacklist and successes, for the panel. */
  const operations = operationGroups({ patterns, habits, memory }, runs);
  /** Whether input really reaches the PC right now (armed + bridge connected + executor stage on, not aborted). */
  const dispatch = dispatchState({ armed, bridgeOnline, executorOn: settings.stages.executor, aborted });
  /** Relaxation mode: the settings it replaced, restored when it is switched off; null while off. */
  const relaxedRef = useRef<Pick<AssistSettings, 'captureMs' | 'watchMs' | 'monitorMode' | 'autoAct'> | null>(null);

  /** Replaces the settings at once (the ref first, so a running loop sees them) and in the panel. */
  const putSettings = (next: AssistSettings) => {
    settingsRef.current = next;
    setSettings(next);
  };

  /** A live adjustment from the AI (or any requester): validated, applied immediately and logged; throws when rejected. */
  const adjustSetting = (key: LiveSetting, value: unknown, requester: Requester) => {
    const r = applyLiveSetting(settingsRef.current, key, value);
    if (!r.ok) throw new Error(r.message);
    putSettings(r.settings);
    addLog('Live adjust', `${requesterName(requester)}: ${r.message}`, 'ok');
    return r.message;
  };

  const setRelaxed = (on: boolean) => {
    const s = settingsRef.current;
    if (on === !!relaxedRef.current) return `relaxation mode already ${on ? 'on' : 'off'}`;
    if (on) {
      relaxedRef.current = { captureMs: s.captureMs, watchMs: s.watchMs, monitorMode: s.monitorMode, autoAct: s.autoAct };
      putSettings({ ...s, captureMs: LIVE_SETTINGS.captureMs.max, watchMs: LIVE_SETTINGS.watchMs.max, monitorMode: 'app', autoAct: false });
    } else {
      putSettings({ ...s, ...relaxedRef.current });
      relaxedRef.current = null;
    }
    addLog('Relaxation mode', on ? 'On — slowest capture and watcher cadence, app monitor, Auto Act off' : 'Off — previous cadence, monitor mode and Auto Act restored', 'info');
    return `relaxation mode ${on ? 'on' : 'off'}`;
  };

  /** The saved flow named or with id `ref` (case-insensitive name). */
  const findCard = (ref: string) => cardsRef.current.find((c) => c.id === ref || c.name.toLowerCase() === ref.trim().toLowerCase());

  const saveWorkflow = (name?: string) => {
    if (!stepsRef.current.length) throw new Error('no steps to save — plan or record a workflow first');
    const generated = generateCard(stepsRef.current, goalRef.current);
    const draft = name?.trim() ? { name: name.trim(), description: generated.description } : draftCard ?? generated;
    return `saved "${draft.name}" as ${storeCard(draft)}`;
  };

  const loadWorkflow = (ref: string) => {
    const card = findCard(ref);
    if (!card) throw new Error(`no saved workflow "${ref}"`);
    loadCard(card);
    return `loaded "${card.name}" (${card.steps.length} step(s))`;
  };

  /** A schedule trigger for a saved flow (or the draft card) due in `inSec`, repeating every `everySec` (0 = once). */
  const schedule = (name: string, inSec: number, everySec: number, flow?: string) => {
    const card = flow ? findCard(flow) : undefined;
    if (flow && !card) throw new Error(`no saved workflow "${flow}"`);
    const before = triggersRef.current[0];
    addTrigger({ kind: 'schedule', name, at: Date.now() + inSec * 1000, everySec, cooldownSec: 0, maxRuns: 0, target: card ? { kind: 'card', cardId: card.id } : { kind: 'draft' } });
    const created = triggersRef.current[0];
    if (!created || created === before) throw new Error(`"${name}" not created — see the log`);
    return `scheduled "${created.name}" (${created.id}) ${conditionText(created, elementMapRef.current)}`;
  };

  const snipToLog = async (box: Box) => {
    const f = framesRef.current[0];
    if (!f) throw new Error('no captured frame yet — share the screen or connect the bridge first');
    const crop = await cropFrame(f, box);
    addLog('Snip', `Snipped (${pct(box.x)}, ${pct(box.y)}) ${pct(box.w)}×${pct(box.h)} of frame #${f.id}`, 'info', [crop.url]);
    return `snipped ${pct(box.w)}×${pct(box.h)} of frame #${f.id} into the log`;
  };

  /** Screenshot verification: the model checks the goal on the live frame. */
  const verifyScreen = async (g: string) => {
    const check = await thought(`Verify: ${g || runGoalOf()}`, () => verifyGoal(askFor('autoContinue'), framesRef.current[0] ?? null, g || runGoalOf(), stepsRef.current), goalSummary);
    return goalSummary(check);
  };

  const setBudget = (limit: number) => {
    const actionBudget = sanitizeBudget(limit);
    putSettings({ ...settingsRef.current, actionBudget });
    return `action budget ${actionBudget}`;
  };

  /** The snapshot the main Droid app can query over the bridge. */
  const assistStatus = (): AssistStatus => {
    const s = settingsRef.current;
    return {
      time: Date.now(), armed: armedRef.current, aborted: abortedRef.current, running: executorBusy(), goal: goalRef.current, steps: stepsRef.current.length,
      settings: { captureMs: s.captureMs, watchMs: s.watchMs, stepRetries: s.stepRetries, maxIterations: s.maxIterations, monitorMode: s.monitorMode, aiView: s.aiView, autoAct: s.autoAct, relaxed: !!relaxedRef.current, stages: s.stages },
      capabilities: capabilities.registry.list.filter((c) => !permission(c, MAIN_APP)).map((c) => c.id),
    };
  };

  /** The AI's drift check on its own screen: the next step's template matched on the current source's live frame. */
  const driftCheckNow = async (): Promise<string> => {
    const next = stepsRef.current.find((s) => s.status === 'pending' || s.status === 'running') ?? stepsRef.current[0];
    if (!next?.refFrame) return 'no step with a reference screenshot to check';
    const live = await evidenceFrame().catch(() => null);
    if (!live) return `no live frame from the ${captureLabel(sourceRef.current, captureRef.current?.kind)}`;
    const { r, level } = driftCheck(next, live);
    return `"${next.name}" on the ${captureLabel(sourceRef.current, captureRef.current?.kind)}: ${level} (region ${r.regionDistance.toFixed(3)}, best ${r.matchDistance.toFixed(3)}, drift (${pct(r.dx)}, ${pct(r.dy)}))`;
  };

  const capabilities = useCapabilityRegistry({
    plan: autoPlan, replay, selfTest: async () => {
      const r = await runSelfTestNow();
      return r ? selfTestText(r) : 'self-test not run — see the log';
    }, stop, toggleRecording, setStage: toggleStage,
    setAgent: (id, on) => setAgents((list) => list.map((a) => (a.id === id ? { ...a, on } : a))),
    adjustSetting, setAutoAct: (on) => putSettings({ ...settingsRef.current, autoAct: on }), setRelaxed,
    saveWorkflow, loadWorkflow, workflows: () => cardsRef.current.map((c) => `${c.id}: ${c.name} (${c.steps.length} step(s))`),
    schedule, toggleTrigger, fireTrigger: (id) => fireTrigger(id, 'requested through capabilities'),
    triggers: () => triggersRef.current.map((t) => `${t.id}: ${t.name} — ${conditionText(t, elementMapRef.current)}${t.enabled ? '' : ' (disabled)'}`),
    stats: () => {
      const t = runTotals(runs);
      return `${t.runs} run(s): ${t.successes} succeeded, ${t.failures} failed (${pct(t.rate)} success)`;
    },
    exportBackup: () => {
      const name = backupFileName();
      downloadText(name, JSON.stringify(exportBackup(), null, 2), 'application/json');
      return `backup downloaded as ${name}`;
    },
    exportHistory, snip: snipToLog, rulerToggle: ruler.toggle,
    recalibrate: () => (ruler.recalibrateNow('manual') ? 'recalibrated' : 'no baseline to recalibrate against'),
    measure: measureFor, toggleMapMode,
    elements: () => [...elements.map((e) => `${e.name} at ${at(e.x, e.y)} (${e.source})`), ...elementMap.map((e) => `${e.name} at ${at(boxCenter(e.box).x, boxCenter(e.box).y)} (mapped)`)],
    testElement: (name, x, y) => testClick({ id: uid('el'), name, x, y, source: 'familiar' }),
    testRoutes: (spec) => testRoutes(parseTestSpec(spec)), supervise: superviseRun,
    sections: (g) => sectionsOf(parseTestSpec(g)), ask: askScreen, verifyScreen, driftCheck: driftCheckNow, reverseLast,
    setArmed: (on) => {
      if (armedRef.current !== on) toggleArmed();
    },
    abort: triggerAbort, clearAbort, setBudget, status: assistStatus,
    blacklist: () => avoidRulesRef.current.map((r) => ruleLine(r)), clearBlacklist,
  }, addLog, { url: settings.bridgeUrl, token: settings.bridgeToken });

  /** Runs the operations the AI asked for, in order, through the registry as the AI (refused while ABORTED). */
  const runAiRequests = async (requests: CapabilityRequest[]) => {
    for (const r of requests) {
      if (abortedRef.current) return addLog('Capabilities', refusedWhileAborted(`AI request "${r.id}"`), 'error');
      await capabilities.invoke(r.id, r.params, AI);
    }
  };

  /** A bus agent asks for a feature operation; the registry checks it may (guardrails and other agents' stages are refused). */
  const requestCapability = (agent: AgentId, id: string, params: Params = {}) => capabilities.invoke(id, params, { kind: 'agent', agent });
  /** Turns recording on or off through the Record button's path (a no-op when already in that state). */
  const setRecordingOn = (on: boolean) => {
    if (on !== recordingRef.current) toggleRecording();
  };

  const packs = usePacks({
    addLog,
    goalInput: () => goalRef.current,
    ask: () => askFor('planner'),
    frame: () => framesRef.current[0] ?? null,
    plan: async (planGoal, context) => (await thought(`Perform similar: ${planGoal}`, () => planFromGoal(planGoal, [], framesRef.current[0] ?? null, askFor('planner'), [...context, ...knownRef.current.map(elementLine)], patternsRef.current), planSummary)).steps,
    runStep: async (step, actor, budget, dryRun) => {
      const briefed = await brief(actor, { kind: 'go', step, proposal: recordLocal(actor, step, `workflow pack "${step.name}" is run on the live screen`) });
      if (briefed.kind !== 'go') return { ok: false, message: `not justified by the pre-action briefing — ${briefed.reason}`, target: { x: step.x, y: step.y } };
      const paused = dispatchPaused();
      if (paused) return { ok: false, message: `not dispatched — run ${paused}`, target: { x: step.x, y: step.y } };
      const out = await execute(briefed.step, actor, budget, dryRun, briefed.proposal);
      return { ok: out.ok, message: out.message, target: out.target };
    },
    replay: (packSteps, label, packGoal) => {
      stepsRef.current = packSteps;
      setSteps(packSteps);
      return runReplay(false, { label, goal: packGoal });
    },
    setRecording: setRecordingOn,
    armed: () => armedRef.current,
    busy: () => executorBusy() || abortedRef.current || subRunningRef.current || triggerBusyRef.current || !!dispatchPaused(),
    stopped: () => abortRef.current || abortedRef.current,
    resetStop: () => {
      abortRef.current = false;
    },
    budget: () => settingsRef.current.actionBudget,
  }, recording);
  packCaptureRef.current = packs.capture;

  return {
    settings, setSettings, source, target, frames, pinned, setPinned, steps, setSteps, trail, setTrail, recording, replaying,
    activeIndex, sync, annotations, cursor, log, cards, draftCard, setDraftCard, goal, setGoal, progress, setProgress,
    agents, setAgents, toggleStage, plays, demoCanvasRef, captureLost, DEMO_W, DEMO_H, intervalMs, shotCount, history,
    armed, aborted, abortedAt, aiStatus, aiAnswer, aiBusy, timeline, patterns, deletePattern, avoidRules, clearBlacklist, supervisor, superviseRun,
    ruler, continuing, habits, deleteHabit, pinHabit, runs, dossiers, preferPosition,
    /** The cross-referenced memory view: methods, element usage, paths, goals and positions. */
    memory: enhancedMemory,
    /** Every operation's traced goal (newest first) and the Goal tracer's live status. */
    goals, tracerStatus: tracer.status(),
    /** Every step attempt (planned target, timing, intention) and the traced goal of the running operation. */
    attempts, activeGoal: tracer.active(),
    familiar, forgetFamiliar, elements, learned, highlight, testClick,
    elementMap, mapMode, toggleMapMode, mapDraft, setMapDraft, saveMapped, deleteMapped,
    scanNow, setElementPerform, proposePerform, addNavigateStep, trainMapped, training,
    snips, snip, snipMode, toggleSnipMode, userSnip, snipToMap,
    sections, scope, saveSection, deleteSection, proposeSections, replicas, sideResults,
    /** Section profiles (elements with dossiers, logs, changes) and their cross-referenced memory lines. */
    sectionProfiles: buildProfiles(sections, elementMap, familiar, frames[0]),
    watcher, acceptProposal, dismissProposal, testProposal, wake,
    approvals: approvals.items, approvalTree: approvals.tree, approveItem, editItem, rejectItem, runApprovalCheck, setOperationPolicy,
    initiative: initiativeApi.initiative, acceptInitiative: initiativeApi.acceptInitiative, dismissInitiative: initiativeApi.dismissInitiative,
    initiativeScanNow: initiativeApi.scanNow, stressTest: initiativeApi.stressTest, testTargets: testTargets(elementMap, familiar),
    triggers, addTrigger, toggleTrigger, deleteTrigger, fireTrigger, packs,
    accessPaths, editAccessPath, deleteAccessPath, testAccessPath,
    /** Saved operations, the main app's playback and detect + retry. */
    ...savedOps,
    bus, knownElements, forwardElement, subReport, subRunning, testRoutes, aiQueue,
    /** The coordinated crew (sentinels, testers, intercepts) and the AI-directed crew agents (/crew <goal>). */
    crew, crewAgents, crewRunning, runCrewGoal, stopPlan, swarm, liveDragging, interveneDrag,
    aiHistory, trimAiHistory, resetAiSession,
    /** Per-operation memory (failures, notes) and its per-operation groups. */
    operationMemory: memory, memoryOperations: operations, addOperationNote, forgetMemory,
    /** The operation database: every element, track, capture, error and idea operation. */
    dbOperations: operationDb.operations, exportOperations: operationDb.exportOperations, clearOperations: operationDb.clearOperations,
    ops, opsRunning, runOps, opsFor: (operation: string) => opsFor(operation, ops, log),
    /** The AI is planning, reflecting, deciding or verifying right now. */
    aiWorking: aiBusy || aiCalls > 0,
    onStageMove, onStageClick, onStageDoubleClick, onStageDrag, onStageType, onStageKey, onStageScroll, toggleRecording, replay, stop, stopAi, autoPlan, submitInput, askScreen, explainScreen,
    /** Live agent reports on the cadence, the AI's current focus, and the auto point-out toggle. */
    agentReports, attention, pointOutAuto, startPointOut, stopPointOut,
    knowledge: kb, removeStep, variations,
    shareScreen, connectBridge, connectAi, useDemo, useQuestWorld, saveCard, loadCard, addLog, toggleArmed, triggerAbort, clearAbort, exportHistory, resetHistory,
    bridgeOnline, verifyRealInput,
    /** The main Droid app bridge's live state, and selecting its preview as the screen source. */
    mainBridge, selectMainApp,
    /** The active capture source, its kind and whether replay/drift are armed for it (HUD). */
    captureSource: captureStatus({ source, kind: captureRef.current?.kind, hasFrame: frames.length > 0, bridgeUrl: settings.bridgeUrl, mainConnected: mainBridge.status === 'connected' }),
    /** Whether input really reaches the PC right now (armed + bridge connected + executor stage on, not aborted). */
    dispatch,
    /** What the preview does with input right now: passive, LIVE to the PC, or a labeled dry run. */
    mirror: mirrorMode(mirrorOn, dispatch),
    mirrorOn, toggleMirror, mirrorInput,
    personas, personaId, selectPersona, addPersona, deletePersona, playTurn, playTurns, playing, sightings, playView, lanes,
    reverse, reverseLast, reversing, briefings, chain, runChain,
    /** The per-project lifecycle engine and its approval queue. */
    projects: projectEngine,
    /** The AI resolution center: disagreements, resolutions, recovery operations and the approval queue. */
    resolution,
    objectives, queueNextGoal, removeGoal, userNotes, addNote, preferred, preferFrame,
    /** The capability registry and its artifacts; `invokeCapability` is the one permission-checked path for the main AI, the user and agents. */
    artifactCapabilities: caps.registry, invokeCapability: caps.invoke, presentations: caps.presentations, scripts: caps.scripts, artifactKnowledge: caps.knowledge,
    /** The capability registry: the single dispatch surface for buttons, the AI, agents and the main app. */
    capabilities: capabilities.registry.list, invocations: capabilities.invocations, invoke: capabilities.invoke, requestCapability, relaxed: !!relaxedRef.current,
    inventory, routes, routeProfiles, plotRoute, runRoute, fixMethods, pendingFix, runFixScript, dismissFix, retest, retestFlow,
    /** The last end-to-end AI self-test (plan → ground → execute → verify) and running one. */
    selfTestReport, runSelfTestNow,
    /** The presentation studio: slideshows, movies, projects, composition approvals, rich notifications and the in-world embed. */
    studio,
    setMode, modeChange, candidates, applyCandidate, dismissCandidate,
    /** The AI-down circuit breaker (strikes, paused status) and the user's Resume of a paused run. */
    breaker, resumeRun,
    errors: errorForwarding.errors, errorEndpoint: errorForwarding.endpoint, sendErrorNow: errorForwarding.sendNow, sendTestError: errorForwarding.sendTest,
    notifications: notifier.notifications, markRead: notifier.markRead, markAllRead: notifier.markAllRead, clearNotifications: notifier.clearNotifications,
    actOnNotification, refreshSuggestions: () => refreshSuggestions(false),
    system, recovery, restoreLastGood: restoreLastGoodExport,
  };
}

/** The engine's public surface, for panels. */
export type AssistEngine = ReturnType<typeof useAssist>;
