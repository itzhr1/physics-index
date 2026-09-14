import { citationDestination } from './js/citation-lookup.js?v=1.4.0';
import { CONFIG } from './js/config.js?v=1.5.0';
import { citationLabels, detectQuery, formatDate, paginateResults, dedupeResults, parseAuthorQuery } from './js/core.js?v=1.8.0';
import { searchDirectSources, searchGateway, SOURCE_CATALOG } from './js/providers.js?v=1.8.0';
import { getSubject, normalizeSubjectIds, subjectSelectionLabel, SUBJECTS } from './js/subjects.js?v=1.5.0';

const elements = {
  form: document.querySelector('#search-form'),
  query: document.querySelector('#query'),
  subjectPicker: document.querySelector('#subject-picker'),
  subjectSummary: document.querySelector('#subject-summary'),
  subjectInputs: [...document.querySelectorAll('input[name="subject"]')],
  searchMode: document.querySelector('#search-mode'),
  button: document.querySelector('.search-button'),
  buttonLabel: document.querySelector('.search-button span'),
  results: document.querySelector('#results'),
  resultsEyebrow: document.querySelector('.results-heading .eyebrow'),
  resultsTitle: document.querySelector('#results-title'),
  resultSummary: document.querySelector('#result-summary'),
  list: document.querySelector('#result-list'),
  status: document.querySelector('#status'),
  sourceSummary: document.querySelector('#source-summary'),
  queryKind: document.querySelector('#query-kind'),
  sort: document.querySelector('#sort'),
  pageSize: document.querySelector('#page-size'),
  morePanel: document.querySelector('#load-more-panel'),
  more: document.querySelector('#load-more'),
  moreStatus: document.querySelector('#load-more-status'),
  pagination: document.querySelector('#pagination'),
  previous: document.querySelector('#previous-page'),
  next: document.querySelector('#next-page'),
  pageLabel: document.querySelector('#page-label'),
  displaySummary: document.querySelector('#display-summary'),
  modeBadge: document.querySelector('#mode-badge'),
  aboutButton: document.querySelector('#about-button'),
  aboutDialog: document.querySelector('#about-dialog'),
};

const state = {
  results: [],
  sources: [],
  query: '',
  subjectIds: ['all'],
  searchMode: 'all',
  controller: null,
  loading: false,
  retrievedAt: null,
  page: 1,
  records: [],
  continuation: {},
};

function element(tag, options = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(options)) {
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'attrs') Object.entries(value).forEach(([name, attrValue]) => node.setAttribute(name, attrValue));
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else node[key] = value;
  }
  node.append(...children.filter(Boolean));
  return node;
}

