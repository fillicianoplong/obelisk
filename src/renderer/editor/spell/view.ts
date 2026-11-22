import { Plugin, PluginKey } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import { ReplaceStep } from 'prosemirror-transform';
import type { EditorView } from 'prosemirror-view';
import { spellcheckEnabled, whenSpellcheckChanges } from '../spellcheck-mode.js';
import {
  cachedMisspelled,
  checkWords,
  rememberChecked,
  whenSpellCacheChanges,
} from './client.js';
import { spellingSpans, wordSpans, type SpellSpan } from './ranges.js';

export const SPELL_DEBOUNCE_MS = 150;
const HIGHLIGHT_NAME = 'obk-spelling';
const spellingKey = new PluginKey<boolean>('spelling');

interface HighlightRange {
  setStart(node: globalThis.Node, offset: number): void;
  setEnd(node: globalThis.Node, offset: number): void;
}

type HighlightList = new (...ranges: HighlightRange[]) => object;

interface HighlightRegistry {
  set(name: string, highlight: object): void;
  delete(name: string): void;
}

const painted = new Map<EditorView, HighlightRange[]>();
let highlightRegistry: HighlightRegistry | null = null;

function typingWord(tr: Transaction): boolean {
  if (!tr.docChanged || tr.getMeta('addToHistory') === false || tr.steps.length !== 1) {
    return false;
  }
  const ui = tr.getMeta('uiEvent');
  if (ui === 'paste' || ui === 'cut' || ui === 'drop') {
    return false;
  }
  const step = tr.steps[0];
  if (!(step instanceof ReplaceStep)) {
    return false;
  }
  const inserted = step.slice.content.textBetween(0, step.slice.content.size, '\n', '\n');
  const removed = step.to - step.from;
  if (removed > 8 || inserted.length > 8 || /[\s\p{N}]/u.test(inserted)) {
    return false;
  }
  return true;
}

function highlightApi(view: EditorView): { Highlight: HighlightList; registry: HighlightRegistry } | null {
  const owner = view.dom.ownerDocument.defaultView as (Window & {
    Highlight?: HighlightList;
    CSS?: { highlights?: HighlightRegistry };
  }) | null;
  const Highlight = owner?.Highlight;
  const registry = owner?.CSS?.highlights;
  if (Highlight === undefined || registry === undefined) {
    return null;
  }
  return { Highlight, registry };
}

function domRange(view: EditorView, span: SpellSpan): HighlightRange | null {
  try {
    const start = view.domAtPos(span.from);
    const end = view.domAtPos(span.to);
    const range = view.dom.ownerDocument.createRange() as HighlightRange;
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  } catch {
    return null;
  }
}

function paintAll(Highlight: HighlightList | null): void {
  if (highlightRegistry === null) {
    return;
  }
  const ranges: HighlightRange[] = [];
  for (const list of painted.values()) {
    ranges.push(...list);
  }
  if (ranges.length === 0 || Highlight === null) {
    highlightRegistry.delete(HIGHLIGHT_NAME);
    return;
  }
  highlightRegistry.set(HIGHLIGHT_NAME, new Highlight(...ranges));
}

function paintView(view: EditorView, spans: readonly SpellSpan[]): void {
  const api = highlightApi(view);
  if (api !== null) {
    highlightRegistry = api.registry;
  }
  const ranges: HighlightRange[] = [];
  for (const span of spans) {
    const range = domRange(view, span);
    if (range !== null) {
      ranges.push(range);
    }
  }
  painted.set(view, ranges);
  paintAll(api?.Highlight ?? null);
}

function clearView(view: EditorView): void {
  painted.delete(view);
  paintAll(highlightApi(view)?.Highlight ?? null);
}

function caretToSkip(view: EditorView): number | null {
  if (spellingKey.getState(view.state) !== true || !view.state.selection.empty) {
    return null;
  }
  return view.state.selection.head;
}

export function spellingViewPlugin(): Plugin {
  return new Plugin({
    key: spellingKey,
    state: {
      init: () => false,
      apply(tr, prev) {
        if (!tr.docChanged && !tr.selectionSet) {
          return prev;
        }
        if (!tr.docChanged) {
          return false;
        }
        return typingWord(tr);
      },
    },
    view(view) {
      let timer = 0;
      let generation = 0;
      const draw = () => {
        if (view.isDestroyed) {
          return;
        }
        view.dom.setAttribute('spellcheck', 'false');
        if (!spellcheckEnabled()) {
          paintView(view, []);
          return;
        }
        const generationNow = generation + 1;
        generation = generationNow;
        const caret = caretToSkip(view);
        const words = wordSpans(view.state.doc);
        const needed = [...new Set(
          words.filter((span) => cachedMisspelled(span.word) === undefined).map((span) => span.word),
        )];
        const apply = () => {
          if (generation !== generationNow || view.isDestroyed || !spellcheckEnabled()) {
            return;
          }
          paintView(view, spellingSpans(view.state.doc, caret, (word) => cachedMisspelled(word) === true));
        };
        if (needed.length === 0) {
          apply();
          return;
        }
        void checkWords(needed).then((misspelled) => {
          if (misspelled !== null) {
            rememberChecked(needed, misspelled);
          }
          apply();
        });
      };
      const schedule = () => {
        globalThis.clearTimeout(timer);
        timer = globalThis.setTimeout(draw, SPELL_DEBOUNCE_MS);
      };
      view.dom.setAttribute('spellcheck', 'false');
      if (spellcheckEnabled()) {
        schedule();
      }
      const stopMode = whenSpellcheckChanges((enabled) => {
        if (view.isDestroyed) {
          return;
        }
        if (!enabled) {
          globalThis.clearTimeout(timer);
          paintView(view, []);
          return;
        }
        schedule();
      });
      const stopCache = whenSpellCacheChanges(() => {
        if (!view.isDestroyed && spellcheckEnabled()) {
          schedule();
        }
      });
      return {
        update(next, prev) {
          next.dom.setAttribute('spellcheck', 'false');
          if (!spellcheckEnabled()) {
            paintView(next, []);
            return;
          }
          if (prev.doc.eq(next.state.doc) && prev.selection.eq(next.state.selection)) {
            return;
          }
          schedule();
        },
        destroy() {
          globalThis.clearTimeout(timer);
          clearView(view);
          stopMode();
          stopCache();
        },
      };
    },
  });
}
