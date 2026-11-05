/**
 * Input Dispatch System - Barrel Export
 *
 * Central export point for all input dispatch modules and types.
 *
 * @module input-dispatch
 */

// Main orchestrator
export { InputDispatcher, dispatchWorkflowStep, dispatch, setDryRunMode, getDispatchState } from '../input-dispatcher';

// Coordinate translation
export { CoordinateTranslator, getDisplayInfo, normalizedToPixels, pixelsToNormalized, translateCoordinates } from '../coordinate-translator';

// Keyboard mapping
export { KeyboardMapper, parseKeyCombo, platformModifierName, mapKeyCombo, isLegalCombo, type KeyParts } from '../keyboard-mapper';

// Input queue and executor
export { InputExecutor, InputQueue, retry, type InputQueueConfigInternal } from '../input-executor';

// Platform adapters
export { PlatformAdapterModule, PlatformAdapter, BasePlatformAdapter, getPlatformAdapter } from '../platform-adapter';
export { WindowsPlatformAdapter, getWindowsAdapter } from '../platform-adapter-win';
export { MacPlatformAdapter, getMacAdapter } from '../platform-adapter-mac';
export { LinuxPlatformAdapter, getLinuxAdapter } from '../platform-adapter-linux';

// Error types
export {
  InputErrors,
  InputDispatchError,
  PermissionDeniedError,
  CoordinateError,
  PlatformUnavailableError,
  KeyCombinationError,
  TransientOSError,
  ERROR_CODES,
  formatErrorMessage,
  type ErrorCategory
} from '../input-errors';

// Type definitions
export type {
  DisplayInfo,
  CoordinateTranslationResult,
  Performed,
  HopOutcome,
  DispatchState,
  InputQueueConfig,
  ExecutionState,
  MouseState,
  KeyboardState
} from '../types';

/**
 * Main public API for input dispatch
 */
export const InputDispatch = {
  // Dispatcher
  dispatchWorkflowStep,
  dispatch,
  setDryRunMode,
  getDispatchState,

  // Coordinate translation
  getDisplayInfo,
  normalizedToPixels,
  pixelsToNormalized,
  translateCoordinates,

  // Keyboard mapping
  parseKeyCombo,
  platformModifierName,
  mapKeyCombo,
  isLegalCombo,

  // Queue and executor
  InputQueue,
  retry,

  // Platform adapter factory
  getPlatformAdapter,

  // Error handling
  formatErrorMessage
};

export default InputDispatch;