function safeUrl(value) {
  if (!value || !/^https?:\/\//i.test(String(value))) return '';
  try {
    const url = new URL(String(value), window.location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function externalLink(label, url, className = '') {
  const href = safeUrl(url);
  if (!href) return element('span', { className, text: label });
  return element('a', {
    className,
    text: label,
    href,
    target: '_blank',
    rel: 'noreferrer',
  });
}

function setLoading(loading) {
  state.loading = loading;
  elements.button.disabled = loading;
  elements.buttonLabel.textContent = loading ? 'Searching…' : 'Search';
  elements.results.setAttribute('aria-busy', String(loading));
}

function updateQueryKind() {
  elements.query.setCustomValidity('');
  const value = elements.query.value.trim();
  const detected = detectQuery(value);
  if (!value) elements.queryKind.textContent = '';
  else if (elements.searchMode.value === 'author' && ['concept', 'question'].includes(detected.type)) {
    const count = parseAuthorQuery(value).length;
    elements.queryKind.textContent = count > 1 ? `${count}-author search · all required` : 'Author search';
  } else elements.queryKind.textContent = detected.label;
}

function selectedSubjectIds() {
  return normalizeSubjectIds(elements.subjectInputs.filter((input) => input.checked).map((input) => input.value));
}

function setSubjectIds(ids) {
  const selected = normalizeSubjectIds(ids);
  for (const input of elements.subjectInputs) input.checked = selected.includes(input.value);
  elements.subjectSummary.textContent = subjectSelectionLabel(selected);
  return selected;
}

function sourceText(status) {
  const labels = {
    success: status.detail || 'Responded',
    error: status.detail || 'Unavailable',
    gateway: 'Gateway',
    key: 'Key',
    ready: 'Ready',
    skipped: status.detail || 'Skipped',
    loading: 'Searching',
  };
  return labels[status.state] || status.state;
}

function updateSourceStatuses(statuses = []) {
  state.sources = statuses;
  for (const status of statuses) {
    const row = document.querySelector(`[data-source="${status.id}"]`);
    const label = row?.querySelector('.status');
    if (!label) continue;
    label.textContent = sourceText(status);
    label.className = `status ${status.state}`;
    label.title = status.detail || '';
  }

  const searched = statuses.filter((source) => ['success', 'error'].includes(source.state));
  const succeeded = statuses.filter((source) => source.state === 'success');
  const failed = statuses.filter((source) => source.state === 'error');
  const skipped = statuses.filter((source) => source.state === 'skipped');
  const extras = statuses.filter((source) => ['gateway', 'key'].includes(source.state));
  if (!searched.length && !skipped.length) {
    elements.sourceSummary.hidden = true;
    return;
  }

  elements.sourceSummary.hidden = false;
  elements.sourceSummary.classList.toggle('is-warning', failed.length > 0);
  const successNames = succeeded.map((source) => source.label).join(', ') || 'No sources';
  const clauses = searched.length ? [`${succeeded.length} of ${searched.length} queried sources responded: ${successNames}.`] : ['No configured source supports this exact identifier.'];
  if (failed.length) clauses.push(`Unavailable: ${failed.map((source) => `${source.label} (${source.detail || 'error'})`).join(', ')}.`);
  if (skipped.length) clauses.push(`Not queried for this input: ${skipped.map((source) => source.label).join(', ')}.`);
  if (extras.length) clauses.push(`${extras.length} additional source${extras.length === 1 ? '' : 's'} require the optional gateway or a key.`);
  elements.sourceSummary.textContent = clauses.join(' ');
}

function initialSourceStatuses(loading = false) {
  const gateway = Boolean(CONFIG.apiBase);
  return SOURCE_CATALOG.map((source) => {
    if (gateway) return { ...source, state: loading ? 'loading' : (source.requiresKey ? 'key' : 'gateway'), detail: loading ? 'Searching' : '' };
    if (source.direct) return { ...source, state: loading ? 'loading' : 'ready', detail: loading ? 'Searching' : 'Ready' };
    return { ...source, state: source.requiresKey ? 'key' : 'gateway', detail: source.requiresKey ? 'API key + gateway' : 'Serverless gateway' };
  });
}

function renderSkeletons() {
  elements.list.replaceChildren(...Array.from({ length: 3 }, () => {
    const card = element('article', { className: 'result-card skeleton', attrs: { 'aria-hidden': 'true' } });
    for (const className of ['meta', 'title', 'authors', 'body', 'body short']) {
      card.append(element('div', { className: `skeleton-line ${className}` }));
    }
    return card;
  }));
}

function inferArea(result) {
  if (state.subjectIds.length === 1 && state.subjectIds[0] !== 'all') return state.subjectIds[0];
  const haystack = `${result.subject || ''} ${result.title || ''}`.toLowerCase();
  const match = SUBJECTS.slice(1).find((subject) => subject.terms.some((term) => haystack.includes(term)));
  return match?.id || 'applied';
}

function authorLine(result) {
  const authors = result.authors || [];
  if (!authors.length) return element('p', { className: 'authors', text: 'Authors not listed' });
  const paragraph = element('p', { className: 'authors' });
  const renderNames = (expanded) => {
    const visible = expanded ? authors : authors.slice(0, 8);
    paragraph.replaceChildren();
    visible.forEach((author, index) => {
      if (index) paragraph.append(document.createTextNode(', '));
      paragraph.append(element('button', {
        className: 'author-search', type: 'button', text: author,
        attrs: { title: `Search papers by ${author}` },
        onClick: () => {
          elements.query.value = author;
          elements.searchMode.value = 'author';
          updateQueryKind();
          void runSearch({ query: author, searchMode: 'author' });
        },
      }));
    });
    if (!expanded && authors.length > 8) paragraph.append(document.createTextNode(` + ${authors.length - 8} more `));
  };
  renderNames(false);
  if (authors.length <= 8) return paragraph;
  const button = element('button', { className: 'author-toggle', type: 'button', text: 'Show all' });
  let expanded = false;
  button.addEventListener('click', () => {
    expanded = !expanded;
    renderNames(expanded);
    button.textContent = expanded ? 'Show fewer' : 'Show all';
    button.setAttribute('aria-expanded', String(expanded));
    paragraph.append(button);
  });
  button.setAttribute('aria-expanded', 'false');
  paragraph.append(button);
  return paragraph;
}

function resultCard(result) {
  const areaId = inferArea(result);
  const area = getSubject(areaId);
  const card = element('article', { className: 'result-card', dataset: { area: areaId } });

  const kicker = element('div', { className: 'result-kicker' },
    element('span', { className: 'source-badge', text: (result.sources || []).join(' + ') || 'Scholarly record' }),
    result.subject && element('span', { text: result.subject }),
  );
  if (result.date) kicker.append(element('time', { text: formatDate(result.date), dateTime: result.date }));

  const title = element('h3');
  const primaryUrl = result.primaryUrl || result.links?.[0]?.url;
  if (primaryUrl) title.append(externalLink(result.title, primaryUrl));
  else title.textContent = result.title;

  card.append(kicker, title, authorLine(result));

  if (result.abstract) {
    const abstract = element('p', { className: `abstract${result.abstract.length > 420 ? ' is-collapsed' : ''}`, text: result.abstract });
    card.append(abstract);
    if (result.abstract.length > 420) {
      const toggle = element('button', { className: 'abstract-toggle', type: 'button', text: 'Read abstract' });
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', () => {
        const collapsed = abstract.classList.toggle('is-collapsed');
        toggle.textContent = collapsed ? 'Read abstract' : 'Collapse abstract';
        toggle.setAttribute('aria-expanded', String(!collapsed));
      });
      card.append(toggle);
    }
  } else {
    card.append(element('p', { className: 'abstract', text: 'No abstract was supplied by the responding sources.' }));
  }

  const identifiers = element('div', { className: 'identifiers' });
  if (result.doi) {
    const doi = externalLink('', `https://doi.org/${result.doi}`);
    doi.append(element('span', { text: 'DOI' }), document.createTextNode(` ${result.doi}`));
    identifiers.append(doi);
  }
  if (result.arxivId) {
    const arxiv = externalLink('', `https://arxiv.org/abs/${result.arxivId}`);
    arxiv.append(element('span', { text: 'arXiv' }), document.createTextNode(` ${result.arxivId}`));
    identifiers.append(arxiv);
  }
  for (const link of result.links || []) {
    if (!link?.url || /doi|arxiv/i.test(link.label || '')) continue;
    identifiers.append(externalLink(link.label || 'Source', link.url));
  }

  const footer = element('div', { className: 'result-footer' }, identifiers);
  if (primaryUrl) {
    const view = externalLink('View paper ', primaryUrl, 'view-paper');
    view.append(element('span', { text: '↗', attrs: { 'aria-hidden': 'true' } }));
    footer.append(view);
  }
  card.append(footer);

  const facts = element('div', { className: 'result-facts' });
  if (result.venue) facts.append(element('span', { text: result.venue }));
  const metrics = result.citationMetrics || [];
  for (const label of citationLabels(metrics)) {
    facts.append(element('span', { text: label, attrs: { title: 'Counts reported by each index; coverage and update times differ. Counts are not added together.' } }));
  }
  // Older gateway versions may not yet provide per-source provenance.
  if (!metrics.length && Number(result.citationCount) > 0) {
    const count = Number(result.citationCount);
    facts.append(element('span', { text: `${count.toLocaleString()} ${count === 1 ? 'citation' : 'citations'} · source unspecified` }));
  }
  const citingUrl = citationDestination(result);
  if (citingUrl) {
    const link = externalLink('View citing papers · OpenAlex', new URL(citingUrl, location.href).href);
    link.title = 'Opens the OpenAlex citing-paper list, looking up the DOI first when needed. Other indexes may differ.';
    facts.append(link);
  }
  if (result.openAccess) facts.append(element('span', { className: 'oa-label', text: 'Open access' }));
  if (facts.childNodes.length) card.append(facts);
  return card;
}

function sortedResults() {
  const items = [...state.results];
  switch (elements.sort.value) {
    case 'newest': return items.sort((a, b) => String(b.date || b.year || '').localeCompare(String(a.date || a.year || '')));
    case 'oldest': return items.sort((a, b) => String(a.date || a.year || '9999').localeCompare(String(b.date || b.year || '9999')));
    case 'citations': return items.sort((a, b) => Number(b.citationCount || 0) - Number(a.citationCount || 0));
    default: return items.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  }
}

function renderResults() {
  const items = sortedResults();
  const pagination = paginateResults(items, elements.pageSize.value, state.page);
  state.page = pagination.page;
  elements.pagination.hidden = pagination.pageCount <= 1;
  elements.displaySummary.hidden = !items.length;
  elements.displaySummary.textContent = `Showing ${pagination.start}–${pagination.end} of ${pagination.total} retrieved records. Sorting applies to these records.`;
  elements.pageLabel.textContent = `Page ${pagination.page} of ${pagination.pageCount}`;
  elements.previous.disabled = pagination.page <= 1;
  elements.next.disabled = pagination.page >= pagination.pageCount;
  if (!items.length) {
    const empty = element('div', { className: 'empty-state' },
      element('span', { className: 'empty-symbol', text: '∅', attrs: { 'aria-hidden': 'true' } }),
      element('h3', { text: 'No matching records found' }),
      element('p', { text: 'Try a shorter concept, a broader subject area, or verify the identifier. Some papers may only appear when the serverless gateway is enabled.' }),
      element('button', { className: 'retry-button', type: 'button', text: 'Try again', onClick: () => runSearch() }),
    );
    elements.list.replaceChildren(empty);
    return;
  }
  elements.list.replaceChildren(...pagination.items.map(resultCard));
}

function renderFailure(error) {
  const offline = navigator.onLine === false;
  const timeout = error?.name === 'TimeoutError';
  const title = offline ? 'You appear to be offline' : timeout ? 'The sources took too long' : 'The search could not be completed';
  const body = offline
    ? 'Reconnect and retry; your query and subject selection are preserved.'
    : timeout
      ? 'A scholarly service may be busy or rate-limited. Wait briefly, then retry.'
      : error?.code === 'unsupported_identifier'
        ? 'This identifier needs the optional gateway and a source that supports it. Direct mode supports exact DOI and OpenAlex ID lookups. No unrelated text search was substituted.'
        : 'The open APIs may be temporarily unavailable or blocked by browser security. The optional gateway avoids most browser restrictions.';
  elements.list.replaceChildren(element('div', { className: 'empty-state' },
    element('span', { className: 'empty-symbol', text: '!', attrs: { 'aria-hidden': 'true' } }),
    element('h3', { text: title }),
    element('p', { text: body }),
    element('button', { className: 'retry-button', type: 'button', text: 'Retry search', onClick: () => runSearch() }),
  ));
}

function updateUrl(query, subjectIds, searchMode) {
  const url = new URL(window.location.href);
  url.searchParams.set('q', query);
  if (subjectIds.length === 1 && subjectIds[0] === 'all') url.searchParams.delete('areas');
  else url.searchParams.set('areas', subjectIds.join(','));
  url.searchParams.delete('area');
  if (searchMode === 'author') url.searchParams.set('mode', 'author');
  else url.searchParams.delete('mode');
  history.replaceState(null, '', url);
}

async function runSearch(overrides = {}) {
  const query = String(overrides.query ?? elements.query.value).trim();
  const subjectIds = normalizeSubjectIds(overrides.subjectIds ?? selectedSubjectIds());
  const requestedMode = overrides.searchMode ?? elements.searchMode.value;
  const searchMode = requestedMode === 'author' && ['concept', 'question'].includes(detectQuery(query).type) ? 'author' : 'all';
  if (!query) {
    elements.query.focus();
    elements.status.textContent = 'Enter a concept, question, DOI, or identifier to search.';
    return null;
  }
  if (query.length > 500) {
    elements.query.setCustomValidity('Keep the query to 500 characters or fewer.');
    elements.query.reportValidity();
    return null;
  }
  elements.query.setCustomValidity('');
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  state.continuation = {};
  state.records = [];
  elements.morePanel.hidden = true;
  state.query = query;
  state.subjectIds = subjectIds;
  state.searchMode = searchMode;
  elements.query.value = query;
  setSubjectIds(subjectIds);
  elements.searchMode.value = searchMode;
  updateQueryKind();
  setLoading(true);
  updateSourceStatuses(initialSourceStatuses(true));
  elements.resultsEyebrow.textContent = 'SEARCHING SOURCES';
  elements.resultsTitle.textContent = `Looking for “${query}”`;
  elements.resultSummary.textContent = `${subjectSelectionLabel(subjectIds)} · ${searchMode === 'author' ? 'author records' : 'live scholarly records'}`;
  elements.sourceSummary.hidden = true;
  elements.sort.disabled = true;
  elements.pageSize.disabled = true;
  elements.pagination.hidden = true;
  elements.displaySummary.hidden = true;
  renderSkeletons();
  elements.status.textContent = `Searching for ${query}.`;
  updateUrl(query, subjectIds, searchMode);

  try {
    let data;
    if (CONFIG.apiBase) {
      try {
        data = await searchGateway({ apiBase: CONFIG.apiBase, query, subjectIds, searchMode, signal: controller.signal, timeoutMs: CONFIG.requestTimeoutMs, limit: CONFIG.resultsPerSource });
      } catch (gatewayError) {
        if (controller.signal.aborted) throw gatewayError;
        data = await searchDirectSources({ query, subjectIds, searchMode, signal: controller.signal, timeoutMs: CONFIG.requestTimeoutMs, limit: CONFIG.resultsPerSource });
        data.gatewayFallback = true;
      }
    } else {
      data = await searchDirectSources({ query, subjectIds, searchMode, signal: controller.signal, timeoutMs: CONFIG.requestTimeoutMs, limit: CONFIG.resultsPerSource });
    }
    if (controller.signal.aborted || state.controller !== controller) return null;
    updateSourceStatuses(data.sources || []);
    if (!(data.sources || []).some((source) => source.state === 'success')) {
      const error = new Error('No scholarly source responded.');
      error.sources = data.sources;
      if (!(data.sources || []).some((source) => source.state === 'error')) error.code = 'unsupported_identifier';
      throw error;
    }
    state.results = data.results || [];
    state.records = data.records || [];
    state.continuation = data.continuation || {};
    elements.morePanel.hidden = !Object.keys(state.continuation).length;
    elements.more.disabled = false;
    elements.more.hidden = false;
    elements.moreStatus.textContent = 'Fetch the next batch from the sources. Entries per page only changes the display.';
    state.retrievedAt = data.retrievedAt || new Date().toISOString();
    updateSourceStatuses(data.sources || []);
    if (data.gatewayFallback) {
      elements.sourceSummary.hidden = false;
      elements.sourceSummary.classList.add('is-warning');
      elements.sourceSummary.textContent += ' The gateway was unreachable, so this search fell back to direct OpenAlex and Crossref access.';
    }
    elements.resultsEyebrow.textContent = (searchMode === 'author' ? 'Author search' : detectQuery(query).label).toUpperCase();
    state.page = 1;
    elements.resultsTitle.textContent = state.results.length ? `${state.results.length} distinct record${state.results.length === 1 ? '' : 's'}` : 'No records found';
    const retrieved = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(state.retrievedAt));
    elements.resultSummary.textContent = `${subjectSelectionLabel(subjectIds)} · merged and ranked · retrieved ${retrieved}`;
    elements.sort.disabled = state.results.length < 2;
    renderResults();
    elements.status.textContent = `${state.results.length} results found for ${query}.`;
    elements.results.focus({ preventScroll: false });
    return data;
  } catch (error) {
    if (controller.signal.aborted || state.controller !== controller || error?.name === 'AbortError') return null;
    state.results = [];
    elements.resultsEyebrow.textContent = 'SEARCH INTERRUPTED';
    elements.resultsTitle.textContent = error?.code === 'unsupported_identifier' ? 'Gateway needed for this identifier' : 'Sources unavailable';
    elements.resultSummary.textContent = `${subjectSelectionLabel(subjectIds)} · query preserved`;
    updateSourceStatuses(error.sources || initialSourceStatuses(false).map((source) => source.direct ? { ...source, state: 'error', detail: 'Unavailable' } : source));
    renderFailure(error);
    elements.status.textContent = `Search failed: ${error?.message || 'unknown error'}`;
    elements.results.focus({ preventScroll: false });
    return null;
  } finally {
    if (state.controller === controller) {
      setLoading(false);
      elements.pageSize.disabled = false;
    }
  }
}

async function loadMore() {
  if (state.loading || !Object.keys(state.continuation).length) return;
  const controller = new AbortController();
  state.controller?.abort();
  state.controller = controller;
  const previousCount = state.results.length;
  setLoading(true);
  elements.more.disabled = true;
  elements.pageSize.disabled = true;
  elements.sort.disabled = true;
  elements.moreStatus.textContent = 'Fetching more records…';
  try {
    const data = await searchDirectSources({ query: state.query, subjectIds: state.subjectIds, searchMode: state.searchMode,
      signal: controller.signal, limit: CONFIG.resultsPerSource, timeoutMs: CONFIG.requestTimeoutMs,
      continuation: state.continuation });
    if (controller.signal.aborted || state.controller !== controller) return;
    state.continuation = data.continuation;
    // Keep raw records, replacing repeated provider IDs instead of awarding extra rank for retries.
    const records = new Map(state.records.map(record => [`${record.sources?.[0]}:${record.id}`, record]));
    for (const record of data.records) records.set(`${record.sources?.[0]}:${record.id}`, record);
    state.records = [...records.values()];
    state.results = dedupeResults(state.records);
    const sources = new Map(state.sources.map(source => [source.id, source]));
    for (const source of data.sources) sources.set(source.id, source);
    updateSourceStatuses([...sources.values()]);
    state.page = 1;
    renderResults();
    elements.resultsTitle.textContent = `${state.results.length} distinct record${state.results.length === 1 ? '' : 's'}`;
    const failed = data.sources.some(source => source.state === 'error');
    const remaining = Object.keys(state.continuation).length > 0;
    elements.moreStatus.textContent = `${Math.max(0, state.results.length - previousCount)} additional distinct records loaded. ${failed ? 'Some sources failed; load more to retry their batch.' : remaining ? 'More results are available.' : 'No more results are available from these source searches.'}`;
    elements.status.textContent = elements.moreStatus.textContent;
    elements.more.hidden = !remaining;
  } catch (error) {
    if (controller.signal.aborted || state.controller !== controller) return;
    elements.moreStatus.textContent = 'Could not load more. Your existing results are kept; try again.';
  } finally {
    if (state.controller === controller) {
      setLoading(false);
      elements.more.disabled = false;
      elements.pageSize.disabled = false;
      elements.sort.disabled = state.results.length < 2;
    }
  }
}
elements.more.addEventListener('click', () => void loadMore());

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  void runSearch();
});

