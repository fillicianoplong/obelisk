import type { Node as ProseNode } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

// Same dark text the light theme already uses, so a light highlight reads the
// same there and stays readable when the theme text is light.
const HIGHLIGHT_INK = '#1f2630';
const LIGHT_HIGHLIGHT_LUMINANCE = 0.4;

function linearChannel(hex: string, offset: number): number {
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  if (value <= 0.03928) {
    return value / 12.92;
  }
  return ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  return (0.2126 * linearChannel(hex, 1))
    + (0.7152 * linearChannel(hex, 3))
    + (0.0722 * linearChannel(hex, 5));
}

function highlightIsLight(hex: string): boolean {
  return relativeLuminance(hex) >= LIGHT_HIGHLIGHT_LUMINANCE;
}

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
  let lightHighlight = false;
  for (const color of highlightColors) {
    const ink = highlightIsLight(color) ? `; color: ${HIGHLIGHT_INK}` : '';
    if (ink !== '') {
      lightHighlight = true;
    }
    sheet.insertRule(
      `.page-sheet span[data-highlight="${color}"] { background-color: ${color}${ink}; }`,
      sheet.cssRules.length,
    );
  }
  if (lightHighlight) {
    sheet.insertRule(
      '.page-sheet span[data-text-color] span[data-highlight] { color: inherit; }',
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
