import { findCommands } from '../../editor/find/find-plugin.js';
import type { FindBarState } from '../../editor/find/find-plugin.js';

export interface FindSnapshot {
  open: boolean;
  showReplace: boolean;
  query: string;
  replacement: string;
  matchCase: boolean;
  wholeWord: boolean;
  matchCount: number;
  currentIndex: number;
}

export interface FindCommandBridge {
  open: (options?: { showReplace?: boolean; query?: string }) => void;
  close: () => void;
  patch: (patch: Partial<FindBarState>) => void;
  next: () => void;
  previous: () => void;
  replaceCurrent: () => void;
  replaceAll: () => void;
  snapshot: () => FindSnapshot;
}

function editorPage(): (HTMLElement & { editorView?: import('prosemirror-view').EditorView }) | null {
  const page = document.querySelector<HTMLElement>('[data-region="page-editor"]');
  return page ?? null;
}

export function activeEditorFindCommands(): FindCommandBridge | null {
  const page = editorPage();
  const view = page?.editorView;
  if (view === undefined || view.isDestroyed) {
    return null;
  }
  return {
    open(options) {
      findCommands.open(view, options);
    },
    close() {
      findCommands.close(view);
    },
    patch(patch) {
      findCommands.patch(view, patch);
    },
    next() {
      findCommands.next(view);
    },
    previous() {
      findCommands.previous(view);
    },
    replaceCurrent() {
      findCommands.replaceCurrent(view);
    },
    replaceAll() {
      findCommands.replaceAll(view);
    },
    snapshot() {
      return findCommands.snapshot(view.state);
    },
  };
}