elements.query.addEventListener('input', updateQueryKind);
elements.searchMode.addEventListener('change', updateQueryKind);
for (const input of elements.subjectInputs) {
  input.addEventListener('change', () => {
    if (input.value === 'all' && input.checked) {
      for (const candidate of elements.subjectInputs) candidate.checked = candidate === input;
    } else if (input.value !== 'all' && input.checked) {
      elements.subjectInputs.find((candidate) => candidate.value === 'all').checked = false;
    }
    if (!elements.subjectInputs.some((candidate) => candidate.checked)) {
      elements.subjectInputs.find((candidate) => candidate.value === 'all').checked = true;
    }
    elements.subjectSummary.textContent = subjectSelectionLabel(selectedSubjectIds());
  });
}
for (const control of [elements.sort, elements.pageSize]) {
  control.addEventListener('change', () => {
    state.page = 1;
    if (state.results.length && !state.loading) renderResults();
  });
}
for (const [button, delta] of [[elements.previous, -1], [elements.next, 1]]) {
  button.addEventListener('click', () => {
    state.page += delta;
    renderResults();
    elements.results.focus();
  });
}

document.querySelectorAll('[data-example]').forEach((button) => {
  button.addEventListener('click', () => {
    elements.query.value = button.dataset.example;
    elements.searchMode.value = button.dataset.exampleMode || 'all';
    updateQueryKind();
    void runSearch();
  });
});

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    elements.query.focus();
  }
});

