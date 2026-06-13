import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedTopics, type SeedTopic } from './topics.ts';

test('seed topics have unique canonical keys', () => {
  const keys = seedTopics().map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length, 'duplicate topic keys found');
});

test('every seed topic is fully specified', () => {
  for (const t of seedTopics()) {
    assert.ok(t.key && t.key.includes(':'), `bad key: ${t.key}`);
    assert.ok(t.title.length > 0, `missing title for ${t.key}`);
    assert.ok(t.brief.length > 0, `missing brief for ${t.key}`);
    assert.ok(t.coverQueries.length > 0, `missing coverQueries for ${t.key}`);
  }
});

test('includes the Japan visa guide', () => {
  assert.ok(seedTopics().some((t) => t.key === 'visa:japan:in'));
});
