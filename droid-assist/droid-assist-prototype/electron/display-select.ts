/** The parts of an Electron `Display` the selection logic reads. */
export interface DisplayLike {
  id: number;
  label?: string;
  size: { width: number; height: number };
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

/** The parts of a `DesktopCapturerSource` the selection logic reads. */
export interface SourceLike {
  display_id: string;
  name: string;
}

/** The chosen display, or the primary when nothing is chosen or the chosen one is gone. */
export function pickDisplay<D extends DisplayLike>(displays: readonly D[], primary: D, selectedId: string | null): D {
  return displays.find((d) => String(d.id) === selectedId) ?? primary;
}

/**
 * The capture source showing `display`: matched on display_id; when the platform leaves
 * display_id empty, by position if there is one source per display; else the first source.
 */
export function pickSource<S extends SourceLike>(sources: readonly S[], displays: readonly DisplayLike[], display: DisplayLike): S | undefined {
  const byId = sources.find((s) => s.display_id === String(display.id));
  if (byId) return byId;
  const byIndex = sources.length === displays.length && sources.every((s) => !s.display_id) ? sources[displays.indexOf(display)] : undefined;
  return byIndex ?? sources[0];
}

/** Physical pixel size of a display (what the desktop bridge clicks in). */
export function physicalSize(d: DisplayLike): { width: number; height: number } {
  return { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
}

/** Physical pixel position of a display's top-left corner on the virtual desktop. */
export function physicalOrigin(d: DisplayLike): { x: number; y: number } {
  return { x: Math.round(d.bounds.x * d.scaleFactor), y: Math.round(d.bounds.y * d.scaleFactor) };
}

/** A human label: the OS name when it has one, else "Display N", marked when primary. */
export function displayLabel(d: DisplayLike, index: number, primaryId: number): string {
  const name = d.label?.trim() || `Display ${index + 1}`;
  return d.id === primaryId ? `${name} (primary)` : name;
}
