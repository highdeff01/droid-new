import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessPathsPanel } from './access-paths-panel.js';
import type { AssistEngine } from './use-assist.js';
import type { AccessProfile } from './access-paths.js';

afterEach(cleanup);

const profile: AccessProfile = {
  id: 'p1', target: 'Character 5', context: 'Game',
  versions: [
    { version: 2, uses: 4, successes: 3, savedAt: 2, lastUsed: 3, hops: [
      { label: 'Games', action: 'click', x: 0.1, y: 0.2 },
      { label: 'Custom Game', action: 'click', x: 0.3, y: 0.4 },
      { label: '5th slot', action: 'double_click', x: 0.5, y: 0.6 },
    ] },
    { version: 1, uses: 7, successes: 7, savedAt: 1, lastUsed: 1, hops: [{ label: '5th slot', action: 'click', x: 0.5, y: 0.5 }] },
  ],
};

function engineWith(accessPaths: AccessProfile[], editOk = true) {
  return {
    accessPaths, armed: false,
    editAccessPath: vi.fn(() => editOk), deleteAccessPath: vi.fn(), testAccessPath: vi.fn(async () => {}),
  } as unknown as AssistEngine & { editAccessPath: ReturnType<typeof vi.fn>; deleteAccessPath: ReturnType<typeof vi.fn>; testAccessPath: ReturnType<typeof vi.fn> };
}

describe('AccessPathsPanel', () => {
  it('lists each hop of the current path and the older versions with their frequency', () => {
    render(<AccessPathsPanel engine={engineWith([profile])} />);
    expect(screen.getByText('Games @ 10.0%, 20.0%')).toBeTruthy();
    expect(screen.getByText('5th slot @ 50.0%, 60.0% ×2')).toBeTruthy();
    expect(screen.getByText(/v2 · 3\/4 ok/)).toBeTruthy();
    expect(screen.getByText(/Older paths: v1 · 7\/7 ok/)).toBeTruthy();
  });

  it('wires Test run and delete to the engine', () => {
    const engine = engineWith([profile]);
    render(<AccessPathsPanel engine={engine} />);
    fireEvent.click(screen.getByText('Test run'));
    fireEvent.click(screen.getByLabelText('Delete path to Character 5'));
    expect(engine.testAccessPath).toHaveBeenCalledWith('p1');
    expect(engine.deleteAccessPath).toHaveBeenCalledWith('p1');
  });

  it('edits the path as one hop per line and saves it', () => {
    const engine = engineWith([profile]);
    render(<AccessPathsPanel engine={engine} />);
    fireEvent.click(screen.getByText('Edit'));
    const box = screen.getByLabelText('Path to Character 5') as HTMLTextAreaElement;
    expect(box.value.split('\n')).toHaveLength(3);
    fireEvent.change(box, { target: { value: 'Games @ 10%, 20%\n5th slot @ 55%, 60%' } });
    fireEvent.click(screen.getByText('Save path'));
    expect(engine.editAccessPath).toHaveBeenCalledWith('p1', 'Games @ 10%, 20%\n5th slot @ 55%, 60%');
    expect(screen.queryByLabelText('Path to Character 5')).toBeNull();
  });

  it('keeps the editor open with a hint when the edit is not a valid path', () => {
    render(<AccessPathsPanel engine={engineWith([profile], false)} />);
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Save path'));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByLabelText('Path to Character 5')).toBeTruthy();
  });

  it('says when there are no paths yet', () => {
    render(<AccessPathsPanel engine={engineWith([])} />);
    expect(screen.getByText('No access paths yet.')).toBeTruthy();
  });
});
