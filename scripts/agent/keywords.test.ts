import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAutocomplete, rankTopicsBySignal } from './keywords.ts';
import type { SeedTopic } from './topics.ts';

test('parseAutocomplete pulls suggestions from the Google JSON shape', () => {
  const raw = JSON.stringify(['japan visa', ['japan visa from india', 'japan visa cost', 'japan visa for indians']]);
  assert.deepEqual(parseAutocomplete(raw), [
    'japan visa from india',
    'japan visa cost',
    'japan visa for indians',
  ]);
});

test('parseAutocomplete tolerates junk', () => {
  assert.deepEqual(parseAutocomplete('not json'), []);
  assert.deepEqual(parseAutocomplete('[]'), []);
});

test('rankTopicsBySignal sorts higher-signal topics first, stable for ties', () => {
  const topics: SeedTopic[] = [
    { key: 'a', title: 'A', brief: '', imageEntity: '', tags: [], searchHints: ['alpha'] },
    { key: 'b', title: 'B', brief: '', imageEntity: '', tags: [], searchHints: ['beta'] },
  ];
  const signal = new Map<string, number>([['a', 0], ['b', 5]]);
  assert.deepEqual(rankTopicsBySignal(topics, signal).map((t) => t.key), ['b', 'a']);
});
