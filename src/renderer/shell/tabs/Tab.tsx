import type { MouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { TabGlyph } from './TabGlyph.js';
import { tabAccessibleName, tabHasUnsavedChanges, tabTooltip } from './model.js';
import type { PageTab } from './model.js';

interface TabProps {
  tab: PageTab;
  selected: boolean;
  tabIndex: 0 | -1;
  dragging?: boolean;
  dropBefore?: boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onDragStart: (tabId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
}

export function Tab({
  tab,
  selected,
  tabIndex,
  dragging = false,
  dropBefore = false,
  onSelect,
  onClose,
  onDragStart,
}: TabProps) {
  const unsaved = tabHasUnsavedChanges(tab);
  const tooltip = tabTooltip(tab);
  function closeFromPointer(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    onClose(tab.id);
  }
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest('.tab-close')) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    onDragStart(tab.id, event);
  }
  function onTabClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest('.tab-close')) {
      return;
    }
    onSelect(tab.id);
  }
  return (
    <>
      {dropBefore ? <div className="tab-drop-marker" aria-hidden="true" /> : null}
      <div
        className="tab"
        role="tab"
        id={`tab-${tab.id}`}
        aria-selected={selected}
        aria-controls={`panel-${tab.id}`}
        aria-label={tabAccessibleName(tab)}
        tabIndex={tabIndex}
        data-tab-id={tab.id}
        data-title={tab.title}
        data-unsaved={unsaved ? 'true' : 'false'}
        {...(dragging ? { 'data-tab-dragging': 'true' } : {})}
        title={tooltip}
        onPointerDown={onPointerDown}
        onClick={onTabClick}
      >
        <span className="tab-title" title={tooltip}>{tab.title}</span>
        <span className="tab-trailing">
          <span className="tab-unsaved" aria-hidden="true" />
          <button
            type="button"
            className="tab-close"
            aria-label="Close tab"
            tabIndex={-1}
            onMouseDown={closeFromPointer}
            onClick={closeFromPointer}
          >
            <TabGlyph kind="close" />
          </button>
        </span>
      </div>
    </>
  );
}