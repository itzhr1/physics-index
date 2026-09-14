import test from 'node:test';
import assert from 'node:assert/strict';
import { inspireAuthorName, searchDirectSources } from '../dist/js/providers.js';

test('INSPIRE queries use surname-first names and preserve explicit compound surnames', () => {
  assert.equal(inspireAuthorName('I Roditi'), 'Roditi, I');
  assert.equal(inspireAuthorName('A. Einstein'), 'Einstein, A.');
  assert.equal(inspireAuthorName('Llewellyn Smith, C.'), 'Llewellyn Smith, C.');
});
test('DELPHI author is matched beyond the first 100 authors and continuation is retained', async () => {
  const original = globalThis.fetch;
  const authors = Array.from({length:543}, (_,i)=>({full_name:`Other${i}, D.`}));
  authors.push({full_name:'Roditi, I.'});
  globalThis.fetch = async url => {
    assert.equal(new URL(url).searchParams.get('q'), 'a "Roditi, I"');
    return Response.json({hits:{total:124,hits:[{id:'123',metadata:{titles:[{title:'Bose-Einstein correlations in the hadronic decays of the Z0'}],authors,dois:[{value:'10.1016/0370-2693(92)90181-3'}]}}]}});
  };
  try {
    const data = await searchDirectSources({query:'I Roditi',searchMode:'author',continuation:{inspire:{page:1,offset:0}}});
    assert.equal(data.results[0].doi, '10.1016/0370-2693(92)90181-3');
    assert.equal(data.results[0].authors.length,544);
    assert.equal(data.continuation.inspire.page,2);
  } finally {globalThis.fetch=original;}
});
