import { abstractFromIndex, authorNameMatches, citationMetrics, dedupeResults, detectQuery, normalizeArxiv, normalizeDoi, stripMarkup, supportsQuery } from './core.js?v=1.5.0';
import { getSubjects, normalizeSubjectIds } from './subjects.js?v=1.5.0';

const SOURCE_CATALOG = [
  { id: 'openalex', label: 'OpenAlex', direct: true },
  { id: 'crossref', label: 'Crossref', direct: true },
  { id: 'arxiv', label: 'arXiv', direct: false },
  { id: 'semantic', label: 'Semantic Scholar', direct: false },
  { id: 'inspire', label: 'INSPIRE', direct: true },
  { id: 'nasa', label: 'NASA ADS', direct: false, requiresKey: true },
];

function withTimeout(signal, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
  const onAbort = () => controller.abort(signal.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  return { signal: controller.signal, clear: () => { clearTimeout(timeout); signal?.removeEventListener('abort', onAbort); } };
}

async function fetchJson(url, { signal, timeoutMs = 14000 } = {}) {
  const timer = withTimeout(signal, timeoutMs);
  try {
    const response = await fetch(url, { signal: timer.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) {
      const error = new Error(`Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } finally {
    timer.clear();
  }
}

function openAlexResult(work, rank) {
  const doi = normalizeDoi(work.doi || '');
  const locationUrl = work.primary_location?.landing_page_url || work.primary_location?.source?.homepage_url || '';
  return {
    id: work.id || `openalex-${rank}`,
    title: stripMarkup(work.display_name || work.title || ''),
    authors: (work.authorships || []).map((entry) => entry.author?.display_name).filter(Boolean),
    abstract: stripMarkup(abstractFromIndex(work.abstract_inverted_index)),
    sources: ['OpenAlex'],
    date: work.publication_date || '',
    year: work.publication_year || Number(String(work.publication_date || '').slice(0, 4)) || null,
    doi,
    arxivId: '',
    venue: work.primary_location?.source?.display_name || '',
    primaryUrl: doi ? `https://doi.org/${doi}` : locationUrl || work.id,
    links: [
      doi && { label: 'DOI', url: `https://doi.org/${doi}` },
      work.id && { label: 'OpenAlex', url: work.id },
      work.open_access?.oa_url && { label: 'Open access', url: work.open_access.oa_url },
    ].filter(Boolean),
    openAccess: Boolean(work.open_access?.is_oa),
    citationCount: work.cited_by_count ?? null,
    citationMetrics: citationMetrics('OpenAlex', work.cited_by_count, work.id),
    subject: work.primary_topic?.display_name || '',
    score: 1 / (60 + rank),
  };
}

function crossrefDate(item) {
  const parts = item.published?.['date-parts']?.[0] || item['published-print']?.['date-parts']?.[0] || item.created?.['date-parts']?.[0];
  if (!parts?.[0]) return '';
  return `${parts[0]}-${String(parts[1] || 1).padStart(2, '0')}-${String(parts[2] || 1).padStart(2, '0')}`;
}

function crossrefResult(item, rank) {
  const doi = normalizeDoi(item.DOI || '');
  const resourceUrl = item.resource?.primary?.URL || item.URL || '';
  return {
    id: doi ? `doi:${doi}` : resourceUrl || `crossref-${rank}`,
    title: stripMarkup(item.title?.[0] || item['short-title']?.[0] || ''),
    authors: (item.author || []).map((author) => [author.given, author.family].filter(Boolean).join(' ')).filter(Boolean),
    abstract: stripMarkup(item.abstract || item.subtitle?.[0] || ''),
    sources: ['Crossref'],
    date: crossrefDate(item),
    year: Number(crossrefDate(item).slice(0, 4)) || null,
    doi,
    arxivId: '',
    venue: stripMarkup(item['container-title']?.[0] || item.publisher || ''),
    primaryUrl: doi ? `https://doi.org/${doi}` : resourceUrl,
    links: [doi && { label: 'DOI', url: `https://doi.org/${doi}` }].filter(Boolean),
    openAccess: (item.license || []).some((license) => /creativecommons|creativecommons\.org/i.test(license.URL || '')),
    citationCount: item['is-referenced-by-count'] ?? null,
    citationMetrics: citationMetrics('Crossref', item['is-referenced-by-count']),
    subject: (item.subject || []).join(' · '),
    score: 1 / (60 + rank),
  };
}

function subjectValues(subjectIds, key) {
  return [...new Set(getSubjects(subjectIds).flatMap((subject) => subject[key] || []))];
}

async function openAlexAuthorIds(query, { signal, timeoutMs }) {
  const params = new URLSearchParams({ search: query, 'per-page': '10', select: 'id,display_name' });
  const payload = await fetchJson(`https://api.openalex.org/authors?${params}`, { signal, timeoutMs });
  return (payload.results || [])
    .filter((author) => authorNameMatches(query, author.display_name))
    .map((author) => String(author.id || '').split('/').pop())
    .filter(Boolean)
    .slice(0, 10);
}

async function searchOpenAlex({ query, subjectIds, searchMode, signal, timeoutMs, limit, cursor = '*', offset = 0 }) {
  const detected = detectQuery(query);
  if (detected.type === 'openalex') {
    const work = await fetchJson(`https://api.openalex.org/works/${encodeURIComponent(detected.value)}`, { signal, timeoutMs });
    return [openAlexResult(work, 0)];
  }

  const params = new URLSearchParams({
    'per-page': String(limit),
    select: 'id,doi,title,display_name,authorships,publication_date,publication_year,primary_location,open_access,abstract_inverted_index,primary_topic,cited_by_count',
  });
  const filters = [];
  if (detected.type === 'doi') filters.push(`doi:${detected.value}`);
  else if (searchMode === 'author') {
    const authorIds = await openAlexAuthorIds(query, { signal, timeoutMs });
    if (!authorIds.length) return [];
    filters.push(`authorships.author.id:${authorIds.join('|')}`);
  } else params.set('search', detected.value);
  if (['concept', 'question'].includes(detected.type)) params.set('cursor', cursor);
  const subfields = subjectValues(subjectIds, 'openAlexSubfields');
  if (subfields.length && ['concept', 'question'].includes(detected.type)) filters.push(`topics.subfield.id:${subfields.join('|')}`);
  if (filters.length) params.set('filter', filters.join(','));
  const payload = await fetchJson(`https://api.openalex.org/works?${params}`, { signal, timeoutMs });
  const records = (payload.results || []).map((work, rank) => openAlexResult(work, rank + offset));
  records.next = records.length && payload.meta?.next_cursor ? { cursor: payload.meta.next_cursor, offset: offset + records.length } : null;
  return records;
}

async function searchCrossref({ query, searchMode, signal, timeoutMs, limit, offset = 0 }) {
  const detected = detectQuery(query);
  if (detected.type === 'doi') {
    const payload = await fetchJson(`https://api.crossref.org/v1/works/${encodeURIComponent(detected.value)}`, { signal, timeoutMs });
    return payload.message ? [crossrefResult(payload.message, 0)] : [];
  }
  const params = new URLSearchParams({ rows: String(limit), select: 'DOI,title,author,abstract,published,published-print,created,container-title,publisher,URL,resource,license,is-referenced-by-count,subject,subtitle' });
  params.set(searchMode === 'author' ? 'query.author' : 'query.bibliographic', detected.value);
  params.set('offset', String(offset));
  const payload = await fetchJson(`https://api.crossref.org/v1/works?${params}`, { signal, timeoutMs });
  const items = payload.message?.items || [];
  const records = items
    .map((work, rank) => crossrefResult(work, rank + offset))
    .filter((work) => searchMode !== 'author' || work.authors.some((author) => authorNameMatches(query, author)));
  const nextOffset = offset + items.length;
  records.next = records.length && nextOffset < (payload.message?.['total-results'] ?? nextOffset) && nextOffset <= 10000 ? { offset: nextOffset } : null;
  return records;
}

function inspireResult(hit, rank) {
  const metadata = hit.metadata || hit;
  const doi = normalizeDoi(metadata.dois?.[0]?.value || '');
  const arxivId = normalizeArxiv(metadata.arxiv_eprints?.[0]?.value || '');
  const recordId = hit.id || metadata.control_number;
  return {
    id: recordId ? `inspire:${recordId}` : `inspire-${rank}`,
    title: stripMarkup(metadata.titles?.[0]?.title || metadata.title || ''),
    authors: (metadata.authors || []).map((author) => author.full_name || author.raw_name).filter(Boolean),
    abstract: stripMarkup(metadata.abstracts?.[0]?.value || metadata.abstract || ''),
    sources: ['INSPIRE'],
    date: metadata.earliest_date || metadata.preprint_date || '',
    year: Number(String(metadata.earliest_date || metadata.preprint_date || '').slice(0, 4)) || null,
    doi,
    arxivId,
    venue: stripMarkup(metadata.publication_info?.[0]?.journal_title || ''),
    primaryUrl: doi ? `https://doi.org/${doi}` : arxivId ? `https://arxiv.org/abs/${arxivId}` : recordId ? `https://inspirehep.net/literature/${recordId}` : '',
    links: [recordId && { label: 'INSPIRE', url: `https://inspirehep.net/literature/${recordId}` }].filter(Boolean),
    openAccess: Boolean(metadata.documents?.some((document) => document.key || /pdf/i.test(document.url || ''))),
    citationCount: metadata.citation_count ?? null,
    citationMetrics: citationMetrics('INSPIRE', metadata.citation_count),
    externalIds: recordId ? [{ type: 'inspire', value: recordId }] : [],
    subject: (metadata.arxiv_eprints?.[0]?.categories || []).join(' · '),
    score: 1 / (60 + rank),
  };
}

function escapeInspire(value = '') {
  return String(value).replace(/["\\]/g, '\\$&');
}

async function searchInspire({ query, subjectIds, searchMode, signal, timeoutMs, limit, offset = 0 }) {
  const detected = detectQuery(query);
  const exactPath = detected.type === 'doi' ? `/api/doi/${encodeURIComponent(detected.value)}` : detected.type === 'arxiv' ? `/api/arxiv/${encodeURIComponent(detected.value)}` : '';
  let payload;
  if (exactPath) {
    payload = await fetchJson(`https://inspirehep.net${exactPath}`, { signal, timeoutMs });
  } else {
    const categories = subjectValues(subjectIds, 'inspire');
    const category = categories.length ? ` and (${categories.map((value) => `arxiv_eprints.categories:${value}`).join(' or ')})` : '';
    const term = searchMode === 'author' ? `a "${escapeInspire(detected.value)}"` : escapeInspire(detected.value);
    const params = new URLSearchParams({ q: `${term}${category}`, size: String(Math.min(limit, 50)), page: String(Math.floor(offset / Math.max(limit, 1)) + 1) });
    payload = await fetchJson(`https://inspirehep.net/api/literature?${params}`, { signal, timeoutMs });
  }
  const hits = payload.hits?.hits || (payload.metadata ? [payload] : []);
  return hits.map((hit, rank) => inspireResult(hit, rank + offset))
    .filter((work) => searchMode !== 'author' || work.authors.some((author) => authorNameMatches(query, author)));
}

function sourceStatus(id, state, detail = '') {
  const source = SOURCE_CATALOG.find((item) => item.id === id);
  return { id, label: source?.label || id, state, detail };
}

export async function searchDirectSources({ query, subjectIds, subjectId = 'all', searchMode = 'all', signal, timeoutMs = 14000, limit = 50, continuation = null }) {
  const type = detectQuery(query).type;
  const selectedSubjects = normalizeSubjectIds(subjectIds || subjectId);
  const effectiveMode = ['concept', 'question'].includes(type) && searchMode === 'author' ? 'author' : 'all';
  const tokens = continuation || { openalex: { cursor: '*', offset: 0 }, crossref: { offset: 0 }, inspire: { offset: 0 } };
  const next = {};
  const tasks = [
    ['openalex', () => searchOpenAlex({ query, subjectIds: selectedSubjects, searchMode: effectiveMode, signal, timeoutMs, limit, ...tokens.openalex })],
    ['crossref', () => searchCrossref({ query, searchMode: effectiveMode, signal, timeoutMs, limit, ...tokens.crossref })],
    ['inspire', () => searchInspire({ query, subjectIds: selectedSubjects, searchMode: effectiveMode, signal, timeoutMs, limit, ...tokens.inspire })],
  ].filter(([id]) => supportsQuery(id, type) && tokens[id]);
  const settled = await Promise.allSettled(tasks.map(([, run]) => run()));
  const results = [];
  const statuses = settled.map((outcome, index) => {
    const id = tasks[index][0];
    if (outcome.status === 'fulfilled') {
      results.push(...outcome.value);
      if (['concept', 'question'].includes(type) && outcome.value.next) next[id] = outcome.value.next;
      return sourceStatus(id, 'success', `${outcome.value.length} records`);
    }
    const status = outcome.reason?.status;
    if (['concept', 'question'].includes(type)) next[id] = tokens[id];
    if (status === 404 && !['concept', 'question'].includes(type)) return sourceStatus(id, 'success', '0 records');
    const detail = status === 429 ? 'Rate limited' : outcome.reason?.name === 'TimeoutError' ? 'Timed out' : 'Unavailable';
    return sourceStatus(id, 'error', detail);
  });
  signal?.throwIfAborted();
  for (const source of SOURCE_CATALOG.filter((source) => source.direct && !supportsQuery(source.id, type))) {
    statuses.push(sourceStatus(source.id, 'skipped', `No exact ${type.toUpperCase()} route`));
  }
  for (const source of SOURCE_CATALOG.filter((item) => !item.direct)) {
    statuses.push(sourceStatus(source.id, source.requiresKey ? 'key' : 'gateway', source.requiresKey ? 'API key + gateway' : 'Serverless gateway'));
  }
  return {
    query,
    queryType: detectQuery(query),
    searchMode: effectiveMode,
    subjectIds: selectedSubjects,
    results: dedupeResults(results),
    records: results,
    continuation: next,
    sources: statuses,
    mode: 'direct',
    retrievedAt: new Date().toISOString(),
  };
}

export async function searchGateway({ apiBase, query, subjectIds, subjectId = 'all', searchMode = 'all', signal, timeoutMs = 14000, limit = 15 }) {
  const selectedSubjects = normalizeSubjectIds(subjectIds || subjectId);
  const params = new URLSearchParams({ q: query, areas: selectedSubjects.join(','), mode: searchMode, limit: String(limit) });
  const url = `${apiBase.replace(/\/$/, '')}/api/search?${params}`;
  return fetchJson(url, { signal, timeoutMs });
}

export { SOURCE_CATALOG };
