# Implementation Plan: Complete Automation Engine

## Qwen Thinking

This file contains a structured implementation plan for building a complete automation engine with recording, workflow management, pack deployment, learning/habits, and integration capabilities. Key observations:

**Architecture Pattern**: Event-driven architecture with 10+ event types for loose coupling between systems. Every system interaction goes through events for testability and auditability.

**Progression Logic**: The 58 tasks are organized into 10 phases that build on each other:
- Data models first (Phase 1) - foundation for all other systems
- Individual system implementations (Phases 2-5) - can be developed in parallel
- Integration layer (Phase 6) - connects systems via events
- Persistence layer (Phase 7) - enables data storage
- UI implementation (Phase 8) - visual feedback for users
- Performance optimization (Phase 9) - final polish
- Testing (Phase 10) - verification

**Important Notes**:
- Phase 3-4 are combined in dependency graph (Packs system spans both)
- "Phase 11" in dependency graph should be "Phase 11: Advanced Features"
- Dependency waves don't perfectly align with numbered phases
- Phases 2-5 can be developed in parallel after Phase 1
- Fastest path to feature completeness: 11 days core + 5-10 days for UI/performance/testing

**Current Status**: All 58 tasks marked as complete [x]

## Overview

This implementation plan organizes the 58 production-grade tasks into 10 phases, progressing from foundational data models through core system implementations to advanced features. The plan emphasizes integration and feedback loops over isolated system development.

**Key Principles**:
- Build data models first (Phase 1)
- Implement each system independently (Phases 2-5)
- Integrate systems with event messaging (Phase 6)
- Add persistence layer (Phase 7)
- Build user interfaces (Phase 8)
- Optimize performance (Phase 9)
- Comprehensive testing (Phase 10)

## Tasks

### Phase 1: Core Data Types and Models (Tasks 1-5)

- [x] 1.1 Implement Recording data model and types
  - Define Recording, RecordingMetadata, Action, ActionData, ActionMetadata, RecordingContext
  - Add validation for coordinate ranges (0..1)
  - Support action types: click, keyboard, drag, scroll, pause
  - Include element snapshot and DOM path storage
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

- [x] 1.2 Implement Workflow data model and types
  - Define Workflow, WorkflowStep, Condition, WorkflowMetadata, ContextRequirement
  - Support conditional branches and optional steps
  - Include execution history tracking
  - Add timeout configuration per step
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

- [x] 1.3 Implement Pack data model and types
  - Define Pack, PackMetadata, WorkflowRef, ExecutionPolicy, VersionInfo, PackExecutionRecord
  - Support sequential/parallel/conditional execution policies
  - Include version history with snapshots
  - Add marketplace metadata (rating, downloads, category)
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4_

- [x] 1.4 Implement Habit data model and types
  - Define Habit, HabitPattern, HabitCondition, ConfidenceScore, HabitMetadata, HabitExecutionRecord
  - Support condition types: element-state, context-match, time-pattern, sequence-history
  - Include confidence breakdown (success rate, frequency, recency, user feedback)
  - Support habit variants and lifecycle states
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

- [x] 1.5 Implement Integration data models
  - Define ExecutionContext, ExecutionFeedback, Event structures (BaseEvent, RecordingCapturedEvent, etc.)
  - Support all 10 event types with proper inheritance
  - Include error tracking and audit trail
  - Add lineage and cross-reference support
  - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5, 22.6, 22.7, 22.8, 22.9_

## Phase 2: Workflow Recording Engine (Tasks 6-12)

- [x] 2.1 Implement Recording capture engine
  - Create action capture hooks for mouse, keyboard, drag, scroll
  - Implement coordinate normalization (screen → 0..1)
  - Add element context detection (selector, accessible name, DOM path)
  - Capture metadata: timestamp, display resolution, application context
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

