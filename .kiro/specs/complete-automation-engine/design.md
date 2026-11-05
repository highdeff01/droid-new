# Complete Automation Engine Design

## Overview

The Complete Automation Engine is a production-grade automation platform composed of three tightly integrated systems:

1. **Workflow Recording System**: Captures user actions (clicks, keyboard, drags, scrolls) and converts them to normalized, replayable workflows
2. **Packs System**: Organizes workflows into versioned, deployable collections with metadata and marketplace support
3. **Learning & Habits System**: Extracts patterns from successful executions, suggests contextually relevant automations, and learns from user feedback

Integration is achieved through:
- **Event-driven messaging** where state changes in one system trigger actions in others
- **Normalized data interchange** using standard workflow/habit structures
- **Feedback loops** where execution results update learning models
- **Context propagation** enabling coordinate adaptation across displays and contexts

## Architecture

### System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE LAYER                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────┐ │
│  │  Recording   │  │    Packs     │  │    Habits    │  │Analytics│ │
│  │  Interface   │  │  Interface   │  │  Interface   │  │  & Stats│ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └────┬────┘ │
└─────────┼──────────────────┼──────────────────┼───────────────┼─────┘
          │                  │                  │               │
┌─────────┼──────────────────┼──────────────────┼───────────────┼─────┐
│         ▼                  ▼                  ▼               ▼     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │          EVENT DISPATCHER & MESSAGE BUS                    │   │
│  │  (RecordingCaptured, WorkflowCreated, PackModified, etc.)  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │   SYSTEM 1   │  │   SYSTEM 2   │  │   SYSTEM 3   │             │
│  ├──────────────┤  ├──────────────┤  ├──────────────┤             │
│  │ RECORDING    │  │ PACKS        │  │ LEARNING &   │             │
│  │              │  │              │  │ HABITS       │             │
│  │ ┌──────────┐ │  │ ┌──────────┐ │  │ ┌──────────┐ │             │
│  │ │ Capture  │ │  │ │ Pack     │ │  │ │ Habit    │ │             │
│  │ │ Engine   │ │  │ │ Manager  │ │  │ │ Engine   │ │             │
│  │ ├──────────┤ │  │ ├──────────┤ │  │ ├──────────┤ │             │
│  │ │ Recording│ │  │ │ Version  │ │  │ │ Pattern  │ │             │
│  │ │ Store    │ │  │ │ Control  │ │  │ │ Extractor│ │             │
│  │ ├──────────┤ │  │ ├──────────┤ │  │ ├──────────┤ │             │
│  │ │ Playback │ │  │ │ Deployment│ │  │ │ Confidence│ │             │
│  │ │ Engine   │ │  │ │ Executor │ │  │ │ Scorer   │ │             │
│  │ ├──────────┤ │  │ ├──────────┤ │  │ ├──────────┤ │             │
│  │ │ Coordinates│ │  │ │ Marketplace│ │  │ │ Suggester│ │             │
│  │ │ Translator│ │  │ │ & Sharing│ │  │ │ Engine   │ │             │
│  │ └──────────┘ │  │ └──────────┘ │  │ └──────────┘ │             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
│         ▲                  ▲                  ▲                    │
│  ┌──────┴──────────────────┴──────────────────┴──────┐             │
│  │     SHARED DATA LAYER (Persistence & Cache)      │             │
│  │  ┌─────────────┐  ┌─────────────┐                │             │
│  │  │  Recording  │  │  Workflow   │  ┌──────────┐  │             │
│  │  │  Repository │  │  Repository │  │  Pack    │  │             │
│  │  └─────────────┘  └─────────────┘  │Repository│  │             │
│  │  ┌──────────────────────────────┐  └──────────┘  │             │
│  │  │  Habit Repository            │  ┌──────────┐  │             │
│  │  └──────────────────────────────┘  │Execution │  │             │
│  │  ┌──────────────────────────────┐  │Repository│  │             │
│  │  │  Event Log & Audit Trail     │  └──────────┘  │             │
│  │  └──────────────────────────────┘                │             │
│  └─────────────────────────────────────────────────┘             │
│         │                  │                  │                  │
└─────────┼──────────────────┼──────────────────┼──────────────────┘
          ▼                  ▼                  ▼
    ┌──────────────────────────────────┐
    │  EXTERNAL STORAGE & SYNC         │
    │  (Local DB, Cloud, Marketplace)  │
    └──────────────────────────────────┘
