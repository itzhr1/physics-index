import { abstractFromIndex, citationMetrics, dedupeResults, detectQuery, normalizeDoi, stripMarkup, supportsQuery } from './core.js?v=1.3.0';
import { getSubject } from './subjects.js?v=1.3.0';

const SOURCE_CATALOG = [
  { id: 'openalex', label: 'OpenAlex', direct: true },
  { id: 'crossref', label: 'Crossref', direct: true },
  { id: 'arxiv', label: 'arXiv', direct: false },
  { id: 'semantic', label: 'Semantic Scholar', direct: false },
  { id: 'inspire', label: 'INSPIRE', direct: false },
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

async function searchOpenAlex({ query, subjectId, signal, timeoutMs, limit, cursor = '*', offset = 0 }) {
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
  else params.set('search', detected.value);
  if (['concept', 'question'].includes(detected.type)) params.set('cursor', cursor);
  const subject = getSubject(subjectId);
  if (subject.openAlexSubfields.length && ['concept', 'question'].includes(detected.type)) filters.push(`topics.subfield.id:${subject.openAlexSubfields.join('|')}`);
  if (filters.length) params.set('filter', filters.join(','));
  const payload = await fetchJson(`https://api.openalex.org/works?${params}`, { signal, timeoutMs });
  const records = (payload.results || []).map((work, rank) => openAlexResult(work, rank + offset));
  records.next = records.length && payload.meta?.next_cursor ? { cursor: payload.meta.next_cursor, offset: offset + records.length } : null;
  return records;
}

async function searchCrossref({ query, signal, timeoutMs, limit, offset = 0 }) {
  const detected = detectQuery(query);
  if (detected.type === 'doi') {
    const payload = await fetchJson(`https://api.crossref.org/v1/works/${encodeURIComponent(detected.value)}`, { signal, timeoutMs });
    return payload.message ? [crossrefResult(payload.message, 0)] : [];
  }
  const params = new URLSearchParams({ rows: String(limit), select: 'DOI,title,author,abstract,published,published-print,created,container-title,publisher,URL,resource,license,is-referenced-by-count,subject,subtitle' });
  params.set('query.bibliographic', detected.value);
  params.set('offset', String(offset));
  const payload = await fetchJson(`https://api.crossref.org/v1/works?${params}`, { signal, timeoutMs });
  const records = (payload.message?.items || []).map((work, rank) => crossrefResult(work, rank + offset));
  const nextOffset = offset + records.length;
  records.next = records.length && nextOffset < (payload.message?.['total-results'] ?? nextOffset) && nextOffset <= 10000 ? { offset: nextOffset } : null;
  return records;
}

function sourceStatus(id, state, detail = '') {
  const source = SOURCE_CATALOG.find((item) => item.id === id);
  return { id, label: source?.label || id, state, detail };
}

export async function searchDirectSources({ query, subjectId = 'all', signal, timeoutMs = 14000, limit = 50, continuation = null }) {
  const type = detectQuery(query).type;
  const tokens = continuation || { openalex: { cursor: '*', offset: 0 }, crossref: { offset: 0 } };
  const next = {};
  const tasks = [
    ['openalex', () => searchOpenAlex({ query, subjectId, signal, timeoutMs, limit, ...tokens.openalex })],
    ['crossref', () => searchCrossref({ query, subjectId, signal, timeoutMs, limit, ...tokens.crossref })],
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
    results: dedupeResults(results),
    records: results,
    continuation: next,
    sources: statuses,
    mode: 'direct',
    retrievedAt: new Date().toISOString(),
  };
}

export async function searchGateway({ apiBase, query, subjectId = 'all', signal, timeoutMs = 14000, limit = 15 }) {
  const params = new URLSearchParams({ q: query, area: subjectId, limit: String(limit) });
  const url = `${apiBase.replace(/\/$/, '')}/api/search?${params}`;
  return fetchJson(url, { signal, timeoutMs });
}

export { SOURCE_CATALOG };
