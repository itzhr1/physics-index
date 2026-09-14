import test from 'node:test';
import assert from 'node:assert/strict';
import { physicsScope, scopeResults } from '../dist/js/physics-scope.js';
import { dedupeResults } from '../dist/js/core.js';
import { searchDirectSources } from '../dist/js/providers.js';

const physics = { title: 'Paper', doi: '10.1234/example', disciplineFields: [{id:'https://openalex.org/fields/31', display_name:'Physics and Astronomy'}] };
const biology = { title: 'Biology', disciplineFields: [{id:'13', display_name:'Biochemistry, Genetics and Molecular Biology'}] };
const unknown = { title: 'Unclassified', sources:['Crossref'] };

test('physics default hides other disciplines and keeps unknown records separate', () => {
  const groups = scopeResults([biology, unknown, physics]);
  assert.deepEqual(groups.visible, [physics]);
  assert.deepEqual(groups.other, [biology]);
  assert.deepEqual(groups.unknown, [unknown]);
});
test('broad toggle and exact identifiers preserve all records', () => {
  for (const options of [{includeOther:true}, {exactIdentifier:true}]) {
    assert.deepEqual(scopeResults([biology,unknown,physics], options).visible, [biology,unknown,physics]);
  }
});
test('physics categories and journals provide evidence without using query or title', () => {
  for (const subject of ['hep-th','cond-mat.stat-mech','math-ph','physics.bio-ph','nlin.CD']) assert.equal(physicsScope({subject}), 'physics');
  assert.equal(physicsScope({venue:'Physics Letters B'}), 'physics');
  assert.equal(physicsScope({venue:'Molecular and Biochemical Parasitology'}), 'unknown');
  assert.equal(physicsScope({title:'Quantum biology', subject:'Biology'}), 'unknown');
  assert.equal(physicsScope({sources:['arXiv'], subject:'cs.AI'}), 'unknown');
});
test('deduplication retains classification evidence regardless of source order', () => {
  const crossref = {...unknown, doi:physics.doi};
  for (const records of [[crossref,physics],[physics,crossref]]) assert.equal(physicsScope(dedupeResults(records)[0]), 'physics');
  const bio = {...biology,doi:physics.doi};
  for (const records of [[crossref,bio],[bio,crossref]]) assert.equal(physicsScope(dedupeResults(records)[0]), 'other');
});
test('OpenAlex mapping preserves primary field metadata', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({results:[{id:'W1',title:'Biology',primary_topic:{field:biology.disciplineFields[0]}}],meta:{}});
  try {
    const data = await searchDirectSources({query:'biology', continuation:{openalex:{cursor:'*',offset:0}}});
    assert.equal(physicsScope(data.results[0]), 'other');
  } finally {globalThis.fetch = original;}
});