- [x] 2.2 Implement Recording action buffer and timing
  - Group related actions (e.g., multiple clicks)
  - Maintain consistent timing between actions
  - Detect and handle pauses (gaps > threshold)
  - Create pause steps automatically
  - _Requirements: 1.1, 1.2_

- [x] 2.3 Implement screen context snapshot collection
  - Capture window title and active application
  - Build DOM snapshot with element selectors and positions
  - Store visible element list with coordinates
  - Create lookup table for element matching
  - _Requirements: 1.7, 1.8_

- [x] 2.4 Implement Workflow conversion from Recording
  - Convert recorded actions to Workflow steps
  - Preserve all metadata and context
  - Validate workflow completeness
  - Generate human-readable step descriptions
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 2.5 Implement Playback engine (step execution)
  - Create action executor that simulates captured actions
  - Implement coordinate denormalization (0..1 → screen)
  - Handle multi-display coordinate translation
  - Support all action types: click, keyboard, drag, scroll, pause
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

- [x] 2.6 Implement Playback context verification
  - Verify current context matches workflow requirements
  - Check that required elements exist before playback
  - Warn on context mismatches
  - Support optional context requirements
  - _Requirements: 2.1, 2.2_

- [x] 2.7 Implement Playback error handling and fallback
  - Detect when elements cannot be found at expected coordinates
  - Attempt selector-based element matching as fallback
  - Try DOM path traversal if selector fails
  - Support fuzzy element matching (accessible name search)
  - _Requirements: 2.8_

- [x] 2.8 Implement Recording persistence (save/load)
  - Persist Recording to local storage with indexed metadata
  - Support retrieval by ID, author, date range, context
  - Implement versioning (creation → modifications)
  - Support deletion with secure removal
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

## Phase 3: Packs System - CRUD and Versioning (Tasks 13-18)

- [x] 3.1 Implement Pack CRUD operations
  - Create: name, description, initial version 1.0.0, author tracking
  - Read: retrieve by ID with all metadata and workflow references
  - Update: modify metadata and workflow list
  - Delete: remove pack and maintain history
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 3.2 Implement Pack workflow management
  - Add workflows to pack with validation
  - Remove workflows from pack
  - Reorder workflows within pack
  - Support workflow reference resolution
  - _Requirements: 6.5, 6.6, 6.7_

- [x] 3.3 Implement Pack versioning system
  - Auto-increment patch version on changes
  - Support minor/major version bumps with user control
  - Store complete version history with snapshots
  - Implement version rollback capability
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

- [x] 3.4 Implement Pack search and discovery
  - Search by name with fuzzy matching
  - Filter by tags (AND/OR combinations)
  - Sort by frequency (usage count)
  - Filter by author
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

- [x] 3.5 Implement Pack export/import
  - Export to shareable JSON format
  - Bundle pack with all referenced workflows
  - Include version history and metadata
  - Import with format validation and compatibility checking
  - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x] 3.6 Implement Pack execution policy
  - Support sequential execution (A→B→C)
  - Support parallel execution (A|B|C)
  - Support conditional branching
  - Implement data passing between workflows (DataMapping)
  - _Requirements: 9.3, 19.3_

## Phase 4: Packs System - Deployment and Sharing (Tasks 19-23)

- [x] 4.1 Implement Pack deployment executor
  - Validate context compatibility before deployment
  - Execute workflows in configured order
  - Pass execution context through workflow chain
  - Handle failures per policy (stop/continue/rollback)
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 4.2 Implement Coordinate translation for deployment
  - Adapt workflow coordinates to different display resolutions
  - Handle multi-display scenarios
  - Support cross-platform coordinate adaptation
  - Apply adaptive scaling when displays differ significantly
  - _Requirements: 9.6, 9.7, 9.8, 42.1, 42.2_

- [x] 4.3 Implement Pack execution metrics collection
  - Record start time, end time, total duration
  - Track steps completed and failures
  - Count element not-found errors
  - Record coordinate adaptation counts
  - _Requirements: 9.5, 25.5_

