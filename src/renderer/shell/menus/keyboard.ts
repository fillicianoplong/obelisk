import { isSeparator } from './model.js';
import type { AppMenu, MenuEntry, MenuItem } from './model.js';

// Key handling for any menu tree. It only reads ids, access keys, enabled,
// submenu, and command, so new Menus reference items do not change this file.

export interface MenuSession {
  altDown: boolean;
  /** A key other than Alt was pressed during this Alt hold. */
  altChord: boolean;
  /** The menu bar has keyboard focus, or a menu was opened from the keyboard. */
  keyboard: boolean;
  /** Esc from the open menu returns to the menu bar. Alt+letter skips that stop. */
  escToBar: boolean;
  menuId: string | null;
  /**
   * One entry per open panel, from the top menu downward.
   * The value is the focused item id, or null when no enabled item can take focus.
   */
  panels: (string | null)[];
}

export interface MenuKeyEvent {
  type: 'keydown' | 'keyup';
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
}

export interface MenuResult {
  session: MenuSession;
  /** True when the menu consumed the key. False still may update the session. */
  handled: boolean;
  command: string | null;
  restoreFocus: boolean;
}

export function initialMenuSession(): MenuSession {
  return {
    altDown: false,
    altChord: false,
    keyboard: false,
    escToBar: false,
    menuId: null,
    panels: [],
  };
}

export function accessKeysVisible(session: MenuSession): boolean {
  return session.altDown || session.keyboard;
}

export function reduceMenuKey(
  menus: readonly AppMenu[],
  session: MenuSession,
  event: MenuKeyEvent,
): MenuResult {
  if (event.type === 'keyup') {
    return onKeyUp(menus, session, event);
  }
  return onKeyDown(menus, session, event);
}

export function pointerToggleMenu(session: MenuSession, menuId: string): MenuResult {
  if (session.menuId === menuId && session.panels.length > 0) {
    return dismiss(session, false);
  }
  return accept({
    ...initialMenuSession(),
    altDown: session.altDown,
    altChord: session.altChord,
    menuId,
    panels: [null],
  });
}

export function pointerHoverMenu(session: MenuSession, menuId: string): MenuResult {
  if (session.panels.length === 0 || session.menuId === null || session.menuId === menuId) {
    return ignore(session);
  }
  return accept({
    ...session,
    keyboard: false,
    menuId,
    panels: [null],
  });
}

export function pointerHoverItem(
  menus: readonly AppMenu[],
  session: MenuSession,
  itemId: string,
): MenuResult {
  if (session.menuId === null || session.panels.length === 0) {
    return ignore(session);
  }
  const located = locateItem(menus, session.menuId, itemId);
  if (located === null) {
    return ignore(session);
  }
  // The pointer owns the highlight. A submenu opens under the hovered item.
  // A sibling closes the previous submenu so only this item stays highlighted.
  const panels =
    located.item.enabled && located.item.submenu !== undefined && located.item.submenu.length > 0
      ? [...located.path, firstEnabled(located.item.submenu)]
      : located.path;
  if (!session.keyboard && sameIds(session.panels, panels)) {
    return ignore(session);
  }
  return accept({ ...session, keyboard: false, panels });
}

export function pointerActivate(
  menus: readonly AppMenu[],
  session: MenuSession,
  itemId: string,
): MenuResult {
  if (session.menuId === null) {
    return ignore(session);
  }
  const located = locateItem(menus, session.menuId, itemId);
  if (located === null || !located.item.enabled) {
    return accept(session);
  }
  return activateItem({ ...session, panels: located.path }, located.item);
}

export function pointerDismiss(session: MenuSession): MenuResult {
  if (!session.keyboard && session.menuId === null && session.panels.length === 0) {
    return ignore(session);
  }
  return dismiss(session, false);
}

function onKeyUp(menus: readonly AppMenu[], session: MenuSession, event: MenuKeyEvent): MenuResult {
  if (event.key !== 'Alt' || !session.altDown) {
    return ignore(session);
  }
  const tap = !session.altChord && !event.ctrlKey && !event.metaKey && !event.shiftKey;
  const cleared: MenuSession = { ...session, altDown: false, altChord: false };
  const busy = session.keyboard || session.panels.length > 0 || session.menuId !== null;
  if (!tap || busy || menus.length === 0) {
    return accept(cleared);
  }
  return accept({
    ...cleared,
    keyboard: true,
    escToBar: true,
    menuId: menus[0].id,
    panels: [],
  });
}

