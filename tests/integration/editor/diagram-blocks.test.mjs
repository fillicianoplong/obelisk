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
  waitFor,
} from '../electron-launch.mjs';

const READY = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  return editor && editor.editorCommands ? true : null;
})()`;

const FLOWCHART = `flowchart TD
  Start([Start]) --> Done([Done])`;

const FLOWCHART_WITH_EDGE = `flowchart LR
  Start([Start]) -->|go| Done([Done])`;

const LIGHT_STROKE = '#1f2630';
const DARK_SCREEN_STROKE = '#e6eaf0';

function normalizeHex(color) {
  if (typeof color !== 'string' || color.length === 0) {
    return color;
  }
  const named = color.trim().toLowerCase();
  const rgb = named.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgb) {
    const hex = (number) => number.toString(16).padStart(2, '0');
    return `#${hex(Number(rgb[1]))}${hex(Number(rgb[2]))}${hex(Number(rgb[3]))}`;
  }
  return named;
}

async function launchEditor() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-diagram-'));
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

test('diagram block renders a flowchart and shows parse errors', { timeout: 120_000 }, async (t) => {
  const session = await launchEditor();
  const finish = bindLaunchedApp(t, session);
  try {
    await run(session.client, "commands.runMenuCommand('insert-diagram');");
    await sleep(300);
    const hints = await evaluate(
      session.client,
      '(() => [...document.querySelectorAll(".block-empty-hint")].length)()',
    );
    assert.equal(hints, 0, 'empty-block hint should not show when a diagram is present');

    let previews = await evaluate(
      session.client,
      '(() => document.querySelector("[data-region=page-editor]").editorCommands.diagramPreviews())()',
    );
    assert.equal(previews.length, 1);
    assert.equal(previews[0].svg, false);

    await evaluate(
      session.client,
      `(() => {
        const area = document.querySelector('.diagram-source');
        area.focus();
        area.value = ${JSON.stringify(FLOWCHART)};
        area.dispatchEvent(new InputEvent('input', { bubbles: true }));
        return true;
      })()`,
    );
    const rendered = await waitFor(
      session.child,
      async () => {
        const next = await evaluate(
          session.client,
          '(() => document.querySelector("[data-region=page-editor]").editorCommands.diagramPreviews())()',
        );
        if (!next[0]?.svg) {
          return null;
        }
        if (next[0].width < 20 || next[0].height < 20) {
          return null;
        }
        if (!next[0].labels.includes('Start') || !next[0].labels.includes('Done')) {
          return null;
        }
        return next;
      },
      25_000,
    );
    assert.equal(rendered[0].mode, 'edit');

    await evaluate(
      session.client,
      `(() => {
        document.activeElement?.blur();
        let sink = document.getElementById('obelisk-test-focus-sink');
        if (!sink) {
          sink = document.createElement('button');
          sink.id = 'obelisk-test-focus-sink';
          sink.type = 'button';
          sink.style.position = 'fixed';
          sink.style.left = '-9999px';
          document.body.append(sink);
        }
        sink.focus();
        return true;
      })()`,
    );
    await waitFor(
      session.child,
      async () => {
        const mode = await evaluate(
          session.client,
          '(() => document.querySelector(".diagram-block")?.dataset.mode)()',
        );
        return mode === 'display' ? true : null;
      },
      5_000,
    );
    const display = await evaluate(
      session.client,
      '(() => document.querySelector("[data-region=page-editor]").editorCommands.diagramPreviews())()',
    );
    assert.equal(display[0].mode, 'display');
    assert.equal(display[0].svg, true);

    await evaluate(
      session.client,
      `(() => {
        const area = document.querySelector('.diagram-source');
        area.focus();
        area.value = 'not mermaid';
        area.dispatchEvent(new InputEvent('input', { bubbles: true }));
        return true;
      })()`,
    );
    const errored = await waitFor(
      session.child,
      async () => {
        const next = await evaluate(
          session.client,
          '(() => document.querySelector("[data-region=page-editor]").editorCommands.diagramPreviews())()',
        );
        if (
          next[0]?.error !== true
          || next[0].errorRegions !== 1
          || next[0].errorHeadlines !== 1
          || next[0].message !== "Couldn't draw this diagram. Check the Mermaid syntax."
        ) {
          return null;
        }
        return next;
      },
      25_000,
    );
    assert.equal(errored[0].svg, false);
    assert.equal(errored[0].mode, 'edit');
    assert.equal(errored[0].sourceVisible, true);

    await evaluate(
      session.client,
      `(() => {
        document.activeElement?.blur();
        let sink = document.getElementById('obelisk-test-focus-sink');
        if (!sink) {
          sink = document.createElement('button');
          sink.id = 'obelisk-test-focus-sink';
          sink.type = 'button';
          sink.style.position = 'fixed';
          sink.style.left = '-9999px';
          document.body.append(sink);
        }
        sink.focus();
        return true;
      })()`,
    );
    await sleep(400);
    const blurred = await evaluate(
      session.client,
      '(() => document.querySelector("[data-region=page-editor]").editorCommands.diagramPreviews())()',
    );
    assert.equal(blurred[0].mode, 'edit');
    assert.equal(blurred[0].sourceVisible, true);
    assert.equal(blurred[0].errorRegions, 1);
    assert.equal(blurred[0].errorHeadlines, 1);

    await evaluate(
      session.client,
      `(() => {
        document.documentElement.dataset.theme = 'dark';
        return true;
      })()`,
    );
    await evaluate(
      session.client,
      `(() => {
        const area = document.querySelector('.diagram-source');
        area.focus();
        area.value = ${JSON.stringify(FLOWCHART_WITH_EDGE)};
        area.dispatchEvent(new InputEvent('input', { bubbles: true }));
        return true;
      })()`,
    );
    const darkScreen = await waitFor(
      session.child,
      async () => {
        const next = await evaluate(
          session.client,
          '(() => document.querySelector("[data-region=page-editor]").editorCommands.diagramPreviews())()',
        );
        const stroke = normalizeHex(next[0]?.edgeStroke);
        return stroke === DARK_SCREEN_STROKE ? next : null;
      },
      25_000,
    );
    assert.equal(normalizeHex(darkScreen[0].edgeStroke), DARK_SCREEN_STROKE);

    const exportStroke = await evaluate(
      session.client,
      `(() => document.querySelector("[data-region=page-editor]").editorCommands.diagramProbeEdgeStroke('export'))()`,
    );
    assert.equal(normalizeHex(exportStroke), LIGHT_STROKE);

    await evaluate(
      session.client,
      `(() => {
        document.documentElement.dataset.theme = 'light';
        return true;
      })()`,
    );
    const lightScreen = await waitFor(
      session.child,
      async () => {
        const next = await evaluate(
          session.client,
          '(() => document.querySelector("[data-region=page-editor]").editorCommands.diagramPreviews())()',
        );
        const stroke = normalizeHex(next[0]?.edgeStroke);
        return stroke === LIGHT_STROKE ? next : null;
      },
      25_000,
    );
    assert.equal(normalizeHex(lightScreen[0].edgeStroke), LIGHT_STROKE);
  } finally {
    await finish();
  }
});