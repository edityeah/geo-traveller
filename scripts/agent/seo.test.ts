import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seoScore, pickFocusKeyword } from './seo.ts';

test('pickFocusKeyword prefers declared, then a specific tag, then title', () => {
  assert.equal(pickFocusKeyword({ focusKeyword: 'Bali visa', tags: ['Travel'], title: 'X' }), 'Bali visa');
  assert.equal(pickFocusKeyword({ tags: ['guide', 'Bhutan'], title: 'X' }), 'Bhutan');
  assert.equal(pickFocusKeyword({ tags: ['guide'], title: 'The best street food' }), 'The best street food');
});

test('seoScore rewards a well-optimized post', () => {
  const filler = 'This section explains the process clearly with practical detail for the traveller planning the trip and what to expect at each stage. ';
  const body = [
    '## Thailand visa for Indians: the essentials',
    `Getting a Thailand visa for Indians is straightforward once you know the steps. ${filler.repeat(3)}`,
    '',
    '### Documents you need',
    `Bring your passport and photos. See our [Japan visa guide](/posts/japan-visa/) and [flight booking tips](/posts/flight-tips/). ${filler.repeat(3)}`,
    'Check the [official Thai embassy](https://thaiembassy.com) and [VFS Global](https://vfsglobal.com) pages before you apply.',
    '',
    '### Costs and timelines',
    `The visa usually processes within a few working days. ${filler.repeat(3)} A Thailand visa for Indians is easy to plan for.`,
  ].join('\n');
  const r = seoScore({ title: 'Thailand visa for Indians', body, focusKeyword: 'Thailand visa for Indians', minWords: 100 });
  assert.ok(r.score >= 80, `expected strong score, got ${r.score} (${r.issues.join('; ')})`);
});

test('seoScore flags a weak post', () => {
  const r = seoScore({ title: 'Some trip', body: 'A short paragraph with no headings, no links, and no keyword focus at all.', focusKeyword: 'Kerala backwaters', minWords: 500 });
  assert.ok(r.score < 70, `expected weak score, got ${r.score}`);
  assert.ok(r.issues.length >= 3);
});
