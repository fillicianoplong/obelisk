import { ZOOM_LABEL } from './model.js';
import type { TextCounts } from './model.js';

interface CountItemsProps {
  counts: TextCounts;
  pageLabel: string;
}

export function CountItems({ counts, pageLabel }: CountItemsProps) {
  return (
    <div className="status-bar-leading" aria-live="off">
      <span data-status-item="page">{pageLabel}</span>
      <span data-status-item="words">{counts.wordsLabel}</span>
      <span data-status-item="characters">{counts.charactersLabel}</span>
    </div>
  );
}

interface ViewItemProps {
  itemRef: (node: HTMLSpanElement | null) => void;
  label: string;
}

export function ViewItem({ itemRef, label }: ViewItemProps) {
  return (
    <span className="status-view" data-status-item="view" ref={itemRef}>
      {label}
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
