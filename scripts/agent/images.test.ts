import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVisionChoice } from './images.ts';

test('parseVisionChoice reads a bare number', () => {
  assert.equal(parseVisionChoice('3', 6), 3);
  assert.equal(parseVisionChoice('Image 2', 6), 2);
  assert.equal(parseVisionChoice(' 1 ', 6), 1);
});

test('parseVisionChoice returns null for "none"', () => {
  assert.equal(parseVisionChoice('none', 6), null);
  assert.equal(parseVisionChoice('None of these fit', 6), null);
  assert.equal(parseVisionChoice('', 6), null);
});

test('parseVisionChoice rejects out-of-range numbers', () => {
  assert.equal(parseVisionChoice('9', 6), null);
  assert.equal(parseVisionChoice('0', 6), null);
});
