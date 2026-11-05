# Requirements Document

## Input Dispatch System

## Introduction

The Input Dispatch System provides real OS-level keyboard and mouse input dispatch for the Droid Assist automation platform. Currently, the system has placeholder/mock implementations that do not execute actual input on the operating system. This specification defines the complete functionality needed to translate normalized workflow steps (with coordinates in 0..1 range) into actual system input events on Windows, macOS, and Linux. The system must integrate with existing safety gates, coordinate the dispatch pipeline, track execution results, and support the learning system's feedback mechanisms.

### Overview of Scope

This system is responsible for:
- Converting normalized (0..1) coordinates to actual screen pixels
- Dispatching real mouse and keyboard input to the operating system
- Enforcing safety gates and blacklist rules before execution
- Recording execution results for the learning system
- Supporting cross-platform input on Windows, macOS, and Linux
- Integrating with the existing dispatch-gate, mirror-input, and action-history systems

### Purpose

The Input Dispatch System bridges the gap between abstract workflow steps and concrete OS-level input events. Without this system, the automation engine can only plan and preview actions without actually controlling the user's computer. This enables Droid Assist to move from being a planning tool to an actual automation executor.

## Requirements

### 1. Input Action Execution

#### 1.1 Mouse Movement and Click Actions

1.1.1 WHEN a click workflow step is dispatched THEN the system SHALL move the mouse to the calculated screen pixel position and simulate a mouse button press/release
1.1.2 WHEN a double_click workflow step is dispatched THEN the system SHALL move the mouse to the calculated screen pixel position and simulate two rapid mouse button press/release sequences
1.1.3 WHEN a drag workflow step is dispatched THEN the system SHALL move the mouse to the start position, press the mouse button, move to the end position, then release the mouse button
1.1.4 WHEN a scroll workflow step is dispatched with positive deltaY THEN the system SHALL scroll down at the specified screen position
1.1.5 WHEN a scroll workflow step is dispatched with negative deltaY THEN the system SHALL scroll up at the specified screen position
1.1.6 WHEN a pointer action completes THEN the system SHALL record the actual screen position where the action occurred

#### 1.2 Keyboard Input

1.2.1 WHEN a key workflow step is dispatched THEN the system SHALL send the specified key combination to the active window
1.2.2 WHEN a key combo contains multiple keys (e.g., 'ctrl+c', 'alt+tab', 'cmd+v') THEN the system SHALL hold modifier keys and press the final key in sequence
1.2.3 WHEN a key step specifies a repeat count THEN the system SHALL send the key press the specified number of times
1.2.4 WHEN a type workflow step is dispatched THEN the system SHALL insert the text character-by-character into the focused input field

#### 1.3 Timing and Sequencing

1.3.1 WHEN a workflow step has a delayMs value THEN the system SHALL pause before executing the step
1.3.2 WHEN consecutive steps are dispatched THEN the system SHALL respect configured delays between actions (default minimum 50ms)
1.3.3 WHEN actions are performed rapidly in sequence THEN the system SHALL ensure OS has time to process each action before the next

### 2. Coordinate System Translation

#### 2.1 Normalized to Pixel Conversion

2.1.1 WHEN a workflow step has coordinates in normalized form (0..1 range) THEN the system SHALL translate them to actual screen pixel coordinates based on the current display resolution
2.1.2 WHEN translating normalized coordinates THEN the system SHALL use the bounds of the target display or primary display if not specified
2.1.3 WHEN a normalized coordinate is outside 0..1 range THEN the system SHALL clamp it to 0..1 before translation
2.1.4 WHEN the screen resolution changes between workflow recording and execution THEN the system SHALL use current display resolution for coordinate translation

#### 2.2 Multi-Monitor Support

2.2.1 WHEN the workflow specifies a target display THEN the system SHALL identify the display by index or identifier
2.2.2 WHEN translating coordinates for a specific display THEN the system SHALL use that display's bounds and offset
2.2.3 WHEN a display is not available THEN the system SHALL use the primary display as fallback

### 3. Cross-Platform Support

#### 3.1 Platform Abstraction

