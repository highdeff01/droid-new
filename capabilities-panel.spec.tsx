import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useAssist } from './use-assist.js';
import { ArtifactsPanel } from './capabilities-panel.js';

describe('ArtifactsPanel', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('lists every registered capability and reports invalid JSON parameters', () => {
    const { result } = renderHook(() => useAssist());
    render(<ArtifactsPanel engine={result.current} />);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual([...result.current.artifactCapabilities.keys()]);
    fireEvent.change(screen.getByLabelText('Parameters (JSON)'), { target: { value: '{bad' } });
    fireEvent.click(screen.getByText('Invoke'));
    expect(result.current.log.some((l) => /not valid JSON/.test(l.message))).toBe(true);
  });

  it('loads and renders persisted knowledge entries with missing or null notes without throwing', () => {
    localStorage.setItem('droid-assist.knowledge', JSON.stringify([
      { id: 'k1', kind: 'video', title: 'No notes field', time: 1 },
      { id: 'k2', kind: 'video', title: 'Null notes', time: 2, notes: null },
    ]));
    const { result } = renderHook(() => useAssist());
    expect(result.current.artifactKnowledge.map((k) => k.notes)).toEqual([[], []]);
    render(<ArtifactsPanel engine={result.current} />);
    expect(screen.getByText('No notes field')).toBeTruthy();
    expect(screen.getByText('Null notes')).toBeTruthy();
    expect(screen.getAllByText('No notes.')).toHaveLength(2);
  });

  it('renders an entry whose notes are missing at render time without throwing', () => {
    const { result } = renderHook(() => useAssist());
    const engine = { ...result.current, artifactKnowledge: [{ id: 'k3', kind: 'video', title: 'Raw', time: 3 }] } as unknown as typeof result.current;
    render(<ArtifactsPanel engine={engine} />);
    expect(screen.getByText('No notes.')).toBeTruthy();
  });

  it('shows the empty state when there is no knowledge', () => {
    const { result } = renderHook(() => useAssist());
    render(<ArtifactsPanel engine={result.current} />);
    expect(screen.getByText('No notes yet.')).toBeTruthy();
  });
});
