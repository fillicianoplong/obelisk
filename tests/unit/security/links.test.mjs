import assert from 'node:assert/strict';
import test from 'node:test';
import { openConfirmedLink } from '../../../dist/main/security/links.js';
import {
  ALLOWED_PROTOCOLS,
  LINK_MAX_CHARS,
  classifyLinkAddress,
  linkConfirmPrompt,
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

test('https and mailto addresses are allowed and the prompt shows the opened address', () => {
  const https = classifyLinkAddress('https://example.com/docs');
  assert.equal(https.ok, true);
  assert.equal(https.href, 'https://example.com/docs');
  const prompt = linkConfirmPrompt(https.href);
  assert.equal(prompt.message, 'https://example.com/docs');
  assert.equal(prompt.detail.includes('browser or mail app'), true);
  assert.deepEqual([...prompt.buttons], ['Open', 'Cancel']);
  assert.equal(prompt.defaultId, 1);
  assert.equal(prompt.cancelId, 1);
  assert.equal(prompt.noLink, true);

  const mixed = classifyLinkAddress('HTTPS://Example.COM/docs');
  assert.equal(mixed.ok, true);
  assert.equal(mixed.href, 'https://example.com/docs');

  const mail = classifyLinkAddress('mailto:student@example.com');
  assert.equal(mail.ok, true);
  assert.equal(mail.scheme, 'mailto');
  assert.equal(mail.href, 'mailto:student@example.com');
});

test('file, javascript, and network paths are refused before any prompt', async () => {
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
    let confirmed = false;
    let opened = null;
    const result = await openConfirmedLink(address, {
      confirm() {
        confirmed = true;
        return Promise.resolve(true);
      },
      openExternal(href) {
        opened = href;
        return Promise.resolve();
      },
    });
    assert.equal(result.status, 'refused', address);
    assert.equal(confirmed, false, address);
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

test('Open link asks with the full address and opens only after confirm', async () => {
  const calls = [];
  const cancelled = await openConfirmedLink('https://example.com/docs', {
    confirm(address) {
      calls.push(['confirm', address]);
      return Promise.resolve(false);
    },
    openExternal(href) {
      calls.push(['open', href]);
      return Promise.resolve();
    },
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(calls, [['confirm', 'https://example.com/docs']]);

  const opened = [];
  const ok = await openConfirmedLink('HTTPS://Example.COM/docs', {
    confirm(address) {
      opened.push(['confirm', address]);
      return Promise.resolve(true);
    },
    openExternal(href) {
      opened.push(['open', href]);
      return Promise.resolve();
    },
  });
  assert.equal(ok.status, 'ok');
  assert.deepEqual(opened, [
    ['confirm', 'https://example.com/docs'],
    ['open', 'https://example.com/docs'],
  ]);
});

test('a mail link is handed to the external opener, not fetched here', async () => {
  let href = null;
  const result = await openConfirmedLink('mailto:student@example.com?subject=Lab', {
    confirm(address) {
      assert.equal(address, 'mailto:student@example.com?subject=Lab');
      return Promise.resolve(true);
    },
    openExternal(next) {
      href = next;
      return Promise.resolve();
    },
  });
  assert.equal(result.status, 'ok');
  assert.equal(href, 'mailto:student@example.com?subject=Lab');
});

test('a failed external open does not report success', async () => {
  const result = await openConfirmedLink('https://example.com/docs', {
    confirm() {
      return Promise.resolve(true);
    },
    openExternal() {
      return Promise.reject(new Error('no handler'));
    },
  });
  assert.equal(result.status, 'error');
  assert.equal(result.code, 'EACCES');
});
