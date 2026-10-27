import { useEffect, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';
import { TABS_LABEL } from '../focus/regions.js';
import { tabAfterCycle, tabAfterFocusKey } from './order.js';
import type { TabFocusKey } from './order.js';
import { Tab } from './Tab.js';
import { TabGlyph } from './TabGlyph.js';
import type { PageTab } from './model.js';

interface TabStripProps {
  tabs: readonly PageTab[];
  activeId: string;
  closePromptId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNew: () => void;
}

const FOCUS_KEYS = new Set<TabFocusKey>(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

function isFocusKey(key: string): key is TabFocusKey {
  return FOCUS_KEYS.has(key as TabFocusKey);
}

function scrollTabIntoView(tabId: string): void {
  document.getElementById(`tab-${tabId}`)?.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
    behavior: 'auto',
  });
}

export function TabStrip({ tabs, activeId, closePromptId, onSelect, onClose, onNew }: TabStripProps) {
  const [focusedId, setFocusedId] = useState(activeId);
  const [trackedActiveId, setTrackedActiveId] = useState(activeId);
  if (activeId !== trackedActiveId) {
    setTrackedActiveId(activeId);
    setFocusedId(activeId);
  }

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const reclaimFocusId = useRef<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.altKey || event.metaKey || !event.ctrlKey || event.isComposing) {
        return;
      }
      const currentTabs = tabsRef.current;
      const ids = currentTabs.map((tab) => tab.id);
      if (ids.length === 0) {
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        const previous = activeIdRef.current;
        const next = tabAfterCycle(ids, previous, event.shiftKey ? -1 : 1);
        if (next === previous) {
          document.getElementById(`tab-${next}`)?.focus();
          scrollTabIntoView(next);
          return;
        }
        activeIdRef.current = next;
        reclaimFocusId.current = next;
        onSelectRef.current(next);
        return;
      }
      if (event.key.toLowerCase() === 'w' && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current(activeIdRef.current);
      }
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

  useEffect(() => {
    const tabId = reclaimFocusId.current;
    if (tabId === null) {
      return;
    }
    reclaimFocusId.current = null;
    if (tabId !== activeId) {
      return;
    }
    const node = document.getElementById(`tab-${tabId}`);
    node?.focus();
    scrollTabIntoView(tabId);
  }, [activeId]);

  useEffect(() => {
    scrollTabIntoView(activeId);
  }, [activeId]);

  function onStripKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    const ids = tabs.map((tab) => tab.id);
    const fromDom = document.activeElement?.getAttribute('data-tab-id') ?? '';
    const current = ids.includes(fromDom) ? fromDom : focusedId;
    if (isFocusKey(event.key)) {
      event.preventDefault();
      const next = tabAfterFocusKey(ids, current, event.key);
      setFocusedId(next);
      const node = document.getElementById(`tab-${next}`);
      node?.focus();
      scrollTabIntoView(next);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      onSelect(current);
    }
  }

  function onStripBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) {
      return;
    }
    setFocusedId(activeId);
  }

  const focusTarget = tabs.some((tab) => tab.id === focusedId) ? focusedId : activeId;

  return (
    <div
      className="tab-strip"
      data-region="tab-strip"
      data-tab-count={tabs.length}
      data-active-tab={activeId}
      {...(closePromptId !== null ? { 'data-close-prompt': closePromptId } : {})}
    >
      <div
        className="tab-list"
        role="tablist"
        aria-label={TABS_LABEL}
        aria-orientation="horizontal"
        onKeyDown={onStripKeyDown}
        onBlur={onStripBlur}
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            tab={tab}
            selected={tab.id === activeId}
            tabIndex={tab.id === focusTarget ? 0 : -1}
            onSelect={onSelect}
            onClose={onClose}
          />
        ))}
      </div>
      <button type="button" className="tab-new" aria-label="New tab" onClick={onNew}>
        <TabGlyph kind="new" />
      </button>
    </div>
  );
}
