# Input Dispatch System Design

## Overview

The Input Dispatch System bridges the gap between abstract, normalized workflow steps and concrete OS-level input events. This is the execution engine that transforms the planner's decisions into actual keyboard and mouse input on Windows, macOS, and Linux systems.

Currently, the codebase has a `dispatch-gate.ts` that validates whether a step should execute (checking blacklist rules and stale coordinates), but the actual dispatch pipeline—converting normalized coordinates to pixels, sending real input to the OS, and recording results—exists only as placeholder functions. This design formalizes the complete input dispatch architecture including platform abstraction, coordinate translation with multi-monitor support, rate limiting, error recovery, and integration with the learning and safety systems.

The system must be fast enough for interactive automation (50–200ms between actions), safe enough to prevent accidental system harm, and reliable enough to handle platform differences and environmental failures gracefully.

## Glossary

- **Normalized Coordinates**: Screen position as (0..1, 0..1) where (0,0) is top-left and (1,1) is bottom-right
- **Pixel Coordinates**: Screen position in native display resolution pixels (e.g., 1920×1080)
- **WorkflowStep**: A planner-generated instruction to perform an action (click, drag, scroll, key, type) at a normalized location
- **Performed**: Result type containing execution success/failure, metadata (actual pixels, drift), and feedback for the learning system
- **GateBlock**: A safety rule that prevents dispatch (e.g., blacklisted target or stale coordinates)
- **Platform Adapter**: Platform-specific implementation for Windows, macOS, or Linux input dispatch
- **Coordinate Translator**: Module that normalizes (0..1) → pixel coordinates, handling multi-monitor offsets
- **Dry-Run Mode**: Simulation mode where steps are queued but not sent to the OS; used for preview and testing
- **Input Queue**: FIFO queue that applies rate limiting and backpressure to prevent OS overload
- **Drift Correction**: Adjustment of coordinates based on detected mismatch between expected and actual element position
- **MirrorEvent**: User gesture from the preview screen (click, drag, scroll, key, type) that becomes a WorkflowStep
- **DispatchState**: Runtime state tracking whether real dispatch is active, paused, or in dry-run mode

## Bug Details

This is a design document for a new feature (Input Dispatch System), not a bugfix. The system currently lacks a complete implementation of the real input dispatch pipeline, which is required to move Droid Assist from a planning/preview tool to an actual automation executor.

### Current State

- `dispatch-gate.ts` validates steps against safety rules (blacklist, stale coordinates)
- `mirror-input.ts` converts MirrorEvents to WorkflowSteps with normalized coordinates
- `action-history.ts` persists execution records to storage
- **Missing**: Platform-specific input dispatch, coordinate translation, execution queue, result recording

### Expected Behavior

Once the Input Dispatch System is implemented:
1. A WorkflowStep with action='click' and normalized x=0.5, y=0.5 shall dispatch a mouse click at the center of the primary display
2. Multi-monitor setups shall translate coordinates to the correct physical display
3. All actions shall be rate-limited to prevent OS lockup (minimum 50ms between actions)
4. Execution results shall be recorded to action-history with actual pixel coordinates and any drift detected
5. Safety gates shall block unsafe actions (blacklisted targets, stale coordinates)
6. Dry-run mode shall simulate actions without sending real input to the OS

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors**:
- Dispatch gate blocking (blacklist, stale coordinates) SHALL continue to work exactly as before
- Action history recording interface SHALL continue to accept and persist ActionRecord entries
- Mirror input conversion (MirrorEvent → WorkflowStep) SHALL continue to work unchanged
- Existing UI display and workflow planning SHALL not be affected by input dispatcher implementation

**Scope**:
All existing gate decisions, rule checking, and workflow planning logic shall remain unchanged. The input dispatcher is purely an execution layer that sits between the planner and the OS, and shall not modify any validation or planning logic.

## Hypothesized Root Cause

N/A — this is a feature design, not a bugfix.

## Architecture Overview

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Planner / Workflow Engine                │
│                     (generates WorkflowSteps)                │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  Input Dispatch System                       │
├─────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────┐   │
│ │  Dispatch Pipeline                                   │   │
│ │  1. gateStep() → check GateBlock (dispatch-gate)    │   │
│ │  2. mirrorStep() → convert MirrorEvent (if needed)  │   │
│ │  3. translateCoordinates() → normalized → pixels    │   │
│ │  4. queue() → rate limit & backpressure             │   │
│ │  5. execute() → platform adapter → real input       │   │
│ │  6. recordResult() → action-history + Performed     │   │
│ └──────────────────────────────────────────────────────┘   │
│ ┌──────────────────────────────────────────────────────┐   │
│ │  Platform Abstraction Layer (PAL)                    │   │
│ │  ├─ Windows: robotjs or native Node add-on          │   │
│ │  ├─ macOS: CGEvent / Quartz Event Taps              │   │
│ │  └─ Linux: xdotool or X11 bindings                  │   │
│ └──────────────────────────────────────────────────────┘   │
│ ┌──────────────────────────────────────────────────────┐   │
│ │  Support Modules                                     │   │
│ │  ├─ coordinate-translator: norm → pixel             │   │
│ │  ├─ keyboard-mapper: key names across platforms     │   │
│ │  ├─ input-executor: queue, timing, retry logic      │   │
│ │  └─ platform-adapter: OS-specific dispatch          │   │
│ └──────────────────────────────────────────────────────┘   │
└────────┬────────────────────────────────────────┬───────────┘
         │                                        │
         ▼                                        ▼
