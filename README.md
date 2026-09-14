# Physics Index

Physics Index is a GitHub Pages-ready search interface for physics literature. It accepts concepts, natural-language questions, DOI and arXiv identifiers, and several other scholarly IDs. A broad physics subject control maps the same search intent across source-specific taxonomies.

The static site works immediately with Crossref, OpenAlex, and INSPIRE-HEP. An optional Cloudflare Worker adds a CORS-safe aggregation layer for arXiv, Semantic Scholar, and NASA ADS, while keeping API keys out of the browser.

**New to GitHub? Start with [GITHUB_SETUP.md](GITHUB_SETUP.md).** It explains the no-terminal upload option and the complete-source option. Neither requires a ChatGPT subscription to run on GitHub Pages.

## What is included

The latest corrections preserve Load more after batches with no matching authors, add INSPIRE pagination, accept compact uppercase initials such as `BP Abbott`, and reset concept examples to All fields mode. A note beside the results explains source-specific area filtering. Direct-mode continuation now covers OpenAlex, Crossref, and INSPIRE; the optional gateway still returns one batch.

- Choose 5, 10, 20, 50, or all retrieved entries per page, with Previous/Next navigation. Changing the page size or sort order resets to page one without another API request. The count is the number retrieved in this search, not a provider's total number of matches.
- In direct mode, **Load more search results** fetches the next batch (50 records per source by default) from OpenAlex and Crossref, merges duplicates, and re-sorts the accumulated results. OpenAlex uses cursors; Crossref uses offsets up to its 10,000-offset ceiling. Failed batches can be retried without refetching successful batches. This control is for concept/question searches, not exact identifiers. The optional gateway retains its existing single-batch behavior (up to 30 per source and 50 merged records); it does not yet expose continuation tokens.

- One search box for concepts, questions, DOI URLs, arXiv IDs, ADS bibcodes, OpenAlex IDs, `PMID:` values, and Semantic Scholar `CorpusId:` values.
- An **Author name** mode that sends provider-specific author queries and retains only records where all supplied name parts belong to one author. Initials match expanded names in either direction. Separate two or more authors with `+` (for example, `A. Einstein + N. Rosen`); every listed author must occur on the same paper. Author names in every result are clickable shortcuts into this mode.
- Eleven physics subject groups based on arXiv's taxonomy. Choose one or several areas; their provider mappings are combined with OR. "All physics" remains the default.
- Normalized results with title, authors, abstract, source, date, venue, DOI/arXiv links, open-access state, and citation count when supplied.
- Citation counts retain their source: matching counts appear together (for example, “1 citation · OpenAlex / Crossref”), while differing counts are shown separately. Zero means that index explicitly returned zero; missing counts are omitted. Counts are never added across databases. “Most cited” uses the largest reported count, not a verified combined total. A **View citing papers · OpenAlex** link is included when an OpenAlex work ID is available; that list covers OpenAlex only. Other indexes may have different coverage or update times. Older gateways without provenance are labeled “source unspecified”; redeploy the included Worker to add provenance.
- Partial-success handling: one slow or unavailable API does not discard records from the others.
- Deduplication by DOI, versionless arXiv ID, provider IDs, then conservative title/year/author matching.
- Responsive, keyboard-friendly UI with loading, empty, offline, timeout, rate-limit, and per-source states.
- A GitHub Pages workflow plus an optional Cloudflare Worker gateway.
- No frontend framework, bundler, or runtime dependency.

## Repository map

Citation links also work for Crossref-only DOI results: clicking **View citing papers · OpenAlex** opens a small lookup page that resolves the DOI to an OpenAlex ID, then opens its citing-paper list. No extra requests are made until clicked. Missing matches and timeouts display an explanation and a retry control; a missing match is not treated as zero citations. This lookup runs directly from the browser even when a gateway is configured.

```text
dist/                  Static website deployed by GitHub Pages
  index.html
  styles.css
  app.js
  js/
    config.js          Frontend mode and gateway URL
    core.js            Query detection, cleanup, and deduplication
    providers.js       Direct OpenAlex, Crossref, and INSPIRE adapters
    subjects.js        Shared physics subject registry
worker/
  src/index.js         Optional six-source Cloudflare Worker
  wrangler.toml.example
tests/                 Dependency-free core tests
.github/workflows/     GitHub Pages deployment
```

## Run locally

Any static file server works. From the repository root:

```bash
python3 -m http.server 4173 --directory dist
```