- [x] 4.4 Implement Pack marketplace publishing
  - Validate metadata completeness for publishing
  - Publish pack to marketplace
  - Make pack discoverable by category and tags
  - Include rating and download tracking
  - _Requirements: 10.5, 10.6, 10.7, 10.8_

- [x] 4.5 Implement Pack update notifications
  - Detect when pack has newer version available
  - Notify user with version details and changelog
  - Support in-place updating with migration guidance
  - Implement rollback on failed update
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

## Phase 5: Learning & Habits Engine (Tasks 24-30)

- [x] 5.1 Implement Habit extraction from workflows
  - Identify repeatable elements and patterns in workflows
  - Normalize action sequences to find common subsequences
  - Extract context requirements and conditions
  - Assign initial confidence based on workflow success
  - _Requirements: 13.1, 13.2, 13.3, 13.4_

- [x] 5.2 Implement Habit condition matching
  - Implement element-state matcher (selector-based)
  - Implement context-match matcher (pattern matching)
  - Implement time-pattern matcher (day/time conditions)
  - Implement sequence-history matcher (action history)
  - _Requirements: 14.1, 14.2, 14.3_

- [x] 5.3 Implement Habit confidence scoring
  - Initialize confidence from success rate
  - Track execution history (success/failure/dismissal)
  - Calculate confidence breakdown (success rate, frequency, recency, feedback)
  - Apply recency decay (30-day half-life)
  - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8_

- [x] 5.4 Implement Habit suggestion engine
  - Match current context against all habits' conditions
  - Calculate confidence for each matched habit
  - Rank suggestions by confidence score
  - Return top N suggestions (default 5)
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_

- [x] 5.5 Implement Habit user feedback handling
  - Record when suggestion is accepted/dismissed
  - Track habit execution with success/failure
  - Record user corrections to habit actions
  - Update confidence based on feedback
  - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7_

- [x] 5.6 Implement Habit merging and deduplication
  - Detect similar habits using pattern similarity
  - Merge similar habits with confidence averaging
  - Create habit variants for context-specific variations
  - Preserve execution history across merges
  - _Requirements: 13.5_

- [x] 5.7 Implement Habit discovery and search
  - Search habits by target element
  - Filter by success rate, frequency, recency
  - Group related habits by context
  - Archive deleted habits for recovery
  - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

## Phase 6: Integration & Event Messaging (Tasks 31-35)

- [x] 6.1 Implement Event dispatcher and message bus
  - Create central event dispatcher with multiple subscriber support
  - Implement event emission for all 10+ event types
  - Support event filtering and selective subscription
  - Maintain event audit trail for debugging
  - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5, 22.6, 22.7, 22.8, 22.9, 22.10_

- [x] 6.2 Implement Recording→Workflow integration
  - Emit WorkflowCreatedEvent when recording completes
  - Preserve all metadata in workflow conversion
  - Link workflow back to source recording
  - Make workflow immediately available for packing
  - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5_

- [x] 6.3 Implement Workflow→Pack integration
  - Validate workflow compatibility when adding to pack
  - Emit PackModifiedEvent when workflows added/removed
  - Update pack version and metadata
  - Support workflow reference integrity checks
  - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_

- [x] 6.4 Implement Pack execution feedback loop
  - Consume ExecutionCompleteEvent from pack deployments
  - Record execution metrics and results
  - Identify workflows to extract habits from
  - Emit ExecutionCompleteEvent with habit extraction list
  - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5_

- [x] 6.5 Implement Habit→Pack suggestion integration
  - Suggest relevant packs when habits match context
  - Show which habits drove pack suggestion
  - Allow one-click deployment of suggested packs
  - Track suggestion source in execution log
  - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5_

## Phase 7: Repository Layer & Persistence (Tasks 36-39)

- [x] 7.1 Implement Recording repository
  - Save/load Recording objects with full metadata
  - Index by author, date, context for fast queries
  - Support filtering by date range and context
  - Implement deletion with secure removal
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 25.1_