┌────────────────────┐        ┌──────────────────────────┐
│  action-history    │        │  dispatch-gate,         │
│  (record results)  │        │  blacklist, learning     │
└────────────────────┘        └──────────────────────────┘
```

### Data Flow

```
WorkflowStep (normalized coords)
     │
     ├─ gateStep(step, knowledge, rules)
     │    └─ GateBlock? (avoid / stale) → REFUSE
     │
     ├─ translateCoordinates(step, displayInfo)
     │    └─ WorkflowStep (pixel coords in correctedX/correctedY)
     │
     ├─ queue(step) → Input Queue
     │    └─ Apply rate limiting (50ms default min)
     │
     ├─ execute(step, platformAdapter) → Promise<ExecutionResult>
     │    └─ Platform-specific dispatch (mouse/keyboard)
     │
     ├─ recordResult(step, executionResult) → Performed
     │    └─ Add metadata: actual pixels, drift, screenshots
     │
     └─ appendHistory(actionRecord) → action-history storage
          └─ Trigger learning system feedback
```

### Execution State Machine

```
         ┌─── pending ────┐
         │                 │
         ▼                 ▼
     [gateStep]       [gate blocks]
         │                 │
         │ allowed          └──→ refused (halt=true, ok=false)
         │
         ▼
    [queue step]
         │
         ├─→ backpressure (queue full) → wait
         │
         ▼
    [executing]
         │
         ├─→ success → completed (ok=true, executed=true)
         │
         ├─→ temporary failure (OS state) → retry (backoff 1x, 2x, 4x)
         │
         ├─→ hard failure (permission, platform unavailable) → failed (ok=false)
         │
         └─→ interrupted → halted (ok=false, halt=true)
```

## Core Modules to Create/Modify

### 1. input-dispatcher.ts (Main Execution Engine)

**Responsibility**: Orchestrate the complete dispatch pipeline.

**Key Functions**:
- `dispatchWorkflowStep(step, context) → Promise<Performed>`: Main entry point
- `dispatch(steps[], context) → Promise<Performed[]>`: Batch dispatch with queuing
- `setDryRunMode(enabled: boolean)`: Toggle simulation mode
- `getDispatchState() → DispatchState`: Check current state (running, paused, reason)

**Pseudocode**:
```
FUNCTION dispatchWorkflowStep(step, context)
  INPUT: step of type WorkflowStep, context with knowledge, rules
  OUTPUT: Performed result
  
  // 1. Safety gate check
  gateBlock := gateStep(step, context.knowledge, context.rules)
  IF gateBlock != null THEN
    RETURN Performed(ok=false, executed=false, halt=true, message=gateBlock.reason)
  END IF
  
  // 2. Coordinate translation
  pixelCoords := translateCoordinates(step, context.displayInfo)
  
  // 3. Queue & rate limiting
  WAIT FOR inputQueue.canDispatch() // blocks until slot available
  
  // 4. Platform-specific execution
  result := AWAIT platformAdapter.executeAction(step with pixelCoords)
  
  // 5. Result recording
  performed := recordResult(step, result)
  
  // 6. History persistence
  appendHistory(toActionRecord(performed))
  
  // 7. Learning system feedback
  notifyLearning(performed)
  
  RETURN performed
END FUNCTION
```

### 2. coordinate-translator.ts (Normalize → Pixel Conversion)

**Responsibility**: Convert (0..1, 0..1) coordinates to actual screen pixels, handling multi-monitor configurations.

**Key Functions**:
- `translateCoordinates(step, displayInfo) → WorkflowStep`: Update step.correctedX/Y
- `normalizedToPixels(x, y, displayIndex?) → {px, py}`: Convert one point
- `getDisplayInfo() → DisplayInfo[]`: Query current monitors
- `pixelsToNormalized(px, py, displayIndex?) → {x, y}`: Reverse conversion

**Data Structures**:
```typescript
interface DisplayInfo {
  index: number;
  name: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  isPrimary: boolean;
}

