import test from 'node:test';
import assert from 'node:assert/strict';
import { citationSortCount, sortSearchResults, paginateResults } from '../dist/js/core.js';

test('citation sorting uses reported metrics, not stale aggregate counts', () => {
  const records = [
    {id:'unknown'},
    {id:'zero',citationMetrics:[{count:0}]},
    {id:'high',citationCount:1,citationMetrics:[{count:100},{count:15}]},
    {id:'medium',citationCount:999,citationMetrics:[{count:20}]},
    {id:'legacy',citationCount:5},
  ];
  const sorted = sortSearchResults(records,'citations');
  assert.deepEqual(sorted.map(r=>r.id),['high','medium','legacy','zero','unknown']);
  assert.equal(records[0].id,'unknown');
  assert.deepEqual(paginateResults(sorted,2,2).items.map(r=>r.id),['legacy','zero']);
});
test('citation sort handles missing and invalid values without NaN comparisons', () => {
  for (const value of [null, undefined, NaN, Infinity, -3]) assert.equal(citationSortCount({citationCount:value}),-1);
  assert.equal(citationSortCount({citationMetrics:[{count:10},{count:11}]}),11);
});
