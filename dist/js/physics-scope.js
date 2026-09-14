// Conservative metadata-based scope, not a claim about a paper's scientific merit.
const physicsText = /\b(?:physics|physical review|physica|astrophysics|astronomy|cosmology|gravitation|quantum|optics|photonics|biophysics)\b/i;
const physicsCategory = /(?:^|[\s·,;])(?:astro-ph|cond-mat|hep-(?:th|ph|ex|lat)|nucl-(?:th|ex)|gr-qc|quant-ph|math-ph|physics|nlin)(?:\b|\.)/i;

export function physicsScope(record) {
  const fields = record.disciplineFields || [];
  const categories = record.subject || '';
  if (fields.some(field => /(?:^|\/)31$/.test(field.id || '') || field.display_name === 'Physics and Astronomy')) return 'physics';
  if (physicsCategory.test(categories) || physicsText.test(categories)) return 'physics';
  if ((record.sources || []).includes('INSPIRE')) return 'physics';
  // Journal titles can supply evidence when Crossref has no subject metadata.
  if (physicsText.test(record.venue || '')) return 'physics';
  if (fields.length) return 'other';
  return 'unknown';
}

export function scopeResults(records, { includeOther = false, exactIdentifier = false } = {}) {
  const groups = { physics: [], other: [], unknown: [] };
  for (const record of records) groups[physicsScope(record)].push(record);
  return { ...groups, visible: includeOther || exactIdentifier ? records : groups.physics };
}
