import { SENTENCE_START_REPAIRS } from './calibrations.mjs';

export function slug(value) {
  const text = String(value || '')
    .replace(/\\/g, ' ')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return text || 'item';
}

export function normalizeSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function repairSentenceStart(value) {
  let text = normalizeSpaces(value);
  for (const [pattern, replacement] of SENTENCE_START_REPAIRS) {
    text = text.replace(pattern, replacement);
  }
  if (text && /^[a-z]/.test(text)) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }
  return text;
}

export function cleanDefinition(value, fallback) {
  const text = repairSentenceStart(value)
    .replace(/,\s*,+/g, ',')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+\)/g, ')')
    .replace(/\(\s+/g, '(')
    .replace(/\(\s*\)/g, '')
    .trim();
  const definition = text || fallback;
  return definition.length > 230 ? `${definition.slice(0, 227).replace(/\s+\S*$/, '')}...` : definition;
}

export function compactText(value = '', maxLength = 210) {
  const text = normalizeSpaces(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).replace(/\s+\S*$/, '')}...`;
}
