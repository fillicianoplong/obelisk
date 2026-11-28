import type { Node as ProseNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { EditorState, Transaction } from 'prosemirror-state';
import { Decoration, type EditorView } from 'prosemirror-view';
import { caretInsideBlock, createTextBlockNode } from './block-commands.js';
import { newBlockId } from './block-id.js';
import {
  blockHandlePluginKey,
  blockPosAtIndex,
  emptyBlockHandleState,
} from './block-handle-plugin.js';
import { editorMenuCommand } from './menu-commands.js';
import type { TextBlockKind } from './schema/index.js';
import { openSlashMenuWithoutSlash, slashMenuPluginKey } from './slash/slash-menu-plugin.js';

export const ADD_BLOCK_LABEL = 'Add block below';
export const GRIP_LABEL = 'Block menu';
export const GRIP_TOOLTIP = 'Drag to move this block. Click to open the menu.';
export const EMPTY_BLOCK_HINT = 'Press / to insert blocks';
export const BLOCK_MENU_SEARCH_LABEL = 'Search actions';
/** Same wait as the status-bar tooltip. Keyboard focus shows it immediately. */
export const GRIP_TOOLTIP_HOVER_MS = 500;

export interface BlockMenuAction {
  id: string;
  label: string;
  shortcut?: string;
}

interface TurnIntoAction extends BlockMenuAction {
  kind: TextBlockKind;
  level?: number;
}

const TURN_INTO: readonly TurnIntoAction[] = [
  { id: 'block-turn-into-text', label: 'Turn into Text', kind: 'paragraph' },
  { id: 'block-turn-into-heading-1', label: 'Turn into Heading 1', kind: 'heading', level: 1 },
  { id: 'block-turn-into-heading-2', label: 'Turn into Heading 2', kind: 'heading', level: 2 },
  { id: 'block-turn-into-heading-3', label: 'Turn into Heading 3', kind: 'heading', level: 3 },
  { id: 'block-turn-into-bulleted', label: 'Turn into Bulleted list', kind: 'bulleted-list' },
  { id: 'block-turn-into-numbered', label: 'Turn into Numbered list', kind: 'numbered-list' },
  { id: 'block-turn-into-checklist', label: 'Turn into Checklist', kind: 'checklist' },
  { id: 'block-turn-into-quote', label: 'Turn into Quote', kind: 'quote' },
  { id: 'block-turn-into-code', label: 'Turn into Code block', kind: 'code' },
];

const TURN_BY_ID = new Map(TURN_INTO.map((action) => [action.id, action]));

export const BLOCK_MENU_ACTIONS: readonly BlockMenuAction[] = [
  { id: 'edit-cut', label: 'Cut', shortcut: 'Ctrl+X' },
  { id: 'edit-copy', label: 'Copy', shortcut: 'Ctrl+C' },
  { id: 'edit-paste', label: 'Paste', shortcut: 'Ctrl+V' },
  { id: 'edit-duplicate', label: 'Duplicate', shortcut: 'Ctrl+Shift+D' },
  { id: 'block-delete', label: 'Delete' },
  ...TURN_INTO.map(({ id, label }) => ({ id, label })),
  { id: 'block-insert-above', label: 'Insert above' },
  { id: 'block-insert-below', label: 'Insert below' },
  { id: 'block-move-up', label: 'Move up' },
  { id: 'block-move-down', label: 'Move down' },
];

export function blockTypeLabel(node: ProseNode): string {
  switch (node.type.name) {
    case 'paragraph':
      return 'Paragraph';
    case 'heading':
      return `Heading ${node.attrs.level ?? 1}`;
    case 'bullet_list':
      return 'Bulleted list';
    case 'ordered_list':
      return 'Numbered list';
    case 'checklist':
      return 'Checklist';
    case 'blockquote':
      return 'Quote';
    case 'code_block':
      return 'Code block';
    case 'horizontal_rule':
      return 'Horizontal line';
    case 'page_break':
      return 'Page break';
    default:
      return 'Block';
  }
}

export function filterBlockMenuActions(
  actions: readonly BlockMenuAction[],
  query: string,
): BlockMenuAction[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return [...actions];
  }
  return actions.filter((action) => action.label.toLowerCase().includes(needle));
}

export function blockMenuActionEnabled(
  state: EditorState,
  blockIndex: number,
  actionId: string,
): boolean {
  if (blockIndex < 0 || blockIndex >= state.doc.childCount) {
    return false;
  }
  if (actionId === 'block-move-up') {
    return blockIndex > 0;
  }
  if (actionId === 'block-move-down') {
    return blockIndex < state.doc.childCount - 1;
  }
  if (actionId === 'block-delete') {
    return state.doc.childCount > 1;
  }
  return BLOCK_MENU_ACTIONS.some((action) => action.id === actionId);
}

