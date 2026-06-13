import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseCategory, pickEvergreenTopic } from './planner.ts';
import type { SeedTopic } from './topics.ts';

const QUOTA = { evergreen: 5, news: 7 };

test('chooseCategory favors the under-quota category', () => {
  assert.equal(chooseCategory({ evergreen: 0, news: 5 }, QUOTA), 'evergreen');
  assert.equal(chooseCategory({ evergreen: 5, news: 0 }, QUOTA), 'news');
});

test('chooseCategory returns null when both quotas are met', () => {
  assert.equal(chooseCategory({ evergreen: 5, news: 7 }, QUOTA), null);
});

test('chooseCategory falls back to news when only evergreen is full', () => {
  assert.equal(chooseCategory({ evergreen: 5, news: 3 }, QUOTA), 'news');
});

test('pickEvergreenTopic skips already-covered keys', () => {
  const topics: SeedTopic[] = [
    { key: 'visa:japan:in', title: 'JP', brief: 'b', imageEntity: 'e', tags: [], searchHints: [] },
    { key: 'visa:uk:in', title: 'UK', brief: 'b', imageEntity: 'e', tags: [], searchHints: [] },
  ];
  const covered = new Set(['visa:japan:in']);
  assert.equal(pickEvergreenTopic(topics, covered)?.key, 'visa:uk:in');
});

test('pickEvergreenTopic returns null when all covered', () => {
  const topics: SeedTopic[] = [
    { key: 'visa:japan:in', title: 'JP', brief: 'b', imageEntity: 'e', tags: [], searchHints: [] },
  ];
  assert.equal(pickEvergreenTopic(topics, new Set(['visa:japan:in'])), null);
});
