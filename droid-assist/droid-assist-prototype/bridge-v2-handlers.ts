import { isRequest, type InboundMessage, type PeerPayloads, type PeerType, type RequestPayloads, type RequestType, type ResultPayload } from './main-bridge-protocol.js';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The existing machinery each main→assist v2 request is routed into (planner, grounding, agents, workflow engine). */
export interface V2Machinery {
  /** Grounding: describe the screen, or answer a question about it. */
  analyze(question: string): Promise<ResultPayload>;
  /** Planner: plan `goal` without running it. */
  plan(goal: string): Promise<ResultPayload>;
  /** Workflow engine: plan `goal` when given, then replay the plan. */
  run(goal: string | undefined, selfTest: boolean): Promise<ResultPayload>;
  /** Verification of the run's goal (or `goal`). */
  verify(goal: string | undefined): Promise<ResultPayload>;
  /** Agents: start or stop watching the screen. */
  watch(on: boolean, target: string | undefined): Promise<ResultPayload>;
  /** Error forwarding: records the other app's error so agents can detect and fix it. */
  assistError(message: string, goal: string | undefined): Promise<ResultPayload>;
}

type RequestRoutes = { [K in RequestType]: (p: RequestPayloads[K], m: V2Machinery) => Promise<ResultPayload> };

/** Every v2 request type and the machinery it is routed into. */
export const REQUEST_ROUTES: RequestRoutes = {
  analyze: (p, m) => m.analyze(p.question?.trim() ?? ''),
  plan_workflow: (p, m) => m.plan(p.goal.trim()),
  run_workflow: (p, m) => m.run(p.goal?.trim() || undefined, p.selfTest === true),
  verify: (p, m) => m.verify(p.goal?.trim() || undefined),
  watch: (p, m) => m.watch(p.on, p.target?.trim() || undefined),
  assist_error: (p, m) => m.assistError(p.message.trim(), p.goal?.trim() || undefined),
};

/** What droid-new does with each v2 message the apps exchange as peers. */
export type PeerHandlers = { [K in PeerType]: (p: PeerPayloads[K]) => void };

/** Runs one request through its route; a thrown error becomes a failed result, never an unanswered request. */
export async function handleRequest<K extends RequestType>(type: K, payload: RequestPayloads[K], machinery: V2Machinery): Promise<ResultPayload> {
  try {
    return await REQUEST_ROUTES[type](payload, machinery);
  } catch (error) {
    return { ok: false, message: `${type} failed: ${errorText(error)}` };
  }
}

export interface V2Router {
  machinery: V2Machinery;
  peers: PeerHandlers;
  /** Sends the `result` answering request `replyTo`. */
  reply(result: ResultPayload, replyTo: string): void;
}

/**
 * Routes one inbound v2 message: a request runs through its machinery and is answered with a
 * `result` replying to it; a peer message goes to its handler. True when the message was v2.
 */
export function routeV2(message: InboundMessage, router: V2Router): boolean {
  if (isRequest(message)) {
    void handleRequest(message.type, message.payload as never, router.machinery).then((result) => router.reply(result, message.id));
    return true;
  }
  if (message.type in PEER_TYPES) {
    (router.peers[message.type as PeerType] as (p: unknown) => void)(message.payload);
    return true;
  }
  return false;
}

const PEER_TYPES: Record<PeerType, true> = { user_request: true, takeover: true, regulate: true, step_opinion: true, console_log: true, app_state: true };
