/**
 * Reviewer feedback memory for the Personalization Agent.
 *
 * Feedback given after a draft is generated is stored in the project's
 * personalisation settings JSON (`feedback_memory`) and is:
 *   1. Injected into the Strategist/Writer prompts for every future draft it applies to
 *      (project-wide, same lead category, or only this lead).
 *   2. Used as the primary instruction when the reviewer asks to rewrite a draft from feedback.
 *   3. Applied heuristically by the deterministic fallback writer so it still "learns"
 *      when the LLM is unavailable.
 */

import {
  FEEDBACK_SCOPE_LABELS,
  normalizeCategoryKey,
  type FeedbackScope,
  type LeadPersonalizationSettings,
  type OutreachCopy,
  type PersonalizationFeedback,
  type PersonalizationSettings,
} from '../schemas/personalization';

export const MAX_FEEDBACK_MEMORY = 200;
const MAX_FEEDBACK_IN_PROMPT = 15;

interface FeedbackRecordRef {
  record_id: string;
  target_type?: string | null;
  brief_target_id?: string | null;
  identity?: { name?: string | null } | null;
}

export function createFeedbackItem(input: {
  text: string;
  scope: FeedbackScope;
  record?: FeedbackRecordRef | null;
}): PersonalizationFeedback {
  const record = input.record ?? null;
  return {
    id: `fb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    text: input.text.trim().slice(0, 1_000),
    scope: input.scope,
    record_id: record?.record_id ?? null,
    prospect_name: record?.identity?.name ?? null,
    target_type: record?.target_type ?? null,
    target_id: record?.brief_target_id ?? null,
    created_at: new Date().toISOString(),
  };
}

export function appendFeedback(
  memory: PersonalizationFeedback[] | undefined,
  item: PersonalizationFeedback,
): PersonalizationFeedback[] {
  return [...(memory ?? []), item].slice(-MAX_FEEDBACK_MEMORY);
}

/** Does a stored feedback item apply to this prospect? */
export function feedbackAppliesTo(item: PersonalizationFeedback, record: FeedbackRecordRef): boolean {
  if (item.scope === 'project') return true;
  if (item.scope === 'lead') return item.record_id === record.record_id;
  // category scope
  if (item.target_id && record.brief_target_id && item.target_id === record.brief_target_id) return true;
  if (item.target_type && record.target_type) {
    return normalizeCategoryKey(item.target_type) === normalizeCategoryKey(record.target_type);
  }
  return false;
}

/** Feedback relevant to this prospect, newest first. */
export function getRelevantFeedback(
  settings: Partial<PersonalizationSettings> | null | undefined,
  record: FeedbackRecordRef,
  limit = MAX_FEEDBACK_IN_PROMPT,
): PersonalizationFeedback[] {
  return [...(settings?.feedback_memory ?? [])]
    .filter((item) => feedbackAppliesTo(item, record))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}

export function formatFeedbackPromptBlock(
  feedback: PersonalizationFeedback[],
  options?: { rewriteFeedback?: string | null; previousCopy?: OutreachCopy | null },
): string {
  const lines: string[] = [];

  if (feedback.length > 0) {
    lines.push(
      `\n=== LEARNED REVIEWER PREFERENCES (Feedback from previous drafts — apply to this message) ===`,
      `The reviewer gave this feedback on earlier drafts. Treat it as standing instructions. Newer feedback overrides older feedback if they conflict. Never break factual accuracy to follow it.`,
      ...feedback.map((item) => {
        const scope =
          item.scope === 'lead'
            ? `only for ${item.prospect_name || 'this lead'}`
            : item.scope === 'category'
              ? `for all ${item.target_type || 'leads in this category'}`
              : 'for all messages';
        return `- (${scope}) "${item.text}"`;
      }),
    );
  }

  const rewrite = options?.rewriteFeedback?.trim();
  if (rewrite) {
    lines.push(
      `\n=== REWRITE REQUEST (Highest priority for this draft) ===`,
      `The reviewer read the previous draft and asked for this change: "${rewrite}"`,
      `Rewrite the message so this feedback is clearly and fully applied, while keeping everything that was already good, all verified facts, and the confirmed campaign facts.`,
    );
    if (options?.previousCopy?.email_body) {
      lines.push(`Previous email draft the feedback refers to:\n"""\n${options.previousCopy.email_body}\n"""`);
    }
  }

  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Deterministic application (used by the fallback writer)             */
/* ------------------------------------------------------------------ */

const has = (text: string, pattern: RegExp) => pattern.test(text);

/** Nudges per-lead settings according to the reviewer's feedback (newest feedback wins). */
export function applyFeedbackToLeadSettings(
  leadCfg: LeadPersonalizationSettings,
  feedback: PersonalizationFeedback[],
): LeadPersonalizationSettings {
  const next = { ...leadCfg };
  // Apply oldest first so the newest feedback has the final say
  for (const item of [...feedback].reverse()) {
    const t = item.text.toLowerCase();
    if (has(t, /\b(?:much\s+)?(?:shorter|too long|more concise|cut it down|trim|less wordy|brief(?:er)?)\b/)) {
      next.message_length =
        next.message_length === 'detailed' ? 'balanced' : next.message_length === 'balanced' ? 'short' : 'very_short';
    } else if (has(t, /\b(?:longer|too short|more detail|more context|expand|elaborate)\b/)) {
      next.message_length =
        next.message_length === 'very_short' ? 'short' : next.message_length === 'short' ? 'balanced' : 'detailed';
    }
    if (has(t, /\b(?:more formal|formal|less casual)\b/)) next.tone = 'formal';
    else if (has(t, /\b(?:more casual|less formal|more relaxed|conversational)\b/)) next.tone = 'conversational';
    else if (has(t, /\b(?:friendlier|more friendly|warmer|more warmth)\b/)) next.tone = 'friendly';
    else if (has(t, /\b(?:more confident|more assertive|bolder)\b/)) next.tone = 'confident';
    else if (has(t, /\b(?:more persuasive|sell it more|more convincing)\b/)) next.tone = 'persuasive';

    if (has(t, /\b(?:straight to the point|get to the point|more direct|be direct|no small talk|skip (?:the )?pleasantries)\b/)) {
      next.communication_approach = 'direct';
    }
    if (has(t, /\b(?:clearer ask|clear ask|more direct (?:ask|cta)|ask directly|stronger cta)\b/)) {
      next.call_to_action = 'direct';
    } else if (has(t, /\b(?:softer (?:ask|cta)|less pushy|too pushy|low[- ]pressure)\b/)) {
      next.call_to_action = 'soft';
    }
    if (has(t, /\b(?:explain (?:the project )?more|more about the (?:project|award|competition)|explain what)\b/)) {
      next.explanation_level = 'detailed';
    } else if (has(t, /\b(?:less explanation|explain less|don'?t over[- ]?explain)\b/)) {
      next.explanation_level = 'minimal';
    }
  }
  return next;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Extracts quoted or trailing phrases after a trigger, e.g. don't mention "fees". */
function phrasesAfter(text: string, trigger: RegExp): string[] {
  const out: string[] = [];
  const re = new RegExp(
    `(?:${trigger.source})\\s+(?:"([^"]{3,80})"|'([^']{3,80})'|[\u201c\u2018]([^\u201d\u2019]{3,80})[\u201d\u2019]|([^.,;!?\\n]{3,60}))`,
    'gi',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const phrase = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim().replace(/^(?:the|any|that)\s+/i, '');
    if (phrase.length >= 3) out.push(phrase);
  }
  return out;
}

