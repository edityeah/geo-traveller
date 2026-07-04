import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trafficToNumber, classifyTrend, parseTrendsXml, trendMix } from './trends.ts';

test('trafficToNumber parses Google Trends figures', () => {
  assert.equal(trafficToNumber('1000+'), 1000);
  assert.equal(trafficToNumber('50,000+'), 50000);
  assert.equal(trafficToNumber('2K+'), 2000);
  assert.equal(trafficToNumber('1M+'), 1_000_000);
  assert.equal(trafficToNumber(''), 0);
});

test('classifyTrend routes travel/food/experience, rejects noise', () => {
  assert.equal(classifyTrend('Thailand visa on arrival rules').stream, 'news');
  assert.equal(classifyTrend('Thailand visa on arrival rules').relevant, true);
  assert.deepEqual(classifyTrend('best biryani in Hyderabad'), { relevant: true, stream: 'events', kind: 'food' });
  assert.deepEqual(classifyTrend('Coldplay concert Mumbai tickets'), { relevant: true, stream: 'events', kind: 'experience' });
  assert.equal(classifyTrend('Devson Catalyst IPO listing gain').relevant, false);
});

test('parseTrendsXml extracts term, traffic and grounded news', () => {
  const xml = `<?xml version="1.0"?><rss><channel><item>
    <title>Goa beaches</title>
    <ht:approx_traffic>20,000+</ht:approx_traffic>
    <ht:picture>https://x/y.jpg</ht:picture>
    <ht:news_item>
      <ht:news_item_title>Goa tourism hits record in December</ht:news_item_title>
      <ht:news_item_url>https://news.example/goa</ht:news_item_url>
      <ht:news_item_source>Example News</ht:news_item_source>
    </ht:news_item>
  </item></channel></rss>`;
  const [t] = parseTrendsXml(xml);
  assert.equal(t.term, 'Goa beaches');
  assert.equal(t.traffic, 20000);
  assert.equal(t.news[0].url, 'https://news.example/goa');
  assert.equal(t.news[0].source, 'Example News');
});

test('trendMix falls back when no trends, tilts with floors otherwise', () => {
  const fallback = { evergreen: 1, news: 4, events: 5 };
  assert.deepEqual(trendMix([], fallback), fallback);

  // Mostly food/experience trends → events gets more, but news never below floor 2.
  const trends = [
    { kind: 'food' }, { kind: 'food' }, { kind: 'experience' }, { kind: 'food' },
  ] as any;
  const mix = trendMix(trends, fallback);
  assert.equal(mix.evergreen, 1);
  assert.equal(mix.evergreen + mix.news + mix.events, 10);
  assert.ok(mix.news >= 2, 'news respects floor');
  assert.ok(mix.events >= mix.news, 'events tilted higher');
});
