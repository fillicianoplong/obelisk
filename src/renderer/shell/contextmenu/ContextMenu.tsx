import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { liveMenuEntries, type LiveMenuContext } from '../menus/apply.js';
import {
  keyboardOpenContextMenu,
  pointerActivate,
  pointerDismissContextMenu,
  pointerHoverItem,
  pointerOpenContextMenu,
  reduceMenuKey,
} from '../menus/keyboard.js';
import { resetPageFocusToPointer } from '../page-focus.js';
import type { MenuResult, MenuSession } from '../menus/keyboard.js';
import type { AppMenu } from '../menus/model.js';
import { focusMenuItemId, MenuItems } from '../menus/MenuTree.js';
import {
  CONTEXT_MENU_REQUEST,
  dispatchContextMenuRestoreFocus,
  type ContextMenuRequestDetail,
} from './events.js';
import { composeContextMenu, withSpellingSuggestions } from './model.js';
import { rememberSpellingTarget } from '../spellcheck/context.js';

export const CONTEXT_MENU_ID = 'context';
export const CONTEXT_MENU_LABEL = 'Context menu';

interface ContextMenuProps {
  tabId: string;
  menuContext: LiveMenuContext;
  onCommand: (command: string) => void;
}

interface OpenState {
  target: ContextMenuRequestDetail;
  session: MenuSession;
}

function clampPosition(host: HTMLElement, clientX: number, clientY: number): void {
  const margin = 8;
  const rect = host.getBoundingClientRect();
  let left = clientX;
  let top = clientY;
  const maxLeft = window.innerWidth - rect.width - margin;
  const maxTop = window.innerHeight - rect.height - margin;
  if (left > maxLeft) {
    left = Math.max(margin, maxLeft);
  }
  if (top > maxTop) {
    top = Math.max(margin, maxTop);
  }
  host.style.setProperty('--context-menu-left', `${left}px`);
  host.style.setProperty('--context-menu-top', `${top}px`);
}

function sessionClosed(session: MenuSession): boolean {
  return session.menuId === null && session.panels.length === 0 && !session.keyboard;
}

function pageEditor(): HTMLElement | null {
  const page = document.querySelector('[data-region="page-editor"]');
  return page instanceof HTMLElement ? page : null;
}

function keepsEditedSelection(id: string): boolean {
  return id === 'edit-cut' || id.startsWith('spell-replace:');
}

function restoreEditorFocus(tabId: string, target: ContextMenuRequestDetail, keepSelection: boolean): void {
  dispatchContextMenuRestoreFocus({
    tabId,
    selectionAnchor: target.selectionAnchor,
    selectionHead: target.selectionHead,
    keepSelection,
  });
}

function finishContextMenuClose(): void {
  const page = pageEditor();
  if (page !== null) {
    resetPageFocusToPointer(page);
  }
  const view = page?.ownerDocument.defaultView;
  view?.requestAnimationFrame(() => {
    if (page?.isConnected === true) {
      resetPageFocusToPointer(page);
    }
  });
}

