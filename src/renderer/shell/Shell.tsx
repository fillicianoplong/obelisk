import type { EditorState } from 'prosemirror-state';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { editorUpdatesAreSynchronous } from '../editor/flush.js';
import { setSpellcheckEnabled } from '../editor/spellcheck-mode.js';
import type { BandEdit } from '../editor/header/PageBands.js';
import { pageSetupFromUnknown, type PageSetupValue } from './page-setup/model.js';
import { holdAnchorForZoom, holdCaretAnchor } from '../editor/layout/paginate-plugin.js';
import { editorText } from '../editor/state.js';
import { rememberCorrect } from '../editor/spell/client.js';
import { spellingSuggestionAt, spellingWordToAdd, startSpellContextListener } from './spellcheck/context.js';
import type {
  ExportFormat,
  FileOpenResult,
  FileSaveAsResult,
  FileSaveResult,
  FileStat,
} from '../../shared/ipc/types.js';
import { FocusCycle } from './focus/FocusCycle.js';
import { STATUS_BAR_LABEL } from './focus/regions.js';
import { ContextMenu } from './contextmenu/ContextMenu.js';
import { MenuBar } from './menus/MenuBar.js';
import { PageArea } from './PageArea.js';
import { runActiveEditorMenuCommand } from './run-editor-menu.js';
import { suppressPageFocusRing } from './page-focus.js';
import { LinkDialog } from './link/LinkDialog.js';
import { DateTimeDialog } from './date-time/DateTimeDialog.js';
import { PageSetupDialog } from './page-setup/PageSetupDialog.js';
import { ExportDialog } from './export/ExportDialog.js';
import { emptyExportAssets } from './export/assets.js';
import { exportFormatFromCommand } from './export/model.js';
import { EDITOR_SHELL_COMMAND, type EditorShellCommandDetail } from '../editor/editor-command-event.js';
import type { LinkDraft } from '../editor/link/commands.js';
import type { DateTimeDraft } from '../editor/date-time/commands.js';
import type { DateChipFormat } from '../../shared/date-time/format.js';
import { editShellShortcut, linkShellShortcut, shellShortcut } from './shortcuts.js';
import {
  applyWheelSteps,
  consumeZoomWheel,
  zoomCommandResult,
  zoomFromSaved,
  zoomShortcut,
  type ZoomCommand,
  type ZoomPreset,
} from '../../shared/zoom.js';
import { FindBar } from './find/FindBar.js';
import { StatusBar } from './statusbar/StatusBar.js';
import { ClosePrompt } from './tabs/ClosePrompt.js';
import { closeTab, firstUnsavedTabId } from './tabs/close.js';
import type { ClosePromptChoice } from './tabs/close.js';
import { PAGE_LABEL, statusViewLabel } from './statusbar/model.js';
import {
  ABOUT_TAB_ID,
  SETTINGS_TAB_ID,
  createMlaTab,
  createAboutTab,
  createSettingsTab,
  isShellTab,
  createTab,
  documentView,
  rememberDocumentView,
  tabHasUnsavedChanges,
  withBand,
  withDocumentView,
  withPageSetup,
} from './tabs/model.js';
import type { PageTab } from './tabs/model.js';
import { applyOpenResult } from './tabs/opened.js';
import { startupTabsAfterLaunch } from './tabs/launch.js';
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
import './find/find-bar.css';
import './page-setup/page-setup.css';
import './preferences/preferences.css';
import './export/export-dialog.css';
import './date-time/date-time-dialog.css';

type SaveWaitResult = 'saved' | 'cancelled' | 'failed' | 'conflict';

function editorPageCommands(): {
  linkDraft?: () => LinkDraft | null;
  linkAddress?: () => string | null;
  applyLink?: (text: string, address: string) => boolean;
  dateTimeDraft?: () => DateTimeDraft | null;
  dateTimeFormatDraft?: () => DateTimeDraft | null;
  applyDateTime?: (dateTime: string, format: DateChipFormat, mode: DateTimeDraft['mode']) => boolean;
} | null {
  const page = document.querySelector<HTMLElement>('[data-region="page-editor"]');
  if (page === null) {
    return null;
  }
  const commands = (page as HTMLElement & {
    editorCommands?: {
      linkDraft?: () => LinkDraft | null;
      linkAddress?: () => string | null;
      applyLink?: (text: string, address: string) => boolean;
      dateTimeDraft?: () => DateTimeDraft | null;
      dateTimeFormatDraft?: () => DateTimeDraft | null;
      applyDateTime?: (dateTime: string, format: DateChipFormat, mode: DateTimeDraft['mode']) => boolean;
    };
  }).editorCommands;
  return commands ?? null;
}

