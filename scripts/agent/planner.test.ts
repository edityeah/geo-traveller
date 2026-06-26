import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseCategory, pickEvergreenTopic } from './planner.ts';
import type { SeedTopic } from './topics.ts';

const QUOTA = { evergreen: 5, news: 7, events: 5 };

test('chooseCategory favors the category furthest behind quota', () => {
  // all at 0 → news has the largest quota/remaining (7) → news
  assert.equal(chooseCategory({ evergreen: 0, news: 0, events: 0 }, QUOTA), 'news');
  // evergreen behind, news full → evergreen
  assert.equal(chooseCategory({ evergreen: 0, news: 7, events: 5 }, QUOTA), 'evergreen');
  // only events left → events
  assert.equal(chooseCategory({ evergreen: 5, news: 7, events: 2 }, QUOTA), 'events');
});

test('chooseCategory returns null when all quotas are met', () => {
  assert.equal(chooseCategory({ evergreen: 5, news: 7, events: 5 }, QUOTA), null);
});

test('chooseCategory ties resolve by priority (evergreen > news > events)', () => {
  // evergreen and events both 5 remaining; news 4 → evergreen wins the tie
  assert.equal(chooseCategory({ evergreen: 0, news: 3, events: 0 }, QUOTA), 'evergreen');
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
