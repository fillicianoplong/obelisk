import type { EditorState } from 'prosemirror-state';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { editorUpdatesAreSynchronous } from '../editor/flush.js';
import { editorText } from '../editor/state.js';
import type { FileOpenResult, FileSaveAsResult, FileSaveResult, FileStat } from '../../shared/ipc/types.js';
import { FocusCycle } from './focus/FocusCycle.js';
import { STATUS_BAR_LABEL } from './focus/regions.js';
import { MenuBar } from './menus/MenuBar.js';
import { PageArea } from './PageArea.js';
import { runActiveEditorFormatCommand } from './run-editor-format.js';
import { shellShortcut } from './shortcuts.js';
import { StatusBar } from './statusbar/StatusBar.js';
import { ClosePrompt } from './tabs/ClosePrompt.js';
import { closeTab, firstUnsavedTabId } from './tabs/close.js';
import type { ClosePromptChoice } from './tabs/close.js';
import { SETTINGS_TAB_ID, createSettingsTab, createTab, tabHasUnsavedChanges } from './tabs/model.js';
import type { PageTab } from './tabs/model.js';
import { applyOpenResult } from './tabs/opened.js';
import { SaveConflict } from './tabs/SaveConflict.js';
import {
  EXISTS_MESSAGE,
  applySavedTab,
  documentForTab,
  markSaveFailed,
  markSaveIdle,
  markSaving,
  noteEditorChange,
  saveAsRequest,
  saveRequest,
  sessionHandles,
  tabSaveState,
} from './tabs/save.js';
import type { ConflictChoice } from './tabs/save.js';
import { TabStrip } from './tabs/TabStrip.js';
import { ThemeSync } from './theme/ThemeSync.js';
import { TitleBar } from './TitleBar.js';
import { createAutosaveClock } from '../autosave/clock.js';
import { pauseAutosave } from '../autosave/model.js';
import { createAutosaveScheduler } from '../autosave/scheduler.js';
import { syncTabAutosave } from '../autosave/sync.js';
import './shell.css';

type SaveWaitResult = 'saved' | 'cancelled' | 'failed' | 'conflict';