/** True while the slash menu opened by + (no typed '/') is open. */
export function slashMenuOpenWithoutSlash(state: EditorState): boolean {
  const menu = slashMenuPluginKey.getState(state);
  return menu?.open === true && !menu.typed;
}

/**
 * Inserts an empty paragraph and opens the slash menu on it without typing a '/'.
 * The filter starts empty, and Esc or an outside click leaves the paragraph empty.
 */
export function insertEmptyBlockWithSlashMenu(
  state: EditorState,
  blockIndex: number,
  place: 'above' | 'below',
): Transaction | null {
  if (blockIndex < 0 || blockIndex >= state.doc.childCount) {
    return null;
  }
  const insertIndex = place === 'below' ? blockIndex + 1 : blockIndex;
  const node = createTextBlockNode('paragraph', state.schema, newBlockId);
  const pos = insertIndex >= state.doc.childCount
    ? state.doc.content.size
    : blockPosAtIndex(state.doc, insertIndex);
  let tr = state.tr.insert(pos, node);
  const caret = caretInsideBlock(tr.doc, insertIndex, 0);
  tr = tr.setSelection(caret);
  tr = openSlashMenuWithoutSlash(tr, caret.from);
  tr = tr.setMeta(blockHandlePluginKey, emptyBlockHandleState());
  return tr;
}

export function turnBlockInto(
  state: EditorState,
  blockIndex: number,
  kind: TextBlockKind,
  level?: number,
): Transaction | null {
  if (blockIndex < 0 || blockIndex >= state.doc.childCount) {
    return null;
  }
  const old = state.doc.child(blockIndex);
  const blockId = typeof old.attrs.blockId === 'string' && old.attrs.blockId.length > 0
    ? old.attrs.blockId
    : newBlockId();
  const node = createTextBlockNode(kind, state.schema, () => blockId, {
    level,
    text: old.textContent,
  });
  const pos = blockPosAtIndex(state.doc, blockIndex);
  let tr = state.tr.replaceWith(pos, pos + old.nodeSize, node);
  const caretOffset = old.isTextblock ? old.content.size : 0;
  tr = tr.setSelection(caretInsideBlock(tr.doc, blockIndex, caretOffset));
  tr = tr.setMeta(blockHandlePluginKey, emptyBlockHandleState());
  return tr;
}

export function applyBlockMenuAction(
  state: EditorState,
  blockIndex: number,
  actionId: string,
  dispatch?: (tr: Transaction) => void,
  view?: EditorView,
): boolean {
  if (!blockMenuActionEnabled(state, blockIndex, actionId)) {
    return false;
  }
  const turn = TURN_BY_ID.get(actionId);
  if (turn !== undefined) {
    const tr = turnBlockInto(state, blockIndex, turn.kind, turn.level);
    if (tr === null) {
      return false;
    }
    if (dispatch !== undefined) {
      dispatch(tr);
    }
    return true;
  }
  if (actionId === 'block-insert-above' || actionId === 'block-insert-below') {
    const tr = insertEmptyBlockWithSlashMenu(
      state,
      blockIndex,
      actionId === 'block-insert-below' ? 'below' : 'above',
    );
    if (tr === null) {
      return false;
    }
    if (dispatch !== undefined) {
      dispatch(tr);
    }
    return true;
  }
  const command = editorMenuCommand(actionId);
  if (command === null) {
    return false;
  }
  return command(state, dispatch, view);
}

function caretInEmptyHintBlock(state: EditorState): number | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) {
    return null;
  }
  const from = selection.$from;
  if (!from.parent.isTextblock || from.parent.content.size > 0) {
    return null;
  }
  // The slash menu opened from + sits on this block, so the "Press /" hint would only repeat it.
  if (slashMenuPluginKey.getState(state)?.open === true) {
    return null;
  }
  for (let depth = from.depth; depth > 0; depth -= 1) {
    if (from.node(depth).type.spec.code === true) {
      return null;
    }
  }
  return from.pos;
}

export function emptyBlockHintDecoration(state: EditorState): Decoration | null {
  const pos = caretInEmptyHintBlock(state);
  if (pos === null) {
    return null;
  }
  const from = state.selection.$from;
  return Decoration.node(from.before(), from.after(), {
    class: 'block-empty-hint',
    'data-empty-hint': EMPTY_BLOCK_HINT,
  });
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function iconSvg(doc: Document, kind: 'add' | 'grip'): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('block-gutter-icon');
  if (kind === 'add') {
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M8 3.5v9M3.5 8h9');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'round');
    svg.append(path);
    return svg;
  }
  const dots: ReadonlyArray<readonly [number, number]> = [
    [5.5, 4],
    [10.5, 4],
    [5.5, 8],
    [10.5, 8],
    [5.5, 12],
    [10.5, 12],
  ];
  for (const [cx, cy] of dots) {
    const circle = doc.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', String(cx));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', '1.15');
    circle.setAttribute('fill', 'currentColor');
    svg.append(circle);
  }
  return svg;
}

