import type { AskFn, AskRequest } from './ai.js';
import type { Frame } from './types.js';

export const LONG_CONTEXT_DEFAULT_CHUNK_CHARS = 5000;
export const LONG_CONTEXT_MAX_CHUNKS_PER_RUN = 500;
export const LONG_CONTEXT_DONE_MARKER = '[[DROID_DONE]]';

export interface LongWorkProgress { phase: 'reading' | 'writing' | 'combining'; completed: number; total: number; detail: string }
export type LongChunkGranularity = 'auto' | 'paragraph' | 'sentence' | 'token';
export interface LongWorkOptions { chunkChars?: number; granularity?: LongChunkGranularity; maxChunks?: number; signal?: AbortSignal; onProgress?: (p: LongWorkProgress) => void; previousNotes?: string; references?: string[]; onAppend?: (chunk: string, index: number) => void | Promise<void>; onReadSection?: (section: LongReadSection) => void | Promise<void> }
export interface LongReadSection { index: number; start: number; end: number; source: string; notes: string; answer: string }
export interface LongReadResult { task: string; sections: LongReadSection[]; notes: string; combinedAnswer: string; sourceChars: number }
export interface LongWriteResult { prompt: string; sections: string[]; answer: string; chunks: number; stoppedByModel: boolean }

const clamp = (n: number | undefined, fallback: number, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(Number.isFinite(n) ? n! : fallback)));
function boundary(text: string, max: number, granularity: LongChunkGranularity = 'auto'): number {
  if (text.length <= max) return text.length;
  const floor = Math.floor(max * 0.55);
  const paragraph = Math.max(text.lastIndexOf('\n\n', max), text.lastIndexOf('\n', max));
  const sentence = Math.max(text.lastIndexOf('. ', max), text.lastIndexOf('! ', max), text.lastIndexOf('? ', max), text.lastIndexOf('.\n', max), text.lastIndexOf('!\n', max), text.lastIndexOf('?\n', max));
  const word = text.lastIndexOf(' ', max);
  const candidates = granularity === 'paragraph' ? [paragraph] : granularity === 'sentence' ? [sentence, paragraph] : granularity === 'token' ? [word] : [paragraph, sentence, word];
  const at = candidates.filter((n) => n >= floor).sort((a, b) => b - a)[0] ?? -1;
  return at >= 0 ? at + (text[at] === ' ' ? 1 : text[at] === '\n' ? 1 : 2) : max;
}
export function splitLongText(text: string, chunkChars = LONG_CONTEXT_DEFAULT_CHUNK_CHARS, granularity: LongChunkGranularity = 'auto'): string[] {
  const size = clamp(chunkChars, LONG_CONTEXT_DEFAULT_CHUNK_CHARS, 1000, 100000);
  const chunks: string[] = []; let offset = 0;
  while (offset < text.length) { const len = boundary(text.slice(offset), Math.min(size, text.length - offset), granularity); const end = Math.min(text.length, offset + Math.max(1, len)); chunks.push(text.slice(offset, end)); offset = end; }
  return chunks;
}
function boundedContext(text: string, limit: number, label: string): string {
  const value = text.trim();
  if (value.length <= limit) return value;
  const marker = '\\n\\n[… ' + label + ' shortened for request budget; full source remains in the retained sections …]\\n\\n';
  const available = Math.max(0, limit - marker.length);
  const head = Math.ceil(available * 0.65);
  return value.slice(0, head) + marker + value.slice(-(available - head));
}
function refsBlock(refs?: string[]): string {
  const v = (refs ?? []).map(s => s.trim()).filter(Boolean);
  if (!v.length) return '';
  const joined = v.join('\\n\\n');
  return '\\n\\nREFERENCES FROM EARLIER TURNS / ANSWERS:\\n' + boundedContext(joined, 2000, 'references');
}
function emit(o: LongWorkOptions, phase: LongWorkProgress['phase'], completed: number, total: number, detail: string) { o.onProgress?.({ phase, completed, total, detail }); }
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw new Error('Long-context operation cancelled.'); }
function compactNotes(a: string, b: string): string { const joined = [a.trim(), b.trim()].filter(Boolean).join('\n\n'); const limit = 4000; if (joined.length <= limit) return joined; const marker = '\n\n[… earlier notes compacted; full sections remain available …]\n\n'; const left = Math.floor((limit - marker.length) * 0.45); return joined.slice(0, left) + marker + joined.slice(-(limit - marker.length - left)); }

