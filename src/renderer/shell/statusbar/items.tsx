import { PAGE_LABEL, VIEW_LABEL, ZOOM_LABEL } from './model.js';
import type { TextCounts } from './model.js';

interface CountItemsProps {
  counts: TextCounts;
}

export function CountItems({ counts }: CountItemsProps) {
  return (
    <div className="status-bar-leading" aria-live="off">
      <span data-status-item="page">{PAGE_LABEL}</span>
      <span data-status-item="words">{counts.wordsLabel}</span>
      <span data-status-item="characters">{counts.charactersLabel}</span>
    </div>
  );
}

interface ViewItemProps {
  itemRef: (node: HTMLSpanElement | null) => void;
}

export function ViewItem({ itemRef }: ViewItemProps) {
  return (
    <span className="status-view" data-status-item="view" ref={itemRef}>
      {VIEW_LABEL}
    </span>
  );
}

// Minus, the percent, and plus are placeholders until zoom exists.
export function ZoomItem() {
  return (
    <span className="status-zoom" role="group" aria-label={`Zoom ${ZOOM_LABEL}`}>
      <span className="status-zoom-mark" aria-hidden="true">−</span>
      <span data-status-item="zoom">{ZOOM_LABEL}</span>
      <span className="status-zoom-mark" aria-hidden="true">+</span>
    </span>
  );
}
