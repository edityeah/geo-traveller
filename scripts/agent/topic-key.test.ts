import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalKey, slugWord } from './topic-key.ts';

test('slugWord normalizes', () => {
  assert.equal(slugWord('Japan'), 'japan');
  assert.equal(slugWord('United States'), 'united-states');
  assert.equal(slugWord('  Côte d’Ivoire '), 'cote-d-ivoire');
});

test('canonicalKey joins parts with colons', () => {
  assert.equal(canonicalKey(['visa', 'Japan', 'IN']), 'visa:japan:in');
  assert.equal(canonicalKey(['mobility', 'Middle East', 'flights']), 'mobility:middle-east:flights');
});

test('canonicalKey drops empty parts', () => {
  assert.equal(canonicalKey(['visa', '', 'japan']), 'visa:japan');
});
