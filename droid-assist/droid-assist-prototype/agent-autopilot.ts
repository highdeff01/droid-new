import type { OpsAgentId } from './operations.js';

export const AUTO_OPS_INTERVAL_MS = 30_000;

const REVIEW_AGENTS: readonly OpsAgentId[] = ['monitor', 'logging', 'testing', 'recheck', 'loopControl', 'screenshots'];

export interface AutomaticOpsPlan {
  agents: OpsAgentId[];
  minimumCommands: number;
  fallbackTasks: Partial<Record<OpsAgentId, string>>;
}

export function automaticOpsPlan(
  enabled: readonly OpsAgentId[],
  options: { goal: string; hasFrame: boolean; candidate: string | null; hasApplied: boolean },
): AutomaticOpsPlan | null {
  if (!options.hasFrame) return null;
  const goal = options.goal.trim() || 'the current screen and recent work';
  const fallbackTasks: Partial<Record<OpsAgentId, string>> = {
    monitor: `Track the current screen and mapped elements for changes relevant to ${goal}`,
    logging: `Summarize recent activity and cross-reference prior operations relevant to ${goal}`,
    loopControl: 'Report which agent and verification stages are active, disabled, or waiting; do not change any stage',
    screenshots: `Capture a follow-up screenshot and report visible changes relevant to ${goal}`,
  };
  if (options.candidate) fallbackTasks.testing = `Background-only test "${options.candidate}" as a target relevant to ${goal}; do not dispatch input`;
  if (options.hasApplied) fallbackTasks.recheck = 'Recheck the most recent applied action against its before/after evidence and report whether the intended effect is visible';
  const agents = REVIEW_AGENTS.filter((id) => enabled.includes(id) && fallbackTasks[id]);
  if (!agents.length) return null;
  return { agents, minimumCommands: Math.ceil(agents.length / 2), fallbackTasks };
}