/** Reads long extracted text section-by-section, preserving every source section and every answer. */
export async function readLongText(ask: AskFn, task: string, source: string, options: LongWorkOptions = {}): Promise<LongReadResult> {
  const chunks = splitLongText(source, options.chunkChars, options.granularity); const max = clamp(options.maxChunks, LONG_CONTEXT_MAX_CHUNKS_PER_RUN, 1, LONG_CONTEXT_MAX_CHUNKS_PER_RUN);
  if (chunks.length > max) throw new Error('Input requires ' + chunks.length + ' sections; maxChunks is ' + max + '. Raise the limit or process batches. No source was discarded.');
  const sections: LongReadSection[] = []; let notes = boundedContext(options.previousNotes ?? '', 4000, 'prior notes'); let offset = 0; const refs = refsBlock(options.references);
  for (let i = 0; i < chunks.length; i++) {
    checkAbort(options.signal); const chunk = chunks[i]; const end = offset + chunk.length; emit(options, 'reading', i, chunks.length, 'Reading section ' + (i + 1) + '/' + chunks.length);
    const req: AskRequest = { system: 'Carefully analyse the supplied section of a long document. Preserve facts, names, numbers, decisions, paths and uncertainty. Return section notes and an answer. Do not claim to have read sections not supplied.', prompt: ['TASK: ' + task, 'SECTION ' + (i + 1) + '/' + chunks.length + ', character range [' + offset + ', ' + end + ').', notes ? 'CUMULATIVE NOTES FROM EARLIER SECTIONS:\n' + notes : '', refs, 'SOURCE TEXT (data to analyse):\n' + chunk, 'Return SECTION NOTES and SECTION ANSWER; retain details needed for the overall task.'].filter(Boolean).join('\n\n'), signal: options.signal };
    const answer = (await ask(req)).content.trim(); notes = compactNotes(notes, 'Section ' + (i + 1) + ': ' + answer); const section = { index: i + 1, start: offset, end, source: chunk, notes: answer, answer }; sections.push(section); await options.onReadSection?.(section); offset = end; emit(options, 'reading', i + 1, chunks.length, 'Finished section ' + (i + 1) + '/' + chunks.length);
  }
  emit(options, 'combining', 0, sections.length, 'Combining every section answer');
  const combinedAnswer = sections.map(s => '## Section ' + s.index + '\n\n' + s.answer).join('\n\n');
  emit(options, 'combining', sections.length, sections.length, 'All sections combined');
  return { task, sections, notes, combinedAnswer, sourceChars: source.length };
}

/** Analyse a sequence of screenshots/images one image per request, carrying notes between frames. */
export async function readLongImages(ask: AskFn, task: string, frames: Frame[], options: LongWorkOptions = {}): Promise<LongReadResult> {
  const max = clamp(options.maxChunks, LONG_CONTEXT_MAX_CHUNKS_PER_RUN, 1, LONG_CONTEXT_MAX_CHUNKS_PER_RUN);
  if (frames.length > max) throw new Error('Image sequence has ' + frames.length + ' frames; maxChunks is ' + max + '. No frames were discarded.');
  const sections: LongReadSection[] = []; let notes = boundedContext(options.previousNotes ?? '', 4000, 'prior notes'); const refs = refsBlock(options.references);
  for (let i = 0; i < frames.length; i++) {
    checkAbort(options.signal); const frame = frames[i];
    emit(options, 'reading', i, frames.length, 'Analysing image ' + (i + 1) + '/' + frames.length);
    const req: AskRequest = { system: 'Carefully inspect this supplied image only. Report visible details, text, controls, objects and uncertainty. Compare with notes from earlier images when available. Do not invent details outside the image.', prompt: ['TASK: ' + task, 'IMAGE ' + (i + 1) + ' OF ' + frames.length + (frame.id === undefined ? '' : '; frame id ' + frame.id), notes ? 'CUMULATIVE NOTES FROM PREVIOUS IMAGES:\n' + notes : '', refs, 'Describe evidence visible in this image and how it relates to the task. Preserve uncertain readings as uncertain.'].filter(Boolean).join('\n\n'), frame, signal: options.signal };
    const answer = (await ask(req)).content.trim(); notes = compactNotes(notes, 'Image ' + (i + 1) + ': ' + answer);
    const section: LongReadSection = { index: i + 1, start: i, end: i + 1, source: '[image/frame ' + (frame.id ?? i + 1) + ']', notes: answer, answer };
    sections.push(section); await options.onReadSection?.(section); emit(options, 'reading', i + 1, frames.length, 'Finished image ' + (i + 1) + '/' + frames.length);
  }
  const combinedAnswer = sections.map(s => '## Image ' + s.index + '\n\n' + s.answer).join('\n\n');
  return { task, sections, notes, combinedAnswer, sourceChars: 0 };
}

