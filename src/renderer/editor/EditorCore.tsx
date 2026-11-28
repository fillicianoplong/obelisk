import type { JsonObject } from '../../shared/ipc/types.js';
import { PageBands, type BandEdit } from './header/PageBands.js';
import { reservedMarginIn } from './header/page-field.js';
import './header/header.css';
import { redo, undo } from 'prosemirror-history';
import type { EditorState, Selection, Transaction } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import 'prosemirror-view/style/prosemirror.css';
import './editor.css';
import { DOCUMENT_LABEL } from '../shell/focus/regions.js';
import { bindPageFocus, pageFocusRestoresCaret, suppressPageFocusRing } from '../shell/page-focus.js';
import { editorSchema } from './schema.js';
import { runWithSynchronousEditorUpdate } from './flush.js';
import {
  caretInsideBlock,
  duplicateBlockAt,
  insertTextBlock,
  pasteBlockJson,
  setChecklistItemChecked,
} from './block-commands.js';
import type { TextBlockKind } from './schema.js';
import { editorBlockSnapshot } from './schema/mapping.js';
import { newBlockId } from './block-id.js';
import { cssPixelsAt96Dpi, PAGE_HEADER_OFFSET_IN, pageZoomVars } from './layout/page.js';
import type { PageBox, PageMargins } from './layout/paginate.js';
import { pageBoxFromMargins, scalePageBox } from './layout/paginate.js';
import type { PageLayoutReport, PaginationHost } from './layout/paginate-plugin.js';
import {
  layoutPagination,
  paginationPlugin,
  paginationPluginKey,
  paginationSnapshot,
  takeScrollAnchor,
} from './layout/paginate-plugin.js';
import { bindPageOriginScroll } from './layout/page-scroll.js';
import {
  createWordClickSession,
  textblockRangeAt,
  watchSelectionDrag,
} from './select-word.js';
import { isUnpromptedEdgeSelection, paragraphCaret, paragraphPosition } from './state.js';
import {
  applyCharacterMarksCommand,
  formatMenuCommand,
} from './format-commands.js';
import { applyLinkCommand, linkAround, linkDraftFromState, removeLinkCommand } from './link/commands.js';
import { eventTargetsLink, linkClickAction } from './link/open-on-click.js';
import { openLinkBubble } from './link/link-bubble-plugin.js';
import { requestShellCommand } from './editor-command-event.js';
import { editorMenuCommand } from './menu-commands.js';
import { replaceSpellingSuggestion } from './spell-replace.js';
import { splitParagraphKeepingFormat } from './paragraph-format-commands.js';
import { AllSelection } from 'prosemirror-state';
import { contextMenuEditorPlugin } from '../shell/contextmenu/editor-plugin.js';
import { findCommands } from './find/find-plugin.js';
import { markCloseHistoryGroup } from './history/groups.js';
import '../blocks/image/image.css';
import { setActiveImageTabId } from '../blocks/image/assets.js';
import { structuredNodeViews } from '../blocks/image/view.js';

