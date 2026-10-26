import type { MouseEvent } from 'react';
import { tabAccessibleName, tabHasUnsavedChanges, tabTooltip } from './model.js';
import type { PageTab } from './model.js';

interface TabProps {
  tab: PageTab;
  selected: boolean;
  tabIndex: 0 | -1;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
}

export function Tab({ tab, selected, tabIndex, onSelect, onClose }: TabProps) {
  const unsaved = tabHasUnsavedChanges(tab);
  const tooltip = tabTooltip(tab);
  function closeFromPointer(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    onClose(tab.id);
  }
  return (
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
      title={tooltip}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest('.tab-close')) {
          return;
        }
        onSelect(tab.id);
      }}
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
          <span aria-hidden="true">×</span>
        </button>
      </span>
    </div>
  );
}