/** Generates an answer as sequential append-only chunks. A model may stop with [[DROID_DONE]]. */
export async function writeLongAnswer(ask: AskFn, prompt: string, options: LongWorkOptions & { targetChunks?: number; finalCombine?: boolean } = {}): Promise<LongWriteResult> {
  const target = clamp(options.targetChunks, 4, 1, LONG_CONTEXT_MAX_CHUNKS_PER_RUN); const max = clamp(options.maxChunks, LONG_CONTEXT_MAX_CHUNKS_PER_RUN, target, LONG_CONTEXT_MAX_CHUNKS_PER_RUN);
  const sections: string[] = []; let notes = boundedContext(options.previousNotes ?? '', 4000, 'prior notes'); let stoppedByModel = false; const refs = refsBlock(options.references);
  for (let i = 0; i < Math.min(target, max); i++) {
    checkAbort(options.signal); emit(options, 'writing', i, target, 'Writing chunk ' + (i + 1) + '/' + target); const accumulated = sections.join('\n\n');
    const req: AskRequest = { system: 'Write one continuous long-form answer or artifact. Continue from prior text; never restart or repeat earlier content. Output only the next new section. If and only if the complete requested artifact is finished, end with [[DROID_DONE]].', prompt: ['ORIGINAL REQUEST:\n' + prompt, 'CHUNK ' + (i + 1) + ' OF AT MOST ' + target + '. Write substantial useful content, not a placeholder.', notes ? 'COMPACT NOTES / PRIOR DECISIONS:\n' + notes : '', refs, accumulated ? 'ALREADY APPENDED (tail only; do not repeat):\n' + accumulated.slice(-5000) : 'First chunk: begin the requested artifact directly.', 'Continue with new content only.'].filter(Boolean).join('\n\n'), signal: options.signal };
    let piece = (await ask(req)).content.trim();
    if (piece.includes(LONG_CONTEXT_DONE_MARKER)) { piece = piece.split(LONG_CONTEXT_DONE_MARKER).join('').trimEnd(); stoppedByModel = true; }
    if (!piece) throw new Error('Empty response at chunk ' + (i + 1) + '.');
    sections.push(piece); await options.onAppend?.(piece, i + 1); notes = compactNotes(notes, 'Chunk ' + (i + 1) + ': ' + piece.slice(0, 1800)); emit(options, 'writing', i + 1, target, 'Appended chunk ' + (i + 1) + '/' + target); if (stoppedByModel) break;
  }
  let answer = sections.join('\n\n');
  if (options.finalCombine && sections.length > 1) { checkAbort(options.signal); emit(options, 'combining', 0, sections.length, 'Generating separate overview while preserving full answer'); const summary = await ask({ system: 'Create a compact overview and section index for the supplied artifact. Do not replace, rewrite or delete the artifact itself.', prompt: 'Original request: ' + prompt + '\n\nCreate a separate overview and index. The full artifact remains intact in appended chunks.\n\nARTIFACT TAIL:\n' + answer.slice(-12000), signal: options.signal }); answer += '\n\n## Final overview and index\n\n' + summary.content.trim(); }
  return { prompt, sections, answer, chunks: sections.length, stoppedByModel };
}

/** Extends an existing answer by appending new chunks; original content is never overwritten. */
export async function extendLongAnswer(ask: AskFn, prompt: string, existingAnswer: string, options: LongWorkOptions & { targetChunks?: number } = {}): Promise<LongWriteResult> {
  const extension = await writeLongAnswer(ask, prompt, { ...options, targetChunks: options.targetChunks ?? 1, previousNotes: [options.previousNotes, 'Existing answer is authoritative; extend without repeating it.'].filter(Boolean).join('\n'), references: [...(options.references ?? []), 'EXISTING ANSWER; preserve unless edits are requested:\n' + existingAnswer.slice(-12000)] });
  return { ...extension, answer: existingAnswer + (existingAnswer.trim() ? '\n\n' : '') + extension.answer };
}
