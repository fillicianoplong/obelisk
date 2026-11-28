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

const READY = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  const menu = document.querySelector('[role="menubar"]');
  if (!editor || !menu || editor.getAttribute('contenteditable') !== 'true') {
    return null;
  }
  if (document.documentElement.dataset.shellCommands !== 'ready') {
    return null;
  }
  if (!editor.editorCommands) {
    return null;
  }
  return true;
})()`;

function lineHeightRatio(element) {
  if (!(element instanceof HTMLElement)) {
    return null;
  }
  const style = getComputedStyle(element);
  const fontSize = Number.parseFloat(style.fontSize);
  if (!Number.isFinite(fontSize) || fontSize <= 0) {
    return null;
  }
  const lineHeight = style.lineHeight;
  const linePx = typeof lineHeight === 'string' && lineHeight.endsWith('px')
    ? Number.parseFloat(lineHeight)
    : Number.parseFloat(lineHeight) * fontSize;
  if (!Number.isFinite(linePx)) {
    return null;
  }
  return linePx / fontSize;
}

const MLA_DOM = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  const canvas = document.querySelector('.page-canvas');
  const headerBand = document.querySelector('.page-band[data-page-part="header"] .page-band-text p');
  const headerStyle = headerBand ? getComputedStyle(headerBand) : null;
  const paragraphs = editor ? [...editor.querySelectorAll(':scope > p')] : [];
  const body = paragraphs[5];
  const worksEntry = paragraphs[7];
  const nameParagraph = paragraphs[0];
  const titleParagraph = paragraphs[4];
  const nameStyle = nameParagraph ? getComputedStyle(nameParagraph) : null;
  const bodyStyle = body ? getComputedStyle(body) : null;
  const sheetDefault = editor?.getAttribute('data-default-line-spacing') ?? null;
  const canvasDefault = canvas?.getAttribute('data-default-line-spacing') ?? null;
  const lineHeightRatio = ${lineHeightRatio.toString()};
  return {
    view: canvas?.getAttribute('data-page-view'),
    tabCount: document.querySelectorAll('[data-region="tab-strip"] [role="tab"]').length,
    activeTitle: document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-title'),
    headerAlign: headerBand?.getAttribute('data-align'),
    headerText: headerBand?.textContent?.trim() ?? '',
    headerLineSpacing: headerBand?.getAttribute('data-line-spacing'),
    bodyFirstIndent: body?.getAttribute('data-indent-first'),
    bodyLineSpacingAttr: body?.getAttribute('data-line-spacing'),
    bodyLineHeight: bodyStyle?.lineHeight ?? '',
    documentDefaultLineSpacing: sheetDefault,
    canvasDefaultLineSpacing: canvasDefault,
    nameLineHeightRatio: lineHeightRatio(nameParagraph),
    titleLineHeightRatio: lineHeightRatio(titleParagraph),
    bodyLineHeightRatio: lineHeightRatio(body),
    headerLineHeightRatio: lineHeightRatio(headerBand),
    worksHanging: worksEntry?.getAttribute('data-indent-hanging'),
    computedFontFamily: nameStyle?.fontFamily ?? '',
    computedFontSize: nameStyle?.fontSize ?? '',
    textAlignRight: headerStyle?.textAlign === 'right',
    pageBreakCount: document.querySelectorAll('.page-break').length,
    placeholders: paragraphs.map((node) => (node.textContent || '').replace(/\\u200b/g, '').trim()),
    zoom: getComputedStyle(document.querySelector('.page-region') || document.documentElement).getPropertyValue('--page-zoom').trim(),
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

async function launchApp(session, port) {
  session.child = await launchWithSandboxFallback({
    binary: electronBinary(),
    args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${session.userDataDir}`],
    ready(running) {
      return waitFor(
        running,
        async () => {
          const url = await pageTarget(port);
          if (!url) {
            return null;
          }
          session.client?.close();
          session.client = openCdp(url);
          return evaluate(session.client, READY);
        },
        20_000,
      );
    },
  });
}

test('File > New from template > MLA opens a tab that matches the MLA reference (AC-09)', async (t) => {
  const port = await freePort();
  const session = { userDataDir: await mkdtemp(path.join(tmpdir(), 'obelisk-mla-')) };
  const finish = bindLaunchedApp(t, session);
  await launchApp(session, port);

  let clickMla = 'pending';
  const clickDeadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < clickDeadline && clickMla !== 'clicked') {
    clickMla = await evaluate(
      session.client,
      `(() => {
        const file = document.querySelector('[data-menu="file"]');
        if (!file) return 'no file menu';
        if (file.getAttribute('aria-expanded') !== 'true') {
          file.click();
          return 'opened file';
        }
        const template = document.querySelector('[data-item="file-template"]');
        if (!template) return 'no template';
        template.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        if (template.getAttribute('aria-expanded') !== 'true') {
          template.click();
          return 'opened template';
        }
        const mla = document.querySelector('[data-command="new-mla"]');
        if (!mla) return 'no mla';
        if (mla.getAttribute('aria-disabled') === 'true') return 'mla disabled';
        mla.click();
        return 'clicked';
      })()`,
    );
    if (clickMla !== 'clicked') {
      await sleep(30);
    }
  }
  assert.equal(clickMla, 'clicked', clickMla);

  let dom = null;
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    dom = await evaluate(session.client, MLA_DOM);
    if (dom && dom.placeholders?.includes('Works Cited') && dom.activeTitle === 'Untitled 2') {
      break;
    }
    await sleep(40);
  }
  assert.ok(dom, 'MLA tab did not render');
  assert.equal(dom.view, 'pages');
  assert.equal(dom.activeTitle, 'Untitled 2');
  assert.ok(dom.tabCount >= 2);
  assert.match(dom.headerText, /Last Name/);
  assert.match(dom.headerText, /1/);
  assert.equal(dom.headerAlign, 'right');
  assert.equal(dom.headerLineSpacing, 'double');
  assert.equal(dom.textAlignRight, true);
  assert.equal(dom.documentDefaultLineSpacing, 'double');
  assert.equal(dom.canvasDefaultLineSpacing, 'double');
  assert.equal(dom.bodyLineSpacingAttr, null);
  for (const [label, ratio] of [
    ['name', dom.nameLineHeightRatio],
    ['title', dom.titleLineHeightRatio],
    ['body', dom.bodyLineHeightRatio],
    ['header', dom.headerLineHeightRatio],
  ]) {
    assert.ok(
      ratio !== null && ratio >= 1.95 && ratio <= 2.05,
      `${label} line-height ratio for double spacing: ${ratio}`,
    );
  }
  assert.equal(dom.bodyFirstIndent, '0.5');
  assert.equal(dom.worksHanging, '0.5');
  assert.match(dom.computedFontFamily, /Liberation Serif/i, dom.computedFontFamily);
  assert.ok(
    dom.computedFontSize === '16px' || dom.computedFontSize === '12pt',
    `font size ${dom.computedFontSize}`,
  );
  assert.deepEqual(dom.placeholders.slice(0, 4), ['Name', 'Instructor', 'Course', 'Date']);
  assert.equal(dom.placeholders[4], 'Title');
  assert.ok(dom.pageBreakCount >= 1);
  assert.equal(dom.placeholders[6], 'Works Cited');

  await finish();
});