3.1.1 WHEN the system runs on Windows THEN it SHALL use Windows Input Simulator or equivalent API for input dispatch
3.1.2 WHEN the system runs on macOS THEN it SHALL use CGEvent or Quartz Event Taps for input dispatch
3.1.3 WHEN the system runs on Linux THEN it SHALL use X11 (xdotool/xtest) or Wayland (equivalent) for input dispatch
3.1.4 WHEN a platform-specific feature is unavailable THEN the system SHALL either provide fallback behavior or raise a clear error

#### 3.2 Input Method Compatibility

3.2.1 WHEN typing text THEN the system SHALL handle special characters and Unicode correctly on all supported platforms
3.2.2 WHEN sending key combinations THEN the system SHALL map key names consistently across platforms (e.g., 'cmd' on macOS, 'win' on Windows, 'alt' elsewhere)

### 4. Safety Gates and Validation

#### 4.1 Pre-Dispatch Validation

4.1.1 WHEN a workflow step is ready to dispatch THEN the system SHALL check dispatch-gate.ts for any blocking rules before executing
4.1.2 WHEN dispatch-gate.ts returns a GateBlock with kind='avoid' THEN the system SHALL NOT execute the step and return a refused result
4.1.3 WHEN dispatch-gate.ts indicates stale coordinates (kind='stale') THEN the system SHALL NOT execute the step and log the reason
4.1.4 WHEN a pointer action has not been re-grounded THEN the system SHALL optionally verify the target via element-map before dispatch

#### 4.2 Blacklist Enforcement

4.2.1 WHEN an AvoidRule from blacklist.ts matches a workflow step THEN the system SHALL prevent dispatch of that step
4.2.2 WHEN a blacklist rule blocks a step THEN the system SHALL provide the rule's reason and scope to the planner
4.2.3 WHEN a step targets a blacklisted application or window THEN the system SHALL refuse dispatch with reason

#### 4.3 User-Configurable Restrictions

4.3.1 WHEN user settings disable real input dispatch THEN the system SHALL run in dry-run mode and simulate execution
4.3.2 WHEN a workflow step would affect system-critical areas (e.g., task manager, settings, shutdown) THEN the system MAY require explicit approval
4.3.3 WHEN execution mode is 'preview' or 'watch' THEN the system SHALL NOT dispatch real input

### 5. Execution Results and Feedback

#### 5.1 Action Execution Results

5.1.1 WHEN a workflow step executes successfully THEN the system SHALL return a Performed result with ok=true and executed=true
5.1.2 WHEN a workflow step fails to execute THEN the system SHALL return a Performed result with ok=false and an error message
5.1.3 WHEN a step is refused by dispatch-gate THEN the system SHALL return a Performed result with ok=false, executed=false, and halt=true

#### 5.2 Result Metadata

5.2.1 WHEN an action completes THEN the system SHALL capture the actual pixel position where the action occurred (for drift correction)
5.2.2 WHEN an action completes THEN the system SHALL optionally capture a screenshot after execution for verification
5.2.3 WHEN a pointer action includes a before/after frame THEN the system SHALL attach both frames to the action result

#### 5.3 Learning System Integration

5.3.1 WHEN an action is recorded in action-history.ts THEN the system SHALL include the Performed result metadata
5.3.2 WHEN a step execution result indicates success THEN the system SHALL mark it for positive reinforcement in the learning system
5.3.3 WHEN a step execution fails THEN the system SHALL record the failure reason and contributing factors (coordinates, target, timing)
5.3.4 WHEN execution completes THEN the system SHALL update operation-db.ts with the results for future pattern learning

### 6. Rate Limiting and Backpressure

#### 6.1 Dispatch Throttling

6.1.1 WHEN multiple steps are queued for dispatch THEN the system SHALL apply configured rate limits to prevent system overload
6.1.2 WHEN dispatch rate exceeds configured maximum THEN the system SHALL queue pending steps and dispatch them when capacity is available
6.1.3 WHEN a step takes longer than expected to complete THEN the system SHALL not dispatch the next step until the current one finishes

#### 6.2 Error Recovery

6.2.1 WHEN input dispatch fails due to temporary OS state issues THEN the system MAY retry with exponential backoff
6.2.2 WHEN retry attempts are exhausted THEN the system SHALL report failure and pass control to the planner

### 7. Integration Points

#### 7.1 dispatch-gate.ts Integration