```

## Components and Interfaces

### Recording System Components

- **Capture Engine**: Hooks into OS input events (mouse, keyboard, scroll), normalizes coordinates, captures element context
- **Playback Engine**: Denormalizes coordinates, resolves element selectors, simulates input events, handles timing
- **Coordinate Translator**: Converts between screen-specific and normalized coordinates, handles multi-display scenarios
- **Recording Repository**: Persists recordings with indexed metadata, supports query and retrieval

### Packs System Components

- **Pack Manager**: CRUD operations for packs, workflow reference management, version control
- **Deployment Executor**: Validates context, executes workflows in order, handles failures, collects metrics
- **Version Control**: Tracks changes, manages versions, supports rollback with snapshot storage
- **Marketplace Manager**: Publishing, discovery, rating, and download tracking for shared packs

### Learning & Habits Components

- **Pattern Extractor**: Analyzes workflow executions, identifies repeatable patterns, extracts conditions
- **Suggestion Engine**: Matches current context against habits, calculates confidence, ranks suggestions
- **Confidence Scorer**: Tracks success rate, frequency, recency, and user feedback; implements decay and adjustment algorithms
- **Habit Repository**: Persists habits with execution history, supports similarity search and variant management

### Integration Components

- **Event Dispatcher**: Central message bus for all system events, supports multiple subscribers
- **Context Propagator**: Passes execution context through system boundaries for coordinate adaptation
- **Feedback Collector**: Aggregates execution results, triggers learning updates, maintains audit trail
- **Lineage Tracker**: Records data flow from Recording through Workflow, Pack, Execution to Habit

## Correctness Properties

Property 1: Coordinate Invariance
For any recording made on a display of resolution (W1, H1), if replayed on display (W2, H2) where coordinates are properly denormalized and element-based fallback is applied, the workflow SHALL execute the intended action on the target element regardless of display difference.

**Validates: Requirements 1.6, 2.3, 9.6, 42.1, 42.2**

Property 2: Context Propagation
For any pack containing workflows A and B where A's execution produces output O, if O is mapped to B's input via DataMapping, then B SHALL receive O exactly as mapped, ensuring composition correctness.

**Validates: Requirements 19.3, 24.1, 24.2, 24.3, 24.4**

Property 3: Habit Confidence Monotonicity
For any habit H with confidence C1, if H is executed and succeeds, the new confidence C2 SHALL satisfy C2 ≥ C1. If H is dismissed, the new confidence C2 SHALL satisfy C2 ≤ C1 (monotonic behavior).

**Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5**

Property 4: Execution Reproducibility
For any execution with a given context snapshot, if the same execution is run twice with identical context, the results SHALL be identical (deterministic replay).

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 28.1, 28.2, 28.3**

## Error Handling

- **Element Not Found**: Attempt fallback matching (selector, DOM path, accessible name, fuzzy matching)
- **Playback Failure**: Record step index and error; emit ExecutionCompleteEvent with failure details
- **Habit Low Confidence**: Display confidence reasoning; allow user override
- **Context Mismatch**: Warn user of context differences; offer to continue or abort
- **Version Conflict**: Show version history; allow user to choose or merge
- **Coordinate Translation Error**: Log error; attempt adaptive scaling or user intervention
- **Storage Failure**: Implement retry with exponential backoff; queue for later sync

## Data Models

- **Element Not Found**: Attempt fallback matching (selector, DOM path, accessible name, fuzzy matching)
- **Playback Failure**: Record step index and error; emit ExecutionCompleteEvent with failure details
- **Habit Low Confidence**: Display confidence reasoning; allow user override
- **Context Mismatch**: Warn user of context differences; offer to continue or abort
- **Version Conflict**: Show version history; allow user to choose or merge
- **Coordinate Translation Error**: Log error; attempt adaptive scaling or user intervention
- **Storage Failure**: Implement retry with exponential backoff; queue for later sync

## Testing Strategy

### Unit Testing
- Coordinate normalization/denormalization with property-based tests
- Confidence calculation with various execution histories
- Pattern extraction from diverse workflow types
- Element matching with fallback scenarios

### Integration Testing
- Record → Workflow → Pack → Deploy → Habit complete flow
- Event emission and subscription verification
- Context propagation through execution chain
- Cross-system data consistency

### Performance Testing
- Capture latency <10ms, playback 100 steps/second
- Suggestion generation <50ms with 10K+ habits
- Pack search <100ms, storage efficiency verification

### E2E Testing
- Multi-display coordinate adaptation
- Habit suggestions in various application contexts
- Undo/rollback correctness
- Marketplace publishing and import workflow

### Recording

```typescript
interface Recording {
  id: string;
  metadata: RecordingMetadata;
  actions: Action[];
  context: RecordingContext;
}

interface RecordingMetadata {
  createdAt: timestamp;
  author: string;
  description: string;
  tags: string[];
  duration: number;  // milliseconds
}

