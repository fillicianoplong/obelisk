import { APP_NAME } from '../../../shared/app-info.js';

export interface TabCloseTarget {
  id: string;
  unsaved: boolean;
}

export interface ClosePrompt {
  tabId: string;
}

export type ClosePromptChoice = 'save' | 'discard' | 'cancel';

export type CloseTabResult =
  | { action: 'missing' }
  | { action: 'prompt'; prompt: ClosePrompt; activeId: string | null }
  | { action: 'close'; activeId: string | null };

export const CLOSE_TITLE = APP_NAME;

export function closePromptMessage(tabTitle: string): string {
  return `Save changes to ${tabTitle} before closing?`;
}

export const CLOSE_CHOICES = [
  { choice: 'save', label: 'Save' },
  { choice: 'discard', label: 'Discard' },
  { choice: 'cancel', label: 'Cancel' },
] as const;

function nextActiveId(
  tabs: readonly TabCloseTarget[],
  index: number,
  tabId: string,
  activeId: string,
): string | null {
  if (activeId !== tabId) {
    return tabs.some((tab) => tab.id === activeId) ? activeId : null;
  }
  return tabs[index + 1]?.id ?? tabs[index - 1]?.id ?? null;
}

/**
 * The only close path for Ctrl+W, the close button, and File > Close tab.
 * An unchanged tab closes. The tab on its right becomes active, or the tab
 * on its left when the closed tab was the last one.
 * A changed tab does not close unless force is set. The shell shows Save,
 * Discard, or Cancel for that tab (FR-16).
 */
export function closeTab(
  tabs: readonly TabCloseTarget[],
  tabId: string,
  activeId: string,
  options?: { force?: boolean },
): CloseTabResult {
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) {
    return { action: 'missing' };
  }
  const nextActive = nextActiveId(tabs, index, tabId, activeId);
  if (tabs[index].unsaved && options?.force !== true) {
    return { action: 'prompt', prompt: { tabId }, activeId: nextActive };
  }
  return { action: 'close', activeId: nextActive };
}

export function firstUnsavedTabId(
  tabs: readonly TabCloseTarget[],
  activeId: string,
): string | null {
  const active = tabs.find((tab) => tab.id === activeId);
  if (active?.unsaved) {
    return active.id;
  }
  const found = tabs.find((tab) => tab.unsaved);
  return found?.id ?? null;
}
