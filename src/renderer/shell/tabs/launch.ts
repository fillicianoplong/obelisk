import type { FileOpenResult } from '../../../shared/ipc/types.js';
import { applyOpenResult } from './opened.js';
import { createTab, type PageTab } from './model.js';

export { isReplaceableUntitledTab } from './model.js';

export interface StartupTabs {
  tabs: PageTab[];
  activeId: string;
  nextUntitledNumber: number;
  message: string | null;
}

function e2eOpenDocument(): boolean {
  return typeof window !== 'undefined' && window.obeliskE2e?.openDocument === true;
}

/** After cold-start file:activated events, open tabs or one Untitled when nothing opened. */
export function startupTabsAfterLaunch(
  launchResults: readonly FileOpenResult[],
  firstUntitledNumber = 1,
): StartupTabs {
  let tabs: PageTab[] = [];
  let activeId = '';
  let message: string | null = null;
  const nextUntitledNumber = firstUntitledNumber;

  for (const result of launchResults) {
    const applied = applyOpenResult(tabs, activeId, result);
    tabs = applied.tabs;
    activeId = applied.activeId;
    if (applied.message !== null) {
      message = applied.message;
    }
  }

  if (tabs.length === 0) {
    if (e2eOpenDocument()) {
      const tab = createTab(firstUntitledNumber);
      return {
        tabs: [tab],
        activeId: tab.id,
        nextUntitledNumber: firstUntitledNumber + 1,
        message,
      };
    }
    return {
      tabs: [],
      activeId: '',
      nextUntitledNumber: firstUntitledNumber,
      message,
    };
  }

  return {
    tabs,
    activeId,
    nextUntitledNumber,
    message,
  };
}
