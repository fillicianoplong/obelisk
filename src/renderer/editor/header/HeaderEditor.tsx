import { baseKeymap } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { useLayoutEffect, useRef } from 'react';
import type { JsonObject } from '../../../shared/ipc/types.js';
import { editorMenuCommand } from '../menu-commands.js';
import { createWordClickSession } from '../select-word.js';
import { headerDocFromParagraph, paragraphFromHeaderDoc } from './mapping.js';
import { pageFieldText, type PageFieldFormat, type PageFieldKind } from './page-field.js';
import { headerSchema } from './schema.js';

export interface HeaderEditorApi {
  insertField: (kind: PageFieldKind, format: PageFieldFormat) => void;
  selectedPageFormat: () => PageFieldFormat | null;
  focus: () => void;
}

interface HeaderEditorProps {
  paragraph: JsonObject;
  page: number;
  pageCount: number;
  onChange: (paragraph: JsonObject) => void;
  onClose: (reason?: 'escape') => void;
  onMove: (direction: 1 | -1) => void;
  onFieldMenu: (anchor: HTMLElement) => void;
  apiRef: { current: HeaderEditorApi | null };
}

function sameParagraph(left: JsonObject, right: JsonObject): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function HeaderEditor({
  paragraph,
  page,
  pageCount,
  onChange,
  onClose,
  onMove,
  onFieldMenu,
  apiRef,
}: HeaderEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const paragraphRef = useRef(paragraph);
  const pageRef = useRef(page);
  const countRef = useRef(pageCount);
  const onChangeRef = useRef(onChange);
  const onCloseRef = useRef(onClose);
  const onMoveRef = useRef(onMove);
  const onFieldMenuRef = useRef(onFieldMenu);
  paragraphRef.current = paragraph;
  pageRef.current = page;
  countRef.current = pageCount;
  onChangeRef.current = onChange;
  onCloseRef.current = onClose;
  onMoveRef.current = onMove;
  onFieldMenuRef.current = onFieldMenu;

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return undefined;
    }
    const paintFields = (view: EditorView) => {
      const fields = view.dom.querySelectorAll<HTMLElement>('.page-field');
      fields.forEach((field) => {
        const kind = field.dataset.pageField === 'pages' ? 'pages' : 'page';
        const format = field.dataset.pageFormat === 'roman' || field.dataset.pageFormat === 'page-of-n'
          ? field.dataset.pageFormat
          : 'decimal';
        field.textContent = pageFieldText(kind, format, pageRef.current, countRef.current);
      });
    };
    const publish = (view: EditorView) => {
      const next = paragraphFromHeaderDoc(view.state.doc, paragraphRef.current);
      if (!sameParagraph(next, paragraphRef.current)) {
        onChangeRef.current(next);
      }
      paintFields(view);
    };
    const insertField = (view: EditorView, kind: PageFieldKind, format: PageFieldFormat) => {
      const { state } = view;
      const selected = state.selection instanceof NodeSelection
        && state.selection.node.type.name === 'page_field'
        ? state.selection
        : null;
      if (selected !== null && kind === 'page' && selected.node.attrs.kind === 'page') {
        view.dispatch(state.tr.setNodeMarkup(selected.from, undefined, { kind: 'page', format }));
        return;
      }
      const node = headerSchema.nodes.page_field.create({ kind, format });
      const tr = state.tr.replaceSelectionWith(node, false);
      const after = tr.selection.from;
      const placed = tr.setSelection(TextSelection.create(tr.doc, Math.min(after, tr.doc.content.size)));
      view.dispatch(placed);
      view.focus();
    };
    const state = EditorState.create({
      schema: headerSchema,
      doc: headerDocFromParagraph(paragraphRef.current),
      plugins: [
        history(),
        keymap(baseKeymap),
        keymap({
          'Mod-z': undo,
          'Mod-y': redo,
          'Mod-Shift-z': redo,
          Enter: () => true,
          'Shift-Enter': () => true,
          Tab: () => {
            onMoveRef.current(1);
            return true;
          },
          'Shift-Tab': () => {
            onMoveRef.current(-1);
            return true;
          },
          Escape: () => {
            onCloseRef.current('escape');
            return true;
          },
        }),
      ],
    });
    const wordClicks = createWordClickSession();
    const view = new EditorView(host, {
      state,
      attributes: {
        class: 'page-band-editor',
        'data-header-editor': 'true',
        'aria-label': 'Header and footer',
      },
      handleDoubleClick(clickView, pos, event) {
        return wordClicks.onDoubleClick(clickView, pos, event);
      },
      handleDOMEvents: {
        mousedown(_clickView, event) {
          wordClicks.onPointerDown(event);
          return false;
        },
        mouseup(upView, event) {
          wordClicks.onPointerUp(upView, event);
          return false;
        },
      },
      dispatchTransaction(transaction) {
        const next = view.state.apply(transaction);
        view.updateState(next);
        publish(view);
      },
      nodeViews: {
        page_field(node, nodeView, getPos) {
          const dom = document.createElement('span');
          dom.className = 'page-field';
          dom.setAttribute('contenteditable', 'false');
          const paint = (current: typeof node) => {
            const kind = current.attrs.kind === 'pages' ? 'pages' : 'page';
            const format = current.attrs.format === 'roman' || current.attrs.format === 'page-of-n'
              ? current.attrs.format
              : 'decimal';
            dom.dataset.pageField = kind;
            dom.dataset.pageFormat = format;
            dom.textContent = pageFieldText(kind, format, pageRef.current, countRef.current);
          };
          paint(node);
          dom.addEventListener('mousedown', (event) => {
            if (typeof getPos !== 'function') {
              return;
            }
            event.preventDefault();
            const pos = getPos();
            if (pos === undefined) {
              return;
            }
            nodeView.dispatch(nodeView.state.tr.setSelection(NodeSelection.create(nodeView.state.doc, pos)));
            nodeView.focus();
            if (dom.dataset.pageField === 'page') {
              onFieldMenuRef.current(dom);
            }
          });
          return {
            dom,
            update(next) {
              if (next.type.name !== 'page_field') {
                return false;
              }
              paint(next);
              return true;
            },
            ignoreMutation() {
              return true;
            },
          };
        },
      },
    });
    const api: HeaderEditorApi = {
      insertField(kind, format) {
        insertField(view, kind, format);
      },
      selectedPageFormat() {
        const selected = view.state.selection;
        if (!(selected instanceof NodeSelection) || selected.node.type.name !== 'page_field') {
          return null;
        }
        if (selected.node.attrs.kind !== 'page') {
          return null;
        }
        const format = selected.node.attrs.format;
        return format === 'roman' || format === 'page-of-n' ? format : 'decimal';
      },
      focus() {
        view.focus();
      },
    };
    apiRef.current = api;
    Object.defineProperty(view.dom, 'editorCommands', {
      configurable: true,
      value: {
        runMenuCommand(menuId: string) {
          const field = menuId === 'insert-page-count'
            ? { kind: 'pages' as const, format: 'decimal' as const }
            : menuId === 'insert-page-number-roman'
              ? { kind: 'page' as const, format: 'roman' as const }
              : menuId === 'insert-page-number-page-of-n'
                ? { kind: 'page' as const, format: 'page-of-n' as const }
                : menuId === 'insert-page-number-decimal'
                  ? { kind: 'page' as const, format: 'decimal' as const }
                  : null;
          if (field !== null) {
            insertField(view, field.kind, field.format);
            return;
          }
          const command = editorMenuCommand(menuId);
          if (command !== null) {
            command(view.state, view.dispatch);
          }
        },
      },
    });
    view.focus();
    paintFields(view);
    const onSelectionChange = () => {
      wordClicks.onSelectionChange(view);
    };
    view.dom.ownerDocument.addEventListener('selectionchange', onSelectionChange);
    return () => {
      view.dom.ownerDocument.removeEventListener('selectionchange', onSelectionChange);
      apiRef.current = null;
      view.destroy();
    };
  }, [apiRef]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    host?.querySelectorAll<HTMLElement>('.page-field').forEach((field) => {
      const kind = field.dataset.pageField === 'pages' ? 'pages' : 'page';
      const format = field.dataset.pageFormat === 'roman' || field.dataset.pageFormat === 'page-of-n'
        ? field.dataset.pageFormat
        : 'decimal';
      field.textContent = pageFieldText(kind, format, page, pageCount);
    });
  }, [page, pageCount]);

  return <div ref={hostRef} className="page-band-editor-host" />;
}