/** Applies concrete wording-level feedback to a finished message (fallback writer only). */
export function applyFeedbackTextRules(text: string, feedback: PersonalizationFeedback[]): string {
  let out = text;
  for (const item of [...feedback].reverse()) {
    const t = item.text;

    // Drop the generic warm check-in when the reviewer dislikes it
    if (/\b(?:hope (?:your|you'?re|you are)|small talk|pleasantries|filler opening|generic opening)\b/i.test(t)) {
      out = out
        .replace(/\bI hope (?:your|you are|you're|you'?re having a) [^.!?\n]*[.!?]\s*/gi, '')
        .replace(/\bHope your week is going well[.!]?\s*/gi, '');
    }

    // "replace 'A' with 'B'" / "use 'B' instead of 'A'"
    const replaceRe = /replace\s+["'\u201c]([^"'\u201d]{2,60})["'\u201d]\s+with\s+["'\u201c]([^"'\u201d]{1,60})["'\u201d]/gi;
    let m: RegExpExecArray | null;
    while ((m = replaceRe.exec(t)) !== null) {
      out = out.replace(new RegExp(escapeRegex(m[1]!), 'gi'), m[2]!);
    }
    const insteadRe = /use\s+["'\u201c]([^"'\u201d]{1,60})["'\u201d]\s+instead\s+of\s+["'\u201c]([^"'\u201d]{2,60})["'\u201d]/gi;
    while ((m = insteadRe.exec(t)) !== null) {
      out = out.replace(new RegExp(escapeRegex(m[2]!), 'gi'), m[1]!);
    }

    // "don't mention X" / "never mention X" / "remove X" / "avoid X" -> drop sentences containing X
    const banned = phrasesAfter(t, /(?:don'?t|do not|never|stop)\s+(?:mention(?:ing)?|say(?:ing)?|use|using|talk about|bring up)|remove|avoid(?:\s+mentioning)?|no more/);
    for (const phrase of banned) {
      if (/^(?:the\s+)?(?:warm|small talk|pleasantries|em[- ]?dash)/i.test(phrase)) continue;
      const needle = new RegExp(escapeRegex(phrase), 'i');
      out = out
        .split(/\n/)
        .map((line) =>
          needle.test(line)
            ? line
                .split(/(?<=[.!?])\s+/)
                .filter((sentence) => !needle.test(sentence))
                .join(' ')
            : line,
        )
        .join('\n');
    }
  }
  return out.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

export function describeFeedbackScope(scope: FeedbackScope): string {
  return FEEDBACK_SCOPE_LABELS[scope].label;
}
