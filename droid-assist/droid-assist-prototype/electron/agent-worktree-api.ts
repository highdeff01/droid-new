import type { AgentCheckResult, AgentDiffResult, AgentWorktreeSnapshot, AgentWorktreeId } from './agent-worktrees.js';

export const AGENT_WORKTREE_CHANNELS = {
  chooseRepository: 'agent-worktree:choose-repository',
  prepare: 'agent-worktree:prepare',
  applyPatch: 'agent-worktree:apply-patch',
  runChecks: 'agent-worktree:run-checks',
  getDiff: 'agent-worktree:get-diff',
  commit: 'agent-worktree:commit',
  push: 'agent-worktree:push',
} as const;

export interface NativeAgentWorktreeApi {
  chooseRepository(): Promise<string | null>;
  prepare(repository: string, baseCommit?: string): Promise<AgentWorktreeSnapshot>;
  applyPatch(id: AgentWorktreeId, patch: string): Promise<{ applied: boolean; check: string; artifactPath: string }>;
  runChecks(id: AgentWorktreeId): Promise<AgentCheckResult[]>;
  getDiff(id: AgentWorktreeId): Promise<AgentDiffResult>;
  commit(id: AgentWorktreeId, paths: string[], message: string): Promise<string>;
  push(id: AgentWorktreeId): Promise<string>;
}
