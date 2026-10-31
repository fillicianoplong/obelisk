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

/** After cold-start file:activated events, open tabs or one Untitled when nothing opened. */
export function startupTabsAfterLaunch(
  launchResults: readonly FileOpenResult[],
  firstUntitledNumber = 1,
): StartupTabs {
  let tabs: PageTab[] = [];
  let activeId = '';
  let message: string | null = null;
  let nextUntitledNumber = firstUntitledNumber;

  for (const result of launchResults) {
    const applied = applyOpenResult(tabs, activeId, result);
    tabs = applied.tabs;
    activeId = applied.activeId;
    if (applied.message !== null) {
      message = applied.message;
    }
  }

  if (tabs.length === 0) {
    const tab = createTab(nextUntitledNumber);
    nextUntitledNumber += 1;
    return {
      tabs: [tab],
      activeId: tab.id,
      nextUntitledNumber,
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
