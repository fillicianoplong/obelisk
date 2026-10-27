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
 * A changed tab does not close unless force is set. confirmClosePrompt is
 * where W-26 (#26) asks to save, discard, or cancel.
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

/**
 * W-26 (#26) shows Save, Discard, or Cancel for this tab.
 * There is no prompt yet, so the close is cancelled and the tab stays open.
 */
export function confirmClosePrompt(_prompt: ClosePrompt): ClosePromptChoice {
  return 'cancel';
}
