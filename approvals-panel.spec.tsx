import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalsPanel } from './approvals-panel.js';
import type { AssistEngine } from './use-assist.js';
import type { ApprovalBranch, ApprovalItem } from './approvals.js';
import { DEFAULT_OPERATION_POLICY } from './approvals.js';

afterEach(cleanup);

const pendingItem: ApprovalItem = {
  id: 'a1', time: Date.UTC(2030, 0, 1, 10, 0), requestedBy: 'Screen watcher', kind: 'operation', cls: 'admin_cmd',
  summary: 'Open PowerShell', context: 'during the Tidy downloads goal', goal: 'Tidy downloads', status: 'pending',
};

const staleItem: ApprovalItem = { ...pendingItem, id: 'a2', summary: 'Send report email', cls: 'email', stale: 'queued over 30 minutes — check it is still wanted' };

const decidedItem: ApprovalItem = { ...pendingItem, id: 'a3', summary: 'Edit hosts file', status: 'approved', decidedAt: Date.UTC(2030, 0, 1, 10, 5) };

function treeOf(items: ApprovalItem[]): ApprovalBranch[] {
  const tree: ApprovalBranch[] = [];
  for (const item of items.filter((i) => i.status === 'pending')) {
    let branch = tree.find((b) => b.requestedBy === item.requestedBy);
    if (!branch) tree.push((branch = { requestedBy: item.requestedBy, classes: [] }));
    let leaf = branch.classes.find((c) => c.cls === item.cls);
    if (!leaf) branch.classes.push((leaf = { cls: item.cls, items: [] }));
    leaf.items.push(item);
  }
  return tree;
}

function engineWith(approvals: ApprovalItem[]) {
  return {
    approvals, approvalTree: treeOf(approvals),
    approveItem: vi.fn(async () => {}), editItem: vi.fn(async () => {}), rejectItem: vi.fn(), runApprovalCheck: vi.fn(() => []),
    setOperationPolicy: vi.fn(),
    settings: { operationPolicy: DEFAULT_OPERATION_POLICY },
  } as unknown as AssistEngine & {
    approveItem: ReturnType<typeof vi.fn>; editItem: ReturnType<typeof vi.fn>; rejectItem: ReturnType<typeof vi.fn>;
    runApprovalCheck: ReturnType<typeof vi.fn>; setOperationPolicy: ReturnType<typeof vi.fn>;
  };
}

describe('ApprovalsPanel', () => {
  it('renders the tree grouped requester → class → item with summary, context and a stale flag', () => {
    const engine = engineWith([pendingItem, staleItem]);
    render(<ApprovalsPanel engine={engine} />);
    expect(screen.getByText('Screen watcher')).toBeTruthy();
    expect(screen.getAllByText('High-privilege command').length).toBeGreaterThan(0);
    expect(screen.getByText('Open PowerShell')).toBeTruthy();
    expect(screen.getAllByText(/during the Tidy downloads goal/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Stale: queued over 30 minutes/)).toBeTruthy();
  });

  it('shows "No pending approvals" when the tree is empty', () => {
    const engine = engineWith([]);
    render(<ApprovalsPanel engine={engine} />);
    expect(screen.getByText('No pending approvals')).toBeTruthy();
  });

  it('calls approveItem with the item id', () => {
    const engine = engineWith([pendingItem]);
    render(<ApprovalsPanel engine={engine} />);
    fireEvent.click(screen.getByLabelText('Approve Open PowerShell'));
    expect(engine.approveItem).toHaveBeenCalledWith('a1');
  });

  it('calls rejectItem with the item id', () => {
    const engine = engineWith([pendingItem]);
    render(<ApprovalsPanel engine={engine} />);
    fireEvent.click(screen.getByLabelText('Reject Open PowerShell'));
    expect(engine.rejectItem).toHaveBeenCalledWith('a1');
  });

  it('calls editItem with the item id and the edited text', () => {
    const engine = engineWith([pendingItem]);
    render(<ApprovalsPanel engine={engine} />);
    fireEvent.click(screen.getByLabelText('Edit Open PowerShell'));
    fireEvent.change(screen.getByLabelText('Edit Open PowerShell'), { target: { value: 'Open PowerShell as admin' } });
    fireEvent.click(screen.getByLabelText('Save edit Open PowerShell'));
    expect(engine.editItem).toHaveBeenCalledWith('a1', 'Open PowerShell as admin');
  });

  it('calls runApprovalCheck when Run check is clicked', () => {
    const engine = engineWith([pendingItem]);
    render(<ApprovalsPanel engine={engine} />);
    fireEvent.click(screen.getByLabelText('Run check'));
    expect(engine.runApprovalCheck).toHaveBeenCalled();
  });

  it('shows the last decided items with their status', () => {
    const engine = engineWith([decidedItem]);
    render(<ApprovalsPanel engine={engine} />);
    expect(screen.getByText(/Edit hosts file/)).toBeTruthy();
    expect(screen.getByText(/approved/)).toBeTruthy();
  });

  it('unchecking a class checkbox calls setOperationPolicy with allowedClasses without it', () => {
    const engine = engineWith([]);
    render(<ApprovalsPanel engine={engine} />);
    fireEvent.click(screen.getByLabelText('Sending email'));
    expect(engine.setOperationPolicy).toHaveBeenCalledWith({ allowedClasses: expect.not.arrayContaining(['email']) });
  });

  it('editing Project scope calls setOperationPolicy with the new scope', () => {
    const engine = engineWith([]);
    render(<ApprovalsPanel engine={engine} />);
    fireEvent.change(screen.getByLabelText('Project scope'), { target: { value: 'Tidy downloads' } });
    expect(engine.setOperationPolicy).toHaveBeenCalledWith({ scope: 'Tidy downloads' });
  });

  it('unchecking "Any time" calls setOperationPolicy with default allowed hours', () => {
    const engine = engineWith([]);
    render(<ApprovalsPanel engine={engine} />);
    fireEvent.click(screen.getByLabelText('Any time'));
    expect(engine.setOperationPolicy).toHaveBeenCalledWith({ hours: { start: 9, end: 17 } });
  });
});
