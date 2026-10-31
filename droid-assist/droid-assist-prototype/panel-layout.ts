/** The areas of the workspace that hold user-arrangeable docked panels; `top` sits directly under the stage. */
export const PANEL_AREAS = ['top', 'side', 'bottom'] as const;
export type PanelArea = (typeof PANEL_AREAS)[number];

/** Panel ids per area, in their default order. The AI thinking / responses panels lead the layout, under the stage. */
const DEFAULT_TOP = ['qwenThinking', 'aiResponses'] as const;
const DEFAULT_SIDE = [
  'operationProgress', 'workflow', 'selfTest', 'variations', 'persona', 'ruler', 'elements', 'elementMap', 'snipGallery', 'inventory', 'routes', 'retest',
  'sections', 'learnedCoords', 'library', 'accessPaths', 'patterns', 'blacklist', 'operationMemory', 'knowledge', 'profile', 'stats', 'memory', 'goals',
  'notifications', 'system', 'watcher', 'wake', 'initiative', 'triggers', 'projects', 'approvals', 'artifacts', 'presentation',
  'operations',
] as const;
const DEFAULT_BOTTOM = [
  'liveBriefing', 'aiActivity', 'popups', 'comparisonGallery', 'aiHelp', 'briefing', 'aiHistory', 'supervisor', 'agents', 'portfolios', 'loopControl',
  'capabilities', 'settings', 'agentBus', 'crew', 'agentCrew', 'opsAgents', 'subagentReport', 'resolution', 'log', 'errors',
  'actionHistory', 'database',
] as const;

export type PanelId = (typeof DEFAULT_TOP)[number] | (typeof DEFAULT_SIDE)[number] | (typeof DEFAULT_BOTTOM)[number];

/** Where an undocked panel floats on screen: viewport pixels, width in pixels, and its stacking order (higher is in front). */
export interface FloatRect {
  x: number;
  y: number;
  width: number;
  z: number;
}

/** Floating windows by panel id; a panel absent here is docked. */
export type FloatingPanels = Partial<Record<PanelId, FloatRect>>;

/**
 * Which panels sit in each docked area, top to bottom / left to right, plus the panels undocked into floating windows.
 * A floating panel keeps its docked slot, so docking it back returns it to where it was.
 */
export type PanelLayout = Record<PanelArea, PanelId[]> & { floating: FloatingPanels };

export interface Viewport {
  width: number;
  height: number;
}

/** Narrowest a floating window may be. */
export const MIN_FLOAT_WIDTH = 240;
/** How much of a floating window's top edge must stay on screen so its drag handle is always reachable. */
export const FLOAT_HANDLE_HEIGHT = 40;

export const DEFAULT_PANEL_LAYOUT: PanelLayout = { top: [...DEFAULT_TOP], side: [...DEFAULT_SIDE], bottom: [...DEFAULT_BOTTOM], floating: {} };

const ALL_IDS: readonly PanelId[] = [...DEFAULT_TOP, ...DEFAULT_SIDE, ...DEFAULT_BOTTOM];
const DEFAULT_AREA = new Map<PanelId, PanelArea>(PANEL_AREAS.flatMap((area) => DEFAULT_PANEL_LAYOUT[area].map((id) => [id, area] as const)));

export const isPanelId = (v: unknown): v is PanelId => typeof v === 'string' && DEFAULT_AREA.has(v as PanelId);

/** The browser viewport, or a desktop-sized stand-in where there is no window. */
export function currentViewport(): Viewport {
  if (typeof window === 'undefined') return { width: 1440, height: 900 };
  return { width: window.innerWidth, height: window.innerHeight };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** `rect` pulled fully onto `viewport` horizontally and with its handle on screen vertically. */
export function clampFloatRect<R extends Omit<FloatRect, 'z'>>(rect: R, viewport: Viewport): R {
  const width = clamp(rect.width, MIN_FLOAT_WIDTH, viewport.width);
  return { ...rect, width, x: clamp(rect.x, 0, viewport.width - width), y: clamp(rect.y, 0, viewport.height - FLOAT_HANDLE_HEIGHT) };
}

const isFloatRect = (v: unknown): v is FloatRect => {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return ['x', 'y', 'width', 'z'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]));
};

