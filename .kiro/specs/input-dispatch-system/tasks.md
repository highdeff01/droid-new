# Input Dispatch System - Implementation Tasks

## Overview

This tasks document breaks down the complete implementation of the Input Dispatch System into 33 concrete, implementable tasks across 11 phases. The implementation follows a logical progression from foundational setup and types, through core functionality (coordinate translation, platform adapters, queue management), to integration with existing systems, safety features, comprehensive testing, optimization, and final documentation.

# Implementation Plan

The implementation is organized into 11 sequential phases with clear dependencies and parallelization opportunities.

## Tasks

### Phase 1: Setup & Core Types (Prerequisite for all other phases)

- [x] 1.1 Install and configure required npm packages
  - Install `robotjs` for cross-platform input dispatch
  - Install `node-ffi` for native API fallback support (Windows/macOS/Linux)
  - Install `node-gyp` build tools for native module compilation
  - Verify installation on current platform (Windows)
  - Document fallback dependencies per platform in setup guide
  - Update package.json with versions and peer dependencies
  - _Requirements: 1.1_
  - Complexity: small
  - Dependencies: None (first task)
  - Acceptance: `npm list robotjs` shows installed, build tools present

- [x] 1.2 Create module structure and file organization
  - Create `input-dispatcher.ts` (main orchestrator)
  - Create `coordinate-translator.ts` (normalize → pixel conversion)
  - Create `keyboard-mapper.ts` (cross-platform key mapping)
  - Create `input-executor.ts` (queue, rate limiting, retry)
  - Create `platform-adapter.ts` (interface definition)
  - Create `platform-adapter-win.ts` (Windows implementation)
  - Create `platform-adapter-mac.ts` (macOS implementation stub)
  - Create `platform-adapter-linux.ts` (Linux implementation stub)
  - Create `error-types.ts` (error hierarchy)
  - Create directory structure: `src/input-dispatch/`
  - Add index.ts barrel exports for public API
  - _Requirements: 1.2_
  - Complexity: small
  - Dependencies: 1.1
  - Acceptance: All files created, imports resolve, no runtime errors on load

- [x] 1.3 Define core type definitions in types.ts
  - Add `Performed` interface (success/failure result with metadata)
  - Add `HopOutcome` type alias
  - Add `DispatchState` interface (live/dry-run/paused state)
  - Add `WorkflowStep` enhancements (add correctedX, correctedY fields)
  - Add `DisplayInfo` interface (monitor metadata: index, name, width, height, offset, isPrimary)
  - Add `CoordinateTranslationResult` type
  - Add `PlatformAdapter` interface (all mouse/keyboard/state methods)
  - Add `ExecutionState` interface (tracking execution progress)
  - Add `MouseState` and `KeyboardState` interfaces
  - Add `InputQueueConfig` interface
  - Export all types from types.ts barrel
  - Verify TypeScript compilation with no errors
  - _Requirements: 1.3_
  - Complexity: small
  - Dependencies: 1.2
  - Acceptance: TypeScript compilation passes, types are exported and importable, no `any` types used

- [x] 1.4 Create error type hierarchy in error-types.ts
  - Create `InputDispatchError` abstract base class with:
    - `category: 'permission' | 'coordinate' | 'platform' | 'key-combo' | 'transient'`
    - `isRetryable: boolean`
    - `step: WorkflowStep`
    - `timestamp: number`
  - Create `PermissionDeniedError` (isRetryable=false)
  - Create `CoordinateError` (isRetryable=false)
  - Create `PlatformUnavailableError` (isRetryable=false)
  - Create `KeyCombinationError` (isRetryable=false, with suggestedAlternatives)
  - Create `TransientOSError` (isRetryable=true)
  - Add error code constants (ERR_PERM_DENIED, ERR_COORD_INVALID, etc.)
  - Create error message formatting utility
  - _Requirements: 1.4_
  - Complexity: small
  - Dependencies: 1.3
  - Acceptance: All error classes instantiate correctly, instanceof checks work, serialization preserves metadata

- [x] 1.5 Set up test infrastructure and mocking utilities
  - Create `__mocks__/platform-adapter.mock.ts` with jest mocks
  - Create test helper for creating mock DisplayInfo arrays
  - Create test helper for creating WorkflowStep fixtures
  - Create test helper for creating Performed result fixtures
  - Add mock implementations of all PlatformAdapter methods
  - Create test setup/teardown utilities
  - Verify jest configuration works with TypeScript
  - _Requirements: 1.5_
  - Complexity: small
  - Dependencies: 1.2, 1.3, 1.4
  - Acceptance: `npm test -- 1.5` runs without errors, mocks track calls correctly

### Phase 2: Coordinate System & Keyboard Mapping

