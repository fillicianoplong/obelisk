import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { announceFocusRegion } from '../focus/bind.js';
import { onMenuRegionLeave } from '../focus/menu-leave.js';
import { MENU_BAR_LABEL, PAGE_REGION } from '../focus/regions.js';
import { commitPageKeyboardFocus } from '../page-focus.js';
import { watchOutsidePress } from '../outside-press.js';
import {
  accessKeysVisible,
  initialMenuSession,
  pointerActivate,
  pointerDismiss,
  pointerHoverItem,
  pointerHoverMenu,
  pointerToggleMenu,
  reduceMenuKey,
} from './keyboard.js';
import type { MenuResult, MenuSession } from './keyboard.js';
import { focusMenuItemId, MenuItems, MenuText } from './MenuTree.js';
import { liveMenus, type LiveMenuContext } from './apply.js';
import { noteLiveSelection, withLiveEditor } from './live-editor.js';
import type { AppMenu } from './model.js';

interface MenuBarProps {
  menuContext: LiveMenuContext;
  onCommand: (command: string) => void;
}

function noteOutsideFocus(bar: HTMLElement | null, slot: { current: HTMLElement | null }): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) {
    return;
  }
  // Closing a menu removes the focused item. Focus falls on the root until the
  // bar button is focused, and that root is not where the user was working.
  if (active === document.body || active === document.documentElement) {
    return;
  }
  if (bar !== null && bar.contains(active)) {
    return;
  }
  slot.current = active;
}

function returnToPage(page: HTMLElement): void {
  commitPageKeyboardFocus(page);
  announceFocusRegion(window, PAGE_REGION);
}

function focusWorkSurface(): void {
  const selected = document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  const tabId = selected?.getAttribute('data-tab-id');
  if (selected !== null && (tabId === 'settings' || tabId === 'about')) {
    selected.focus({ preventScroll: true });
    return;
  }
  const page = document.querySelector<HTMLElement>('[data-region="page-editor"]');
  if (page !== null) {
    returnToPage(page);
  }
}

function topTabIndex(menuId: string, session: MenuSession, index: number): 0 | -1 {
  if (session.menuId !== null) {
    return session.menuId === menuId ? 0 : -1;
  }
  return index === 0 ? 0 : -1;
}

export function MenuBar({ menuContext, onCommand }: MenuBarProps) {
  const [session, setSession] = useState<MenuSession>(initialMenuSession);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const menuContextRef = useRef(menuContext);
  menuContextRef.current = menuContext;
  const barRef = useRef<HTMLElement>(null);
  const outsideFocus = useRef<HTMLElement | null>(null);
  const pendingRestore = useRef(false);
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  function menusNow(): readonly AppMenu[] {
    return liveMenus(withLiveEditor(menuContextRef.current));
  }

  function applyResult(result: MenuResult) {
    if (result.command !== null) {
      onCommandRef.current(result.command);
    }
    if (result.restoreFocus) {
      pendingRestore.current = true;
    }
    if (result.session !== sessionRef.current) {
      sessionRef.current = result.session;
      setSession(result.session);
    }
  }

  const applyRef = useRef(applyResult);
  applyRef.current = applyResult;

  useLayoutEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.isComposing) {
        return;
      }
      noteOutsideFocus(barRef.current, outsideFocus);
      const session = sessionRef.current;
      const menuOpening = event.altKey || event.key === 'Alt' || (event.key === 'F10' && !event.shiftKey);
      if (menuOpening || session.menuId !== null || session.keyboard) {
        noteLiveSelection();
      }
      const result = reduceMenuKey(menusNow(), session, {
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
      }
    }
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
  }, [menuContext]);

  useLayoutEffect(() => {
    // Focus after the key event. Doing it in the key listener runs before the
    // page records that the focus came from the keyboard. Blur runs in this
    // layout pass: a pointer move must not leave the keyboard ring on the item
    // the pointer left.
    if (!pendingRestore.current && !session.keyboard) {
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        barRef.current?.contains(active) &&
        (active.classList.contains('menu-item') || active.classList.contains('menu-panel'))
      ) {
        active.blur();
      }
      return;
    }
    const timer = window.setTimeout(() => {
      if (pendingRestore.current) {
        pendingRestore.current = false;
        const node = outsideFocus.current;
        outsideFocus.current = null;
        if (
          node !== null
          && node.isConnected
          && node !== document.body
          && node !== document.documentElement
        ) {
          if (node.matches('.page-sheet')) {
            returnToPage(node);
            return;
          }
          node.focus({ preventScroll: true });
          return;
        }
        focusWorkSurface();
        return;
      }
      const id = focusMenuItemId(session);
      if (id === null) {
        return;
      }
      document.getElementById(id)?.focus({ preventScroll: true });
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [session]);

  useEffect(() => {
    return onMenuRegionLeave(() => {
      applyRef.current(pointerDismiss(sessionRef.current));
    });
  }, []);

  useEffect(() => {
    if (session.menuId === null && !session.keyboard) {
      return undefined;
    }
    return watchOutsidePress(window, {
      isOpen: () => sessionRef.current.menuId !== null || sessionRef.current.keyboard,
      isInside: (target) => target instanceof Node && (barRef.current?.contains(target) ?? false),
      onOutside: () => {
        applyRef.current(pointerDismiss(sessionRef.current));
      },
    });
  }, [session.keyboard, session.menuId]);

  function onBarPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (barRef.current?.contains(event.target as Node)) {
      noteOutsideFocus(barRef.current, outsideFocus);
    }
  }

  const showKeys = accessKeysVisible(session);
  const menus = menusNow();

  return (
    <header
      className="menu-bar"
      data-region="menu-bar"
      data-access-keys={showKeys ? 'true' : 'false'}
      data-input={session.keyboard ? 'keyboard' : 'pointer'}
      role="menubar"
      aria-label={MENU_BAR_LABEL}
      aria-orientation="horizontal"
      ref={barRef}
      onPointerDown={onBarPointerDown}
    >
      {menus.map((menu, index) => {
        const open = session.menuId === menu.id && session.panels.length > 0;
        return (
          <div
            key={menu.id}
            className="menu"
            onMouseEnter={() => {
              applyResult(pointerHoverMenu(sessionRef.current, menu.id));
            }}
          >
            <button
              type="button"
              className="menu-button"
              id={`menu-top-${menu.id}`}
              role="menuitem"
              tabIndex={topTabIndex(menu.id, session, index)}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-controls={open ? `menu-panel-${menu.id}` : undefined}
              data-menu={menu.id}
              onClick={() => {
                noteLiveSelection();
                applyResult(pointerToggleMenu(sessionRef.current, menu.id));
              }}
            >
              <MenuText label={menu.label} accessKey={menu.accessKey} occurrence={menu.accessOccurrence} />
            </button>
            {open ? (
              <MenuItems
                ownerId={menu.id}
                label={menu.label}
                entries={menu.entries}
                depth={0}
                panels={session.panels}
                onActivate={(itemId) => {
                  noteLiveSelection();
                  applyResult(pointerActivate(menusNow(), sessionRef.current, itemId));
                }}
                onHoverItem={(itemId) => {
                  applyResult(pointerHoverItem(menusNow(), sessionRef.current, itemId));
                }}
              />
            ) : null}
          </div>
        );
      })}
    </header>
  );
}
