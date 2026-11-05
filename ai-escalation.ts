import { AiCancelled, AiError, fallbackQuestion, truncateRaw, type AiReply, type ChatMessage } from './ai.js';
import { OVERLAP_PREFIX, firstValid } from './ai-overlap.js';

/**
 * The thinking-on escalation pipeline, in order: conversation update (the thinking appended to the
 * history, then varied retries), a similar question, an app-context re-ask, an overlapped pair of
 * fresh calls, and finally the thinking itself as a thinking-only answer.
 */
export type EscalationStage = 'conversation' | 'similar' | 'app-context' | 'overlap' | 'thinking-only';

/** Readable name of each stage, for the thinking timeline and the activity log. */
export const STAGE_LABEL: Record<EscalationStage, string> = {
  conversation: 'Conversation update',
  similar: 'Similar question',
  'app-context': 'App-context re-ask',
  overlap: 'Overlap AI',
  'thinking-only': 'Thinking only',
};

/** One attempt of the pipeline: which stage, whether it produced content, what happened and the thinking it returned. */
export interface EscalationEvent {
  stage: EscalationStage;
  ok: boolean;
  detail: string;
  thinking: string | null;
}

/** More material from the app for the app-context re-ask: text sections and a fresh screenshot (data URL). */
export interface AppContext {
  sections: string[];
  frame?: string | null;
}

/** What the session supplies to escalate: the app-context provider and the per-attempt reporter. */
export interface EscalationHooks {
  appContext?: () => Promise<AppContext>;
  onStage?: (event: EscalationEvent) => void;
}

/** One model call of the pipeline; `signal` lets the overlap race cancel its loser. */
export type EscalationSend = (messages: ChatMessage[], signal?: AbortSignal) => Promise<AiReply>;

/** Prepended to every conversation-update retry: answer now, building on the thinking already done. */
const BUILD_ON = 'You already thought this through (your thinking is above). Building on it, answer in the message content now.';

/** The conversation-update retries: rephrased direct ask, short direct answer, then JSON only (or a one-line final answer). */
export function conversationPrompts(json: boolean): string[] {
  return [
    `${BUILD_ON} Restate the question in one line, then give your answer directly.`,
    `${BUILD_ON} Short and direct: one or two sentences, no more reasoning.`,
    json ? `${BUILD_ON} Reply with exactly one JSON object holding your answer and nothing else.` : `${BUILD_ON} Give only your final answer, in one line.`,
  ];
}

/** Opens the app-context re-ask. */
export const APP_CONTEXT_PROMPT = 'Here is more information from the app right now (a fresh screenshot is attached when available). Use it and answer the original question in the message content.';

/** Opens the fresh second call of the overlap stage. */
export const OVERLAP_FRESH_PROMPT = 'Fresh start — ignore any earlier attempt and answer in the message content now.';

/** The text sections of the app context; empty lists are left out. */
export function appContextSections(input: { goal: string; steps: string[]; elements: string[]; log: string[]; habits: string[] }): string[] {
  const list = (title: string, items: string[]) => (items.length ? [`${title}:\n${items.join('\n')}`] : []);
  return [
    ...(input.goal.trim() ? [`Current goal: ${input.goal.trim()}`] : []),
    ...list('Workflow steps', input.steps),
    ...list('Mapped elements', input.elements),
    ...list('Recent log (newest first)', input.log),
    ...list('Habit / position memory', input.habits),
  ];
}

/** The next goal to try, derived from the thinking's last statement and the current goal. */
export function suggestedGoal(thinking: string, goal: string): string {
  const sentences = thinking.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const idea = truncateRaw(sentences.at(-1) ?? thinking).replace(/[.!?]+$/, '');
  return goal.trim() ? `${goal.trim()} — next: ${idea}` : idea;
}

/** The thinking-only notice: labelled, plain that content was never produced, with the thinking shown as the response. */
export function escalationNotice(thinking: string): string {
  return `Thinking only — content was never produced (conversation update, similar question, app-context re-ask and overlap all returned thinking only). Showing the model's thinking as the response: ${truncateRaw(thinking)}`;
}

