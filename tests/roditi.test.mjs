import test from 'node:test';
import assert from 'node:assert/strict';
import {authorNameMatches, resolveSearchMode} from '../dist/js/core.js';
import {searchDirectSources} from '../dist/js/providers.js';

test('Roditi search requires first initial and complete surname', () => {
  for (const name of ['I. Roditi', 'Itzhak Roditi', 'Roditi, Itzhak']) assert.equal(authorNameMatches('I Roditi', name), true);
  for (const name of ['David Roditi', 'Roditi, David', 'Claudio Roditi', 'Roditi, Claudio', 'David I. Roditi', 'Itzhak R.']) assert.equal(authorNameMatches('I Roditi', name), false);
  assert.equal(authorNameMatches('B.P. Abbott', 'BP Abbott'), true);
});

test('automatic mode recognizes initial names and respects explicit modes', () => {
  for (const name of ['I Roditi', 'I. Roditi', 'A. Einstein + N. Rosen']) assert.equal(resolveSearchMode(name), 'author');
  for (const query of ['quantum error correction', 'I love physics', '10.1234/paper']) assert.equal(resolveSearchMode(query), 'all');
  assert.equal(resolveSearchMode('I Roditi', 'all'), 'all');
  assert.equal(resolveSearchMode('Itzhak Roditi', 'author'), 'author');
});

test('provider surname-only matches are removed from author results', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({message:{items:
    ['David', 'Claudio', 'Itzhak'].map(given => ({title:[given + ' paper'], author:[{given, family:'Roditi'}]})), 'total-results':3}});
  try {
    const data = await searchDirectSources({query:'I Roditi',searchMode:'author',continuation:{crossref:{offset:0}}});
    assert.deepEqual(data.results.map(record=>record.title), ['Itzhak paper']);
  } finally {globalThis.fetch = original;}
});
