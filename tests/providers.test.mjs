import test from 'node:test';
import assert from 'node:assert/strict';
import { searchDirectSources } from '../dist/js/providers.js';

test('unsupported exact identifiers never trigger an unrelated text search', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('Must not fetch'); };
  try {
    for (const query of ['arXiv:1602.03837', 'CorpusId:123', 'PMID:123', '2016PhRvL.116f1102A']) {
      const data = await searchDirectSources({ query });
      assert.equal(data.results.length, 0);
      assert.equal(data.sources.filter((source) => source.state === 'skipped').length, 2);
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('DOI lookup uses exact endpoints, merges sources, and ignores subject restrictions', async () => {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input); urls.push(url);
    return Response.json(url.hostname === 'api.openalex.org'
      ? { results: [{ title: 'Matched paper', doi: 'https://doi.org/10.1234/paper' }] }
      : { message: { title: ['Matched paper'], DOI: '10.1234/paper' } });
  };
  try {
    const data = await searchDirectSources({ query: '10.1234/paper', subjectId: 'astro' });
    assert.equal(data.results.length, 1);
    assert.equal(data.results[0].sources.length, 2);
    assert.equal(urls[0].searchParams.get('filter'), 'doi:10.1234/paper');
    assert.match(urls[1].pathname, /works\/10.1234%2Fpaper$/);
  } finally { globalThis.fetch = original; }
});

test('missing DOI is an empty successful lookup, not a provider outage', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 404 });
  try {
    const data = await searchDirectSources({ query: '10.1234/missing' });
    assert.equal(data.results.length, 0);
    assert.equal(data.sources.filter((source) => source.state === 'success').length, 2);
  } finally { globalThis.fetch = original; }
});

test('canceled searches reject instead of returning misleading partial results', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_, { signal }) => { signal.throwIfAborted(); return Response.json({}); };
  try {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(searchDirectSources({ query: 'quantum', signal: controller.signal }), { name: 'AbortError' });
  } finally { globalThis.fetch = original; }
});

test('load more uses provider continuation and preserves global relevance rank', async () => {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input); urls.push(url);
    if (url.hostname === 'api.openalex.org') {
      const second = url.searchParams.get('cursor') === 'next-token';
      return Response.json({results:[{id:second?'W2':'W1', title:second?'Second OA':'First OA'}],meta:{next_cursor:second?null:'next-token'}});
    }
    const second = url.searchParams.get('offset') === '1';
    return Response.json({message:{items:[{title:[second?'Second CR':'First CR'],DOI:second?'10.1234/two':'10.1234/one'}],'total-results':2}});
  };
  try {
    const first = await searchDirectSources({query:'composite bosons',limit:1});
    const second = await searchDirectSources({query:'composite bosons',limit:1,continuation:first.continuation});
    assert.equal(urls[2].searchParams.get('cursor'),'next-token');
    assert.equal(urls[3].searchParams.get('offset'),'1');
    assert.equal(Object.keys(second.continuation).length,0);
    assert.ok(second.records[0].score < first.records[0].score);
  } finally { globalThis.fetch = original; }
});

test('failed batches retain their continuation for retry while other sources advance', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => String(input).includes('openalex')
    ? new Response('',{status:429})
    : Response.json({message:{items:[{title:['Paper'],DOI:'10.1234/test'}],'total-results':100}});
  try {
    const data = await searchDirectSources({query:'composite bosons',continuation:{openalex:{cursor:'retry-token',offset:50},crossref:{offset:50}}});
    assert.deepEqual(data.continuation.openalex,{cursor:'retry-token',offset:50});
    assert.equal(data.continuation.crossref.offset,51);
    assert.equal(data.results.length,1);
  } finally { globalThis.fetch = original; }
});
