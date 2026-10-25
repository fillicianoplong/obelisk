import { splitBlock } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import type { EditorState, Selection, Transaction } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { useLayoutEffect, useRef } from 'react';
import 'prosemirror-view/style/prosemirror.css';
import './editor.css';
import { editorSchema } from './schema.js';
import { runWithSynchronousEditorUpdate } from './flush.js';
import { isUnpromptedEdgeSelection, paragraphCaret, paragraphPosition } from './state.js';

interface EditorCoreProps {
  tabId: string;
  state: EditorState;
  onChange: (tabId: string, state: EditorState) => void;
}

function writeReportedCaret(view: EditorView): void {
  const caret = paragraphCaret(view.state);
  view.dom.setAttribute('data-editor-caret', `${caret.paragraph}:${caret.offset}`);
}

function selectionFromEditorDom(view: EditorView): TextSelection | null {
  const domSelection = view.dom.ownerDocument.getSelection();
  if (domSelection === null || domSelection.rangeCount === 0) {
    return null;
  }
  const { anchorNode, focusNode } = domSelection;
  if (anchorNode === null || focusNode === null) {
    return null;
  }
  if (!view.dom.contains(anchorNode) || !view.dom.contains(focusNode)) {
    return null;
  }
  try {
    const anchor = view.posAtDOM(anchorNode, domSelection.anchorOffset);
    const head = view.posAtDOM(focusNode, domSelection.focusOffset);
    return TextSelection.create(view.state.doc, anchor, head);
  } catch {
    return null;
  }
}

function installEditorCommands(view: EditorView, placeSelection: (editorView: EditorView) => void): void {
  // Same transactions as typing, Enter, and undo. They do not need an OS key event,
  // so a window that is not in the foreground can still edit the page.
  const dispatch = view.dispatch.bind(view);
  const commands = {
    insertText(text: string) {
      runWithSynchronousEditorUpdate(() => {
        view.dispatch(view.state.tr.insertText(text));
      });
    },
    splitParagraph() {
      let applied = false;
      runWithSynchronousEditorUpdate(() => {
        applied = splitBlock(view.state, dispatch);
      });
      if (!applied) {
        throw new Error('The paragraph could not be split.');
      }
    },
    undo() {
      let applied = false;
      runWithSynchronousEditorUpdate(() => {
        applied = undo(view.state, dispatch);
      });
      if (!applied) {
        throw new Error('There is nothing to undo.');
      }
    },
    redo() {
      let applied = false;
      runWithSynchronousEditorUpdate(() => {
        applied = redo(view.state, dispatch);
      });
      if (!applied) {
        throw new Error('There is nothing to redo.');
      }
    },
    setParagraphCaret(paragraph: number, offset: number) {
      runWithSynchronousEditorUpdate(() => {
        const position = paragraphPosition(view.state, paragraph, offset);
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)));
      });
      placeSelection(view);
    },
    replaceText(text: string) {
      runWithSynchronousEditorUpdate(() => {
        const lines = text.split('\n');
        const nodes = lines.map((line) => editorSchema.nodes.paragraph.create(
          null,
          line.length > 0 ? editorSchema.text(line) : null,
        ));
        view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, nodes));
      });
    },
  };
  Object.defineProperty(view.dom, 'editorCommands', {
    configurable: true,
    value: commands,
  });
}

function selectionIsEdge(view: EditorView, selection: Selection): boolean {
  const { doc } = view.state;
  return selection.eq(TextSelection.atStart(doc)) || selection.eq(TextSelection.atEnd(doc));
}

export function EditorCore({ tabId, state, onChange }: EditorCoreProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return undefined;
    }

    // This view owns the tab's EditorState, including selection and undo.
    // Rebuilding it on each keystroke would drop both.
    const ownedTabId = tabId;
    let placing = false;
    let placeQueued = false;
    let places = 0;

    const publish = (editorView: EditorView, next: EditorState) => {
      writeReportedCaret(editorView);
      onChangeRef.current(ownedTabId, next);
    };

    const placeSelectionInDom = (editorView: EditorView) => {
      const live = selectionFromEditorDom(editorView);
      if (live?.eq(editorView.state.selection)) {
        return;
      }
      const domSelection = editorView.dom.ownerDocument.getSelection();
      if (domSelection === null) {
        return;
      }
      const anchor = editorView.domAtPos(editorView.state.selection.anchor);
      const head = editorView.domAtPos(editorView.state.selection.head);
      placing = true;
      domSelection.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
      placing = false;
    };

    const adoptDomSelection = (editorView: EditorView) => {
      if (editorView.composing || placing) {
        return;
      }
      const live = selectionFromEditorDom(editorView);
      if (live === null || live.eq(editorView.state.selection)) {
        return;
      }
      // Blur can park the DOM caret at either edge after the tab's caret is
      // already stored. Keep that stored caret.
      if (selectionIsEdge(editorView, live) && !selectionIsEdge(editorView, editorView.state.selection)) {
        return;
      }
      const next = editorView.state.apply(editorView.state.tr.setSelection(live));
      editorView.updateState(next);
      publish(editorView, next);
    };

    const view = new EditorView(host, {
      state,
      attributes: {
        'aria-label': 'Page',
        class: 'page-sheet',
        'data-region': 'page-editor',
        spellcheck: 'true',
      },
      dispatchTransaction(transaction: Transaction) {
        // Chromium moves a contenteditable caret to the end when the page is
        // focused. That selection has no key, click, or composition behind it.
        // Applying it drops the caret this tab was showing.
        if (!placing && isUnpromptedEdgeSelection(transaction, view.state.selection)) {
          if (places < 5 && !placeQueued) {
            places += 1;
            placeQueued = true;
            queueMicrotask(() => {
              placeQueued = false;
              if (!view.isDestroyed) {
                placeSelectionInDom(view);
              }
            });
          }
          return;
        }
        places = 0;
        const next = view.state.apply(transaction);
        view.updateState(next);
        publish(view, next);
      },
      handleDOMEvents: {
        blur() {
          adoptDomSelection(view);
          return false;
        },
      },
    });
    writeReportedCaret(view);
    installEditorCommands(view, placeSelectionInDom);
    // Put the stored caret into the DOM even when the window is not focused.
    // selectionToDOM does nothing until the editor owns document focus.
    placeSelectionInDom(view);

    const onSelectionChange = () => {
      // Arrow keys move the DOM caret before ProseMirror records them. After
      // the page blurs, ProseMirror drops that event, so copy it into the tab.
      if (!view.hasFocus() && !placing) {
        adoptDomSelection(view);
      }
    };
    view.dom.ownerDocument.addEventListener('selectionchange', onSelectionChange);
    view.focus();

    return () => {
      view.dom.ownerDocument.removeEventListener('selectionchange', onSelectionChange);
      adoptDomSelection(view);
      onChangeRef.current(ownedTabId, view.state);
      delete (view.dom as HTMLElement & { editorCommands?: unknown }).editorCommands;
      view.destroy();
    };
    // `state` is the tab snapshot at mount. Later edits stay in the view.
  }, [tabId]);

  return <div ref={hostRef} className="editor-host" />;
}