type CoordinateTranslationResult = {
  correctedX: number;
  correctedY: number;
  displayIndex: number;
  pixelX: number;
  pixelY: number;
}
```

**Pseudocode**:
```
FUNCTION normalizedToPixels(x, y, displayIndex = 0)
  INPUT: normalized x, y (0..1), optional displayIndex
  OUTPUT: pixel coordinates {px, py}
  
  // Clamp to valid range
  x := clamp(x, 0, 1)
  y := clamp(y, 0, 1)
  
  // Get display info
  displays := getDisplayInfo()
  targetDisplay := displayIndex < displays.length ? displays[displayIndex] : displays[0]
  
  // Calculate pixel coordinates
  px := targetDisplay.offsetX + (x * targetDisplay.width)
  py := targetDisplay.offsetY + (y * targetDisplay.height)
  
  RETURN {px, py}
END FUNCTION
```

### 3. platform-adapter.ts (Platform-Specific Implementations)

**Responsibility**: Abstract OS-level input dispatch behind a unified interface.

**Interface**:
```typescript
interface PlatformAdapter {
  // Mouse actions
  mouseMove(x, y): Promise<void>;
  mouseClick(x, y, button='left'): Promise<void>;
  mouseDoubleClick(x, y): Promise<void>;
  mouseDrag(startX, startY, endX, endY): Promise<void>;
  mouseScroll(x, y, deltaY): Promise<void>;
  
  // Keyboard actions
  keyPress(keyCombo): Promise<void>;
  typeText(text): Promise<void>;
  
  // State queries
  getMousePosition(): Promise<{x, y}>;
  getActiveWindow(): Promise<string>;
}
```

**Implementation Strategy**:

**Windows (`platform-adapter-win.ts`)**:
- Use `robotjs` (npm package) for basic mouse/keyboard
- Fallback to `SendInput` via `node-ffi` or native add-on for advanced scenarios
- Support for key combinations, Unicode text

**macOS (`platform-adapter-mac.ts`)**:
- Use `robotjs` for compatibility
- Fallback to `CGEvent` via `node-ffi` for native API precision
- Support for keyboard modifiers (cmd, option, shift, ctrl)

**Linux (`platform-adapter-linux.ts`)**:
- Use `xdotool` via child_process for broad X11 support
- Fallback to X11 bindings (e.g., `node-xlib`) if available
- Support for key combinations

**Pseudocode**:
```
FUNCTION mouseClick(x, y, button)
  INPUT: pixel x, y, button name ('left', 'right', 'middle')
  OUTPUT: Promise that resolves when action sent to OS
  
  IF platform == 'win32' THEN
    RETURN robotjs.moveMouse(x, y).then(() => robotjs.mouseClick(button))
  ELSE IF platform == 'darwin' THEN
    RETURN robotjs.moveMouse(x, y).then(() => robotjs.mouseClick(button))
  ELSE IF platform == 'linux' THEN
    AWAIT exec(`xdotool mousemove ${x} ${y}`)
    AWAIT exec(`xdotool click 1`)
    RETURN
  END IF
END FUNCTION
```

### 4. keyboard-mapper.ts (Cross-Platform Key Name Mapping)

**Responsibility**: Normalize key names across platforms.

**Key Functions**:
- `mapKeyCombo(combo, platform) → NativeKeyCombo`: Map "ctrl+c" to platform equivalent
- `parseKeyCombo(combo) → KeyParts`: Parse "ctrl+shift+c" → {modifiers: ['ctrl', 'shift'], key: 'c'}

**Key Mapping Examples**:
```
"ctrl+c"        → Windows: "ctrl+c"    | macOS: "cmd+c"   | Linux: "ctrl+c"
"cmd+v"         → Windows: "ctrl+v"    | macOS: "cmd+v"   | Linux: "ctrl+v"
"alt+tab"       → Windows: "alt+tab"   | macOS: "alt+tab" | Linux: "alt+Tab"
"win+d"         → Windows: "win+d"     | macOS: N/A        | Linux: N/A
"super+d"       → Windows: "win+d"     | macOS: N/A        | Linux: "super+d"
```

**Pseudocode**:
```
FUNCTION mapKeyCombo(combo, platform)
  INPUT: combo like "ctrl+c", platform like "darwin" or "win32"
  OUTPUT: native key combo for platform
  
  parts := parseKeyCombo(combo)
  modifiers := parts.modifiers.map(m => platformModifierName(m, platform))
  key := platformKeyName(parts.key, platform)
  
  // Validate combo is legal on platform
  IF NOT isLegalCombo(modifiers, key, platform) THEN
    RAISE KeyCombinationError(combo, platform)
  END IF
  
  RETURN modifiers.join('+') + '+' + key
