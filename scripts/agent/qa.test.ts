import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deterministicChecks, bodyIsComplete } from './qa.ts';

const long = (tail: string) => Array.from({ length: 140 }, () => 'word').join(' ') + ' ' + tail;

test('bodyIsComplete: passes a finished article', () => {
  assert.equal(bodyIsComplete(long('That wraps up the guide.')).ok, true);
});
test('bodyIsComplete: fails a body cut off mid-sentence (no terminal punctuation)', () => {
  const r = bodyIsComplete(long('the best time to visit is'));
  assert.equal(r.ok, false);
});
test('bodyIsComplete: fails when it ends on a dangling connector', () => {
  assert.equal(bodyIsComplete(long('you should also consider the,')).ok, false);
  assert.equal(bodyIsComplete(long('here is what to pack and')).ok, false);
});
test('bodyIsComplete: fails when too short', () => {
  assert.equal(bodyIsComplete('Short and done.').ok, false);
});

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
