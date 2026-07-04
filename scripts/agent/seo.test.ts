import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seoScore, pickFocusKeyword } from './seo.ts';

test('pickFocusKeyword prefers declared, then a specific tag, then title', () => {
  assert.equal(pickFocusKeyword({ focusKeyword: 'Bali visa', tags: ['Travel'], title: 'X' }), 'Bali visa');
  assert.equal(pickFocusKeyword({ tags: ['guide', 'Bhutan'], title: 'X' }), 'Bhutan');
  assert.equal(pickFocusKeyword({ tags: ['guide'], title: 'The best street food' }), 'The best street food');
});

test('seoScore rewards a well-optimized post', () => {
  const body = [
    '## Thailand visa for Indians: the essentials',
    'Getting a Thailand visa for Indians is straightforward. This guide covers the Thailand visa for Indians step by step.',
    '',
    '### Documents you need',
    'Bring your passport. See our [Japan visa guide](/posts/japan-visa/) and [flight tips](/posts/flight-tips/).',
    'Check the [official Thai embassy](https://thaiembassy.com) and [VFS](https://vfsglobal.com) sites.',
    '',
    '### Costs and timelines',
    'Fees are modest. The Thailand visa for Indians usually processes in days.',
  ].join('\n');
  const r = seoScore({ title: 'Thailand visa for Indians', body, focusKeyword: 'Thailand visa for Indians', minWords: 30 });
  assert.ok(r.score >= 80, `expected strong score, got ${r.score} (${r.issues.join('; ')})`);
});

test('seoScore flags a weak post', () => {
  const r = seoScore({ title: 'Some trip', body: 'A short paragraph with no headings, no links, and no keyword focus at all.', focusKeyword: 'Kerala backwaters', minWords: 500 });
  assert.ok(r.score < 70, `expected weak score, got ${r.score}`);
  assert.ok(r.issues.length >= 3);
});