END FUNCTION
```

### 5. input-executor.ts (Queue, Rate Limiting, Retry)

**Responsibility**: Manage dispatch queue, rate limiting, and retry logic.

**Key Classes**:
- `InputQueue`: FIFO queue with rate limiting
- `RetryStrategy`: Exponential backoff on transient failures

**Key Functions**:
- `enqueue(step) → Promise<ExecutionResult>`: Add to queue, wait for slot
- `setRateLimit(minMs = 50)`: Set minimum delay between actions
- `canDispatch() → Promise<void>`: Block until next slot available
- `retry(fn, maxAttempts = 3, baseDelayMs = 100) → Promise`

**Data Structure**:
```typescript
interface InputQueueConfig {
  minDelayMs: number;        // Minimum between actions (default 50)
  maxQueueSize: number;      // Backpressure limit (default 100)
  maxRetries: number;        // Exponential backoff attempts (default 3)
  retryBaseMs: number;       // Base retry delay (default 100)
}
```

**Pseudocode**:
```
FUNCTION canDispatch()
  INPUT: none
  OUTPUT: Promise that resolves when next dispatch slot is available
  
  WHILE currentTime() - lastDispatchTime < minDelayMs DO
    delayMs := minDelayMs - (currentTime() - lastDispatchTime)
    AWAIT sleep(delayMs)
  END WHILE
END FUNCTION

FUNCTION retry(fn, maxAttempts, baseDelayMs)
  INPUT: fn is async function to retry, maxAttempts, baseDelayMs
  OUTPUT: Promise result of fn
  
  FOR attempt := 1 TO maxAttempts DO
    TRY
      RETURN AWAIT fn()
    CATCH error
      IF attempt < maxAttempts AND isTransientError(error) THEN
        delayMs := baseDelayMs * (2 ^ (attempt - 1))  // exponential backoff
        AWAIT sleep(delayMs)
      ELSE
        RAISE error
      END IF
    END TRY
  END FOR
END FUNCTION
```

### 6. input-executor.ts Continued (Error Handling)

**Error Type Hierarchy**:
```typescript
abstract class InputDispatchError extends Error {
  abstract category: 'permission' | 'coordinate' | 'platform' | 'key-combo' | 'transient';
  abstract isRetryable: boolean;
  step: WorkflowStep;
  timestamp: number;
}

class PermissionDeniedError extends InputDispatchError {
  category = 'permission';
  isRetryable = false;  // Cannot retry without user action
}

class CoordinateError extends InputDispatchError {
  category = 'coordinate';
  isRetryable = false;  // Invalid input, not transient
}

class PlatformUnavailableError extends InputDispatchError {
  category = 'platform';
  isRetryable = false;  // Platform feature missing
}

class KeyCombinationError extends InputDispatchError {
  category = 'key-combo';
  isRetryable = false;  // Invalid for platform
  suggestedAlternatives?: string[];
}

class TransientOSError extends InputDispatchError {
  category = 'transient';
  isRetryable = true;   // May succeed on retry
}
```

### 7. Modifications to dispatch-gate.ts

**Current Role**: Check GateBlock (avoid / stale) and return null or GateBlock.

**New Role**: Integrate with real dispatch to actually execute if gate allows.

**Changes**:
```typescript
// Current (gating only):
export function gateStep(step, k, rules, checkStale, now) → GateBlock | null

// New wrapper to integrate with dispatcher:
export async function gateAndDispatch(
  step: WorkflowStep,
  k: Knowledge,
  rules: AvoidRule[],
  platformAdapter: PlatformAdapter,
  displayInfo: DisplayInfo[]
): Promise<Performed> {
  const block = gateStep(step, k, rules, true, now);
  if (block) {
    return {
      ok: false,
      executed: false,
      halt: true,
      message: block.reason,
      target: { x: step.x, y: step.y }
    };
  }
  
  // Gate passed; proceed with real dispatch
  return inputDispatcher.dispatch(step);
}
```

## Type Definitions

### Performed Result Type

```typescript
interface HopOutcome {
  ok: boolean;                    // Action succeeded
  executed: boolean;              // Real input was sent (vs dry-run)
  message: string;                // Status or error message
  target: { x: number; y: number };  // Actual pixel coords used
  check?: {
    changed: boolean;             // Screen state changed after action
  };
  halt?: boolean;                 // Step failed; stop the workflow
  captured?: {
    beforeFrame?: Frame;          // Screenshot before action
    afterFrame?: Frame;           // Screenshot after action
  };
  drift?: {
    distance: number;             // Detected drift 0..1
    pixelDistance: number;        // Drift in pixels
    correctedX?: number;          // Adjusted coordinates
    correctedY?: number;
  };
  metadata?: {
    duration: number;             // Time from dispatch to completion (ms)
    platformSpecific?: Record<string, unknown>;
  };
}