interface EditorCoreProps {
  tabId: string;
  state: EditorState;
  viewMode: 'pages' | 'pageless';
  orientation?: 'portrait' | 'landscape';
  margins: PageMargins;
  header?: JsonObject;
  footer?: JsonObject;
  bandEdit?: BandEdit | null;
  zoom?: number;
  onChange: (tabId: string, state: EditorState) => void;
  onPageLabel: (label: string) => void;
  onBandEdit?: (part: 'header' | 'footer', page: number) => void;
  onBandClose?: (reason?: 'escape') => void;
  onBandChange?: (part: 'header' | 'footer', paragraph: JsonObject) => void;
  onBandMove?: (direction: 1 | -1) => void;
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

function installEditorCommands(
  view: EditorView,
  placeSelection: (editorView: EditorView) => void,
  layoutHost: PaginationHost,
): void {
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
        applied = splitParagraphKeepingFormat()(view.state, dispatch);
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
    setSelection(anchor: number, head: number) {
      runWithSynchronousEditorUpdate(() => {
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)));
      });
      placeSelection(view);
    },
    selection() {
      const { anchor, head, empty } = view.state.selection;
      return {
        anchor,
        head,
        empty,
        text: view.state.doc.textBetween(view.state.selection.from, view.state.selection.to),
      };
    },
    focusEditedPage(pageNumber: number) {
      // Esc in a header sets keyboard focus. Return to this page's body
      // without the page ring, and keep the caret on that page.
      suppressPageFocusRing();
      const frame = view.dom.ownerDocument.querySelector(`.page-frame[data-page="${pageNumber}"]`);
      if (frame instanceof HTMLElement && !caretInsideFrame(view, frame)) {
        const pos = firstTextPosInFrame(view, frame);
        if (pos !== null) {
          const tr = view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos)));
          tr.setMeta('pointer', true);
          view.dispatch(tr);
        }
      }
      view.focus();
      placeSelection(view);
      view.dom.removeAttribute('data-focus-source');
    },
    replaceText(text: string) {
      runWithSynchronousEditorUpdate(() => {
        const lines = text.split('\n');
        const nodes = lines.map((line) => editorSchema.nodes.paragraph.create(
          {
            blockId: newBlockId(),
            align: 'left',
            lineSpacing: 'single',
            spaceBefore: 0,
            spaceAfter: 0,
            indentLeft: 0,
            indentFirst: 0,
            indentHanging: 0,
          },
          line.length > 0 ? editorSchema.text(line) : null,
        ));
        view.dispatch(markCloseHistoryGroup(view.state.tr.replaceWith(0, view.state.doc.content.size, nodes)));
      });
    },
    insertBlock(kind: TextBlockKind, options: { level?: number; text?: string; after?: number } = {}) {
      runWithSynchronousEditorUpdate(() => {
        const tr = insertTextBlock(view.state.tr, kind, newBlockId, options);
        view.dispatch(tr);
      });
    },
    duplicateBlock(blockIndex: number) {
      runWithSynchronousEditorUpdate(() => {
        const tr = duplicateBlockAt(view.state.tr, blockIndex, newBlockId);
        view.dispatch(tr);
      });
    },
    pasteBlock(block: JsonObject, after?: number) {
      runWithSynchronousEditorUpdate(() => {
        const tr = pasteBlockJson(view.state.tr, block, newBlockId, after);
        view.dispatch(tr);
      });
    },
    setChecklistChecked(blockIndex: number, itemIndex: number, checked: boolean) {
      runWithSynchronousEditorUpdate(() => {
        const tr = setChecklistItemChecked(view.state.tr, blockIndex, itemIndex, checked);
        view.dispatch(tr);
      });
    },
    blockSnapshot() {
      return editorBlockSnapshot(view.state.doc);
    },
    runFormatMenu(menuId: string) {
      runWithSynchronousEditorUpdate(() => {
        const command = formatMenuCommand(menuId);
        if (command !== null) {
          command(view.state, view.dispatch.bind(view));
        }
      });
    },
    replaceSpelling(word: string, suggestion: string) {
      runWithSynchronousEditorUpdate(() => {
        const tr = replaceSpellingSuggestion(view.state, word, suggestion);
        if (tr !== null) {
          view.dispatch(tr);
        }
      });
    },
    runMenuCommand(menuId: string) {
      runWithSynchronousEditorUpdate(() => {
        const command = editorMenuCommand(menuId);
        if (command !== null) {
          command(view.state, view.dispatch.bind(view), view);
        }
      });
    },
    clearFormatting() {
      runWithSynchronousEditorUpdate(() => {
        const command = formatMenuCommand('format-clear');
        if (command !== null) {
          command(view.state, view.dispatch.bind(view));
        }
      });
    },
    applyCharacterMarks(marks: Record<string, unknown>) {
      runWithSynchronousEditorUpdate(() => {
        applyCharacterMarksCommand(marks)(view.state, view.dispatch.bind(view));
      });
    },
    selectAllDocument() {
      runWithSynchronousEditorUpdate(() => {
        view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
      });
    },
    focusBlock(blockIndex: number, offset = 0) {
      runWithSynchronousEditorUpdate(() => {
        view.dispatch(view.state.tr.setSelection(caretInsideBlock(view.state.doc, blockIndex, offset)));
      });
      placeSelection(view);
    },
    findOpen(options: { showReplace?: boolean; query?: string } = {}) {
      runWithSynchronousEditorUpdate(() => {
        findCommands.open(view, options);
      });
    },
    findClose() {
      runWithSynchronousEditorUpdate(() => {
        findCommands.close(view);
      });
    },
    findPatch(patch: Record<string, unknown>) {
      runWithSynchronousEditorUpdate(() => {
        findCommands.patch(view, patch);
      });
    },
    findNext() {
      runWithSynchronousEditorUpdate(() => {
        findCommands.next(view);
      });
    },
    findPrevious() {
      runWithSynchronousEditorUpdate(() => {
        findCommands.previous(view);
      });
    },
    findReplaceCurrent() {
      runWithSynchronousEditorUpdate(() => {
        findCommands.replaceCurrent(view);
      });
    },
    findReplaceAll() {
      runWithSynchronousEditorUpdate(() => {
        findCommands.replaceAll(view);
      });
    },
    findSnapshot() {
      return findCommands.snapshot(view.state);
    },
    linkDraft() {
      return linkDraftFromState(view.state);
    },
    linkAddress() {
      return linkAround(view.state)?.address ?? null;
    },
    layoutPages() {
      return layoutPagination(view, layoutHost);
    },
    pageSnapshot() {
      return paginationSnapshot(view);
    },
    applyLink(text: string, address: string) {
      let applied = false;
      runWithSynchronousEditorUpdate(() => {
        applied = applyLinkCommand(text, address)(view.state, dispatch);
      });
      return applied;
    },
    removeLink() {
      runWithSynchronousEditorUpdate(() => {
        removeLinkCommand()(view.state, dispatch);
      });
    },
  };
  Object.defineProperty(view.dom, 'editorCommands', {
    configurable: true,
    value: commands,
  });
  Object.defineProperty(view.dom, 'editorView', {
    configurable: true,
    value: view,
  });
}