interface Action {
  type: 'click' | 'keyboard' | 'drag' | 'scroll' | 'pause';
  timestamp: number;
  data: ActionData;
  metadata: ActionMetadata;
}

interface ActionData {
  // Click: { x: number (0..1), y: number (0..1), button: string }
  // Keyboard: { key: string, modifiers: string[] }
  // Drag: { startX: number, startY: number, endX: number, endY: number, duration: number }
  // Scroll: { direction: 'up'|'down'|'left'|'right', amount: number, x: number, y: number }
  // Pause: { duration: number }
}

interface ActionMetadata {
  elementSelector?: string;
  domPath?: string[];
  accessibleName?: string;
  elementContext?: string;  // Description of element/context at capture time
}

interface RecordingContext {
  windowTitle: string;
  applicationName: string;
  displayResolution: { width: number; height: number };
  url?: string;  // For web applications
  capturedElements?: ElementSnapshot[];
}

interface ElementSnapshot {
  selector: string;
  accessible_name: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  visible: boolean;
}
```

### Workflow

```typescript
interface Workflow {
  id: string;
  recordingId?: string;  // Reference to source recording
  steps: WorkflowStep[];
  metadata: WorkflowMetadata;
  contextRequirements: ContextRequirement[];
  executionHistory: ExecutionRecord[];
}

interface WorkflowStep {
  id: string;
  order: number;
  action: Action;
  conditional?: Condition;
  optional: boolean;
  timeout?: number;  // milliseconds before considering step failed
}

interface Condition {
  type: 'element-exists' | 'element-value' | 'screen-state' | 'custom';
  target: string;  // Selector or custom condition ID
  expectedValue?: string;
}

interface WorkflowMetadata {
  name: string;
  description: string;
  version: string;
  createdAt: timestamp;
  updatedAt: timestamp;
  author: string;
  tags: string[];
  estimatedDuration: number;  // milliseconds
}

interface ContextRequirement {
  type: 'window-title' | 'application' | 'url-pattern' | 'element-selector';
  value: string | RegExp;
  required: boolean;
}

interface ExecutionRecord {
  timestamp: timestamp;
  duration: number;
  success: boolean;
  failedStep?: number;
  errorMessage?: string;
  context: ExecutionContext;
}

interface ExecutionContext {
  displayResolution: { width: number; height: number };
  applicationState: string;  // Serialized snapshot of detected state
  capturedElements: ElementSnapshot[];
}
```

### Pack

```typescript
interface Pack {
  id: string;
  metadata: PackMetadata;
  workflowReferences: WorkflowRef[];
  executionPolicy: ExecutionPolicy;
  versioning: VersionInfo;
  executionHistory: PackExecutionRecord[];
}

interface PackMetadata {
  name: string;
  description: string;
  tags: string[];
  author: string;
  createdAt: timestamp;
  updatedAt: timestamp;
  category?: string;
  rating?: number;  // For marketplace
  downloads?: number;  // For marketplace
}

interface WorkflowRef {
  workflowId: string;
  order: number;
  parallelizable?: boolean;
  dataPassage?: DataMapping[];  // How output of previous workflow maps to input of next
}

interface DataMapping {
  sourceWorkflowId: string;
  sourceField: string;
  targetWorkflowId: string;
  targetField: string;
  transformFunction?: string;
}

interface ExecutionPolicy {
  type: 'sequential' | 'parallel' | 'conditional-branching';
  failureHandling: 'stop' | 'continue' | 'rollback';
  retryPolicy: {
    maxAttempts: number;
    backoffMultiplier: number;
  };
}

interface VersionInfo {
  major: number;
  minor: number;
  patch: number;
  history: VersionRecord[];
}

interface VersionRecord {
  version: string;
  timestamp: timestamp;
  author: string;
  changes: string;
  workflowSnapshots: { [workflowId]: Workflow };
}

interface PackExecutionRecord {
  id: string;
  timestamp: timestamp;
  duration: number;
  success: boolean;
  workflowResults: WorkflowExecutionResult[];
  context: ExecutionContext;
  habitsExtracted?: Habit[];  // Habits learned from this execution
}

interface WorkflowExecutionResult {
  workflowId: string;
  success: boolean;
  duration: number;
  failedStep?: number;
  output?: { [key: string]: any };
}
```

### Habit

```typescript
interface Habit {
  id: string;
  pattern: HabitPattern;
  confidence: ConfidenceScore;
  metadata: HabitMetadata;
  executionHistory: HabitExecutionRecord[];
  variants: HabitVariant[];
}

interface HabitPattern {
  conditions: HabitCondition[];  // When to suggest
  actions: Action[];  // What to execute (normalized from workflows)
  expectedOutcome: string;  // Description of expected result
}