// Alias for compatibility
type Performed = HopOutcome;
```

### GateBlock Integration

```typescript
interface GateBlock {
  kind: 'avoid' | 'stale';
  reason: string;
}

// Performed result when gate blocks:
{
  ok: false,
  executed: false,
  message: 'blocked by gate: ' + gateBlock.reason,
  halt: true,
  target: { x, y }
}
```

### DispatchState Type

```typescript
interface DispatchState {
  real: boolean;                  // Real dispatch active
  reason?: string;                // Why not real (e.g., "dry-run mode")
  mode: 'live' | 'dry-run' | 'paused' | 'preview';
  queueSize: number;              // Pending actions
  lastDispatch?: {
    time: number;
    step: WorkflowStep;
    result: Performed;
  };
}
```

## Integration Strategy

### 1. dispatch-gate.ts Integration

**Before**: `gateStep()` returns GateBlock or null; caller decides whether to dispatch.

**After**: `gateAndDispatch()` wrapper that gates + dispatches, or new dispatch system calls `gateStep()` first.

```typescript
// In input-dispatcher.ts
async function dispatchWorkflowStep(step, context) {
  const block = gateStep(step, context.knowledge, context.rules, true);
  if (block) {
    return refusedResult(block.reason);
  }
  
  // Real dispatch...
}
```

### 2. action-history.ts Integration

**Before**: Stores user-initiated actions manually recorded.

**After**: Dispatcher adds executed actions automatically.

```typescript
// In input-dispatcher.ts (after execution)
const actionRecord: ActionRecord = {
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
};

appendHistory([actionRecord]);
```

### 3. mirror-input.ts Integration

**Current**: Converts MirrorEvent → WorkflowStep.

**New**: MirrorStep can flow through real dispatch pipeline.

```typescript
// In mirror-input.ts
export function mirrorDispatch(ev: MirrorEvent, id: string, dispatcher): Promise<Performed> {
  const step = mirrorStep(ev, id);
  return dispatcher.dispatchWorkflowStep(step, context);
}
```

### 4. learning-system Integration

**Result feedback**:
- Success → Reinforce that target/action combination
- Failure → Penalize; may trigger replanning
- Drift detected → Update coordinate anchor

```typescript
// In input-dispatcher.ts (after recordResult)
if (performed.ok && performed.drift?.distance > 0.05) {
  // Significant drift; update learning anchors
  learningSystem.recordDrift(step.target, performed.drift.distance);
}

if (!performed.ok && performed.executed) {
  // Action failed after real dispatch
  learningSystem.recordFailure(step, performed.message);
}
```

### 5. Dry-Run Mode

**Implementation**:
```typescript
class InputDispatcher {
  private dryRun = false;
  
  async dispatchWorkflowStep(step, context) {
    if (this.dryRun) {
      return {
        ok: true,
        executed: false,
        message: 'dry-run: not dispatched',
        target: { x: step.x * displayWidth, y: step.y * displayHeight },
        dryRun: true
      };
    }
    // Real dispatch...
  }
  
  setDryRunMode(enabled: boolean) {
    this.dryRun = enabled;
  }
}
```

## Error Handling Flow

### Error Categories

| Category | Example | Retryable | Recovery |
|----------|---------|-----------|----------|
| **Permission** | Input blocked by OS security | No | Prompt user, escalate |
| **Coordinate** | Out of bounds, invalid screen | No | Clamp or re-ground |
| **Platform** | Feature not on this OS | No | Use fallback or fail |
| **Key Combo** | Invalid for platform | No | Suggest alternative |
| **Transient** | OS temporarily busy | Yes | Exponential backoff 1x, 2x, 4x |

### Retry Strategy

```
FOR attempt 1 to 3:
  TRY dispatch()
  ON transient error:
    IF attempt < 3 THEN
      waitMs := 100 * 2^(attempt-1)  // 100ms, 200ms, 400ms
      sleep(waitMs)
    ELSE
      return failed
    END IF
  ON hard error:
    return failed immediately
