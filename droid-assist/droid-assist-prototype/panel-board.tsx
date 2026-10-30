import { Component, type DragEvent, type ReactNode } from 'react';
import { isPanelId, type FloatRect, type PanelArea, type PanelId } from './panel-layout.js';
import styles from './droid-assist.module.css';

/** dataTransfer type carrying the id of the panel being dragged. */
export const PANEL_DRAG_TYPE = 'application/x-droid-panel';

export interface PanelBoardProps {
  area: PanelArea;
  /** Panel ids of this area, in display order. */
  ids: readonly PanelId[];
  className: string;
  renderPanel: (id: PanelId) => ReactNode;
  /** A panel was dropped into this area before `before` (null: at the end). */
  onMove: (id: PanelId, area: PanelArea, before: PanelId | null) => void;
  /** A panel's undock control was pressed; `at` is where its slot sits on screen now. */
  onFloat?: (id: PanelId, at: Omit<FloatRect, 'z'>) => void;
}

const draggedId = (e: DragEvent): PanelId | null => {
  const id = e.dataTransfer.getData(PANEL_DRAG_TYPE);
  return isPanelId(id) ? id : null;
};

const allowDrop = (e: DragEvent) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
};

/** One area of user-arrangeable panels: each panel gets a drag handle and is a drop target. */
export function PanelBoard({ area, ids, className, renderPanel, onMove, onFloat }: PanelBoardProps) {
  const drop = (before: PanelId | null) => (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const id = draggedId(e);
    if (id) onMove(id, area, before);
  };
  return (
    <div className={className} data-panel-area={area} onDragOver={allowDrop} onDrop={drop(null)}>
      {ids.map((id) => (
        <PanelSlot key={id} id={id} onDragOver={allowDrop} onDrop={drop(id)} onFloat={onFloat}>{renderPanel(id)}</PanelSlot>
      ))}
    </div>
  );
}

interface PanelSlotProps {
  id: PanelId;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onFloat?: PanelBoardProps['onFloat'];
  children: ReactNode;
}

/** A panel wrapped with a drag handle and an undock control; the panel itself is rendered as-is. */
function PanelSlot({ id, onDragOver, onDrop, onFloat, children }: PanelSlotProps) {
  const start = (e: DragEvent<HTMLButtonElement>) => {
    e.dataTransfer.setData(PANEL_DRAG_TYPE, id);
    e.dataTransfer.effectAllowed = 'move';
    const slot = e.currentTarget.closest('[data-panel-id]');
    if (slot) e.dataTransfer.setDragImage?.(slot, 16, 16);
  };
  const float = (slot: Element | null) => {
    const box = slot?.getBoundingClientRect();
    onFloat?.(id, { x: box?.left ?? 0, y: box?.top ?? 0, width: box?.width ?? 0 });
  };
  return (
    <div className={styles.panelSlot} data-panel-id={id} onDragOver={onDragOver} onDrop={onDrop}>
      <div className={styles.panelControls}>
        <button type="button" className={styles.panelHandle} draggable onDragStart={start} aria-label={`Move ${id} panel`} title="Drag to move this panel">⠿</button>
        {onFloat && (
          <button type="button" className={styles.panelControl} onClick={(e) => float(e.currentTarget.closest('[data-panel-id]'))} aria-label={`Float ${id} panel`} title="Undock into a floating window">⧉</button>
        )}
      </div>
      <div className={styles.panelBody}><PanelErrorBoundary>{children}</PanelErrorBoundary></div>
    </div>
  );
}

/** Contains a crash to its one panel: shows an inline error card instead of unmounting the whole tree. */
export class PanelErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <section className={styles.panel} role="alert">Panel crashed: {error.message} — reload to retry</section>;
  }
}
