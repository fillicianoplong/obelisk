import assert from 'node:assert/strict';
import test from 'node:test';
import { openAllowedLink } from '../../../dist/main/security/links.js';
import {
  ALLOWED_PROTOCOLS,
  LINK_MAX_CHARS,
  classifyLinkAddress,
} from '../../../dist/shared/links/address.js';
import { LINK_MAX_CHARS as LIMIT_LINK_MAX, LINK_SCHEMES, checkDocument } from '../../../dist/shared/schema/index.js';

function id(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function documentWithLink(address) {
  return {
    view: 'pageless',
    page: {
      paper: 'letter',
      orientation: 'portrait',
      margins: { top: 1, right: 1, bottom: 1, left: 1 },
    },
    header: {
      id: id(1),
      align: 'left',
      lineSpacing: 'single',
      spaceBefore: 0,
      spaceAfter: 0,
      indents: { left: 0, first: 0, hanging: 0 },
      content: [],
    },
    footer: {
      id: id(2),
      align: 'left',
      lineSpacing: 'single',
      spaceBefore: 0,
      spaceAfter: 0,
      indents: { left: 0, first: 0, hanging: 0 },
      content: [],
    },
    blocks: [{
      type: 'paragraph',
      id: id(3),
      align: 'left',
      lineSpacing: 'single',
      spaceBefore: 0,
      spaceAfter: 0,
      indents: { left: 0, first: 0, hanging: 0 },
      content: [{ type: 'link', address, text: 'Open' }],
    }],
  };
}

test('the link allow-list matches the format limits', () => {
  assert.equal(LINK_MAX_CHARS, LIMIT_LINK_MAX);
  assert.equal(ALLOWED_PROTOCOLS.size, LINK_SCHEMES.length);
  for (const scheme of LINK_SCHEMES) {
    assert.equal(ALLOWED_PROTOCOLS.has(`${scheme}:`), true, scheme);
  }
});

test('https and mailto addresses are allowed', () => {
  const https = classifyLinkAddress('https://example.com/docs');
  assert.equal(https.ok, true);
  assert.equal(https.href, 'https://example.com/docs');

  const mixed = classifyLinkAddress('HTTPS://Example.COM/docs');
  assert.equal(mixed.ok, true);
  assert.equal(mixed.href, 'https://example.com/docs');

  const mail = classifyLinkAddress('mailto:student@example.com');
  assert.equal(mail.ok, true);
  assert.equal(mail.scheme, 'mailto');
  assert.equal(mail.href, 'mailto:student@example.com');
});

test('file, javascript, and network paths are refused and never opened', async () => {
  const refused = [
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    ' javascript:alert(1)',
    'file:///C:/Windows',
    'file://server/share/notes',
    'data:text/html,hi',
    'obelisk:open',
    '\\\\server\\share',
    '//server/share',
    'http:////server/share',
    'http:///etc/passwd',
    'mailto:',
    'http://',
  ];
  for (const address of refused) {
    const checked = classifyLinkAddress(address);
    assert.equal(checked.ok, false, address);
    let opened = null;
    const result = await openAllowedLink(address, {
      openExternal(href) {
        opened = href;
        return Promise.resolve();
      },
    });
    assert.equal(result.status, 'refused', address);
    assert.equal(opened, null, address);
    const openedFile = checkDocument(documentWithLink(address));
    assert.equal(openedFile.ok, false, address);
    assert.equal(openedFile.reason, 'invalid', address);
  }
});

test('a valid https link in a file is accepted', () => {
  const opened = checkDocument(documentWithLink('https://example.com/docs'));
  assert.equal(opened.ok, true);
  const mail = checkDocument(documentWithLink('mailto:student@example.com'));
  assert.equal(mail.ok, true);
});

test('Open link opens an allowed address right away, using the checked address', async () => {
  const calls = [];
  const ok = await openAllowedLink('HTTPS://Example.COM/docs', {
    openExternal(href) {
      calls.push(href);
      return Promise.resolve();
    },
  });
  assert.equal(ok.status, 'ok');
  assert.deepEqual(calls, ['https://example.com/docs']);
});

test('a mail link is handed to the external opener, not fetched here', async () => {
  let href = null;
  const result = await openAllowedLink('mailto:student@example.com?subject=Lab', {
    openExternal(next) {
      href = next;
      return Promise.resolve();
    },
  });
  assert.equal(result.status, 'ok');
  assert.equal(href, 'mailto:student@example.com?subject=Lab');
});

test('a failed external open does not report success', async () => {
  const result = await openAllowedLink('https://example.com/docs', {
    openExternal() {
      return Promise.reject(new Error('no handler'));
    },
  });
  assert.equal(result.status, 'error');
  assert.equal(result.code, 'EACCES');
});
