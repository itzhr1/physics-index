import { abstractFromIndex, authorNameMatches, authorsMatchQuery, citationMetrics, dedupeResults, detectQuery, normalizeArxiv, normalizeDoi, parseAuthorQuery, stripMarkup, supportsQuery } from '../../dist/js/core.js';
import { getSubjects, normalizeSubjectIds, subjectSelectionLabel } from '../../dist/js/subjects.js';

const SOURCES = [
  { id: 'openalex', label: 'OpenAlex' },
  { id: 'crossref', label: 'Crossref' },
  { id: 'arxiv', label: 'arXiv' },
  { id: 'semantic', label: 'Semantic Scholar' },
  { id: 'inspire', label: 'INSPIRE' },
  { id: 'nasa', label: 'NASA ADS', requires: 'ADS_API_TOKEN' },
];

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function corsHeaders(request, env) {
  const configured = env.CORS_ORIGIN || '*';
  const origin = request.headers.get('Origin');
  const allowed = configured === '*' || !origin || configured.split(',').map((item) => item.trim()).includes(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? (configured === '*' ? '*' : origin) : 'null',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status, request, env, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(request, env), ...extraHeaders },
  });
}

function escapeQuery(value = '') {
  return String(value).replace(/["\\]/g, '\\$&');
}

function xmlText(value = '') {
  return stripMarkup(String(value)
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number))));
}