function onKeyDown(menus: readonly AppMenu[], session: MenuSession, event: MenuKeyEvent): MenuResult {
  if (event.key === 'Alt') {
    if (event.repeat || event.ctrlKey || event.metaKey || session.altDown) {
      return ignore(session);
    }
    return accept({ ...session, altDown: true, altChord: false });
  }

  let current = session;
  if (session.altDown || event.altKey) {
    current = { ...session, altChord: true };
  }

  if (event.ctrlKey || event.metaKey) {
    if (current.keyboard || current.panels.length > 0 || current.menuId !== null) {
      return {
        session: { ...initialMenuSession(), altDown: current.altDown, altChord: true },
        handled: false,
        command: null,
        restoreFocus: false,
      };
    }
    return pass(current);
  }

  if (event.key === 'F10' && !event.altKey && !event.shiftKey) {
    if (event.repeat) {
      return accept(current);
    }
    // A second F10, with the bar focused and no menu open, leaves the bar.
    if (current.keyboard && current.panels.length === 0) {
      return closeSession(current, null, true);
    }
    if (menus.length === 0) {
      return accept(current);
    }
    return accept({
      ...current,
      keyboard: true,
      escToBar: true,
      menuId: current.menuId ?? menus[0].id,
      panels: [],
    });
  }

  const letter = menuLetter(event.key);
  if (letter !== null && (event.altKey || session.altDown)) {
    const menu = menuByAccess(menus, letter);
    if (menu === undefined) {
      return pass(current);
    }
    return accept(openMenu(current, menus, menu.id));
  }

  const engaged = current.keyboard || current.panels.length > 0 || current.menuId !== null;
  if (!engaged) {
    return pass(current);
  }

  if (event.key === 'Escape') {
    return onEscape(current);
  }
  if (event.key === 'ArrowLeft') {
    return onHorizontal(menus, current, -1);
  }
  if (event.key === 'ArrowRight') {
    return onHorizontal(menus, current, 1);
  }
  if (event.key === 'ArrowUp') {
    return onVertical(menus, current, -1);
  }
  if (event.key === 'ArrowDown') {
    return onVertical(menus, current, 1);
  }
  if (event.key === 'Home') {
    return onEdge(menus, current, 'start');
  }
  if (event.key === 'End') {
    return onEdge(menus, current, 'end');
  }
  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    if (event.repeat) {
      return accept(current);
    }
    return onEnter(menus, current);
  }
  if (letter !== null && current.panels.length === 0) {
    const menu = menuByAccess(menus, letter);
    if (menu === undefined) {
      return accept(current);
    }
    return accept(openMenu(current, menus, menu.id));
  }
  if (letter !== null && current.panels.length > 0 && current.menuId !== null) {
    const entries = entriesAt(menus, current.menuId, current.panels, current.panels.length - 1);
    const match = entries === null ? undefined : itemByAccess(entries, letter);
    if (match === undefined || !match.enabled) {
      return accept({ ...current, keyboard: true });
    }
    return activateItem(current, match);
  }
  return pass(current);
}

function onEscape(session: MenuSession): MenuResult {
  if (session.panels.length > 1) {
    return accept({ ...session, keyboard: true, panels: session.panels.slice(0, -1) });
  }
  if (session.panels.length === 1 && session.escToBar) {
    return accept({ ...session, keyboard: true, panels: [] });
  }
  return closeSession(session, null, true);
}

function onHorizontal(menus: readonly AppMenu[], session: MenuSession, delta: 1 | -1): MenuResult {
  if (session.menuId === null || menus.length === 0) {
    return accept(session);
  }
  if (delta === -1 && session.panels.length > 1) {
    return accept({ ...session, keyboard: true, panels: session.panels.slice(0, -1) });
  }
  if (delta === 1 && session.panels.length > 0) {
    const entries = entriesAt(menus, session.menuId, session.panels, session.panels.length - 1);
    const focusedId = session.panels[session.panels.length - 1];
    const item = entries === null || focusedId === null ? undefined : findItem(entries, focusedId);
    if (item !== undefined && item.enabled && item.submenu !== undefined && item.submenu.length > 0) {
      return accept({
        ...session,
        keyboard: true,
        panels: [...session.panels, firstEnabled(item.submenu)],
      });
    }
  }
  const menuId = neighborMenu(menus, session.menuId, delta);
  if (session.panels.length === 0) {
    return accept({ ...session, keyboard: true, menuId, panels: [] });
  }
  return accept(openMenu(session, menus, menuId));
}

