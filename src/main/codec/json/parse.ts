import { failure, type JsonFailure, type JsonResult, type JsonValue } from './result.js';

// A document is a shallow tree: page, blocks, a column row, a table cell.
// 32 containers is far past that, and it keeps a nested bomb off the stack.
const JSON_MAX_DEPTH = 32;

type Parsed = { ok: true; value: JsonValue } | JsonFailure;

function isWordChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95
  );
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function decodeUtf8(bytes: Uint8Array): { ok: true; text: string } | JsonFailure {
  try {
    // A new decoder each time. A reused one remembers that it already saw a BOM.
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { ok: true, text };
  } catch {
    return failure('invalid-utf8', '');
  }
}

class Parser {
  private index = 0;
  private depth = 0;

  constructor(private readonly text: string) {}

  parse(): JsonResult {
    this.skipWs();
    if (this.eof()) {
      return this.fail('invalid-json', '');
    }
    const value = this.parseValue('');
    if (!value.ok) {
      return value;
    }
    this.skipWs();
    if (!this.eof()) {
      return this.fail('invalid-json', '');
    }
    return value;
  }

  private parseValue(path: string): Parsed {
    if (this.eof()) {
      return this.fail('invalid-json', path);
    }
    const code = this.text.charCodeAt(this.index);
    if (code >= 0xd800 && code <= 0xdfff) {
      return this.fail('unpaired-surrogate', path);
    }
    if (code === 0x7b) {
      return this.parseObject(path);
    }
    if (code === 0x5b) {
      return this.parseArray(path);
    }
    if (code === 0x22) {
      return this.parseString(path);
    }
    if (code === 0x74) {
      return this.parseLiteral('true', true, path);
    }
    if (code === 0x66) {
      return this.parseLiteral('false', false, path);
    }
    if (code === 0x6e) {
      return this.parseLiteral('null', null, path);
    }
    if (code === 0x4e) {
      if (this.wordAt(this.index, 'NaN')) {
        this.index += 3;
        return this.fail('not-finite', path);
      }
      return this.fail('invalid-json', path);
    }
    if (code === 0x49) {
      if (this.wordAt(this.index, 'Infinity')) {
        this.index += 8;
        return this.fail('not-finite', path);
      }
      return this.fail('invalid-json', path);
    }
    if (code === 0x2d || (code >= 48 && code <= 57)) {
      return this.parseNumber(path);
    }
    return this.fail('invalid-json', path);
  }

  private parseObject(path: string): Parsed {
    if (this.depth >= JSON_MAX_DEPTH) {
      return this.fail('invalid-json', path);
    }
    this.depth += 1;
    const result = this.parseObjectBody(path);
    this.depth -= 1;
    return result;
  }

  private parseObjectBody(path: string): Parsed {
    this.index += 1;
    this.skipWs();
    const record: { [key: string]: JsonValue } = Object.create(null) as { [key: string]: JsonValue };
    if (this.text.charCodeAt(this.index) === 0x7d) {
      this.index += 1;
      return { ok: true, value: record };
    }
    while (this.index <= this.text.length) {
      const key = this.parseString(path);
      if (!key.ok) {
        return key;
      }
      this.skipWs();
      if (this.text.charCodeAt(this.index) !== 0x3a) {
        return this.fail('invalid-json', path);
      }
      this.index += 1;
      this.skipWs();
      const keyPath = `${path}/${key.value}`;
      if (Object.hasOwn(record, key.value)) {
        return this.fail('duplicate-key', keyPath);
      }
      const child = this.parseValue(keyPath);
      if (!child.ok) {
        return child;
      }
      record[key.value] = child.value;
      this.skipWs();
      const mark = this.text.charCodeAt(this.index);
      if (mark === 0x7d) {
        this.index += 1;
        return { ok: true, value: record };
      }
      if (mark !== 0x2c) {
        return this.fail('invalid-json', path);
      }
      this.index += 1;
      this.skipWs();
    }
    return this.fail('invalid-json', path);
  }

  private parseArray(path: string): Parsed {
    if (this.depth >= JSON_MAX_DEPTH) {
      return this.fail('invalid-json', path);
    }
    this.depth += 1;
    const result = this.parseArrayBody(path);
    this.depth -= 1;
    return result;
  }

  private parseArrayBody(path: string): Parsed {
    this.index += 1;
    this.skipWs();
    const items: JsonValue[] = [];
    if (this.text.charCodeAt(this.index) === 0x5d) {
      this.index += 1;
      return { ok: true, value: items };
    }
    while (this.index <= this.text.length) {
      const child = this.parseValue(`${path}/${items.length}`);
      if (!child.ok) {
        return child;
      }
      items.push(child.value);
      this.skipWs();
      const mark = this.text.charCodeAt(this.index);
      if (mark === 0x5d) {
        this.index += 1;
        return { ok: true, value: items };
      }
      if (mark !== 0x2c) {
        return this.fail('invalid-json', path);
      }
      this.index += 1;
      this.skipWs();
    }
    return this.fail('invalid-json', path);
  }

