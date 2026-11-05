import type { HealthPayload, JointApp } from './main-bridge-protocol.js';
import type { AppCapability, AppId, Job } from './app-selection.js';

/**
 * Health and capability exchange: each app broadcasts its live health (AI endpoint up/down, bridge
 * latency, crew load, real input armed) and the app-selection logic picks the executor from the
 * health it actually sees, not from assumptions. A peer whose health has gone stale is treated as
 * unavailable, so a dead app is never chosen.
 */

/** How long a health report stays fresh; older than this and the peer counts as unavailable. */
export const HEALTH_STALE_MS = 15_000;
/** Latency above which an app's cost is pushed up sharply (ms). */
export const SLOW_MS = 1500;

/** One app's health as both apps hold it. */
export interface Health {
  app: JointApp;
  aiUp: boolean;
  latencyMs: number;
  crewLoad: number;
  armed: boolean;
  canExecute: boolean;
  /** When the report was made (ms since epoch). */
  at: number;
}

/** This app's own health, measured locally. */
export const localHealth = (app: JointApp, state: { aiUp: boolean; latencyMs: number; crewLoad: number; armed: boolean; canExecute: boolean }, at = Date.now()): Health =>
  ({ app, ...state, at });

/** The wire payload of a health report. */
export const toHealthPayload = (h: Health): HealthPayload => ({ app: h.app, aiUp: h.aiUp, latencyMs: h.latencyMs, crewLoad: h.crewLoad, armed: h.armed, canExecute: h.canExecute });

/** A health report from the wire, stamped with when it was received. */
export const fromHealthPayload = (p: HealthPayload, at = Date.now()): Health => ({ app: p.app === 'droid-main' ? 'droid-main' : 'droid-new', aiUp: p.aiUp, latencyMs: p.latencyMs, crewLoad: p.crewLoad, armed: p.armed, canExecute: p.canExecute, at });

/** Whether `h` is still fresh at `now`; a stale report means the app cannot be trusted to execute. */
export const isFresh = (h: Health | null, now = Date.now()): h is Health => !!h && now - h.at <= HEALTH_STALE_MS;

/** Whether `h` says the app can take a step right now. */
export const isHealthy = (h: Health | null, now = Date.now()): boolean => isFresh(h, now) && h.aiUp && h.canExecute;

/** A one-line health report for the log. */
export const healthLine = (h: Health): string =>
  `${h.app}: AI ${h.aiUp ? 'up' : 'down'}, ${Math.round(h.latencyMs)}ms, crew load ${Math.round(h.crewLoad * 100)}%, input ${h.armed ? 'armed' : 'disarmed'}${h.canExecute ? '' : ', cannot execute'}`;

/** Latency-equivalent cost of a health report: slow or loaded apps cost more, a stale app costs infinity. */
export function healthCost(h: Health | null, now = Date.now()): number {
  if (!isFresh(h, now)) return Number.POSITIVE_INFINITY;
  if (!h.canExecute) return Number.POSITIVE_INFINITY;
  const slow = h.latencyMs > SLOW_MS ? h.latencyMs - SLOW_MS : 0;
  return Math.round(h.latencyMs + h.crewLoad * 1000 + slow);
}

/**
 * Both apps' capabilities from their live health, so selection uses facts rather than assumptions.
 * An app that is stale, unhealthy or cannot execute is marked incapable in both phases; costs come
 * from the measured latency and crew load.
 */
export function capabilitiesFromHealth(health: Readonly<Record<AppId, Health | null>>, now = Date.now()): Record<AppId, AppCapability> {
  const forApp = (id: AppId): AppCapability => {
    const h = health[id];
    const live = isHealthy(h, now);
    const cost = Math.max(1, Math.round(healthCost(h, now)));
    const finite = Number.isFinite(cost) ? cost : 1_000_000;
    return { calculate: live, perform: live && !!h?.armed, calculateCost: finite, performCost: finite + 1 };
  };
  return { assist: forApp('assist'), main: forApp('main') };
}

/** The app ids as the health record is keyed: droid-new is `assist`, droid-main is `main`. */
export const healthAppId = (app: JointApp): AppId => (app === 'droid-new' ? 'assist' : 'main');

/** A job whose apps' capabilities come from live health. */
export const jobFromHealth = (name: string, health: Readonly<Record<AppId, Health | null>>, needsBoth = false): Job =>
  ({ name, apps: capabilitiesFromHealth(health), ...(needsBoth ? { needsBoth: true } : {}) });