function onVertical(menus: readonly AppMenu[], session: MenuSession, delta: 1 | -1): MenuResult {
  if (session.menuId === null) {
    return accept(session);
  }
  if (session.panels.length === 0) {
    const menu = menus.find((entry) => entry.id === session.menuId);
    let id: string | null = null;
    if (menu !== undefined) {
      id = delta === 1 ? firstEnabled(menu.entries) : lastEnabled(menu.entries);
    }
    return accept({ ...session, keyboard: true, panels: [id] });
  }
  const entries = entriesAt(menus, session.menuId, session.panels, session.panels.length - 1);
  if (entries === null) {
    return accept({ ...session, keyboard: true });
  }
  const panels = session.panels.slice();
  panels[panels.length - 1] = stepEnabled(enabledIds(entries), panels[panels.length - 1] ?? null, delta);
  return accept({ ...session, keyboard: true, panels });
}

function onEdge(menus: readonly AppMenu[], session: MenuSession, edge: 'start' | 'end'): MenuResult {
  if (menus.length === 0) {
    return accept(session);
  }
  if (session.panels.length === 0) {
    const menu = edge === 'start' ? menus[0] : menus[menus.length - 1];
    return accept({ ...session, keyboard: true, menuId: menu.id });
  }
  if (session.menuId === null) {
    return accept(session);
  }
  const entries = entriesAt(menus, session.menuId, session.panels, session.panels.length - 1);
  if (entries === null) {
    return accept({ ...session, keyboard: true });
  }
  const panels = session.panels.slice();
  panels[panels.length - 1] = edge === 'start' ? firstEnabled(entries) : lastEnabled(entries);
  return accept({ ...session, keyboard: true, panels });
}

function onEnter(menus: readonly AppMenu[], session: MenuSession): MenuResult {
  if (session.panels.length === 0) {
    if (session.menuId === null) {
      return accept(session);
    }
    return accept(openMenu(session, menus, session.menuId));
  }
  if (session.menuId === null) {
    return accept(session);
  }
  const entries = entriesAt(menus, session.menuId, session.panels, session.panels.length - 1);
  const focusedId = session.panels[session.panels.length - 1];
  const item = entries === null || focusedId === null ? undefined : findItem(entries, focusedId);
  if (item === undefined || !item.enabled) {
    return accept({ ...session, keyboard: true });
  }
  return activateItem(session, item);
}

function activateItem(session: MenuSession, item: MenuItem): MenuResult {
  const panels = session.panels.slice();
  if (panels.length === 0) {
    panels.push(item.id);
  } else {
    panels[panels.length - 1] = item.id;
  }
  if (item.submenu !== undefined && item.submenu.length > 0) {
    return accept({
      ...session,
      keyboard: true,
      panels: [...panels, firstEnabled(item.submenu)],
    });
  }
  if (item.command !== undefined) {
    return closeSession({ ...session, panels }, item.command, true);
  }
  return accept({ ...session, keyboard: true, panels });
}

function openMenu(session: MenuSession, menus: readonly AppMenu[], menuId: string): MenuSession {
  const menu = menus.find((entry) => entry.id === menuId);
  return {
    ...session,
    keyboard: true,
    menuId,
    panels: [menu === undefined ? null : firstEnabled(menu.entries)],
  };
}

function closeSession(session: MenuSession, command: string | null, restoreFocus: boolean): MenuResult {
  return {
    session: { ...initialMenuSession(), altDown: session.altDown, altChord: session.altChord },
    handled: true,
    command,
    restoreFocus,
  };
}

function dismiss(session: MenuSession, restoreFocus: boolean): MenuResult {
  return closeSession(session, null, restoreFocus);
}

function ignore(session: MenuSession): MenuResult {
  return { session, handled: false, command: null, restoreFocus: false };
}

function accept(session: MenuSession): MenuResult {
  return { session, handled: true, command: null, restoreFocus: false };
}