interface HabitCondition {
  type: 'element-state' | 'context-match' | 'time-pattern' | 'sequence-history';
  matcher: ConditionMatcher;
  weight: number;  // 0..1, importance for matching
}

interface ConditionMatcher {
  // For element-state: { selector: string, expectedState: string }
  // For context-match: { field: string, pattern: RegExp | string }
  // For time-pattern: { dayOfWeek?: number, timeRange?: [number, number] }
  // For sequence-history: { previousActions: Action[], minOccurrences: number }
}

interface ConfidenceScore {
  overall: number;  // 0..100
  breakdown: {
    successRate: number;  // Based on execution history
    frequency: number;  // How often used
    recency: number;  // Recent usage boost
    userFeedback: number;  // Manual corrections/approvals
  };
  trend: 'improving' | 'stable' | 'declining';
}

interface HabitMetadata {
  name: string;
  description: string;
  createdAt: timestamp;
  updatedAt: timestamp;
  sourceType: 'extracted-from-workflow' | 'extracted-from-pack' | 'manual' | 'collaborative';
  sourceId?: string;  // Recording, Workflow, or Pack ID
  lifecycle: 'new' | 'learning' | 'mature' | 'deprecated';
  tags: string[];
}

interface HabitExecutionRecord {
  timestamp: timestamp;
  source: 'suggestion-accepted' | 'auto-executed' | 'manual-trigger';
  success: boolean;
  duration: number;
  userFeedback?: 'approved' | 'corrected' | 'rejected';
  corrections?: { [stepIndex: number]: CorrectionInfo };
}

interface CorrectionInfo {
  originalAction: Action;
  correctedAction: Action;
  reason?: string;
}

interface HabitVariant {
  id: string;
  pattern: HabitPattern;
  confidence: ConfidenceScore;
  context: string;  // Description of when this variant applies
  createdFrom: 'manual-refinement' | 'user-correction' | 'divergent-execution';
}
```

### Integration: Execution Context & Feedback

```typescript
interface ExecutionContext {
  recordingId?: string;
  workflowId?: string;
  packId?: string;
  habitId?: string;
  parentContext?: ExecutionContext;  // For nested execution
  displayState: DisplayState;
  applicationState: ApplicationState;
}

interface DisplayState {
  resolution: { width: number; height: number };
  dpi: number;
  multiDisplay: boolean;
  displayIndex: number;
}

interface ApplicationState {
  windowTitle: string;
  url?: string;
  visibleElements: ElementSnapshot[];
  formFields?: { [selector: string]: string };
  lastAction?: {
    type: string;
    timestamp: number;
  };
}

interface ExecutionFeedback {
  executionId: string;
  source: 'workflow' | 'pack' | 'habit';
  success: boolean;
  metrics: ExecutionMetrics;
  errors: ErrorRecord[];
  suggestions: SuggestionRecord[];
}

interface ExecutionMetrics {
  duration: number;
  stepsCompleted: number;
  stepsFailed: number;
  elementsNotFound: number;
  coordinateAdaptations: number;
}

interface ErrorRecord {
  stepIndex: number;
  type: string;
  message: string;
  context: { [key: string]: any };
  recoveryAttempts: number;
}

interface SuggestionRecord {
  timestamp: timestamp;
  habitId?: string;
  packId?: string;
  suggested: boolean;
  accepted: boolean;
  reason: string;  // Why suggested
}
```

### Event Structures

```typescript
interface BaseEvent {
  type: string;
  timestamp: timestamp;
  source: 'recording' | 'workflow' | 'pack' | 'habit';
  sourceId: string;
  context: { [key: string]: any };
}

interface RecordingCapturedEvent extends BaseEvent {
  type: 'RecordingCaptured';
  action: Action;
  recordingId: string;
  stepCount: number;
}

interface WorkflowCreatedEvent extends BaseEvent {
  type: 'WorkflowCreated';
  workflowId: string;
  recordingId?: string;
  stepCount: number;
}

interface PackModifiedEvent extends BaseEvent {
  type: 'PackModified';
  packId: string;
  modification: 'workflow-added' | 'workflow-removed' | 'metadata-updated';
  previousVersion: string;
  newVersion: string;
}

interface PackDeployedEvent extends BaseEvent {
  type: 'PackDeployed';
  packId: string;
  version: string;
  executionId: string;
  context: ExecutionContext;
}

interface ExecutionCompleteEvent extends BaseEvent {
  type: 'ExecutionComplete';
  executionId: string;
  success: boolean;
  duration: number;
  stepResults: WorkflowExecutionResult[];
  feedback: ExecutionFeedback;
  habitsToExtract?: string[];  // Workflow/Pack IDs from which to extract habits
}

