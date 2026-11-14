import { NodeSelection, Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { blockHandleState } from '../block-handle-plugin.js';
import { SLASH_MENU_ENTRIES, type SlashMenuRow } from './reference.js';

export interface SlashMenuState {
  open: boolean;
  /** Document position of the typed slash. */
  slashPos: number;
  /** Flat index among selectable items in SLASH_MENU_ENTRIES. */
  activeIndex: number;
}

const POSITION_RULE_SELECTOR = '.slash-menu-host .slash-menu-panel';

export const slashMenuPluginKey = new PluginKey<SlashMenuState>('slashMenu');

const CLOSED: SlashMenuState = { open: false, slashPos: 0, activeIndex: 0 };

export function slashMenuState(state: EditorState): SlashMenuState {
  return slashMenuPluginKey.getState(state) ?? CLOSED;
}

function selectableEntries(): SlashMenuRow[] {
  return SLASH_MENU_ENTRIES.filter((entry): entry is SlashMenuRow => entry.type === 'item');
}

function firstEnabledIndex(): number {
  const items = selectableEntries();
  const found = items.findIndex((entry) => entry.enabled);
  return found >= 0 ? found : 0;
}

function blockSelectionIsActive(state: EditorState): boolean {
  if (blockHandleState(state).from !== null) {
    return true;
  }
  return state.selection instanceof NodeSelection && state.selection.$anchor.depth === 0;
}

function parentIsCodeBlock($pos: EditorState['selection']['$from']): boolean {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.spec.code) {
      return true;
    }
  }
  return $pos.parent.type.spec.code === true;
}

function lineIsEmptyForSlash(state: EditorState): boolean {
  const { $from } = state.selection;
  return $from.parent.isTextblock && $from.parentOffset === 0 && $from.parent.content.size === 0;
}

export function shouldOpenSlashMenu(state: EditorState): boolean {
  if (!(state.selection instanceof TextSelection) || !state.selection.empty) {
    return false;
  }
  if (blockSelectionIsActive(state)) {
    return false;
  }
  if (parentIsCodeBlock(state.selection.$from)) {
    return false;
  }
  return lineIsEmptyForSlash(state);
}

function slashContextValid(doc: EditorState['doc'], selection: EditorState['selection'], slashPos: number): boolean {
  if (!(selection instanceof TextSelection) || !selection.empty) {
    return false;
  }
  if (selection.head !== slashPos + 1) {
    return false;
  }
  if (doc.textBetween(slashPos, slashPos + 1, '\0', '\0') !== '/') {
    return false;
  }
  return true;
}

function openSlashMenuAt(tr: Transaction, slashPos: number): Transaction {
  return tr.setMeta(slashMenuPluginKey, {
    open: true,
    slashPos,
    activeIndex: firstEnabledIndex(),
  });
}

function closeSlashMenu(tr: Transaction): Transaction {
  return tr.setMeta(slashMenuPluginKey, CLOSED);
}

export function closeSlashMenuCommand(): Command {
  return (state, dispatch) => {
    if (!slashMenuState(state).open) {
      return false;
    }
    if (dispatch !== undefined) {
      dispatch(closeSlashMenu(state.tr));
    }
    return true;
  };
}

function moveSlashMenu(delta: number): Command {
  return (state, dispatch) => {
    const menu = slashMenuState(state);
    if (!menu.open) {
      return false;
    }
    const items = selectableEntries();
    if (items.length === 0) {
      return false;
    }
    let index = menu.activeIndex;
    for (let step = 0; step < items.length; step += 1) {
      index = (index + delta + items.length) % items.length;
      if (items[index]?.enabled) {
        if (dispatch !== undefined) {
          dispatch(state.tr.setMeta(slashMenuPluginKey, { ...menu, activeIndex: index }));
        }
        return true;
      }
    }
    return false;
  };
}

function confirmSlashMenuItem(): Command {
  return (state, dispatch) => {
    const menu = slashMenuState(state);
    if (!menu.open) {
      return false;
    }
    if (dispatch !== undefined) {
      dispatch(closeSlashMenu(state.tr));
    }
    return true;
  };
}

