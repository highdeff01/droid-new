/**
 * Cross-Reference Analyzer
 * 
 * Analyzes tasks and identifies:
 * - Feature connections
 * - Overlapping methods
 * - Interconnected components
 * - Potential conflicts
 * - Missing dependencies
 * 
 * Usage:
 * - Run on task files to find connections
 * - Generate dependency graphs
 * - Highlight interdependencies
 */

import fs from 'fs';
import path from 'path';
import type { Task } from '../types';

export interface CrossReference {
  task1: string;
  task2: string;
  connectionType: 'shared-module' | 'shared-data' | 'shared-event' | 'dependency' | 'overlap';
  sharedItems: string[];
  confidence: number;
}

export interface TaskAnalysis {
  taskId: string;
  title: string;
  status: string;
  modules: string[];
  events: string[];
  dependencies: string[];
  sharedWith: CrossReference[];
}

/**
 * Analyze a single task for cross-references
 */
export function analyzeTask(task: Task, allTasks: Task[]): TaskAnalysis {
  const analysis: TaskAnalysis = {
    taskId: task.id,
    title: task.title,
    status: task.status,
    modules: extractModules(task.text),
    events: extractEvents(task.text),
    dependencies: extractDependencies(task.text),
    sharedWith: [],
  };

  // Find connections to other tasks
  for (const otherTask of allTasks) {
    if (otherTask.id === task.id) continue;

    const crossRef = findCrossReference(task, otherTask);
    if (crossRef && crossRef.confidence > 0.3) {
      analysis.sharedWith.push(crossRef);
    }
  }

  return analysis;
}

/**
 * Find cross-references between two tasks
 */
export function findCrossReference(task1: Task, task2: Task): CrossReference | null {
  const modules1 = extractModules(task1.text);
  const modules2 = extractModules(task2.text);
  const events1 = extractEvents(task1.text);
  const events2 = extractEvents(task2.text);

  const sharedModules = modules1.filter(m => modules2.includes(m));
  const sharedEvents = events1.filter(e => events2.includes(e));

  if (sharedModules.length > 0 || sharedEvents.length > 0) {
    let connectionType: CrossReference['connectionType'] = 'overlap';
    let confidence = 0;

    if (sharedModules.length > 0) {
      connectionType = 'shared-module';
      confidence = sharedModules.length / Math.max(modules1.length, modules2.length);
    }

    if (sharedEvents.length > 0) {
      connectionType = 'shared-event';
      confidence = sharedEvents.length / Math.max(events1.length, events2.length);
    }

    return {
      task1: task1.id,
      task2: task2.id,
      connectionType,
      sharedItems: [...sharedModules, ...sharedEvents],
      confidence,
    };
  }

  return null;
}

/**
 * Extract modules from task text
 */
export function extractModules(text: string): string[] {
  const modulePatterns = [
    /(\w+)-(repository|integration|dispatcher|engine|handler)/gi,
    /import.*from.*['"](\w+)['"]/g,
    /export.*from.*['"](\w+)['"]/g,
  ];

  const modules = new Set<string>();

  for (const pattern of modulePatterns) {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(m => modules.add(m.replace(/['"]/g, '')));
    }
  }

  return Array.from(modules);
}

/**
 * Extract events from task text
 */
export function extractEvents(text: string): string[] {
  const eventPatterns = [
    /(\w+)Event/g,
    /Emit.*Event/g,
    /consume.*Event/g,
  ];

  const events = new Set<string>();

  for (const pattern of eventPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(m => events.add(m));
    }
  }

  return Array.from(events);
}

/**
 * Extract dependencies from task text
 */
export function extractDependencies(text: string): string[] {
  const dependencyPatterns = [
    /depends on.*\[(\d+\.\d+),.*\]/gi,
    /requires.*(\d+\.\d+)/gi,
    /import.*task.*\[(\d+\.\d+)\]/gi,
  ];

  const dependencies = new Set<string>();

  for (const pattern of dependencyPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(m => {
        const match = m.match(/(\d+\.\d+)/);
        if (match) {
          dependencies.add(match[1]);
        }
      });
    }
  }

  return Array.from(dependencies);
}

/**
 * Generate dependency graph
 */
export function generateDependencyGraph(tasks: Task[]): Record<string, string[]> {
  const graph: Record<string, string[]> = {};

  for (const task of tasks) {
    graph[task.id] = extractDependencies(task.text);
  }

  return graph;
}

/**
 * Find potential conflicts between tasks
 */
export function findConflicts(tasks: Task[]): CrossReference[] {
  const conflicts: CrossReference[] = [];

  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const crossRef = findCrossReference(tasks[i], tasks[j]);
      if (crossRef && crossRef.confidence > 0.7) {
        conflicts.push(crossRef);
      }
    }
  }

  return conflicts;
}