interface HabitsExtractedEvent extends BaseEvent {
  type: 'HabitsExtracted';
  habits: Habit[];
  sourceExecutionId: string;
  confidence: number[];  // Per habit
}

interface HabitSuggestedEvent extends BaseEvent {
  type: 'HabitSuggested';
  habitId: string;
  confidence: number;
  matchedConditions: string[];
  suggestedAction: 'execute' | 'prompt-user' | 'display-hint';
}

interface HabitActedUponEvent extends BaseEvent {
  type: 'HabitActedUpon';
  habitId: string;
  action: 'accepted' | 'dismissed' | 'executed' | 'corrected';
  corrections?: CorrectionInfo[];
}

interface ContextPropagatedEvent extends BaseEvent {
  type: 'ContextPropagated';
  fromId: string;
  toId: string;
  fromType: 'workflow' | 'pack' | 'habit';
  toType: 'workflow' | 'pack' | 'habit';
  context: Partial<ExecutionContext>;
}
```

## System 1: Workflow Recording Architecture

### Capture Engine

```
┌─────────────────────────────────────┐
│  Input Capture Hooks                │
│  (OS-level mouse/keyboard/scroll)   │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Action Normalizer                  │
│  - Convert to 0..1 coordinates      │
│  - Extract element context          │
│  - Attach metadata                  │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Context Snapshot Collector         │
│  - Capture window/element state     │
│  - Build DOM path for elements      │
│  - Store accessible names           │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Action Buffer & Timing             │
│  - Group related actions            │
│  - Maintain consistent timestamps   │
│  - Detect pauses/gaps               │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Recording Store                    │
│  (persist to Recording Repository)  │
└─────────────────────────────────────┘
```

### Playback Engine

```
┌─────────────────────────────────────┐
│  Workflow/Recording Loader          │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Context Matcher                    │
│  - Verify current context matches   │
│  - Validate required elements exist │
│  - Warn on mismatches               │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Coordinate Translator              │
│  - Denormalize from 0..1 to actual  │
│  - Handle multi-display             │
│  - Detect element position changes  │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Action Executor                    │
│  - Simulate OS events               │
│  - Handle pauses                    │
│  - Manage timing                    │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Verification & Recovery            │
│  - Detect failures                  │
│  - Attempt fallback matching        │
│  - Report step completion           │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Execution Feedback                 │
│  (emit ExecutionCompleteEvent)      │
└─────────────────────────────────────┘
```

### Coordinate Translation

```typescript
// Normalize: screen coords → 0..1
function normalizeCoordinates(x: number, y: number, displayWidth: number, displayHeight: number): [number, number] {
  return [
    Math.max(0, Math.min(1, x / displayWidth)),
    Math.max(0, Math.min(1, y / displayHeight))
  ];
}

// Denormalize: 0..1 → screen coords with adaptation
function denormalizeCoordinates(
  normalizedX: number,
  normalizedY: number,
  currentDisplayWidth: number,
  currentDisplayHeight: number,
  sourceDisplayWidth: number,
  sourceDisplayHeight: number
): [number, number] {
  const x = normalizedX * currentDisplayWidth;
  const y = normalizedY * currentDisplayHeight;
  
  // Apply adaptive scaling if display sizes differ significantly
  if (Math.abs(sourceDisplayWidth - currentDisplayWidth) > 100) {
    const scaleFactor = currentDisplayWidth / sourceDisplayWidth;
    return [x * scaleFactor, y * scaleFactor];
  }
  
  return [x, y];
}

// Fallback: element-based matching
function findElementByFallback(
  selector: string,
  domPath: string[],
  accessibleName: string,
  context: ApplicationState
): Element | null {
  // Try in order:
  // 1. Direct selector match
  // 2. DOM path traversal
  // 3. Accessible name search
  // 4. Fuzzy selector matching
}
```

## System 2: Packs Architecture

### Pack Manager

```
┌─────────────────────────────────────┐
│  Pack CRUD Operations               │
│  - Create, Read, Update, Delete     │
│  - Validate workflows               │
│  - Update metadata                  │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Version Control                    │
│  - Track changes                    │
│  - Manage versions                  │
│  - Rollback support                 │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Deployment Executor                │
│  - Validate context                 │
│  - Execute workflows                │
│  - Handle failures                  │
│  - Collect metrics                  │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Execution History                  │
│  (update PackExecutionRecord)       │
└─────────────────────────────────────┘
```

### Pack Deployment Flow

```
Input: Pack, Context
  ↓
[Validate Context Match]
  ├─ success → Continue
  └─ failure → Warn user
  ↓
