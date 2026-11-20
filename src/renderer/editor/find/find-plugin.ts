import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorView } from 'prosemirror-view';
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import type { EditorState, Transaction } from 'prosemirror-state';
import { markCloseHistoryGroup } from '../history/groups.js';
import { findMatches, type FindMatch, type FindOptions } from './matches.js';

export interface FindBarState {
  open: boolean;
  showReplace: boolean;
  query: string;
  replacement: string;
  matchCase: boolean;
  wholeWord: boolean;
  currentIndex: number;
  savedSelection: { anchor: number; head: number } | null;
}

export const findPluginKey = new PluginKey<FindBarState>('findBar');

export const FIND_META = 'findBarPatch';

export function emptyFindBarState(): FindBarState {
  return {
    open: false,
    showReplace: false,
    query: '',
    replacement: '',
    matchCase: false,
    wholeWord: false,
    currentIndex: 0,
    savedSelection: null,
  };
}

export function findBarState(state: EditorState): FindBarState {
  return findPluginKey.getState(state) ?? emptyFindBarState();
}

function findOptions(state: FindBarState): FindOptions {
  return {
    query: state.query,
    matchCase: state.matchCase,
    wholeWord: state.wholeWord,
  };
}

export function listFindMatches(state: EditorState): FindMatch[] {
  const bar = findBarState(state);
  if (!bar.open || bar.query.length === 0) {
    return [];
  }
  return findMatches(state.doc, findOptions(bar));
}

function clampIndex(index: number, count: number): number {
  if (count === 0) {
    return 0;
  }
  return Math.max(0, Math.min(index, count - 1));
}

function patchFindBar(tr: Transaction, patch: Partial<FindBarState>): Transaction {
  return tr.setMeta(FIND_META, patch);
}

export function setFindBarState(tr: Transaction, patch: Partial<FindBarState>): Transaction {
  return patchFindBar(tr, patch);
}

function reconcileIndex(bar: FindBarState, matches: FindMatch[]): Partial<FindBarState> | null {
  if (matches.length === 0) {
    return bar.currentIndex === 0 ? null : { currentIndex: 0 };
  }
  const next = clampIndex(bar.currentIndex, matches.length);
  return next === bar.currentIndex ? null : { currentIndex: next };
}

function findDecorations(state: EditorState): DecorationSet {
  const bar = findBarState(state);
  if (!bar.open || bar.query.length === 0) {
    return DecorationSet.empty;
  }
  const matches = findMatches(state.doc, findOptions(bar));
  const current = matches.length === 0 ? -1 : clampIndex(bar.currentIndex, matches.length);
  const decorations = matches.map((match, index) => Decoration.inline(match.from, match.to, {
    class: index === current ? 'find-match find-match-current' : 'find-match',
  }));
  return DecorationSet.create(state.doc, decorations);
}

function scrollToMatch(view: EditorView, match: FindMatch): void {
  const head = match.from;
  const tr = view.state.tr
    .setSelection(TextSelection.create(view.state.doc, head, head))
    .scrollIntoView();
  view.dispatch(tr);
}

function stepMatch(view: EditorView, direction: 1 | -1): boolean {
  const bar = findBarState(view.state);
  if (!bar.open || bar.query.length === 0) {
    return false;
  }
  const matches = listFindMatches(view.state);
  if (matches.length === 0) {
    return false;
  }
  const current = clampIndex(bar.currentIndex, matches.length);
  const next = (current + direction + matches.length) % matches.length;
  view.dispatch(patchFindBar(view.state.tr, { currentIndex: next }));
  const refreshed = listFindMatches(view.state);
  const match = refreshed[clampIndex(next, refreshed.length)];
  if (match !== undefined) {
    scrollToMatch(view, match);
  }
  return true;
}

function replaceCurrentMatch(view: EditorView): boolean {
  const bar = findBarState(view.state);
  if (!bar.open || bar.query.length === 0) {
    return false;
  }
  const matches = listFindMatches(view.state);
  if (matches.length === 0) {
    return false;
  }
  const current = clampIndex(bar.currentIndex, matches.length);
  const match = matches[current]!;
  let tr = view.state.tr.insertText(bar.replacement, match.from, match.to);
  const after = findMatches(tr.doc, findOptions(bar));
  const nextIndex = after.length === 0 ? 0 : clampIndex(current, after.length);
  tr = patchFindBar(tr, { currentIndex: nextIndex });
  view.dispatch(tr);
  if (after.length > 0) {
    const next = after[clampIndex(nextIndex, after.length)]!;
    scrollToMatch(view, next);
  }
  return true;
}

