import { Fragment, Slice, type Node as ProseNode } from 'prosemirror-model';
import { Plugin, type Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { ClipboardReadResult, JsonObject } from '../../shared/ipc/types.js';
import type { Block, BodyInline } from '../../shared/schema/types.js';
import { newBlockId } from '../editor/block-id.js';
import { blockNodeFromJson } from '../editor/schema/mapping.js';
import { parseDetachedHtml, sanitizePaste } from './sanitize.js';
import type { PasteInput } from './types.js';

const PARAGRAPH = {
  align: 'left',
  lineSpacing: 'single',
  spaceBefore: 0,
  spaceAfter: 0,
  indents: { left: 0, first: 0, hanging: 0 },
};

function parserFrom(view: EditorView): (typeof DOMParser) | undefined {
  const fromWindow = view.dom.ownerDocument.defaultView?.DOMParser;
  if (typeof fromWindow === 'function') {
    return fromWindow;
  }
  if (typeof globalThis.DOMParser === 'function') {
    return globalThis.DOMParser;
  }
  return undefined;
}

function clipboardData(event: Event): DataTransfer | null {
  const data = (event as ClipboardEvent).clipboardData;
  return data ?? null;
}

async function imageBytes(data: DataTransfer | null): Promise<Uint8Array | undefined> {
  const items = data?.items;
  if (!items) {
    return undefined;
  }
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item || item.kind !== 'file' || !item.type.startsWith('image/')) {
      continue;
    }
    const file = item.getAsFile();
    if (!file) {
      continue;
    }
    return new Uint8Array(await file.arrayBuffer());
  }
  return undefined;
}

function paragraphJson(id: string, content: readonly BodyInline[]): JsonObject {
  return {
    type: 'paragraph',
    id,
    ...PARAGRAPH,
    content: content as unknown as JsonObject,
  };
}

function textOf(content: readonly BodyInline[] | undefined): string {
  if (!content) {
    return '';
  }
  let text = '';
  for (const part of content) {
    if (part.type === 'text' || part.type === 'link') {
      text += part.text;
    }
  }
  return text;
}

function nodesFromBlocks(blocks: readonly Block[], schema: EditorView['state']['schema']): ProseNode[] {
  const nodes: ProseNode[] = [];
  const push = (block: JsonObject) => {
    const node = blockNodeFromJson(block, schema);
    if (node) {
      nodes.push(node);
    }
  };
  for (const block of blocks) {
    if (block.type === 'image') {
      if (block.alt.length > 0) {
        push(paragraphJson(block.id, [{ type: 'text', text: block.alt }]));
      }
      continue;
    }
    if (block.type === 'table') {
      for (const row of block.rows) {
        const content: BodyInline[] = [];
        row.cells.forEach((cell, index) => {
          if (index > 0) {
            content.push({ type: 'text', text: '\t' });
          }
          if (cell.kind === 'text') {
            content.push(...cell.content);
          } else if (cell.source.length > 0) {
            content.push({ type: 'text', text: cell.source });
          }
        });
        if (textOf(content).trim().length === 0) {
          continue;
        }
        push(paragraphJson(newBlockId(), content));
      }
      continue;
    }
    push(block as unknown as JsonObject);
  }
  return nodes;
}

function insertNodes(view: EditorView, nodes: readonly ProseNode[]): void {
  const { state } = view;
  const single = nodes.length === 1 ? nodes[0] : undefined;
  const parent = state.selection.$from.parent;
  const inline = single
    && single.isTextblock
    && parent.isTextblock
    && single.type === parent.type;
  const slice = inline
    ? new Slice(single.content, 0, 0)
    : new Slice(Fragment.from(nodes), 0, 0);
  view.dispatch(
    state.tr.replaceSelection(slice).scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'),
  );
}

export async function applySanitizedPaste(view: EditorView, input: PasteInput): Promise<void> {
  if (view.isDestroyed) {
    return;
  }
  const inCode = view.state.selection.$from.parent.type.spec.code === true;
  const Parser = parserFrom(view);
  const result = await sanitizePaste(
    inCode ? { text: input.text ?? '', plain: true } : input,
    Parser ? { parseHtml: (html) => parseDetachedHtml(html, Parser) } : {},
  );
  if (view.isDestroyed) {
    return;
  }
  if (inCode) {
    const text = result.blocks.map((block) => (
      block.type === 'paragraph' ? textOf(block.content) : block.type === 'code' ? block.text : ''
    )).join('\n');
    if (text.length === 0) {
      return;
    }
    view.dispatch(
      view.state.tr.insertText(text).scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'),
    );
    return;
  }
  const nodes = nodesFromBlocks(result.blocks, view.state.schema);
  if (nodes.length === 0) {
    return;
  }
  insertNodes(view, nodes);
}

async function pasteFromEvent(view: EditorView, event: Event, plain: boolean): Promise<void> {
  const data = clipboardData(event);
  const image = plain ? undefined : await imageBytes(data);
  await applySanitizedPaste(view, {
    html: data?.getData('text/html') ?? '',
    text: data?.getData('text/plain') || data?.getData('Text') || '',
    image,
    plain,
  });
}

/** Ctrl+V and Ctrl+Shift+V. Stops ProseMirror from parsing the clipboard HTML itself. */
export function editorPastePlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        paste(view, event) {
          const shiftKey = 'shiftKey' in event && event.shiftKey === true;
          event.preventDefault();
          void pasteFromEvent(view, event, shiftKey);
          return true;
        },
      },
    },
  });
}

function readMenuClipboard(): Promise<ClipboardReadResult> | null {
  const host = globalThis as typeof globalThis & { window?: Window };
  const read = host.window?.obelisk?.['clipboard:read'];
  if (typeof read !== 'function') {
    return null;
  }
  return read();
}

/** Edit, context, and block menu Paste. Main reads the clipboard; the sanitizer inserts it. */
export function pasteMenuCommand(plain: boolean): Command {
  return (_state, dispatch, view) => {
    if (!dispatch || !view) {
      return true;
    }
    const target = view;
    const read = readMenuClipboard();
    if (read === null) {
      return true;
    }
    void read.then((result) => {
      if (target.isDestroyed || result.status !== 'ok') {
        return;
      }
      target.focus();
      void applySanitizedPaste(target, {
        html: result.html,
        text: result.text,
        plain,
      });
    }).catch(() => {
      // A clipboard the page cannot read leaves the document unchanged.
    });
    return true;
  };
}
