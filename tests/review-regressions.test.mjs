import test from 'node:test';
import assert from 'node:assert/strict';
import { searchDirectSources } from '../dist/js/providers.js';
import { authorNameMatches } from '../dist/js/core.js';

test('compact initials match dotted initials without conflating full given names', () => {
  assert.equal(authorNameMatches('B.P. Abbott', 'BP Abbott'), true);
  assert.equal(authorNameMatches('BP Abbott', 'B. P. Abbott'), true);
  assert.equal(authorNameMatches('Brian Paul Abbott', 'BP Abbott'), true);
  assert.equal(authorNameMatches('Brian Abbott', 'Bob Abbott'), false);
});

test('Crossref can advance past an empty filtered batch to a joint paper', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const second = new URL(input).searchParams.get('offset') === '1';
    return Response.json({ message: { items: [{ title: [second ? 'Joint paper' : 'Single author'], author: [
      { given: 'Albert', family: 'Einstein' }, ...(second ? [{ given: 'Nathan', family: 'Rosen' }] : []),
    ] }], 'total-results': 2 } });
  };
  try {
    const options = { query: 'A. Einstein + N. Rosen', searchMode: 'author', limit: 1 };
    const first = await searchDirectSources({ ...options, continuation: { crossref: { offset: 0 } } });
    assert.equal(first.results.length, 0);
    assert.deepEqual(first.continuation.crossref, { offset: 1 });
    const second = await searchDirectSources({ ...options, continuation: first.continuation });
    assert.equal(second.results[0].title, 'Joint paper');
    assert.deepEqual(second.continuation, {});
  } finally { globalThis.fetch = original; }
});

test('INSPIRE advances page and rank, then stops at the end', async () => {
  const original = globalThis.fetch;
  const pages = [];
  globalThis.fetch = async input => {
    const page = Number(new URL(input).searchParams.get('page')); pages.push(page);
    return Response.json({ hits: { total: { value: 2, relation: 'eq' }, hits: [
      { id: page, metadata: { titles: [{ title: `Paper ${page}` }] } },
    ] } });
  };
  try {
    const first = await searchDirectSources({ query: 'quantum', limit: 1, continuation: { inspire: { offset: 0 } } });
    const second = await searchDirectSources({ query: 'quantum', limit: 1, continuation: first.continuation });
    assert.deepEqual(pages, [1, 2]);
    assert.equal(second.results[0].title, 'Paper 2');
    assert.ok(second.records[0].score < first.records[0].score);
    assert.deepEqual(second.continuation, {});
  } finally { globalThis.fetch = original; }
});

test('OpenAlex continuation survives local author filtering', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async input => new URL(input).pathname === '/authors'
    ? Response.json({ results: [{ id: 'https://openalex.org/A1', display_name: 'Albert Einstein' }] })
    : Response.json({ results: [{ title: 'Incomplete author metadata', authorships: [] }], meta: { next_cursor: 'next' } });
  try {
    const result = await searchDirectSources({ query: 'A. Einstein', searchMode: 'author', continuation: { openalex: { offset: 0, cursor: '*' } } });
    assert.equal(result.results.length, 0);
    assert.deepEqual(result.continuation.openalex, { cursor: 'next', offset: 1 });
  } finally { globalThis.fetch = original; }
});
