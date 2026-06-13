import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deterministicChecks } from './qa.ts';

test('flags leftover query: placeholders', () => {
  const issues = deterministicChecks({ title: 'Japan Visa Guide', body: 'text ![a](query:passport) more' });
  assert.ok(issues.some((i) => i.includes('placeholder')));
});

test('flags empty or junk links', () => {
  const issues = deterministicChecks({ title: 'T', body: 'see [here]() and [x](!#postLink!#)' });
  assert.ok(issues.some((i) => i.includes('link')));
});

test('clean post yields no deterministic issues', () => {
  const issues = deterministicChecks({ title: 'Japan Visa', body: 'Apply at the [embassy](https://www.in.emb-japan.go.jp/). Done.' });
  assert.deepEqual(issues, []);
});