- [x] 2.1 Implement coordinate-translator.ts (normalize → pixel conversion)
  - Implement `getDisplayInfo(): DisplayInfo[]` query
    - Query OS for current display configuration
    - Cache results for 5 seconds (DisplayInfo is stable)
    - Return array with primary display first
    - Include offsetX, offsetY for multi-monitor support
  - Implement `normalizedToPixels(x, y, displayIndex?): {px, py}`
    - Clamp x, y to [0, 1] range
    - Select display by index (default 0 = primary)
    - Apply offset: px = offset.x + x * width
    - Return pixel coordinates
  - Implement `pixelsToNormalized(px, py, displayIndex?): {x, y}` (inverse)
    - Reverse calculation for verification tests
  - Implement `translateCoordinates(step, displayInfo): WorkflowStep`
    - Update step with correctedX, correctedY
    - Add displayIndex to metadata
    - Return augmented step
  - Add caching layer with TTL-based invalidation
  - _Requirements: 2.1_
  - Complexity: medium
  - Dependencies: 1.1, 1.3
  - Acceptance: Converts 0.5, 0.5 to center of primary display; multi-monitor offsets applied correctly; cache invalidates after TTL

- [x] 2.2 Write coordinate-translator unit tests
  - Test single display (1920×1080): (0.5, 0.5) → (960, 540)
  - Test coordinate clamping: (-0.1, 1.2) → (0, 1080)
  - Test multi-monitor: 2 displays (1920×1080 + 1920×1080), offset by (1920, 0)
    - (0.5, 0.5) on display 0 → (960, 540)
    - (0.5, 0.5) on display 1 → (2880, 540)
  - Test cache TTL: call getDisplayInfo twice in < 5s, verify no duplicate system calls
  - Test cache invalidation: call after 5s, verify fresh system call
  - Test pixelsToNormalized inverse: normalize → pixel → normalize should match original
  - _Requirements: 2.2_
  - Complexity: medium
  - Dependencies: 2.1
  - Acceptance: All tests pass, coverage > 90%

- [x] 2.3 Implement keyboard-mapper.ts (cross-platform key name mapping)
  - Implement `parseKeyCombo(combo: string): KeyParts`
    - Input: "ctrl+shift+c"
    - Output: { modifiers: ['ctrl', 'shift'], key: 'c' }
    - Handle case-insensitive input
    - Normalize modifier order (ctrl < alt < shift < cmd)
  - Implement platform-specific modifier mapping:
    - `platformModifierName(mod, platform): string`
    - "ctrl" → "ctrl" on win32/linux, "ctrl" on darwin
    - "cmd" → "cmd" on darwin, "ctrl" on win32/linux
    - "alt" → "alt" on all
    - "super"/"win" → "win" on win32, N/A on darwin, "super" on linux
  - Implement `mapKeyCombo(combo, platform): string`
    - Parse input combo
    - Map modifiers to platform
    - Validate combo is legal on platform
    - Return mapped combo (e.g., "cmd+c" → "ctrl+c" on Windows)
    - Raise KeyCombinationError if invalid
  - Create key mapping table with common cross-platform combos
  - Add validation for Unicode key names (F1–F12, Return, Space, etc.)
  - _Requirements: 2.3_
  - Complexity: medium
  - Dependencies: 1.3, 1.4
  - Acceptance: "cmd+c" maps to "cmd+c" on macOS, "ctrl+c" on Windows; invalid combos raise errors

- [x] 2.4 Write keyboard-mapper unit tests
  - Test parseKeyCombo: "ctrl+shift+a" → {modifiers: ['ctrl', 'shift'], key: 'a'}
  - Test case-insensitive: "CTRL+C" and "ctrl+c" parse identically
  - Test modifier normalization: "shift+ctrl" and "ctrl+shift" normalize to same order
  - Test platform mapping: "cmd+c" on darwin, "ctrl+c" on win32, "ctrl+c" on linux
  - Test single key (no modifiers): "a" → {modifiers: [], key: 'a'}
  - Test special keys: "ctrl+Return", "cmd+F1", "alt+Tab"
  - Test invalid combo error: "invalid+combo" raises KeyCombinationError
  - Test suggestedAlternatives for platform-specific combos (e.g., "win+d" on macOS)
  - _Requirements: 2.4_
  - Complexity: medium
  - Dependencies: 2.3
  - Acceptance: All tests pass, coverage > 90%, error messages helpful

- [x] 2.5 Implement platform-adapter.ts interface and base class
  - Define `PlatformAdapter` interface with:
    - `mouseMove(x, y): Promise<void>`
    - `mouseClick(x, y, button='left'): Promise<void>`
    - `mouseDoubleClick(x, y): Promise<void>`
    - `mouseDrag(startX, startY, endX, endY): Promise<void>`
    - `mouseScroll(x, y, deltaY): Promise<void>`
    - `mouseRelease(button?): Promise<void>`
    - `keyPress(keyCombo): Promise<void>`
    - `keyRelease(keyCombo): Promise<void>`
    - `typeText(text): Promise<void>`
    - `getMousePosition(): Promise<{x, y}>`
    - `getActiveWindow(): Promise<string>`
    - `isAvailable(): Promise<boolean>`
  - Create abstract `BasePlatformAdapter` with common error handling
  - Add platform detection utility function
  - Create factory function `getPlatformAdapter(): PlatformAdapter`
  - _Requirements: 2.5_
  - Complexity: small
  - Dependencies: 1.3, 1.4
  - Acceptance: Interface compiles, factory returns correct adapter for platform, all methods defined

### Phase 3: Platform Adapters (Windows, macOS, Linux)

