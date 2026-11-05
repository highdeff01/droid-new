import type { WorkflowStep } from './types.js';
import type { PlatformAdapter } from './platform-adapter.js';
import { InputQueue } from './input-executor.js';
import { CoordinateTranslator, type DisplayInfo } from './coordinate-translator.js';
import { KeyboardMapper } from './keyboard-mapper.js';
import type { GateBlock } from './dispatch-gate.js';

export interface DispatchState {
  real: boolean;
  reason?: string;
  mode: 'live' | 'dry-run' | 'paused' | 'preview';
  queueSize: number;
}

export interface Performed {
  ok: boolean;
  executed: boolean;
  message: string;
  target: { x: number; y: number };
  halt?: boolean;
  drift?: { distance: number; pixelDistance: number };
  metadata?: Record<string, unknown>;
}

/**
 * Main input dispatch orchestrator.
 * Coordinates gating, translation, queuing, and execution of workflow steps.
 * Integrates with dispatch-gate, coordinate translation, platform adapters, and learning systems.
 */
export class InputDispatcher {
  private dryRunMode = false;
  private paused = false;
  private pauseReason: string | null = null;
  private inputQueue: InputQueue;
  private coordinateTranslator: CoordinateTranslator;
  private keyboardMapper: KeyboardMapper;
  private totalDispatched = 0;
  private totalSucceeded = 0;
  private totalFailed = 0;
  private dispatchGate: ((step: WorkflowStep) => GateBlock | null) | null = null;

  constructor(
    private platformAdapter?: PlatformAdapter,
    private displayInfo?: DisplayInfo[]
  ) {
    this.inputQueue = new InputQueue({
      minDelayMs: 50, // 50ms minimum between actions
      maxQueueSize: 100,
      maxRetries: 3,
      retryBaseMs: 100,
    });
    this.coordinateTranslator = new CoordinateTranslator();
    this.keyboardMapper = new KeyboardMapper();
  }

  /**
   * Toggle dry-run mode (simulation without real input).
   */
  setDryRunMode(enabled: boolean): void {
    this.dryRunMode = enabled;
  }

  /** Install the dispatch-time safety gate, or clear it with null. */
  setDispatchGate(gate: ((step: WorkflowStep) => GateBlock | null) | null): void {
    this.dispatchGate = gate;
  }

  /**
   * Pause dispatch operations.
   */
  pause(reason: string = 'User paused'): void {
    this.paused = true;
    this.pauseReason = reason;
  }

  /**
   * Resume dispatch operations.
   */
  resume(): void {
    this.paused = false;
    this.pauseReason = null;
  }

  /**
   * Dispatch a single workflow step.
   */
  async dispatchWorkflowStep(step: WorkflowStep): Promise<Performed> {
    this.totalDispatched++;

    // Check if paused
    if (this.paused) {
      return {
        ok: false,
        executed: false,
        message: `Dispatch paused${this.pauseReason ? `: ${this.pauseReason}` : ''}`,
        target: { x: step.x, y: step.y },
        halt: true,
      };
    }

    if (this.dispatchGate) {
      try {
        const block = this.dispatchGate(step);
        if (block) {
          this.totalFailed++;
          return {
            ok: false,
            executed: false,
            message: block.reason,
            target: { x: step.correctedX ?? step.x, y: step.correctedY ?? step.y },
            halt: true,
            metadata: { gate: block.kind },
          };
        }
      } catch (error) {
        this.totalFailed++;
        return {
          ok: false,
          executed: false,
          message: `Dispatch safety gate failed: ${error instanceof Error ? error.message : String(error)}`,
          target: { x: step.x, y: step.y },
          halt: true,
        };
      }
    }

    // Dry-run mode: simulate without real dispatch
    if (this.dryRunMode) {
      const displays = this.displayInfo || this.coordinateTranslator.getDisplayInfo();
      const { px, py } = this.coordinateTranslator.normalizedToPixels(step.x, step.y, step.displayIndex ?? 0, displays);
      return {
        ok: true,
        executed: false,
        message: 'dry-run: not dispatched',
        target: { x: px, y: py },
        metadata: { mode: 'dry-run' },
      };
    }

    if (!this.platformAdapter) {
      this.totalFailed++;
      return {
        ok: false,
        executed: false,
        message: 'No platform adapter configured — input was not sent',
        target: { x: step.x, y: step.y },
        halt: true,
      };
    }

    try {
      if (!(await this.platformAdapter.isAvailable())) {
        this.totalFailed++;
        return {
          ok: false,
          executed: false,
          message: 'Platform input is unavailable — input was not sent',
          target: { x: step.x, y: step.y },
          halt: true,
        };
      }
    } catch (error) {
      this.totalFailed++;
      return {
        ok: false,
        executed: false,
        message: `Could not check platform input availability: ${error instanceof Error ? error.message : String(error)}`,
        target: { x: step.x, y: step.y },
        halt: true,
      };
    }

    try {
      // Translate coordinates
      const displays = this.displayInfo || this.coordinateTranslator.getDisplayInfo();
      const translatedStep = this.coordinateTranslator.translateCoordinates(step, displays);

      // Queue and execute
      const performed = await this.inputQueue.enqueue(async () => {
        return this.executeStep(translatedStep);
      });

      if (performed.ok) {
        this.totalSucceeded++;
      } else {
        this.totalFailed++;
      }

      return performed;
    } catch (error) {
      this.totalFailed++;
      return {
        ok: false,
        executed: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        target: { x: step.x, y: step.y },
        halt: true,
      };
    }
  }

