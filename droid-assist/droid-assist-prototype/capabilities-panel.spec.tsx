import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useAssist } from './use-assist.js';
import { CapabilitiesPanel } from './capabilities-panel.js';

describe('CapabilitiesPanel', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('lists every registered capability and reports invalid JSON parameters', () => {
    const { result } = renderHook(() => useAssist());
    render(<CapabilitiesPanel engine={result.current} />);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual([...result.current.capabilities.keys()]);
    fireEvent.change(screen.getByLabelText('Parameters (JSON)'), { target: { value: '{bad' } });
    fireEvent.click(screen.getByText('Invoke'));
    expect(result.current.log.some((l) => /not valid JSON/.test(l.message))).toBe(true);
  });
});
