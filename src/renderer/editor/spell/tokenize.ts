export type TokenSkip = 'url' | 'digit' | null;

export interface TextToken {
  word: string;
  from: number;
  to: number;
  skip: TokenSkip;
}

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>]+/gi;
const WORD_MAX = 64;

function isLetter(char: string): boolean {
  return /[\p{L}\p{M}]/u.test(char);
}

function isDigit(char: string): boolean {
  return /\p{N}/u.test(char);
}

function isApostrophe(char: string): boolean {
  return char === "'" || char === '\u2019' || char === '\u02bc';
}

function urlSpans(text: string): Array<{ from: number; to: number }> {
  const spans: Array<{ from: number; to: number }> = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    const from = match.index ?? 0;
    spans.push({ from, to: from + match[0].length });
  }
  return spans;
}

function insideUrl(spans: ReadonlyArray<{ from: number; to: number }>, index: number): { from: number; to: number } | null {
  for (const span of spans) {
    if (index >= span.from && index < span.to) {
      return span;
    }
  }
  return null;
}

export function tokenizeText(text: string): TextToken[] {
  const urls = urlSpans(text);
  const tokens: TextToken[] = [];
  let index = 0;
  while (index < text.length) {
    const url = insideUrl(urls, index);
    if (url !== null) {
      index = url.to;
      continue;
    }
    const char = text[index] ?? '';
    if (!isLetter(char) && !isDigit(char)) {
      index += 1;
      continue;
    }
    const start = index;
    let sawDigit = isDigit(char);
    let sawLetter = isLetter(char);
    index += 1;
    while (index < text.length && insideUrl(urls, index) === null) {
      const next = text[index] ?? '';
      if (!isLetter(next) && !isDigit(next) && !isApostrophe(next)) {
        break;
      }
      if (isDigit(next)) {
        sawDigit = true;
      }
      if (isLetter(next)) {
        sawLetter = true;
      }
      index += 1;
    }
    let end = index;
    while (end > start && isApostrophe(text[end - 1] ?? '')) {
      end -= 1;
    }
    const word = text.slice(start, end);
    if (!sawLetter || word.length === 0 || word.length > WORD_MAX) {
      continue;
    }
    tokens.push({ word, from: start, to: end, skip: sawDigit ? 'digit' : null });
  }
  return tokens;
}
