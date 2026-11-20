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
  waitFor,
} from '../electron-launch.mjs';

const SHELL_READY = `document.documentElement.dataset.shellCommands === 'ready'
  && Boolean(document.querySelector('[data-region="page-editor"]')?.editorView)`;

const WORDS = `${'Wrapped paragraph words '.repeat(30).trim()}`;

function pageTarget(port) {
  return debuggerTargets(port).then((pages) => {
    const matches = pages.filter(
      (target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string',
    );
    return matches.length === 1 ? matches[0].webSocketDebuggerUrl : null;
  });
}

test('a first Tab indents only the first line, and Enter keeps that indent', { timeout: 45_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-indent-'));
  const port = await freePort();
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);

  try {
    session.child = await launchWithSandboxFallback({
      binary: electronBinary(),
      args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`],
      ready(child) {
        return waitFor(child, async () => {
          const url = await pageTarget(port);
          if (!url) {
            return null;
          }
          if (!session.client) {
            session.client = openCdp(url);
          }
          const ready = await evaluate(session.client, SHELL_READY);
          return ready ? true : null;
        }, 20_000);
      },
    });

    const measured = await evaluate(session.client, `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      const view = editor.editorView;
      const words = ${JSON.stringify(WORDS)};
      editor.editorCommands.replaceText(words + '\\n' + words);
      const Sel = view.state.selection.constructor;
      const place = (pos) => {
        view.dispatch(view.state.tr.setSelection(Sel.create(view.state.doc, pos, pos)).setMeta('uiEvent', 'indent'));
      };
      const press = (key, shiftKey = false) => {
        let handled = false;
        view.someProp('handleKeyDown', (handler) => {
          const event = new KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
            shiftKey,
          });
          const result = handler(view, event);
          if (result) {
            handled = true;
          }
          return result;
        });
        return handled;
      };
      const read = (paragraph) => {
        const style = getComputedStyle(paragraph);
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        const lines = [...range.getClientRects()].map((rect) => rect.left);
        return {
          left: paragraph.getAttribute('data-indent-left'),
          first: paragraph.getAttribute('data-indent-first'),
          textIndent: style.textIndent,
          paddingLeft: style.paddingLeft,
          marginLeft: style.marginLeft,
          styleAttr: paragraph.hasAttribute('style'),
          lines,
        };
      };
      place(1);
      press('Tab');
      const firstTab = read(editor.querySelectorAll('p')[0]);
      const plain = read(editor.querySelectorAll('p')[1]);
      press('Tab');
      const secondTab = read(editor.querySelectorAll('p')[0]);
      press('Tab', true);
      const afterShift = read(editor.querySelectorAll('p')[0]);
      const end = view.state.doc.child(0).nodeSize - 1;
      place(end);
      press('Enter');
      editor.editorCommands.insertText(words);
      const carried = read(editor.querySelectorAll('p')[1]);
      const referenceBefore = view.state.doc.content.size - view.state.doc.child(2).nodeSize;
      place(referenceBefore + 1 + view.state.doc.child(2).content.size);
      press('Enter');
      const blank = editor.querySelectorAll('p')[3];
      editor.editorCommands.replaceText('Above');
      place(1);
      press('Tab');
      place(view.state.doc.child(0).nodeSize - 1);
      press('Enter');
      const entered = {
        count: view.state.doc.childCount,
        first: view.state.doc.child(1).attrs.indentFirst,
        left: view.state.doc.child(1).attrs.indentLeft,
        head: view.state.selection.head,
      };
      press('Backspace');
      const cleared = {
        count: view.state.doc.childCount,
        above: view.state.doc.child(0).textContent,
        empty: view.state.doc.child(1).textContent,
        first: view.state.doc.child(1).attrs.indentFirst,
        left: view.state.doc.child(1).attrs.indentLeft,
        head: view.state.selection.head,
        offset: view.state.selection.$from.parentOffset,
      };
      editor.editorCommands.undo();
      const undone = {
        count: view.state.doc.childCount,
        first: view.state.doc.child(1).attrs.indentFirst,
        empty: view.state.doc.child(1).textContent,
      };
      press('Backspace');
      press('Backspace');
      const joined = {
        count: view.state.doc.childCount,
        text: view.state.doc.child(0).textContent,
      };
      editor.editorCommands.replaceText('Plain');
      place(view.state.doc.child(0).nodeSize - 1);
      press('Enter');
      press('Backspace');
      const plainJoined = {
        count: view.state.doc.childCount,
        text: view.state.doc.child(0).textContent,
        first: view.state.doc.child(0).attrs.indentFirst,
        left: view.state.doc.child(0).attrs.indentLeft,
      };
      return {
        firstTab,
        plain,
        secondTab,
        afterShift,
        carried,
        blank: {
          left: blank.getAttribute('data-indent-left'),
          first: blank.getAttribute('data-indent-first'),
        },
        entered,
        cleared,
        undone,
        joined,
        plainJoined,
      };
    })()`);

    assert.equal(measured.firstTab.left, '0');
    assert.equal(measured.firstTab.first, '0.5');
    assert.equal(measured.firstTab.textIndent, '48px');
    assert.equal(measured.firstTab.paddingLeft, '0px');
    assert.equal(measured.firstTab.marginLeft, '0px');
    assert.equal(measured.firstTab.styleAttr, false);
    assert.ok(measured.firstTab.lines.length >= 2, JSON.stringify(measured.firstTab.lines));
    const firstLine = measured.firstTab.lines[0];
    const secondLine = measured.firstTab.lines[1];
    const plainLine = measured.plain.lines[0];
    assert.ok(firstLine > secondLine + 40, JSON.stringify(measured.firstTab.lines));
    assert.ok(Math.abs(secondLine - plainLine) < 2, JSON.stringify({ secondLine, plainLine }));

    assert.equal(measured.secondTab.left, '0.5');
    assert.equal(measured.secondTab.first, '0.5');
    assert.equal(measured.secondTab.paddingLeft, '48px');
    assert.ok(measured.secondTab.lines[1] > secondLine + 40, JSON.stringify(measured.secondTab.lines));

    assert.equal(measured.afterShift.left, '0');
    assert.equal(measured.afterShift.first, '0.5');
    assert.ok(Math.abs(measured.afterShift.lines[1] - plainLine) < 2);

    assert.equal(measured.carried.left, '0');
    assert.equal(measured.carried.first, '0.5');
    assert.equal(measured.carried.marginLeft, '0px');
    assert.equal(measured.carried.paddingLeft, '0px');
    assert.equal(measured.carried.textIndent, '48px');
    assert.equal(measured.carried.styleAttr, false);
    assert.ok(measured.carried.lines.length >= 2);
    assert.ok(measured.carried.lines[0] > measured.carried.lines[1] + 40);
    assert.ok(Math.abs(measured.carried.lines[1] - plainLine) < 2);

    assert.equal(measured.blank.left, '0');
    assert.equal(measured.blank.first, '0');

    assert.equal(measured.entered.count, 2);
    assert.equal(measured.entered.first, 0.5);
    assert.equal(measured.entered.left, 0);
    assert.equal(measured.cleared.count, 2);
    assert.equal(measured.cleared.above, 'Above');
    assert.equal(measured.cleared.empty, '');
    assert.equal(measured.cleared.first, 0);
    assert.equal(measured.cleared.left, 0);
    assert.equal(measured.cleared.head, measured.entered.head);
    assert.equal(measured.cleared.offset, 0);
    assert.equal(measured.undone.count, 2);
    assert.equal(measured.undone.first, 0.5);
    assert.equal(measured.undone.empty, '');
    assert.equal(measured.joined.count, 1);
    assert.equal(measured.joined.text, 'Above');
    assert.equal(measured.plainJoined.count, 1);
    assert.equal(measured.plainJoined.text, 'Plain');
    assert.equal(measured.plainJoined.first, 0);
    assert.equal(measured.plainJoined.left, 0);
  } finally {
    await finish();
  }
});
