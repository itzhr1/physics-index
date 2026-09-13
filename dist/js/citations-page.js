import { resolveCitingPapers } from './citation-lookup.js?v=1.4.0';

const status = document.querySelector('#citation-status');
const retry = document.querySelector('#citation-retry');
const destination = document.querySelector('#citation-destination');
async function lookup() {
  retry.hidden = true;
  destination.hidden = true;
  status.textContent = 'Looking up this DOI in OpenAlex…';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14000);
  try {
    const url = await resolveCitingPapers(new URLSearchParams(location.search).get('doi') || '', { signal: controller.signal });
    if (!url) {
      status.textContent = 'No matching OpenAlex record was found. This does not mean the paper has no citations.';
      retry.hidden = false;
      return;
    }
    status.textContent = 'Match found. Opening the OpenAlex citing-paper list…';
    destination.href = url;
    destination.hidden = false;
    location.replace(url);
  } catch (error) {
    status.textContent = error.name === 'AbortError' ? 'The lookup timed out. Please retry.' : `Could not look up citing papers. ${error.message}`;
    retry.hidden = false;
  } finally { clearTimeout(timer); }
}
retry.addEventListener('click', lookup);
void lookup();
