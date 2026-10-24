import { useCallback, useEffect, useRef, useState } from 'react';
import { MenuBar } from './MenuBar.js';
import { PageArea } from './PageArea.js';
import { statusLabel } from './status.js';
import { StatusBar } from './StatusBar.js';
import { createTab } from './tabs.js';
import type { PageTab } from './tabs.js';
import { TabStrip } from './TabStrip.js';
import './shell.css';

export function Shell() {
  const [tabs, setTabs] = useState<PageTab[]>(() => [createTab(1)]);
  const [activeId, setActiveId] = useState('untitled-1');
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const nextNumber = useRef(2);
  const menuBarRef = useRef<HTMLElement>(null);

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  const addTab = useCallback(() => {
    const number = nextNumber.current;
    nextNumber.current += 1;
    const tab = createTab(number);
    setTabs((current) => [...current, tab]);
    setActiveId(tab.id);
    setOpenMenu(null);
  }, []);

  const selectTab = useCallback((tabId: string) => {
    setActiveId(tabId);
    setOpenMenu(null);
  }, []);

  const updateText = useCallback((text: string) => {
    setTabs((current) => current.map((tab) => (tab.id === activeId ? { ...tab, text } : tab)));
  }, [activeId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenMenu(null);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        addTab();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [addTab]);

  useEffect(() => {
    if (openMenu === null) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || menuBarRef.current?.contains(target)) {
        return;
      }
      setOpenMenu(null);
    }
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [openMenu]);

  if (activeTab === undefined) {
    return null;
  }

  return (
    <div className="shell">
      <MenuBar
        openMenu={openMenu}
        onToggleMenu={(menuId) => {
          setOpenMenu((current) => (current === menuId ? null : menuId));
        }}
        onHoverMenu={(menuId) => {
          setOpenMenu((current) => (current === null ? current : menuId));
        }}
        onNew={addTab}
        barRef={menuBarRef}
      />
      <TabStrip tabs={tabs} activeId={activeTab.id} onSelect={selectTab} onNew={addTab} />
      <PageArea tabId={activeTab.id} text={activeTab.text} onText={updateText} />
      <StatusBar label={statusLabel(activeTab.text)} />
    </div>
  );
}