async function fetchWithPolicy(url, options = {}, retries = 1) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException('Source timed out', 'TimeoutError')), options.timeoutMs || 9500);
    try {
      const response = await fetch(url, { ...options, timeoutMs: undefined, signal: controller.signal });
      if (!response.ok) {
        const error = new Error(`Source returned ${response.status}`);
        error.status = response.status;
        if ((response.status === 429 || response.status >= 500) && attempt < retries) {
          const retryAfter = Number(response.headers.get('Retry-After'));
          await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 1200) : 350 * (attempt + 1)));
          lastError = error;
          continue;
        }
        throw error;
      }
      return response;
    } catch (error) {
      const normalized = error.name === 'AbortError'
        ? Object.assign(new Error('Source timed out'), { name: 'TimeoutError' })
        : error;
      lastError = normalized;
      if (attempt >= retries || !['TimeoutError', 'TypeError'].includes(normalized.name)) throw normalized;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function score(rank) {
  return 1 / (60 + rank);
}

function subjectValues(subjects, key) {
  return [...new Set(subjects.flatMap((subject) => subject[key] || []))];
}

function openAlexResult(work, rank) {
  const doi = normalizeDoi(work.doi || '');
  const landing = work.primary_location?.landing_page_url || work.primary_location?.source?.homepage_url || work.id || '';
  return {
    id: work.id || `openalex-${rank}`,
    title: stripMarkup(work.display_name || work.title || ''),
    authors: (work.authorships || []).map((entry) => entry.author?.display_name).filter(Boolean),
    abstract: stripMarkup(abstractFromIndex(work.abstract_inverted_index)),
    sources: ['OpenAlex'],
    date: work.publication_date || '',
    year: work.publication_year || null,
    doi,
    arxivId: '',
    venue: work.primary_location?.source?.display_name || '',
    primaryUrl: doi ? `https://doi.org/${doi}` : landing,
    links: [work.id && { label: 'OpenAlex', url: work.id }, work.open_access?.oa_url && { label: 'Open access', url: work.open_access.oa_url }].filter(Boolean),
    openAccess: Boolean(work.open_access?.is_oa),
    citationCount: work.cited_by_count ?? null,
    citationMetrics: citationMetrics('OpenAlex', work.cited_by_count, work.id),
    subject: work.primary_topic?.display_name || '',
    score: score(rank),
  };
}

async function openAlexAuthorIds(name, env) {
  const params = new URLSearchParams({ search: name, 'per-page': '10', select: 'id,display_name' });
  if (env.OPENALEX_API_KEY) params.set('api_key', env.OPENALEX_API_KEY);
  const response = await fetchWithPolicy(`https://api.openalex.org/authors?${params}`, { headers: { Accept: 'application/json' } });
  const data = await response.json();
  return (data.results || []).filter((author) => authorNameMatches(name, author.display_name))
    .map((author) => String(author.id || '').split('/').pop()).filter(Boolean).slice(0, 10);
}

async function openAlexSearch({ detected, subjects, searchMode, limit, env }) {
  if (detected.type === 'openalex') {
    const response = await fetchWithPolicy(`https://api.openalex.org/works/${encodeURIComponent(detected.value)}`, { headers: { Accept: 'application/json' } });
    return [openAlexResult(await response.json(), 0)];
  }
  const params = new URLSearchParams({
    'per-page': String(limit),
    select: 'id,doi,title,display_name,authorships,publication_date,publication_year,primary_location,open_access,abstract_inverted_index,primary_topic,cited_by_count',
  });
  const filters = [];
  if (detected.type === 'doi') filters.push(`doi:${detected.value}`);
  else if (searchMode === 'author') {
    const authorGroups = await Promise.all(parseAuthorQuery(detected.value).map((name) => openAlexAuthorIds(name, env)));
    if (!authorGroups.length || authorGroups.some((ids) => !ids.length)) return [];
    filters.push(...authorGroups.map((ids) => `authorships.author.id:${ids.join('|')}`));
  }
  else if (detected.type === 'question' && env.OPENALEX_API_KEY) params.set('search.semantic', detected.value);
  else params.set('search', detected.value);
  const subfields = subjectValues(subjects, 'openAlexSubfields');
  if (subfields.length && ['concept', 'question'].includes(detected.type)) filters.push(`topics.subfield.id:${subfields.join('|')}`);
  if (filters.length) params.set('filter', filters.join(','));
  if (env.OPENALEX_API_KEY) params.set('api_key', env.OPENALEX_API_KEY);
  const response = await fetchWithPolicy(`https://api.openalex.org/works?${params}`, { headers: { Accept: 'application/json' } });
  const data = await response.json();
  return (data.results || []).map(openAlexResult)
    .filter((work) => searchMode !== 'author' || authorsMatchQuery(detected.value, work.authors));
}

function crossrefDate(item) {
  const parts = item.published?.['date-parts']?.[0] || item['published-print']?.['date-parts']?.[0] || item.created?.['date-parts']?.[0];
  return parts?.[0] ? `${parts[0]}-${String(parts[1] || 1).padStart(2, '0')}-${String(parts[2] || 1).padStart(2, '0')}` : '';
}

function crossrefResult(item, rank) {
  const doi = normalizeDoi(item.DOI || '');
  const date = crossrefDate(item);
  return {
    id: doi ? `doi:${doi}` : item.URL || `crossref-${rank}`,
    title: stripMarkup(item.title?.[0] || item['short-title']?.[0] || ''),
    authors: (item.author || []).map((author) => [author.given, author.family].filter(Boolean).join(' ')).filter(Boolean),
    abstract: stripMarkup(item.abstract || item.subtitle?.[0] || ''),
    sources: ['Crossref'],
    date,
    year: Number(date.slice(0, 4)) || null,
    doi,
    arxivId: '',
    venue: stripMarkup(item['container-title']?.[0] || item.publisher || ''),
    primaryUrl: doi ? `https://doi.org/${doi}` : item.URL || '',
    links: [],
    openAccess: (item.license || []).some((license) => /creativecommons|creativecommons\.org/i.test(license.URL || '')),
    citationCount: item['is-referenced-by-count'] ?? null,
    citationMetrics: citationMetrics('Crossref', item['is-referenced-by-count']),
    subject: (item.subject || []).join(' · '),
    score: score(rank),
  };
}

async function crossrefSearch({ detected, searchMode, limit, env }) {
  let url;
  if (detected.type === 'doi') {
    url = `https://api.crossref.org/v1/works/${encodeURIComponent(detected.value)}`;
  } else {
    const params = new URLSearchParams({ rows: String(limit), select: 'DOI,title,author,abstract,published,published-print,created,container-title,publisher,URL,license,is-referenced-by-count,subject,subtitle' });
    params.set(searchMode === 'author' ? 'query.author' : 'query.bibliographic', searchMode === 'author' ? parseAuthorQuery(detected.value)[0] : detected.value);
    if (env.CROSSREF_MAILTO) params.set('mailto', env.CROSSREF_MAILTO);
    url = `https://api.crossref.org/v1/works?${params}`;
  }
  const response = await fetchWithPolicy(url, { headers: { Accept: 'application/json', 'User-Agent': `PhysicsIndex/1.0${env.CROSSREF_MAILTO ? ` (mailto:${env.CROSSREF_MAILTO})` : ''}` } });
  const data = await response.json();
  const items = detected.type === 'doi' ? (data.message ? [data.message] : []) : (data.message?.items || []);
  return items.map(crossrefResult)
    .filter((work) => searchMode !== 'author' || authorsMatchQuery(detected.value, work.authors));
}

function semanticResult(paper, rank) {
  const doi = normalizeDoi(paper.externalIds?.DOI || '');
  const arxivId = normalizeArxiv(paper.externalIds?.ArXiv || '');
  return {
    id: paper.paperId || `semantic-${rank}`,
    title: stripMarkup(paper.title || ''),
    authors: (paper.authors || []).map((author) => author.name).filter(Boolean),
    abstract: stripMarkup(paper.abstract || ''),
    sources: ['Semantic Scholar'],
    date: paper.publicationDate || (paper.year ? `${paper.year}-01-01` : ''),
    year: paper.year || null,
    doi,
    arxivId,
    venue: stripMarkup(paper.venue || ''),
    primaryUrl: doi ? `https://doi.org/${doi}` : paper.url || (arxivId ? `https://arxiv.org/abs/${arxivId}` : ''),
    links: [paper.url && { label: 'Semantic Scholar', url: paper.url }, paper.openAccessPdf?.url && { label: 'Open PDF', url: paper.openAccessPdf.url }].filter(Boolean),
    openAccess: Boolean(paper.openAccessPdf?.url),
    citationCount: paper.citationCount ?? null,
    citationMetrics: citationMetrics('Semantic Scholar', paper.citationCount),
    externalIds: [paper.paperId && { type: 's2', value: paper.paperId }, paper.externalIds?.CorpusId && { type: 'corpus', value: paper.externalIds.CorpusId }].filter(Boolean),
    subject: (paper.s2FieldsOfStudy || []).map((field) => field.category).filter(Boolean).join(' · '),
    score: score(rank),
  };
}

async function semanticSearch({ detected, searchMode, limit, env }) {
  const fields = 'paperId,externalIds,url,title,abstract,venue,year,publicationDate,authors,openAccessPdf,s2FieldsOfStudy,citationCount';
  const headers = { Accept: 'application/json' };
  if (env.S2_API_KEY) headers['x-api-key'] = env.S2_API_KEY;
  const ids = { doi: `DOI:${detected.value}`, arxiv: `ARXIV:${detected.value}`, corpus: `CorpusId:${detected.value}`, pmid: `PMID:${detected.value}` };
  if (ids[detected.type]) {
    const response = await fetchWithPolicy(`https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(ids[detected.type])}?fields=${encodeURIComponent(fields)}`, { headers });
    return [semanticResult(await response.json(), 0)];
  }
  const params = new URLSearchParams({ query: detected.value, limit: String(Math.min(limit, 100)), fields, fieldsOfStudy: 'Physics' });
  const response = await fetchWithPolicy(`https://api.semanticscholar.org/graph/v1/paper/search?${params}`, { headers });
  const data = await response.json();
  return (data.data || []).map(semanticResult)
    .filter((work) => searchMode !== 'author' || authorsMatchQuery(detected.value, work.authors));
}

function inspireResult(hit, rank) {
  const metadata = hit.metadata || hit;
  const doi = normalizeDoi(metadata.dois?.[0]?.value || metadata.document_type?.doi || '');
  const arxivId = normalizeArxiv(metadata.arxiv_eprints?.[0]?.value || '');
  const recordId = hit.id || metadata.control_number;
  return {
    id: recordId ? `inspire:${recordId}` : `inspire-${rank}`,
    title: stripMarkup(metadata.titles?.[0]?.title || metadata.title || ''),
    authors: (metadata.authors || []).map((author) => author.full_name || author.raw_name).filter(Boolean),
    abstract: stripMarkup(metadata.abstracts?.[0]?.value || metadata.abstract || ''),
    sources: ['INSPIRE'],
    date: metadata.earliest_date || metadata.preprint_date || metadata.imprints?.[0]?.date || '',
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
    score: score(rank),
  };
}

async function inspireSearch({ detected, subjects, searchMode, limit }) {
  const exactPath = detected.type === 'doi' ? `/api/doi/${encodeURIComponent(detected.value)}` : detected.type === 'arxiv' ? `/api/arxiv/${encodeURIComponent(detected.value)}` : '';
  if (exactPath) {
    const response = await fetchWithPolicy(`https://inspirehep.net${exactPath}`, { headers: { Accept: 'application/json' } }, 0);
    const data = await response.json();
    const hits = data.hits?.hits || (data.metadata ? [data] : []);
    return hits.map(inspireResult);
  }
  const categories = subjectValues(subjects, 'inspire');
  const category = categories.length ? ` and (${categories.map((value) => `arxiv_eprints.categories:${value}`).join(' or ')})` : '';
  const term = searchMode === 'author'
    ? parseAuthorQuery(detected.value).map((name) => `a "${escapeQuery(name)}"`).join(' and ')
    : escapeQuery(detected.value);
  const params = new URLSearchParams({ q: `${term}${category}`, size: String(limit), sort: searchMode === 'author' ? 'bestmatch' : 'mostrecent' });
  const response = await fetchWithPolicy(`https://inspirehep.net/api/literature?${params}`, { headers: { Accept: 'application/json' } }, 0);
  const data = await response.json();
  return (data.hits?.hits || []).map(inspireResult)
    .filter((work) => searchMode !== 'author' || authorsMatchQuery(detected.value, work.authors));
}

function atomTag(entry, name) {
  const escaped = name.replace(':', '\\:');
  return entry.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'))?.[1] || '';
}

function atomAttr(entry, tag, attr) {
  const escaped = tag.replace(':', '\\:');
  const matches = [...entry.matchAll(new RegExp(`<${escaped}\\s+[^>]*${attr}=["']([^"']+)["'][^>]*>`, 'gi'))];
  return matches.map((match) => match[1]);
}

function arxivEntries(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map((match, rank) => {
    const entry = match[1];
    const canonical = xmlText(atomTag(entry, 'id'));
    const arxivId = normalizeArxiv(canonical);
    const doi = normalizeDoi(xmlText(atomTag(entry, 'arxiv:doi')));
    const authors = [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)].map((author) => xmlText(author[1]));
    const categories = atomAttr(entry, 'category', 'term');
    const links = atomAttr(entry, 'link', 'href');
    return {
      id: `arxiv:${arxivId}`,
      title: xmlText(atomTag(entry, 'title')),
      authors,
      abstract: xmlText(atomTag(entry, 'summary')),
      sources: ['arXiv'],
      date: xmlText(atomTag(entry, 'published')).slice(0, 10),
      year: Number(xmlText(atomTag(entry, 'published')).slice(0, 4)) || null,
      doi,
      arxivId,
      venue: xmlText(atomTag(entry, 'arxiv:journal_ref')),
      primaryUrl: doi ? `https://doi.org/${doi}` : canonical || `https://arxiv.org/abs/${arxivId}`,
      links: links.filter((url) => /^https?:/i.test(url)).map((url) => ({ label: /pdf/i.test(url) ? 'arXiv PDF' : 'arXiv', url })),
      openAccess: true,
      citationCount: null,
      subject: categories.join(' · '),
      score: score(rank),
    };
  });
}

