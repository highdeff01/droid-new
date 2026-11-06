/**
 * Task Extraction GUI
 * 
 * Features:
 * - Copy text input area
 * - Task extraction from text
 * - Task distribution to AI agents
 * - Status tracking (in progress, completed, failed, not started)
 * - Cross-reference highlighting
 */

import { useState, useEffect } from 'react';
import { EventDispatcher, globalEventDispatcher } from '../event-dispatcher';

// Task status types
export type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'failed';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  agentAssigned?: string;
  filesCreated?: string[];
  lastUpdated?: string;
}

// AI Agent types
export type AgentType = 'general' | 'typescript' | 'react' | 'testing' | 'integration';

export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  status: 'idle' | 'busy' | 'error';
  tasksCompleted: number;
}

/**
 * Task Manager Hook
 */
export function useTaskManager() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<Agent[]>([
    { id: 'agent-1', name: 'Qwen3 Coder Next', type: 'general', status: 'idle', tasksCompleted: 0 },
    { id: 'agent-2', name: 'Qwen3 Coder', type: 'typescript', status: 'idle', tasksCompleted: 0 },
    { id: 'agent-3', name: 'React Expert', type: 'react', status: 'idle', tasksCompleted: 0 },
    { id: 'agent-4', name: 'Testing Agent', type: 'testing', status: 'idle', tasksCompleted: 0 },
  ]);

  // Load tasks from file
  useEffect(() => {
    const loadTasks = async () => {
      try {
        // Load from tasks.md or JSON
        const response = await fetch('/.kiro/specs/complete-automation-engine/tasks.json');
        if (response.ok) {
          const data = await response.json();
          setTasks(data.tasks);
        }
      } catch (error) {
        console.error('Failed to load tasks:', error);
      }
    };

    loadTasks();
  }, []);

  // Update task status
  const updateTaskStatus = (taskId: string, status: TaskStatus) => {
    setTasks(prev => prev.map(task => 
      task.id === taskId 
        ? { ...task, status, lastUpdated: new Date().toISOString() }
        : task
    ));
  };

  // Assign task to agent
  const assignTask = (taskId: string, agentId: string) => {
    setAgents(prev => prev.map(agent =>
      agent.id === agentId
        ? { ...agent, status: 'busy', tasksCompleted: agent.tasksCompleted + 1 }
        : agent
    ));
    updateTaskStatus(taskId, 'in_progress');
  };

  // Extract tasks from text
  const extractTasksFromText = (text: string): Task[] => {
    const taskPattern = /(-|\d+\.)\s*\[(.)\]\s*(.+?)(?=\n|$)/g;
    const extractedTasks: Task[] = [];

    let match;
    while ((match = taskPattern.exec(text)) !== null) {
      extractedTasks.push({
        id: match[3].match(/(\d+\.\d+)/)?.[0] || 	ask-,
        title: match[3].replace(/^[^:]+:\s*/, '').trim(),
        description: match[3],
        status: match[2] === 'x' ? 'completed' : 'not_started',
        agentAssigned: undefined,
        filesCreated: [],
      });
    }

    return extractedTasks;
  };

  // Get task statistics
  const getStats = () => {
    const completed = tasks.filter(t => t.status === 'completed').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const failed = tasks.filter(t => t.status === 'failed').length;
    const notStarted = tasks.filter(t => t.status === 'not_started').length;

    return {
      total: tasks.length,
      completed,
      inProgress,
      failed,
      notStarted,
      completionPercentage: Math.round((completed / tasks.length) * 100),
    };
  };

  return {
    tasks,
    agents,
    updateTaskStatus,
    assignTask,
    extractTasksFromText,
    getStats,
  };
}

/**
 * Cross-Reference Hook
 */
export function useCrossReference(tasks: Task[]) {
  const [connections, setConnections] = useState<Map<string, string[]>>(new Map());

  useEffect(() => {
    // Analyze task connections
    const connectionsMap = new Map<string, string[]>();

    for (const task of tasks) {
      const relatedTasks = findRelatedTasks(task, tasks);
      connectionsMap.set(task.id, relatedTasks);
    }

    setConnections(connectionsMap);
  }, [tasks]);

  const findRelatedTasks = (task: Task, allTasks: Task[]): string[] => {
    const related: string[] = [];

    for (const otherTask of allTasks) {
      if (task.id === otherTask.id) continue;

      // Check for shared keywords
      const sharedKeywords = getSharedKeywords(task.description, otherTask.description);
      if (sharedKeywords.length > 2) {
        related.push(otherTask.id);
      }
    }

    return related;
  };

  const getSharedKeywords = (text1: string, text2: string): string[] => {
    const keywords1 = new Set(text1.toLowerCase().split(/\s+/));
    const keywords2 = new Set(text2.toLowerCase().split(/\s+/));

    return Array.from(keywords1).filter(k => keywords2.has(k));
  };

  return { connections };
}
