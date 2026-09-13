const DOI_PATTERN = /10\.\d{4,9}\/[-._;()/:a-z0-9]+/i;
const ARXIV_PATTERN = /(?:arxiv:\s*)?((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?)/i;
const BIBCODE_PATTERN = /^(\d{4}[A-Za-z.&]{5}[A-Za-z0-9.&]{4}[A-Za-z0-9.&][A-Za-z0-9.&]{4}[A-Za-z0-9.])$/;

export function normalizeDoi(value = '') {
  let decoded = String(value);
  try { decoded = decodeURIComponent(decoded); } catch { /* Keep malformed percent escapes literal. */ }
  return decoded
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim()
    .replace(/[.,;:]+$/, '')
    .toLowerCase();
}

export function normalizeArxiv(value = '') {
  return String(value)
    .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, '')
    .replace(/\.pdf$/i, '')
    .replace(/^arxiv:\s*/i, '')
    .trim();
}

export function detectQuery(raw = '') {
  const value = String(raw).trim();
  const doi = value.match(DOI_PATTERN)?.[0];
  if (doi) return { type: 'doi', value: normalizeDoi(doi), raw: value, label: 'DOI lookup' };

  const arxiv = normalizeArxiv(value).match(new RegExp(`^${ARXIV_PATTERN.source}$`, 'i'))?.[1];
  if (arxiv) return { type: 'arxiv', value: normalizeArxiv(arxiv), raw: value, label: 'arXiv lookup' };

  const pmid = value.match(/^(?:pmid:\s*)?(\d+)$/i)?.[1];
  if (/^pmid:/i.test(value) && pmid) return { type: 'pmid', value: pmid, raw: value, label: 'PMID lookup' };

  const corpusId = value.match(/^corpusid:\s*(\d+)$/i)?.[1];
  if (corpusId) return { type: 'corpus', value: corpusId, raw: value, label: 'Semantic Scholar ID' };

  const openAlex = value.match(/^(?:https?:\/\/openalex\.org\/)?(W\d+)$/i)?.[1];
  if (openAlex) return { type: 'openalex', value: openAlex.toUpperCase(), raw: value, label: 'OpenAlex ID' };

  const bibcode = value.match(BIBCODE_PATTERN)?.[1];
  if (bibcode && value === bibcode) return { type: 'bibcode', value: bibcode, raw: value, label: 'ADS bibcode' };

  const wordCount = value.split(/\s+/).filter(Boolean).length;
  const looksLikeQuestion = /^(?:how|what|when|where|which|why|can|could|does|do|is|are|explain)\b/i.test(value) || value.endsWith('?');
  if (looksLikeQuestion || wordCount >= 9) return { type: 'question', value, raw: value, label: 'Natural-language question' };
  return { type: 'concept', value, raw: value, label: 'Concept search' };
}

export function stripMarkup(value = '') {
  const entityMap = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
  };
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/gi, (match) => entityMap[match.toLowerCase()] || ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function abstractFromIndex(index) {
  if (!index || typeof index !== 'object') return '';
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions || []) words[position] = word;
  }
  return words.filter(Boolean).join(' ');
}

