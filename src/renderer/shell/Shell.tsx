import type { EditorState } from 'prosemirror-state';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { editorUpdatesAreSynchronous } from '../editor/flush.js';
import { editorText } from '../editor/state.js';
import { FocusCycle } from './focus/FocusCycle.js';
import { STATUS_BAR_LABEL } from './focus/regions.js';
import { MenuBar } from './menus/MenuBar.js';
import { PageArea } from './PageArea.js';
import { StatusBar } from './statusbar/StatusBar.js';
import { saveStateFromChanged } from './statusbar/model.js';
import { closeTab, confirmClosePrompt } from './tabs/close.js';
import { SETTINGS_TAB_ID, createSettingsTab, createTab, replaceTabEditor, tabHasUnsavedChanges } from './tabs/model.js';
import type { PageTab } from './tabs/model.js';
import { TabStrip } from './tabs/TabStrip.js';
import { ThemeSync } from './theme/ThemeSync.js';
import { TitleBar } from './TitleBar.js';
import './shell.css';

export function Shell() {
  const [tabs, setTabs] = useState<PageTab[]>(() => [createTab(1)]);
  const [activeId, setActiveId] = useState('untitled-1');
  const [closePromptId, setClosePromptId] = useState<string | null>(null);
  const nextNumber = useRef(2);
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
  }, []);

  const selectTab = useCallback((tabId: string) => {
    setActiveId(tabId);
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
  }, []);

  const openSettings = useCallback(() => {
    setTabs((current) => {
      if (current.some((tab) => tab.id === SETTINGS_TAB_ID)) {
        return current;
      }
      return [...current, createSettingsTab()];
    });
    setActiveId(SETTINGS_TAB_ID);
  }, []);

  const onMenuCommand = useCallback(
    (command: string) => {
      if (command === 'new') {
        addTab();
        return;
      }
      if (command === 'close-tab') {
        closeTabById(activeIdRef.current);
        return;
      }
      if (command === 'settings') {
        openSettings();
      }
    },
    [addTab, closeTabById, openSettings],
  );

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
      if (event.altKey || event.shiftKey || event.repeat || !(event.ctrlKey || event.metaKey)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'n') {
        event.preventDefault();
        addTab();
        return;
      }
      if (key === ',') {
        event.preventDefault();
        openSettings();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    // Present before the first paint, so a key cannot arrive before the command exists.
    document.documentElement.dataset.shellCommands = 'ready';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      delete document.documentElement.dataset.shellCommands;
    };
  }, [addTab, openSettings]);

  if (activeTab === undefined) {
    return null;
  }

  return (
    <div className="shell">
      <ThemeSync />
      <FocusCycle />
      <TitleBar />
      <MenuBar onCommand={onMenuCommand} />
      <TabStrip
        tabs={tabs}
        activeId={activeTab.id}
        closePromptId={closePromptId}
        onSelect={selectTab}
        onClose={closeTabById}
        onNew={addTab}
      />
      <PageArea
        tabId={activeTab.id}
        kind={activeTab.kind}
        state={activeTab.editor}
        onChange={updateEditor}
      />
      {activeTab.kind === 'settings' ? (
        <footer
          className="status-bar"
          data-region="status-bar"
          data-status-mode="settings"
          role="status"
          aria-label={STATUS_BAR_LABEL}
          tabIndex={-1}
        />
      ) : (
        <StatusBar
          text={editorText(activeTab.editor)}
          saveState={saveStateFromChanged(tabHasUnsavedChanges(activeTab))}
        />
      )}
    </div>
  );
}
