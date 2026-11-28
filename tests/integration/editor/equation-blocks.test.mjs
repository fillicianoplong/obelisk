import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FORMULA_REFERENCE_SAMPLES } from '../../../dist/shared/formula/samples.js';
import {
  bindLaunchedApp,
  debuggerTargets,
  electronBinary,
  evaluate,
  freePort,
  launchWithSandboxFallback,
  openCdp,
  sleep,
  waitFor,
} from '../electron-launch.mjs';

const READY = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  return editor && editor.editorCommands ? true : null;
})()`;

async function launchEditor() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-equations-'));
  const session = { child: undefined, client: undefined, userDataDir };
  const port = await freePort();
  const child = await launchWithSandboxFallback({
    binary: electronBinary(),
    args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`],
    ready(running) {
      return waitFor(
        running,
        async () => {
          const pages = (await debuggerTargets(port)).filter((target) => target.type === 'page');
          if (pages.length !== 1) {
            return null;
          }
          const client = openCdp(pages[0].webSocketDebuggerUrl);
          session.client = client;
          return evaluate(client, READY);
        },
        20_000,
      );
    },
  });
  session.child = child;
  return session;
}

async function run(client, body) {
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

test('AC-10: Equation reference samples render live and a broken fraction shows an error', { timeout: 90_000 }, async (t) => {
  const session = await launchEditor();
  const finish = bindLaunchedApp(t, session);
  try {
    await run(session.client, "commands.runMenuCommand('insert-equation');");
    await sleep(80);
    const equationIndex = await evaluate(
      session.client,
      `(() => {
        const blocks = document.querySelector('[data-region="page-editor"]').editorCommands.blockSnapshot();
        return blocks.findIndex((block) => block.type === 'formula');
      })()`,
    );
    assert.ok(equationIndex >= 0, 'formula block index');
    for (const sample of FORMULA_REFERENCE_SAMPLES) {
      await run(
        session.client,
        `commands.setEquationLatex(${equationIndex}, ${JSON.stringify(sample.latex)});`,
      );
      const previews = await evaluate(
        session.client,
        `document.querySelector('[data-region="page-editor"]').editorCommands.equationPreviews()`,
      );
      assert.equal(previews.length >= 1, true, sample.id);
      const row = previews[0];
      assert.ok(row, sample.id);
      assert.equal(row.error, false, `${sample.id}: ${row.message}`);
      assert.equal(row.hasKatex, true, sample.id);
    }

    await run(session.client, `commands.setEquationLatex(${equationIndex}, '\\\\frac{1}');`);
    let previews = await evaluate(
      session.client,
      `document.querySelector('[data-region="page-editor"]').editorCommands.equationPreviews()`,
    );
    assert.equal(previews[0].error, true);
    assert.match(previews[0].message ?? '', /expected/i);

    await run(session.client, `commands.setEquationLatex(${equationIndex}, '\\\\frac{a+b}{c}');`);
    const source = await evaluate(
      session.client,
      `(() => {
        const field = document.querySelector('.equation-source');
        if (!field) {
          return null;
        }
        const old = field.value;
        field.focus();
        field.value = old + ' + d';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        return field.value;
      })()`,
    );
    assert.equal(source, '\\frac{a+b}{c} + d');
    previews = await evaluate(
      session.client,
      `document.querySelector('[data-region="page-editor"]').editorCommands.equationPreviews()`,
    );
    assert.equal(previews[0].error, false);
    assert.equal(previews[0].hasKatex, true);
  } finally {
    await finish();
  }
});