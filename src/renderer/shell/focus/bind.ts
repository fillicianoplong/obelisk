import { commitPageKeyboardFocus } from '../page-focus.js';
import { recallFocus, rememberFocus, emptyFocusMemory } from './memory.js';
import type { FocusMemory } from './memory.js';
import { leaveMenuRegion } from './menu-leave.js';
import {
  MENU_BAR_REGION,
  PAGE_REGION,
  REGION_LABEL,
  STATUS_BAR_REGION,
  TABS_REGION,
  cycleRegionId,
  regionAfter,
  regionCycle,
} from './regions.js';
import type { RegionDirection } from './regions.js';
import { focusTargetKey } from './target.js';
import type { FocusTargetParts } from './target.js';

const ANNOUNCER_ID = 'focus-region-announce';

function partsFrom(element: HTMLElement): FocusTargetParts {
  const tab = element.closest('[data-tab-id]');
  const tabId = tab?.getAttribute('data-tab-id') ?? null;
  return {
    id: element.id,
    region: element.getAttribute('data-region'),
    classes: [...element.classList],
    tabId,
  };
}

function regionForElement(element: Element): string | null {
  const marked = element.closest('[data-region]');
  if (marked === null) {
    return null;
  }
  return cycleRegionId(marked.getAttribute('data-region'));
}

function keyedElement(start: Element): HTMLElement | null {
  let current: Element | null = start;
  while (current !== null) {
    if (!(current instanceof HTMLElement)) {
      current = current.parentElement;
      continue;
    }
    if (focusTargetKey(partsFrom(current)) !== null && regionForElement(current) !== null) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function elementForKey(doc: Document, key: string): HTMLElement | null {
  if (key.startsWith('id:')) {
    const node = doc.getElementById(key.slice(3));
    return node instanceof HTMLElement && node.isConnected ? node : null;
  }
  if (key === 'tab-new') {
    return doc.querySelector<HTMLElement>('.tab-new');
  }
  if (key === 'status-save') {
    return doc.querySelector<HTMLElement>('.status-save');
  }
  if (key.startsWith('close:')) {
    const tabId = key.slice('close:'.length);
    return doc.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(tabId)}"] .tab-close`);
  }
  if (key.startsWith('region:')) {
    const marker = key.slice('region:'.length);
    return doc.querySelector<HTMLElement>(`[data-region="${CSS.escape(marker)}"]`);
  }
  return null;
}

function defaultTarget(doc: Document, regionId: string): HTMLElement | null {
  if (regionId === 'menu-bar') {
    return doc.querySelector<HTMLElement>('[data-region="menu-bar"] .menu-button');
  }
  if (regionId === 'tab-strip') {
    return (
      doc.querySelector<HTMLElement>('[data-region="tab-strip"] [role="tab"][aria-selected="true"]')
      ?? doc.querySelector<HTMLElement>('[data-region="tab-strip"] [role="tab"]')
    );
  }
  if (regionId === 'page') {
    return (
      doc.querySelector<HTMLElement>('[data-region="page-editor"]')
      ?? doc.querySelector<HTMLElement>('[data-region="page"]')
    );
  }
  if (regionId === 'status-bar') {
    return doc.querySelector<HTMLElement>('[data-region="status-bar"]');
  }
  return doc.querySelector<HTMLElement>(`[data-region="${CSS.escape(regionId)}"]`);
}

function focusKeyboard(element: HTMLElement): void {
  element.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
  if (element.matches('.page-sheet')) {
    commitPageKeyboardFocus(element);
  }
}

function announcer(doc: Document): HTMLElement {
  const existing = doc.getElementById(ANNOUNCER_ID);
  if (existing instanceof HTMLElement) {
    return existing;
  }
  const node = doc.createElement('div');
  node.id = ANNOUNCER_ID;
  node.className = 'status-live';
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');
  node.setAttribute('aria-atomic', 'true');
  doc.body.appendChild(node);
  return node;
}

export function announceFocusRegion(view: Window, regionId: string): void {
  const label = REGION_LABEL[regionId];
  if (label === undefined) {
    return;
  }
  const node = announcer(view.document);
  node.dataset.regionAnnouncement = label;
  node.textContent = '';
  view.requestAnimationFrame(() => {
    if (node.isConnected && node.dataset.regionAnnouncement === label) {
      node.textContent = label;
    }
  });
}

function rememberedTarget(doc: Document, memory: FocusMemory, regionId: string): HTMLElement | null {
  const key = recallFocus(memory, regionId);
  if (key === null) {
    return null;
  }
  const element = elementForKey(doc, key);
  if (element === null || regionForElement(element) !== regionId) {
    return null;
  }
  return element;
}

export function bindRegionCycle(view: Window): () => void {
  const doc = view.document;
  let memory = emptyFocusMemory();

  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const element = keyedElement(target);
    if (element === null) {
      return;
    }
    const regionId = regionForElement(element);
    const key = focusTargetKey(partsFrom(element));
    if (regionId === null || key === null) {
      return;
    }
    memory = rememberFocus(memory, regionId, key);
  };

  const focusRegion = (regionId: string) => {
    const target = rememberedTarget(doc, memory, regionId) ?? defaultTarget(doc, regionId);
    if (target === null) {
      return false;
    }
    focusKeyboard(target);
    announceFocusRegion(view, regionId);
    return true;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) {
      return;
    }
    const active = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    const current = active === null ? null : regionForElement(active);

    // Escape returns to the page from the menu bar, the tabs, or the status bar.
    // An open menu consumes Escape first and closes one level. The find bar and
    // the page keep their own Escape behavior.
    if (event.key === 'Escape' && !event.shiftKey && !event.defaultPrevented) {
      if (
        current !== MENU_BAR_REGION
        && current !== TABS_REGION
        && current !== STATUS_BAR_REGION
      ) {
        return;
      }
      if (current === MENU_BAR_REGION) {
        leaveMenuRegion();
      }
      if (!focusRegion(PAGE_REGION)) {
        return;
      }
      event.preventDefault();
      return;
    }

    if (event.key !== 'F6') {
      return;
    }
    const direction: RegionDirection = event.shiftKey ? -1 : 1;
    // The find bar is not open. regionCycle(['find-bar']) adds it after the tabs.
    const order = regionCycle();
    const next = regionAfter(order, current, direction);
    if (current === MENU_BAR_REGION && next !== MENU_BAR_REGION) {
      leaveMenuRegion();
    }
    const target = rememberedTarget(doc, memory, next) ?? defaultTarget(doc, next);
    if (target === null) {
      return;
    }
    event.preventDefault();
    focusKeyboard(target);
    announceFocusRegion(view, next);
  };

  doc.addEventListener('focusin', onFocusIn, true);
  // Bubble, after the page has recorded that this key is keyboard focus.
  view.addEventListener('keydown', onKeyDown);
  return () => {
    doc.removeEventListener('focusin', onFocusIn, true);
    view.removeEventListener('keydown', onKeyDown);
    doc.getElementById(ANNOUNCER_ID)?.remove();
  };
}
