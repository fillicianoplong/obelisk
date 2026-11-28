import { useEffect, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { TABS_LABEL } from '../focus/regions.js';
import { tabAfterCycle, tabAfterFocusKey } from './order.js';
import type { TabFocusKey } from './order.js';
import { Tab } from './Tab.js';
import { TabGlyph } from './TabGlyph.js';
import type { PageTab } from './model.js';
import { announceTabMoved } from './announce.js';
import {
  dropIndexFromPointer,
  moveTabKeyboard,
  reorderTabIds,
  scrollTabsFromDragEdge,
  tabDragExceeded,
} from './reorder.js';
import { scrollTabsFromWheel } from './wheel.js';

interface TabStripProps {
  tabs: readonly PageTab[];
  activeId: string;
  closePromptId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNew: () => void;
  onReorder: (orderedIds: readonly string[]) => void;
}

const FOCUS_KEYS = new Set<TabFocusKey>(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

function isFocusKey(key: string): key is TabFocusKey {
  return FOCUS_KEYS.has(key as TabFocusKey);
}

function scrollTabIntoView(tabId: string): void {
  if (tabId.length === 0) {
    return;
  }
  document.getElementById(`tab-${tabId}`)?.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
    behavior: 'auto',
  });
}

function tabBoxes(list: HTMLElement): { id: string; left: number; right: number }[] {
  return [...list.querySelectorAll<HTMLElement>('[role="tab"]')].map((node) => {
    const rect = node.getBoundingClientRect();
    const id = node.getAttribute('data-tab-id');
    return { id: id ?? '', left: rect.left, right: rect.right };
  }).filter((box) => box.id.length > 0);
}

export function TabStrip({
  tabs,
  activeId,
  closePromptId,
  onSelect,
  onClose,
  onNew,
  onReorder,
}: TabStripProps) {
  const [focusedId, setFocusedId] = useState(activeId);
  const [trackedActiveId, setTrackedActiveId] = useState(activeId);
  if (activeId !== trackedActiveId) {
    setTrackedActiveId(activeId);
    setFocusedId(activeId);
  }

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const reclaimFocusId = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const dragActiveRef = useRef(false);

  useEffect(() => {
    const strip = stripRef.current;
    if (strip === null) {
      return undefined;
    }
    const onWheel = (event: WheelEvent) => {
      const list = listRef.current;
      if (list === null || dragActiveRef.current) {
        return;
      }
      scrollTabsFromWheel(list, event);
    };
    strip.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      strip.removeEventListener('wheel', onWheel);
    };
  }, []);

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
    const list = listRef.current;
    if (activeId.length === 0) {
      return undefined;
    }
    const scrollActive = () => {
      scrollTabIntoView(activeId);
    };
    scrollActive();
    if (list === null) {
      return undefined;
    }
    const observer = new ResizeObserver(scrollActive);
    observer.observe(list);
    return () => {
      observer.disconnect();
    };
  }, [activeId]);

  function endDrag(cancelled: boolean): void {
    dragActiveRef.current = false;
    const list = listRef.current;
    const fromId = dragId;
    const toIndex = dropIndex;
    setDragId(null);
    setDropIndex(null);
    list?.removeAttribute('data-tab-drag');
    if (fromId === null || toIndex === null || list === null) {
      return;
    }
    if (cancelled) {
      return;
    }
    const ids = tabsRef.current.map((tab) => tab.id);
    const fromIndex = ids.indexOf(fromId);
    if (fromIndex === -1 || fromIndex === toIndex) {
      return;
    }
    const ordered = reorderTabIds(ids, fromIndex, toIndex);
    onReorderRef.current(ordered);
    const tab = tabsRef.current.find((item) => item.id === fromId);
    if (tab !== undefined) {
      const position = ordered.indexOf(fromId) + 1;
      announceTabMoved(window, tab.title, position, ordered.length);
    }
  }

  function beginTabDrag(tabId: string, event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) {
      return;
    }
    const list = listRef.current;
    if (list === null) {
      return;
    }
    const startX = event.clientX;
    const startY = event.clientY;
    const doc = list.ownerDocument;
    let dragging = false;

    function onMove(move: PointerEvent): void {
      const row = listRef.current;
      if (row === null) {
        return;
      }
      if (!dragging) {
        const dx = move.clientX - startX;
        const dy = move.clientY - startY;
        if (!tabDragExceeded(dx, dy)) {
          return;
        }
        dragging = true;
        dragActiveRef.current = true;
        row.setAttribute('data-tab-drag', 'true');
        setDragId(tabId);
      }
      const boxes = tabBoxes(row);
      const nextDrop = dropIndexFromPointer(boxes, tabId, move.clientX);
      setDropIndex(nextDrop);
      const rect = row.getBoundingClientRect();
      scrollTabsFromDragEdge(row, rect, move.clientX);
    }

    function onUp(up: PointerEvent): void {
      cleanup();
      if (!dragging) {
        onSelectRef.current(tabId);
        return;
      }
      up.preventDefault();
      endDrag(false);
    }

    function onDocKey(key: globalThis.KeyboardEvent): void {
      if (key.key !== 'Escape') {
        return;
      }
      key.preventDefault();
      cleanup();
      endDrag(true);
    }

    function cleanup(): void {
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerup', onUp);
      doc.removeEventListener('keydown', onDocKey);
    }

    doc.addEventListener('pointermove', onMove);
    doc.addEventListener('pointerup', onUp);
    doc.addEventListener('keydown', onDocKey);
  }

  function onStripKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const ids = tabs.map((tab) => tab.id);
    const fromDom = document.activeElement?.getAttribute('data-tab-id') ?? '';
    const current = ids.includes(fromDom) ? fromDom : focusedId;
    if (
      event.ctrlKey
      && event.shiftKey
      && !event.altKey
      && !event.metaKey
      && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) {
      event.preventDefault();
      const delta = event.key === 'ArrowLeft' ? -1 : 1;
      const ordered = moveTabKeyboard(ids, current, delta);
      if (ordered === null) {
        return;
      }
      onReorder(ordered);
      const tab = tabs.find((item) => item.id === current);
      if (tab !== undefined) {
        const position = ordered.indexOf(current) + 1;
        announceTabMoved(window, tab.title, position, ordered.length);
      }
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
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
      ref={stripRef}
      data-tab-count={tabs.length}
      {...(activeId.length > 0 ? { 'data-active-tab': activeId } : {})}
      {...(closePromptId !== null ? { 'data-close-prompt': closePromptId } : {})}
    >
      <div
        className="tab-list"
        role="tablist"
        ref={listRef}
        aria-label={TABS_LABEL}
        aria-orientation="horizontal"
        onKeyDown={onStripKeyDown}
        onBlur={onStripBlur}
        {...(dragId !== null ? { 'data-tab-drag': 'true' } : {})}
      >
        {tabs.map((tab, index) => (
          <Tab
            key={tab.id}
            tab={tab}
            selected={tab.id === activeId}
            tabIndex={tab.id === focusTarget ? 0 : -1}
            dragging={dragId === tab.id}
            dropBefore={dropIndex === index && dragId !== null && dragId !== tab.id}
            onSelect={onSelect}
            onClose={onClose}
            onDragStart={beginTabDrag}
          />
        ))}
        {dragId !== null && dropIndex === tabs.length ? (
          <div className="tab-drop-marker" aria-hidden="true" data-drop-at="end" />
        ) : null}
      </div>
      <button type="button" className="tab-new" aria-label="New tab" onClick={onNew}>
        <TabGlyph kind="new" />
      </button>
    </div>
  );
}