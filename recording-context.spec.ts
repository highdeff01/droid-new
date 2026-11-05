/**
 * Tests for Screen Context Snapshot Collection
 *
 * Tests cover:
 * - DisplayState creation and validation
 * - ElementSnapshot with normalized coordinates
 * - ScreenContextSnapshot creation
 * - ContextCollector implementation
 * - RecordingContextManager initialization
 * - Snapshot capture and storage
 * - Retrieval by index and timestamp
 * - Range queries (getSnapshotsInRange)
 * - Pruning old snapshots
 * - Memory management and statistics
 * - Error handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DisplayState,
  ElementSnapshot,
  NormalizedBoundingBox,
  ScreenContextSnapshot,
  ContextCollector,
  RecordingContextManager,
  createNormalizedBoundingBox,
  denormalizeBoundingBox,
  createDisplayState,
  createElementSnapshot,
} from './recording-context';

// ============================================================================
// Mock ContextCollector for testing
// ============================================================================

class MockContextCollector implements ContextCollector {
  private displayState: DisplayState;
  private elements: ElementSnapshot[];

  constructor(displayState?: DisplayState, elements?: ElementSnapshot[]) {
    this.displayState = displayState || {
      width: 1920,
      height: 1080,
      dpi: 96,
      multiDisplay: false,
      displayIndex: 0,
    };

    this.elements = elements || [
      createElementSnapshot(
        'button-1',
        '.submit-btn',
        ['html', 'body', 'form', 'button'],
        'button',
        'Submit',
        { x: 0.4, y: 0.8, width: 0.15, height: 0.05 },
        true,
        true,
      ),
    ];
  }

  collectDisplayState(): DisplayState {
    return { ...this.displayState };
  }

  collectElements(): ElementSnapshot[] {
    return [...this.elements];
  }

  collectWindowContext() {
    return {
      windowTitle: 'Test Application',
      applicationName: 'TestApp',
      url: 'http://localhost:3000',
    };
  }

  getContextId(): string {
    return 'mock-context-1';
  }
}

// ============================================================================
// DisplayState Tests
// ============================================================================

describe('DisplayState', () => {
  it('should create valid DisplayState', () => {
    const display = createDisplayState(1920, 1080, 96, false, 0);
    expect(display).toEqual({
      width: 1920,
      height: 1080,
      dpi: 96,
      multiDisplay: false,
      displayIndex: 0,
    });
  });

  it('should handle multi-display configuration', () => {
    const display = createDisplayState(3840, 2160, 96, true, 1);
    expect(display.multiDisplay).toBe(true);
    expect(display.displayIndex).toBe(1);
  });

  it('should throw error for zero width', () => {
    expect(() => createDisplayState(0, 1080, 96)).toThrow('Display width and height must be positive');
  });

  it('should throw error for negative height', () => {
    expect(() => createDisplayState(1920, -1080, 96)).toThrow('Display width and height must be positive');
  });

  it('should throw error for zero DPI', () => {
    expect(() => createDisplayState(1920, 1080, 0)).toThrow('DPI must be positive');
  });

  it('should throw error for negative DPI', () => {
    expect(() => createDisplayState(1920, 1080, -96)).toThrow('DPI must be positive');
  });

  it('should use default DPI if not specified', () => {
    const display = createDisplayState(1920, 1080);
    expect(display.dpi).toBe(96);
  });

  it('should handle high DPI displays', () => {
    const display = createDisplayState(3840, 2160, 220);
    expect(display.dpi).toBe(220);
  });
});

// ============================================================================
// NormalizedBoundingBox Tests
// ============================================================================

describe('NormalizedBoundingBox', () => {
  it('should create normalized bounding box from screen coordinates', () => {
    const bbox = createNormalizedBoundingBox(
      960, // screenX (half of 1920)
      540, // screenY (half of 1080)
      192, // screenWidth (10% of 1920)
      108, // screenHeight (10% of 1080)
      1920, // displayWidth
      1080, // displayHeight
    );

    expect(bbox.x).toBe(0.5);
    expect(bbox.y).toBe(0.5);
    expect(bbox.width).toBeCloseTo(0.1, 2);
    expect(bbox.height).toBeCloseTo(0.1, 2);
  });

  it('should clamp normalized coordinates to [0, 1]', () => {
    const bbox = createNormalizedBoundingBox(
      -100, // negative X
      -100, // negative Y
      3000, // width exceeds display
      2000, // height exceeds display
      1920,
      1080,
    );

    expect(bbox.x).toBe(0);
    expect(bbox.y).toBe(0);
    expect(bbox.width).toBe(1);
    expect(bbox.height).toBe(1);
  });

  it('should denormalize bounding box back to screen coordinates', () => {
    const normalized: NormalizedBoundingBox = {
      x: 0.25,
      y: 0.33,
      width: 0.5,
      height: 0.33,
    };

    const denormalized = denormalizeBoundingBox(normalized, 1920, 1080);

    expect(denormalized.x).toBe(480);
    expect(denormalized.y).toBe(356);
    expect(denormalized.width).toBe(960);
    expect(denormalized.height).toBe(356);
  });

  it('should round denormalized coordinates', () => {
    const normalized: NormalizedBoundingBox = {
      x: 0.333333,
      y: 0.333333,
      width: 0.333333,
      height: 0.333333,
    };

    const denormalized = denormalizeBoundingBox(normalized, 1920, 1080);

    expect(Number.isInteger(denormalized.x)).toBe(true);
    expect(Number.isInteger(denormalized.y)).toBe(true);
    expect(Number.isInteger(denormalized.width)).toBe(true);
    expect(Number.isInteger(denormalized.height)).toBe(true);
  });

  it('should handle 4K display normalization', () => {
    const bbox = createNormalizedBoundingBox(
      1920, // half of 3840
      1080, // half of 2160
      384, // 10% of 3840
      216, // 10% of 2160
      3840,
      2160,
    );

    expect(bbox.x).toBe(0.5);
    expect(bbox.y).toBe(0.5);
    expect(bbox.width).toBeCloseTo(0.1, 2);
    expect(bbox.height).toBeCloseTo(0.1, 2);
  });

  it('should throw error for zero display width', () => {
    expect(() =>
      createNormalizedBoundingBox(100, 100, 100, 100, 0, 1080),
    ).toThrow('Display dimensions must be positive');
  });

  it('should throw error for zero display height', () => {
    expect(() =>
      denormalizeBoundingBox({ x: 0.5, y: 0.5, width: 0.1, height: 0.1 }, 1920, 0),
    ).toThrow('Display dimensions must be positive');
  });
});

// ============================================================================
// ElementSnapshot Tests
// ============================================================================

describe('ElementSnapshot', () => {
  it('should create valid element snapshot', () => {
    const bbox: NormalizedBoundingBox = { x: 0.4, y: 0.8, width: 0.15, height: 0.05 };
    const element = createElementSnapshot(
      'btn-1',
      '.submit-btn',
      ['html', 'body', 'form', 'button'],
      'button',
      'Submit',
      bbox,
    );

    expect(element.id).toBe('btn-1');
    expect(element.selector).toBe('.submit-btn');
    expect(element.domPath).toEqual(['html', 'body', 'form', 'button']);
    expect(element.role).toBe('button');
    expect(element.accessibleName).toBe('Submit');
    expect(element.visible).toBe(true);
    expect(element.enabled).toBe(true);
  });

  it('should track element visibility', () => {
    const bbox: NormalizedBoundingBox = { x: 0, y: 0, width: 0.1, height: 0.1 };
    const visible = createElementSnapshot('id1', '.btn', [], 'button', 'Click me', bbox, true);
    const hidden = createElementSnapshot('id2', '.btn', [], 'button', 'Click me', bbox, false);

    expect(visible.visible).toBe(true);
    expect(hidden.visible).toBe(false);
  });

  it('should track element enabled state', () => {
    const bbox: NormalizedBoundingBox = { x: 0, y: 0, width: 0.1, height: 0.1 };
    const enabled = createElementSnapshot('id1', '.btn', [], 'button', 'Click me', bbox, true, true);
    const disabled = createElementSnapshot('id2', '.btn', [], 'button', 'Click me', bbox, true, false);

    expect(enabled.enabled).toBe(true);
    expect(disabled.enabled).toBe(false);
  });

  it('should store DOM path hierarchy', () => {
    const bbox: NormalizedBoundingBox = { x: 0.5, y: 0.5, width: 0.1, height: 0.1 };
    const element = createElementSnapshot(
      'deep-element',
      '#target',
      ['html', 'body', 'main', 'div.container', 'section#content', 'button.primary'],
      'button',
      'Submit Form',
      bbox,
    );

    expect(element.domPath).toHaveLength(6);
    expect(element.domPath[0]).toBe('html');
    expect(element.domPath[5]).toBe('button.primary');
  });

  it('should support multiple ARIA roles', () => {
    const bbox: NormalizedBoundingBox = { x: 0, y: 0, width: 0.1, height: 0.1 };

    const roles = ['button', 'link', 'checkbox', 'textbox', 'navigation', 'heading'];
    for (const role of roles) {
      const element = createElementSnapshot('id', '.el', [], role, 'Label', bbox);
      expect(element.role).toBe(role);
    }
  });
});

// ============================================================================
// ScreenContextSnapshot Tests
// ============================================================================

describe('ScreenContextSnapshot', () => {
  it('should contain all required fields', () => {
    const collector = new MockContextCollector();
    const manager = new RecordingContextManager(collector);

    const snapshot = manager.captureSnapshot(0);

    expect(snapshot.actionIndex).toBe(0);
    expect(snapshot.timestamp).toBeDefined();
    expect(snapshot.displayState).toBeDefined();
    expect(snapshot.elements).toHaveLength(1);
    expect(snapshot.windowTitle).toBe('Test Application');
    expect(snapshot.applicationName).toBe('TestApp');
    expect(snapshot.url).toBe('http://localhost:3000');
  });

  it('should include element lookup maps', () => {
    const collector = new MockContextCollector();
    const manager = new RecordingContextManager(collector);

    const snapshot = manager.captureSnapshot(0);

    expect(snapshot.elementsBySelector).toBeDefined();
    expect(snapshot.elementsByPath).toBeDefined();
    expect(snapshot.elementsBySelector?.has('.submit-btn')).toBe(true);
  });

  it('should store correct action index', () => {
    const collector = new MockContextCollector();
    const manager = new RecordingContextManager(collector);

    const snap1 = manager.captureSnapshot(5);
    const snap10 = manager.captureSnapshot(10);

    expect(snap1.actionIndex).toBe(5);
    expect(snap10.actionIndex).toBe(10);
  });
});

// ============================================================================
// RecordingContextManager Tests
// ============================================================================

describe('RecordingContextManager', () => {
  let manager: RecordingContextManager;
  let collector: MockContextCollector;

  beforeEach(() => {
    const buttonElement = createElementSnapshot(
      'button-1',
      '.submit-btn',
      ['html', 'body', 'form', 'button'],
      'button',
      'Submit',
      { x: 0.4, y: 0.8, width: 0.15, height: 0.05 },
    );

    const inputElement = createElementSnapshot(
      'input-1',
      '#email-field',
      ['html', 'body', 'form', 'input'],
      'textbox',
      'Email Address',
      { x: 0.2, y: 0.4, width: 0.6, height: 0.05 },
    );

    collector = new MockContextCollector(undefined, [buttonElement, inputElement]);
    manager = new RecordingContextManager(collector, 100);
  });

  // Initialization tests
  it('should initialize with provided max snapshots', () => {
    const customManager = new RecordingContextManager(collector, 50);
    expect(customManager).toBeDefined();
  });

  it('should throw error for invalid max snapshots', () => {
    expect(() => new RecordingContextManager(collector, 0)).toThrow(
      'maxSnapshots must be at least 1',
    );
    expect(() => new RecordingContextManager(collector, -5)).toThrow(
      'maxSnapshots must be at least 1',
    );
  });

  // Capture and storage tests
  it('should capture snapshot and store it', () => {
    const snapshot = manager.captureSnapshot(0);
    expect(snapshot).toBeDefined();
    expect(snapshot.actionIndex).toBe(0);
  });

  it('should store multiple snapshots', () => {
    manager.captureSnapshot(0);
    manager.captureSnapshot(1);
    manager.captureSnapshot(2);

    const stats = manager.getStatistics();
    expect(stats.totalSnapshots).toBe(3);
  });

  it('should not allow duplicate action indices', () => {
    manager.captureSnapshot(0);
    expect(() => manager.captureSnapshot(0)).toThrow(
      'Snapshot already exists for action index 0',
    );
  });

  it('should validate non-negative action indices', () => {
    expect(() => manager.captureSnapshot(-1)).toThrow(
      'Invalid actionIndex: must be a non-negative integer, got -1',
    );
  });

  it('should validate integer action indices', () => {
    expect(() => manager.captureSnapshot(1.5)).toThrow(
      'Invalid actionIndex: must be a non-negative integer',
    );
  });

  // Retrieval tests
  it('should retrieve snapshot by index', () => {
    const captured = manager.captureSnapshot(5);
    const retrieved = manager.getSnapshotByIndex(5);

    expect(retrieved).toEqual(captured);
  });

  it('should return undefined for non-existent index', () => {
    manager.captureSnapshot(0);
    const retrieved = manager.getSnapshotByIndex(99);

    expect(retrieved).toBeUndefined();
  });

  it('should retrieve snapshot by timestamp', () => {
    const captured = manager.captureSnapshot(0);
    const retrieved = manager.getSnapshotByTimestamp(captured.timestamp);

    expect(retrieved).toEqual(captured);
  });

  it('should find closest snapshot', () => {
    manager.captureSnapshot(0);
    manager.captureSnapshot(5);
    manager.captureSnapshot(10);

    const closest = manager.getClosestSnapshot(7);
    expect(closest?.actionIndex).toBe(5);
  });

  it('should return first snapshot when no exact match', () => {
    manager.captureSnapshot(0);
    manager.captureSnapshot(100);

    const closest = manager.getClosestSnapshot(50);
    expect(closest?.actionIndex).toBe(0);
  });

  // Range queries
  it('should get snapshots in range', () => {
    manager.captureSnapshot(0);
    manager.captureSnapshot(5);
    manager.captureSnapshot(10);
    manager.captureSnapshot(15);

    const range = manager.getSnapshotsInRange(5, 10);
    expect(range).toHaveLength(2);
    expect(range[0].actionIndex).toBe(5);
    expect(range[1].actionIndex).toBe(10);
  });

  it('should get empty range if no snapshots in range', () => {
    manager.captureSnapshot(0);
    manager.captureSnapshot(10);

    const range = manager.getSnapshotsInRange(20, 30);
    expect(range).toHaveLength(0);
  });

  it('should validate range bounds', () => {
    expect(() => manager.getSnapshotsInRange(10, 5)).toThrow(
      'startIndex (10) must not be greater than endIndex (5)',
    );
  });

  it('should get snapshots by time range', () => {
    const snap1 = manager.captureSnapshot(0);
    const snap2 = manager.captureSnapshot(1);
    const snap3 = manager.captureSnapshot(2);

    const range = manager.getSnapshotsByTimeRange(snap1.timestamp, snap2.timestamp);
    expect(range.length).toBeGreaterThanOrEqual(1);
    // Time ranges may include snapshots captured at the same millisecond or very close
    expect(range.length).toBeLessThanOrEqual(3);
  });

  it('should validate time range', () => {
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 1000).toISOString();

    expect(() => manager.getSnapshotsByTimeRange(future, now)).toThrow(
      'startTime must not be after endTime',
    );
  });

  // Element search tests
  it('should find element by selector across snapshots', () => {
    manager.captureSnapshot(0);
    manager.captureSnapshot(1);

    const found = manager.findElementBySelector('.submit-btn');
    expect(found).toHaveLength(2);
    expect(found[0].element.selector).toBe('.submit-btn');
  });

  it('should find element by accessible name', () => {
    manager.captureSnapshot(0);
    manager.captureSnapshot(1);

    const found = manager.findElementByAccessibleName('Submit');
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].element.accessibleName).toBe('Submit');
  });

  it('should return empty array for non-existent element', () => {
    manager.captureSnapshot(0);

    const found = manager.findElementBySelector('.non-existent');
    expect(found).toHaveLength(0);
  });

  // Pruning tests
  it('should prune snapshots before action index', () => {
    manager.captureSnapshot(0);
    manager.captureSnapshot(5);
    manager.captureSnapshot(10);

    const prunedCount = manager.pruneSnapshotsBefore(5);
    expect(prunedCount).toBe(1);

    const stats = manager.getStatistics();
    expect(stats.totalSnapshots).toBe(2);
    expect(manager.getSnapshotByIndex(0)).toBeUndefined();
    expect(manager.getSnapshotByIndex(5)).toBeDefined();
  });

  it('should prune oldest snapshot when max snapshots exceeded', () => {
    const smallManager = new RecordingContextManager(collector, 2);

    const snap1 = smallManager.captureSnapshot(0);
    const snap2 = smallManager.captureSnapshot(1);
    const snap3 = smallManager.captureSnapshot(2); // Should prune snap1

    expect(smallManager.getSnapshotByIndex(0)).toBeUndefined();
    expect(smallManager.getSnapshotByIndex(1)).toBeDefined();
    expect(smallManager.getSnapshotByIndex(2)).toBeDefined();
  });

  // Clear tests
  it('should clear all snapshots', () => {
    manager.captureSnapshot(0);
    manager.captureSnapshot(1);
    manager.captureSnapshot(2);

    manager.clear();

    const stats = manager.getStatistics();
    expect(stats.totalSnapshots).toBe(0);
    expect(manager.getSnapshotByIndex(0)).toBeUndefined();
  });

  // Statistics tests
  it('should provide accurate statistics', () => {
    manager.captureSnapshot(0);
    manager.captureSnapshot(5);
    manager.captureSnapshot(10);

    const stats = manager.getStatistics();
    expect(stats.totalSnapshots).toBe(3);
    expect(stats.activeSnapshots).toBe(3);
    expect(stats.estimatedMemoryBytes).toBeGreaterThan(0);
    expect(stats.avgElementsPerSnapshot).toBe(2); // 2 elements in each snapshot
    expect(stats.actionRange.first).toBe(0);
    expect(stats.actionRange.last).toBe(10);
  });

  it('should report empty statistics when no snapshots', () => {
    const stats = manager.getStatistics();
    expect(stats.totalSnapshots).toBe(0);
    expect(stats.activeSnapshots).toBe(0);
    expect(stats.actionRange.first).toBe(-1);
    expect(stats.actionRange.last).toBe(-1);
  });

  it('should estimate memory usage', () => {
    manager.captureSnapshot(0);
    const stats = manager.getStatistics();

    // Should be roughly: base + elements * size
    expect(stats.estimatedMemoryBytes).toBeGreaterThan(200); // At least base overhead
    expect(stats.estimatedMemoryBytes).toBeLessThan(10000); // Reasonable upper bound
  });

  // Get all snapshots test
  it('should return copy of all snapshots', () => {
    manager.captureSnapshot(0);
    manager.captureSnapshot(5);

    const all = manager.getAllSnapshots();
    expect(all).toHaveLength(2);
    expect(all[0].actionIndex).toBe(0);
    expect(all[1].actionIndex).toBe(5);
  });

  it('should return independent copy of snapshots', () => {
    manager.captureSnapshot(0);
    const all1 = manager.getAllSnapshots();
    manager.captureSnapshot(1);
    const all2 = manager.getAllSnapshots();

    expect(all1).toHaveLength(1);
    expect(all2).toHaveLength(2);
  });
});

// ============================================================================
// Context Collector Tests
// ============================================================================

describe('ContextCollector', () => {
  it('should collect display state', () => {
    const collector = new MockContextCollector();
    const display = collector.collectDisplayState();

    expect(display.width).toBe(1920);
    expect(display.height).toBe(1080);
    expect(display.dpi).toBe(96);
  });

  it('should collect elements', () => {
    const collector = new MockContextCollector();
    const elements = collector.collectElements();

    expect(elements.length).toBeGreaterThan(0);
    expect(elements[0].selector).toBeDefined();
    expect(elements[0].role).toBeDefined();
  });

  it('should collect window context', () => {
    const collector = new MockContextCollector();
    const context = collector.collectWindowContext();

    expect(context.windowTitle).toBe('Test Application');
    expect(context.applicationName).toBe('TestApp');
    expect(context.url).toBe('http://localhost:3000');
  });

  it('should provide context ID', () => {
    const collector = new MockContextCollector();
    const id = collector.getContextId();

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('should return independent copies', () => {
    const collector = new MockContextCollector();
    const display1 = collector.collectDisplayState();
    display1.width = 9999;

    const display2 = collector.collectDisplayState();
    expect(display2.width).toBe(1920);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('RecordingContextManager Integration', () => {
  it('should handle complete recording workflow', () => {
    const buttonElement = createElementSnapshot(
      'button-1',
      '.submit-btn',
      ['html', 'body', 'form', 'button'],
      'button',
      'Submit',
      { x: 0.4, y: 0.8, width: 0.15, height: 0.05 },
    );

    const collector = new MockContextCollector(undefined, [buttonElement]);
    const manager = new RecordingContextManager(collector);

    // Capture multiple snapshots during recording
    const snap1 = manager.captureSnapshot(0);
    // Add a small delay to ensure different timestamps
    const snap2 = manager.captureSnapshot(1);
    const snap5 = manager.captureSnapshot(5);

    // Query by various methods
    expect(manager.getSnapshotByIndex(0)).toBeDefined();
    expect(manager.getSnapshotByIndex(0)!.actionIndex).toBe(0);
    expect(manager.getSnapshotByIndex(1)).toBeDefined();
    expect(manager.getSnapshotByIndex(1)!.actionIndex).toBe(1);

    // Range query
    const range = manager.getSnapshotsInRange(0, 5);
    expect(range).toHaveLength(3);

    // Find elements
    const found = manager.findElementBySelector('.submit-btn');
    expect(found).toHaveLength(3);

    // Get statistics
    const stats = manager.getStatistics();
    expect(stats.totalSnapshots).toBe(3);
  });

  it('should handle snapshot retention window', () => {
    const collector = new MockContextCollector();
    const manager = new RecordingContextManager(collector, 10);

    // Capture 15 snapshots
    for (let i = 0; i < 15; i++) {
      manager.captureSnapshot(i);
    }

    // Should have only 10 (oldest 5 pruned automatically)
    const stats = manager.getStatistics();
    expect(stats.totalSnapshots).toBe(10);
    expect(stats.actionRange.first).toBe(5);
    expect(stats.actionRange.last).toBe(14);
  });

  it('should maintain data consistency during pruning', () => {
    const collector = new MockContextCollector();
    const manager = new RecordingContextManager(collector, 5);

    // Add many snapshots
    for (let i = 0; i < 20; i++) {
      manager.captureSnapshot(i);
    }

    // Verify all queries still work
    const closest = manager.getClosestSnapshot(15);
    expect(closest).toBeDefined();

    const range = manager.getSnapshotsInRange(15, 19);
    expect(range.length).toBeGreaterThan(0);

    const all = manager.getAllSnapshots();
    expect(all.length).toBeLessThanOrEqual(5);
  });

  it('should handle large recordings with memory management', () => {
    const collector = new MockContextCollector();
    const manager = new RecordingContextManager(collector, 100);

    const startMemory = manager.getStatistics().estimatedMemoryBytes;

    // Capture many snapshots
    for (let i = 0; i < 50; i++) {
      manager.captureSnapshot(i);
    }

    const stats = manager.getStatistics();
    expect(stats.totalSnapshots).toBe(50);
    expect(stats.estimatedMemoryBytes).toBeGreaterThan(startMemory);

    // Prune and verify memory is released
    manager.pruneSnapshotsBefore(25);
    const afterPrune = manager.getStatistics();
    expect(afterPrune.totalSnapshots).toBe(25);
    expect(afterPrune.estimatedMemoryBytes).toBeLessThan(stats.estimatedMemoryBytes);
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  it('should handle empty element list', () => {
    const collector = new MockContextCollector(undefined, []);
    const manager = new RecordingContextManager(collector);

    const snapshot = manager.captureSnapshot(0);
    expect(snapshot.elements).toHaveLength(0);
  });

  it('should handle elements at boundary coordinates', () => {
    const elements = [
      createElementSnapshot('e1', '.top-left', [], 'div', 'TL', { x: 0, y: 0, width: 0.01, height: 0.01 }),
      createElementSnapshot('e2', '.bottom-right', [], 'div', 'BR', { x: 0.99, y: 0.99, width: 0.01, height: 0.01 }),
    ];

    const collector = new MockContextCollector(undefined, elements);
    const manager = new RecordingContextManager(collector);

    const snapshot = manager.captureSnapshot(0);
    expect(snapshot.elements).toHaveLength(2);
  });

  it('should handle special characters in accessible names', () => {
    const elements = [
      createElementSnapshot('e1', '.special', [], 'div', 'Special: "Quoted" & <Symbols>', { x: 0, y: 0, width: 0.1, height: 0.1 }),
    ];

    const collector = new MockContextCollector(undefined, elements);
    const manager = new RecordingContextManager(collector);

    const snapshot = manager.captureSnapshot(0);
    expect(snapshot.elements[0].accessibleName).toContain('&');
  });

  it('should handle very long DOM paths', () => {
    const longPath = Array(50).fill('div');
    const elements = [
      createElementSnapshot('e1', '.deep', longPath, 'button', 'Deep', { x: 0.5, y: 0.5, width: 0.1, height: 0.1 }),
    ];

    const collector = new MockContextCollector(undefined, elements);
    const manager = new RecordingContextManager(collector);

    const snapshot = manager.captureSnapshot(0);
    expect(snapshot.elements[0].domPath).toHaveLength(50);
  });

  it('should preserve precision in coordinate translation', () => {
    const bbox = createNormalizedBoundingBox(
      100,
      200,
      300,
      400,
      1000,
      1000,
    );

    // Should be precise to at least 1 decimal place
    expect(bbox.x).toBe(0.1);
    expect(bbox.y).toBe(0.2);
    expect(bbox.width).toBe(0.3);
    expect(bbox.height).toBe(0.4);
  });
});