function caretInsideFrame(view: EditorView, frame: HTMLElement): boolean {
  try {
    const coords = view.coordsAtPos(view.state.selection.head);
    const rect = frame.getBoundingClientRect();
    return coords.top >= rect.top && coords.bottom <= rect.bottom + 1
      && coords.left >= rect.left && coords.left <= rect.right;
  } catch {
    return false;
  }
}

function firstTextPosInFrame(view: EditorView, frame: HTMLElement): number | null {
  const rect = frame.getBoundingClientRect();
  let found: number | null = null;
  view.state.doc.descendants((node, pos) => {
    if (found !== null || !node.isText) {
      return found === null;
    }
    try {
      const coords = view.coordsAtPos(pos);
      if (
        coords.top >= rect.top && coords.top <= rect.bottom
        && coords.left >= rect.left && coords.left <= rect.right
      ) {
        found = pos;
      }
    } catch {
      // A position that is not laid out yet is not on this page.
    }
    return false;
  });
  return found;
}

function selectionIsEdge(view: EditorView, selection: Selection): boolean {
  const { doc } = view.state;
  return selection.eq(TextSelection.atStart(doc)) || selection.eq(TextSelection.atEnd(doc));
}

export function EditorCore({
  tabId,
  state,
  viewMode,
  orientation = 'portrait',
  margins,
  header,
  footer,
  bandEdit = null,
  zoom = 100,
  onChange,
  onPageLabel,
  onBandEdit,
  onBandClose,
  onBandChange,
  onBandMove,
}: EditorCoreProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onPageLabelRef = useRef(onPageLabel);
  const viewModeRef = useRef(viewMode);
  const orientationRef = useRef(orientation);
  const marginsRef = useRef(margins);
  const zoomRef = useRef(zoom);
  const onBandCloseRef = useRef(onBandClose);
  const bandEditRef = useRef(bandEdit);
  const viewRef = useRef<EditorView | null>(null);
  onChangeRef.current = onChange;
  onPageLabelRef.current = onPageLabel;
  viewModeRef.current = viewMode;
  orientationRef.current = orientation;
  marginsRef.current = margins;
  zoomRef.current = zoom;
  onBandCloseRef.current = onBandClose;
  bandEditRef.current = bandEdit;
  const [bandPx, setBandPx] = useState({ header: 0, footer: 0 });
  const bandPxRef = useRef(bandPx);
  bandPxRef.current = bandPx;
  const [pageCount, setPageCount] = useState(1);
  const [caretPage, setCaretPage] = useState(0);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const layoutHostRef = useRef<PaginationHost | null>(null);
  if (layoutHostRef.current === null) {
    layoutHostRef.current = {
      getMode: () => viewModeRef.current,
      getBox: () => {
        const current = marginsRef.current;
        return scalePageBox(pageBoxFromMargins({
          top: reservedMarginIn(current.top, bandPxRef.current.header, zoomRef.current),
          right: current.right,
          bottom: reservedMarginIn(current.bottom, bandPxRef.current.footer, zoomRef.current),
          left: current.left,
        }, orientationRef.current), zoomRef.current);
      },
      onLayout: (report: PageLayoutReport) => {
        setPageCount((current) => (current === report.pageCount ? current : report.pageCount));
        setCaretPage((current) => (current === report.page ? current : report.page));
        onPageLabelRef.current(report.label);
      },
    };
  }

  useLayoutEffect(() => {
    setActiveImageTabId(tabId);
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

    const layoutHost = layoutHostRef.current;
    if (layoutHost === null) {
      return undefined;
    }
    const plugins = state.plugins.filter((plugin) => plugin.spec.key !== paginationPluginKey());
    const viewState = state.reconfigure({
      plugins: [...plugins, contextMenuEditorPlugin(ownedTabId), paginationPlugin(layoutHost)],
    });
    const wordClicks = createWordClickSession();
    const view = new EditorView(host, {
      state: viewState,
      nodeViews: structuredNodeViews(),
      attributes: {
        'aria-label': DOCUMENT_LABEL,
        class: 'page-sheet',
        'data-region': 'page-editor',
        spellcheck: 'false',
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
      // The word is selected in the double-click handler, before the browser
      // paints the space after it. Returning true makes ProseMirror cancel that
      // default. The event still bubbles, so an open menu can close.
      handleDoubleClick(clickView, pos, event) {
        return wordClicks.onDoubleClick(clickView, pos, event);
      },
      handleTripleClick(clickView, pos, event) {
        if (event.button !== 0 || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
          return false;
        }
        const range = textblockRangeAt(clickView.state.doc, pos);
        if (range === null) {
          return false;
        }
        const tr = clickView.state.tr.setSelection(TextSelection.create(clickView.state.doc, range.from, range.to));
        tr.setMeta('pointer', true);
        clickView.dispatch(tr);
        watchSelectionDrag(clickView, event, 'line', range);
        return true;
      },
      handleDOMEvents: {
        mousedown(_view, event) {
          if (bandEditRef.current !== null && event.button === 0) {
            onBandCloseRef.current?.();
          }
          wordClicks.onPointerDown(event);
          return false;
        },
        mouseup(upView, event) {
          wordClicks.onPointerUp(upView, event);
          return false;
        },
        click(clickView, event) {
          if (!eventTargetsLink(event)) {
            return false;
          }
          event.preventDefault();
          // A plain click on a link shows the link bubble, like Google Docs.
          // Ctrl+click goes straight to Open link, which still asks first.
          // The page's own selection is current here; the editor state may not have caught up yet.
          const domSelection = clickView.dom.ownerDocument.getSelection();
          const collapsed = domSelection === null ? clickView.state.selection.empty : domSelection.isCollapsed;
          const action = linkClickAction(event, collapsed);
          if (action?.kind === 'open') {
            requestShellCommand('link-open', clickView.dom.ownerDocument.defaultView, action.address);
          } else if (action?.kind === 'bubble') {
            const at = clickView.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            const tr = openLinkBubble(clickView.state, null, at);
            if (tr !== null) {
              clickView.dispatch(tr);
            }
          }
          return false;
        },
        auxclick(_view, event) {
          if (eventTargetsLink(event)) {
            event.preventDefault();
          }
          return false;
        },
        blur() {
          adoptDomSelection(view);
          return false;
        },
        focus() {
          // Chromium can park the caret at an edge when the page is focused again.
          // Put the stored caret back for a keyboard move and for Open or Save.
          if (!pageFocusRestoresCaret()) {
            return false;
          }
          const restore = () => {
            if (view.isDestroyed || !pageFocusRestoresCaret()) {
              return;
            }
            if (view.dom.ownerDocument.activeElement !== view.dom) {
              return;
            }
            placeSelectionInDom(view);
          };
          restore();
          queueMicrotask(restore);
          view.dom.ownerDocument.defaultView?.requestAnimationFrame(restore);
          return false;
        },
      },
    });
    writeReportedCaret(view);
    installEditorCommands(view, placeSelectionInDom, layoutHost);
    viewRef.current = view;
    // Put the stored caret into the DOM even when the window is not focused.
    // selectionToDOM does nothing until the editor owns document focus.
    placeSelectionInDom(view);

    const onSelectionChange = () => {
      if (!placing) {
        wordClicks.onSelectionChange(view);
      }
      // Arrow keys move the DOM caret before ProseMirror records them. After
      // the page blurs, ProseMirror drops that event, so copy it into the tab.
      if (!view.hasFocus() && !placing) {
        adoptDomSelection(view);
      }
    };
    view.dom.ownerDocument.addEventListener('selectionchange', onSelectionChange);
    const unbindPageFocus = bindPageFocus(view.dom);
    view.focus();
    const pageRegion = host.closest('.page-region');
    const unbindPageScroll = pageRegion instanceof HTMLElement
      ? bindPageOriginScroll(pageRegion, () => {
          if (view.isDestroyed) {
            return null;
          }
          try {
            const head = view.coordsAtPos(view.state.selection.head);
            return { left: head.left, right: head.right };
          } catch {
            return null;
          }
        })
      : () => {};

    const syncKeyboardFocus = () => {
      const keyboard = view.dom.getAttribute('data-focus-source') === 'keyboard';
      setKeyboardFocus(keyboard);
      const region = view.dom.closest('.page-region');
      if (!(region instanceof HTMLElement)) {
        return;
      }
      const bar = region.offsetWidth - region.clientWidth;
      const track = region.offsetHeight - region.clientHeight;
      region.style.setProperty('--page-scrollbar-inline', `${Math.max(0, bar)}px`);
      region.style.setProperty('--page-scrollbar-block', `${Math.max(0, track)}px`);
      if (viewModeRef.current === 'pageless' && keyboard) {
        region.setAttribute('data-focus-source', 'keyboard');
      } else {
        region.removeAttribute('data-focus-source');
      }
    };
    const focusObserver = new MutationObserver(syncKeyboardFocus);
    focusObserver.observe(view.dom, { attributes: true, attributeFilter: ['data-focus-source'] });
    view.dom.addEventListener('focus', syncKeyboardFocus);
    view.dom.addEventListener('blur', syncKeyboardFocus);
    syncKeyboardFocus();
    layoutPagination(view, layoutHost);

    return () => {
      focusObserver.disconnect();
      view.dom.removeEventListener('focus', syncKeyboardFocus);
      view.dom.removeEventListener('blur', syncKeyboardFocus);
      viewRef.current = null;
      unbindPageScroll();
      unbindPageFocus();
      view.dom.ownerDocument.removeEventListener('selectionchange', onSelectionChange);
      adoptDomSelection(view);
      onChangeRef.current(ownedTabId, view.state);
      delete (view.dom as HTMLElement & { editorCommands?: unknown }).editorCommands;
      delete (view.dom as HTMLElement & { editorView?: unknown }).editorView;
      view.destroy();
    };
    // `state` is the tab snapshot at mount. Later edits stay in the view.
  }, [tabId]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    const layoutHost = layoutHostRef.current;
    if (view === null || view.isDestroyed || layoutHost === null) {
      return;
    }
    const anchor = takeScrollAnchor();
    const region = view.dom.closest('.page-region');
    layoutPagination(view, layoutHost);
    if (anchor !== null && region instanceof HTMLElement) {
      if (anchor.kind === 'caret') {
        try {
          const after = view.coordsAtPos(view.state.selection.head).top;
          if (Math.abs(after - anchor.top) > 0.5) {
            region.scrollTop += after - anchor.top;
          }
        } catch {
          // The caret is not on screen yet.
        }
      } else if (anchor.scrollHeight > 0) {
        region.scrollTop = anchor.scrollTop * (region.scrollHeight / anchor.scrollHeight);
      }
    }
    if (region instanceof HTMLElement) {
      const keyboard = view.dom.getAttribute('data-focus-source') === 'keyboard';
      if (viewMode === 'pageless' && keyboard) {
        region.setAttribute('data-focus-source', 'keyboard');
      } else {
        region.removeAttribute('data-focus-source');
      }
    }
  }, [viewMode, zoom, orientation, margins.top, margins.right, margins.bottom, margins.left, bandPx.header, bandPx.footer]);

  useLayoutEffect(() => {
    const canvas = hostRef.current?.closest('.page-canvas');
    if (!(canvas instanceof HTMLElement)) {
      return;
    }
    const measure = (part: string) => {
      let max = 0;
      canvas.querySelectorAll(`.page-band[data-page-part="${part}"] .page-band-text`).forEach((node) => {
        if (!(node instanceof HTMLElement)) {
          return;
        }
        if ((node.textContent ?? '').trim().length === 0) {
          return;
        }
        max = Math.max(max, node.getBoundingClientRect().height);
      });
      return max;
    };
    const next = { header: measure('header'), footer: measure('footer') };
    setBandPx((current) => (
      Math.abs(current.header - next.header) < 1 && Math.abs(current.footer - next.footer) < 1
        ? current
        : next
    ));
  }, [header, footer, bandEdit, pageCount, zoom, orientation]);

  const bodyMargins: PageMargins = {
    top: reservedMarginIn(margins.top, bandPx.header, zoom),
    right: margins.right,
    bottom: reservedMarginIn(margins.bottom, bandPx.footer, zoom),
    left: margins.left,
  };
  const box: PageBox = scalePageBox(pageBoxFromMargins(bodyMargins, orientation), zoom);
  const zoomStyle = pageZoomVars(zoom, orientation) as CSSProperties | undefined;
  const headerOffset = cssPixelsAt96Dpi(PAGE_HEADER_OFFSET_IN) * (zoom / 100);
  const frames = viewMode === 'pages'
    ? Array.from({ length: pageCount }, (_, index) => index)
    : [];

  return (
    <div
      className="page-canvas"
      data-page-view={viewMode}
      data-page-orientation={orientation}
      data-band-editing={bandEdit !== null ? 'true' : undefined}
      style={zoomStyle}
    >
      {viewMode === 'pages' ? (
        <div className="page-frames">
          {frames.map((index) => (
            <div
              key={index}
              className="page-frame"
              data-page={index + 1}
              data-caret-focus={keyboardFocus && index === caretPage - 1 ? 'true' : undefined}
              style={{ top: `${index * (box.pageHeight + box.gap)}px` }}
            />
          ))}
        </div>
      ) : null}
      <div ref={hostRef} className="editor-host" />
      {viewMode === 'pages' && header !== undefined && footer !== undefined ? (
        <div className="page-band-layer">
          {frames.map((index) => (
            <div
              key={index}
              className="page-band-slot"
              style={{ top: `${index * (box.pageHeight + box.gap)}px` }}
            >
              <PageBands
                page={index + 1}
                pageCount={pageCount}
                header={header}
                footer={footer}
                editing={bandEdit}
                headerOffsetPx={headerOffset}
                headerGapPx={Math.max(0, box.marginTop - headerOffset)}
                footerGapPx={Math.max(0, box.marginBottom - headerOffset)}
                marginLeftPx={box.marginLeft}
                marginRightPx={box.marginRight}
                onEdit={(part, page) => onBandEdit?.(part, page)}
                onClose={(reason) => onBandClose?.(reason)}
                onChange={(part, paragraph) => onBandChange?.(part, paragraph)}
                onMove={(direction) => onBandMove?.(direction)}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
