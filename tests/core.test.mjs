import test from 'node:test';
import assert from 'node:assert/strict';

import { authorNameMatches, dedupeResults, detectQuery, normalizeArxiv, normalizeDoi, stripMarkup, paginateResults } from '../dist/js/core.js';
import { normalizeSubjectIds, subjectSelectionLabel } from '../dist/js/subjects.js';
import worker from '../worker/src/index.js';

test('detects and normalizes a DOI URL', () => {
  const detected = detectQuery('https://doi.org/10.1103/PhysRevLett.116.061102');
  assert.equal(detected.type, 'doi');
  assert.equal(detected.value, '10.1103/physrevlett.116.061102');
});

test('detects modern and legacy arXiv identifiers', () => {
  assert.deepEqual(detectQuery('arXiv:1602.03837v2').type, 'arxiv');
  assert.deepEqual(detectQuery('hep-th/9901001').type, 'arxiv');
  assert.equal(normalizeArxiv('https://arxiv.org/pdf/1602.03837.pdf'), '1602.03837');
});

test('classifies natural-language questions', () => {
  assert.equal(detectQuery('How do topological qubits suppress local noise?').type, 'question');
  assert.equal(detectQuery('topological qubits').type, 'concept');
});

test('author matching keeps all supplied parts within one name and accepts initials', () => {
  assert.equal(authorNameMatches('A. Einstein', 'Albert Einstein'), true);
  assert.equal(authorNameMatches('Albert Einstein', 'Einstein, Albert'), true);
  assert.equal(authorNameMatches('Albert Einstein', 'Albert Michelson'), false);
  assert.equal(['Albert Michelson', 'Boris Einstein'].some((name) => authorNameMatches('Albert Einstein', name)), false);
  assert.equal(authorNameMatches('A. Einstein', 'Einstein Sandra Aleksic'), false);
});

test('normalizes one or several physics area selections', () => {
  assert.deepEqual(normalizeSubjectIds(['quantum', 'condmat', 'quantum']), ['quantum', 'condmat']);
  assert.deepEqual(normalizeSubjectIds([]), ['all']);
  assert.equal(subjectSelectionLabel(['quantum', 'condmat']), 'Quantum physics + Condensed matter');
});

test('strips publisher markup without evaluating it', () => {
  assert.equal(stripMarkup('<jats:p>Spin &amp; charge</jats:p>'), 'Spin & charge');
  assert.equal(normalizeDoi('DOI: 10.1000/ABC.;'), '10.1000/abc');
});

test('merges records that share a DOI and retains source links', () => {
  const merged = dedupeResults([
    { title: 'A Physics Result', doi: '10.1000/example', authors: ['A. Researcher'], sources: ['Crossref'], score: 0.1, links: [] },
    { title: 'A Physics Result', doi: 'https://doi.org/10.1000/EXAMPLE', authors: ['A. Researcher', 'B. Scientist'], abstract: 'Longer abstract.', sources: ['OpenAlex'], score: 0.2, links: [{ label: 'OpenAlex', url: 'https://openalex.org/W1' }] },
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sources.sort(), ['Crossref', 'OpenAlex']);
  assert.equal(merged[0].authors.length, 2);
  assert.equal(merged[0].abstract, 'Longer abstract.');
});

test('does not fuzzy-merge conflicting DOIs', () => {
  const merged = dedupeResults([
    { title: 'Same title', year: 2024, doi: '10.1000/one', authors: ['A. Person'], sources: ['A'] },
    { title: 'Same title', year: 2024, doi: '10.1000/two', authors: ['A. Person'], sources: ['B'] },
  ]);
  assert.equal(merged.length, 2);
});

test('worker exports a Cloudflare-compatible fetch handler', () => {
  assert.equal(typeof worker.fetch, 'function');
});

test('worker health route reports optional ADS configuration', async () => {
  const response = await worker.fetch(new Request('https://example.test/api/health'), {}, { waitUntil() {} });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.nasaAdsConfigured, false);
});

test('pagination preserves all retrieved entries and clamps the last page', () => {
  const records = Array.from({ length: 23 }, (_, id) => ({ id }));
  const pages = [1, 2, 3].map((page) => paginateResults(records, 10, page));
  assert.deepEqual(pages.flatMap((page) => page.items), records);
  assert.equal(pages[2].start, 21);
  assert.equal(pages[2].end, 23);
  assert.equal(paginateResults(records, 50, 3).page, 1);
  assert.equal(paginateResults(records, 'all', 3).items.length, 23);
  assert.equal(paginateResults([], 10).start, 0);
});

test('bridging DOI/arXiv metadata merges all transitive duplicates', () => {
  const records = dedupeResults([
    { title: 'Published title', doi: '10.1234/a', sources: ['Crossref'] },
    { title: 'Earlier title', arxivId: '1602.03837v1', sources: ['arXiv'] },
    { title: 'Published title', doi: '10.1234/a', arxivId: '1602.03837v2', sources: ['INSPIRE'] },
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0].sources.length, 3);
});

test('arXiv detection does not misclassify decimal numbers inside a question', () => {
  assert.equal(detectQuery('What does a frequency of 1234.56789 mean?').type, 'question');
  assert.equal(detectQuery('https://arxiv.org/pdf/hep-th/9901001.pdf').value, 'hep-th/9901001');
  assert.equal(detectQuery('PMID:123').type, 'pmid');
});