/** Stored floating windows made safe: invalid entries are dropped (their panels stay docked), the rest clamped and re-stacked 1..n. */
function sanitizeFloating(raw: unknown, viewport: Viewport): FloatingPanels {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const valid = Object.entries(raw).filter((e): e is [PanelId, FloatRect] => isPanelId(e[0]) && isFloatRect(e[1]));
  valid.sort((a, b) => a[1].z - b[1].z);
  return Object.fromEntries(valid.map(([id, rect], i) => [id, { ...clampFloatRect(rect, viewport), z: i + 1 }]));
}

/**
 * A stored layout made safe: unknown ids and repeats are dropped (first occurrence wins), an area that is
 * not an array is empty, and every panel the stored layout lacks is appended to its default area in default order.
 * A layout saved before the top area existed has the top panels moved up out of side/bottom. Floating windows are
 * validated and clamped to `viewport`; an invalid one leaves its panel docked.
 */
export function sanitizePanelLayout(raw: unknown, viewport: Viewport = currentViewport()): PanelLayout {
  const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const legacy = !Array.isArray(stored.top);
  const seen = new Set<PanelId>();
  const out: PanelLayout = { top: [], side: [], bottom: [], floating: sanitizeFloating(stored.floating, viewport) };
  for (const area of PANEL_AREAS) {
    const ids = Array.isArray(stored[area]) ? (stored[area] as unknown[]) : [];
    for (const id of ids) {
      if (!isPanelId(id) || seen.has(id) || (legacy && DEFAULT_AREA.get(id) === 'top')) continue;
      seen.add(id);
      out[area].push(id);
    }
  }
  for (const id of ALL_IDS) if (!seen.has(id)) out[DEFAULT_AREA.get(id)!].push(id);
  return out;
}

/**
 * `layout` with panel `id` moved into `area`, placed before panel `before` (or at the end when `before` is null
 * or not in that area); a floating panel dropped into an area is docked. Dropping a panel on itself returns the layout unchanged.
 */
export function movePanel(layout: PanelLayout, id: PanelId, area: PanelArea, before: PanelId | null): PanelLayout {
  if (id === before) return layout;
  const docked = dockPanel(layout, id);
  const out = { ...docked, top: docked.top.filter((p) => p !== id), side: docked.side.filter((p) => p !== id), bottom: docked.bottom.filter((p) => p !== id) };
  const at = before === null ? -1 : out[area].indexOf(before);
  out[area].splice(at < 0 ? out[area].length : at, 0, id);
  return out;
}

const topZ = (floating: FloatingPanels) => Math.max(0, ...Object.values(floating).map((r) => r!.z));

/**
 * `layout` with panel `id` floating at `at`, clamped to `viewport`. A panel that was docked is undocked in front of
 * every other window; one already floating keeps its stacking order.
 */
export function floatPanel(layout: PanelLayout, id: PanelId, at: Omit<FloatRect, 'z'>, viewport: Viewport): PanelLayout {
  const z = layout.floating[id]?.z ?? topZ(layout.floating) + 1;
  return { ...layout, floating: { ...layout.floating, [id]: { ...clampFloatRect(at, viewport), z } } };
}

/** `layout` with floating panel `id` docked back into its slot; unchanged when it was not floating. */
export function dockPanel(layout: PanelLayout, id: PanelId): PanelLayout {
  if (!layout.floating[id]) return layout;
  const floating = { ...layout.floating };
  delete floating[id];
  return { ...layout, floating };
}

/** `layout` with floating panel `id` brought in front of every other window; unchanged when it already is, or is docked. */
export function raisePanel(layout: PanelLayout, id: PanelId): PanelLayout {
  const rect = layout.floating[id];
  const z = topZ(layout.floating);
  if (!rect || (rect.z === z && Object.values(layout.floating).filter((r) => r!.z === z).length === 1)) return layout;
  return { ...layout, floating: { ...layout.floating, [id]: { ...rect, z: z + 1 } } };
}
