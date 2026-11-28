import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MOTION_DURATION_MS,
  REDUCED_MOTION_QUERY,
  applyReducedMotion,
  durationMs,
  editorAnimatedImagePlays,
  readReducedMotion,
  scrollBehaviorOption,
} from '../../../dist/shared/reduced-motion.js';
import { installReducedMotion } from '../../../dist/preload/reduced-motion.js';

test('REDUCED_MOTION_QUERY matches the CSS media feature', () => {
  assert.equal(REDUCED_MOTION_QUERY, '(prefers-reduced-motion: reduce)');
});

test('readReducedMotion and applyReducedMotion track matchMedia', () => {
  let matches = false;
  const root = { dataset: {} };
  const win = {
    matchMedia(query) {
      assert.equal(query, REDUCED_MOTION_QUERY);
      return { matches };
    },
  };
  assert.equal(readReducedMotion(win), false);
  applyReducedMotion(root, false);
  assert.equal('reducedMotion' in root.dataset, false);

  matches = true;
  assert.equal(readReducedMotion(win), true);
  applyReducedMotion(root, true);
  assert.equal(root.dataset.reducedMotion, '');

  applyReducedMotion(root, false);
  assert.equal('reducedMotion' in root.dataset, false);
});

test('durationMs returns zero when motion is reduced', () => {
  assert.equal(durationMs('fast', false), MOTION_DURATION_MS.fast);
  assert.equal(durationMs('slow', true), 0);
});

test('scrollBehaviorOption never requests smooth scrolling', () => {
  assert.equal(scrollBehaviorOption(false), 'auto');
  assert.equal(scrollBehaviorOption(true), 'auto');
});

test('editorAnimatedImagePlays follows OD-18', () => {
  assert.equal(editorAnimatedImagePlays(1, false), false);
  assert.equal(editorAnimatedImagePlays(5, false), true);
  assert.equal(editorAnimatedImagePlays(5, true), false);
});

test('installReducedMotion applies data-reduced-motion before first paint', () => {
  const root = { dataset: {} };
  const listeners = new Map();
  const target = {
    documentElement: root,
    matchMedia(query) {
      assert.equal(query, REDUCED_MOTION_QUERY);
      return {
        matches: true,
        addEventListener(type, listener) {
          listeners.set(type, listener);
        },
        removeEventListener() {},
      };
    },
  };
  installReducedMotion(target);
  assert.equal(root.dataset.reducedMotion, '');
  assert.ok(listeners.has('change'));
});