function pass(next: MenuSession): MenuResult {
  return { session: next, handled: false, command: null, restoreFocus: false };
}

function menuLetter(key: string): string | null {
  if (key.length !== 1 || !/^[a-z0-9]$/i.test(key)) {
    return null;
  }
  return key.toLowerCase();
}

function menuByAccess(menus: readonly AppMenu[], letter: string): AppMenu | undefined {
  return menus.find((menu) => menu.accessKey.toLowerCase() === letter);
}

function itemByAccess(entries: readonly MenuEntry[], letter: string): MenuItem | undefined {
  for (const entry of entries) {
    if (isSeparator(entry)) {
      continue;
    }
    if (entry.accessKey.length === 1 && entry.accessKey.toLowerCase() === letter) {
      return entry;
    }
  }
  return undefined;
}

function findItem(entries: readonly MenuEntry[], itemId: string): MenuItem | undefined {
  for (const entry of entries) {
    if (!isSeparator(entry) && entry.id === itemId) {
      return entry;
    }
  }
  return undefined;
}

function enabledIds(entries: readonly MenuEntry[]): string[] {
  const ids: string[] = [];
  for (const entry of entries) {
    if (!isSeparator(entry) && entry.enabled) {
      ids.push(entry.id);
    }
  }
  return ids;
}

function firstEnabled(entries: readonly MenuEntry[]): string | null {
  return enabledIds(entries)[0] ?? null;
}

function lastEnabled(entries: readonly MenuEntry[]): string | null {
  const ids = enabledIds(entries);
  return ids[ids.length - 1] ?? null;
}

function stepEnabled(ids: readonly string[], current: string | null, delta: 1 | -1): string | null {
  if (ids.length === 0) {
    return null;
  }
  const index = current === null ? -1 : ids.indexOf(current);
  if (index === -1) {
    return delta === 1 ? ids[0] : ids[ids.length - 1];
  }
  const next = (index + delta + ids.length) % ids.length;
  return ids[next] ?? null;
}

function neighborMenu(menus: readonly AppMenu[], menuId: string, delta: 1 | -1): string {
  const index = menus.findIndex((menu) => menu.id === menuId);
  const start = index < 0 ? 0 : index;
  const next = (start + delta + menus.length) % menus.length;
  return menus[next].id;
}

function entriesAt(
  menus: readonly AppMenu[],
  menuId: string,
  panels: readonly (string | null)[],
  depth: number,
): readonly MenuEntry[] | null {
  const menu = menus.find((entry) => entry.id === menuId);
  if (menu === undefined) {
    return null;
  }
  let entries: readonly MenuEntry[] = menu.entries;
  for (let index = 0; index < depth; index += 1) {
    const id = panels[index];
    if (id === null || id === undefined) {
      return null;
    }
    const item = findItem(entries, id);
    if (item === undefined || item.submenu === undefined) {
      return null;
    }
    entries = item.submenu;
  }
  return entries;
}

interface LocatedItem {
  item: MenuItem;
  path: string[];
}

function locateItem(menus: readonly AppMenu[], menuId: string, itemId: string): LocatedItem | null {
  const menu = menus.find((entry) => entry.id === menuId);
  if (menu === undefined) {
    return null;
  }
  const path = findPath(menu.entries, itemId, []);
  if (path === null) {
    return null;
  }
  const itemIdAtEnd = path[path.length - 1];
  let entries = menu.entries;
  for (let index = 0; index < path.length - 1; index += 1) {
    const parent = findItem(entries, path[index]);
    if (parent?.submenu === undefined) {
      return null;
    }
    entries = parent.submenu;
  }
  const item = findItem(entries, itemIdAtEnd);
  if (item === undefined) {
    return null;
  }
  return { item, path };
}

function findPath(entries: readonly MenuEntry[], itemId: string, prefix: string[]): string[] | null {
  for (const entry of entries) {
    if (isSeparator(entry)) {
      continue;
    }
    const next = [...prefix, entry.id];
    if (entry.id === itemId) {
      return next;
    }
    if (entry.submenu !== undefined) {
      const nested = findPath(entry.submenu, itemId, next);
      if (nested !== null) {
        return nested;
      }
    }
  }
  return null;
}

function sameIds(left: readonly (string | null)[], right: readonly (string | null)[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((id, index) => id === right[index]);
}
