/** The two areas of the workspace that hold user-arrangeable panels. */
export const PANEL_AREAS = ['side', 'bottom'] as const;
export type PanelArea = (typeof PANEL_AREAS)[number];

/** Panel ids per area, in their default order. */
const DEFAULT_SIDE = [
  'workflow', 'variations', 'persona', 'ruler', 'elements', 'elementMap', 'snipGallery', 'inventory', 'routes', 'retest',
  'sections', 'learnedCoords', 'library', 'patterns', 'operationMemory', 'knowledge', 'profile', 'stats', 'memory', 'goals',
  'notifications', 'system', 'watcher', 'wake', 'initiative', 'triggers', 'projects', 'approvals', 'artifacts', 'presentation',
  'operations',
] as const;
const DEFAULT_BOTTOM = [
  'comparisonGallery', 'aiHelp', 'briefing', 'aiHistory', 'qwenThinking', 'supervisor', 'agents', 'portfolios', 'loopControl',
  'capabilities', 'settings', 'agentBus', 'crew', 'agentCrew', 'opsAgents', 'subagentReport', 'resolution', 'log', 'errors',
  'actionHistory', 'database',
] as const;

export type PanelId = (typeof DEFAULT_SIDE)[number] | (typeof DEFAULT_BOTTOM)[number];

/** Which panels sit in each area, top to bottom / left to right. */
export type PanelLayout = Record<PanelArea, PanelId[]>;

export const DEFAULT_PANEL_LAYOUT: PanelLayout = { side: [...DEFAULT_SIDE], bottom: [...DEFAULT_BOTTOM] };

const ALL_IDS: readonly PanelId[] = [...DEFAULT_SIDE, ...DEFAULT_BOTTOM];
const DEFAULT_AREA = new Map<PanelId, PanelArea>(PANEL_AREAS.flatMap((area) => DEFAULT_PANEL_LAYOUT[area].map((id) => [id, area] as const)));

export const isPanelId = (v: unknown): v is PanelId => typeof v === 'string' && DEFAULT_AREA.has(v as PanelId);

/**
 * A stored layout made safe: unknown ids and repeats are dropped (first occurrence wins), an area that is
 * not an array is empty, and every panel the stored layout lacks is appended to its default area in default order.
 */
export function sanitizePanelLayout(raw: unknown): PanelLayout {
  const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const seen = new Set<PanelId>();
  const out: PanelLayout = { side: [], bottom: [] };
  for (const area of PANEL_AREAS) {
    const ids = Array.isArray(stored[area]) ? (stored[area] as unknown[]) : [];
    for (const id of ids) {
      if (!isPanelId(id) || seen.has(id)) continue;
      seen.add(id);
      out[area].push(id);
    }
  }
  for (const id of ALL_IDS) if (!seen.has(id)) out[DEFAULT_AREA.get(id)!].push(id);
  return out;
}

/**
 * `layout` with panel `id` moved into `area`, placed before panel `before` (or at the end when `before` is null
 * or not in that area). Dropping a panel on itself returns the layout unchanged.
 */
export function movePanel(layout: PanelLayout, id: PanelId, area: PanelArea, before: PanelId | null): PanelLayout {
  if (id === before) return layout;
  const out: PanelLayout = { side: layout.side.filter((p) => p !== id), bottom: layout.bottom.filter((p) => p !== id) };
  const at = before === null ? -1 : out[area].indexOf(before);
  out[area].splice(at < 0 ? out[area].length : at, 0, id);
  return out;
}
