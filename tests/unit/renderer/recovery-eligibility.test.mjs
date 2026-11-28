import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from '../editor/load-renderer.mjs';

const eligibilityUrl = new URL('../../../src/renderer/autosave/eligibility.ts', import.meta.url);
const modelUrl = new URL('../../../src/renderer/shell/tabs/model.ts', import.meta.url);

test('recovery copies run only for dirty never-saved document tabs', async () => {
  const { recoveryEligible, autosaveEligible } = await loadRenderer(eligibilityUrl);
  const { createTab } = await loadRenderer(modelUrl);

  const fresh = createTab(1);
  assert.equal(recoveryEligible(fresh), false);
  assert.equal(autosaveEligible(fresh), false);

  const dirty = {
    ...fresh,
    baseDocument: { ...fresh.baseDocument, view: 'pageless' },
    savedView: 'pages',
  };
  assert.equal(recoveryEligible(dirty), true);
  assert.equal(autosaveEligible(dirty), false);

  const saved = { ...dirty, handle: 'ab'.repeat(16), stat: { size: 1, modifiedMs: 1 } };
  assert.equal(recoveryEligible(saved), false);
  assert.equal(autosaveEligible(saved), true);
});