- [x] 3.1 Implement platform-adapter-win.ts (Windows robotjs integration)
  - Implement using `robotjs` as primary implementation:
    - `mouseMove(x, y)`: robotjs.moveMouse(x, y)
    - `mouseClick(x, y, button='left')`: moveMouse then robotjs.mouseClick(button)
    - `mouseDrag(sx, sy, ex, ey)`: moveMouse(sx, sy), drag to (ex, ey)
    - `mouseScroll(x, y, deltaY)`: moveMouse(x, y), scroll by deltaY
    - `keyPress(combo)`: map combo to robotjs key sequence, execute
    - `typeText(text)`: robotjs.typeString for ASCII, fallback for Unicode
  - Add Windows-specific error handling:
    - Catch ERR_PERMISSION_DENIED → PermissionDeniedError
    - Catch ERR_INVALID_POINT → CoordinateError
    - Catch ERR_UNAVAILABLE → PlatformUnavailableError
  - Add robustness for robot.js quirks:
    - Minimum 10ms between calls to avoid OS drops
    - Scale coordinates for High DPI displays (handle 1.25x, 1.5x scaling)
    - Handle Windows Defender/Security Center blocking
  - Add fallback to SendInput via node-ffi for key combos (future optimization)
  - Document keyboard layout limitations (non-US layouts)
  - _Requirements: 3.1_
  - Complexity: large
  - Dependencies: 2.5, 1.1
  - Acceptance: All methods callable, no crashes; robotjs functions invoked with correct parameters

- [x] 3.2 Write platform-adapter-win tests
  - Test mouseClick(960, 540) calls robotjs.moveMouse(960, 540) and robotjs.mouseClick('left')
  - Test mouseDrag translates to moveMouse start, then drag sequence
  - Test keyPress('ctrl+c') translates to robotjs key combo
  - Test typeText with ASCII and Unicode input (emoji, Chinese)
  - Test error handling: CoordinateError on negative coordinates
  - Test coordinate scaling for High DPI (1.5x): (960, 540) adjusted to (1440, 810)
  - Test that 10ms minimum between calls is respected
  - Mock robotjs to verify call sequences (no double-call bugs)
  - _Requirements: 3.2_
  - Complexity: medium
  - Dependencies: 3.1
  - Acceptance: Tests pass, robotjs call sequences correct, error mapping works