/** The last user question of `messages`. */
const lastQuestion = (messages: ChatMessage[]) => [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

/** A data URL as bare base64. */
const bare = (url: string) => url.slice(url.indexOf(',') + 1);

/** Runs the escalation pipeline after a thinking-only first reply. */
export async function escalate(send: EscalationSend, messages: ChatMessage[], json: boolean, firstThinking: string, hooks: EscalationHooks): Promise<AiReply> {
  const run = new Escalation(send, messages, json, firstThinking, hooks);
  return (await run.conversation()) ?? (await run.similar()) ?? (await run.appContext()) ?? (await run.overlap()) ?? run.thinkingOnly();
}

/** The state of one escalation: the latest thinking and the history with that thinking appended. */
class Escalation {
  private thinking: string;

  constructor(
    private readonly send: EscalationSend,
    private readonly messages: ChatMessage[],
    private readonly json: boolean,
    firstThinking: string,
    private readonly hooks: EscalationHooks,
  ) {
    this.thinking = firstThinking;
  }

  /** The history with the model's thinking appended as its own context turn. */
  private updated(): ChatMessage[] {
    return [...this.messages, { role: 'assistant', content: `(My thinking so far — not yet answered in content)\n${this.thinking}` }];
  }

  private report(stage: EscalationStage, ok: boolean, detail: string, thinking: string | null) {
    this.hooks.onStage?.({ stage, ok, detail, thinking });
  }

  /** One attempt: the reply when it has content (reported ok), else null with its thinking kept; a non-cancel failure is reported and null. */
  private async attempt(stage: EscalationStage, label: string, messages: ChatMessage[]): Promise<AiReply | null> {
    try {
      const reply = await this.send(messages);
      this.thinking = reply.thinking ?? this.thinking;
      if (reply.content) {
        this.report(stage, true, `${label}: answered in content`, reply.thinking);
        return { content: reply.content, thinking: reply.thinking ?? this.thinking, answeredBy: stage };
      }
      this.report(stage, false, `${label}: thinking only, no content`, reply.thinking);
    } catch (error) {
      if (error instanceof AiCancelled || !(error instanceof AiError)) throw error;
      this.report(stage, false, `${label}: failed — ${error.message}`, null);
    }
    return null;
  }

  /** a. The thinking appended to the conversation, then up to three varied retries. */
  async conversation(): Promise<AiReply | null> {
    const prompts = conversationPrompts(this.json);
    for (const [i, prompt] of prompts.entries()) {
      const reply = await this.attempt('conversation', `Conversation update retry ${i + 1}/${prompts.length}`, [...this.updated(), { role: 'user', content: prompt }]);
      if (reply) return reply;
    }
    return null;
  }

  /** b. A simplified, related question; an answer is a noted substitution. */
  async similar(): Promise<AiReply | null> {
    const reply = await this.attempt('similar', 'Similar question', fallbackQuestion(this.messages));
    if (reply) this.report('similar', true, 'Answered a similar, simpler question instead — its answer is substituted for the original', reply.thinking);
    return reply;
  }

  /** c. The original question re-asked with fresh app context: screenshot, elements, log, goal/steps and habits. */
  async appContext(): Promise<AiReply | null> {
    const ctx = await this.hooks.appContext?.().catch(() => null);
    if (!ctx || (!ctx.sections.length && !ctx.frame)) {
      this.report('app-context', false, 'App-context re-ask skipped: no app context available', null);
      return null;
    }
    const content = [APP_CONTEXT_PROMPT, ...ctx.sections, `Original question:\n${lastQuestion(this.messages)}`].join('\n\n');
    const user: ChatMessage = { role: 'user', content, ...(ctx.frame ? { images: [bare(ctx.frame)] } : {}) };
    return this.attempt('app-context', `App-context re-ask (${ctx.sections.length} section(s)${ctx.frame ? ' + fresh screenshot' : ''})`, [...this.updated(), user]);
  }

  /** d. Two concurrent fresh calls; the first with content wins and the other is cancelled. */
  async overlap(): Promise<AiReply | null> {
    const system = this.messages.filter((m) => m.role === 'system');
    const contender = (messages: ChatMessage[]) => async (signal: AbortSignal): Promise<AiReply> => {
      const r = await this.send(messages, signal);
      return r.content ? r : { ...r, content: r.thinking ?? '', thinkingOnly: true };
    };
    const contenders = [
      contender([...system, { role: 'user', content: `${OVERLAP_PREFIX}${lastQuestion(this.messages)}` }]),
      contender([...this.updated(), { role: 'user', content: OVERLAP_FRESH_PROMPT }]),
    ];
    try {
      const reply = await firstValid(contenders);
      this.thinking = reply.thinking ?? this.thinking;
      if (!reply.thinkingOnly && reply.content) {
        this.report('overlap', true, 'Overlap AI: first valid answer of two concurrent calls wins', reply.thinking);
        return { content: reply.content, thinking: reply.thinking ?? this.thinking, answeredBy: 'overlap' };
      }
      this.report('overlap', false, 'Overlap AI: both concurrent calls returned thinking only', reply.thinking);
    } catch (error) {
      if (error instanceof AiCancelled || !(error instanceof AiError)) throw error;
      this.report('overlap', false, `Overlap AI: failed — ${error.message}`, null);
    }
    return null;
  }

  /** Every stage failed: the thinking is the response, marked thinking only. */
  thinkingOnly(): AiReply {
    this.report('thinking-only', false, 'Content was never produced — every escalation stage returned thinking only; the thinking is shown as the response', this.thinking);
    return { content: this.thinking, thinking: this.thinking, thinkingOnly: true, answeredBy: 'thinking-only' };
  }
}
