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

const READ_TABS = `(() => {
  const strip = document.querySelector('[data-region="tab-strip"]');
  const list = document.querySelector('[role="tablist"]');
  const editor = document.querySelector('[data-region="page-editor"]');
  if (document.documentElement.dataset.shellCommands !== 'ready') {
    return null;
  }
  if (!strip || !list || !editor || !editor.editorCommands) {
    return null;
  }
  const paragraphs = [...editor.querySelectorAll(':scope > p')];
  if (editor.getAttribute('contenteditable') !== 'true' || paragraphs.length === 0) {
    return null;
  }
  const tabs = [...list.querySelectorAll('[role="tab"]')].map((tab) => {
    const mark = tab.querySelector('.tab-unsaved');
    const close = tab.querySelector('[aria-label="Close tab"]');
    const markStyle = mark ? getComputedStyle(mark) : null;
    const closeStyle = close ? getComputedStyle(close) : null;
    return {
      id: tab.getAttribute('data-tab-id'),
      title: tab.getAttribute('data-title'),
      name: tab.getAttribute('aria-label'),
      selected: tab.getAttribute('aria-selected') === 'true',
      unsaved: tab.getAttribute('data-unsaved') === 'true',
      markDisplay: markStyle ? markStyle.display : null,
      markWidth: markStyle ? markStyle.width : null,
      markHeight: markStyle ? markStyle.height : null,
      markRadius: markStyle ? markStyle.borderRadius : null,
      closeDisplay: closeStyle ? closeStyle.display : null,
      closeName: close ? close.getAttribute('aria-label') : null,
    };
  });
  const stripStyle = getComputedStyle(strip);
  const tabStyle = tabs.length > 0 ? getComputedStyle(list.querySelector('[role="tab"]')) : null;
  const active = list.querySelector('[role="tab"][aria-selected="true"]');
  const last = list.querySelector('[role="tab"]:last-child');
  const listRect = list.getBoundingClientRect();
  const stripRect = strip.getBoundingClientRect();
  const activeRect = active ? active.getBoundingClientRect() : null;
  const lastRect = last ? last.getBoundingClientRect() : null;
  const newTab = document.querySelector('[aria-label="New tab"]');
  const newRect = newTab ? newTab.getBoundingClientRect() : null;
  const closeButton = active ? active.querySelector('.tab-close') : null;
  const closeButtonRect = closeButton ? closeButton.getBoundingClientRect() : null;
  const closeIcon = document.querySelector('.tab-close .tab-glyph');
  const newIcon = document.querySelector('.tab-new .tab-glyph');
  const closeIconRect = closeIcon ? closeIcon.getBoundingClientRect() : null;
  const newIconRect = newIcon ? newIcon.getBoundingClientRect() : null;
  const newStyle = newTab ? getComputedStyle(newTab) : null;
  const tabGap = parseFloat(getComputedStyle(list).columnGap);
  return {
    tabs,
    text: paragraphs.map((block) => (block.textContent || '').replace(/\\u200b/g, '')).join('\\n'),
    stripHeight: stripStyle.height,
    tabMin: tabStyle ? tabStyle.minWidth : null,
    tabMax: tabStyle ? tabStyle.maxWidth : null,
    listLabel: list.getAttribute('aria-label'),
    orientation: list.getAttribute('aria-orientation'),
    newTabInsideList: newTab ? list.contains(newTab) : null,
    closeIconWidth: closeIconRect ? closeIconRect.width : null,
    closeIconHeight: closeIconRect ? closeIconRect.height : null,
    newIconWidth: newIconRect ? newIconRect.width : null,
    newIconHeight: newIconRect ? newIconRect.height : null,
    tabGap,
    stripGap: parseFloat(stripStyle.columnGap),
    tabPaddingLeft: tabStyle ? parseFloat(tabStyle.paddingLeft) : null,
    tabPaddingRight: tabStyle ? parseFloat(tabStyle.paddingRight) : null,
    closeRightInset: closeButtonRect && activeRect ? activeRect.right - closeButtonRect.right : null,
    closeCenterDelta: closeButtonRect && activeRect
      ? (closeButtonRect.top + closeButtonRect.bottom) / 2 - (activeRect.top + activeRect.bottom) / 2
      : null,
    newTabTopInset: newRect && lastRect ? newRect.top - lastRect.top : null,
    newTabBottomInset: newRect && lastRect ? lastRect.bottom - newRect.bottom : null,
    newTabWidth: newRect ? newRect.width : null,
    newTabHeight: newRect ? newRect.height : null,
    newRadiusTop: newStyle ? parseFloat(newStyle.borderTopLeftRadius) : null,
    newRadiusBottom: newStyle ? parseFloat(newStyle.borderBottomLeftRadius) : null,
    newTabGap: newRect && lastRect ? newRect.left - lastRect.right : null,
    newTabLeft: newRect ? newRect.left : null,
    newTabRightInset: newRect ? stripRect.right - newRect.right : null,
    stripPaddingRight: parseFloat(stripStyle.paddingRight),
    newTabInsideStrip: newRect
      ? newRect.left >= stripRect.left - 1 &&
        newRect.right <= stripRect.right + 1 &&
        newRect.top >= stripRect.top - 1 &&
        newRect.bottom <= stripRect.bottom + 1
      : false,
    newTabClearsTabs: newRect ? newRect.left >= listRect.right - 1 : false,
    scrollWidth: list.scrollWidth,
    clientWidth: list.clientWidth,
    scrollLeft: list.scrollLeft,
    activeInView: activeRect
      ? activeRect.left >= listRect.left - 1 && activeRect.right <= listRect.right + 1
      : false,
    focusedId: document.activeElement ? document.activeElement.getAttribute('data-tab-id') : null,
    closePrompt: strip.getAttribute('data-close-prompt'),
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

async function launchStrip(session, port) {
  const binary = electronBinary();
  const args = ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${session.userDataDir}`];
  session.child = await launchWithSandboxFallback({
    binary,
    args,
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
          const state = await evaluate(session.client, READ_TABS);
          return state ? state : null;
        },
        20_000,
      );
    },
  });
}

