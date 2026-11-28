/** Strip XML 1.0-illegal control characters; keep tab, LF, and CR. */
export function stripIllegalControls(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code < 0x20) {
      if (code === 0x09 || code === 0x0a || code === 0x0d) {
        out += char;
      }
      continue;
    }
    if (code === 0x7f) {
      continue;
    }
    out += char;
  }
  return out;
}

/** Unpaired surrogates become the replacement character. */
export function replaceUnpairedSurrogates(text: string): string {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[index] + text[index + 1];
        index += 1;
      } else {
        out += '\uFFFD';
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      out += '\uFFFD';
    } else {
      out += text[index];
    }
  }
  return out;
}

export function prepareExportText(text: string): string {
  return replaceUnpairedSurrogates(stripIllegalControls(text));
}

const MARKDOWN_ESCAPE_RE = /[\\`*_{}[\]()#+\-.!|<>&]/g;

export function escapeMarkdownText(text: string): string {
  const cleaned = prepareExportText(text);
  return cleaned.replace(MARKDOWN_ESCAPE_RE, '\\$&');
}

export function escapeMarkdownAlt(text: string): string {
  return escapeMarkdownText(text);
}

export function escapeTableCell(text: string): string {
  return escapeMarkdownText(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}