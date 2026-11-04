import type { EditorState } from 'prosemirror-state';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { editorUpdatesAreSynchronous } from '../editor/flush.js';
import { editorText } from '../editor/state.js';
import type { FileOpenResult } from '../../shared/ipc/types.js';
import { FocusCycle } from './focus/FocusCycle.js';
import { STATUS_BAR_LABEL } from './focus/regions.js';
import { MenuBar } from './menus/MenuBar.js';
import { PageArea } from './PageArea.js';
import { StatusBar } from './statusbar/StatusBar.js';
import { saveStateFromChanged } from './statusbar/model.js';
import { closeTab, confirmClosePrompt } from './tabs/close.js';
import { SETTINGS_TAB_ID, createSettingsTab, createTab, replaceTabEditor, tabHasUnsavedChanges } from './tabs/model.js';
import type { PageTab } from './tabs/model.js';
import { applyOpenResult } from './tabs/opened.js';
import { TabStrip } from './tabs/TabStrip.js';
import { ThemeSync } from './theme/ThemeSync.js';
import { TitleBar } from './TitleBar.js';
import './shell.css';

export function Shell() {
  const [tabs, setTabs] = useState<PageTab[]>(() => [createTab(1)]);
  const [activeId, setActiveId] = useState('untitled-1');
  const [closePromptId, setClosePromptId] = useState<string | null>(null);
  const [openMessage, setOpenMessage] = useState<string | null>(null);
  const nextNumber = useRef(2);
  const opening = useRef(false);
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
    void (async () => {
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
      const closing = existing.find((tab) => tab.id === tabId);
      const remaining = existing.filter((tab) => tab.id !== tabId);
      if (closing?.handle) {
        const handles = remaining.flatMap((tab) => (tab.handle ? [tab.handle] : []));
        const nextActiveId = remaining.length === 0 ? null : (result.activeId ?? remaining[0].id);
        const active = nextActiveId === null ? undefined : remaining.find((tab) => tab.id === nextActiveId);
        let released = false;
        try {
          const response = await window.obelisk['session:set']({
            handles,
            activeHandle: active?.handle ?? null,
          });
          released = response.status === 'ok';
          if (!released) {
            setOpenMessage(response.status === 'error' ? response.message : 'The tab could not be closed.');
          }
        } catch {
          setOpenMessage('The tab could not be closed.');
        }
        if (!released || !tabsRef.current.some((tab) => tab.id === tabId)) {
          return;
        }
      }
      setClosePromptId(null);
      if (remaining.length === 0) {
        const number = nextNumber.current;
        nextNumber.current += 1;
        const created = createTab(number);
        tabsRef.current = [created];
        activeIdRef.current = created.id;
        setTabs([created]);
        setActiveId(created.id);
        return;
      }
      const nextActive = result.activeId ?? remaining[0].id;
      tabsRef.current = remaining;
      activeIdRef.current = nextActive;
      setTabs(remaining);
      setActiveId(nextActive);
    })();
  }, []);

  const openDocument = useCallback(() => {
    if (opening.current) {
      return;
    }
    opening.current = true;
    void (async () => {
      let result: FileOpenResult;
      try {
        result = await window.obelisk['file:open']();
      } catch {
        setOpenMessage('This file could not be opened.');
        return;
      } finally {
        opening.current = false;
      }
      const applied = applyOpenResult(tabsRef.current, activeIdRef.current, result);
      tabsRef.current = applied.tabs;
      activeIdRef.current = applied.activeId;
      setTabs(applied.tabs);
      setActiveId(applied.activeId);
      setOpenMessage(applied.message);
    })();
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
      if (command === 'open') {
        openDocument();
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
    [addTab, closeTabById, openDocument, openSettings],
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
      if (key === 'o') {
        event.preventDefault();
        openDocument();
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
  }, [addTab, openDocument, openSettings]);

  if (activeTab === undefined) {
    return null;
  }

  return (
    <div className="shell">
      <ThemeSync />
      <FocusCycle />
      <TitleBar />
      <MenuBar onCommand={onMenuCommand} />
      {openMessage !== null ? (
        <div className="open-notice" role="alert" data-open-notice="">
          <p className="open-notice-text">{openMessage}</p>
          <button type="button" className="open-notice-close" onClick={() => setOpenMessage(null)}>
            Close
          </button>
        </div>
      ) : null}
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