export function titleKey(value = '') {
  return stripMarkup(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sourceList(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function resultKeys(result) {
  const keys = [];
  if (result.doi) keys.push(`doi:${normalizeDoi(result.doi)}`);
  if (result.arxivId) keys.push(`arxiv:${normalizeArxiv(result.arxivId).replace(/v\d+$/i, '').toLowerCase()}`);
  for (const id of result.externalIds || []) {
    if (id?.type && id?.value) keys.push(`${String(id.type).toLowerCase()}:${String(id.value).toLowerCase()}`);
  }
  return keys;
}

function compatibleFallback(a, b) {
  if (a.doi && b.doi && normalizeDoi(a.doi) !== normalizeDoi(b.doi)) return false;
  if (!a.title || !b.title || titleKey(a.title) !== titleKey(b.title)) return false;
  const yearA = Number(a.year || String(a.date || '').slice(0, 4));
  const yearB = Number(b.year || String(b.date || '').slice(0, 4));
  if (yearA && yearB && Math.abs(yearA - yearB) > 1) return false;
  const firstA = String(a.authors?.[0] || '').split(/\s+/).at(-1)?.toLowerCase();
  const firstB = String(b.authors?.[0] || '').split(/\s+/).at(-1)?.toLowerCase();
  return !firstA || !firstB || firstA === firstB;
}

function chooseLonger(a = '', b = '') {
  return String(b).length > String(a).length ? b : a;
}

export function citationMetrics(source, count, openAlexId = '') {
  // Missing counts are unknown, not zero. Never sum counts across indexes.
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return [];
  const id = String(openAlexId).match(/^(?:https:\/\/openalex\.org\/)?(W\d+)$/i)?.[1];
  return [{ source, count, citingUrl: source === 'OpenAlex' && id
    ? `https://openalex.org/works?filter=referenced_works:${id.toUpperCase()}` : '' }];
}

function mergeCitationMetrics(a = [], b = []) {
  const bySource = new Map();
  for (const metric of [...a, ...b]) {
    const previous = bySource.get(metric.source);
    if (!previous || metric.count > previous.count) bySource.set(metric.source, metric);
  }
  return [...bySource.values()];
}

export function citationLabels(metrics = []) {
  const groups = new Map();
  for (const { source, count } of metrics) {
    if (!groups.has(count)) groups.set(count, new Set());
    groups.get(count).add(source);
  }
  return [...groups].map(([count, sources]) => `${count.toLocaleString()} ${count === 1 ? 'citation' : 'citations'} · ${[...sources].join(' / ')}`);
}

function mergePair(a, b) {
  const preferredDate = [a.date, b.date].filter(Boolean).sort()[0] || '';
  const authors = (b.authors?.length || 0) > (a.authors?.length || 0) ? b.authors : a.authors;
  const links = [...(a.links || []), ...(b.links || [])].filter((link, index, all) => link?.url && all.findIndex((candidate) => candidate.url === link.url) === index);
  const externalIds = [...(a.externalIds || []), ...(b.externalIds || [])].filter((id, index, all) => id?.value && all.findIndex((candidate) => candidate.type === id.type && candidate.value === id.value) === index);
  return {
    ...a,
    title: chooseLonger(a.title, b.title),
    abstract: chooseLonger(a.abstract, b.abstract),
    authors: authors || [],
    date: preferredDate,
    year: a.year || b.year,
    doi: a.doi || b.doi,
    arxivId: a.arxivId || b.arxivId,
    venue: a.venue || b.venue,
    primaryUrl: a.doi ? a.primaryUrl : (b.doi ? b.primaryUrl : a.primaryUrl || b.primaryUrl),
    openAccess: Boolean(a.openAccess || b.openAccess),
    citationCount: a.citationCount == null && b.citationCount == null ? null : Math.max(Number(a.citationCount || 0), Number(b.citationCount || 0)),
    citationMetrics: mergeCitationMetrics(a.citationMetrics, b.citationMetrics),
    sources: [...new Set([...sourceList(a.sources), ...sourceList(b.sources)])],
    links,
    externalIds,
    score: Number(a.score || 0) + Number(b.score || 0) + 0.035,
  };
}

export function dedupeResults(results = []) {
  const groups = [];
  for (const result of results.filter((item) => item?.title)) {
    const keys = new Set(resultKeys(result));
    let merged = { ...result, sources: sourceList(result.sources) };
    // A bridging record may connect several already-separate groups.
    for (let index = 0; index < groups.length;) {
      const group = groups[index];
      if ([...keys].some((key) => group.keys.has(key)) || compatibleFallback(group.result, merged)) {
        merged = mergePair(group.result, merged);
        for (const key of group.keys) keys.add(key);
        groups.splice(index, 1);
        index = 0;
      } else {
        index += 1;
      }
    }
    groups.push({ keys, result: merged });
  }
  return groups
    .map((group) => group.result)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

export function paginateResults(items, size = 10, page = 1) {
  const pageSize = size === 'all' ? Math.max(items.length, 1) : Math.max(1, Number(size) || 10);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(pageCount, Math.max(1, Number(page) || 1));
  const offset = (currentPage - 1) * pageSize;
  return { items: items.slice(offset, offset + pageSize), page: currentPage, pageCount,
    start: items.length ? offset + 1 : 0, end: Math.min(offset + pageSize, items.length), total: items.length };
}

export function supportsQuery(source, type) {
  if (['concept', 'question'].includes(type)) return true;
  return ({ openalex: ['doi', 'openalex'], crossref: ['doi'], arxiv: ['arxiv'],
    semantic: ['doi', 'arxiv', 'pmid', 'corpus'], inspire: ['doi', 'arxiv'], nasa: ['doi', 'arxiv', 'bibcode']
  }[source] || []).includes(type);
}

export function formatDate(value) {
  if (!value) return '';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}
