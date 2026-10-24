import type { RefObject } from 'react';
import { APP_NAME } from '../../shared/app-info.js';
import { APP_MENUS, isSeparator } from './menus.js';
import type { AppMenu } from './menus.js';

interface MenuBarProps {
  openMenu: string | null;
  onToggleMenu: (menuId: string) => void;
  onHoverMenu: (menuId: string) => void;
  onNew: () => void;
  barRef: RefObject<HTMLElement | null>;
}

function MenuPanel({ menu, onNew }: { menu: AppMenu; onNew: () => void }) {
  return (
    <div className="menu-panel" role="menu" aria-label={menu.label}>
      {menu.entries.map((entry) => {
        if (isSeparator(entry)) {
          return <div key={entry.id} className="menu-separator" role="separator" />;
        }
        const enabled = entry.command === 'new';
        return (
          <button
            key={entry.id}
            type="button"
            className="menu-item"
            role="menuitem"
            disabled={!enabled}
            data-command={entry.command}
            onClick={() => {
              if (entry.command === 'new') {
                onNew();
              }
            }}
          >
            <span>{entry.label}</span>
            {entry.shortcut ? <span className="menu-shortcut">{entry.shortcut}</span> : null}
            {entry.submenu ? <span className="menu-submenu" aria-hidden="true">›</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function MenuBar({ openMenu, onToggleMenu, onHoverMenu, onNew, barRef }: MenuBarProps) {
  return (
    <header className="menu-bar" data-region="menu-bar" role="menubar" aria-label="Menu bar" ref={barRef}>
      <h1 className="visually-hidden">{APP_NAME}</h1>
      {APP_MENUS.map((menu) => {
        const open = openMenu === menu.id;
        return (
          <div
            key={menu.id}
            className="menu"
            onMouseEnter={() => {
              onHoverMenu(menu.id);
            }}
          >
            <button
              type="button"
              className="menu-button"
              role="menuitem"
              aria-haspopup="true"
              aria-expanded={open}
              data-menu={menu.id}
              onClick={() => {
                onToggleMenu(menu.id);
              }}
            >
              {menu.label}
            </button>
            {open ? <MenuPanel menu={menu} onNew={onNew} /> : null}
          </div>
        );
      })}
    </header>
  );
}
