import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as ProseNode } from 'prosemirror-model';
import {
  paragraphFormatFromBlock,
  paragraphStyleFingerprint,
  type ParagraphFormatValue,
  type SpacePt,
} from '../../shared/schema/paragraph-defaults.js';
import type { DocumentMessage } from '../../shared/ipc/types.js';

export const paragraphSpacingPluginKey = new PluginKey('paragraphSpacing');

function formatFromNode(node: ProseNode, document: DocumentMessage): ParagraphFormatValue {
  return paragraphFormatFromBlock({
    align: node.attrs.align,
    lineSpacing: node.attrs.lineSpacing,
    lineSpacingAt: node.attrs.lineSpacingAt,
    spaceBefore: node.attrs.spaceBefore,
    spaceAfter: node.attrs.spaceAfter,
    indents: {
      left: node.attrs.indentLeft,
      right: node.attrs.indentRight,
      first: node.attrs.indentFirst,
      hanging: node.attrs.indentHanging,
    },
    dontAddSpaceBetweenSameStyle: node.attrs.dontAddSpaceBetweenSameStyle,
  }, document);
}

function betweenCollapsed(prev: ParagraphFormatValue, next: ParagraphFormatValue): boolean {
  return prev.dontAddSpaceBetweenSameStyle
    && next.dontAddSpaceBetweenSameStyle
  && paragraphStyleFingerprint(prev) === paragraphStyleFingerprint(next);
}

function syncParagraphSpacingDom(view: EditorView, document: DocumentMessage): void {
  const formats: ParagraphFormatValue[] = [];
  const elements: HTMLElement[] = [];
  view.state.doc.forEach((node) => {
    if (node.type.name !== 'paragraph') {
      return;
    }
    const id = String(node.attrs.blockId ?? '');
    const el = id
      ? view.dom.querySelector<HTMLElement>(`:scope > p[data-block-id="${CSS.escape(id)}"]`)
      : null;
    if (!el) {
      return;
    }
    elements.push(el);
    formats.push(formatFromNode(node, document));
  });

  for (let index = 0; index < formats.length; index += 1) {
    const format = formats[index];
    const el = elements[index];
    const prev = index > 0 ? formats[index - 1] : null;
    let spaceBefore = format.spaceBefore;
    let spaceAfter = format.spaceAfter;
    if (prev && betweenCollapsed(prev, format)) {
      spaceBefore = Math.max(prev.spaceAfter, format.spaceBefore) as SpacePt;
      const prevEl = elements[index - 1];
      prevEl.dataset.effectiveSpaceAfter = '0';
    }
    el.dataset.effectiveSpaceBefore = String(spaceBefore);
    const next = index < formats.length - 1 ? formats[index + 1] : null;
    if (next && betweenCollapsed(format, next)) {
      spaceAfter = 0;
    }
    el.dataset.effectiveSpaceAfter = String(spaceAfter);
  }
}

export function paragraphSpacingPlugin(documentRef: () => DocumentMessage): Plugin {
  return new Plugin({
    key: paragraphSpacingPluginKey,
    view(view) {
      const run = () => syncParagraphSpacingDom(view, documentRef());
      run();
      return {
        update(updatedView) {
          syncParagraphSpacingDom(updatedView, documentRef());
        },
      };
    },
  });
}