  /**
   * Execute a single step via the platform adapter.
   */
  private async executeStep(step: WorkflowStep): Promise<Performed> {
    const adapter = this.platformAdapter;
    if (!adapter) {
      return { ok: false, executed: false, message: 'No platform adapter configured — input was not sent', target: { x: step.correctedX ?? step.x, y: step.correctedY ?? step.y }, halt: true };
    }
    const startTime = Date.now();

    try {
      const x = step.correctedX ?? step.x;
      const y = step.correctedY ?? step.y;

      switch (step.action) {
        case 'move':
          await adapter.mouseMove(x, y);
          break;
        case 'click':
          await adapter.mouseClick(x, y, 'left');
          break;
        case 'double_click':
          await adapter.mouseDoubleClick(x, y);
          break;
        case 'drag':
          if (step.endX !== undefined && step.endY !== undefined) {
            await adapter.mouseDrag(x, y, step.endX, step.endY);
          } else {
            throw new Error('Drag requires endX and endY');
          }
          break;
        case 'scroll':
          await adapter.mouseScroll(x, y, step.text?.trim().toLowerCase() === 'up' ? -3 : 3);
          break;
        case 'type':
          if (step.text) {
            await adapter.typeText(step.text);
          } else {
            throw new Error('Type requires text');
          }
          break;
        case 'key':
          if (step.text) {
            const mappedCombo = this.keyboardMapper.mapKeyCombo(step.text, process.platform);
            await adapter.keyPress(mappedCombo);
          } else {
            throw new Error('Key requires key combination in text field');
          }
          break;
        default:
          throw new Error(`Unsupported action: ${step.action}`);
      }

      const duration = Date.now() - startTime;

      return {
        ok: true,
        executed: true,
        message: `${step.action} executed`,
        target: { x, y },
        metadata: { duration, action: step.action },
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      return {
        ok: false,
        executed: true,
        message: error instanceof Error ? error.message : 'Execution failed',
        target: { x: step.correctedX ?? step.x, y: step.correctedY ?? step.y },
        metadata: { duration, error: error instanceof Error ? error.message : String(error) },
        halt: true,
      };
    }
  }

  /**
   * Dispatch multiple workflow steps in order.
   */
  async dispatch(steps: WorkflowStep[]): Promise<Performed[]> {
    return Promise.all(steps.map(s => this.dispatchWorkflowStep(s)));
  }

  /**
   * Get current dispatch state.
   */
  getDispatchState(): DispatchState {
    return {
      real: !this.dryRunMode && !this.paused,
      reason: this.pauseReason ?? (this.dryRunMode ? 'dry-run mode' : undefined),
      mode: this.paused ? 'paused' : this.dryRunMode ? 'dry-run' : 'live',
      queueSize: this.inputQueue.getQueueSize(),
    };
  }

  /**
   * Get execution statistics.
   */
  getStats(): { total: number; succeeded: number; failed: number; successRate: number } {
    return {
      total: this.totalDispatched,
      succeeded: this.totalSucceeded,
      failed: this.totalFailed,
      successRate: this.totalDispatched > 0 ? this.totalSucceeded / this.totalDispatched : 0,
    };
  }

  /**
   * Set rate limit for actions.
   */
  setRateLimit(minMs: number): void {
    this.inputQueue.setRateLimit(minMs);
  }
}
