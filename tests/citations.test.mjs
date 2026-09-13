import test from 'node:test';
import assert from 'node:assert/strict';
import { citationMetrics, citationLabels, dedupeResults } from '../dist/js/core.js';
import { searchDirectSources } from '../dist/js/providers.js';

test('citation provenance distinguishes zero from unknown and validates link identifiers', () => {
  assert.deepEqual(citationMetrics('Crossref', null), []);
  assert.deepEqual(citationMetrics('Crossref', undefined), []);
  assert.deepEqual(citationMetrics('Crossref', -1), []);
  assert.equal(citationMetrics('Crossref', 0)[0].count, 0);
  assert.equal(citationMetrics('OpenAlex', 1, 'https://openalex.org/W7135013769')[0].citingUrl,
    'https://openalex.org/works?filter=referenced_works:W7135013769');
  assert.equal(citationMetrics('OpenAlex', 1, 'https://other.example/W1')[0].citingUrl, '');
});

test('merging retains disagreements, avoids summing counts, and handles singular labels', () => {
  const record = (source, count) => ({ title: 'Paper', doi: '10.1234/test', sources: [source],
    citationCount: count, citationMetrics: citationMetrics(source, count, 'W1') });
  const [merged] = dedupeResults([record('OpenAlex', 1), record('Crossref', 0), record('OpenAlex', 1)]);
  assert.equal(merged.citationCount, 1);
  assert.equal(merged.citationMetrics.length, 2);
  assert.deepEqual(citationLabels(merged.citationMetrics), ['1 citation · OpenAlex', '0 citations · Crossref']);
  const [matching] = dedupeResults([record('OpenAlex', 1), record('Crossref', 1)]);
  assert.equal(matching.citationCount, 1);
  assert.deepEqual(citationLabels(matching.citationMetrics), ['1 citation · OpenAlex / Crossref']);
  assert.equal(dedupeResults([record('OpenAlex', 0), record('Crossref', 0)])[0].citationCount, 0);
});

test('direct DOI search maps source counts and preserves the citing-paper link after deduplication', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => Response.json(String(input).includes('openalex')
    ? { results: [{ id: 'https://openalex.org/W7135013769', title: 'Squeezed states', doi: '10.1016/j.physleta.2026.131579', cited_by_count: 1 }] }
    : { message: { title: ['Squeezed states'], DOI: '10.1016/j.physleta.2026.131579', 'is-referenced-by-count': 1 } });
  try {
    const { results } = await searchDirectSources({ query: '10.1016/j.physleta.2026.131579' });
    assert.equal(results.length, 1);
    assert.deepEqual(citationLabels(results[0].citationMetrics), ['1 citation · OpenAlex / Crossref']);
    assert.equal(results[0].citationMetrics.filter(m => m.citingUrl).length, 1);
  } finally { globalThis.fetch = original; }
});
