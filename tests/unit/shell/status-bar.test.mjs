import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadRenderer } from '../editor/load-renderer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const modelUrl = new URL('../../../src/renderer/shell/statusbar/model.ts', import.meta.url);
const iconUrl = new URL('../../../src/renderer/shell/statusbar/SaveStateIcon.tsx', import.meta.url);
const itemUrl = new URL('../../../src/renderer/shell/statusbar/SaveStateItem.tsx', import.meta.url);
const barUrl = new URL('../../../src/renderer/shell/statusbar/StatusBar.tsx', import.meta.url);

const KNOWN_SAMPLE = 'Packed lunch, two pencils';

test('word and character counts for a known sample', async () => {
  const { characterCount, textCounts, wordCount } = await loadRenderer(modelUrl);
  assert.equal(wordCount(KNOWN_SAMPLE), 4);
  assert.equal(characterCount(KNOWN_SAMPLE), 25);
  assert.deepEqual(textCounts(KNOWN_SAMPLE), {
    words: 4,
    characters: 25,
    wordsLabel: '4 words',
    charactersLabel: '25 characters',
  });

  assert.equal(wordCount(''), 0);
  assert.equal(characterCount(''), 0);
  assert.equal(wordCount('   '), 0);
  assert.equal(characterCount('   '), 3);
  assert.equal(wordCount('a  b'), 2);
  assert.equal(characterCount('a  b'), 4);
  assert.equal(wordCount('Hello\nWorld'), 2);
  assert.equal(characterCount('Hello\nWorld'), 11);
  assert.equal(textCounts('word').wordsLabel, '1 word');
  assert.equal(textCounts('!').charactersLabel, '1 character');
  assert.equal(textCounts('').wordsLabel, '0 words');
  assert.equal(textCounts('').charactersLabel, '0 characters');
  assert.equal(textCounts('x'.repeat(1234)).charactersLabel, '1,234 characters');
});

test('each save state renders its own icon and text', async () => {
  const { AUTOSAVE_PAUSED_TOOLTIP, SAVE_STATES, SAVE_STATE_LABELS } = await loadRenderer(modelUrl);
  const { SaveStateIcon } = await loadRenderer(iconUrl);
  const { SaveStateItem } = await loadRenderer(itemUrl);
  const shapes = new Set();

  for (const state of SAVE_STATES) {
    const icon = renderToStaticMarkup(createElement(SaveStateIcon, { state }));
    const item = renderToStaticMarkup(createElement(SaveStateItem, { state }));
    assert.match(icon, new RegExp(`data-save-icon="${state}"`));
    assert.equal(item.includes(SAVE_STATE_LABELS[state]), true, state);
    assert.match(item, new RegExp(`data-save-state="${state}"`));
    shapes.add(icon.replace(/data-save-icon="[^"]+"/, ''));
    if (state === 'autosave-paused') {
      assert.equal(item.includes(AUTOSAVE_PAUSED_TOOLTIP), true);
      assert.match(item, /role="tooltip"/);
      assert.match(item, /Ctrl\+S/);
    } else {
      assert.equal(item.includes('role="tooltip"'), false);
    }
  }
  assert.equal(shapes.size, SAVE_STATES.length);
});

test('the status bar shows counts, placeholders, and the passed save state', async () => {
  const { StatusBar } = await loadRenderer(barUrl);
  const html = renderToStaticMarkup(createElement(StatusBar, {
    text: KNOWN_SAMPLE,
    saveState: 'not-saved',
  }));
  assert.match(html, /role="status"/);
  assert.match(html, /aria-label="Status bar"/);
  assert.match(html, /aria-live="off"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Page 1 of 1/);
  assert.match(html, /4 words/);
  assert.match(html, /25 characters/);
  assert.match(html, /Pages/);
  assert.match(html, /100%/);
  assert.match(html, /Not saved/);
  assert.match(html, /data-save-icon="not-saved"/);
  assert.match(html, /data-save-state="not-saved"/);
  assert.match(html, /Zoom 100%/);
});

test('save state follows the changed flag, and only a new label is announced', async () => {
  const {
    saveStateAnnouncement,
    saveStateFromChanged,
    tooltipDelay,
    nextViewLabel,
    SMALLEST_WINDOW_WIDTH,
  } = await loadRenderer(modelUrl);

  assert.equal(saveStateFromChanged(false), 'saved');
  assert.equal(saveStateFromChanged(true), 'unsaved');
  assert.equal(saveStateAnnouncement(null, 'Saved'), null);
  assert.equal(saveStateAnnouncement('Saved', 'Saved'), null);
  assert.equal(saveStateAnnouncement('Saved', 'Unsaved changes'), 'Unsaved changes');
  assert.equal(tooltipDelay('hover'), 500);
  assert.equal(tooltipDelay('keyboard'), 0);

  assert.deepEqual(nextViewLabel(SMALLEST_WINDOW_WIDTH, false, null, true), {
    show: false,
    overflowAt: null,
  });
  assert.deepEqual(nextViewLabel(SMALLEST_WINDOW_WIDTH + 1, false, null, true), {
    show: true,
    overflowAt: null,
  });
  assert.deepEqual(nextViewLabel(800, true, null, true), {
    show: false,
    overflowAt: 800,
  });
  assert.deepEqual(nextViewLabel(800, false, 800, false), {
    show: false,
    overflowAt: 800,
  });
  assert.deepEqual(nextViewLabel(900, false, 800, false), {
    show: true,
    overflowAt: null,
  });
});

test('status bar colours come from tokens', async () => {
  const css = await readFile(path.join(root, 'src/renderer/shell/shell.css'), 'utf8');
  const start = css.indexOf('.status-bar {');
  const end = css.indexOf('@media (forced-colors: active)');
  assert.ok(start !== -1 && end > start);
  const rules = css.slice(start, end);
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(rules), false);
  assert.match(rules, /\.status-bar \{[^}]*background:\s*var\(--color-surface-chrome\)/);
  assert.match(rules, /\.status-bar \{[^}]*color:\s*var\(--color-text-status\)/);
  assert.match(rules, /\.status-bar \{[^}]*font-size:\s*var\(--font-size-caption\)/);
  assert.match(rules, /\.status-bar \{[^}]*height:\s*var\(--size-statusbar\)/);
  assert.match(rules, /\.status-save\[data-save-state='saved'\] \{[^}]*color:\s*var\(--color-success\)/);
  assert.match(rules, /\.status-save\[data-save-state='autosave-paused'\] \{[^}]*color:\s*var\(--color-warning\)/);
  assert.match(rules, /\.status-bar:focus-visible,\s*\.status-save:focus-visible/);
});