async function arxivSearch({ detected, subjects, searchMode, limit }) {
  const params = new URLSearchParams({ start: '0', max_results: String(Math.min(limit, 30)), sortBy: 'relevance', sortOrder: 'descending' });
  if (detected.type === 'arxiv') params.set('id_list', detected.value);
  else {
    const subjectCategories = subjectValues(subjects, 'arxiv');
    const categories = subjectCategories.length ? ` AND (${subjectCategories.map((value) => `cat:${value}`).join(' OR ')})` : '';
    const terms = searchMode === 'author'
      ? parseAuthorQuery(detected.value).map((name) => `au:"${escapeQuery(name)}"`).join(' AND ')
      : `all:"${escapeQuery(detected.value)}"`;
    params.set('search_query', `${terms}${categories}`);
  }
  const response = await fetchWithPolicy(`https://export.arxiv.org/api/query?${params}`, { headers: { Accept: 'application/atom+xml', 'User-Agent': 'PhysicsIndex/1.0' }, timeoutMs: 12000 }, 0);
  return arxivEntries(await response.text());
}

function adsResult(doc, rank) {
  const doi = normalizeDoi(Array.isArray(doc.doi) ? doc.doi[0] : doc.doi || '');
  const arxivIdentifier = (doc.identifier || []).find((value) => /arxiv:/i.test(value));
  const arxivId = normalizeArxiv(arxivIdentifier || '');
  return {
    id: doc.bibcode || `ads-${rank}`,
    title: stripMarkup(Array.isArray(doc.title) ? doc.title[0] : doc.title || ''),
    authors: doc.author || [],
    abstract: stripMarkup(doc.abstract || ''),
    sources: ['NASA ADS'],
    date: doc.pubdate || (doc.year ? `${doc.year}-01-01` : ''),
    year: doc.year || null,
    doi,
    arxivId,
    venue: stripMarkup(doc.pub || ''),
    primaryUrl: doi ? `https://doi.org/${doi}` : `https://ui.adsabs.harvard.edu/abs/${encodeURIComponent(doc.bibcode)}/abstract`,
    links: [{ label: 'NASA ADS', url: `https://ui.adsabs.harvard.edu/abs/${encodeURIComponent(doc.bibcode)}/abstract` }],
    openAccess: (doc.property || []).includes('OPENACCESS'),
    citationCount: doc.citation_count ?? null,
    citationMetrics: citationMetrics('NASA ADS', doc.citation_count),
    externalIds: doc.bibcode ? [{ type: 'bibcode', value: doc.bibcode }] : [],
    subject: (doc.arxiv_class || []).join(' · '),
    score: score(rank),
  };
}