export function createGutterButton(doc: Document, kind: 'add' | 'grip'): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = kind === 'add' ? 'block-gutter-button block-gutter-add' : 'block-gutter-button block-gutter-grip';
  button.tabIndex = -1;
  button.setAttribute('aria-label', kind === 'add' ? ADD_BLOCK_LABEL : GRIP_LABEL);
  button.append(iconSvg(doc, kind));
  return button;
}

let tooltipSerial = 0;

export function createGripTooltip(doc: Document): HTMLSpanElement {
  tooltipSerial += 1;
  const tooltip = doc.createElement('span');
  tooltip.className = 'block-gutter-tooltip';
  tooltip.id = `block-grip-tooltip-${tooltipSerial}`;
  tooltip.setAttribute('role', 'tooltip');
  tooltip.dataset.open = 'false';
  tooltip.textContent = GRIP_TOOLTIP;
  return tooltip;
}

export interface BlockMenuDom {
  root: HTMLDivElement;
  search: HTMLInputElement;
  header: HTMLDivElement;
  list: HTMLDivElement;
}

let menuSerial = 0;

export function createBlockMenu(doc: Document): BlockMenuDom {
  menuSerial += 1;
  const root = doc.createElement('div');
  root.className = 'block-menu';
  root.dataset.input = 'pointer';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  const search = doc.createElement('input');
  search.type = 'text';
  search.className = 'block-menu-search';
  search.setAttribute('aria-label', BLOCK_MENU_SEARCH_LABEL);
  search.placeholder = BLOCK_MENU_SEARCH_LABEL;
  search.setAttribute('aria-autocomplete', 'list');
  const header = doc.createElement('div');
  header.className = 'block-menu-header';
  header.id = `block-menu-type-${menuSerial}`;
  root.setAttribute('aria-labelledby', header.id);
  const list = doc.createElement('div');
  list.className = 'block-menu-list';
  list.id = `block-menu-actions-${menuSerial}`;
  search.setAttribute('aria-controls', list.id);
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Block actions');
  root.append(search, header, list);
  return { root, search, header, list };
}

export function paintBlockMenu(
  menu: BlockMenuDom,
  state: EditorState,
  blockIndex: number,
  query: string,
  inputMode: 'pointer' | 'keyboard',
  focusedId: string | null,
): string | null {
  const node = state.doc.child(blockIndex);
  const label = blockTypeLabel(node);
  menu.header.textContent = label;
  menu.root.dataset.input = inputMode;
  menu.root.dataset.blockIndex = String(blockIndex);
  const actions = filterBlockMenuActions(BLOCK_MENU_ACTIONS, query);
  const enabled = actions.filter((action) => blockMenuActionEnabled(state, blockIndex, action.id));
  let activeId = focusedId;
  if (activeId === null || !enabled.some((action) => action.id === activeId)) {
    activeId = inputMode === 'keyboard' ? (enabled[0]?.id ?? null) : null;
  }
  menu.list.replaceChildren();
  for (const action of actions) {
    const row = menu.list.ownerDocument.createElement('button');
    row.type = 'button';
    row.className = 'block-menu-action';
    row.dataset.action = action.id;
    row.id = `${menu.list.id}-${action.id}`;
    row.setAttribute('role', 'option');
    const enabledAction = blockMenuActionEnabled(state, blockIndex, action.id);
    if (!enabledAction) {
      row.setAttribute('aria-disabled', 'true');
    }
    if (action.id === activeId) {
      row.dataset.focused = 'true';
      row.setAttribute('aria-selected', 'true');
    } else {
      row.setAttribute('aria-selected', 'false');
    }
    const name = menu.list.ownerDocument.createElement('span');
    name.className = 'block-menu-label';
    name.textContent = action.label;
    row.append(name);
    if (action.shortcut !== undefined) {
      const shortcut = menu.list.ownerDocument.createElement('span');
      shortcut.className = 'block-menu-shortcut';
      shortcut.textContent = action.shortcut;
      row.append(shortcut);
    }
    menu.list.append(row);
  }
  if (actions.length === 0) {
    const empty = menu.list.ownerDocument.createElement('div');
    empty.className = 'block-menu-empty';
    empty.textContent = 'No matching actions';
    menu.list.append(empty);
  }
  if (activeId === null) {
    menu.search.removeAttribute('aria-activedescendant');
  } else {
    menu.search.setAttribute('aria-activedescendant', `${menu.list.id}-${activeId}`);
  }
  return activeId;
}

export function blockMenuOptionIds(list: HTMLElement): string[] {
  return [...list.querySelectorAll<HTMLButtonElement>('.block-menu-action:not([aria-disabled="true"])')]
    .map((button) => button.dataset.action ?? '')
    .filter((id) => id.length > 0);
}