function backspaceOnSlashTrigger(): Command {
  return (state, dispatch) => {
    const menu = slashMenuState(state);
    if (!menu.open) {
      return false;
    }
    if (!(state.selection instanceof TextSelection) || !state.selection.empty) {
      return false;
    }
    if (state.selection.head !== menu.slashPos + 1) {
      return false;
    }
    if (dispatch !== undefined) {
      dispatch(closeSlashMenu(state.tr.delete(menu.slashPos, menu.slashPos + 1)));
    }
    return true;
  };
}

export function slashMenuKeymap(): Record<string, Command> {
  return {
    Escape: closeSlashMenuCommand(),
    ArrowDown: moveSlashMenu(1),
    ArrowUp: moveSlashMenu(-1),
    Enter: confirmSlashMenuItem(),
    Backspace: backspaceOnSlashTrigger(),
  };
}

function clampMenuPosition(
  left: number,
  top: number,
  panelWidth: number,
  panelHeight: number,
  win: Window,
): { left: number; top: number } {
  const margin = 8;
  const maxLeft = Math.max(margin, win.innerWidth - panelWidth - margin);
  const maxTop = Math.max(margin, win.innerHeight - panelHeight - margin);
  return {
    left: Math.min(Math.max(margin, left), maxLeft),
    top: Math.min(Math.max(margin, top), maxTop),
  };
}

function syncPositionRule(sheet: CSSStyleSheet, left: number, top: number): void {
  const rule = `${POSITION_RULE_SELECTOR} { left: ${left}px; top: ${top}px; }`;
  while (sheet.cssRules.length > 0) {
    sheet.deleteRule(0);
  }
  sheet.insertRule(rule, 0);
}

function adoptConstructableSheet(doc: Document, sheet: CSSStyleSheet): () => void {
  const existing = doc.adoptedStyleSheets;
  doc.adoptedStyleSheets = [...existing, sheet];
  return () => {
    doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((entry) => entry !== sheet);
  };
}

function tryInstallPositionSheet(
  doc: Document,
  win: Window,
): { sheet: CSSStyleSheet; release: () => void } | null {
  if (!('adoptedStyleSheets' in doc)) {
    return null;
  }
  const CSSStyleSheetCtor = (win as Window & { CSSStyleSheet?: typeof CSSStyleSheet }).CSSStyleSheet;
  if (typeof CSSStyleSheetCtor !== 'function') {
    return null;
  }
  let sheet: CSSStyleSheet;
  try {
    sheet = new CSSStyleSheetCtor();
  } catch {
    return null;
  }
  try {
    const release = adoptConstructableSheet(doc, sheet);
    return { sheet, release };
  } catch {
    return null;
  }
}

function optionId(entryIndex: number, itemId: string): string {
  return `slash-menu-option-${entryIndex}-${itemId}`;
}

function renderSlashMenu(
  view: EditorView,
  root: HTMLElement,
  panel: HTMLElement,
  list: HTMLUListElement,
  menu: SlashMenuState,
  positionSheet: CSSStyleSheet | null,
): void {
  const open = menu.open;
  root.dataset.open = open ? 'true' : 'false';
  if (!open) {
    panel.hidden = true;
    list.replaceChildren();
    return;
  }
  panel.hidden = false;
  const items = selectableEntries();
  const active = items[menu.activeIndex] ?? items[firstEnabledIndex()];
  const activeOptionId = active !== undefined
    ? optionId(menu.activeIndex, active.item.id)
    : undefined;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Insert block');
  if (activeOptionId !== undefined) {
    list.setAttribute('aria-activedescendant', activeOptionId);
  } else {
    list.removeAttribute('aria-activedescendant');
  }
  const fragment = document.createDocumentFragment();
  let itemIndex = -1;
  for (const entry of SLASH_MENU_ENTRIES) {
    if (entry.type === 'separator') {
      const separator = document.createElement('li');
      separator.className = 'slash-menu-separator';
      separator.setAttribute('role', 'separator');
      fragment.append(separator);
      continue;
    }
    itemIndex += 1;
    const option = document.createElement('li');
    option.className = 'slash-menu-option';
    option.id = optionId(itemIndex, entry.item.id);
    option.setAttribute('role', 'option');
    option.textContent = entry.item.label;
    const selected = itemIndex === menu.activeIndex;
    option.setAttribute('aria-selected', selected ? 'true' : 'false');
    if (!entry.enabled) {
      option.setAttribute('aria-disabled', 'true');
    }
    fragment.append(option);
  }
  list.replaceChildren(fragment);
  if (menu.open) {
    positionSlashMenu(view, panel, menu, positionSheet);
  }
}