function replaceAllMatches(view: EditorView): boolean {
  const bar = findBarState(view.state);
  if (!bar.open || bar.query.length === 0) {
    return false;
  }
  const matches = listFindMatches(view.state);
  if (matches.length === 0) {
    return false;
  }
  let tr = view.state.tr;
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index]!;
    tr = tr.insertText(bar.replacement, match.from, match.to);
  }
  tr = markCloseHistoryGroup(tr);
  tr = patchFindBar(tr, { currentIndex: 0 });
  view.dispatch(tr);
  return true;
}

export function findPlugin(): Plugin {
  return new Plugin({
    key: findPluginKey,
    state: {
      init(): FindBarState {
        return emptyFindBarState();
      },
      apply(tr, value): FindBarState {
        const patch = tr.getMeta(FIND_META) as Partial<FindBarState> | undefined;
        let next = patch === undefined ? value : { ...value, ...patch };
        if (tr.docChanged && next.open && next.query.length > 0) {
          const matches = findMatches(tr.doc, findOptions(next));
          const indexPatch = reconcileIndex(next, matches);
          if (indexPatch !== null) {
            next = { ...next, ...indexPatch };
          }
        }
        return next;
      },
    },
    props: {
      decorations(state) {
        return findDecorations(state);
      },
      handleKeyDown(view, event) {
        const bar = findBarState(view.state);
        if (!bar.open) {
          return false;
        }
        if (event.key === 'F3' || event.code === 'F3') {
          if (typeof event.preventDefault === 'function') {
            event.preventDefault();
          }
          return stepMatch(view, event.shiftKey ? -1 : 1);
        }
        return false;
      },
    },
  });
}

export const findCommands = {
  open(view: EditorView, options: { showReplace?: boolean; query?: string } = {}): void {
    const { anchor, head } = view.state.selection;
    const query = options.query ?? (view.state.selection.empty
      ? findBarState(view.state).query
      : view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, ' '));
    const tr = patchFindBar(view.state.tr, {
      open: true,
      showReplace: options.showReplace === true,
      query,
      savedSelection: { anchor, head },
      currentIndex: 0,
    });
    view.dispatch(tr);
    const matches = listFindMatches(view.state);
    if (matches.length > 0) {
      scrollToMatch(view, matches[0]!);
    }
  },
  close(view: EditorView): void {
    const bar = findBarState(view.state);
    let tr = patchFindBar(view.state.tr, {
      open: false,
      showReplace: false,
      currentIndex: 0,
      savedSelection: null,
    });
    if (bar.savedSelection !== null) {
      const { anchor, head } = bar.savedSelection;
      const max = view.state.doc.content.size;
      const safeAnchor = Math.max(0, Math.min(anchor, max));
      const safeHead = Math.max(0, Math.min(head, max));
      tr = tr.setSelection(TextSelection.create(tr.doc, safeAnchor, safeHead));
    }
    view.dispatch(tr);
  },
  patch(view: EditorView, patch: Partial<FindBarState>): void {
    view.dispatch(patchFindBar(view.state.tr, patch));
  },
  next(view: EditorView): boolean {
    return stepMatch(view, 1);
  },
  previous(view: EditorView): boolean {
    return stepMatch(view, -1);
  },
  replaceCurrent(view: EditorView): boolean {
    return replaceCurrentMatch(view);
  },
  replaceAll(view: EditorView): boolean {
    return replaceAllMatches(view);
  },
  snapshot(state: EditorState): {
    open: boolean;
    showReplace: boolean;
    query: string;
    replacement: string;
    matchCase: boolean;
    wholeWord: boolean;
    matchCount: number;
    currentIndex: number;
  } {
    const bar = findBarState(state);
    const matches = listFindMatches(state);
    return {
      open: bar.open,
      showReplace: bar.showReplace,
      query: bar.query,
      replacement: bar.replacement,
      matchCase: bar.matchCase,
      wholeWord: bar.wholeWord,
      matchCount: matches.length,
      currentIndex: matches.length === 0 ? 0 : clampIndex(bar.currentIndex, matches.length),
    };
  },
};