import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  bindLaunchedApp,
  debuggerTargets,
  electronBinary,
  evaluate,
  freePort,
  launchWithSandboxFallback,
  openCdp,
  sleep,
  STEP_TIMEOUT_MS,
  waitFor,
} from '../electron-launch.mjs';

const TAB_ONE = 'River field\nnotes';
const TAB_TWO = 'Campaign trip outline';

const READ_PAGE = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  const status = document.querySelector('[data-region="status-bar"]');
  if (document.documentElement.dataset.shellCommands !== 'ready') {
    return null;
  }
  if (!editor || editor.getAttribute('contenteditable') !== 'true' || !status || !editor.editorCommands) {
    return null;
  }
  const paragraphs = [...editor.querySelectorAll(':scope > p')];
  if (paragraphs.length === 0) {
    return null;
  }
  const selection = window.getSelection();
  let caret = null;
  if (selection && selection.rangeCount > 0 && editor.contains(selection.anchorNode)) {
    const range = selection.getRangeAt(0);
    const block = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer
      : range.startContainer.parentNode;
    const paragraph = block && block.closest ? block.closest('p') : null;
    if (paragraph && editor.contains(paragraph)) {
      const before = document.createRange();
      before.setStart(paragraph, 0);
      before.setEnd(range.startContainer, range.startOffset);
      caret = {
        paragraph: [...editor.querySelectorAll(':scope > p')].indexOf(paragraph),
        offset: before.toString().replace(/\\u200b/g, '').length,
      };
    }
  }
  const styled = [...editor.querySelectorAll('[style]')].map((element) => element.getAttribute('style'));
  const reported = editor.getAttribute('data-editor-caret');
  const reportedMatch = reported && /^(\\d+):(\\d+)$/.exec(reported);
  return {
    text: paragraphs.map((block) => (block.textContent || '').replace(/\\u200b/g, '')).join('\\n'),
    status: (status.textContent || '').trim(),
    tabs: [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute('data-title')),
    active: document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-title') ?? null,
    caret,
    reportedCaret: reportedMatch
      ? { paragraph: Number(reportedMatch[1]), offset: Number(reportedMatch[2]) }
      : null,
    whiteSpace: getComputedStyle(editor).whiteSpace,
    editorStyle: editor.getAttribute('style'),
    styled,
  };
})()`;

async function pageTarget(port) {
  const pages = (await debuggerTargets(port)).filter(
    (target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string',
  );
  if (pages.length !== 1) {
    return null;
  }
  return pages[0].webSocketDebuggerUrl;
}

async function launchEditor(session, port) {
  const binary = electronBinary();
  const args = ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${session.userDataDir}`];
  session.child = await launchWithSandboxFallback({
    binary,
    args,
    ready(running) {
      session.client?.close();
      session.client = undefined;
      return waitFor(
        running,
        async () => {
          const url = await pageTarget(port);
          if (!url) {
            return null;
          }
          session.client = openCdp(url);
          const page = await evaluate(session.client, READ_PAGE);
          return page ? { page, url } : null;
        },
        20_000,
      );
    },
  });
  return session.child;
}

async function reconnect(port, session) {
  const url = await pageTarget(port);
  if (!url) {
    return null;
  }
  if (!session.client || session.client.url !== url) {
    session.client?.close();
    session.client = openCdp(url);
  }
  return session.client;
}

async function readPage(port, session) {
  const client = await reconnect(port, session);
  if (!client) {
    return null;
  }
  return evaluate(client, READ_PAGE);
}

async function waitForPage(port, session, predicate, label) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    last = await readPage(port, session);
    if (last && predicate(last)) {
      return last;
    }
    await sleep(30);
  }
  throw new Error(`${label} did not match within ${STEP_TIMEOUT_MS} ms: ${JSON.stringify(last)}`);
}

