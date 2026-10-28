import assert from 'node:assert/strict';
import test from 'node:test';
import { parseJson } from '../../../dist/main/codec/json/index.js';

function parseText(text) {
  return parseJson(Buffer.from(text, 'utf8'));
}

test('a strict parse keeps a normal document value', () => {
  const text = '{"view":"pageless","n":1,"ok":true,"items":[null,false,"a\\nb"]}';
  const parsed = parseText(text);
  assert.equal(parsed.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.value)), JSON.parse(text));
  assert.deepEqual(Object.keys(parsed.value), ['view', 'n', 'ok', 'items']);
});

test('a leading byte order mark is ignored', () => {
  const parsed = parseJson(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"a":1}')]));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.a, 1);
});

test('duplicate keys are refused, including keys that match only after escapes', () => {
  const root = parseText('{"view":"pages","view":"pageless"}');
  assert.equal(root.ok, false);
  assert.equal(root.reason, 'duplicate-key');
  assert.equal(root.path, '/view');
  const nested = parseText('{"page":{"top":1,"top":2}}');
  assert.equal(nested.ok, false);
  assert.equal(nested.reason, 'duplicate-key');
  assert.equal(nested.path, '/page/top');
  const escaped = parseText('{"a":1,"\\u0061":2}');
  assert.equal(escaped.ok, false);
  assert.equal(escaped.reason, 'duplicate-key');
  assert.equal(escaped.path, '/a');
});

test('NaN and Infinity are refused, and a finite number is kept', () => {
  for (const [text, path] of [
    ['{"view":NaN}', '/view'],
    ['{"top":Infinity}', '/top'],
    ['[-Infinity]', '/0'],
    ['[1e309]', '/0'],
  ]) {
    const parsed = parseText(text);
    assert.equal(parsed.ok, false, text);
    assert.equal(parsed.reason, 'not-finite', text);
    assert.equal(parsed.path, path, text);
  }
  const finite = parseText('[-0,0.5,1e-2,12]');
  assert.equal(finite.ok, true);
  assert.deepEqual(finite.value, [-0, 0.5, 0.01, 12]);
});

test('an unpaired surrogate is refused and a pair is kept', () => {
  for (const text of ['"\\uD800"', '"\\uDC00"', '"a\\uD800b"', '"\\uD800\\uD800"', '"\\udc00"']) {
    const parsed = parseText(text);
    assert.equal(parsed.ok, false, text);
    assert.equal(parsed.reason, 'unpaired-surrogate', text);
  }
  const pair = parseText('"\\uD800\\uDC00"');
  assert.equal(pair.ok, true);
  assert.equal(pair.value, '\uD800\uDC00');
});

test('broken JSON and broken UTF-8 are refused', () => {
  for (const text of ['', '   ', '{', '{"a":1,}', '{"a" 1}', '[1,]', '01', '{"a":1}{}', '"\\u12"', '"\\q"', '"\n"', 'tru', 'falsee', 'NaNny', '+1']) {
    const parsed = parseText(text);
    assert.equal(parsed.ok, false, JSON.stringify(text));
    assert.equal(parsed.reason, 'invalid-json', JSON.stringify(text));
  }
  const utf8 = parseJson(Buffer.from([0xff, 0x00]));
  assert.equal(utf8.ok, false);
  assert.equal(utf8.reason, 'invalid-utf8');
  assert.equal(utf8.path, '');
});

test('a nested bomb stops before the stack does', () => {
  let text = '0';
  for (let depth = 0; depth < 200; depth += 1) {
    text = `[${text}]`;
  }
  const parsed = parseText(text);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.reason, 'invalid-json');

  let shallow = '0';
  for (let depth = 0; depth < 8; depth += 1) {
    shallow = `[${shallow}]`;
  }
  const ok = parseText(shallow);
  assert.equal(ok.ok, true);
  assert.equal(ok.value[0][0][0][0][0][0][0][0], 0);
});
