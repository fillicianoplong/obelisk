const DRAWING_PROPERTIES = new Set([
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'opacity',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'width',
  'height',
  'max-width',
  'min-width',
  'max-height',
  'min-height',
]);

function skipComment(css: string, index: number): number {
  const end = css.indexOf('*/', index + 2);
  return end === -1 ? css.length : end + 2;
}

function readQuoted(css: string, index: number): number {
  const quote = css[index];
  let cursor = index + 1;
  while (cursor < css.length) {
    if (css[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    if (css[cursor] === quote) {
      return cursor + 1;
    }
    cursor += 1;
  }
  return css.length;
}

function indexOfToken(css: string, index: number, token: string): number {
  let cursor = index;
  while (cursor < css.length) {
    const ch = css[cursor];
    if (ch === '"' || ch === "'") {
      cursor = readQuoted(css, cursor);
      continue;
    }
    if (ch === '/' && css[cursor + 1] === '*') {
      cursor = skipComment(css, cursor);
      continue;
    }
    if (css.startsWith(token, cursor)) {
      return cursor;
    }
    cursor += 1;
  }
  return -1;
}

function skipBlock(css: string, openBrace: number): number {
  let depth = 0;
  let cursor = openBrace;
  while (cursor < css.length) {
    const ch = css[cursor];
    if (ch === '"' || ch === "'") {
      cursor = readQuoted(css, cursor);
      continue;
    }
    if (ch === '/' && css[cursor + 1] === '*') {
      cursor = skipComment(css, cursor);
      continue;
    }
    if (ch === '{') {
      depth += 1;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return cursor + 1;
      }
    }
    cursor += 1;
  }
  return css.length;
}

function splitList(text: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const ch = text[cursor];
    if (ch === '"' || ch === "'") {
      cursor = readQuoted(text, cursor);
      continue;
    }
    if (text.startsWith(separator, cursor)) {
      parts.push(text.slice(start, cursor));
      cursor += separator.length;
      start = cursor;
      continue;
    }
    cursor += 1;
  }
  parts.push(text.slice(start));
  return parts;
}

function filterDeclarations(body: string): string[] {
  const kept: string[] = [];
  for (const part of splitList(body, ';')) {
    const text = part.trim();
    if (text.length === 0) {
      continue;
    }
    const colon = text.indexOf(':');
    if (colon <= 0) {
      continue;
    }
    const property = text.slice(0, colon).trim().toLowerCase();
    const value = text.slice(colon + 1).trim();
    if (!/^[a-z-]+$/.test(property) || !DRAWING_PROPERTIES.has(property)) {
      continue;
    }
    if (/[{}<]/.test(value) || /url\s*\(/i.test(value) || /@import/i.test(value)) {
      continue;
    }
    kept.push(`${property}:${value}`);
  }
  return kept;
}

function isScopedTo(selector: string, prefix: string): boolean {
  if (!selector.startsWith(prefix)) {
    return false;
  }
  const next = selector.charAt(prefix.length);
  return next.length === 0 || ' .#:[\t\n\r>+~'.includes(next);
}

function scopeSelectorList(selector: string, diagramId: string): string | null {
  if (/[{}<]/.test(selector)) {
    return null;
  }
  const prefix = `#${diagramId}`;
  const scoped = splitList(selector, ',')
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0 && !piece.startsWith('@'))
    .map((piece) => (isScopedTo(piece, prefix) ? piece : `${prefix} ${piece}`));
  return scoped.length > 0 ? scoped.join(',') : null;
}

function sanitizeDiagramCss(css: string, diagramId: string): string {
  const rules: string[] = [];
  let cursor = 0;
  while (cursor < css.length) {
    while (cursor < css.length) {
      if (css[cursor] !== undefined && css[cursor] <= ' ') {
        cursor += 1;
        continue;
      }
      if (css[cursor] === '/' && css[cursor + 1] === '*') {
        cursor = skipComment(css, cursor);
        continue;
      }
      break;
    }
    if (cursor >= css.length) {
      break;
    }
    if (css[cursor] === '@') {
      const semi = indexOfToken(css, cursor, ';');
      const brace = indexOfToken(css, cursor, '{');
      if (brace !== -1 && (semi === -1 || brace < semi)) {
        cursor = skipBlock(css, brace);
      } else if (semi !== -1) {
        cursor = semi + 1;
      } else {
        break;
      }
      continue;
    }
    const brace = indexOfToken(css, cursor, '{');
    if (brace === -1) {
      break;
    }
    const selector = css.slice(cursor, brace).trim();
    const end = skipBlock(css, brace);
    const body = css.slice(brace + 1, end - 1);
    cursor = end;
    if (body.includes('{') || /[<>]/.test(selector) || body.includes('<')) {
      continue;
    }
    const declarations = filterDeclarations(body);
    if (declarations.length === 0) {
      continue;
    }
    const scoped = scopeSelectorList(selector, diagramId);
    if (!scoped) {
      continue;
    }
    rules.push(`${scoped}{${declarations.join(';')}}`);
  }
  return rules.join('\n');
}

export function collectMovedStyleRules(
  svgRoot: Element,
  diagramKey: string,
): { cssParts: string[]; movedAttributes: number } {
  const parts: string[] = [];
  for (const style of svgRoot.querySelectorAll('style')) {
    parts.push(style.textContent ?? '');
    style.remove();
  }
  let moved = 0;
  let index = 0;
  const styled = svgRoot.hasAttribute('style')
    ? [svgRoot, ...svgRoot.querySelectorAll('[style]')]
    : [...svgRoot.querySelectorAll('[style]')];
  for (const element of styled) {
    const body = element.getAttribute('style') ?? '';
    if (body.includes('{') || body.includes('}') || body.includes('<')) {
      continue;
    }
    const token = `obk-diag-${diagramKey}-${index}`;
    index += 1;
    if (element === svgRoot && element.id) {
      parts.push(`#${element.id}{${body}}`);
    } else {
      const existing = element.getAttribute('class');
      element.setAttribute('class', existing ? `${existing} ${token}` : token);
      parts.push(`.${token}{${body}}`);
    }
    element.removeAttribute('style');
    moved += 1;
  }
  return { cssParts: parts, movedAttributes: moved };
}

export function sanitizeDiagramSheet(css: string, scopeId: string): string {
  return sanitizeDiagramCss(css, scopeId);
}

export function stripDiagramNavigation(svg: SVGSVGElement): void {
  for (const element of svg.querySelectorAll('[href], a')) {
    element.removeAttribute('href');
    element.removeAttribute('xlink:href');
  }
}