END FOR
```

### Error Recovery Examples

**Example 1: Coordinate Out of Bounds**
```
Input: normalized x=1.5, y=0.8
Clamped: x=1.0, y=0.8
Result: ok=true, executed=true (action at edge of screen)
```

**Example 2: Display Not Found**
```
Input: targetDisplay=2, but system has only 1 display
Fallback: use primary display (index 0)
Result: ok=true, executed=true (on different display)
Metadata: { displayMismatch: true, assumedDisplay: 0 }
```

**Example 3: Key Combo Invalid on Platform**
```
Input: "win+d" on macOS
Error: KeyCombinationError("win+d not available on macOS")
Suggestion: Use "cmd+d" instead
Result: ok=false, executed=false, halt=true
```

## Safety Considerations

### 1. Prevent Accidental System Harm

**Blacklist Strategy**:
- Maintain AvoidRule blacklist of dangerous targets:
  - `"Task Manager"`, `"Services.msc"`, `"Shutdown"` (Windows)
  - `"System Preferences" → "Startup Items"`, `"Force Quit"` (macOS)
  - System admin tools, power controls
  
- Planner must route around blacklist or request explicit approval

**Coordinate Validation**:
- Clamp all coordinates to display bounds
- Reject coordinates outside (0, 0) to (1, 1)

**Rate Limiting**:
- Min 50ms between actions (default)
- Max 100 actions/second
- Backpressure: refuse dispatch if queue exceeds size

### 2. User Approval Mechanisms

**For Sensitive Operations**:
```
IF targetMatches(['password', 'credential', 'secret']) THEN
  REQUIRE explicit user approval before dispatch
END IF
```

**For System Changes**:
```
IF targetMatches(['shutdown', 'restart', 'uninstall']) THEN
  REQUIRE confirmation: show step + screenshot, wait for user click
END IF
```

### 3. Dry-Run Mode

- Preview mode: all steps simulated, no real input
- Watch mode: dispatcher paused; user can review before permitting resume
- Test mode: real dispatch on controlled test VM

## Testing Strategy

### Mock OS API Layer

**Unit Tests** (mock Platform Adapter):
```typescript
// In platform-adapter.spec.ts
const mockAdapter: PlatformAdapter = {
  mouseClick: jest.fn().mockResolvedValue(void 0),
  keyPress: jest.fn().mockResolvedValue(void 0),
  typeText: jest.fn().mockResolvedValue(void 0),
  // ...
};

test('dispatch click calls platform adapter', async () => {
  const step = { id: '1', action: 'click', x: 0.5, y: 0.5 };
  await dispatcher.dispatchWorkflowStep(step, { adapter: mockAdapter });
  expect(mockAdapter.mouseClick).toHaveBeenCalledWith(960, 540); // 50% of 1920×1080
});
```

### Integration Tests

**Multi-Platform Testing**:
- Windows: Test `robotjs` integration, key combinations
- macOS: Test CGEvent fallback, cmd key handling
- Linux: Test `xdotool`, X11 coordinate model

**Dry-Run Verification**:
```typescript
test('dry-run mode does not call platform adapter', async () => {
  dispatcher.setDryRunMode(true);
  const result = await dispatcher.dispatchWorkflowStep(step, context);
  expect(mockAdapter.mouseClick).not.toHaveBeenCalled();
  expect(result.executed).toBe(false);
  expect(result.dryRun).toBe(true);
});
```

### Integration Test Approach

1. **Coordinate Translation**: Test norm→pixel conversion on varied resolutions
2. **Multi-Monitor**: Test on multi-monitor setup (or mock DisplayInfo)
3. **Queue & Rate Limiting**: Test backpressure, timing consistency
4. **Error Recovery**: Inject transient failures, verify retry & backoff
5. **Safety Gates**: Test blacklist blocking, stale coordinate detection
6. **Action Recording**: Verify action-history entries created with correct metadata

### Platform-Specific Tests

**Windows**:
- Test key combinations (alt+F4, ctrl+shift+esc)
- Test Unicode text input (Chinese, emoji)
- Test multi-monitor coordinate translation

**macOS**:
- Test cmd key mapping (cmd+c → ctrl+c on Windows)
- Test Cmd+Tab application switching
- Test Retina display scaling

**Linux**:
- Test xdotool availability fallback
- Test keyboard layouts (QWERTY vs others)
- Test window focus behavior

## Performance Considerations

### 1. Coordinate Translation Caching

**Optimization**: Cache DisplayInfo to avoid repeated system calls.
```typescript
class CoordinateTranslator {
  private displayCache: DisplayInfo[] | null = null;
  private displayCacheTime = 0;
  private displayCacheTTL = 5000; // 5 seconds
  
