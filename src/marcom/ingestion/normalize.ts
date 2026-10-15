/**
 * Brief normalisation — shared by every intake path (paste, PDF, DOCX, TXT/MD, Google Doc).
 *
 *   raw extracted text -> normaliseBriefText() -> NormalisedBrief -> Brief Analyzer
 *
 * Goals:
 * - Keep useful structure (headings, paragraphs, bullet / numbered lists).
 * - Remove extraction noise (control chars, page markers, repeated running headers/footers,
 *   hyphenation splits, runaway whitespace).
 * - Detect text that is empty or clearly corrupted so we never analyse garbage.
 * - Bound the size sent to the LLM and say so explicitly when we truncate.
 */

/** Hard cap on characters sent to the Brief Analyzer (~8–9k tokens). */
export const MAX_BRIEF_CHARS = 32_000;
/** Below this many meaningful characters a brief cannot be analysed. */
export const MIN_BRIEF_CHARS = 40;

export interface NormalisedBrief {
  text: string;
  /** Characters before truncation. */
  original_length: number;
  truncated: boolean;
  warnings: string[];
}

export interface TextQuality {
  ok: boolean;
  /** Letters + digits as a share of non-whitespace characters. */
  alnum_ratio: number;
  /** Share of characters that are U+FFFD replacement chars or private-use glyphs. */
  garbage_ratio: number;
  word_count: number;
  reason?: 'empty' | 'too_short' | 'corrupted';
}

const BULLET_GLYPHS = /^[\t ]*[•●▪■◦○◆◇►▶➢➤✓✔·\u2022\u2023\u2043\u25E6\uF0B7\uF0A7\uF076\uF0D8]\s*/;
const PAGE_MARKER = /^\s*(?:--\s*\d+\s+of\s+\d+\s*--|page\s+\d+(?:\s+of\s+\d+)?|\d+\s*\/\s*\d+)\s*$/i;

/** Assess whether extracted text looks like real language rather than encoding noise. */
export function assessTextQuality(text: string): TextQuality {
  const nonWs = text.replace(/\s+/g, '');
  const words = text.match(/\p{L}{2,}/gu) ?? [];
  if (!nonWs.length) return { ok: false, alnum_ratio: 0, garbage_ratio: 0, word_count: 0, reason: 'empty' };

  const alnum = (nonWs.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const garbage = (nonWs.match(/[\uFFFD\uE000-\uF8FF]/g) ?? []).length;
  const alnum_ratio = alnum / nonWs.length;
  const garbage_ratio = garbage / nonWs.length;

  if (nonWs.length < MIN_BRIEF_CHARS || words.length < 8) {
    return { ok: false, alnum_ratio, garbage_ratio, word_count: words.length, reason: 'too_short' };
  }
  // Real prose is overwhelmingly letters/digits. Broken font encodings produce symbol soup or U+FFFD.
  if (alnum_ratio < 0.55 || garbage_ratio > 0.1) {
    return { ok: false, alnum_ratio, garbage_ratio, word_count: words.length, reason: 'corrupted' };
  }
  return { ok: true, alnum_ratio, garbage_ratio, word_count: words.length };
}

/**
 * Remove lines that repeat on most pages (running headers / footers like "Confidential – Acme Ltd").
 * Only applied when we know page boundaries.
 */
export function stripRepeatedPageLines(pages: string[]): string[] {
  if (pages.length < 3) return pages;
  const counts = new Map<string, number>();
  for (const page of pages) {
    const lines = new Set(
      page.split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && l.length <= 80),
    );
    for (const l of lines) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.6));
  const repeated = new Set([...counts].filter(([, n]) => n >= threshold).map(([l]) => l));
  if (!repeated.size) return pages;
  return pages.map((page) => page.split('\n').filter((l) => !repeated.has(l.trim())).join('\n'));
}

export function normaliseBriefText(raw: string): NormalisedBrief {
  const warnings: string[] = [];

  let text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // Strip control characters except tab/newline.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\f/g, '\n\n');

  const lines = text.split('\n').map((line) => line.replace(/[ \t]+$/g, ''));
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (PAGE_MARKER.test(line)) continue;
    // Normalise bullet glyphs (PDF symbol fonts often emit private-use chars) to markdown bullets.
    if (BULLET_GLYPHS.test(line)) line = line.replace(BULLET_GLYPHS, '- ');
    // Join words hyphenated across a line break: "recruit-\nment" -> "recruitment".
    const prev = out[out.length - 1];
    if (prev && /\p{Ll}-$/u.test(prev) && /^\p{Ll}/u.test(line.trimStart())) {
      out[out.length - 1] = prev.slice(0, -1) + line.trimStart();
      continue;
    }
    out.push(line.replace(/[ \t]{2,}/g, ' '));
  }
  text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  const original_length = text.length;
  let truncated = false;
  if (text.length > MAX_BRIEF_CHARS) {
    // Cut on a paragraph boundary where possible so we don't split a sentence.
    const cut = text.lastIndexOf('\n\n', MAX_BRIEF_CHARS);
    text = text.slice(0, cut > MAX_BRIEF_CHARS * 0.8 ? cut : MAX_BRIEF_CHARS).trim();
    truncated = true;
    warnings.push(
      `The brief is long (${original_length.toLocaleString()} characters). Only the first ${text.length.toLocaleString()} characters were analysed — check that nothing important appears after that point.`,
    );
  }

  return { text, original_length, truncated, warnings };
}