7.1.1 WHEN dispatch-gate.gateStep() returns null THEN the system SHALL proceed with dispatch
7.1.2 WHEN dispatch-gate.gateStep() returns a GateBlock THEN the system SHALL refuse dispatch with the block reason
7.1.3 WHEN a step is refused THEN the system SHALL notify the breaker mechanism in dispatch-gate.ts

#### 7.2 action-history.ts Integration

7.2.1 WHEN a step is dispatched THEN the system SHALL record it to action-history with execution metadata
7.2.2 WHEN action results are available THEN the system SHALL add them to the action record before persisting

#### 7.3 mirror-input.ts Integration

7.3.1 WHEN a MirrorEvent is converted to a WorkflowStep THEN the system SHALL dispatch it through the same real-input pipeline
7.3.2 WHEN mirror mode is 'DRY RUN' THEN the system SHALL not execute real input even if dispatch-gate permits

#### 7.4 storage.ts Integration

7.4.1 WHEN an operation completes with action results THEN the system SHALL persist learned patterns to storage
7.4.2 WHEN a recurring action pattern emerges from action history THEN the system MAY suggest optimizations to the planner

### 8. Error Handling and Diagnostics

#### 8.1 Error Categories

8.1.1 WHEN input dispatch fails due to permission denied THEN the system SHALL raise a PermissionDenied error with context
8.1.2 WHEN a coordinate translation fails THEN the system SHALL raise a CoordinateError with the invalid values
8.1.3 WHEN OS input API is unavailable THEN the system SHALL raise a PlatformUnavailableError with recovery suggestions
8.1.4 WHEN a key combination is invalid for the platform THEN the system SHALL raise a KeyCombinationError with available alternatives

#### 8.2 Logging and Telemetry

8.2.1 WHEN a step is dispatched THEN the system SHALL log the action type, target, coordinates, and result
8.2.2 WHEN an action fails THEN the system SHALL log the error type, message, and context for debugging
8.2.3 WHEN performance metrics exceed thresholds THEN the system SHALL log performance warnings

### 9. State Management

#### 9.1 Execution State

9.1.1 WHEN a step is being dispatched THEN the system SHALL track its state from pending to executing to completed/failed
9.1.2 WHEN a step is interrupted mid-execution THEN the system SHALL attempt to halt and restore prior state
9.1.3 WHEN the OS reports input was not processed THEN the system SHALL retry or escalate to the planner

#### 9.2 Mouse and Keyboard State

9.2.1 WHEN modifier keys are used (ctrl, alt, cmd, shift) THEN the system SHALL ensure they are released after the key combination
9.2.2 WHEN mouse button state changes THEN the system SHALL track button press/release state to prevent mismatches
9.2.3 WHEN text input requires special handling (paste buffer, input method) THEN the system SHALL use appropriate OS APIs

### 10. Testing and Validation

#### 10.1 Dry-Run Mode

10.1.1 WHEN dispatch is disabled or in preview mode THEN the system SHALL simulate steps without sending real input
10.1.2 WHEN a dry-run completes THEN the system SHALL return simulated success results with mock coordinates
10.1.3 WHEN dry-run mode is active THEN the system SHALL clearly indicate this in logs and UI

#### 10.2 Verification

10.2.1 WHEN an action completes THEN the system MAY capture a screenshot to verify the expected outcome
10.2.2 WHEN verification shows the expected result did not occur THEN the system SHALL report discrepancy to the planner
10.2.3 WHEN action results cannot be verified THEN the system SHALL report the action as succeeded with low confidence

## Glossary

| Term | Definition |
|------|------------|
| Normalized Coordinates | Screen position represented as values 0..1 where (0,0) is top-left and (1,1) is bottom-right |
| Pixel Coordinates | Screen position represented as actual screen pixel values |
| GateBlock | Safety gate rule that prevents a workflow step from executing |
| Dry-Run Mode | Simulation mode where steps are not actually dispatched to the OS |
| Drift Correction | Adjustment of coordinates based on detected difference between expected and actual element position |
| MirrorEvent | User gesture (click, drag, scroll, key, type) from the preview screen |
| WorkflowStep | Instruction to perform an action (mouse/keyboard) at a normalized screen position |
| Performed | Result object containing success/failure and metadata from action execution |
| AvoidRule | Blacklist entry that prevents dispatch of certain action+target+point combinations |