async function runEditorCommand(client, body) {
  const result = await evaluate(
    client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      const commands = editor && editor.editorCommands;
      if (!commands) {
        return 'editor commands are not ready';
      }
      ${body}
      return 'ok';
    })()`,
  );
  assert.equal(result, 'ok', result);
}

async function typeText(port, session, text) {
  let expected = '';
  for (const char of text) {
    if (char === '\n') {
      await runEditorCommand(session.client, 'commands.splitParagraph();');
    } else {
      await runEditorCommand(session.client, `commands.insertText(${JSON.stringify(char)});`);
    }
    expected += char;
    const page = await waitForPage(
      port,
      session,
      (current) => current.text === expected,
      `typing ${JSON.stringify(expected)}`,
    );
    assert.equal(page.text, expected);
  }
}

async function openNewTab(port, session) {
  const before = await readPage(port, session);
  assert.ok(before, 'the page was not readable before New tab');
  const clicked = await evaluate(
    session.client,
    `(() => {
      if (document.documentElement.dataset.shellCommands !== 'ready') {
        return 'commands not ready';
      }
      const button = document.querySelector('[aria-label="New tab"]');
      if (!button) {
        return 'missing new tab';
      }
      button.click();
      return 'clicked';
    })()`,
  );
  assert.equal(clicked, 'clicked', clicked);
  const expectedCount = before.tabs.length + 1;
  return waitForPage(
    port,
    session,
    (current) => current.tabs.length === expectedCount && current.active === `Untitled ${expectedCount}`,
    'New tab',
  );
}

function sameCaret(actual, expected) {
  return Boolean(
    actual
    && actual.paragraph === expected.paragraph
    && actual.offset === expected.offset,
  );
}

async function selectTab(port, session, tabId) {
  const title = await evaluate(
    session.client,
    `(() => {
      const tab = document.querySelector('[data-tab-id=${JSON.stringify(tabId)}]');
      if (!tab) {
        return 'missing tab';
      }
      tab.click();
      return tab.getAttribute('data-title');
    })()`,
  );
  assert.notEqual(title, 'missing tab', title);
  return waitForPage(port, session, (current) => current.active === title, `tab ${tabId}`);
}

test('typed text, caret, and undo stay with each tab', { timeout: 45_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-editor-tabs-'));
  const port = await freePort();
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);

  try {
    const child = await launchEditor(session, port);
    await session.client.send('Log.enable');
    await session.client.send('Runtime.enable');
    const ready = await readPage(port, session);
    assert.ok(ready, 'the editor did not render');
    assert.equal(ready.text, '');
    assert.equal(ready.active, 'Untitled 1');

    await typeText(port, session, TAB_ONE);
    let page = await waitForPage(
      port,
      session,
      (current) => current.text === TAB_ONE
        && current.status === 'Page 1 of 1 - 3 words - 17 characters - 100% - Not saved',
      'first tab text',
    );
    assert.equal(page.text, TAB_ONE);
    assert.equal(page.status, 'Page 1 of 1 - 3 words - 17 characters - 100% - Not saved');
    assert.ok(['pre-wrap', 'break-spaces'].includes(page.whiteSpace), page.whiteSpace);
    assert.equal(page.editorStyle, null);
    assert.deepEqual(page.styled, []);

    const tabOneCaret = { paragraph: 1, offset: 0 };
    await runEditorCommand(session.client, 'commands.setParagraphCaret(1, 0);');
    page = await waitForPage(
      port,
      session,
      (current) => sameCaret(current.reportedCaret, tabOneCaret) && sameCaret(current.caret, tabOneCaret),
      'caret in the first tab',
    );
    assert.deepEqual(page.reportedCaret, tabOneCaret);
    assert.deepEqual(page.caret, tabOneCaret);

    await openNewTab(port, session);
    page = await waitForPage(
      port,
      session,
      (current) => current.active === 'Untitled 2' && current.text === '',
      'new tab',
    );
    assert.equal(page.text, '');
    assert.equal(page.status, 'Page 1 of 1 - 0 words - 0 characters - 100% - Not saved');

    await typeText(port, session, TAB_TWO);
    page = await waitForPage(
      port,
      session,
      (current) => current.text === TAB_TWO
        && current.status === 'Page 1 of 1 - 3 words - 21 characters - 100% - Not saved',
      'second tab text',
    );
    assert.equal(page.text, TAB_TWO);
    assert.equal(page.status, 'Page 1 of 1 - 3 words - 21 characters - 100% - Not saved');
    assert.deepEqual(page.tabs, ['Untitled 1', 'Untitled 2']);

    for (let step = 0; step < TAB_TWO.length + 2 && page.text !== ''; step += 1) {
      const previous = page.text;
      await runEditorCommand(session.client, 'commands.undo();');
      page = await waitForPage(
        port,
        session,
        (current) => current.active === 'Untitled 2' && current.text !== previous,
        'undo in the second tab',
      );
      assert.notEqual(page.text, previous);
    }
    assert.equal(page.text, '');
    assert.equal(page.active, 'Untitled 2');

    await selectTab(port, session, 'untitled-1');
    page = await waitForPage(
      port,
      session,
      (current) => current.active === 'Untitled 1'
        && current.text === TAB_ONE
        && sameCaret(current.reportedCaret, tabOneCaret)
        && sameCaret(current.caret, tabOneCaret),
      'first tab after undo',
    );
    assert.equal(page.text, TAB_ONE);
    assert.equal(page.status, 'Page 1 of 1 - 3 words - 17 characters - 100% - Not saved');
    assert.deepEqual(page.reportedCaret, tabOneCaret);
    assert.deepEqual(page.caret, tabOneCaret);

    await selectTab(port, session, 'untitled-2');
    page = await waitForPage(
      port,
      session,
      (current) => current.active === 'Untitled 2' && current.text === '',
      'empty second tab',
    );
    assert.equal(page.text, '');
    assert.equal(page.status, 'Page 1 of 1 - 0 words - 0 characters - 100% - Not saved');

    for (let step = 0; step < TAB_TWO.length + 2 && page.text !== TAB_TWO; step += 1) {
      const previous = page.text;
      await runEditorCommand(session.client, 'commands.redo();');
      page = await waitForPage(
        port,
        session,
        (current) => current.active === 'Untitled 2' && current.text !== previous,
        'redo in the second tab',
      );
      assert.notEqual(page.text, previous);
    }
    assert.equal(page.text, TAB_TWO);
    assert.equal(page.active, 'Untitled 2');

    await selectTab(port, session, 'untitled-1');
    page = await waitForPage(
      port,
      session,
      (current) => current.active === 'Untitled 1'
        && current.text === TAB_ONE
        && sameCaret(current.reportedCaret, tabOneCaret)
        && sameCaret(current.caret, tabOneCaret),
      'first tab after redo',
    );
    assert.equal(page.text, TAB_ONE);
    assert.deepEqual(page.reportedCaret, tabOneCaret);
    assert.deepEqual(page.caret, tabOneCaret);
    assert.equal(page.editorStyle, null);
    assert.deepEqual(page.styled, []);
    const cspText = [
      ...session.client.events.map((event) => JSON.stringify(event)),
      child.output,
    ].join('\n');
    assert.doesNotMatch(cspText, /Content Security Policy|Refused to apply inline style|Refused to execute inline script|unsafe-eval/i);
  } finally {
    await finish();
  }
});
