const NAME = /^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD.\u00B7-]*$/u;

function isXmlChar(code: number): boolean {
  return code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
}

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

export function xmlWellFormed(text: string): { ok: boolean; reason: string } {
  for (let i = 0; i < text.length; ) {
    const code = text.codePointAt(i);
    if (code === undefined || !isXmlChar(code)) {
      return fail(`illegal XML character U+${(code ?? 0).toString(16)} at ${i}`);
    }
    i += code > 0xffff ? 2 : 1;
  }

  let i = 0;
  const length = text.length;
  const skipSpace = (): void => {
    while (i < length && (text[i] === ' ' || text[i] === '\n' || text[i] === '\t' || text[i] === '\r')) {
      i += 1;
    }
  };
  const starts = (token: string): boolean => text.startsWith(token, i);

  const readName = (): string | null => {
    const start = i;
    while (i < length && text[i] !== ' ' && text[i] !== '\n' && text[i] !== '\t' && text[i] !== '\r' && text[i] !== '/' && text[i] !== '>' && text[i] !== '=' && text[i] !== '?') {
      i += 1;
    }
    const name = text.slice(start, i);
    return NAME.test(name) ? name : null;
  };

  const readQuoted = (): string | null => {
    const quote = text[i];
    if (quote !== '"' && quote !== "'") {
      return null;
    }
    i += 1;
    let value = '';
    while (i < length && text[i] !== quote) {
      if (text[i] === '<') {
        return null;
      }
      if (text[i] === '&') {
        const entity = readEntity();
        if (entity === null) {
          return null;
        }
        value += entity;
        continue;
      }
      value += text[i];
      i += 1;
    }
    if (text[i] !== quote) {
      return null;
    }
    i += 1;
    return value;
  };

  const readEntity = (): string | null => {
    if (text[i] !== '&') {
      return null;
    }
    const end = text.indexOf(';', i);
    if (end === -1) {
      return null;
    }
    const body = text.slice(i + 1, end);
    i = end + 1;
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (named[body] !== undefined) {
      return named[body];
    }
    let code = NaN;
    if (/^#x[0-9a-f]+$/i.test(body)) {
      code = parseInt(body.slice(2), 16);
    } else if (/^#[0-9]+$/.test(body)) {
      code = parseInt(body.slice(1), 10);
    }
    if (!isXmlChar(code)) {
      return null;
    }
    return String.fromCodePoint(code);
  };

  const readMisc = (): boolean => {
    skipSpace();
    if (starts('<!--')) {
      const end = text.indexOf('-->', i + 4);
      if (end === -1 || text.slice(i + 4, end).includes('--')) {
        return false;
      }
      i = end + 3;
      return true;
    }
    if (starts('<?')) {
      const end = text.indexOf('?>', i + 2);
      if (end === -1) {
        return false;
      }
      i = end + 2;
      return true;
    }
    return false;
  };

  if (starts('\uFEFF')) {
    i = 1;
  }
  if (starts('<?xml')) {
    const end = text.indexOf('?>', i);
    if (end === -1) {
      return fail('unclosed xml declaration');
    }
    i = end + 2;
  }
  while (readMisc()) {
    /* comments and processing instructions before the root */
  }
  skipSpace();
  if (!starts('<') || starts('</')) {
    return fail('missing root element');
  }

  const stack: string[] = [];
  const openElement = (): boolean => {
    i += 1;
    const name = readName();
    if (!name) {
      return false;
    }
    for (;;) {
      skipSpace();
      if (starts('/>')) {
        i += 2;
        return true;
      }
      if (starts('>')) {
        i += 1;
        stack.push(name);
        return true;
      }
      const attr = readName();
      skipSpace();
      if (!attr || text[i] !== '=') {
        return false;
      }
      i += 1;
      skipSpace();
      if (readQuoted() === null) {
        return false;
      }
    }
  };

  if (!openElement()) {
    return fail(`bad start tag at ${i}`);
  }
  while (stack.length > 0) {
    if (i >= length) {
      return fail('unclosed element ' + stack[stack.length - 1]);
    }
    if (starts('</')) {
      i += 2;
      const name = readName();
      skipSpace();
      if (!name || text[i] !== '>' || name !== stack.pop()) {
        return fail(`mismatched end tag ${name ?? ''} at ${i}`);
      }
      i += 1;
      continue;
    }
    if (starts('<!--')) {
      if (!readMisc()) {
        return fail(`bad comment at ${i}`);
      }
      continue;
    }
    if (starts('<?')) {
      if (!readMisc()) {
        return fail(`bad processing instruction at ${i}`);
      }
      continue;
    }
    if (starts('<![CDATA[')) {
      const end = text.indexOf(']]>', i + 9);
      if (end === -1) {
        return fail('unclosed CDATA');
      }
      i = end + 3;
      continue;
    }
    if (starts('<')) {
      if (!openElement()) {
        return fail(`bad element at ${i}`);
      }
      continue;
    }
    if (text.startsWith(']]>', i)) {
      return fail(`']]>' in text at ${i}`);
    }
    if (text[i] === '&') {
      if (readEntity() === null) {
        return fail(`bad entity at ${i}`);
      }
      continue;
    }
    i += 1;
  }
  while (readMisc()) {
    /* trailing misc */
  }
  skipSpace();
  if (i !== length) {
    return fail(`trailing content at ${i}`);
  }
  return { ok: true, reason: 'well-formed' };
}