Open `http://localhost:4173`. Opening `dist/index.html` directly is not supported because browsers restrict JavaScript module imports from `file://` URLs.

Optional checks require Node.js 20 or newer:

```bash
npm test
npm run check
```

## Deploy the static site to GitHub Pages

1. Create an empty GitHub repository and push this project to its `main` branch.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **GitHub Actions** as the source.
4. Push to `main`, or run **Deploy Physics Index to GitHub Pages** from the Actions tab.

The included workflow uploads only `dist/`. All links and module paths are relative, so project sites such as `https://name.github.io/repository/` work without a base-path change.

In the default direct mode, the page queries OpenAlex, Crossref, and INSPIRE from the visitor's browser. If a browser, network policy, rate limit, or upstream CORS policy blocks one API, the interface reports partial coverage instead of claiming that source was searched successfully.

## Enable all sources with the optional gateway

The Worker is recommended for reliable production search. It fans out with independent timeouts, normalizes provider responses, caches searches, merges duplicates, and returns source-by-source status.

### 1. Prepare the Worker

```bash
cd worker
cp wrangler.toml.example wrangler.toml
npm install
```

Set `CORS_ORIGIN` in `wrangler.toml` to the exact GitHub Pages origin when practical. `*` is acceptable for a public, read-only literature gateway but permits any website to spend its upstream API quota.

### 2. Add optional credentials

These secrets improve limits or enable a source. Never place them in `dist/js/config.js`, Git history, query strings, or `wrangler.toml`.

```bash
npx wrangler secret put OPENALEX_API_KEY
npx wrangler secret put S2_API_KEY
npx wrangler secret put ADS_API_TOKEN
```

`CROSSREF_MAILTO` is a non-secret contact address and can be set under `[vars]` in `wrangler.toml`. NASA ADS is skipped, and labeled as requiring a key, when `ADS_API_TOKEN` is absent. OpenAlex and Semantic Scholar can run without keys but have tighter anonymous limits.

### 3. Deploy and connect it

```bash
npm run deploy
```

Copy the resulting Worker origin into `dist/js/config.js`:

```js
export const CONFIG = {
  apiBase: 'https://physics-index-api.example.workers.dev',
  requestTimeoutMs: 14000,
  resultsPerSource: 50,
};
```

Commit that change and let the Pages workflow redeploy. The frontend automatically falls back to direct OpenAlex/Crossref search if the gateway cannot be reached.

### Gateway API

```http
GET /api/search?q=quantum+error+correction&areas=quantum,condmat&limit=15
GET /api/search?q=A.+Einstein&mode=author&areas=grav&limit=15
GET /api/health
```

`areas` is a comma-separated selection from `all`, `astro`, `condmat`, `hep`, `grav`, `quantum`, `nuclear`, `amo`, `stat`, `math`, `plasma`, or `applied`. The legacy single `area` parameter remains accepted. `mode=author` enables author matching. `limit` is per source and capped at 30. Responses are cached at the edge for 15 minutes, with shorter browser caching.

## Source support

