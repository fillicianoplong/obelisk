import type { EditorState } from 'prosemirror-state';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { editorUpdatesAreSynchronous } from '../editor/flush.js';
import { editorText } from '../editor/state.js';
import { MenuBar } from './MenuBar.js';
import { PageArea } from './PageArea.js';
import { statusLabel } from './status.js';
import { StatusBar } from './StatusBar.js';
import { closeTab, confirmClosePrompt } from './tabs/close.js';
import { createTab, replaceTabEditor, tabHasUnsavedChanges } from './tabs/model.js';
import type { PageTab } from './tabs/model.js';
import { TabStrip } from './tabs/TabStrip.js';
import { ThemeSync } from './theme/ThemeSync.js';
import { TitleBar } from './TitleBar.js';
import './shell.css';

export function Shell() {
  const [tabs, setTabs] = useState<PageTab[]>(() => [createTab(1)]);
  const [activeId, setActiveId] = useState('untitled-1');
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [closePromptId, setClosePromptId] = useState<string | null>(null);
  const nextNumber = useRef(2);
  const menuBarRef = useRef<HTMLElement>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  const addTab = useCallback(() => {
    const number = nextNumber.current;
    nextNumber.current += 1;
    const tab = createTab(number);
    setTabs((current) => [...current, tab]);
    setActiveId(tab.id);
    setOpenMenu(null);
  }, []);

  const selectTab = useCallback((tabId: string) => {
    setActiveId(tabId);
    setOpenMenu(null);
  }, []);

  const closeTabById = useCallback((tabId: string) => {
    const existing = tabsRef.current;
    if (!existing.some((tab) => tab.id === tabId)) {
      return;
    }
    const currentActive = activeIdRef.current;
    const targets = existing.map((tab) => ({ id: tab.id, unsaved: tabHasUnsavedChanges(tab) }));
    let result = closeTab(targets, tabId, currentActive);
    if (result.action === 'missing') {
      return;
    }
    if (result.action === 'prompt') {
      const choice = confirmClosePrompt(result.prompt);
      if (choice !== 'discard') {
        // Save still needs the prompt from W-26 (#26). Cancel leaves the tab open.
        setClosePromptId(result.prompt.tabId);
        return;
      }
      result = closeTab(targets, tabId, currentActive, { force: true });
      if (result.action !== 'close') {
        return;
      }
    }
    setClosePromptId(null);
    const remaining = existing.filter((tab) => tab.id !== tabId);
    if (remaining.length === 0) {
      const number = nextNumber.current;
      nextNumber.current += 1;
      const created = createTab(number);
      tabsRef.current = [created];
      activeIdRef.current = created.id;
      setTabs([created]);
      setActiveId(created.id);
    } else {
      const nextActive = result.activeId ?? remaining[0].id;
      tabsRef.current = remaining;
      activeIdRef.current = nextActive;
      setTabs(remaining);
      setActiveId(nextActive);
    }
    setOpenMenu(null);
  }, []);

  const updateEditor = useCallback((tabId: string, editor: EditorState) => {
    const apply = () => {
      setTabs((current) => current.map((tab) => (tab.id === tabId ? replaceTabEditor(tab, editor) : tab)));
    };
    if (editorUpdatesAreSynchronous()) {
      flushSync(apply);
    } else {
      apply();
    }
  }, []);

  useLayoutEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenMenu(null);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        addTab();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    // Present before the first paint, so a key cannot arrive before the command exists.
    document.documentElement.dataset.shellCommands = 'ready';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      delete document.documentElement.dataset.shellCommands;
    };
  }, [addTab]);

  useEffect(() => {
    if (openMenu === null) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || menuBarRef.current?.contains(target)) {
        return;
      }
      setOpenMenu(null);
    }
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [openMenu]);

  if (activeTab === undefined) {
    return null;
  }

  return (
    <div className="shell">
      <ThemeSync />
      <TitleBar />
      <MenuBar
        openMenu={openMenu}
        onToggleMenu={(menuId) => {
          setOpenMenu((current) => (current === menuId ? null : menuId));
        }}
        onHoverMenu={(menuId) => {
          setOpenMenu((current) => (current === null ? current : menuId));
        }}
        onNew={addTab}
        onCloseTab={() => {
          closeTabById(activeTab.id);
        }}
        barRef={menuBarRef}
      />
      <TabStrip
        tabs={tabs}
        activeId={activeTab.id}
        closePromptId={closePromptId}
        onSelect={selectTab}
        onClose={closeTabById}
        onNew={addTab}
      />
      <PageArea tabId={activeTab.id} state={activeTab.editor} onChange={updateEditor} />
      <StatusBar label={statusLabel(editorText(activeTab.editor))} />
    </div>
  );
}
