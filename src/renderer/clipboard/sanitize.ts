import { BLOCK_MAX } from '../../shared/schema/limits.js';
import type { Block } from '../../shared/schema/types.js';
import { newBlockId } from '../editor/block-id.js';
import { blocksFromDocument, imageBlockFromBytes } from './html.js';
import { plainTextBlocks } from './text.js';
import type { PasteInput, PastedImageAsset, SanitizedPaste, SanitizeOptions } from './types.js';

const HTML_MAX_CHARS = 8_000_000;

type HtmlParser = new () => {
  parseFromString(source: string, type: DOMParserSupportedType): Document;
};

/**
 * DOMParser builds a detached document. Callers must not insert that tree
 * into the page. Scripts in the markup are not run here; only the allowlist
 * is copied into schema blocks.
 */
export function parseDetachedHtml(html: string, Parser?: HtmlParser): Document {
  const Selected = Parser ?? globalThis.DOMParser;
  if (typeof Selected !== 'function') {
    throw new Error('HTML paste needs DOMParser.');
  }
  const parsed = new Selected().parseFromString(html, 'text/html');
  if (parsed.body && parsed.body.childNodes.length > 0) {
    return parsed;
  }
  if (/<html[\s>]/i.test(html)) {
    return parsed;
  }
  return new Selected().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
}

export async function sanitizePaste(
  input: PasteInput,
  options: SanitizeOptions = {},
): Promise<SanitizedPaste> {
  const ids = options.ids ?? newBlockId;
  const assets = new Map<string, PastedImageAsset>();
  let blocks: Block[];
  if (input.plain) {
    blocks = plainTextBlocks(input.text ?? '', ids, BLOCK_MAX);
  } else {
    const html = input.html ?? '';
    if (html.trim().length > 0 && html.length <= HTML_MAX_CHARS) {
      const parse = options.parseHtml ?? parseDetachedHtml;
      blocks = await blocksFromDocument(parse(html), { ids, assets });
    } else {
      blocks = plainTextBlocks(input.text ?? '', ids, BLOCK_MAX);
    }
  }
  if (!input.plain && input.image && input.image.byteLength > 0 && blocks.length < BLOCK_MAX) {
    const block = await imageBlockFromBytes(input.image, input.alt ?? '', { ids, assets });
    if (block) {
      blocks.push(block);
    }
  }
  return {
    blocks: blocks.slice(0, BLOCK_MAX),
    images: [...assets.values()],
  };
}