async function readTabs(port, session) {
  const url = await pageTarget(port);
  if (!url) {
    return null;
  }
  if (!session.client || session.client.url !== url) {
    session.client?.close();
    session.client = openCdp(url);
  }
  return evaluate(session.client, READ_TABS);
}

async function waitForTabs(port, session, predicate, label) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    last = await readTabs(port, session);
    if (last && predicate(last)) {
      return last;
    }
    await sleep(30);
  }
  throw new Error(`${label} did not match within ${STEP_TIMEOUT_MS} ms: ${JSON.stringify(last)}`);
}

async function runInPage(session, body) {
  const result = await evaluate(
    session.client,
    `(() => {
      ${body}
      return 'ok';
    })()`,
  );
  assert.equal(result, 'ok', result);
}

function tabById(state, id) {
  return state.tabs.find((tab) => tab.id === id);
}

test('an edited tab shows the unsaved mark and Narrator name', { timeout: 60_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-tab-strip-'));
  const port = await freePort();
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);

  try {
    await launchStrip(session, port);
    let state = await waitForTabs(
      port,
      session,
      (current) => current.tabs.length === 1 && current.tabs[0].name === 'Untitled 1',
      'first tab',
    );
    assert.equal(state.listLabel, 'Tabs');
    assert.equal(state.orientation, 'horizontal');
    assert.equal(state.newTabInsideList, false);
    assert.ok(Math.abs(state.closeIconWidth - 8) <= 0.5, `close icon width ${state.closeIconWidth}`);
    assert.ok(Math.abs(state.closeIconHeight - 8) <= 0.5, `close icon height ${state.closeIconHeight}`);
    assert.ok(Math.abs(state.newIconWidth - 10) <= 0.5, `new-tab icon width ${state.newIconWidth}`);
    assert.ok(Math.abs(state.newIconHeight - 10) <= 0.5, `new-tab icon height ${state.newIconHeight}`);
    assert.ok(Math.abs(state.newTabWidth - 32) <= 0.5, `new-tab button width ${state.newTabWidth}`);
    assert.ok(Math.abs(state.newTabHeight - 32) <= 0.5, `new-tab button height ${state.newTabHeight}`);
    assert.equal(state.newRadiusTop, 6);
    assert.equal(state.newRadiusBottom, 0);
    assert.equal(state.tabPaddingLeft, 12);
    assert.equal(state.tabPaddingRight, 4);
    assert.equal(state.stripGap, 2);
    assert.equal(state.stripGap, state.tabGap);
    assert.ok(Math.abs(state.newTabGap - state.tabGap) <= 1, `the new-tab button follows the tab by ${state.newTabGap}px`);
    assert.ok(Math.abs(state.newTabTopInset) <= 1, `new-tab top inset ${state.newTabTopInset}`);
    assert.ok(Math.abs(state.newTabBottomInset) <= 1, `new-tab bottom inset ${state.newTabBottomInset}`);
    assert.ok(Math.abs(state.closeRightInset - 4) <= 1, `close button inset ${state.closeRightInset}`);
    assert.ok(Math.abs(state.closeCenterDelta) <= 1, `close button vertical offset ${state.closeCenterDelta}`);
    assert.ok(
      state.newTabRightInset > state.stripPaddingRight + 32,
      `with one tab the new-tab button is ${state.newTabRightInset}px in from the strip edge`,
    );
    const oneTabButton = state.newTabLeft;
    assert.equal(state.stripHeight, '40px');
    assert.equal(state.tabMin, '96px');
    assert.equal(state.tabMax, '220px');
    const fittedWheel = await evaluate(
      session.client,
      `(() => {
        const list = document.querySelector('[role="tablist"]');
        const strip = document.querySelector('[data-region="tab-strip"]');
        const before = list.scrollLeft;
        const event = new WheelEvent('wheel', { deltaX: 40, deltaY: 160, bubbles: true, cancelable: true });
        strip.dispatchEvent(event);
        return {
          overflow: list.scrollWidth > list.clientWidth,
          scrollLeft: list.scrollLeft,
          before,
          defaultPrevented: event.defaultPrevented,
        };
      })()`,
    );
    assert.equal(fittedWheel.overflow, false);
    assert.equal(fittedWheel.defaultPrevented, false);
    assert.equal(fittedWheel.scrollLeft, fittedWheel.before);
    assert.equal(state.tabs[0].unsaved, false);
    assert.equal(state.tabs[0].markDisplay, 'none');
    assert.equal(state.tabs[0].closeDisplay, 'flex');
    assert.equal(state.tabs[0].closeName, 'Close tab');

    await runInPage(session, `document.querySelector('[data-region="page-editor"]').editorCommands.replaceText('Field notes');`);
    state = await waitForTabs(
      port,
      session,
      (current) => tabById(current, 'untitled-1')?.name === 'Untitled 1, Unsaved changes',
      'unsaved name',
    );
    const edited = tabById(state, 'untitled-1');
    assert.equal(edited.unsaved, true);
    assert.equal(edited.name.endsWith('Unsaved changes'), true);
    assert.equal(edited.markDisplay, 'block');
    assert.notEqual(edited.markWidth, '0px');
    assert.notEqual(edited.markHeight, '0px');
    assert.equal(edited.closeDisplay, 'none');
    assert.ok(parseFloat(edited.markRadius) >= 8, edited.markRadius);

    await session.client.send('DOM.enable');
    await session.client.send('CSS.enable');
    const documentNode = await session.client.send('DOM.getDocument', { depth: 0 });
    const found = await session.client.send('DOM.querySelector', {
      nodeId: documentNode.root.nodeId,
      selector: '[data-tab-id="untitled-1"]',
    });
    await session.client.send('CSS.forcePseudoState', {
      nodeId: found.nodeId,
      forcedPseudoClasses: ['hover'],
    });
    state = await waitForTabs(
      port,
      session,
      (current) => {
        const tab = tabById(current, 'untitled-1');
        return tab && tab.closeDisplay === 'flex' && tab.markDisplay === 'none';
      },
      'hover shows the close button in place of the dot',
    );
    assert.equal(tabById(state, 'untitled-1').closeName, 'Close tab');
    await session.client.send('CSS.forcePseudoState', {
      nodeId: found.nodeId,
      forcedPseudoClasses: [],
    });
    await waitForTabs(
      port,
      session,
      (current) => tabById(current, 'untitled-1')?.markDisplay === 'block',
      'dot returns after hover',
    );

    await runInPage(session, `document.querySelector('[aria-label="New tab"]').click();`);
    state = await waitForTabs(
      port,
      session,
      (current) => current.tabs.length === 2 && current.tabs[1].selected && current.tabs[1].name === 'Untitled 2',
      'second tab',
    );
    assert.equal(tabById(state, 'untitled-1').name, 'Untitled 1, Unsaved changes');
    assert.equal(tabById(state, 'untitled-1').unsaved, true);
    assert.equal(tabById(state, 'untitled-2').unsaved, false);
    assert.equal(tabById(state, 'untitled-2').name.endsWith('Unsaved changes'), false);
    assert.equal(state.text, '');

    await runInPage(session, `document.querySelector('[aria-label="New tab"]').click();`);
    state = await waitForTabs(
      port,
      session,
      (current) => current.tabs.length === 3 && tabById(current, 'untitled-3')?.selected,
      'third tab',
    );
    assert.ok(
      state.newTabLeft > oneTabButton + 48,
      `the new-tab button moved from ${oneTabButton} to ${state.newTabLeft} after two tabs were added`,
    );
    assert.ok(Math.abs(state.newTabGap - state.tabGap) <= 1, `three-tab gap ${state.newTabGap}`);
    const threeTabButton = state.newTabLeft;

    await runInPage(
      session,
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true, cancelable: true }));`,
    );
    state = await waitForTabs(
      port,
      session,
      (current) => tabById(current, 'untitled-1')?.selected && current.focusedId === 'untitled-1',
      'Ctrl+Tab wraps to the first tab',
    );
    assert.equal(state.text, 'Field notes');

    await runInPage(
      session,
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true, cancelable: true }));`,
    );
    await waitForTabs(
      port,
      session,
      (current) => tabById(current, 'untitled-2')?.selected && current.focusedId === 'untitled-2',
      'Ctrl+Tab moves to the next tab',
    );

    await runInPage(
      session,
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));`,
    );
    await waitForTabs(
      port,
      session,
      (current) => tabById(current, 'untitled-1')?.selected && current.focusedId === 'untitled-1',
      'Ctrl+Shift+Tab moves to the previous tab',
    );

    await runInPage(
      session,
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));`,
    );
    state = await waitForTabs(
      port,
      session,
      (current) => tabById(current, 'untitled-3')?.selected && current.focusedId === 'untitled-3',
      'Ctrl+Shift+Tab wraps to the last tab',
    );

    await runInPage(
      session,
      `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));`,
    );
    state = await waitForTabs(
      port,
      session,
      (current) => current.focusedId === 'untitled-2' && tabById(current, 'untitled-3')?.selected,
      'Left moves focus without activating',
    );

    await runInPage(
      session,
      `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));`,
    );
    await waitForTabs(
      port,
      session,
      (current) => current.focusedId === 'untitled-1' && tabById(current, 'untitled-3')?.selected,
      'Home moves focus to the first tab',
    );

    await runInPage(
      session,
      `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));`,
    );
    await waitForTabs(
      port,
      session,
      (current) => current.focusedId === 'untitled-3' && tabById(current, 'untitled-3')?.selected,
      'End moves focus to the last tab',
    );

    await runInPage(
      session,
      `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));`,
    );
    await waitForTabs(port, session, (current) => current.focusedId === 'untitled-2', 'Left again');
    await runInPage(
      session,
      `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));`,
    );
    await waitForTabs(
      port,
      session,
      (current) => tabById(current, 'untitled-2')?.selected,
      'Enter activates the focused tab',
    );

    await runInPage(
      session,
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true }));`,
    );
    state = await waitForTabs(
      port,
      session,
      (current) => current.tabs.length === 2 && tabById(current, 'untitled-3')?.selected && !tabById(current, 'untitled-2'),
      'Ctrl+W closes an unchanged tab and activates the tab on the right',
    );
    assert.equal(tabById(state, 'untitled-1').unsaved, true);

    await runInPage(
      session,
      `document.querySelector('[data-tab-id="untitled-3"] [aria-label="Close tab"]').click();`,
    );
    state = await waitForTabs(
      port,
      session,
      (current) => current.tabs.length === 1 && tabById(current, 'untitled-1')?.selected,
      'the close button closes the tab on the end and activates the tab on the left',
    );
    assert.equal(state.tabs[0].name, 'Untitled 1, Unsaved changes');
    assert.ok(
      state.newTabLeft < threeTabButton - 48,
      `the new-tab button moved from ${threeTabButton} to ${state.newTabLeft} after tabs were closed`,
    );

    await runInPage(
      session,
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true }));`,
    );
    state = await waitForTabs(
      port,
      session,
      (current) => current.closePrompt === 'untitled-1' && current.tabs.length === 1,
      'Ctrl+W on a changed tab asks for the close prompt',
    );
    assert.equal(state.tabs[0].name, 'Untitled 1, Unsaved changes');
    assert.equal(state.text, 'Field notes');

    await runInPage(
      session,
      `for (let count = 0; count < 14; count += 1) {
        document.querySelector('[aria-label="New tab"]').click();
      }`,
    );
    state = await waitForTabs(
      port,
      session,
      (current) => current.tabs.length === 15 && current.scrollWidth > current.clientWidth && current.activeInView,
      'tabs shrink and the strip scrolls the active tab into view',
    );
    assert.ok(state.scrollWidth > state.clientWidth);
    assert.equal(state.activeInView, true);
    assert.equal(state.newTabInsideStrip, true);
    assert.equal(state.newTabClearsTabs, true);
    assert.ok(
      state.newTabRightInset <= state.stripPaddingRight + 2,
      `the new-tab button stays at the strip edge, ${state.newTabRightInset}px in`,
    );
    const pinnedLeft = state.newTabLeft;
    // The strip scrolls the active tab back into view on a later frame. Read the
    // row in the same turn that moves it, before that scroll replaces scrollLeft.
    const scrolled = await evaluate(
      session.client,
      `(() => {
        const list = document.querySelector('[role="tablist"]');
        const strip = document.querySelector('[data-region="tab-strip"]');
        const button = document.querySelector('[aria-label="New tab"]');
        const before = list.scrollLeft;
        list.scrollLeft = 0;
        const buttonRect = button.getBoundingClientRect();
        const stripRect = strip.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        return {
          before,
          scrollLeft: list.scrollLeft,
          newTabLeft: buttonRect.left,
          newTabInsideStrip:
            buttonRect.left >= stripRect.left - 1 &&
            buttonRect.right <= stripRect.right + 1 &&
            buttonRect.top >= stripRect.top - 1 &&
            buttonRect.bottom <= stripRect.bottom + 1,
          newTabClearsTabs: buttonRect.left >= listRect.right - 1,
        };
      })()`,
    );
    assert.ok(scrolled.before > 0, `the tab row was already at ${scrolled.before}`);
    assert.equal(
      scrolled.scrollLeft,
      0,
      `scrolling the tabs leaves the new-tab button in the strip, row at ${scrolled.scrollLeft}`,
    );
    assert.equal(scrolled.newTabInsideStrip, true);
    assert.equal(scrolled.newTabClearsTabs, true);
    assert.ok(
      Math.abs(scrolled.newTabLeft - pinnedLeft) <= 1,
      `the new-tab button moved from ${pinnedLeft} to ${scrolled.newTabLeft} when the strip scrolled`,
    );
    const widths = await evaluate(
      session.client,
      `(() => [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.getBoundingClientRect().width))()`,
    );
    for (const width of widths) {
      assert.ok(width >= 95 && width <= 221, `tab width ${width}`);
    }
    const wheeled = await evaluate(
      session.client,
      `(() => {
        const list = document.querySelector('[role="tablist"]');
        const strip = document.querySelector('[data-region="tab-strip"]');
        list.scrollLeft = 0;
        const origin = list.scrollLeft;
        const vertical = new WheelEvent('wheel', { deltaX: 0, deltaY: 80, bubbles: true, cancelable: true });
        strip.dispatchEvent(vertical);
        const afterVertical = list.scrollLeft;
        const horizontal = new WheelEvent('wheel', { deltaX: 40, deltaY: 0, bubbles: true, cancelable: true });
        strip.dispatchEvent(horizontal);
        const newTab = document.querySelector('[aria-label="New tab"]');
        return {
          overflow: list.scrollWidth > list.clientWidth,
          origin,
          afterVertical,
          scrollLeft: list.scrollLeft,
          verticalPrevented: vertical.defaultPrevented,
          horizontalPrevented: horizontal.defaultPrevented,
          newTabLeft: newTab.getBoundingClientRect().left,
        };
      })()`,
    );
    assert.equal(wheeled.overflow, true);
    assert.equal(wheeled.verticalPrevented, true);
    assert.equal(wheeled.horizontalPrevented, true);
    assert.ok(
      Math.abs(wheeled.afterVertical - wheeled.origin - 80) < 1,
      `a vertical wheel moved the row from ${wheeled.origin} to ${wheeled.afterVertical}`,
    );
    assert.ok(
      Math.abs(wheeled.scrollLeft - wheeled.afterVertical - 40) < 1,
      `a sideways wheel moved the row from ${wheeled.afterVertical} to ${wheeled.scrollLeft}`,
    );
    assert.ok(
      Math.abs(wheeled.newTabLeft - pinnedLeft) <= 1,
      `the new-tab button moved from ${pinnedLeft} to ${wheeled.newTabLeft} when the wheel scrolled the tabs`,
    );
  } finally {
    await finish();
  }
});