  private parseString(path: string): { ok: true; value: string } | JsonFailure {
    if (this.text.charCodeAt(this.index) !== 0x22) {
      return this.fail('invalid-json', path);
    }
    this.index += 1;
    const parts: string[] = [];
    let run = this.index;
    while (this.index < this.text.length) {
      const code = this.text.charCodeAt(this.index);
      if (code === 0x22) {
        parts.push(this.text.slice(run, this.index));
        this.index += 1;
        const value = parts.join('');
        if (hasUnpairedSurrogate(value)) {
          return this.fail('unpaired-surrogate', path);
        }
        return { ok: true, value };
      }
      if (code === 0x5c) {
        parts.push(this.text.slice(run, this.index));
        const escaped = this.readEscape(path);
        if (typeof escaped !== 'string') {
          return escaped;
        }
        parts.push(escaped);
        run = this.index;
        continue;
      }
      if (code < 0x20) {
        return this.fail('invalid-json', path);
      }
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = this.text.charCodeAt(this.index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          this.index += 2;
          continue;
        }
        return this.fail('unpaired-surrogate', path);
      }
      if (code >= 0xdc00 && code <= 0xdfff) {
        return this.fail('unpaired-surrogate', path);
      }
      this.index += 1;
    }
    return this.fail('invalid-json', path);
  }

  private readEscape(path: string): string | JsonFailure {
    this.index += 1;
    if (this.index >= this.text.length) {
      return this.fail('invalid-json', path);
    }
    const code = this.text.charCodeAt(this.index);
    this.index += 1;
    switch (code) {
      case 0x22:
        return '"';
      case 0x5c:
        return '\\';
      case 0x2f:
        return '/';
      case 0x62:
        return '\b';
      case 0x66:
        return '\f';
      case 0x6e:
        return '\n';
      case 0x72:
        return '\r';
      case 0x74:
        return '\t';
      case 0x75: {
        const unit = this.readHex4(path);
        if (typeof unit !== 'number') {
          return unit;
        }
        return String.fromCharCode(unit);
      }
      default:
        return this.fail('invalid-json', path);
    }
  }

  private readHex4(path: string): number | JsonFailure {
    if (this.index + 4 > this.text.length) {
      return this.fail('invalid-json', path);
    }
    let unit = 0;
    for (let place = 0; place < 4; place += 1) {
      const code = this.text.charCodeAt(this.index);
      this.index += 1;
      let digit = -1;
      if (code >= 48 && code <= 57) {
        digit = code - 48;
      } else if (code >= 65 && code <= 70) {
        digit = code - 55;
      } else if (code >= 97 && code <= 102) {
        digit = code - 87;
      }
      if (digit < 0) {
        return this.fail('invalid-json', path);
      }
      unit = (unit << 4) + digit;
    }
    return unit;
  }

  private parseNumber(path: string): Parsed {
    const start = this.index;
    if (this.text.charCodeAt(this.index) === 0x2d) {
      if (this.wordAt(this.index + 1, 'Infinity')) {
        this.index += 9;
        return this.fail('not-finite', path);
      }
      this.index += 1;
    }
    if (!this.consumeInteger()) {
      return this.fail('invalid-json', path);
    }
    if (this.text.charCodeAt(this.index) === 0x2e) {
      this.index += 1;
      if (!this.consumeDigits()) {
        return this.fail('invalid-json', path);
      }
    }
    const exponent = this.text.charCodeAt(this.index);
    if (exponent === 0x65 || exponent === 0x45) {
      this.index += 1;
      const sign = this.text.charCodeAt(this.index);
      if (sign === 0x2b || sign === 0x2d) {
        this.index += 1;
      }
      if (!this.consumeDigits()) {
        return this.fail('invalid-json', path);
      }
    }
    const value = Number(this.text.slice(start, this.index));
    if (!Number.isFinite(value)) {
      return this.fail('not-finite', path);
    }
    return { ok: true, value };
  }

  private parseLiteral(word: string, value: boolean | null, path: string): Parsed {
    if (!this.wordAt(this.index, word)) {
      return this.fail('invalid-json', path);
    }
    this.index += word.length;
    return { ok: true, value };
  }

  private consumeInteger(): boolean {
    const code = this.text.charCodeAt(this.index);
    if (code < 48 || code > 57) {
      return false;
    }
    if (code === 48) {
      this.index += 1;
      return true;
    }
    return this.consumeDigits();
  }

  private consumeDigits(): boolean {
    if (!this.isDigit(this.index)) {
      return false;
    }
    while (this.isDigit(this.index)) {
      this.index += 1;
    }
    return true;
  }

  private isDigit(index: number): boolean {
    const code = this.text.charCodeAt(index);
    return code >= 48 && code <= 57;
  }

  private wordAt(index: number, word: string): boolean {
    if (!this.text.startsWith(word, index)) {
      return false;
    }
    return !isWordChar(this.text.charCodeAt(index + word.length));
  }

  private skipWs(): void {
    const text = this.text;
    let index = this.index;
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
        break;
      }
      index += 1;
    }
    this.index = index;
  }

  private eof(): boolean {
    return this.index >= this.text.length;
  }

  private fail(reason: JsonFailure['reason'], path: string): JsonFailure {
    return failure(reason, path);
  }
}

export function parseJson(bytes: Uint8Array): JsonResult {
  const decoded = decodeUtf8(bytes);
  if (!decoded.ok) {
    return decoded;
  }
  return new Parser(decoded.text).parse();
}