export function Shell() {
  const [tabs, setTabs] = useState<PageTab[]>(() => [createTab(1)]);
  const [activeId, setActiveId] = useState('untitled-1');
  const [closePromptId, setClosePromptId] = useState<string | null>(null);
  const [openMessage, setOpenMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ tabId: string; stat: FileStat } | null>(null);
  const nextNumber = useRef(2);
  const opening = useRef(false);
  const saving = useRef(false);
  const conflictRef = useRef<{ tabId: string; stat: FileStat } | null>(null);
  const quittingRef = useRef(false);
  const allowUnloadRef = useRef(false);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const autosaveScheduler = useRef(
    createAutosaveScheduler({
      clock: createAutosaveClock(),
      onFire: (tabId, revision) => {
        const tab = tabsRef.current.find((item) => item.id === tabId);
        if (!tab || tab.revision !== revision || tab.kind === 'settings' || !tab.handle) {
          return;
        }
        void saveTabNowRef.current(tabId, 'save').finally(() => {
          const latest = tabsRef.current.find((item) => item.id === tabId);
          if (latest) {
            syncTabAutosave(autosaveScheduler.current, latest);
          }
        });
      },
    }),
  );
  const saveTabNowRef = useRef<
    (tabId: string, kind: 'save' | 'save-as', overwriteStat?: FileStat | null) => Promise<SaveWaitResult>
  >(async () => 'failed');

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  const closePromptTab = closePromptId === null ? undefined : tabs.find((tab) => tab.id === closePromptId);

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

  const putTab = useCallback((next: PageTab) => {
    const current = tabsRef.current.map((tab) => (tab.id === next.id ? next : tab));
    tabsRef.current = current;
    setTabs(current);
  }, []);

  const saveTabNow = useCallback(
    async (tabId: string, kind: 'save' | 'save-as', overwriteStat: FileStat | null = null): Promise<SaveWaitResult> => {
      if (saving.current || conflictRef.current !== null) {
        return 'failed';
      }
      const tab = tabsRef.current.find((item) => item.id === tabId);
      if (!tab || tab.kind === 'settings') {
        return 'failed';
      }
      saving.current = true;
      const savingTab = markSaving(tab);
      const built = documentForTab(savingTab);
      putTab(savingTab);
      try {
        let result: FileSaveResult | FileSaveAsResult;
        if (kind === 'save' && savingTab.handle) {
          const request = saveRequest(
            savingTab,
            built.document,
            overwriteStat ?? savingTab.stat,
            overwriteStat !== null,
          );
          if (!request) {
            putTab(markSaveFailed(tabsRef.current.find((item) => item.id === savingTab.id) ?? savingTab));
            setOpenMessage('The save failed, so it was not saved.');
            return 'failed';
          }
          result = await window.obelisk['file:save'](request);
        } else {
          result = await window.obelisk['file:saveAs'](saveAsRequest(savingTab, built.document));
        }
        const current = tabsRef.current.find((item) => item.id === savingTab.id) ?? savingTab;
        if (result.status === 'ok') {
          const next = applySavedTab(current, {
            revision: result.revision,
            stat: result.stat,
            document: built.document,
            blockIds: built.blockIds,
            handle: 'handle' in result ? result.handle : current.handle,
            name: 'name' in result ? result.name : undefined,
          });
          putTab(next);
          syncTabAutosave(autosaveScheduler.current, next);
          if (next.handle !== savingTab.handle) {
            const session = sessionHandles(tabsRef.current, activeIdRef.current);
            try {
              const response = await window.obelisk['session:set'](session);
              if (response.status !== 'ok') {
                setOpenMessage(response.status === 'error' ? response.message : 'The tab could not be updated.');
              }
            } catch {
              setOpenMessage('The tab could not be updated.');
            }
          }
          return 'saved';
        }
        if (result.status === 'cancelled') {
          const idle = markSaveIdle(current);
          putTab(idle);
          syncTabAutosave(autosaveScheduler.current, idle);
          return 'cancelled';
        }
        if (result.status === 'conflict') {
          putTab(markSaveIdle(current));
          const prompt = { tabId: current.id, stat: result.stat };
          conflictRef.current = prompt;
          setConflict(prompt);
          autosaveScheduler.current.cancel(current.id);
          return 'conflict';
        }
        const failed = markSaveFailed(current);
        putTab(failed);
        syncTabAutosave(autosaveScheduler.current, failed);
        setOpenMessage(result.status === 'exists' ? EXISTS_MESSAGE : result.message);
        return 'failed';
      } catch {
        const current = tabsRef.current.find((item) => item.id === savingTab.id);
        if (current) {
          const failed = markSaveFailed(current);
          putTab(failed);
          syncTabAutosave(autosaveScheduler.current, failed);
        }
        setOpenMessage('The save failed, so it was not saved.');
        return 'failed';
      } finally {
        saving.current = false;
      }
    },
    [putTab],
  );
  saveTabNowRef.current = saveTabNow;

  const runSave = useCallback(
    (kind: 'save' | 'save-as', overwriteStat: FileStat | null = null, tabId?: string) => {
      const id = tabId ?? activeIdRef.current;
      void saveTabNow(id, kind, overwriteStat);
    },
    [saveTabNow],
  );

  const finishQuit = useCallback(() => {
    quittingRef.current = false;
    allowUnloadRef.current = true;
    window.close();
  }, []);

  const continueQuitIfNeeded = useCallback(() => {
    if (!quittingRef.current) {
      return;
    }
    const targets = tabsRef.current.map((tab) => ({ id: tab.id, unsaved: tabHasUnsavedChanges(tab) }));
    const next = firstUnsavedTabId(targets, activeIdRef.current);
    if (next !== null) {
      setClosePromptId(next);
      return;
    }
    finishQuit();
  }, [finishQuit]);

  const applyCloseTab = useCallback(
    async (tabId: string) => {
      const existing = tabsRef.current;
      if (!existing.some((tab) => tab.id === tabId)) {
        return;
      }
      const currentActive = activeIdRef.current;
      const targets = existing.map((tab) => ({ id: tab.id, unsaved: tabHasUnsavedChanges(tab) }));
      const result = closeTab(targets, tabId, currentActive, { force: true });
      if (result.action !== 'close') {
        return;
      }
      const closing = existing.find((tab) => tab.id === tabId);
      const remaining = existing.filter((tab) => tab.id !== tabId);
      autosaveScheduler.current.cancel(tabId);
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
          quittingRef.current = false;
          return;
        }
      }
      if (remaining.length === 0) {
        if (quittingRef.current) {
          finishQuit();
          return;
        }
        const number = nextNumber.current;
        nextNumber.current += 1;
        const created = createTab(number);
        tabsRef.current = [created];
        activeIdRef.current = created.id;
        setTabs([created]);
        setActiveId(created.id);
        continueQuitIfNeeded();
        return;
      }
      const nextActive = result.activeId ?? remaining[0].id;
      tabsRef.current = remaining;
      activeIdRef.current = nextActive;
      setTabs(remaining);
      setActiveId(nextActive);
      continueQuitIfNeeded();
    },
    [continueQuitIfNeeded, finishQuit],
  );

  const closeTabById = useCallback((tabId: string) => {
    const existing = tabsRef.current;
    if (!existing.some((tab) => tab.id === tabId)) {
      return;
    }
    const currentActive = activeIdRef.current;
    const targets = existing.map((tab) => ({ id: tab.id, unsaved: tabHasUnsavedChanges(tab) }));
    const result = closeTab(targets, tabId, currentActive);
    if (result.action === 'missing') {
      return;
    }
    if (result.action === 'prompt') {
      quittingRef.current = false;
      setClosePromptId(result.prompt.tabId);
      return;
    }
    void applyCloseTab(tabId);
  }, [applyCloseTab]);

  const chooseClosePrompt = useCallback(
    (choice: ClosePromptChoice) => {
      const tabId = closePromptId;
      if (tabId === null) {
        return;
      }
      if (choice === 'cancel') {
        setClosePromptId(null);
        quittingRef.current = false;
        return;
      }
      void (async () => {
        if (choice === 'save') {
          const outcome = await saveTabNow(tabId, 'save');
          if (outcome !== 'saved') {
            if (outcome === 'conflict') {
              setClosePromptId(null);
              quittingRef.current = false;
            }
            return;
          }
        }
        setClosePromptId(null);
        await applyCloseTab(tabId);
      })();
    },
    [applyCloseTab, closePromptId, saveTabNow],
  );

  const requestExit = useCallback(() => {
    const targets = tabsRef.current.map((tab) => ({ id: tab.id, unsaved: tabHasUnsavedChanges(tab) }));
    const next = firstUnsavedTabId(targets, activeIdRef.current);
    if (next !== null) {
      quittingRef.current = true;
      setClosePromptId(next);
      return;
    }
    finishQuit();
  }, [finishQuit]);

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

  const chooseConflict = useCallback(
    (choice: ConflictChoice) => {
      const prompt = conflictRef.current;
      conflictRef.current = null;
      setConflict(null);
      if (!prompt) {
        return;
      }
      if (choice === 'cancel') {
        const tab = tabsRef.current.find((item) => item.id === prompt.tabId);
        if (tab) {
          const paused = pauseAutosave(tab);
          putTab(paused);
          autosaveScheduler.current.cancel(paused.id);
        }
        return;
      }
      if (choice === 'overwrite') {
        runSave('save', prompt.stat, prompt.tabId);
        return;
      }
      runSave('save-as', null, prompt.tabId);
    },
    [putTab, runSave],
  );

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
      if (command === 'exit') {
        requestExit();
        return;
      }
      if (command === 'settings') {
        openSettings();
        return;
      }
      if (command === 'save') {
        runSave('save');
        return;
      }
      if (command === 'save-as') {
        runSave('save-as');
        return;
      }
      if (runActiveEditorFormatCommand(command)) {
        return;
      }
    },
    [addTab, closeTabById, openDocument, openSettings, requestExit, runSave],
  );

  const updateEditor = useCallback((tabId: string, editor: EditorState) => {
    const apply = () => {
      setTabs((current) => {
        const next = current.map((tab) => {
          if (tab.id !== tabId) {
            return tab;
          }
          const updated = noteEditorChange(tab, editor);
          syncTabAutosave(autosaveScheduler.current, updated);
          return updated;
        });
        tabsRef.current = next;
        return next;
      });
    };
    if (editorUpdatesAreSynchronous()) {
      flushSync(apply);
    } else {
      apply();
    }
  }, []);

  useEffect(() => {
    return () => {
      autosaveScheduler.current.cancelAll();
    };
  }, []);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (allowUnloadRef.current) {
        return;
      }
      const targets = tabsRef.current.map((tab) => ({ id: tab.id, unsaved: tabHasUnsavedChanges(tab) }));
      if (firstUnsavedTabId(targets, activeIdRef.current) === null) {
        return;
      }
      event.preventDefault();
      event.returnValue = '';
      if (!quittingRef.current) {
        requestExit();
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [requestExit]);

  useLayoutEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const command = shellShortcut(event);
      if (command === null) {
        return;
      }
      event.preventDefault();
      if (command === 'new') {
        addTab();
        return;
      }
      if (command === 'open') {
        openDocument();
        return;
      }
      if (command === 'settings') {
        openSettings();
        return;
      }
      if (command === 'save') {
        runSave('save');
        return;
      }
      runSave('save-as');
    }
    window.addEventListener('keydown', onKeyDown);
    // Present before the first paint, so a key cannot arrive before the command exists.
    document.documentElement.dataset.shellCommands = 'ready';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      delete document.documentElement.dataset.shellCommands;
    };
  }, [addTab, openDocument, openSettings, runSave]);

  if (activeTab === undefined) {
    return null;
  }

  return (
    <div className="shell">
      <ThemeSync />
      <FocusCycle />
      <TitleBar />
      <MenuBar onCommand={onMenuCommand} />
      {conflict !== null ? <SaveConflict onChoose={chooseConflict} /> : null}
      {closePromptTab !== undefined && conflict === null ? (
        <ClosePrompt tabTitle={closePromptTab.title} onChoose={chooseClosePrompt} />
      ) : null}
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
          saveState={tabSaveState(activeTab)}
        />
      )}
    </div>
  );
}
