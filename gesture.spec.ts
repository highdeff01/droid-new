import { describe, expect, it } from 'vitest';
import { DRAG_THRESHOLD_PX, classifyGesture } from './gesture.js';

describe('classifyGesture', () => {
  it('treats travel under 6px as a click and 6px or more as a drag', () => {
    expect(DRAG_THRESHOLD_PX).toBe(6);
    expect(classifyGesture({ x: 0.5, y: 0.5 }, { x: 0.5 + 5.9 / 1000, y: 0.5 }, 1000, 500)).toBe('click');
    expect(classifyGesture({ x: 0.5, y: 0.5 }, { x: 0.5 + 6 / 1000, y: 0.5 }, 1000, 500)).toBe('drag');
  });

  it('measures travel in stage pixels on both axes', () => {
    // 3px across and 4px down on a 300×200 stage is 5px of travel: a click.
    expect(classifyGesture({ x: 0.1, y: 0.1 }, { x: 0.1 + 3 / 300, y: 0.1 + 4 / 200 }, 300, 200)).toBe('click');
    // 0.01 of a 1920px-wide stage is 19.2px: a drag.
    expect(classifyGesture({ x: 0.2, y: 0.2 }, { x: 0.21, y: 0.2 }, 1920, 1080)).toBe('drag');
    expect(classifyGesture({ x: 0.2, y: 0.2 }, { x: 0.2, y: 0.2 }, 1920, 1080)).toBe('click');
  });
});
