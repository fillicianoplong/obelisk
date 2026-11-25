import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MenuCheck, MenuChevron } from './icons.js';
import { accessParts, accessibleName, isSeparator, itemLabel, menuHasCheck } from './model.js';
import type { MenuEntry, MenuItem } from './model.js';
import type { MenuSession } from './keyboard.js';

export type MenuTreeVariant = 'bar' | 'context';

export function focusMenuItemId(session: MenuSession, topButtonPrefix = 'menu-top'): string | null {
  if (!session.keyboard) {
    return null;
  }
  if (session.panels.length === 0) {
    return session.menuId === null ? null : `${topButtonPrefix}-${session.menuId}`;
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

export function MenuText({
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

export function computeMenuFlyoutPosition(
  anchorRect: Pick<DOMRect, 'left' | 'right' | 'top'>,
  flyoutWidth: number,
  flyoutHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  gap = 4,
  margin = 8,
): { left: number; top: number } {
  let left = anchorRect.right + gap;
  if (left + flyoutWidth > viewportWidth - margin) {
    left = anchorRect.left - flyoutWidth - gap;
  }
  let top = anchorRect.top;
  if (top + flyoutHeight > viewportHeight - margin) {
    top = Math.max(margin, viewportHeight - margin - flyoutHeight);
  }
  return { left, top };
}

function positionFlyout(flyout: HTMLElement, anchor: HTMLElement): void {
  const anchorRect = anchor.getBoundingClientRect();
  flyout.style.removeProperty('--menu-flyout-left');
  flyout.style.removeProperty('--menu-flyout-top');
  const width = flyout.offsetWidth;
  const height = flyout.offsetHeight;
  const placed = computeMenuFlyoutPosition(
    anchorRect,
    width,
    height,
    window.innerWidth,
    window.innerHeight,
  );
  flyout.style.setProperty('--menu-flyout-left', `${placed.left}px`);
  flyout.style.setProperty('--menu-flyout-top', `${placed.top}px`);
}

function MenuFlyout({
  anchorItemId,
  ownerId,
  label,
  entries,
  depth,
  panels,
  variant,
  flyoutLayer,
  onActivate,
  onHoverItem,
}: {
  anchorItemId: string;
  ownerId: string;
  label: string;
  entries: readonly MenuEntry[];
  depth: number;
  panels: readonly (string | null)[];
  variant: MenuTreeVariant;
  flyoutLayer: HTMLElement;
  onActivate: (itemId: string) => void;
  onHoverItem: (itemId: string) => void;
}) {
  const flyoutRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const anchor = document.getElementById(`menu-item-${anchorItemId}`);
    const flyout = flyoutRef.current;
    if (anchor === null || flyout === null) {
      return;
    }
    positionFlyout(flyout, anchor);
  }, [anchorItemId, entries, panels]);
  return createPortal(
    <div
      ref={flyoutRef}
      className="menu-panel menu-flyout"
      id={`menu-panel-${ownerId}`}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      data-flyout-anchor={anchorItemId}
    >
      <MenuItems
        ownerId={ownerId}
        label={label}
        entries={entries}
        depth={depth}
        panels={panels}
        variant={variant}
        flyoutLayer={flyoutLayer}
        bare
        onActivate={onActivate}
        onHoverItem={onHoverItem}
      />
    </div>,
    flyoutLayer,
  );
}

export function MenuItems({
  ownerId,
  label,
  entries,
  depth,
  panels,
  variant = 'bar',
  flyoutLayer,
  rootPanel = false,
  bare = false,
  onActivate,
  onHoverItem,
}: {
  ownerId: string;
  label: string;
  entries: readonly MenuEntry[];
  depth: number;
  panels: readonly (string | null)[];
  variant?: MenuTreeVariant;
  flyoutLayer?: HTMLElement | null;
  rootPanel?: boolean;
  bare?: boolean;
  onActivate: (itemId: string) => void;
  onHoverItem: (itemId: string) => void;
}) {
  const focusedId = panels[depth] ?? null;
  const submenuOwner = panels.length > depth + 1 ? panels[depth] : null;
  const reserveCheck = menuHasCheck(entries);
  const panelClass = rootPanel && variant === 'context' ? 'menu-panel menu-panel--root' : 'menu-panel';
  const body = entries.map((entry) => {
        if (isSeparator(entry)) {
          return <div key={entry.id} className="menu-separator" role="separator" />;
        }
        const open = submenuOwner === entry.id && entry.submenu !== undefined;
        const hasSubmenu = entry.submenu !== undefined && entry.submenu.length > 0;
        const flyout = variant === 'context' && hasSubmenu && open && flyoutLayer !== null && flyoutLayer !== undefined;
        return (
          <div key={entry.id} className="menu-item-slot">
            <button
              type="button"
              className="menu-item"
              id={`menu-item-${entry.id}`}
              role={entry.radio === true ? 'menuitemradio' : 'menuitem'}
              tabIndex={-1}
              aria-label={accessibleName(entry)}
              aria-checked={entry.radio === true ? entry.checked === true : undefined}
              aria-disabled={entry.enabled ? undefined : true}
              aria-haspopup={hasSubmenu ? 'menu' : undefined}
              aria-expanded={hasSubmenu ? open : undefined}
              aria-controls={open ? `menu-panel-${entry.id}` : undefined}
              data-item={entry.id}
              data-command={entry.command}
              data-focused={focusedId === entry.id ? 'true' : undefined}
              data-open={open ? 'true' : undefined}
              onMouseDown={(event) => {
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
            {flyout ? (
              <MenuFlyout
                anchorItemId={entry.id}
                ownerId={entry.id}
                label={itemLabel(entry)}
                entries={entry.submenu!}
                depth={depth + 1}
                panels={panels}
                variant={variant}
                flyoutLayer={flyoutLayer}
                onActivate={onActivate}
                onHoverItem={onHoverItem}
              />
            ) : null}
            {variant === 'bar' && open && entry.submenu !== undefined ? (
              <MenuItems
                ownerId={entry.id}
                label={itemLabel(entry)}
                entries={entry.submenu}
                depth={depth + 1}
                panels={panels}
                variant={variant}
                flyoutLayer={flyoutLayer}
                onActivate={onActivate}
                onHoverItem={onHoverItem}
              />
            ) : null}
          </div>
        );
  });
  if (bare) {
    return <>{body}</>;
  }
  return (
    <div className={panelClass} id={`menu-panel-${ownerId}`} role="menu" aria-label={label} tabIndex={-1}>
      {body}
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