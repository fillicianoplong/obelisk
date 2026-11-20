import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from '../editor/load-renderer.mjs';

const shortcutsUrl = new URL('../../../src/renderer/shell/shortcuts.ts', import.meta.url);

test('Ctrl+F and Ctrl+H map to find and replace commands', async () => {
  const { editShellShortcut } = await loadRenderer(shortcutsUrl);
  assert.equal(editShellShortcut({ key: 'f', altKey: false, ctrlKey: true, metaKey: false, shiftKey: false, repeat: false }), 'edit-find');
  assert.equal(editShellShortcut({ key: 'h', altKey: false, ctrlKey: true, metaKey: false, shiftKey: false, repeat: false }), 'edit-replace');
  assert.equal(editShellShortcut({ key: 'f', altKey: false, ctrlKey: true, metaKey: false, shiftKey: true, repeat: false }), null);
});