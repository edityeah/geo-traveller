import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstHit, type ImageSource } from './images.ts';

test('firstHit returns the first source that yields a url', async () => {
  const sources: ImageSource[] = [
    { name: 'a', get: async () => undefined },
    { name: 'b', get: async () => 'https://img/b.jpg' },
    { name: 'c', get: async () => 'https://img/c.jpg' },
  ];
  assert.deepEqual(await firstHit(sources), { url: 'https://img/b.jpg', source: 'b' });
});

test('firstHit returns none when all empty', async () => {
  const sources: ImageSource[] = [{ name: 'a', get: async () => undefined }];
  assert.deepEqual(await firstHit(sources), { url: undefined, source: 'none' });
});

test('firstHit skips a throwing source', async () => {
  const sources: ImageSource[] = [
    { name: 'a', get: async () => { throw new Error('boom'); } },
    { name: 'b', get: async () => 'https://img/b.jpg' },
  ];
  assert.deepEqual(await firstHit(sources), { url: 'https://img/b.jpg', source: 'b' });
});
