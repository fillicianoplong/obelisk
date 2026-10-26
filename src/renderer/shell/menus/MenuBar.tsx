import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { announceFocusRegion } from '../focus/bind.js';
import { onMenuRegionLeave } from '../focus/menu-leave.js';
import { MENU_BAR_LABEL, PAGE_REGION } from '../focus/regions.js';
import { commitPageKeyboardFocus } from '../page-focus.js';
import { MenuCheck, MenuChevron } from './icons.js';
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
import { APP_MENUS, accessParts, accessibleName, isSeparator, itemLabel, menuHasCheck } from './model.js';
import type { MenuEntry, MenuItem } from './model.js';

interface MenuBarProps {
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
  if (selected?.getAttribute('data-tab-id') === 'settings') {
    selected.focus({ preventScroll: true });
    return;
  }
  const page = document.querySelector<HTMLElement>('[data-region="page-editor"]');
  if (page !== null) {
    returnToPage(page);
  }
}

function focusTargetId(session: MenuSession): string | null {
  if (!session.keyboard) {
    return null;
  }
  if (session.panels.length === 0) {
    return session.menuId === null ? null : `menu-top-${session.menuId}`;
  }
  const focused = session.panels[session.panels.length - 1];
  if (focused !== null && focused !== undefined) {
    return `menu-item-${focused}`;
  }
  const depth = session.panels.length - 1;
  const owner = depth === 0 ? session.menuId : session.panels[depth - 1];
  if (owner === null || owner === undefined) {
    return null;
  }
  return `menu-panel-${owner}`;
}

function topTabIndex(menuId: string, session: MenuSession, index: number): 0 | -1 {
  if (session.menuId !== null) {
    return session.menuId === menuId ? 0 : -1;
  }
  return index === 0 ? 0 : -1;
}

function MenuText({
  label,
  accessKey,
  occurrence,
  ellipsis,
}: {
  label: string;
  accessKey: string;
  occurrence?: number;
  ellipsis?: boolean;
}) {
  const mark = ellipsis === true ? '…' : '';
  const parts = accessParts(label, accessKey, occurrence ?? 0);
  if (parts === null) {
    return (
      <>
        {label}
        {mark}
      </>
    );
  }
  return (
    <>
      {parts.before}
      <span className="menu-key">{parts.key}</span>
      {parts.after}
      {mark}
    </>
  );
}

function MenuItems({
  ownerId,
  label,
  entries,
  depth,
  panels,
  onActivate,
  onHoverItem,
}: {
  ownerId: string;
  label: string;
  entries: readonly MenuEntry[];
  depth: number;
  panels: readonly (string | null)[];
  onActivate: (itemId: string) => void;
  onHoverItem: (itemId: string) => void;
}) {
  const focusedId = panels[depth] ?? null;
  const submenuOwner = panels.length > depth + 1 ? panels[depth] : null;
  const reserveCheck = menuHasCheck(entries);
  return (
    <div className="menu-panel" id={`menu-panel-${ownerId}`} role="menu" aria-label={label} tabIndex={-1}>
      {entries.map((entry) => {
        if (isSeparator(entry)) {
          return <div key={entry.id} className="menu-separator" role="separator" />;
        }
        const open = submenuOwner === entry.id && entry.submenu !== undefined;
        const hasSubmenu = entry.submenu !== undefined && entry.submenu.length > 0;
        return (
          <div key={entry.id} className="menu-item-slot">
            <button
              type="button"
              className="menu-item"
              id={`menu-item-${entry.id}`}
              role="menuitem"
              tabIndex={-1}
              aria-label={accessibleName(entry)}
              aria-disabled={entry.enabled ? undefined : true}
              aria-haspopup={hasSubmenu ? 'menu' : undefined}
              aria-expanded={hasSubmenu ? open : undefined}
              aria-controls={open ? `menu-panel-${entry.id}` : undefined}
              data-item={entry.id}
              data-command={entry.command}
              data-focused={focusedId === entry.id ? 'true' : undefined}
              data-open={open ? 'true' : undefined}
              onMouseDown={(event) => {
                // A press would focus the button and the focus ring would follow the pointer.
                event.preventDefault();
              }}
              onMouseEnter={() => {
                onHoverItem(entry.id);
              }}
              onClick={() => {
                onActivate(entry.id);
              }}
            >
              {reserveCheck ? (
                <span className="menu-check" aria-hidden="true">
                  {entry.checked === true ? <MenuCheck /> : null}
                </span>
              ) : null}
              <span className="menu-label">
                <MenuText
                  label={entry.label}
                  accessKey={entry.accessKey}
                  occurrence={entry.accessOccurrence}
                  ellipsis={entry.ellipsis}
                />
              </span>
              <MenuTrailing item={entry} hasSubmenu={hasSubmenu} />
            </button>
            {open && entry.submenu !== undefined ? (
              <MenuItems
                ownerId={entry.id}
                label={itemLabel(entry)}
                entries={entry.submenu}
                depth={depth + 1}
                panels={panels}
                onActivate={onActivate}
                onHoverItem={onHoverItem}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function MenuTrailing({ item, hasSubmenu }: { item: MenuItem; hasSubmenu: boolean }) {
  if (item.shortcut === undefined && !hasSubmenu) {
    return null;
  }
  return (
    <span className="menu-trailing">
      {item.shortcut !== undefined ? <span className="menu-shortcut">{item.shortcut}</span> : null}
      {hasSubmenu ? <MenuChevron /> : null}
    </span>
  );
}

export function MenuBar({ onCommand }: MenuBarProps) {
  const [session, setSession] = useState<MenuSession>(initialMenuSession);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const barRef = useRef<HTMLElement>(null);
  const outsideFocus = useRef<HTMLElement | null>(null);
  const pendingRestore = useRef(false);
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

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
      const result = reduceMenuKey(APP_MENUS, sessionRef.current, {
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
  }, []);

  useLayoutEffect(() => {
    // Focus after the key event. Doing it in the key listener runs before the
    // page records that the focus came from the keyboard.
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
      if (!session.keyboard) {
        // Hover must not leave the keyboard ring on the item the pointer left.
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
      const id = focusTargetId(session);
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
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || barRef.current?.contains(target)) {
        return;
      }
      applyRef.current(pointerDismiss(sessionRef.current));
    }
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [session.keyboard, session.menuId]);

  function onBarPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (barRef.current?.contains(event.target as Node)) {
      noteOutsideFocus(barRef.current, outsideFocus);
    }
  }

  const showKeys = accessKeysVisible(session);

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
      {APP_MENUS.map((menu, index) => {
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
                  applyResult(pointerActivate(APP_MENUS, sessionRef.current, itemId));
                }}
                onHoverItem={(itemId) => {
                  applyResult(pointerHoverItem(APP_MENUS, sessionRef.current, itemId));
                }}
              />
            ) : null}
          </div>
        );
      })}
    </header>
  );
}
