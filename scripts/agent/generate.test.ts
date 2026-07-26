import test from 'node:test';
import assert from 'node:assert/strict';
import { rankRelated, type ExistingPost } from './generate.ts';

const posts: ExistingPost[] = [
  { title: 'Japan visa guide for Indians', slug: 'japan-visa-guide', tags: ['Japan', 'Visa'], excerpt: 'Everything about the Japan tourist visa.' },
  { title: 'Best street food in Delhi', slug: 'delhi-street-food', tags: ['Food', 'Delhi'], excerpt: 'Chaat, parathas and more.' },
  { title: 'Kedarkantha winter trek itinerary', slug: 'kedarkantha-trek', tags: ['Trek', 'Uttarakhand'], excerpt: 'A budget winter trek.' },
  { title: 'Tokyo cherry blossom season', slug: 'tokyo-cherry-blossom', tags: ['Japan', 'Experiences'], excerpt: 'When and where to see sakura.' },
];

test('rankRelated puts topically-related posts first', () => {
  const ranked = rankRelated('Japan tourist visa rules change for Indian travellers', posts);
  assert.equal(ranked[0].slug, 'japan-visa-guide');
  // Both Japan posts should outrank the unrelated ones.
  const japanSlugs = ranked.slice(0, 2).map((p) => p.slug).sort();
  assert.deepEqual(japanSlugs, ['japan-visa-guide', 'tokyo-cherry-blossom']);
});

test('rankRelated respects the cap and handles empty input', () => {
  assert.equal(rankRelated('anything', posts, 2).length, 2);
  assert.deepEqual(rankRelated('anything', []), []);
});