async function adsSearch({ detected, searchMode, limit, env }) {
  const identifierTypes = ['doi', 'arxiv', 'bibcode'];
  const q = identifierTypes.includes(detected.type)
    ? `identifier:"${escapeQuery(detected.value)}"`
    : `${searchMode === 'author' ? parseAuthorQuery(detected.value).map((name) => `author:"${escapeQuery(name)}"`).join(' AND ') : `(${escapeQuery(detected.value)})`} AND database:(astronomy OR physics)`;
  const params = new URLSearchParams({ q, rows: String(limit), fl: 'bibcode,title,author,abstract,pubdate,year,pub,doi,identifier,arxiv_class,property,citation_count', sort: 'score desc' });
  const response = await fetchWithPolicy(`https://api.adsabs.harvard.edu/v1/search/query?${params}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${env.ADS_API_TOKEN}` } });
  const data = await response.json();
  return (data.response?.docs || []).map(adsResult);
}

function sourceFailure(source, error) {
  const detail = error?.status === 429 ? 'Rate limited' : error?.name === 'TimeoutError' ? 'Timed out' : error?.status ? `HTTP ${error.status}` : 'Unavailable';
  return { id: source.id, label: source.label, state: 'error', detail };
}

async function aggregateSearch(query, areaIds, searchMode, limit, env) {
  const detected = detectQuery(query);
  const selectedIds = normalizeSubjectIds(areaIds);
  const subjects = getSubjects(selectedIds);
  const effectiveMode = ['concept', 'question'].includes(detected.type) && searchMode === 'author' ? 'author' : 'all';
  const jobs = {
    openalex: () => openAlexSearch({ detected, subjects, searchMode: effectiveMode, limit, env }),
    crossref: () => crossrefSearch({ detected, searchMode: effectiveMode, limit, env }),
    arxiv: () => arxivSearch({ detected, subjects, searchMode: effectiveMode, limit }),
    semantic: () => semanticSearch({ detected, searchMode: effectiveMode, limit, env }),
    inspire: () => inspireSearch({ detected, subjects, searchMode: effectiveMode, limit }),
    nasa: () => adsSearch({ detected, searchMode: effectiveMode, limit, env }),
  };
  const skipped = SOURCES.filter((source) => (!source.requires || env[source.requires]) && !supportsQuery(source.id, detected.type));
  const active = SOURCES.filter((source) => (!source.requires || env[source.requires]) && !skipped.some((candidate) => candidate.id === source.id));
  const settled = await Promise.allSettled(active.map((source) => jobs[source.id]()));
  const records = [];
  const statuses = settled.map((outcome, index) => {
    const source = active[index];
    if (outcome.status === 'fulfilled') {
      records.push(...outcome.value);
      return { id: source.id, label: source.label, state: 'success', detail: `${outcome.value.length} records` };
    }
    if (outcome.reason?.status === 404 && !['concept', 'question'].includes(detected.type)) {
      return { id: source.id, label: source.label, state: 'success', detail: '0 records' };
    }
    return sourceFailure(source, outcome.reason);
  });
  for (const source of SOURCES.filter((candidate) => candidate.requires && !env[candidate.requires])) {
    statuses.push({ id: source.id, label: source.label, state: 'key', detail: `${source.requires} not configured` });
  }
  for (const source of skipped) {
    statuses.push({ id: source.id, label: source.label, state: 'skipped', detail: `No exact ${detected.type.toUpperCase()} route` });
  }
  statuses.sort((a, b) => SOURCES.findIndex((source) => source.id === a.id) - SOURCES.findIndex((source) => source.id === b.id));
  return {
    query,
    queryType: detected,
    subjectIds: selectedIds,
    subject: { id: selectedIds.join(','), label: subjectSelectionLabel(selectedIds) },
    searchMode: effectiveMode,
    results: dedupeResults(records).slice(0, 50),
    sources: statuses,
    mode: 'gateway',
    retrievedAt: new Date().toISOString(),
  };
}