export function ContextMenu({ tabId, menuContext, onCommand }: ContextMenuProps) {
  const [open, setOpen] = useState<OpenState | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const hostRef = useRef<HTMLDivElement>(null);
  const flyoutLayerRef = useRef<HTMLDivElement | null>(null);
  const [flyoutLayerReady, setFlyoutLayerReady] = useState(false);
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  const targetKind = open?.target.kind ?? 'text';
  const entries = useMemo(() => {
    try {
      const spelling = open?.target.spelling ?? null;
      return liveMenuEntries(
        withSpellingSuggestions(composeContextMenu(targetKind), spelling),
        menuContext,
      );
    } catch (error) {
      console.error('[obelisk:context-menu] failed to compose menu entries', error);
      return [];
    }
  }, [menuContext, open?.target.spelling, targetKind]);

  const menus: readonly AppMenu[] = useMemo(() => {
    if (entries.length === 0) {
      return [];
    }
    return [{
      id: CONTEXT_MENU_ID,
      label: CONTEXT_MENU_LABEL,
      accessKey: '',
      entries,
    }];
  }, [entries]);

  const applyRef = useRef<(result: MenuResult) => void>(() => {});

  applyRef.current = (result: MenuResult) => {
    if (result.command !== null) {
      onCommandRef.current(result.command);
    }
    const current = openRef.current;
    if (result.restoreFocus || (current !== null && sessionClosed(result.session))) {
      if (current !== null) {
        const active = document.activeElement;
        const host = hostRef.current;
        if (
          active instanceof HTMLElement
          && (host?.contains(active) === true || flyoutLayerRef.current?.contains(active) === true)
        ) {
          active.blur();
        }
        const keepSelection = result.command !== null && keepsEditedSelection(result.command);
        restoreEditorFocus(tabId, current.target, keepSelection);
        finishContextMenuClose();
      }
      setOpen(null);
      return;
    }
    if (current !== null && result.session !== current.session) {
      setOpen({ ...current, session: result.session });
    }
  };

  useEffect(() => {
    function onRequest(event: Event) {
      if (!(event instanceof CustomEvent)) {
        return;
      }
      const detail = event.detail as ContextMenuRequestDetail;
      if (detail.tabId !== tabId) {
        return;
      }
      rememberSpellingTarget(detail.spelling ?? null);
      const opened = detail.keyboard
        ? keyboardOpenContextMenu(CONTEXT_MENU_ID)
        : pointerOpenContextMenu(CONTEXT_MENU_ID);
      const payload = { target: detail, session: opened.session };
      queueMicrotask(() => {
        setOpen(payload);
      });
    }
    window.addEventListener(CONTEXT_MENU_REQUEST, onRequest);
    return () => {
      window.removeEventListener(CONTEXT_MENU_REQUEST, onRequest);
    };
  }, [tabId]);

  useLayoutEffect(() => {
    if (open === null) {
      return undefined;
    }
    function onKey(event: KeyboardEvent) {
      const current = openRef.current;
      if (event.isComposing || current === null || menus.length === 0) {
        return;
      }
      const result = reduceMenuKey(menus, current.session, {
        type: event.type === 'keyup' ? 'keyup' : 'keydown',
        key: event.key,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        repeat: event.repeat,
      });
      applyRef.current(result);
      if (result.handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
  }, [menus, open]);

  useEffect(() => {
    if (open === null) {
      flyoutLayerRef.current = null;
      setFlyoutLayerReady(false);
    }
  }, [open]);

  useLayoutEffect(() => {
    if (open === null) {
      return;
    }
    const layer = flyoutLayerRef.current;
    if (layer !== null) {
      setFlyoutLayerReady(true);
    }
  }, [open, entries]);

  useLayoutEffect(() => {
    if (open === null) {
      return;
    }
    const host = hostRef.current;
    if (host !== null) {
      clampPosition(host, open.target.clientX, open.target.clientY);
    }
    const timer = window.setTimeout(() => {
      const current = openRef.current;
      if (current === null) {
        return;
      }
      const id = focusMenuItemId(current.session);
      if (id !== null) {
        document.getElementById(id)?.focus({ preventScroll: true });
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    if (open === null) {
      return undefined;
    }
    function isInsideMenu(target: Node): boolean {
      const host = hostRef.current;
      if (host?.contains(target)) {
        return true;
      }
      const layer = host?.querySelector('[data-region="context-menu-flyouts"]');
      if (layer?.contains(target)) {
        return true;
      }
      for (const flyout of document.querySelectorAll('[data-region="context-menu-flyouts"] .menu-flyout')) {
        if (flyout.contains(target)) {
          return true;
        }
      }
      return false;
    }
    function onOutsidePointer(event: Event) {
      const target = event.target;
      if (!(target instanceof Node) || isInsideMenu(target)) {
        return;
      }
      const current = openRef.current;
      if (current === null) {
        return;
      }
      event.preventDefault();
      applyRef.current(pointerDismissContextMenu(current.session));
    }
    window.addEventListener('pointerdown', onOutsidePointer, true);
    window.addEventListener('mousedown', onOutsidePointer, true);
    return () => {
      window.removeEventListener('pointerdown', onOutsidePointer, true);
      window.removeEventListener('mousedown', onOutsidePointer, true);
    };
  }, [open]);

  if (open === null || entries.length === 0) {
    return null;
  }

  return (
    <div
      className="context-menu-host"
      data-region="context-menu"
      data-input={open.session.keyboard ? 'keyboard' : 'pointer'}
      data-context-kind={open.target.kind}
      data-context-block-type={open.target.blockType}
      ref={hostRef}
    >
      <div
        className="menu-flyout-layer"
        ref={flyoutLayerRef}
        data-region="context-menu-flyouts"
      />
      {flyoutLayerReady && flyoutLayerRef.current !== null ? (
      <MenuItems
        ownerId={CONTEXT_MENU_ID}
        label={CONTEXT_MENU_LABEL}
        entries={entries}
        depth={0}
        panels={open.session.panels}
        variant="context"
        flyoutLayer={flyoutLayerRef.current}
        rootPanel
        onActivate={(itemId) => {
          const current = openRef.current;
          if (current === null) {
            return;
          }
          applyRef.current(pointerActivate(menus, current.session, itemId));
        }}
        onHoverItem={(itemId) => {
          const current = openRef.current;
          if (current === null) {
            return;
          }
          applyRef.current(pointerHoverItem(menus, current.session, itemId));
        }}
      />
      ) : null}
    </div>
  );
}