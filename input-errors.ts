import type { WorkflowStep } from './types.js';

/**
 * Base class for input dispatch errors.
 * All input dispatch failures are categorized as one of these error types.
 */
export abstract class InputDispatchError extends Error {
  abstract readonly category: 'permission' | 'coordinate' | 'platform' | 'key-combo' | 'transient';
  abstract readonly isRetryable: boolean;
  readonly step: WorkflowStep;
  readonly timestamp: number;

  constructor(message: string, step: WorkflowStep) {
    super(message);
    this.step = step;
    this.timestamp = Date.now();
    Object.setPrototypeOf(this, InputDispatchError.prototype);
  }
}

export class PermissionDeniedError extends InputDispatchError {
  readonly category = 'permission' as const;
  readonly isRetryable = false;
  constructor(message: string, step: WorkflowStep) {
    super(message, step);
    Object.setPrototypeOf(this, PermissionDeniedError.prototype);
  }
}

export class CoordinateError extends InputDispatchError {
  readonly category = 'coordinate' as const;
  readonly isRetryable = false;
  readonly x?: number;
  readonly y?: number;

  constructor(message: string, step: WorkflowStep, x?: number, y?: number) {
    super(message, step);
    this.x = x;
    this.y = y;
    Object.setPrototypeOf(this, CoordinateError.prototype);
  }
}

export class PlatformUnavailableError extends InputDispatchError {
  readonly category = 'platform' as const;
  readonly isRetryable = false;
  readonly platform: string;

  constructor(message: string, step: WorkflowStep, platform: string) {
    super(message, step);
    this.platform = platform;
    Object.setPrototypeOf(this, PlatformUnavailableError.prototype);
  }
}

export class KeyCombinationError extends InputDispatchError {
  readonly category = 'key-combo' as const;
  readonly isRetryable = false;
  readonly combo: string;
  readonly suggestedAlternatives?: string[];

  constructor(message: string, step: WorkflowStep, combo: string, suggestedAlternatives?: string[]) {
    super(message, step);
    this.combo = combo;
    this.suggestedAlternatives = suggestedAlternatives;
    Object.setPrototypeOf(this, KeyCombinationError.prototype);
  }
}

export class TransientOSError extends InputDispatchError {
  readonly category = 'transient' as const;
  readonly isRetryable = true;

  constructor(message: string, step: WorkflowStep) {
    super(message, step);
    Object.setPrototypeOf(this, TransientOSError.prototype);
  }
}

export const ERROR_CODES = {
  ERR_PERM_DENIED: 'ERR_PERM_DENIED',
  ERR_COORD_INVALID: 'ERR_COORD_INVALID',
  ERR_COORD_OUT_OF_BOUNDS: 'ERR_COORD_OUT_OF_BOUNDS',
  ERR_PLATFORM_UNAVAILABLE: 'ERR_PLATFORM_UNAVAILABLE',
  ERR_KEY_COMBO_INVALID: 'ERR_KEY_COMBO_INVALID',
  ERR_TRANSIENT_OS: 'ERR_TRANSIENT_OS',
} as const;

export function formatErrorMessage(error: InputDispatchError): string {
  const context = `[${error.category.toUpperCase()}] target="${error.step.target ?? error.step.name}"`;
  return `${context}: ${error.message}`;
}