- [x] 7.2 Implement Workflow repository
  - Save/load Workflow objects with execution history
  - Maintain foreign key to Recording (when applicable)
  - Index by tags and creation date
  - Update execution history efficiently
  - _Requirements: 2.1, 2.2, 25.2_

- [x] 7.3 Implement Pack and Habit repositories
  - Save/load Pack objects with version history
  - Implement versioning with snapshots
  - Save/load Habit objects with execution history
  - Support confidence score updates
  - _Requirements: 7.1, 7.2, 12.1, 12.6, 12.7, 25.3, 25.4_

- [x] 7.4 Implement Execution repository and archiving
  - Save workflow and pack execution records
  - Query execution history with filtering
  - Generate execution statistics and reports
  - Support archiving and cleanup of old records
  - _Requirements: 25.1, 25.5, 25.6_

## Phase 8: UI Hooks and Event Integration (Tasks 40-44)

- [x] 8.1 Implement Recording UI controls
  - Recording toolbar: start/stop/pause/resume buttons
  - Visual indicator during active recording
  - Step preview after recording completes
  - Drag-and-drop interface for step reordering
  - _Requirements: 31.1, 31.2, 31.3, 31.4, 31.5, 31.6_

- [x] 8.2 Implement Packs UI interface
  - Display pack list with metadata (name, version, author, stats)
  - Implement real-time search filtering
  - Show pack details (workflows, version history, execution stats)
  - Deploy button with progress indicator
  - _Requirements: 32.1, 32.2, 32.3, 32.4, 32.5_

- [x] 8.3 Implement Habits UI interface
  - Display suggested habits based on current context
  - Show confidence score as visual percentage indicator
  - Display context requirements on hover
  - Accept/dismiss buttons for suggestions
  - Browse habit history with execution stats
  - _Requirements: 33.1, 33.2, 33.3, 33.4, 33.5, 33.6_

- [x] 8.4 Implement Integration UI elements
  - Show inline habit suggestions when matching context
  - Offer pack creation after successful workflow recording
  - Display extracted habits with confidence in pack results
  - Show analytics dashboard with pack/habit success rates
  - _Requirements: 34.1, 34.2, 34.3, 34.4_

## Phase 9: Performance Optimization (Tasks 45-47)

- [x] 9.1 Implement caching layer
  - LRU cache for Recording, Workflow, Pack, Habit objects
  - Cache invalidation triggers (pack deployed, habit updated, etc.)
  - Suggestion result caching with TTL
  - Query result caching for search operations
  - _Requirements: 35.3, 36.1, 36.2, 36.3, 36.4_

- [x] 9.2 Implement query indexing and optimization
  - Create indexes on author, date, tags, context for fast queries
  - Optimize habitat similarity search with spatial indexing
  - Implement pagination for large result sets
  - Add query result limiting and timeouts
  - _Requirements: 37.1, 37.2, 37.3, 37.4_

- [x] 9.3 Implement playback performance optimization
  - Batch coordinate translations for multi-step workflows
  - Optimize element selector matching
  - Pre-warm element lookup tables
  - Support playback speed adjustment (1x, 2x, 4x)
  - _Requirements: 35.1, 35.2, 35.3, 35.4_

## Phase 10: Testing & Verification (Tasks 48-50)

- [x] 10.1 Implement coordinate normalization/denormalization tests
  - Property-based tests for normalization round-trips
  - Multi-display coordinate adaptation tests
  - Verify clamping to [0, 1] range
  - Test coordinate translation with various DPI values
  - _Requirements: 1.6, 2.3, 9.6, 9.7, 9.8_

- [x] 10.2 Implement integration tests for complete workflows
  - Record → Workflow → Pack → Deploy → Habit flow
  - Verify event emission at each step
  - Test data lineage tracking
  - Validate context propagation through execution chain
  - _Requirements: 18.1, 19.1, 20.1, 21.1, 23.1, 23.2, 23.3, 23.4, 23.5, 23.6_

