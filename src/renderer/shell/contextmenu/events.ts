import type { ContextMenuTarget } from './target.js';

export const CONTEXT_MENU_REQUEST = 'obelisk:context-menu-request';
export const CONTEXT_MENU_RESTORE_FOCUS = 'obelisk:context-menu-restore-focus';

export interface ContextMenuRequestDetail extends ContextMenuTarget {
  tabId: string;
  spelling?: { word: string; suggestions: string[] } | null;
}

export interface ContextMenuRestoreDetail {
  tabId: string;
  selectionAnchor: number;
  selectionHead: number;
  keepSelection?: boolean;
}

export function dispatchContextMenuRequest(detail: ContextMenuRequestDetail): void {
  window.dispatchEvent(new CustomEvent(CONTEXT_MENU_REQUEST, { detail }));
}

export function dispatchContextMenuRestoreFocus(detail: ContextMenuRestoreDetail): void {
  window.dispatchEvent(new CustomEvent(CONTEXT_MENU_RESTORE_FOCUS, { detail }));
}