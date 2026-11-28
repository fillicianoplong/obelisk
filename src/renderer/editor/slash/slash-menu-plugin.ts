import { NodeSelection, Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { blockHandleState, lockBlockMenuGutter } from '../block-handle-plugin.js';
import { watchOutsidePress } from '../../shell/outside-press.js';
import {
  applySlashMenuItem,
  exactSlashCommandItem,
  filteredSlashMenuRows,
  firstFilteredIndex,
  slashMenuContextActive,
  slashQueryStart,
  slashTypedQuery,
  slashTypedQueryFromSelection,
} from './slash-commands.js';
import { SLASH_MENU_ENTRIES, type SlashMenuItem, type SlashMenuRow } from './reference.js';
import { requestShellCommand } from '../editor-command-event.js';

function itemDoesNothing(item: SlashMenuItem): boolean {
  return item.block === null && item.command === undefined;
}

/** After the /text is gone, a command item asks the shell to run it. */
function runSlashItemCommand(item: SlashMenuItem, view: EditorView | undefined): void {
  if (item.command !== undefined) {
    requestShellCommand(item.command, view?.dom.ownerDocument.defaultView ?? null);
  }
}

export interface SlashMenuState {
  open: boolean;
  /**
   * Document position of the typed slash. For the menu opened from + (typed false)
   * there is no slash: this is the empty block's caret position where filter text starts.
   */
  slashPos: number;
  /** False when the menu was opened by the + button without typing a '/'. */
  typed: boolean;
  /** Flat index among selectable items in SLASH_MENU_ENTRIES. */
  activeIndex: number;
}

const POSITION_RULE_SELECTOR = '.slash-menu-host .slash-menu-panel';

export const slashMenuPluginKey = new PluginKey<SlashMenuState>('slashMenu');

const CLOSED: SlashMenuState = { open: false, slashPos: 0, typed: true, activeIndex: 0 };

export function slashMenuState(state: EditorState): SlashMenuState {
  return slashMenuPluginKey.getState(state) ?? CLOSED;
}

function selectableEntries(): SlashMenuRow[] {
  return SLASH_MENU_ENTRIES.filter((entry): entry is SlashMenuRow => entry.type === 'item');
}

function rowByFlatIndex(index: number): SlashMenuRow | undefined {
  return selectableEntries()[index];
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

function openSlashMenuAt(tr: Transaction, slashPos: number): Transaction {
  return tr.setMeta(slashMenuPluginKey, {
    open: true,
    slashPos,
    typed: true,
    activeIndex: firstFilteredIndex(''),
  } satisfies SlashMenuState);
}

/**
 * Opens the slash menu at an empty block's caret without typing a '/'.
 * The + button uses this. The filter starts empty and Esc leaves the block empty.
 */
export function openSlashMenuWithoutSlash(tr: Transaction, caretPos: number): Transaction {
  return tr.setMeta(slashMenuPluginKey, {
    open: true,
    slashPos: caretPos,
    typed: false,
    activeIndex: firstFilteredIndex(''),
  } satisfies SlashMenuState);
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

function filteredActiveIndex(state: EditorState, menu: SlashMenuState): number {
  const query = slashTypedQuery(state, menu.slashPos, menu.typed);
  const visible = filteredSlashMenuRows(query);
  const current = rowByFlatIndex(menu.activeIndex);
  if (current !== undefined && visible.some((row) => row.item.id === current.item.id)) {
    return menu.activeIndex;
  }
  return firstFilteredIndex(query);
}

function moveSlashMenu(delta: number): Command {
  return (state, dispatch) => {
    const menu = slashMenuState(state);
    if (!menu.open) {
      return false;
    }
    const query = slashTypedQuery(state, menu.slashPos, menu.typed);
    const visible = filteredSlashMenuRows(query);
    if (visible.length === 0) {
      return false;
    }
    const flat = selectableEntries();
    const currentRow = rowByFlatIndex(menu.activeIndex);
    let visibleIndex = currentRow === undefined
      ? 0
      : Math.max(0, visible.findIndex((row) => row.item.id === currentRow.item.id));
    if (visibleIndex < 0) {
      visibleIndex = 0;
    }
    for (let step = 0; step < visible.length; step += 1) {
      visibleIndex = (visibleIndex + delta + visible.length) % visible.length;
      const target = visible[visibleIndex];
      if (target?.enabled) {
        const flatIndex = flat.findIndex((row) => row.item.id === target.item.id);
        if (flatIndex >= 0 && dispatch !== undefined) {
          dispatch(state.tr.setMeta(slashMenuPluginKey, { ...menu, activeIndex: flatIndex }));
        }
        return true;
      }
    }
    return false;
  };
}

function confirmSlashMenuItem(): Command {
  return (state, dispatch, view) => {
    const menu = slashMenuState(state);
    if (!menu.open) {
      return false;
    }
    const row = rowByFlatIndex(filteredActiveIndex(state, menu));
    if (row === undefined || !row.enabled || itemDoesNothing(row.item)) {
      if (dispatch !== undefined) {
        dispatch(closeSlashMenu(state.tr));
      }
      return true;
    }
    if (dispatch !== undefined) {
      const applied = applySlashMenuItem(state, menu.slashPos, row.item, view);
      if (applied === null) {
        dispatch(closeSlashMenu(state.tr));
      } else {
        dispatch(closeSlashMenu(applied));
        view?.focus();
        runSlashItemCommand(row.item, view);
      }
    }
    return true;
  };
}

function applyExactSlashCommand(state: EditorState, menu: SlashMenuState, view?: EditorView): Transaction | null {
  const { slashPos } = menu;
  const item = exactSlashCommandItem(state, slashPos, menu.typed);
  if (item === null || item.block === null) {
    // Command items like Link run from the menu or /link plus Space or Enter.
    return null;
  }
  return applySlashMenuItem(state, slashPos, item, view);
}

function tryExactSlashOnBoundary(eventKey: string): Command {
  return (state, dispatch, view) => {
    if (slashMenuState(state).open) {
      return false;
    }
  if (eventKey !== ' ' && eventKey !== 'Enter') {
      return false;
    }
    if (!(state.selection instanceof TextSelection) || !state.selection.empty) {
      return false;
    }
    const { $from } = state.selection;
    if (!$from.parent.isTextblock || $from.parentOffset < 1) {
      return false;
    }
    const lineStart = $from.start();
    const slashPos = state.doc.textBetween(lineStart, $from.pos, '\0', '\0').lastIndexOf('/');
    if (slashPos < 0) {
      return false;
    }
    const absoluteSlash = lineStart + slashPos;
    if (state.doc.textBetween(absoluteSlash, absoluteSlash + 1, '\0', '\0') !== '/') {
      return false;
    }
    const item = exactSlashCommandItem(state, absoluteSlash);
    if (item === null) {
      return false;
    }
    if (dispatch !== undefined) {
      const applied = applySlashMenuItem(state, absoluteSlash, item, view);
      if (applied !== null) {
        dispatch(applied);
        view?.focus();
        runSlashItemCommand(item, view);
        return true;
      }
    }
    return false;
  };
}

function backspaceOnSlashTrigger(): Command {
  return (state, dispatch) => {
    const menu = slashMenuState(state);
    if (!menu.open) {
      return false;
    }
    const query = slashTypedQuery(state, menu.slashPos, menu.typed);
    if (query.length > 0) {
      return false;
    }
    if (!(state.selection instanceof TextSelection) || !state.selection.empty) {
      return false;
    }
    if (!menu.typed) {
      // No slash to delete: Backspace on the empty filter just closes the menu from +.
      if (state.selection.head !== menu.slashPos) {
        return false;
      }
      if (dispatch !== undefined) {
        dispatch(closeSlashMenu(state.tr));
      }
      return true;
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
    Tab: confirmSlashMenuItem(),
    Backspace: backspaceOnSlashTrigger(),
    'Shift-Enter': tryExactSlashOnBoundary('Enter'),
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

function slashMenuOptionTop(panel: HTMLElement, option: HTMLElement): number {
  let top = 0;
  let node: HTMLElement | null = option;
  while (node !== null && node !== panel) {
    top += typeof node.offsetTop === 'number' ? node.offsetTop : 0;
    const parent = node.offsetParent;
    if (parent === null || parent === panel) {
      break;
    }
    if (typeof parent !== 'object' || !('offsetTop' in parent)) {
      break;
    }
    node = parent as HTMLElement;
  }
  return top;
}

/** Keep the keyboard-selected row inside the scrollable panel (minimal motion). */
export function scrollSlashMenuActiveOption(panel: HTMLElement): void {
  if (!panel.isConnected) {
    return;
  }
  const selected = panel.querySelector<HTMLElement>('.slash-menu-option[aria-selected="true"]');
  if (selected === null || !selected.isConnected) {
    return;
  }
  const optionTop = slashMenuOptionTop(panel, selected);
  const optionBottom = optionTop + selected.offsetHeight;
  const viewTop = panel.scrollTop;
  const viewBottom = viewTop + panel.clientHeight;
  if (optionTop < viewTop) {
    panel.scrollTop = optionTop;
  } else if (optionBottom > viewBottom) {
    panel.scrollTop = optionBottom - panel.clientHeight;
  }
}

function renderSlashMenu(
  view: EditorView,
  root: HTMLElement,
  panel: HTMLElement,
  list: HTMLUListElement,
  menu: SlashMenuState,
  positionSheet: CSSStyleSheet | null,
  scrollActiveOption: boolean,
  scheduleActiveScroll: (() => void) | undefined,
): void {
  const open = menu.open;
  root.dataset.open = open ? 'true' : 'false';
  if (!open) {
    panel.hidden = true;
    list.replaceChildren();
    return;
  }
  panel.hidden = false;
  const query = slashTypedQuery(view.state, menu.slashPos);
  const activeRow = rowByFlatIndex(filteredActiveIndex(view.state, menu));
  const activeOptionId = activeRow !== undefined ? optionId(menu.activeIndex, activeRow.item.id) : undefined;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Insert block');
  if (activeOptionId !== undefined) {
    list.setAttribute('aria-activedescendant', activeOptionId);
  } else {
    list.removeAttribute('aria-activedescendant');
  }
  const visible = new Set(
    query.length === 0
      ? selectableEntries().map((row) => row.item.id)
      : filteredSlashMenuRows(query).map((row) => row.item.id),
  );
  const fragment = document.createDocumentFragment();
  let itemIndex = -1;
  let pendingSeparator: HTMLLIElement | null = null;
  for (const entry of SLASH_MENU_ENTRIES) {
    if (entry.type === 'separator') {
      if (query.length === 0) {
        pendingSeparator = document.createElement('li');
        pendingSeparator.className = 'slash-menu-separator';
        pendingSeparator.setAttribute('role', 'separator');
      }
      continue;
    }
    itemIndex += 1;
    if (!visible.has(entry.item.id)) {
      continue;
    }
    if (pendingSeparator !== null) {
      fragment.append(pendingSeparator);
      pendingSeparator = null;
    }
    const option = document.createElement('li');
    option.className = 'slash-menu-option';
    option.id = optionId(itemIndex, entry.item.id);
    option.setAttribute('role', 'option');
    option.dataset.itemId = entry.item.id;
    option.dataset.flatIndex = String(itemIndex);
    option.textContent = entry.item.label;
    const selected = itemIndex === menu.activeIndex;
    option.setAttribute('aria-selected', selected ? 'true' : 'false');
    if (!entry.enabled) {
      option.setAttribute('aria-disabled', 'true');
    }
    fragment.append(option);
  }
  list.replaceChildren(fragment);
  positionSlashMenu(view, panel, menu, positionSheet);
  if (scrollActiveOption) {
    scheduleActiveScroll?.();
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
    coords = view.coordsAtPos(slashQueryStart(menu.slashPos, menu.typed));
  } catch {
    return;
  }
  const gap = 4;
  const rect = panel.getBoundingClientRect();
  const width = rect.width > 0 ? rect.width : 240;
  const height = rect.height > 0 ? rect.height : 240;
  const placed = clampMenuPosition(coords.left, coords.bottom + gap, width, height, win);
  syncPositionRule(sheet, placed.left, placed.top);
}

function syncSlashMenuStateOnEdit(tr: Transaction, value: SlashMenuState): SlashMenuState {
  if (!value.open) {
    return value;
  }
  // Text inserted before the anchor (another block, or the menu from + after an edit) moves it.
  const slashPos = tr.mapping.map(value.slashPos, value.typed ? 1 : -1);
  if (!slashMenuContextActive(tr.doc, tr.selection, slashPos, value.typed)) {
    return CLOSED;
  }
  const query = slashTypedQueryFromSelection(tr.doc, tr.selection, slashPos, value.typed);
  return {
    ...value,
    slashPos,
    activeIndex: firstFilteredIndex(query),
  };
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
        if (tr.selectionSet || tr.docChanged) {
          return syncSlashMenuStateOnEdit(tr, value);
        }
        return value;
      },
    },
    props: {
      handleTextInput(view, from, to, text) {
        const menu = slashMenuState(view.state);
        if (menu.open) {
          if (text === ' ') {
            const applied = applyExactSlashCommand(view.state, menu, view);
            if (applied !== null) {
              view.dispatch(closeSlashMenu(applied));
              view.focus();
              return true;
            }
          }
          return false;
        }
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
      handleKeyDown(view, event) {
        if (slashMenuState(view.state).open && (event.key === 'Enter' || event.key === 'Tab')) {
          if (confirmSlashMenuItem()(view.state, view.dispatch, view)) {
            event.preventDefault();
            return true;
          }
        }
        if (!slashMenuState(view.state).open && (event.key === ' ' || event.key === 'Enter')) {
          if (tryExactSlashOnBoundary(event.key)(view.state, view.dispatch, view)) {
            event.preventDefault();
            return true;
          }
        }
        return false;
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

      list.addEventListener('mousedown', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }
        const option = target.closest('.slash-menu-option');
        if (!(option instanceof HTMLElement)) {
          return;
        }
        event.preventDefault();
        const flatIndex = Number(option.dataset.flatIndex);
        const row = rowByFlatIndex(flatIndex);
        if (row === undefined || !row.enabled || itemDoesNothing(row.item)) {
          return;
        }
        const menu = slashMenuState(editorView.state);
        if (!menu.open) {
          return;
        }
        const applied = applySlashMenuItem(editorView.state, menu.slashPos, row.item);
        if (applied !== null) {
          editorView.dispatch(closeSlashMenu(applied));
          editorView.focus();
          runSlashItemCommand(row.item, editorView);
        }
      });

      list.addEventListener('mouseover', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }
        const option = target.closest('.slash-menu-option');
        if (!(option instanceof HTMLElement)) {
          return;
        }
        const flatIndex = Number(option.dataset.flatIndex);
        if (!Number.isInteger(flatIndex)) {
          return;
        }
        const menu = slashMenuState(editorView.state);
        if (!menu.open || menu.activeIndex === flatIndex) {
          return;
        }
        suppressActiveScrollFromHover = true;
        editorView.dispatch(editorView.state.tr.setMeta(slashMenuPluginKey, { ...menu, activeIndex: flatIndex }));
      });

      // Same rule as the grip menu and the context menu: a press or right-click
      // anywhere outside the panel closes it, and so does the window losing focus.
      // Capture on the window so a handler that stops the event, or a pointerdown
      // whose default is prevented (which skips mousedown), cannot keep it open.
      // A press in the text then places the caret as usual.
      const stopOutsidePress = watchOutsidePress(win, {
        isOpen: () => slashMenuState(editorView.state).open,
        // The panel, not the full-window host, is the menu.
        isInside: (target) => target !== null && panel.contains(target),
        onOutside() {
          if (!editorView.isDestroyed && slashMenuState(editorView.state).open) {
            editorView.dispatch(closeSlashMenu(editorView.state.tr));
          }
        },
      });

      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && slashMenuState(editorView.state).open) {
          editorView.dispatch(closeSlashMenu(editorView.state.tr));
          editorView.focus();
          event.preventDefault();
          event.stopPropagation();
        }
      };
      doc.addEventListener('keydown', onKey, true);

      let suppressActiveScrollFromHover = false;
      let activeScrollVersion = 0;

      const scheduleActiveScroll = (): void => {
        activeScrollVersion += 1;
        const version = activeScrollVersion;
        queueMicrotask(() => {
          if (version !== activeScrollVersion || !panel.isConnected) {
            return;
          }
          scrollSlashMenuActiveOption(panel);
        });
      };

      const update = (scrollActiveOption: boolean) => {
        const menu = slashMenuState(editorView.state);
        renderSlashMenu(editorView, root, panel, list, menu, positionSheet, scrollActiveOption, scheduleActiveScroll);
      };
      update(false);

      return {
        update(view, prevState) {
          const was = slashMenuState(prevState);
          const now = slashMenuState(view.state);
          const scrollActiveOption = now.open
            && !suppressActiveScrollFromHover
            && (was.activeIndex !== now.activeIndex
              || (was.open && view.state.doc !== prevState.doc));
          if (was.open && !now.open && !was.typed) {
            // The + controls stay on their block only while the menu they opened is open.
            // Release after this update so the gutter's own dispatch is not nested in it.
            queueMicrotask(() => {
              if (!view.isDestroyed && !slashMenuState(view.state).open) {
                lockBlockMenuGutter(view, null, 'slash');
              }
            });
          }
          if (
            was.open !== now.open
            || was.activeIndex !== now.activeIndex
            || was.slashPos !== now.slashPos
            || view.state.doc !== prevState.doc
          ) {
            update(scrollActiveOption);
          } else if (now.open && view.state.selection !== prevState.selection) {
            positionSlashMenu(view, panel, now, positionSheet);
          }
          suppressActiveScrollFromHover = false;
        },
        destroy() {
          activeScrollVersion += 1;
          stopOutsidePress();
          doc.removeEventListener('keydown', onKey, true);
          root.remove();
          installed?.release();
        },
      };
    },
  });
}