[For each workflow in execution order]
  ├─ [Create execution context]
  ├─ [Execute workflow with context]
  ├─ [Collect metrics & results]
  ├─ [Pass output to next workflow via DataMapping]
  ├─ Success: Continue
  └─ Failure: Handle per policy (stop/continue/rollback)
  ↓
[Emit ExecutionCompleteEvent]
  ├─ Include all results
  ├─ Include metrics
  └─ Include failures/errors
  ↓
[Learning system consumes event]
  ├─ Extracts habits from successful workflows
  └─ Updates confidence scores
```

## System 3: Learning & Habits Architecture

### Pattern Extraction

```
┌─────────────────────────────────────┐
│  Execution Analysis                 │
│  - Identify workflow patterns       │
│  - Detect element targets           │
│  - Extract context requirements     │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Habit Initialization               │
│  - Create habit from pattern        │
│  - Set initial confidence           │
│  - Define conditions                │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Habit Merging & Deduplication      │
│  - Detect similar habits            │
│  - Merge or create variants         │
│  - Resolve conflicts                │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Habit Repository                   │
│  (persist Habit)                    │
└─────────────────────────────────────┘
```

### Suggestion Engine

```
┌─────────────────────────────────────┐
│  Context Analyzer                   │
│  - Capture current state            │
│  - Extract conditions               │
│  - Build context vector             │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Condition Matching (for each habit)│
│  - Element state match?             │
│  - Context match?                   │
│  - Sequence history match?          │
│  - Time pattern match?              │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Confidence Calculation             │
│  - Apply weights to matched items   │
│  - Consider trend & recency         │
│  - Filter by minimum threshold      │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Ranking & Filtering                │
│  - Sort by confidence score         │
│  - Apply user preferences           │
│  - Return top N suggestions         │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Suggestion Output                  │
│  (emit HabitSuggestedEvent)         │
└─────────────────────────────────────┘
```

### Confidence Scoring Algorithm

```typescript
function calculateConfidence(habit: Habit): number {
  const breakdown = habit.confidence.breakdown;
  
  // Base: success rate (most important)
  let score = breakdown.successRate * 0.5;
  
  // Frequency boost: habits used often are more reliable
  score += Math.min(breakdown.frequency / 10, 1) * 0.2;  // Cap at 10 uses
  
  // Recency boost: recent usage is more relevant
  const daysOld = (Date.now() - habit.updatedAt) / (24 * 60 * 60 * 1000);
  const recencyDecay = Math.exp(-daysOld / 30);  // Decay over 30 days
  score += breakdown.recency * recencyDecay * 0.2;
  
  // User feedback: corrections lower confidence, approvals raise it
  score += breakdown.userFeedback * 0.1;
  
  // Trend: improving trends get bonus, declining get penalty
  if (habit.confidence.trend === 'improving') {
    score *= 1.1;
  } else if (habit.confidence.trend === 'declining') {
    score *= 0.9;
  }
  
  return Math.max(0, Math.min(100, score));
}

function updateConfidenceAfterEvent(habit: Habit, event: HabitActedUponEvent): void {
  switch (event.action) {
    case 'accepted':
      habit.confidence.breakdown.userFeedback += 5;
      break;
    case 'dismissed':
      habit.confidence.breakdown.userFeedback -= 2;
      break;
    case 'executed':
      if (event.success) {
        habit.confidence.breakdown.successRate += 0.1;
        habit.confidence.breakdown.frequency += 1;
      } else {
        habit.confidence.breakdown.successRate -= 0.2;
      }
      break;
    case 'corrected':
      habit.confidence.breakdown.userFeedback -= 5;  // Significant penalty
      break;
  }
  
  // Recalculate overall confidence
  habit.confidence.overall = calculateConfidence(habit);
}
```

## Integration: Event Flow & Feedback Loop

### Complete Workflow: Record → Pack → Deploy → Learn

```
USER RECORDS WORKFLOW
      ↓
[RecordingCapturedEvent emitted per action]
      ↓
[Recording COMPLETED]
      ↓
[WorkflowCreatedEvent emitted]
      ↓
USER CREATES PACK with workflows
      ↓
[PackModifiedEvent emitted]
      ↓
USER DEPLOYS PACK to context
      ↓
[PackDeployedEvent emitted]
      ↓
[Workflows execute sequentially]
      ↓
[Per-workflow failures/successes recorded]
      ↓
[ExecutionCompleteEvent emitted with metrics]
      ↓
[Learning System consumes ExecutionCompleteEvent]
      ├─ For each successful workflow
      │  ├─ Extract pattern into habit
      │  ├─ Calculate initial confidence
      │  └─ Store habit
      ├─ Emit HabitsExtractedEvent
      └─ Update pack execution history
      ↓
