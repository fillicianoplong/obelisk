const TEXT_MAX = 1_000_000;
const HTML_MAX = 2_000_000;
const START_FRAGMENT = '<!--StartFragment-->';
const END_FRAGMENT = '<!--EndFragment-->';

export interface ClipboardItemLike {
  types: readonly string[];
  getType(type: string): Promise<unknown>;
}

/** Windows clipboard HTML wraps the fragment. The sanitizer wants the fragment only. */
export function clipboardHtmlFragment(value: string): string {
  const start = value.indexOf(START_FRAGMENT);
  const end = value.indexOf(END_FRAGMENT);
  if (start !== -1 && end > start) {
    return value.slice(start + START_FRAGMENT.length, end);
  }
  return value;
}

function capped(value: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0) {
    return '';
  }
  if (value.length <= max) {
    return value;
  }
  return value.slice(0, max);
}

async function asText(value: unknown): Promise<string> {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return value.text();
  }
  return '';
}

export function clipboardPayload(text: string, html: string): { text: string; html: string } {
  return {
    text: capped(text, TEXT_MAX),
    html: capped(clipboardHtmlFragment(html), HTML_MAX),
  };
}

/** Text comes from readText. HTML comes from a text/html clipboard item. */
export async function readClipboardItems(
  items: readonly ClipboardItemLike[],
  plainText = '',
): Promise<{ text: string; html: string }> {
  let text = typeof plainText === 'string' ? plainText : '';
  let html = '';
  for (const item of items) {
    if (html.length === 0 && item.types.includes('text/html')) {
      html = await asText(await item.getType('text/html'));
    }
    if (text.length === 0 && item.types.includes('text/plain')) {
      text = await asText(await item.getType('text/plain'));
    }
  }
  return clipboardPayload(text, html);
}