| Source | Static mode | Gateway mode | Credentials |
| --- | --- | --- | --- |
| [OpenAlex](https://docs.openalex.org/) | Yes | Yes | Optional `OPENALEX_API_KEY` |
| [Crossref](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) | Yes | Yes | None; `CROSSREF_MAILTO` recommended |
| [arXiv](https://info.arxiv.org/help/api/) | No | Yes | None |
| [Semantic Scholar](https://www.semanticscholar.org/product/api) | No | Yes | Optional `S2_API_KEY` |
| [INSPIRE-HEP](https://github.com/inspirehep/rest-api-doc) | Yes | Yes | None for reads |
| [NASA ADS](https://github.com/adsabs/adsabs-dev-api) | No | Yes | Required `ADS_API_TOKEN` |

API limits and policies change. Review each provider's current documentation before operating a high-traffic public instance. The gateway retries only transient `429` and `5xx` responses, uses bounded timeouts, and never makes a failed source look successful. arXiv results and links must be used in accordance with the [arXiv API Terms of Use](https://info.arxiv.org/help/api/tou.html).

## Query routing

Identifier detection runs before text search:

1. DOI, including `doi:` and `doi.org` URLs.
2. Modern and legacy arXiv IDs, with optional versions.
3. `PMID:`, `CorpusId:`, OpenAlex `W…` IDs, and 19-character ADS bibcodes.
4. Questions and long natural-language input.
5. Short concept searches.

Exact identifiers only query sources with an implemented lookup route. Direct mode supports DOI, arXiv, and OpenAlex lookups through the compatible direct sources; PMID, CorpusId, and ADS bibcodes require the optional gateway and an appropriate configured source. Unsupported sources are marked “Skipped”, rather than sending the identifier as an unrelated text query. An exact lookup returning HTTP 404 is treated as no match, not a service outage. Questions use OpenAlex semantic search when a gateway key is configured and lexical search elsewhere.

Subject filtering is approximate: OpenAlex uses broad subfields, arXiv and INSPIRE use category mappings, and Crossref, Semantic Scholar and ADS do not implement the selected fine-grained area filter. Multiple selected areas are ORed within each provider. Exact identifiers bypass subject restrictions. A selected area is not presented as verified subject metadata for a result.

## Normalization and deduplication

Every adapter returns the same record shape. Strong identifiers are merged first: normalized DOI, versionless arXiv ID, then provider IDs. The fallback requires the same normalized title, publication years within one year, and compatible first-author surnames. Records with two different non-empty DOIs are never merged only because their titles look alike.

Merged records retain every source and useful link. Provider ranks are combined with reciprocal-rank scores plus a small agreement boost; raw scores from unrelated APIs are not compared directly.

The merger also joins groups when a later record links them through a DOI and arXiv ID. Relevance remains a heuristic: citation counts and publication dates can differ between sources, and “newest” sorts only the retrieved batch.

## Review and verification

The correctness review added regression coverage for display pagination, transitive duplicate merging, exact identifier routing, DOI not-found responses, canceled requests, and identifier detection. The interface now ignores stale responses from replaced searches and preserves per-source error details. Run `npm test` for the dependency-free suite.

The optional Worker remains a small-instance starting point. Before high-traffic deployment, add a globally serialized arXiv queue that enforces its three-second request spacing and provider-specific quota controls; the current edge cache alone does not enforce those limits across concurrent users. NASA ADS still requires a token. Neither the optional Worker nor those credentials are automatically deployed by the GitHub Pages workflow.

## Add another provider

1. Add the source label to `SOURCES` in `worker/src/index.js`.
2. Write an adapter that accepts `{ detected, subject, limit, env }` and returns the normalized record shape used by the existing adapters.
3. Add it to the `jobs` map in `aggregateSearch`.
4. Add any taxonomy mapping to `dist/js/subjects.js` rather than embedding UI labels inside the adapter.
5. Add fixture-based adapter tests. Keep live API smoke tests separate so normal tests do not consume quota.
6. Update the source list and credential documentation.

Provider text is treated as untrusted: the interface inserts it with `textContent`, Crossref markup is stripped, and OpenAlex abstract indexes are reconstructed without HTML evaluation.

## Troubleshooting

- **One source says “Unavailable”:** its records were omitted, while successful sources remain visible. Retry later; `429` means the provider rate-limited the request.
- **Only three sources are searched:** this is the key-free GitHub Pages mode. Deploy the gateway and set its public origin in `dist/js/config.js` to add arXiv and Semantic Scholar; add `ADS_API_TOKEN` for NASA ADS.
- **NASA ADS says “Key”:** add `ADS_API_TOKEN` to the Worker. It must not be exposed in frontend code.
- **The browser reports CORS errors:** use the gateway. Third-party CORS behavior is not treated as a permanent provider guarantee.
- **No results for a known ID:** remove punctuation around the identifier, try “All physics,” and check the provider link directly. Recently issued identifiers may not yet be indexed everywhere.
- **GitHub Pages is blank:** make sure Pages uses GitHub Actions and that the workflow uploaded `dist`, not the repository root.
- **The Worker returns `403` from the browser:** verify that `CORS_ORIGIN` exactly matches the Pages origin, including scheme and without an extra path.

## Privacy, accessibility, and limits

- No account, cookies, analytics, or persistent browser storage are used.
- A search sends the query, author-mode choice, and selected areas to the configured gateway, or directly to the three sources named in direct mode. Upstream providers may log requests under their own policies.
- API credentials remain server-side. Do not add secrets to this repository.
- The interface uses semantic landmarks, persistent labels, visible focus, a live status region, keyboard submission, a search-focus shortcut, and reduced-motion support. Result text remains selectable and works at narrow mobile widths.
- Coverage is not exhaustive. Metadata, abstracts, citation counts, open-access labels, subject mappings, and dates can be incomplete or disagree across sources.
- Physics Index is a discovery tool, not a substitute for the publisher's record or expert literature review.

## License

MIT. Provider metadata remains subject to each provider's terms and the rights attached to individual records.