[Later: USER in context matching habit]
      ↓
[Suggestion Engine detects match]
      ├─ Calculate confidence (0..100)
      ├─ Rank against other suggestions
      └─ Emit HabitSuggestedEvent
      ↓
[USER accepts/dismisses suggestion]
      ↓
[HabitActedUponEvent emitted]
      ↓
[Confidence scoring updated]
      ├─ If accepted: increase confidence
      ├─ If dismissed: decrease confidence
      └─ Update trend calculation
      ↓
[Emit event to all subscribers]
      ├─ Habit engine updates confidence
      ├─ Analytics system logs event
      └─ Marketplace tracks popularity
```

### Data Lineage Tracking

```
Recording ID → Recording
    ↓
    └─→ Workflow ID → Workflow (recordingId = Recording ID)
         ↓
         └─→ Pack ID → Pack (contains WorkflowRef to Workflow)
              ↓
              └─→ PackExecution (packId = Pack ID)
                   ↓
                   └─→ Habit ID → Habit (sourceExecutionId = PackExecution ID)
                        ↓
                        └─→ HabitExecution (habitId = Habit ID)

[Audit trail query]
TRACE Habit.id → PackExecution → Pack → Workflow → Recording
```

## Storage & Persistence

### Repository Pattern

```typescript
interface RecordingRepository {
  save(recording: Recording): Promise<void>;
  findById(id: string): Promise<Recording | null>;
  findByAuthor(author: string): Promise<Recording[]>;
  findByDateRange(start: timestamp, end: timestamp): Promise<Recording[]>;
  findByContext(context: RecordingContext): Promise<Recording[]>;
  delete(id: string): Promise<void>;
  query(filters: QueryFilters): Promise<Recording[]>;
}