- [x] 3.3 Implement platform-adapter-mac.ts (macOS stub with robotjs)
  - Use same robotjs approach as Windows (cross-platform compatible)
  - Add macOS-specific tweaks:
    - Respect cmd key mapping ("cmd" stays "cmd" on macOS)
    - Handle keyboard layout for non-US (French AZERTY, German QWERTZ)
    - Note: Full CGEvent integration deferred to Phase 4 (optimization)
  - Document Retina display scaling implications
  - Add warning for accessibility restrictions (may require Accessibility permissions)
  - Note fallback path to CGEvent via node-ffi (document but don't implement yet)
  - _Requirements: 3.3_
  - Complexity: medium
  - Dependencies: 2.5, 1.1, 2.3
  - Acceptance: Adapter instantiates, all methods present, cmd key handling documented

- [x] 3.4 Implement platform-adapter-linux.ts (Linux xdotool via child_process)
  - Implement xdotool-based approach (most portable for X11):
    - `mouseMove(x, y)`: `xdotool mousemove x y`
    - `mouseClick(x, y, button)`: `xdotool mousemove x y; xdotool click [1/2/3]`
    - `mouseDrag(sx, sy, ex, ey)`: `xdotool mousemove sx sy; xdotool key Button1; xdotool mousemove ex ey; xdotool key Button1Up`
    - `keyPress(combo)`: `xdotool key "ctrl+c"` (xdotool handles parsing)
    - `typeText(text)`: `xdotool type --clearmodifiers "text"`
  - Add xdotool availability check: `which xdotool`
  - Handle missing xdotool gracefully: emit warning, suggest installation
  - Add X11 display detection (DISPLAY env var)
  - Document limitations: Wayland not supported (xdotool is X11-only)
  - Add note for future: X11 bindings via node-xlib as fallback
  - _Requirements: 3.4_
  - Complexity: medium
  - Dependencies: 2.5, 1.1
  - Acceptance: Adapter instantiates, xdotool commands generated correctly, availability check works

### Phase 4: Input Queue & Rate Limiting

- [x] 4.1 Implement input-executor.ts (queue, rate limiting, retry)
  - Create `InputQueue` class:
    - Constructor: accepts `InputQueueConfig` with minDelayMs (default 50), maxQueueSize (100), maxRetries (3), retryBaseMs (100)
    - Maintain internal FIFO queue of pending actions
    - Track `lastDispatchTime` for rate limiting
  - Implement `canDispatch(): Promise<void>`:
    - Calculate time since last dispatch
    - If less than minDelayMs, sleep until slot available
    - Return when ready to dispatch
  - Implement `enqueue(step): Promise<ExecutionResult>`:
    - Check if queue size exceeds maxQueueSize
    - If full, return backpressure error or wait for slot
    - Add step to queue
    - Wait for canDispatch() to be available
    - Resolve with execution result
  - Implement `retry(fn, maxAttempts, baseDelayMs): Promise`:
    - Try executing fn
    - On TransientOSError: exponential backoff (2^n), retry up to maxAttempts
    - On hard error: fail immediately
    - Return result or throw final error
  - Implement `setRateLimit(minMs)`: update config dynamically
  - Implement `getQueueSize()`: return number of pending actions
  - Add timing metrics: lastDispatchTime, totalDispatched, etc.
  - _Requirements: 4.1_
  - Complexity: medium
  - Dependencies: 1.3, 1.4, 1.5
  - Acceptance: Queue maintains order, rate limiting enforces minimum delay, retry with backoff works

- [x] 4.2 Write input-executor unit tests
  - Test canDispatch(): first call returns immediately, second within 50ms blocks
  - Test rate limiting: 3 actions with 50ms minDelay take ≥ 100ms total
  - Test enqueue order: actions dispatched in FIFO order
  - Test backpressure: queue at maxQueueSize (100) refuses new entries or waits
  - Test exponential backoff: 1st retry @ 100ms, 2nd @ 200ms, 3rd @ 400ms
  - Test hard error: non-transient error fails immediately without retry
  - Test retry exhaustion: after maxAttempts retries, final error thrown
  - Test dynamic rate limit change: setRateLimit(100) takes effect on next canDispatch
  - Test metrics: getQueueSize(), stats collected correctly
  - _Requirements: 4.2_
  - Complexity: medium
  - Dependencies: 4.1
  - Acceptance: Tests pass, timing assertions within ±50ms tolerance, retry backoff verified

### Phase 5: Main Dispatcher & Gate Integration

- [x] 5.1 Implement input-dispatcher.ts (main orchestrator)
  - Create `InputDispatcher` class:
    - Constructor: accepts displayInfo, platformAdapter, queue, translator, rules context
  - Implement `dispatchWorkflowStep(step, context): Promise<Performed>`:
    - Call `gateStep(step, context.knowledge, context.rules)` for safety check
    - If gate blocks: return Performed with ok=false, halt=true, message=gateBlock.reason
    - Else: translate coordinates via coordinator-translator
    - Enqueue via input queue
    - Call platform adapter to execute action
    - Handle platform errors and translate to InputDispatchError
    - Return Performed result with metadata (duration, drift, etc.)
  - Implement `dispatch(steps[], context): Promise<Performed[]>`:
    - Map over steps array, call dispatchWorkflowStep for each
    - Preserve order, collect results
    - Return array of Performed results
  - Implement `setDryRunMode(enabled: boolean)`: toggle simulation mode
    - When true: return Performed with executed=false, ok=true, message="dry-run: not dispatched"
    - When false: real dispatch resumes
  - Implement `getDispatchState(): DispatchState`:
    - Return current mode (live/dry-run/paused), queue size, last dispatch info
  - Add pause/resume methods (for user approval workflows)
  - Implement result recording integration (call appendHistory)
  - _Requirements: 5.1_
  - Complexity: large
  - Dependencies: 1.3, 2.1, 2.3, 3.1, 4.1
  - Acceptance: All methods callable, gate check enforced, dry-run mode prevents real input, results recorded

- [x] 5.2 Write input-dispatcher unit tests
  - Test dispatchWorkflowStep with allowed step: returns ok=true, executed=true
  - Test dispatchWorkflowStep with gate block: returns ok=false, halt=true, message from gate
  - Test coordinate translation: normalized coords converted to pixels
  - Test dry-run mode: setDryRunMode(true), step returns executed=false
  - Test batch dispatch: dispatch 3 steps in order, all results returned
  - Test platform error handling: platform adapter throws PermissionDeniedError, caught and returned as ok=false
  - Test result recording: appendHistory called with correct ActionRecord
  - Test dryRun flag propagated to Performed result
  - _Requirements: 5.2_
  - Complexity: medium
  - Dependencies: 5.1, 1.5
  - Acceptance: Tests pass, all code paths covered, mock calls verified

- [x] 5.3 Integrate with dispatch-gate.ts
  - Modify `dispatch-gate.ts` to work with real dispatcher (no changes to gateStep logic itself)
  - Add `gateAndDispatch(step, k, rules, dispatcher): Promise<Performed>` wrapper:
    - Calls existing gateStep logic
    - If gate passes, calls dispatcher.dispatchWorkflowStep
    - Returns Performed result
  - Ensure backward compatibility: existing gateStep tests still pass
  - Document integration point in comments
  - _Requirements: 5.3_
  - Complexity: small
  - Dependencies: 5.1
  - Acceptance: gateStep logic unchanged, gateAndDispatch integrates correctly, existing tests pass

### Phase 6: Integration with Existing Systems

- [x] 6.1 Integrate input-dispatcher with action-history.ts
  - In `input-dispatcher.ts` dispatchWorkflowStep: after successful execution
  - Create ActionRecord:
    ```
    {
      id: generateId(),
      time: Date.now(),
      action: step.action,
      x: pixelCoords.x,
      y: pixelCoords.y,
      endX: endPixelCoords?.x,
      endY: endPixelCoords?.y,
      text: step.text,
      source: 'Automation',
      via: 'bridge',
      ok: result.ok,
      message: result.message,
      dispatched: result.executed,
      dryRun: !dispatchState.real
    }
    ```
  - Call `appendHistory([actionRecord])`
  - Include metadata: actual pixel coords, drift, duration
  - Test that history entries created with correct metadata
  - _Requirements: 6.1_
  - Complexity: small
  - Dependencies: 5.1
  - Acceptance: action-history contains executed actions with metadata, no duplicate entries

- [x] 6.2 Create mirror-input dispatcher integration
  - In `mirror-input.ts`: add dispatcher integration method
  - Create `mirrorDispatch(ev: MirrorEvent, id: string, dispatcher): Promise<Performed>`
    - Convert MirrorEvent to WorkflowStep
    - Call dispatcher.dispatchWorkflowStep
    - Return Performed result
  - Ensure MirrorEvent → WorkflowStep conversion maintains normalized coords
  - Test that mirror events can flow through real dispatch pipeline
  - _Requirements: 6.2_
  - Complexity: small
  - Dependencies: 5.1
  - Acceptance: Mirror events can be dispatched, Performed result returned correctly

- [x] 6.3 Add learning system feedback integration
  - In `input-dispatcher.ts` after recordResult:
  - Detect drift: if `performed.drift?.distance > 0.05`, call `learningSystem.recordDrift(step.target, distance)`
  - Detect failure: if `!performed.ok && performed.executed`, call `learningSystem.recordFailure(step, message)`
  - Call `learningSystem.recordSuccess(step)` on successful execution
  - Pass metadata (duration, drift, changes) to learning system
  - _Requirements: 6.3_
  - Complexity: small
  - Dependencies: 5.1
  - Acceptance: Learning system receives feedback on success/failure/drift

- [x] 6.4 Write integration tests (action-history + dispatcher)
  - Test that executed action recorded to action-history
  - Test that dry-run action NOT recorded to history (or marked dryRun=true)
  - Test that gate-blocked action recorded as failed/not executed
  - Test metadata (pixel coords, duration) in history entry
  - Test batch dispatch: all 3 actions recorded to history
  - _Requirements: 6.4_
  - Complexity: medium
  - Dependencies: 6.1, 5.2
  - Acceptance: Integration tests pass, history populated correctly

### Phase 7: Safety & Blocking Features

- [x] 7.1 Implement dry-run mode with safe preview
  - In `input-dispatcher.ts`:
    - Add `dryRunMode` boolean flag
    - `setDryRunMode(enabled)`: toggle flag
    - In `dispatchWorkflowStep`: if dryRunMode, return simulated Performed without executing
  - Simulated result includes:
    - `ok: true` (would succeed if real)
    - `executed: false` (not actually sent to OS)
    - `target: {x, y}` (where action would go)
    - `message: "dry-run: not dispatched"`
  - Dry-run mode suitable for preview/testing workflows
  - Document that dry-run does NOT call platform adapter
  - _Requirements: 7.1_
  - Complexity: small
  - Dependencies: 5.1
  - Acceptance: Dry-run mode prevents real input, simulated results returned, no platform calls

- [x] 7.2 Implement user approval prompts for sensitive operations
  - Identify sensitive operation patterns:
    - Keywords: 'password', 'credential', 'secret', 'token', 'api_key'
    - Actions: shutdown, restart, uninstall, delete, format
    - System controls: Task Manager, Services, Registry Editor, System Settings
  - In `input-dispatcher.ts` before execution:
    - Check if step target matches sensitive patterns
    - If yes: emit 'approval-required' event with step + screenshot preview
    - Wait for user response (approve/deny)
    - If approved: proceed; if denied: return refused result
  - Add callback hook for UI to prompt user
  - Document approval flow in comments
  - Note: full UI implementation deferred to application layer
  - _Requirements: 7.2_
  - Complexity: small
  - Dependencies: 5.1
  - Acceptance: Sensitive operations trigger approval event, execution waits for response

- [x] 7.3 Implement rate limiting safeguards
  - In `input-executor.ts` InputQueue:
    - Default minDelayMs = 50ms (minimum 20 actions/sec)
    - Configurable via setRateLimit
    - Enforce maxQueueSize = 100 to prevent queue explosion
  - Add detection for runaway dispatch:
    - If queue steadily fills (≥ 90% capacity for 5+ seconds), emit warning
    - Suggest reducing action frequency or increasing minDelay
  - Add backpressure: if queue full, new actions return backpressure error
  - Planner must handle backpressure by slowing down
  - _Requirements: 7.3_
  - Complexity: small
  - Dependencies: 4.1
  - Acceptance: Rate limiting enforced, backpressure prevents queue overflow

- [x] 7.4 Write safety feature tests
  - Test dry-run: no platform calls made
  - Test approval callback: sensitive operation emits event, waits for response
  - Test approval denial: returns refused result without executing
  - Test rate limiting: > 20 actions/sec throttled appropriately
  - Test backpressure: queue full returns error, not queued
  - Test runaway warning: queue at 90% for 5s emits warning
  - _Requirements: 7.4_
  - Complexity: medium
  - Dependencies: 7.1, 7.2, 7.3
  - Acceptance: All safety tests pass, safeguards prevent harm

### Phase 8: Error Recovery & Robustness

- [x] 8.1 Implement comprehensive error recovery
  - In `input-executor.ts` retry function:
    - Categorize errors: transient vs permanent
    - Transient (retryable): OS temporarily busy, device locked, screen locked
    - Permanent (non-retryable): permission denied, invalid coordinate, platform unavailable
  - For transient errors: apply exponential backoff (100ms, 200ms, 400ms)
  - For permanent errors: fail immediately with descriptive error
  - Catch and map platform adapter errors to InputDispatchError subtypes
  - Log retry attempts for debugging
  - _Requirements: 8.1_
  - Complexity: medium
  - Dependencies: 1.4, 4.1
  - Acceptance: Transient errors retried, permanent errors fail fast, error mapping correct

- [x] 8.2 Add timeout and interrupt handling
  - In `input-dispatcher.ts`:
    - Set timeout for each dispatch operation (default 10 seconds)
    - If timeout reached: interrupt execution, return timeout error
    - Allow per-step timeout configuration
  - Handle interrupt: cleanup any pending platform operations (e.g., release held keys)
  - _Requirements: 8.2_
  - Complexity: medium
  - Dependencies: 5.1
  - Acceptance: Timeout enforced, operations interrupted cleanly, no stalled state

- [x] 8.3 Implement mouse/keyboard state cleanup
  - Track `MouseState` (pressed buttons: Set<button>)
  - Track `KeyboardState` (held modifiers: Set<modifier>)
  - After each action, verify state is clean:
    - If mouse button still pressed: call `mouseRelease()` to reset
    - If modifier keys still held: call `keyRelease()` for each to reset
  - Add safety check before drag: ensure no buttons pressed, release if needed
  - _Requirements: 8.3_
  - Complexity: small
  - Dependencies: 3.1
  - Acceptance: State is clean after each operation, no stalled press/release

- [x] 8.4 Write error recovery tests
  - Test transient error retry: simulate OS busy error, verify retries with backoff
  - Test permanent error: PermissionDeniedError fails immediately
  - Test timeout: action running > 10s interrupted
  - Test state cleanup: mouse button released after drag, modifiers released
  - Test error messages: logged with context for debugging
  - _Requirements: 8.4_
  - Complexity: medium
  - Dependencies: 8.1, 8.2, 8.3
  - Acceptance: Error recovery tests pass, no stalled operations

### Phase 9: Cross-Platform Testing

- [x] 9.1 Set up Windows-specific test environment
  - Create `platform-adapter-win.spec.ts` with Windows-specific tests:
    - Test key combinations (alt+F4, ctrl+shift+esc, win+d)
    - Test Unicode text input (emoji, Chinese characters)
    - Test High DPI display scaling (1.5x, 1.25x)
    - Test multi-monitor coordinate translation (2+ displays)
  - Mock robotjs to avoid real input during tests
  - Use jest for test runner
  - _Requirements: 9.1_
  - Complexity: medium
  - Dependencies: 3.1, 3.2
  - Acceptance: Windows tests pass, no real input sent, coverage > 80%

- [x] 9.2 Create macOS test stub
  - Create `platform-adapter-mac.spec.ts` with stubs
  - Document what tests would run on actual macOS:
    - cmd key mapping, Retina display scaling, keyboard layouts
  - Mark tests as skipped on non-macOS platforms
  - Note: full testing requires macOS system (CI/CD consideration)
  - _Requirements: 9.2_
  - Complexity: small
  - Dependencies: 3.3
  - Acceptance: Test file created, stubs in place, documentation clear

- [x] 9.3 Create Linux test stub
  - Create `platform-adapter-linux.spec.ts` with stubs
  - Document what tests would run on Linux:
    - xdotool availability check, X11 display, keyboard layouts
  - Mark tests as skipped on non-Linux platforms
  - Note: full testing requires Linux with X11 (CI/CD consideration)
  - _Requirements: 9.3_
  - Complexity: small
  - Dependencies: 3.4
  - Acceptance: Test file created, stubs in place, documentation clear

- [x] 9.4 Write end-to-end dry-run verification test
  - Create `input-dispatcher.e2e.spec.ts`:
    - Simulate complete workflow: 5 actions in sequence
    - Verify each action gate-checked, translated, queued, executed (mock)
    - Verify all results recorded to action-history
    - Verify dry-run mode: same workflow with no real input
    - Compare dry-run and real results (same ok/target/message)
  - Test batch dispatch: 10 actions, verify order preserved, rate limiting applied
  - Test interruption: pause mid-workflow, resume, complete
  - _Requirements: 9.4_
  - Complexity: large
  - Dependencies: 5.1, 5.2, 6.1, 7.1
  - Acceptance: E2E test passes, workflow completes correctly, history populated

### Phase 10: Performance & Optimization

- [x] 10.1 Add performance benchmarks
  - Create `benchmarks/dispatcher.bench.ts`:
    - Measure single action dispatch time (target: < 100ms for real, < 1ms for dry-run)
    - Measure batch dispatch (10 actions): total time vs individual timing
    - Measure coordinate translation: caching effectiveness
    - Measure queue throughput: actions/second at various rate limits
  - Run benchmarks on Windows platform (primary target)
  - Document baseline numbers
  - Set performance budgets (fail CI if regression > 10%)
  - _Requirements: 10.1_
  - Complexity: medium
  - Dependencies: 5.1, 4.1
  - Acceptance: Benchmarks run, results documented, budgets set

- [x] 10.2 Optimize coordinate translation caching
  - In `coordinate-translator.ts`:
    - Implement LRU cache for DisplayInfo (capacity 5, TTL 5s)
    - Measure cache hit rate
    - Profile to identify bottlenecks in normalizedToPixels
  - Verify cache doesn't stale during multi-monitor changes
  - _Requirements: 10.2_
  - Complexity: small
  - Dependencies: 2.1
  - Acceptance: Cache implemented, hit rate > 90%, no stale data

- [x] 10.3 Profile and optimize hot paths
  - Use Node.js profiler to identify CPU hotspots
  - Expected hotspots: platform adapter calls, coordinate translation
  - Optimize without sacrificing correctness
  - Add comments for future maintainers on optimization rationale
  - _Requirements: 10.3_
  - Complexity: medium
  - Dependencies: 10.1, 10.2
  - Acceptance: Profiling complete, optimizations applied, no regressions in tests

### Phase 11: Documentation & Finalization

- [x] 11.1 Write API documentation
  - Document public API in README:
    - `InputDispatcher` class with all methods
    - `PlatformAdapter` interface
    - `CoordinateTranslator` public methods
    - `KeyboardMapper` public methods
    - Error types and recovery strategies
  - Add usage examples:
    - Single action dispatch
    - Batch dispatch with rate limiting
    - Dry-run preview
    - Error handling with retry
  - Document integration with action-history and learning system
  - _Requirements: 11.1_
  - Complexity: small
  - Dependencies: All phases
  - Acceptance: README complete, examples runnable, API clear

- [x] 11.2 Add inline code comments and type documentation
  - Add JSDoc comments to all public functions
  - Document complex logic (retry, backoff, coordinate translation)
  - Add inline comments for non-obvious decisions (e.g., 50ms rate limit rationale)
  - Document limitations per platform
  - _Requirements: 11.2_
  - Complexity: small
  - Dependencies: All phases
  - Acceptance: Code readable, JSDoc complete, no TODOs remaining

- [x] 11.3 Create troubleshooting guide
  - Document common issues:
    - robotjs not found / build failed
    - Permission denied errors and how to resolve
    - Coordinate translation off by scale factor (High DPI)
    - Rate limiting too aggressive / queue backpressure
    - Keyboard layout compatibility
  - Add debug mode: verbose logging for troubleshooting
  - _Requirements: 11.3_
  - Complexity: small
  - Dependencies: All phases
  - Acceptance: Troubleshooting guide complete, common issues covered

- [x] 11.4 Final verification and cleanup
  - Run full test suite: `npm test` (all tests pass)
  - Run linter: `npm run lint` (no errors or warnings)
  - Check TypeScript compilation: `npm run build` (no errors)
  - Verify code coverage: target > 85% on core modules
  - Remove debug/temporary code
  - Verify no console.log or debugger statements in production code
  - Final sanity check: import all modules, no runtime errors
  - _Requirements: 11.4_
  - Complexity: small
  - Dependencies: All phases
  - Acceptance: Full suite passes, coverage meets target, code ready for production

## Task Dependency Graph

The task dependency graph illustrates the logical flow and prerequisites for all 33 tasks across 11 implementation phases. Each task is labeled with its phase number and task ID (e.g., 1.1 = Phase 1, Task 1).

```json
{
  "waves": [
    {
      "wave": 1,
      "tasks": ["1.1"],
      "title": "Phase 1.1: Install Dependencies",
      "description": "No prerequisites; foundational package setup"
    },
    {
      "wave": 2,
      "tasks": ["1.2", "1.3", "1.4", "1.5"],
      "title": "Phase 1.2-1.5: Core Types & Mocking",
      "description": "Sequential: structure → types → errors → mocks"
    },
    {
      "wave": 3,
      "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5"],
      "title": "Phase 2: Coordinate System & Keyboard Mapping",
      "description": "2.1-2.2 sequential (coordinate + tests), 2.3-2.4 sequential (keyboard + tests), 2.5 parallel"
    },
    {
      "wave": 4,
      "tasks": ["3.1", "3.2", "3.3", "3.4"],
      "title": "Phase 3: Platform Adapters",
      "description": "3.1-3.2 sequential (Windows + tests), 3.3-3.4 parallel (macOS/Linux stubs)"
    },
    {
      "wave": 5,
      "tasks": ["4.1", "4.2"],
      "title": "Phase 4: Queue & Rate Limiting",
      "description": "Sequential: InputQueue implementation → tests"
    },
    {
      "wave": 6,
      "tasks": ["5.1", "5.2", "5.3"],
      "title": "Phase 5: Main Dispatcher",
      "description": "Sequential: dispatcher → unit tests → gate integration"
    },
    {
      "wave": 7,
      "tasks": ["6.1", "6.2", "6.3", "6.4"],
      "title": "Phase 6: System Integration",
      "description": "6.1-6.3 parallel (action-history, mirror, learning), 6.4 integration tests"
    },
    {
      "wave": 8,
      "tasks": ["7.1", "7.2", "7.3", "7.4", "8.1", "8.2", "8.3", "8.4"],
      "title": "Phases 7-8: Safety & Error Recovery",
      "description": "Phase 7 (7.1-7.4) parallel safety features, Phase 8 (8.1-8.4) error recovery in parallel"
    },
    {
      "wave": 9,
      "tasks": ["9.1", "9.2", "9.3", "9.4"],
      "title": "Phase 9: Cross-Platform Testing",
      "description": "9.1-9.3 parallel (platform-specific tests), 9.4 end-to-end tests last"
    },
    {
      "wave": 10,
      "tasks": ["10.1", "10.2", "10.3"],
      "title": "Phase 10: Performance Optimization",
      "description": "Sequential: benchmarks → caching → profiling"
    },
    {
      "wave": 11,
      "tasks": ["11.1", "11.2", "11.3", "11.4"],
      "title": "Phase 11: Documentation & Finalization",
      "description": "Parallel: API docs, code comments, troubleshooting, then final verification"
    }
  ]
}
```

## Notes

### Implementation Recommendations

1. **Phase Sequencing**: Phases 1–2 are prerequisites; begin Phase 3 (adapters) in parallel with Phase 4 (queue) once Phase 2 completes. Phase 5 (dispatcher) cannot start until Phases 2–4 complete.

2. **Testing Strategy**: Write tests alongside implementation, not afterward. Each task includes acceptance criteria that become unit tests. This "test-first" approach catches integration issues early.

3. **Platform Support Priority**: Windows is the primary platform (Phase 3.1–3.2 fully implemented). macOS and Linux adapters are stubs (Phases 3.3–3.4) with full xdotool/robotjs-based implementations deferred to Phase 3.4. This unblocks Windows users while maintaining abstraction for future platform support.

4. **Mocking Strategy**: Use jest mocks for platform adapter during unit tests (Phase 1.5). Integration tests in Phase 5.2 verify the complete pipeline with mocked adapter. End-to-end tests in Phase 9.4 use dry-run mode to simulate without real input.

5. **Optimization**: Defer micro-optimizations to Phase 10. Focus on correctness and testability in Phases 1–9. Benchmarks in Phase 10 identify actual hotspots; measure before optimizing.

6. **Documentation**: Start README and inline comments early (Phases 2–5 onward). Final documentation pass in Phase 11 ensures accuracy.

### Known Limitations & Future Work

- **macOS/Linux Adapters**: Currently stubs using robotjs. Full CGEvent (macOS) and X11 (Linux) implementations deferred to Phase 3.3–3.4 optimization passes.
- **Keyboard Layouts**: robotjs assumes US QWERTY. Non-US layouts (AZERTY, QWERTZ) require platform-specific mapping (documented in Phases 2.4 and 3.3–3.4).
- **High DPI Scaling**: Windows High DPI (1.5x, 1.25x) requires coordinate adjustment. Implemented in Phase 3.1; macOS Retina scaling documented but not fully tested (Phase 3.3).
- **Accessibility Permissions**: macOS and Linux may require user permission for input dispatch. Handled in Phase 7.2 (approval prompts).
- **Wayland Support**: xdotool (Linux Phase 3.4) is X11-only. Wayland support deferred to future release (requires alternative like uinput or libinput).

### Risk Mitigation

1. **robotjs Build Failures**: If robotjs fails to compile (due to missing build tools), fallback to xdotool on Linux or require manual setup. Documented in Phase 1.1 and troubleshooting guide (Phase 11.3).

2. **Permission Errors**: Windows UAC and macOS Accessibility prompts can block input dispatch. Handled in Phase 7.2 with approval workflows and documented in Phase 11.3.

3. **Rate Limiting Too Aggressive**: 50ms default minimum may be too slow for some workflows. Made configurable in Phase 4.1; tuning documented in Phase 11.1.

4. **Coordinate Translation Errors**: High DPI, multi-monitor, or dynamic display changes can cause drift. Handled in Phase 2.1 (caching), Phase 8.3 (state cleanup), and Phase 6.3 (learning system feedback).

### Estimated Timeline

- **Phase 1** (Setup): 2–3 days
- **Phases 2–4** (Core): 10–12 days (can parallelize some tasks)
- **Phase 5** (Dispatcher): 5–7 days
- **Phase 6** (Integration): 3–4 days
- **Phases 7–8** (Safety & Recovery): 4–5 days (can parallelize)
- **Phase 9** (Testing): 5–7 days
- **Phase 10** (Optimization): 3–4 days
- **Phase 11** (Documentation): 2–3 days

**Total**: ~40–50 developer-days for full implementation with concurrent work on non-dependent phases.

## Success Criteria

- [x] All tests pass: `npm test`
- [x] TypeScript compilation: `npm run build` (no errors)
- [x] Code coverage: > 85% on core modules (coordinate-translator, keyboard-mapper, input-dispatcher, platform-adapter-win)
- [x] Linting: `npm run lint` (no errors or warnings)
- [x] Dispatch-gate blocking still works (existing tests pass)
- [x] Action history records populated correctly with metadata
- [x] Dry-run mode simulates without real input
- [x] Windows platform fully functional
- [x] Cross-platform interfaces defined and macOS/Linux stubs in place
- [x] Documentation complete (API docs, troubleshooting, examples)
- [x] No performance regressions (benchmarks within budget)
- [x] Code ready for production deployment

