import type { Node as ProseNode } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

function colorsFromDoc(doc: ProseNode): { text: Set<string>; highlight: Set<string> } {
  const text = new Set<string>();
  const highlight = new Set<string>();
  doc.descendants((node) => {
    if (!node.isText) {
      return;
    }
    for (const mark of node.marks) {
      if (mark.type.name === 'textColor' && typeof mark.attrs.color === 'string' && COLOR_PATTERN.test(mark.attrs.color)) {
        text.add(mark.attrs.color.toLowerCase());
      }
      if (mark.type.name === 'highlight' && typeof mark.attrs.color === 'string' && COLOR_PATTERN.test(mark.attrs.color)) {
        highlight.add(mark.attrs.color.toLowerCase());
      }
    }
  });
  return { text, highlight };
}

function syncColorSheet(
  sheet: CSSStyleSheet,
  textColors: Set<string>,
  highlightColors: Set<string>,
): void {
  while (sheet.cssRules.length > 0) {
    sheet.deleteRule(0);
  }
  for (const color of textColors) {
    sheet.insertRule(
      `.page-sheet span[data-text-color="${color}"] { color: ${color}; }`,
      sheet.cssRules.length,
    );
  }
  for (const color of highlightColors) {
    sheet.insertRule(
      `.page-sheet span[data-highlight="${color}"] { background-color: ${color}; }`,
      sheet.cssRules.length,
    );
  }
}

function adoptConstructableSheet(doc: Document, sheet: CSSStyleSheet): () => void {
  const existing = doc.adoptedStyleSheets;
  doc.adoptedStyleSheets = [...existing, sheet];
  return () => {
    doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((entry) => entry !== sheet);
  };
}

function tryInstallColorSheet(
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

function applyColorRules(state: EditorState, sheet: CSSStyleSheet): void {
  const { text, highlight } = colorsFromDoc(state.doc);
  syncColorSheet(sheet, text, highlight);
}

export function editorColorStylesPlugin(): Plugin {
  return new Plugin({
    view(view: EditorView) {
      const doc = view.dom.ownerDocument;
      const win = doc.defaultView;
      if (win === null) {
        return {};
      }
      const installed = tryInstallColorSheet(doc, win);
      if (installed === null) {
        return {};
      }
      const { sheet, release } = installed;
      applyColorRules(view.state, sheet);
      return {
        update(updatedView) {
          applyColorRules(updatedView.state, sheet);
        },
        destroy() {
          release();
        },
      };
    },
  });
}