- [x] 10.3 Implement habit learning and confidence tests
  - Test confidence scoring algorithm with various inputs
  - Verify trend calculation (improving/stable/declining)
  - Test habit merging with duplicate detection
  - Validate suggestion ranking by confidence
  - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 56.1, 56.2, 56.3, 56.4_

## Additional Features (Tasks 51-58)

- [x] 12.1 Implement Recording export/import with format support
  - Export Recording to JSON with all metadata
  - Support selective metadata redaction for sharing
  - Import Recording from shared JSON format
  - Validate format integrity before import
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [x] 12.2 Implement Workflow editing capabilities
  - Delete steps from workflow
  - Insert pause steps
  - Adjust coordinates for steps
  - Reorder steps and adjust timings
  - Add conditional breakpoints
  - Mark steps as optional
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [x] 12.3 Implement conditional workflows and branching
  - Support WHEN conditions (element-exists, element-value, screen-state)
  - Execute different branches based on conditions
  - Support nested conditional branching
  - Extract conditional habits for each branch variant
  - _Requirements: 45.1, 45.2, 45.3, 45.4_

- [x] 12.4 Implement workflow composition and decomposition
  - Support parallel and sequential execution policies
  - Implement data passing between composed workflows
  - Extract composed habits from successful workflows
  - Support decomposition of workflows into components
  - _Requirements: 46.1, 46.2, 46.3, 46.4_

- [x] 12.5 Implement dry-run and test mode
  - Support dry-run execution without side effects
  - Show predicted results for each step
  - Provide confidence scoring for dry-run success
  - Require confirmation before live execution of risky workflows
  - _Requirements: 51.1, 51.2, 51.3, 51.4_

- [x] 12.6 Implement undo/rollback for executions
  - Support undoing completed pack execution steps
  - Reverse state changes in reverse order
  - Allow retry from failure point or from start
  - Support immediate rollback on deployment errors
  - _Requirements: 49.1, 49.2, 49.3, 50.1, 50.2, 50.3, 50.4_

- [x] 12.7 Implement habit analytics and diagnostics
  - Generate human-readable habit descriptions
  - Provide confidence explanation with breakdown
  - Show habit execution trends over time
  - Suggest improvements for low-confidence habits
  - _Requirements: 43.1, 43.2, 43.3, 43.4_

- [x] 12.8 Implement batch operations and scheduling
  - Support queuing multiple packs for sequential deployment
  - Display queue position and estimated completion
  - Handle batch failure scenarios
  - Aggregate results from batch executions
  - Support periodic workflow scheduling with backoff
  - _Requirements: 54.1, 54.2, 54.3, 54.4, 61.1, 61.2, 61.3, 61.4_

---

**Total: 58 tasks organized across 11 waves (Phases 1-10 + Additional Features)**

## Task Dependency Graph

