import { reviewGeneratedProject } from './generated-project-review.js';

export type GeneratedFileChangeKind = 'added' | 'modified' | 'unchanged' | 'removed';
export interface GeneratedFileChange { path: string; kind: GeneratedFileChangeKind; beforeLines: number; afterLines: number; addedLines: string[]; removedLines: string[]; }

/** Compare FILE:-formatted outputs without executing or mutating either one. */
export function getGeneratedProjectDiff(beforeOutput: string, afterOutput: string, maxChangedLines = 80): GeneratedFileChange[] {
  const before = new Map(reviewGeneratedProject(beforeOutput).files.map((file) => [file.path, file.content]));
  const after = new Map(reviewGeneratedProject(afterOutput).files.map((file) => [file.path, file.content]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const limit = Math.max(1, Math.min(500, Math.floor(maxChangedLines)));
  return paths.map((path) => {
    const oldText = before.get(path); const newText = after.get(path);
    const oldLines = oldText === undefined ? [] : oldText.split(/\r?\n/);
    const newLines = newText === undefined ? [] : newText.split(/\r?\n/);
    if (oldText === undefined) return { path, kind: 'added', beforeLines: 0, afterLines: newLines.length, addedLines: newLines.slice(0, limit), removedLines: [] };
    if (newText === undefined) return { path, kind: 'removed', beforeLines: oldLines.length, afterLines: 0, addedLines: [], removedLines: oldLines.slice(0, limit) };
    if (oldText === newText) return { path, kind: 'unchanged', beforeLines: oldLines.length, afterLines: newLines.length, addedLines: [], removedLines: [] };
    let prefix = 0;
    while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
    let oldEnd = oldLines.length - 1; let newEnd = newLines.length - 1;
    while (oldEnd >= prefix && newEnd >= prefix && oldLines[oldEnd] === newLines[newEnd]) { oldEnd--; newEnd--; }
    return { path, kind: 'modified', beforeLines: oldLines.length, afterLines: newLines.length, removedLines: oldLines.slice(prefix, oldEnd + 1).slice(0, limit), addedLines: newLines.slice(prefix, newEnd + 1).slice(0, limit) };
  });
}