  getDisplayInfo(): DisplayInfo[] {
    if (this.displayCacheTime + this.displayCacheTTL > Date.now()) {
      return this.displayCache!;
    }
    // System call to enumerate displays
    this.displayCache = queryDisplays();
    this.displayCacheTime = Date.now();
    return this.displayCache;
  }
}
```

### 2. Dispatch Queue Sizing

- Default max queue size: 100 steps
- On backpressure (queue full), planner is notified to slow down
- Tune based on average action duration (typically 50–200ms)

### 3. Timing Between Sequential Actions

- Minimum: 50ms (OS needs time to process)
- Recommended: 100ms (allows UI to update)
- Configurable per workflow for reliability

**Example**:
```
[Click button] → wait 100ms → [Wait for dialog] → wait 50ms → [Click OK]
```

### 4. Memory Usage with Action Recording

**Action History Storage**:
- Each action record: ~500 bytes (with metadata, screenshots excluded)
- Keep recent 1000 records in memory: ~500KB
- Older records archived to IndexedDB/localStorage

**Screenshot Storage**:
- Captured only when needed (verification, learning)
- Store as compressed JPEG data URLs (~30KB each)
- Limit to recent 20 frames in memory

## State Management

### Execution State

```typescript
interface ExecutionState {
  currentStep?: WorkflowStep;
  status: 'idle' | 'pending' | 'executing' | 'completed' | 'failed' | 'paused';
  reason?: string;           // Why paused
  
  // Tracking
  startTime?: number;
  endTime?: number;
  retryCount: number;
  lastError?: InputDispatchError;
  
  // Results
  performed?: Performed;
  actionRecord?: ActionRecord;
}
```

### Mouse and Keyboard State

**Mouse Button State**:
- Track whether mouse button is currently pressed
- Prevent mismatched press/release sequences

```typescript
interface MouseState {
  pressed: Set<'left' | 'right' | 'middle'>;
  x: number;
  y: number;
  lastMoveTime: number;
}

// Before dispatch drag:
if (mouseState.pressed.size > 0) {
  // Stale press; release first
  await platformAdapter.mouseRelease();
  mouseState.pressed.clear();
}
```

**Keyboard Modifier State**:
- Track whether modifier keys (ctrl, alt, cmd, shift) are held
- Ensure they are released after key combo

```typescript
interface KeyboardState {
  modifiersHeld: Set<'ctrl' | 'alt' | 'cmd' | 'shift'>;
  lastModifierTime: number;
}

