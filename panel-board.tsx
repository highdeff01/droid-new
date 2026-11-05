import { Component, type DragEvent, type ReactNode } from 'react';
import { isPanelId, type PanelArea, type PanelId } from './panel-layout.js';
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
export function PanelBoard({ area, ids, className, renderPanel, onMove }: PanelBoardProps) {
  const drop = (before: PanelId | null) => (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const id = draggedId(e);
    if (id) onMove(id, area, before);
  };
  return (
    <div className={className} data-panel-area={area} onDragOver={allowDrop} onDrop={drop(null)}>
      {ids.map((id) => (
        <PanelSlot
          key={id}
          id={id}
          area={area}
          ids={ids}
          onMove={onMove}
          onDragOver={allowDrop}
          onDrop={drop(id)}
        >
          {renderPanel(id)}
        </PanelSlot>
      ))}
    </div>
  );
}

interface PanelSlotProps {
  id: PanelId;
  area: PanelArea;
  ids: readonly PanelId[];
  onMove: PanelBoardProps['onMove'];
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  children: ReactNode;
}

/** A panel wrapped with a drag handle; the panel itself is rendered as-is. */
function PanelSlot({ id, area, ids, onMove, onDragOver, onDrop, children }: PanelSlotProps) {
  const start = (e: DragEvent<HTMLButtonElement>) => {
    e.dataTransfer.setData(PANEL_DRAG_TYPE, id);
    e.dataTransfer.effectAllowed = 'move';
    const slot = e.currentTarget.parentElement;
    if (slot) e.dataTransfer.setDragImage?.(slot, 16, 16);
  };
  const index = ids.indexOf(id);
  const otherArea: PanelArea = area === 'side' ? 'bottom' : 'side';
  return (
    <div className={styles.panelSlot} data-panel-id={id} onDragOver={onDragOver} onDrop={onDrop}>
      <div className={styles.panelControls}>
        <button type="button" className={styles.panelHandle} draggable onDragStart={start} aria-label={`Drag to move ${id} panel`} title="Drag to move this panel">⠿</button>
        <button type="button" onClick={() => onMove(id, area, ids[index - 1] ?? null)} disabled={index === 0} aria-label={`Move ${id} earlier`} title="Move earlier">↑</button>
        <button type="button" onClick={() => onMove(id, area, ids[index + 2] ?? null)} disabled={index === ids.length - 1} aria-label={`Move ${id} later`} title="Move later">↓</button>
        <button type="button" onClick={() => onMove(id, otherArea, null)} aria-label={`Move ${id} to ${otherArea} area`} title={`Move to ${otherArea} area`}>⇄</button>
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
