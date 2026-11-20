import type { Node as ProseNode } from 'prosemirror-model';

export interface FindMatch {
  from: number;
  to: number;
}

export interface FindOptions {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

function isWordBoundary(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1]! : '';
  const after = end < text.length ? text[end]! : '';
  const beforeOk = before === '' || !WORD_CHAR.test(before);
  const afterOk = after === '' || !WORD_CHAR.test(after);
  return beforeOk && afterOk;
}

function matchesInText(
  text: string,
  basePos: number,
  query: string,
  matchCase: boolean,
  wholeWord: boolean,
): FindMatch[] {
  if (query.length === 0) {
    return [];
  }
  const matches: FindMatch[] = [];
  const haystack = matchCase ? text : text.toLowerCase();
  const needle = matchCase ? query : query.toLowerCase();
  let fromIndex = 0;
  for (;;) {
    const index = haystack.indexOf(needle, fromIndex);
    if (index < 0) {
      break;
    }
    const end = index + needle.length;
    if (!wholeWord || isWordBoundary(text, index, end)) {
      matches.push({ from: basePos + index, to: basePos + end });
    }
    fromIndex = index + (needle.length > 0 ? needle.length : 1);
    if (needle.length === 0) {
      break;
    }
  }
  return matches;
}

export function findMatches(doc: ProseNode, options: FindOptions): FindMatch[] {
  try {
    if (options.query.length === 0) {
      return [];
    }
    const matches: FindMatch[] = [];
    doc.descendants((node, pos) => {
      if (!node.isText || node.text === undefined) {
        return;
      }
      matches.push(...matchesInText(node.text, pos, options.query, options.matchCase, options.wholeWord));
    });
    return matches;
  } catch {
    return [];
  }
}