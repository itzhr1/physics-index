import { normalizeDoi, citationMetrics } from './core.js?v=1.4.0';

export function citationDestination(result) {
  return result.citationMetrics?.find(metric => metric.citingUrl)?.citingUrl
    || (result.doi ? `./citations.html?doi=${encodeURIComponent(normalizeDoi(result.doi))}` : '');
}

export async function resolveCitingPapers(doi, { signal } = {}) {
  const normalized = normalizeDoi(doi);
  if (!/^10\.\d{4,9}\/\S+$/i.test(normalized)) throw new Error('A valid DOI is required.');
  const response = await fetch(`https://api.openalex.org/works/https://doi.org/${encodeURIComponent(normalized)}`, { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(response.status === 429 ? 'OpenAlex is rate limiting requests. Please retry later.' : 'OpenAlex is temporarily unavailable. Please retry.');
  const work = await response.json();
  if (normalizeDoi(work.doi || '') !== normalized) return null;
  return citationMetrics('OpenAlex', 0, work.id)[0]?.citingUrl || null;
}