elements.aboutButton.addEventListener('click', () => elements.aboutDialog.showModal());

elements.modeBadge.textContent = CONFIG.apiBase ? 'Gateway mode · up to 6 sources' : 'Direct mode · 3 live sources';
updateSourceStatuses(initialSourceStatuses(false));

async function registerWebMcp() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  try {
    await context.registerTool({
      name: 'search_physics_literature',
      title: 'Search physics literature',
      description: 'Search the same scholarly physics sources shown in Physics Index, update the visible result list, and return a concise search summary.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 500, description: 'Concept, question, DOI, arXiv ID, or another supported identifier.' },
          subjects: { type: 'array', items: { type: 'string', enum: SUBJECTS.map((subject) => subject.id) }, uniqueItems: true, description: 'One or more physics subject area IDs. Defaults to all.' },
          mode: { type: 'string', enum: ['all', 'author'], description: 'Use author to require the query terms to match one author name.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input) {
        if (!input || typeof input.query !== 'string' || !input.query.trim() || input.query.length > 500) throw new TypeError('A query of 1–500 characters is required.');
        const subjectIds = normalizeSubjectIds(input.subjects);
        const searchMode = input.mode === 'author' ? 'author' : 'all';
        const data = await runSearch({ query: input.query, subjectIds, searchMode });
        if (!data) throw new Error('Search did not complete.');
        return {
          query: input.query,
          subjects: subjectIds,
          mode: searchMode,
          resultCount: data.results?.length || 0,
          respondingSources: (data.sources || []).filter((source) => source.state === 'success').map((source) => source.label),
          topResults: (data.results || []).slice(0, 5).map((result) => ({ title: result.title, doi: result.doi || null, arxivId: result.arxivId || null, url: safeUrl(result.primaryUrl) || null })),
        };
      },
    }, { signal: lifecycle.signal });
  } catch (error) {
    console.info('WebMCP registration unavailable', error);
  }
}

void registerWebMcp();

const initialParams = new URLSearchParams(window.location.search);
const initialQuery = initialParams.get('q')?.trim();
const initialAreas = initialParams.get('areas') || initialParams.get('area');
if (initialQuery) {
  const subjectIds = normalizeSubjectIds(initialAreas);
  const searchMode = initialParams.get('mode') === 'author' ? 'author' : 'all';
  elements.query.value = initialQuery;
  setSubjectIds(subjectIds);
  elements.searchMode.value = searchMode;
  updateQueryKind();
  void runSearch({ query: initialQuery, subjectIds, searchMode });
}