async function cachedSearch(request, env, ctx) {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') || '').trim();
  const areas = url.searchParams.get('areas') || url.searchParams.get('area') || 'all';
  const searchMode = url.searchParams.get('mode') === 'author' ? 'author' : 'all';
  const limit = Math.max(1, Math.min(Math.floor(Number(url.searchParams.get('limit'))) || 15, 30));
  if (!query) return json({ error: 'missing_query', message: 'Provide a q parameter.' }, 400, request, env);
  if (query.length > 500) return json({ error: 'query_too_long', message: 'Keep q to 500 characters or fewer.' }, 400, request, env);

  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/__cache/v3/search?q=${encodeURIComponent(query)}&areas=${encodeURIComponent(areas)}&mode=${searchMode}&limit=${limit}`);
  const cached = await cache.match(cacheKey);
  if (cached) return new Response(cached.body, { status: cached.status, headers: { ...Object.fromEntries(cached.headers), ...corsHeaders(request, env), 'X-Physics-Index-Cache': 'HIT' } });

  const data = await aggregateSearch(query, areas, searchMode, limit, env);
  const response = json(data, 200, request, env, { 'Cache-Control': 'public, max-age=120, s-maxage=900, stale-if-error=86400', 'X-Physics-Index-Cache': 'MISS' });
  if (data.sources.some((source) => source.state === 'success')) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, request, env, { Allow: 'GET, OPTIONS' });
    const url = new URL(request.url);
    if (url.pathname === '/health' || url.pathname === '/api/health') {
      return json({ ok: true, service: 'physics-index-gateway', nasaAdsConfigured: Boolean(env.ADS_API_TOKEN) }, 200, request, env, { 'Cache-Control': 'no-store' });
    }
    if (url.pathname === '/api/search') return cachedSearch(request, env, ctx);
    return json({ error: 'not_found', routes: ['/api/search?q=…&areas=quantum,condmat&mode=author', '/api/health'] }, 404, request, env);
  },
};
