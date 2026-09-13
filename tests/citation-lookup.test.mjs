import test from 'node:test';
import assert from 'node:assert/strict';
import { citationDestination, resolveCitingPapers } from '../dist/js/citation-lookup.js';

test('Crossref-only results have a DOI lookup destination; existing links remain direct', () => {
  assert.equal(citationDestination({doi:'10.1016/j.physleta.2026.131579',sources:['Crossref']}), './citations.html?doi=10.1016%2Fj.physleta.2026.131579');
  assert.equal(citationDestination({citationMetrics:[{citingUrl:'https://openalex.org/works?filter=referenced_works:W1'}]}), 'https://openalex.org/works?filter=referenced_works:W1');
  assert.equal(citationDestination({}), '');
});

test('citation DOI resolution validates identity, handles no match and errors', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({id:'https://openalex.org/W7135013769',doi:'https://doi.org/10.1016/j.physleta.2026.131579'});
    assert.equal(await resolveCitingPapers('10.1016/j.physleta.2026.131579'), 'https://openalex.org/works?filter=referenced_works:W7135013769');
    assert.equal(await resolveCitingPapers('10.1234/other'), null);
    globalThis.fetch = async () => new Response('',{status:404});
    assert.equal(await resolveCitingPapers('10.1234/missing'), null);
    globalThis.fetch = async () => new Response('',{status:429});
    await assert.rejects(resolveCitingPapers('10.1234/rate'), /rate limiting/);
    await assert.rejects(resolveCitingPapers('bad'), /valid DOI/);
  } finally { globalThis.fetch = original; }
});
