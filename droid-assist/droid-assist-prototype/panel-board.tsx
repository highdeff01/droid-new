import type { DragEvent, ReactNode } from 'react';
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
        <PanelSlot key={id} id={id} onDragOver={allowDrop} onDrop={drop(id)}>{renderPanel(id)}</PanelSlot>
      ))}
    </div>
  );
}

interface PanelSlotProps {
  id: PanelId;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  children: ReactNode;
}

/** A panel wrapped with a drag handle; the panel itself is rendered as-is. */
function PanelSlot({ id, onDragOver, onDrop, children }: PanelSlotProps) {
  const start = (e: DragEvent<HTMLButtonElement>) => {
    e.dataTransfer.setData(PANEL_DRAG_TYPE, id);
    e.dataTransfer.effectAllowed = 'move';
    const slot = e.currentTarget.parentElement;
    if (slot) e.dataTransfer.setDragImage?.(slot, 16, 16);
  };
  return (
    <div className={styles.panelSlot} data-panel-id={id} onDragOver={onDragOver} onDrop={onDrop}>
      <button type="button" className={styles.panelHandle} draggable onDragStart={start} aria-label={`Move ${id} panel`} title="Drag to move this panel">⠿</button>
      <div className={styles.panelBody}>{children}</div>
    </div>
  );
}