interface WorkflowRepository {
  save(workflow: Workflow): Promise<void>;
  findById(id: string): Promise<Workflow | null>;
  findByRecordingId(recordingId: string): Promise<Workflow[]>;
  findByTags(tags: string[]): Promise<Workflow[]>;
  updateExecutionHistory(workflowId: string, record: ExecutionRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

interface PackRepository {
  save(pack: Pack): Promise<void>;
  findById(id: string): Promise<Pack | null>;
  findByVersion(id: string, version: string): Promise<Pack | null>;
  findByAuthor(author: string): Promise<Pack[]>;
  findByTags(tags: string[]): Promise<Pack[]>;
  updateVersion(packId: string, versionInfo: VersionInfo): Promise<void>;
  delete(id: string): Promise<void>;
}

interface HabitRepository {
  save(habit: Habit): Promise<void>;
  findById(id: string): Promise<Habit | null>;
  findByPattern(pattern: HabitPattern): Promise<Habit[]>;
  findBySimilarity(habit: Habit, threshold: number): Promise<Habit[]>;
  updateConfidence(habitId: string, confidence: ConfidenceScore): Promise<void>;
  updateExecutionHistory(habitId: string, record: HabitExecutionRecord): Promise<void>;
  delete(id: string): Promise<void>;
  queryByContext(context: any): Promise<Habit[]>;
}

interface ExecutionRepository {
  saveWorkflowExecution(record: ExecutionRecord): Promise<void>;
  savePackExecution(record: PackExecutionRecord): Promise<void>;
  findExecutionHistory(sourceId: string): Promise<ExecutionRecord[]>;
  queryExecutionStats(filters: QueryFilters): Promise<ExecutionStats>;
}
```

## API Interfaces (System Boundaries)

### Recording System API

```typescript
interface RecordingSystem {
  startRecording(config: RecordingConfig): RecordingSession;
  stopRecording(): Promise<Recording>;
  pauseRecording(): void;
  resumeRecording(): void;
  
  getRecordingSession(): RecordingSession | null;
  exportRecording(recordingId: string, format: 'json'): string;
  importRecording(data: string): Promise<Recording>;
  
  replayWorkflow(workflow: Workflow, context: ExecutionContext): AsyncIterator<WorkflowStep>;
  editWorkflow(workflowId: string, edits: WorkflowEdit[]): Promise<Workflow>;
  
  on(event: 'captured' | 'paused' | 'resumed' | 'stopped', callback: EventHandler);
}

interface RecordingSession {
  id: string;
  recording: Recording;
  isActive: boolean;
  isPaused: boolean;
  stepCount: number;
  duration: number;
}
```

### Packs System API

```typescript
interface PacksSystem {
  createPack(metadata: PackMetadata, workflows: Workflow[]): Promise<Pack>;
  getPack(packId: string): Promise<Pack>;
  updatePackMetadata(packId: string, metadata: Partial<PackMetadata>): Promise<Pack>;
  addWorkflowToPack(packId: string, workflowId: string): Promise<Pack>;
  removeWorkflowFromPack(packId: string, workflowId: string): Promise<Pack>;
  
  searchPacks(query: SearchQuery): Promise<Pack[]>;
  getPackVersionHistory(packId: string): Promise<VersionRecord[]>;
  rollbackPack(packId: string, version: string): Promise<Pack>;
  
  deployPack(packId: string, context: ExecutionContext): Promise<PackExecutionRecord>;
  getPackExecutionHistory(packId: string): Promise<PackExecutionRecord[]>;
  
  exportPack(packId: string, version?: string): string;
  importPack(data: string): Promise<Pack>;
  publishToMarketplace(packId: string, category: string): Promise<void>;
  searchMarketplace(query: string, category?: string): Promise<Pack[]>;
  
  on(event: 'deployed' | 'failed' | 'completed', callback: EventHandler);
}
```

### Learning & Habits API

```typescript
interface LearningSystem {
  extractHabits(execution: ExecutionFeedback): Promise<Habit[]>;
  getHabits(filter?: HabitFilter): Promise<Habit[]>;
  getHabit(habitId: string): Promise<Habit>;
  updateHabit(habitId: string, updates: Partial<Habit>): Promise<Habit>;
  deleteHabit(habitId: string): Promise<void>;
  
  suggestHabits(context: ApplicationState): Promise<HabitSuggestion[]>;
  acceptSuggestion(habitId: string): Promise<void>;
  dismissSuggestion(habitId: string): Promise<void>;
  correctHabitAction(habitId: string, stepIndex: number, correction: Action): Promise<Habit>;
  
  getHabitConfidence(habitId: string): ConfidenceScore;
  getHabitExecutionHistory(habitId: string): HabitExecutionRecord[];
  
  autoExecuteHabit(habitId: string, context: ExecutionContext): Promise<boolean>;
  
  on(event: 'suggested' | 'executed' | 'corrected', callback: EventHandler);
}
```

### Integration API

```typescript
interface AutomationEngineIntegration {
  // Event subscription
  on(event: EventType, callback: EventHandler): void;
  off(event: EventType, callback: EventHandler): void;
  emit(event: BaseEvent): void;
  
  // Context propagation
  propagateContext(fromId: string, fromType: string, toId: string, toType: string): Promise<void>;
  
  // Cross-system queries
  traceLineage(entityId: string, entityType: string): Promise<LineageNode[]>;
  getRelatedEntities(entityId: string, entityType: string): Promise<RelatedEntity[]>;
  
  // Metrics & analytics
  getExecutionStats(filters: QueryFilters): Promise<ExecutionStats>;
  getSuccessRate(entityId: string, entityType: string): number;
  getTrends(timeRange: DateRange): Promise<TrendData>;
  
  // Configuration
  setConfidenceThreshold(value: number): void;
  setAutoExecuteThreshold(value: number): void;
  setLearningMode(mode: 'aggressive' | 'conservative' | 'off'): void;
}
```

## Performance Considerations

### Caching Strategy

```typescript
class CacheLayer {
  private recordingCache = new LRUCache<string, Recording>(500);
  private workflowCache = new LRUCache<string, Workflow>(1000);
  private habitCache = new LRUCache<string, Habit>(2000);
  private suggestionCache = new LRUCache<string, HabitSuggestion[]>(100);
  
  // Invalidation triggers
  onPackDeployed() {
    this.suggestionCache.clear();  // Suggestions may change
  }
  
  onHabitUpdated(habitId: string) {
    this.habitCache.delete(habitId);
    this.suggestionCache.clear();  // Reevaluate suggestions
  }
  
  onWorkflowExecuted(workflowId: string) {
    this.workflowCache.delete(workflowId);
  }
}
```

### Query Indexing

```typescript
// Recording: indexed by author, date, context
// Workflow: indexed by tags, createdAt, recordingId
// Pack: indexed by author, tags, version, marketplace popularity
// Habit: indexed by pattern similarity, context, confidence
// Execution: indexed by source ID, timestamp, success status
```

## Deployment & Testing Strategy

### Test Coverage

- **Unit Tests**: Individual system components (capture, playback, pack manager, suggestion engine)
- **Integration Tests**: Cross-system data flow (record→workflow→pack→deploy→habit)
- **Property-Based Tests**: Coordinate normalization/denormalization, habit merging logic
- **E2E Tests**: Complete workflows from recording through habit suggestion
- **Performance Tests**: Scalability with 10K+ habits, large workflow libraries

---

**Total: Production-grade design with complete system integration and feedback loops**