```json
{
  "waves": [
    {
      "wave": 1,
      "name": "Phase 1: Data Models",
      "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5"],
      "duration_days": 1
    },
    {
      "wave": 2,
      "name": "Phase 2: Recording",
      "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8"],
      "duration_days": 3,
      "depends_on": [1]
    },
    {
      "wave": 3,
      "name": "Phase 3-4: Packs",
      "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "4.1", "4.2", "4.3", "4.4", "4.5"],
      "duration_days": 3,
      "depends_on": [2]
    },
    {
      "wave": 4,
      "name": "Phase 5: Learning & Habits",
      "tasks": ["5.1", "5.2", "5.3", "5.4", "5.5", "5.6", "5.7"],
      "duration_days": 2,
      "depends_on": [3]
    },
    {
      "wave": 5,
      "name": "Phase 6: Integration & Events",
      "tasks": ["6.1", "6.2", "6.3", "6.4", "6.5"],
      "duration_days": 1,
      "depends_on": [4]
    },
    {
      "wave": 6,
      "name": "Phase 7: Persistence",
      "tasks": ["7.1", "7.2", "7.3", "7.4"],
      "duration_days": 1,
      "depends_on": [5]
    },
    {
      "wave": 7,
      "name": "Phase 8: UI Implementation",
      "tasks": ["8.1", "8.2", "8.3", "8.4"],
      "duration_days": 2,
      "depends_on": [6]
    },
    {
      "wave": 8,
      "name": "Phase 9: Performance Optimization",
      "tasks": ["9.1", "9.2", "9.3"],
      "duration_days": 1,
      "depends_on": [6]
    },
    {
      "wave": 9,
      "name": "Phase 10: Testing & Verification",
      "tasks": ["10.1", "10.2", "10.3"],
      "duration_days": 2,
      "depends_on": [4, 5]
    },
    {
      "wave": 10,
      "name": "Additional Features (Tasks 51-58)",
      "tasks": ["11.1", "11.2", "11.3", "11.4", "11.5", "11.6", "11.7", "11.8"],
      "duration_days": 3,
      "depends_on": [9]
    }
  ]
}
```

### Dependency Summary

Fastest route to feature completeness:
1. Phase 1 (Data Models) - 1 day
2. Phase 2 (Recording) - 3 days
3. Phase 3-4 (Packs) - 3 days
4. Phase 5 (Learning) - 2 days
5. Phase 6 (Integration) - 1 day
6. Phase 7 (Persistence) - 1 day

**Total: 11 days for core product. Additional 5-10 days for UI, performance, testing, advanced features.**

## Notes

### When to Parallelize
- Phases 2-5 can be developed in parallel after Phase 1
- UI implementation (Phase 8) can begin after Phase 7 is complete
- Performance optimization (Phase 9) can start once Phase 5 is stable

### Breaking Changes
- None anticipated; architecture designed for extensibility
- Habit confidence algorithm may need tuning based on real-world usage

### Tech Debt
- Storage layer initially in-memory; upgrade to database for production
- Suggestion engine uses simple rule-based matching; can add ML/neural networks later
- Coordinate translation uses linear scaling; add advanced perspective correction if needed

### Integration Notes
Event-driven architecture is critical to success. Every system-to-system interaction must go through:
1. Emit event (with full context)
2. Event handler in consuming system
3. Update state and emit new event
This ensures testability and auditability across phase boundaries.

### Migration Path
If starting with existing automation tools:
1. Implement import adapters to convert existing workflows to our format
2. Run habits extraction on historical execution logs
3. Migrate user preferences and customizations
4. Validate output against original tool before deprecating

### Recording Phase
- Tasks 2.1-2.8 implement the complete recording and playback capability
- Key deliverable: ability to record actions and replay them on similar contexts

### Packs Phase  
- Tasks 3.1-4.5 implement pack creation, versioning, and deployment
- Key deliverable: versioned collections of workflows that deploy across contexts

### Learning Phase
- Tasks 5.1-5.7 implement habit extraction, confidence scoring, and suggestions
- Key deliverable: context-aware suggestions based on usage patterns

### Integration Phase
- Tasks 6.1-6.5 tie systems together with event messaging
- Key deliverable: seamless data flow from recording through habit suggestions

### Foundation Tasks (1-4 sets the table for everything)
- Complete data models first (Task 1)
- Build capture/playback independently (Task 2)
- Add packs with versioning (Tasks 3-4)
- Add learning layer on top (Task 5)
- Integrate everything (Task 6)

### Testing Strategy
- Unit test each system independently
- Integration test cross-system flows
- Property-based tests for coordinate handling and confidence calculation
- E2E tests for complete record→pack→deploy→habit workflows

### Performance Targets
- Recording capture: <10ms latency
- Playback: 100 steps/second
- Suggestion generation: <50ms
- Pack search: <100ms
- Storage efficiency: <32 bits per coordinate