function positionSlashMenu(
  view: EditorView,
  panel: HTMLElement,
  menu: SlashMenuState,
  sheet: CSSStyleSheet | null,
): void {
  const win = view.dom.ownerDocument.defaultView;
  if (win === null || sheet === null) {
    return;
  }
  let coords;
  try {
    coords = view.coordsAtPos(menu.slashPos + 1);
  } catch {
    return;
  }
  const gap = 4;
  const rect = panel.getBoundingClientRect();
  const width = rect.width > 0 ? rect.width : 240;
  const height = rect.height > 0 ? rect.height : 320;
  const placed = clampMenuPosition(coords.left, coords.bottom + gap, width, height, win);
  syncPositionRule(sheet, placed.left, placed.top);
}

function outsideSlashMenu(target: EventTarget | null, root: HTMLElement, editor: HTMLElement): boolean {
  if (!(target instanceof Node)) {
    return true;
  }
  if (root.contains(target) || editor.contains(target)) {
    return false;
  }
  return true;
}

export function slashMenuPlugin(): Plugin {
  return new Plugin({
    key: slashMenuPluginKey,
    state: {
      init(): SlashMenuState {
        return CLOSED;
      },
      apply(tr, value) {
        const meta = tr.getMeta(slashMenuPluginKey);
        if (meta !== undefined) {
          return meta as SlashMenuState;
        }
        if (!value.open) {
          return value;
        }
        if (!slashContextValid(tr.doc, tr.selection, value.slashPos) && (tr.selectionSet || tr.docChanged)) {
          return CLOSED;
        }
        return value;
      },
    },
    props: {
      handleTextInput(view, from, to, text) {
        if (text !== '/') {
          return false;
        }
        if (!shouldOpenSlashMenu(view.state)) {
          return false;
        }
        const tr = openSlashMenuAt(view.state.tr.insertText('/', from, to), from);
        view.dispatch(tr);
        return true;
      },
    },
    view(editorView) {
      const doc = editorView.dom.ownerDocument;
      const win = doc.defaultView;
      if (win === null) {
        return {};
      }
      const mount = editorView.dom.parentElement ?? doc.body;
      const root = doc.createElement('div');
      root.className = 'slash-menu-host';
      root.dataset.open = 'false';
      const panel = doc.createElement('div');
      panel.className = 'slash-menu-panel';
      panel.hidden = true;
      const list = doc.createElement('ul');
      list.className = 'slash-menu-list';
      panel.append(list);
      panel.addEventListener('mousedown', (event) => {
        event.preventDefault();
      });
      root.append(panel);
      mount.append(root);

      const installed = tryInstallPositionSheet(doc, win);
      const positionSheet = installed?.sheet ?? null;

      const onDocumentMouseDown = (event: MouseEvent) => {
        if (!slashMenuState(editorView.state).open) {
          return;
        }
        if (outsideSlashMenu(event.target, root, editorView.dom)) {
          editorView.dispatch(closeSlashMenu(editorView.state.tr));
        }
      };
      doc.addEventListener('mousedown', onDocumentMouseDown, true);

      const update = () => {
        const menu = slashMenuState(editorView.state);
        renderSlashMenu(editorView, root, panel, list, menu, positionSheet);
      };
      update();

      return {
        update(view, prevState) {
          const was = slashMenuState(prevState);
          const now = slashMenuState(view.state);
          if (was.open !== now.open || was.activeIndex !== now.activeIndex || was.slashPos !== now.slashPos) {
            update();
          } else if (now.open && view.state.selection !== prevState.selection) {
            positionSlashMenu(view, panel, now, positionSheet);
          }
        },
        destroy() {
          doc.removeEventListener('mousedown', onDocumentMouseDown, true);
          root.remove();
          installed?.release();
        },
      };
    },
  });
}
