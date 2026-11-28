import assert from 'node:assert/strict';
import test from 'node:test';

const formatUrl = new URL('../../../src/shared/date-time/format.ts', import.meta.url);

test('date formats match the SRS reference examples', async () => {
  const { formatDateTime } = await import(formatUrl.href);
  const sample = '2027-03-04T21:05';
  assert.equal(formatDateTime(sample, 'windows-short'), '3/4/2027');
  assert.equal(formatDateTime(sample, 'windows-long'), 'Thursday, March 4, 2027');
  assert.equal(formatDateTime(sample, 'month-day-year'), 'March 4, 2027');
  assert.equal(formatDateTime(sample, 'day-month-year'), '4 March 2027');
  assert.equal(formatDateTime(sample, 'iso-date'), '2027-03-04');
  assert.equal(formatDateTime(sample, 'short-date-time'), '3/4/2027 9:05 PM');
  assert.equal(formatDateTime(sample, 'time'), '9:05 PM');
});

test('stored date and time values stay fixed when formatted', async () => {
  const { formatDateTime } = await import(formatUrl.href);
  const stored = '2026-01-15T08:30';
  assert.equal(formatDateTime(stored, 'iso-date'), '2026-01-15');
  assert.equal(formatDateTime(stored, 'time'), '8:30 AM');
});