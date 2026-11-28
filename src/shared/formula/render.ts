import katex from 'katex';
import { formulaKatexOptions } from './options.js';

const UNSUPPORTED_COMMAND = /\\(?:href|url|includegraphics)\b/;
const UNSUPPORTED_HTML = /<\s*\/?\s*[a-z!]/i;
const UNSUPPORTED_HTML_MACROS = /\\html[A-Za-z]*\{/;

function unsupportedMessage(latex: string): string | null {
  if (UNSUPPORTED_COMMAND.test(latex)) {
    return 'The commands \\href, \\url, and \\includegraphics are not supported.';
  }
  if (UNSUPPORTED_HTML.test(latex) || UNSUPPORTED_HTML_MACROS.test(latex)) {
    return 'HTML is not supported in equations.';
  }
  return null;
}

export interface FormulaRenderResult {
  ok: boolean;
  html: string;
  error: string | null;
  hasLink: boolean;
  hasImage: boolean;
}

export function renderFormulaLatex(latex: string, displayMode = true): FormulaRenderResult {
  const trimmed = latex.trim();
  if (trimmed.length === 0) {
    return { ok: false, html: '', error: null, hasLink: false, hasImage: false };
  }
  const blocked = unsupportedMessage(trimmed);
  if (blocked !== null) {
    return { ok: false, html: '', error: blocked, hasLink: false, hasImage: false };
  }
  try {
    const html = katex.renderToString(trimmed, formulaKatexOptions(displayMode));
    return {
      ok: true,
      html,
      error: null,
      hasLink: html.includes('<a '),
      hasImage: html.includes('<img '),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, html: '', error: message, hasLink: false, hasImage: false };
  }
}