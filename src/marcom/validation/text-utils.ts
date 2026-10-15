/** Deterministic text helpers shared by validation, evaluation and the offline baseline. */

/** Words that describe a qualification without saying how to measure it. */
export const VAGUE_TERMS = [
  'influential',
  'top',
  'leading',
  'major',
  'big',
  'best',
  'well-known',
  'well known',
  'high-profile',
  'prominent',
  'established',
  'successful',
  'reputable',
  'popular',
  'important',
  'key people',
  'notable',
  'serious',
  'quality',
  'good',
] as const;

/** Domain words MARCOM must never introduce unless the brief itself mentions them. */
export const DOMAIN_LEAK_TERMS = [
  'author',
  'authors',
  'filmmaker',
  'filmmakers',
  'film',
  'book',
  'books',
  'publisher',
  'publishers',
  'literary',
  'startup',
  'startups',
  'ai',
  'artificial intelligence',
  'investor',
  'investors',
  'partnership',
  'partnerships',
  'sponsor',
  'sponsors',
] as const;

export const APPROXIMATION_PATTERN =
  /\b(?:around|approximately|approx\.?|roughly|about|circa|nearly|almost|somewhere around|ish)\s+[£$€]?\d[\d,.]*\s*(?:k|m|million|thousand)?(?:\s+[a-z]+)?|~\s*[£$€]?\d[\d,.]*\s*(?:k|m)?(?:\s+[a-z]+)?|\b[£$€]?\d[\d,.]*\s*(?:k|m)?-?ish\b/gi;

export function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function containsWord(haystack: string, word: string): boolean {
  const escaped = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}

export function findVagueTerms(text: string): string[] {
  return VAGUE_TERMS.filter((t) => containsWord(text, t));
}

export function findApproximations(text: string): string[] {
  return [...text.matchAll(APPROXIMATION_PATTERN)].map((m) => m[0].trim());
}

/** Extract numeric tokens (ignores thousands separators): "£1.2m" -> "1.2", "1,000+" -> "1000". */
export function extractNumbers(text: string): string[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, ''));
}

/** Recursively collect string values from an object, skipping the given keys. */
export function collectStrings(value: unknown, skipKeys: string[] = [], out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, skipKeys, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (!skipKeys.includes(k)) collectStrings(v, skipKeys, out);
    }
  }
  return out;
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^[\s\-*•\d.)]+/, '').trim())
    .filter((s) => s.length > 0);
}

export function isWellFormedUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.');
  } catch {
    return false;
  }
}

export const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
