import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchGuide, type GuideRef } from './refresh.ts';

const guides: GuideRef[] = [
  { pageId: '1', key: 'visa:japan:in', title: 'How to Apply for a Japan Visa from India', slug: 'japan-visa-from-india' },
  { pageId: '2', key: 'visa:uk:in', title: 'How to Apply for a UK Visa from India', slug: 'uk-visa-from-india' },
];

test('matchGuide matches on country + visa tokens', () => {
  const g = matchGuide('Japan raises visa fees for Indian tourists', 'New fee structure for Japan visa', guides);
  assert.equal(g?.key, 'visa:japan:in');
});

test('matchGuide returns null for unrelated news', () => {
  assert.equal(matchGuide('New beach resort opens in Goa', 'Luxury stay', guides), null);
});

test('matchGuide does not match UK guide for Japan news', () => {
  const g = matchGuide('Japan visa fee change', '', guides);
  assert.notEqual(g?.key, 'visa:uk:in');
});