export function Shell() {
  const [tabs, setTabs] = useState<PageTab[]>([]);
  const [activeId, setActiveId] = useState('');
  const [shellReady, setShellReady] = useState(false);
  const [closePromptId, setClosePromptId] = useState<string | null>(null);
  const [openMessage, setOpenMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ tabId: string; stat: FileStat } | null>(null);
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [linkDialog, setLinkDialog] = useState<LinkDraft | null>(null);
  const linkDialogRef = useRef(linkDialog);
  linkDialogRef.current = linkDialog;
  const [dateTimeDialog, setDateTimeDialog] = useState<DateTimeDraft | null>(null);
  const dateTimeDialogRef = useRef(dateTimeDialog);
  dateTimeDialogRef.current = dateTimeDialog;
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const exportDialogOpenRef = useRef(exportDialogOpen);
  exportDialogOpenRef.current = exportDialogOpen;
  const [bandEdit, setBandEdit] = useState<BandEdit | null>(null);
  const bandEditRef = useRef(bandEdit);
  bandEditRef.current = bandEdit;
  const pageSetupOpenRef = useRef(pageSetupOpen);
  pageSetupOpenRef.current = pageSetupOpen;
  const [spellingOn, setSpellingOn] = useState(true);
  const [showPageEdges, setShowPageEdges] = useState(true);
  const [zoom, setZoom] = useState<ZoomPreset>(() => zoomFromSaved(window.obeliskZoom));
  const [pageLabel, setPageLabel] = useState(PAGE_LABEL);
  const nextNumber = useRef(1);
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
        if (!tab || tab.revision !== revision || isShellTab(tab) || !tab.handle) {
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

  const addMlaTab = useCallback(() => {
    const number = nextNumber.current;
    nextNumber.current += 1;
    const tab = createMlaTab(number);
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
      if (!tab || isShellTab(tab)) {
        return 'failed';
      }
      saving.current = true;
      suppressPageFocusRing();
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
        suppressPageFocusRing();
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

  useLayoutEffect(() => {
    const launchResults: FileOpenResult[] = [];
    let launchFinished = false;

    const subscriptionId = window.obelisk['file:activated'].subscribe((result) => {
      if (!launchFinished) {
        launchResults.push(result);
        return;
      }
      const applied = applyOpenResult(tabsRef.current, activeIdRef.current, result);
      tabsRef.current = applied.tabs;
      activeIdRef.current = applied.activeId;
      setTabs(applied.tabs);
      setActiveId(applied.activeId);
      setOpenMessage(applied.message);
    });

    const startup = startupTabsAfterLaunch(launchResults);
    tabsRef.current = startup.tabs;
    activeIdRef.current = startup.activeId;
    nextNumber.current = startup.nextUntitledNumber;
    setTabs(startup.tabs);
    setActiveId(startup.activeId);
    setOpenMessage(startup.message);
    launchFinished = true;
    setShellReady(true);

    return () => {
      window.obelisk['file:activated'].unsubscribe(subscriptionId);
    };
  }, []);

  const openDocument = useCallback(() => {
    if (opening.current) {
      return;
    }
    opening.current = true;
    suppressPageFocusRing();
    void (async () => {
      let result: FileOpenResult;
      try {
        result = await window.obelisk['file:open']();
      } catch {
        setOpenMessage('This file could not be opened.');
        return;
      } finally {
        opening.current = false;
        suppressPageFocusRing();
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

  const openFindBar = useCallback((replace: boolean) => {
    if (activeTab === undefined || isShellTab(activeTab)) {
      return;
    }
    const page = document.querySelector<HTMLElement>('[data-region="page-editor"]');
    const commands = (page as HTMLElement & {
      editorCommands?: {
        findOpen?: (options: { showReplace?: boolean }) => void;
        findSnapshot?: () => { open: boolean };
      };
    } | null)?.editorCommands;
    if (commands?.findOpen === undefined) {
      return;
    }
    commands.findOpen({ showReplace: replace });
    setFindBarOpen(true);
  }, [activeTab]);

  const openSettings = useCallback(() => {
    setTabs((current) => {
      if (current.some((tab) => tab.id === SETTINGS_TAB_ID)) {
        return current;
      }
      return [...current, createSettingsTab()];
    });
    setActiveId(SETTINGS_TAB_ID);
  }, []);

  const openAbout = useCallback(() => {
    setTabs((current) => {
      if (current.some((tab) => tab.id === ABOUT_TAB_ID)) {
        return current;
      }
      return [...current, createAboutTab()];
    });
    setActiveId(ABOUT_TAB_ID);
  }, []);

  useEffect(() => {
    startSpellContextListener();
    let current = true;
    void Promise.all([
      window.obelisk['prefs:get']({ key: 'spelling' }),
      window.obelisk['prefs:get']({ key: 'showPageEdges' }),
    ]).then(([spelling, edges]) => {
      if (!current) {
        return;
      }
      if (spelling.status === 'ok' && spelling.key === 'spelling') {
        setSpellingOn(spelling.value);
        setSpellcheckEnabled(spelling.value);
      }
      if (edges.status === 'ok' && edges.key === 'showPageEdges') {
        setShowPageEdges(edges.value);
      }
    }).catch(() => {
      // Spell check stays on when settings cannot be read.
    });
    return () => {
      current = false;
    };
  }, []);

  const spellingOnRef = useRef(spellingOn);
  spellingOnRef.current = spellingOn;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const wheelAccum = useRef(0);

  const applyZoom = useCallback((next: ZoomPreset) => {
    const resolved = zoomFromSaved(next);
    if (resolved === zoomRef.current) {
      return;
    }
    holdAnchorForZoom();
    zoomRef.current = resolved;
    setZoom(resolved);
    void window.obelisk['prefs:set']({ key: 'zoom', value: resolved }).catch(() => {
      // The page keeps the chosen zoom when the preference file cannot be written.
    });
  }, []);

  const runZoomCommand = useCallback((command: ZoomCommand) => {
    applyZoom(zoomCommandResult(zoomRef.current, command));
  }, [applyZoom]);

  const runExport = useCallback(async (format: ExportFormat) => {
    const tab = tabsRef.current.find((item) => item.id === activeIdRef.current);
    if (tab === undefined || isShellTab(tab)) {
      return;
    }
    setExportDialogOpen(false);
    const built = documentForTab(tab);
    try {
      const result = await window.obelisk['export:run']({
        format,
        handle: tab.handle ?? null,
        document: built.document,
        assets: emptyExportAssets(),
      });
      if (result.status === 'error' || result.status === 'timeout') {
        setOpenMessage(result.message);
      }
    } catch {
      setOpenMessage('The export failed.');
    }
  }, []);

  const toggleSpelling = useCallback(() => {
    const next = !spellingOnRef.current;
    setSpellingOn(next);
    if (!next) {
      setSpellcheckEnabled(false);
    }
    void window.obelisk['prefs:set']({ key: 'spelling', value: next }).then(() => {
      if (next) {
        setSpellcheckEnabled(true);
      }
    }).catch(() => {
      setSpellcheckEnabled(next);
    });
  }, []);

  const onMenuCommand = useCallback(
    (command: string) => {
      if (command === 'new') {
        addTab();
        return;
      }
      if (command === 'new-mla') {
        addMlaTab();
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
      if (command === 'about') {
        openAbout();
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
      if (command === 'export') {
        if (linkDialogRef.current === null && dateTimeDialogRef.current === null && !pageSetupOpenRef.current) {
          const active = tabsRef.current.find((tab) => tab.id === activeIdRef.current);
          if (active !== undefined && !isShellTab(active)) {
            setExportDialogOpen(true);
          }
        }
        return;
      }
      const exportFormat = exportFormatFromCommand(command);
      if (exportFormat !== null) {
        void runExport(exportFormat);
        return;
      }
      if (command === 'edit-find') {
        openFindBar(false);
        return;
      }
      if (command === 'edit-replace') {
        openFindBar(true);
        return;
      }
      if (command === 'insert-link' || command === 'link-edit') {
        if (pageSetupOpenRef.current || dateTimeDialogRef.current !== null) {
          return;
        }
        const draft = editorPageCommands()?.linkDraft?.() ?? null;
        setLinkDialog(draft);
        return;
      }
      if (command === 'insert-date-time' || command === 'date-time-edit') {
        if (pageSetupOpenRef.current || linkDialogRef.current !== null) {
          return;
        }
        const draft = editorPageCommands()?.dateTimeDraft?.() ?? null;
        setDateTimeDialog(draft);
        return;
      }
      if (command === 'date-time-format') {
        if (pageSetupOpenRef.current || linkDialogRef.current !== null) {
          return;
        }
        const draft = editorPageCommands()?.dateTimeFormatDraft?.() ?? null;
        setDateTimeDialog(draft);
        return;
      }
      if (command === 'format-header') {
        const active = tabsRef.current.find((tab) => tab.id === activeIdRef.current);
        if (active === undefined || isShellTab(active) || documentView(active) === 'pageless') {
          return;
        }
        const page = document.querySelector<HTMLElement>('[data-region="page-editor"]') as HTMLElement & {
          editorCommands?: { pageSnapshot?: () => { page: number } };
        } | null;
        const caretPage = page?.editorCommands?.pageSnapshot?.().page ?? 1;
        setBandEdit({ part: 'header', page: caretPage });
        return;
      }
      if (
        command === 'insert-page-count'
        || command === 'insert-page-number-decimal'
        || command === 'insert-page-number-roman'
        || command === 'insert-page-number-page-of-n'
      ) {
        if (bandEditRef.current === null) {
          return;
        }
        runActiveEditorMenuCommand(command);
        return;
      }
      if (command === 'format-page-setup') {
        if (linkDialogRef.current !== null || dateTimeDialogRef.current !== null) {
          return;
        }
        const active = tabsRef.current.find((tab) => tab.id === activeIdRef.current);
        if (active !== undefined && !isShellTab(active) && documentView(active) !== 'pageless') {
          setPageSetupOpen(true);
        }
        return;
      }
      if (command === 'link-open') {
        const address = editorPageCommands()?.linkAddress?.() ?? null;
        if (address !== null) {
          void window.obelisk['link:open']({ address }).catch(() => {
            // A refused or cancelled open leaves the document unchanged.
          });
        }
        return;
      }
      if (command === 'tools-spelling') {
        toggleSpelling();
        return;
      }
      if (command === 'view-zoom-in' || command === 'view-zoom-out' || command === 'view-zoom-100') {
        runZoomCommand(command);
        return;
      }
      if (command === 'spell-add') {
        const word = spellingWordToAdd();
        if (word !== null) {
          void window.obelisk['spell:add']({ word }).then((result) => {
            if (result.status === 'ok') {
              rememberCorrect(word);
            }
          }).catch(() => {
            // A failed add leaves the underline.
          });
        }
        return;
      }
      if (command.startsWith('spell-replace:')) {
        const index = Number(command.slice('spell-replace:'.length));
        const picked = spellingSuggestionAt(index);
        const page = document.querySelector<HTMLElement>('[data-region="page-editor"]');
        const commands = page as HTMLElement & {
          editorCommands?: { replaceSpelling?: (word: string, suggestion: string) => void };
        } | null;
        if (picked !== null && commands?.editorCommands?.replaceSpelling !== undefined) {
          commands.editorCommands.replaceSpelling(picked.word, picked.suggestion);
        }
        return;
      }
      if (command === 'view-pages' || command === 'view-pageless') {
        setBandEdit(null);
        const nextView = command === 'view-pageless' ? 'pageless' : 'pages';
        const active = tabsRef.current.find((tab) => tab.id === activeIdRef.current);
        if (active === undefined || isShellTab(active) || documentView(active) === nextView) {
          return;
        }
        rememberDocumentView(nextView);
        void window.obelisk['prefs:set']({ key: 'view', value: nextView }).catch(() => {
          // The page keeps the chosen view when the preference file cannot be written.
        });
        const page = document.querySelector<HTMLElement>('[data-region="page-editor"]');
        const editorView = (page as HTMLElement & { editorView?: { coordsAtPos: (pos: number) => { top: number }; state: { selection: { head: number } } } } | null)?.editorView;
        if (editorView !== undefined) {
          try {
            holdCaretAnchor(editorView.coordsAtPos(editorView.state.selection.head).top);
          } catch {
            // Keep the current scroll when the caret cannot be measured.
          }
        }
        setTabs((current) => {
          const next = current.map((tab) => {
            if (tab.id !== active.id) {
              return tab;
            }
            const updated = withDocumentView(tab, nextView);
            if (updated !== tab) {
              syncTabAutosave(autosaveScheduler.current, updated);
            }
            return updated;
          });
          tabsRef.current = next;
          return next;
        });
        return;
      }
      if (runActiveEditorMenuCommand(command)) {
        return;
      }
    },
    [addMlaTab, addTab, closeTabById, openAbout, openDocument, openFindBar, openSettings, requestExit, runExport, runSave, runZoomCommand, toggleSpelling],
  );

  const menuContext = useMemo(() => {
    const documentTab = activeTab !== undefined && !isShellTab(activeTab);
    const editorState = documentTab ? activeTab.editor : null;
    const selectionEmpty = editorState?.selection.empty ?? true;
    return {
      documentTab,
      selectionEmpty,
      editorState: editorState ?? null,
      spelling: spellingOn,
      documentView: documentTab ? documentView(activeTab) : 'pages',
      zoom,
      bandEditing: documentTab && documentView(activeTab) === 'pages' && bandEdit !== null,
    };
  }, [activeTab, spellingOn, zoom, bandEdit]);

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

  useLayoutEffect(() => {
    if (activeTab === undefined || isShellTab(activeTab)) {
      setFindBarOpen(false);
      return;
    }
    queueMicrotask(() => {
      const page = document.querySelector<HTMLElement>('[data-region="page-editor"]');
      const snap = (page as HTMLElement & {
        editorCommands?: { findSnapshot?: () => { open: boolean } };
      } | null)?.editorCommands?.findSnapshot?.();
      if (snap !== undefined) {
        setFindBarOpen(snap.open);
      }
    });
  }, [activeTab?.id, activeTab?.kind]);

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
      const zoomCommand = zoomShortcut(event);
      if (zoomCommand !== null) {
        event.preventDefault();
        runZoomCommand(zoomCommand);
        return;
      }
      const editCommand = editShellShortcut(event);
      if (editCommand !== null) {
        event.preventDefault();
        onMenuCommand(editCommand);
        return;
      }
      const linkCommand = linkShellShortcut(event);
      if (linkCommand !== null && linkDialogRef.current === null && dateTimeDialogRef.current === null) {
        event.preventDefault();
        onMenuCommand(linkCommand);
        return;
      }
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
      if (command === 'export') {
        onMenuCommand('export');
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
  }, [addTab, onMenuCommand, openDocument, openSettings, runSave, runZoomCommand]);

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (event.altKey || !(event.ctrlKey || event.metaKey)) {
        return;
      }
      event.preventDefault();
      const turned = consumeZoomWheel(wheelAccum.current, event.deltaY, event.deltaMode);
      wheelAccum.current = turned.accumulated;
      if (turned.steps === 0) {
        return;
      }
      applyZoom(applyWheelSteps(zoomRef.current, turned.steps));
    };
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true });
    };
  }, [applyZoom]);

  useEffect(() => {
    // The slash menu's Link item and the link bubble's Edit open the same dialog as Ctrl+K.
    function onEditorCommand(event: Event) {
      const detail = (event as CustomEvent<EditorShellCommandDetail>).detail;
      const command = detail?.command;
      if (command === 'link-open' && typeof detail?.address === 'string') {
        // The link bubble and Ctrl+click: the main process asks before it opens anything.
        void window.obelisk['link:open']({ address: detail.address }).catch(() => {
          // A refused or cancelled open leaves the document unchanged.
        });
        return;
      }
      if ((command === 'insert-link' || command === 'link-edit') && linkDialogRef.current === null && dateTimeDialogRef.current === null) {
        onMenuCommand(command);
      }
      if (
        (command === 'insert-date-time' || command === 'date-time-edit' || command === 'date-time-format')
        && dateTimeDialogRef.current === null
        && linkDialogRef.current === null
      ) {
        onMenuCommand(command);
      }
    }
    window.addEventListener(EDITOR_SHELL_COMMAND, onEditorCommand);
    return () => {
      window.removeEventListener(EDITOR_SHELL_COMMAND, onEditorCommand);
    };
  }, [onMenuCommand]);

  if (!shellReady || activeTab === undefined) {
    return null;
  }

  return (
    <div className="shell" data-show-page-edges={showPageEdges ? 'true' : 'false'}>
      <ThemeSync />
      <FocusCycle />
      <TitleBar />
      <MenuBar menuContext={menuContext} onCommand={onMenuCommand} />
      {!isShellTab(activeTab) ? (
        <ContextMenu tabId={activeTab.id} menuContext={menuContext} onCommand={onMenuCommand} />
      ) : null}
      {pageSetupOpen && linkDialog === null && dateTimeDialog === null && conflict === null && closePromptTab === undefined
        && !isShellTab(activeTab) ? (
        <PageSetupDialog
          initial={pageSetupFromUnknown(activeTab.baseDocument.page)}
          onCancel={() => {
            setPageSetupOpen(false);
            document.querySelector<HTMLElement>('[data-region="page-editor"]')?.focus();
          }}
          onApply={(page: PageSetupValue) => {
            setPageSetupOpen(false);
            setTabs((current) => {
              const next = current.map((tab) => {
                if (tab.id !== activeIdRef.current) {
                  return tab;
                }
                const updated = withPageSetup(tab, page);
                if (updated !== tab) {
                  syncTabAutosave(autosaveScheduler.current, updated);
                }
                return updated;
              });
              tabsRef.current = next;
              return next;
            });
            document.querySelector<HTMLElement>('[data-region="page-editor"]')?.focus();
          }}
        />
      ) : null}
      {exportDialogOpen && linkDialog === null && dateTimeDialog === null && conflict === null && closePromptTab === undefined
        && !isShellTab(activeTab) ? (
        <ExportDialog
          onCancel={() => {
            setExportDialogOpen(false);
            document.querySelector<HTMLElement>('[data-region="page-editor"]')?.focus();
          }}
          onChoose={(format) => {
            void runExport(format);
          }}
        />
      ) : null}
      {linkDialog !== null && dateTimeDialog === null && conflict === null && closePromptTab === undefined ? (
        <LinkDialog
          draft={linkDialog}
          onCancel={() => setLinkDialog(null)}
          onSubmit={(text, address) => {
            const applied = editorPageCommands()?.applyLink?.(text, address) === true;
            if (!applied) {
              return 'Link address is not allowed.';
            }
            setLinkDialog(null);
            return null;
          }}
        />
      ) : null}
      {dateTimeDialog !== null && linkDialog === null && conflict === null && closePromptTab === undefined ? (
        <DateTimeDialog
          draft={dateTimeDialog}
          onCancel={() => setDateTimeDialog(null)}
          onSubmit={(dateTime, format) => {
            const applied = editorPageCommands()?.applyDateTime?.(dateTime, format, dateTimeDialog.mode) === true;
            if (!applied) {
              return 'Date and time could not be applied.';
            }
            setDateTimeDialog(null);
            return null;
          }}
        />
      ) : null}
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
        viewMode={documentView(activeTab)}
        orientation={pageSetupFromUnknown(activeTab.baseDocument.page).orientation}
        margins={pageSetupFromUnknown(activeTab.baseDocument.page).margins}
        header={activeTab.baseDocument.header}
        footer={activeTab.baseDocument.footer}
        bandEdit={documentView(activeTab) === 'pages' ? bandEdit : null}
        zoom={zoom}
        onChange={updateEditor}
        onPageLabel={setPageLabel}
        onBandEdit={(part, page) => setBandEdit({ part, page })}
        onBandClose={(reason) => {
          const editedPage = bandEditRef.current?.page ?? 1;
          setBandEdit(null);
          const page = document.querySelector<HTMLElement & {
            editorCommands?: { focusEditedPage?: (pageNumber: number) => void };
          }>('[data-region="page-editor"]');
          if (reason === 'escape') {
            page?.editorCommands?.focusEditedPage?.(editedPage);
            return;
          }
          page?.focus();
        }}
        onBandChange={(part, paragraph) => {
          setTabs((current) => {
            const next = current.map((tab) => {
              if (tab.id !== activeIdRef.current) {
                return tab;
              }
              const updated = withBand(tab, part, paragraph);
              if (updated !== tab) {
                syncTabAutosave(autosaveScheduler.current, updated);
              }
              return updated;
            });
            tabsRef.current = next;
            return next;
          });
        }}
        onBandMove={() => {
          setBandEdit((current) => (
            current === null
              ? null
              : { ...current, part: current.part === 'header' ? 'footer' : 'header' }
          ));
        }}
        onShowPageEdgesChange={setShowPageEdges}
        onSpellingPrefChange={(enabled) => {
          setSpellingOn(enabled);
          setSpellcheckEnabled(enabled);
        }}
        find={isShellTab(activeTab) ? null : (
          <FindBar visible={findBarOpen} onVisibilityChange={setFindBarOpen} />
        )}
      />
      {isShellTab(activeTab) ? (
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
          pageLabel={pageLabel}
          viewName={statusViewLabel(documentView(activeTab))}
          zoom={zoom}
          onZoom={applyZoom}
        />
      )}
    </div>
  );
}
