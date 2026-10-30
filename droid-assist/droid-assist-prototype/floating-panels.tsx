import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { FloatingPanels, FloatRect, PanelId } from './panel-layout.js';
import { PanelErrorBoundary } from './panel-board.js';
import styles from './droid-assist.module.css';

type Rect = Omit<FloatRect, 'z'>;

export interface FloatingLayerProps {
  floating: FloatingPanels;
  renderPanel: (id: PanelId) => ReactNode;
  /** A window was dragged or resized to `rect` (committed on release). */
  onPlace: (id: PanelId, rect: Rect) => void;
  /** A window was clicked: bring it to the front. */
  onRaise: (id: PanelId) => void;
  /** The window's dock control was pressed: return it to its docked slot. */
  onDock: (id: PanelId) => void;
}

/** Every undocked panel as a free-positioned window over the workspace, stacked by its stored z. */
export function FloatingLayer({ floating, renderPanel, onPlace, onRaise, onDock }: FloatingLayerProps) {
  const entries = Object.entries(floating) as [PanelId, FloatRect][];
  return (
    <div className={styles.floatingLayer} aria-label="Floating panels">
      {entries.map(([id, rect]) => (
        <FloatingWindow key={id} id={id} rect={rect} onPlace={onPlace} onRaise={onRaise} onDock={onDock}>{renderPanel(id)}</FloatingWindow>
      ))}
    </div>
  );
}

interface FloatingWindowProps extends Omit<FloatingLayerProps, 'floating' | 'renderPanel'> {
  id: PanelId;
  rect: FloatRect;
  children: ReactNode;
}

/** How a pointer gesture changes the window rect it started from. */
const GESTURES = {
  move: (from: Rect, dx: number, dy: number): Rect => ({ ...from, x: from.x + dx, y: from.y + dy }),
  resize: (from: Rect, dx: number): Rect => ({ ...from, width: from.width + dx }),
} as const;

/**
 * Follows one pointer gesture from `e` until release, previewing each step through `preview` and committing the final
 * rect through `commit`. Listens on window so the gesture survives the pointer leaving the element.
 */
function track(e: ReactPointerEvent, from: Rect, gesture: keyof typeof GESTURES, preview: (r: Rect | null) => void, commit: (r: Rect) => void) {
  e.preventDefault();
  e.stopPropagation();
  const step = (ev: PointerEvent) => GESTURES[gesture](from, ev.clientX - e.clientX, ev.clientY - e.clientY);
  const move = (ev: PointerEvent) => preview(step(ev));
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    preview(null);
    commit(step(ev));
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/** One floating panel: a drag-handle header with a dock control, the panel body, and a width resize grip. */
function FloatingWindow({ id, rect, onPlace, onRaise, onDock, children }: FloatingWindowProps) {
  const [draft, setDraft] = useState<Rect | null>(null);
  const shown = draft ?? rect;
  const begin = (gesture: keyof typeof GESTURES) => (e: ReactPointerEvent) => {
    onRaise(id);
    track(e, { x: rect.x, y: rect.y, width: rect.width }, gesture, setDraft, (r) => onPlace(id, r));
  };
  return (
    <div
      className={styles.floatingWindow}
      data-floating-id={id}
      style={{ left: shown.x, top: shown.y, width: shown.width, zIndex: rect.z }}
      onPointerDown={() => onRaise(id)}
    >
      <div className={styles.floatingHeader}>
        <span className={styles.floatingGrip} onPointerDown={begin('move')} role="button" tabIndex={-1} aria-label={`Drag ${id} window`} title="Drag to move this window">⠿ {id}</span>
        <button type="button" className={styles.panelControl} onClick={() => onDock(id)} aria-label={`Dock ${id} panel`} title="Dock back into its area">⇲</button>
      </div>
      <div className={styles.panelBody}><PanelErrorBoundary>{children}</PanelErrorBoundary></div>
      <span className={styles.resizeGrip} onPointerDown={begin('resize')} aria-label={`Resize ${id} window`} role="button" tabIndex={-1} title="Drag to resize" />
    </div>
  );
}
