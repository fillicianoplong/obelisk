import type { PageTab } from './tabs.js';

interface TabStripProps {
  tabs: readonly PageTab[];
  activeId: string;
  onSelect: (tabId: string) => void;
  onNew: () => void;
}

export function TabStrip({ tabs, activeId, onSelect, onNew }: TabStripProps) {
  return (
    <div
      className="tab-strip"
      data-region="tab-strip"
      data-tab-count={tabs.length}
      data-active-tab={activeId}
      role="tablist"
      aria-label="Tabs"
    >
      {tabs.map((tab) => {
        const selected = tab.id === activeId;
        return (
          <div
            key={tab.id}
            className="tab"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            data-tab-id={tab.id}
            data-title={tab.title}
            onClick={() => {
              onSelect(tab.id);
            }}
          >
            <span className="tab-title">{tab.title}</span>
            <span className="tab-unsaved" aria-hidden="true" />
            <span className="tab-close" aria-hidden="true">
              ×
            </span>
          </div>
        );
      })}
      <button type="button" className="tab-new" aria-label="New tab" onClick={onNew}>
        +
      </button>
    </div>
  );
}