// After dispatch key combo:
if (keyboardState.modifiersHeld.size > 0) {
  // Release any lingering modifiers
  for (const mod of keyboardState.modifiersHeld) {
    await platformAdapter.keyRelease(mod);
  }
  keyboardState.modifiersHeld.clear();
}
```

---

## Fix Implementation

### Changes Required

The Input Dispatch System is implemented as a collection of new modules that integrate with existing dispatcher, gate, and history systems.

**File**: Multiple new files in `droid-assist-prototype/`

**Modules to Create**:

1. **input-dispatcher.ts** (Core orchestrator)
   - Main entry point: `dispatchWorkflowStep(step, context) → Promise<Performed>`
   - Batch dispatch: `dispatch(steps[], context) → Promise<Performed[]>`
   - Mode control: `setDryRunMode(enabled: boolean)`, `getDispatchState()`
   - Implementation: Calls gateStep() → translateCoordinates() → queue() → execute() → recordResult()

2. **coordinate-translator.ts** (Normalize → Pixel)
   - Functions: `normalizedToPixels()`, `pixelsToNormalized()`, `getDisplayInfo()`
   - Handles multi-monitor offsets, clamping, display fallback
   - Caches DisplayInfo with 5-second TTL
   - Updates `WorkflowStep.correctedX/Y` with pixel coordinates

3. **platform-adapter.ts** (Interface)
   - Abstract interface: `PlatformAdapter` with mouse/keyboard methods
   - Implementations:
     - `platform-adapter-win.ts`: Windows with robotjs, fallback to node-ffi
     - `platform-adapter-mac.ts`: macOS with robotjs, fallback to CGEvent
     - `platform-adapter-linux.ts`: Linux with xdotool, fallback to X11 bindings
   - Factory: `createPlatformAdapter() → PlatformAdapter`

4. **keyboard-mapper.ts** (Cross-Platform Key Names)
   - Functions: `mapKeyCombo(combo, platform)`, `parseKeyCombo()`
   - Mapping table: "ctrl+c" ↔ platform equivalents (cmd on macOS)
   - Validation: `isLegalCombo(modifiers, key, platform)`
   - Error: Raise `KeyCombinationError` with suggestions

5. **input-executor.ts** (Queue, Rate Limiting, Retry)
   - Class: `InputQueue` with rate limiting, backpressure
   - Methods: `enqueue()`, `canDispatch()`, `setRateLimit()`
   - Retry logic: `retry(fn, maxAttempts, baseDelayMs)` with exponential backoff
   - Error classification: Distinguish transient vs hard failures

6. **input-errors.ts** (Error Hierarchy)
   - Base class: `InputDispatchError` (category, isRetryable, step, timestamp)
   - Subclasses: `PermissionDeniedError`, `CoordinateError`, `PlatformUnavailableError`, `KeyCombinationError`, `TransientOSError`
   - Utilities: `isTransientError()`, `getErrorRecoveryStrategy()`

**Modifications to Existing Files**:

1. **dispatch-gate.ts**
   - Add: `gateAndDispatch()` wrapper function (optional; dispatcher can call `gateStep()` directly)
   - No breaking changes to existing `gateStep()` interface

2. **action-history.ts**
   - Add: Function to convert `Performed → ActionRecord` for automatic recording
   - Support: Recording dispatcher-initiated actions (source='Automation')
   - No breaking changes to existing append/load functions

3. **types.ts**
   - Add: `DispatchState` interface (real, reason, mode, queueSize, lastDispatch)
   - Enhance: `Performed` result type (or alias `HopOutcome`) with drift, metadata fields
   - Ensure: `ActionRecord` has `dispatched` and `dryRun` fields

### Implementation Strategy

**Phase 1: Foundational Modules**
1. Define types: `DispatchState`, error hierarchy, `DisplayInfo`
2. Implement `coordinate-translator.ts` (no OS calls)
3. Implement `keyboard-mapper.ts` (lookup table, no OS calls)
4. Add unit tests with mocked OS calls

**Phase 2: Platform Abstraction**
1. Create `platform-adapter.ts` interface
2. Implement Windows adapter (robotjs)
3. Implement macOS adapter (robotjs + CGEvent fallback)
4. Implement Linux adapter (xdotool)
5. Create adapter factory to detect platform

**Phase 3: Dispatcher Core**
1. Implement `input-executor.ts` (queue, rate limiting, retry)
2. Implement `input-dispatcher.ts` (orchestration)
3. Integrate with `gateStep()` for safety validation
4. Integrate with `action-history` for result recording

**Phase 4: Integration**
1. Modify `dispatch-gate.ts` to call dispatcher (or leave as-is; planner calls dispatcher)
2. Add `Performed` to action-history recording
3. Connect learning system feedback
4. Test dry-run mode with `DispatchState.real = false`

### Key Design Decisions

1. **Platform Detection**: Use `process.platform` to select adapter
2. **Fallback Strategy**: Try primary library; fall back to alternative; fail with clear error
3. **Rate Limiting**: Default 50ms between actions; configurable per dispatcher instance
4. **Retry Policy**: Max 3 attempts; exponential backoff (100ms, 200ms, 400ms)
5. **Dry-Run Mode**: Global flag on dispatcher; affects all dispatches
6. **Error Reporting**: Include step, OS error, recovery suggestion in result
7. **State Cleanup**: Ensure mouse/keyboard state released after each action

---

## Correctness Properties

Property 1: Dispatch Gate Enforcement - Safety Before Execution

_For any_ WorkflowStep where the dispatch gate returns a GateBlock (blocked by blacklist or stale coordinates), the fixed input dispatcher SHALL refuse execution, returning a Performed result with ok=false, executed=false, and halt=true, preventing unsafe or stale input dispatch to the OS.

**Validates: Requirements 4.1, 4.2, 4.3**

Property 2: Coordinate Translation Accuracy - Normalized to Pixel Conversion

_For any_ WorkflowStep with normalized coordinates (0..1 range), the fixed dispatcher SHALL translate them to actual pixel coordinates based on the current display resolution and multi-monitor configuration, and dispatch input at the correct physical screen location.

**Validates: Requirements 2.1, 2.2, 3.1, 3.2**

Property 3: Cross-Platform Input Dispatch - OS-Level Actions

_For any_ action type (click, double_click, drag, scroll, key, type) dispatched on any supported platform (Windows, macOS, Linux), the dispatcher SHALL send the appropriate OS-level input event, causing the targeted application to receive and process the input correctly.

**Validates: Requirements 1.1, 1.2, 1.3, 3.1, 3.2**

Property 4: Result Recording and Feedback - Action History and Learning

_For any_ completed action (successful or failed), the dispatcher SHALL record the execution result to action-history with metadata (actual pixels, drift, screenshots, timestamp), and notify the learning system for pattern feedback and coordinate anchor updates.

**Validates: Requirements 5.1, 5.2, 5.3**

Property 5: Rate Limiting and Backpressure - Queue Management

_For any_ sequence of actions where dispatch rate exceeds the configured limit, the dispatcher SHALL apply rate limiting (minimum delay between actions, default 50ms) and backpressure (queue-full blocking), preventing OS overload and ensuring reliable action execution.

**Validates: Requirements 6.1, 6.2**

Property 6: Dry-Run Mode Simulation - Non-Destructive Dispatch

_When_ dry-run mode is enabled (preview, watch, or test modes), the dispatcher SHALL simulate all actions without sending real input to the OS, returning success results with executed=false and dryRun=true, allowing safe preview and testing.

**Validates: Requirements 4.3, 10.1**

