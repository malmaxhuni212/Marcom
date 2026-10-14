/**
 * Deterministic QA validator for Personalization (Agent 3).
 *
 * Runs after Model 2 produces copy:
 *  - Checks for forbidden AI cliches ("hope this email finds you well", "in today's fast-paced world", etc.)
 *  - Scans for unfilled template placeholders ([Name], {company}, etc.)
 *  - Validates character and word count budgets (LinkedIn < 300 chars, email 60-180 words)
 *  - Validates that the hook cited actually exists in the research record
 *  - Checks for subject line variety
 *  - Computes a deterministic quality score (0-100)
 */

import type { ResearchRecord } from '../../schemas/research-record';
import type {
  OutreachCopy,
  PersonalizationQA,
  PersonalizationQAIssue,
  StrategyDossier,
} from '../../schemas/personalization';

const BANNED_PATTERNS: { regex: RegExp; code: string; message: string; severity: 'error' | 'warning' }[] = [
  {
    regex: /\bhope this (?:email|message) finds you well\b/i,
    code: 'banned_cliche_hope_finds_well',
    message: 'Generic opening cliche: "hope this email finds you well" is forbidden.',
    severity: 'error',
  },
  {
    regex: /\bhope you(?:'re| are) doing well\b/i,
    code: 'banned_cliche_hope_doing_well',
    message: 'Generic opening cliche: "hope you are doing well" is forbidden.',
    severity: 'error',
  },
  {
    regex: /\b(?:i )?came across your profile\b/i,
    code: 'banned_cliche_came_across_profile',
    message: 'Generic cold outreach cliché: "came across your profile".',
    severity: 'error',
  },
  {
    regex: /\bi wanted to reach out\b/i,
    code: 'banned_cliche_wanted_to_reach_out',
    message: 'Self-centered opening: "I wanted to reach out". Open with their work instead.',
    severity: 'error',
  },
  {
    regex: /\bi am writing to\b/i,
    code: 'banned_cliche_i_am_writing_to',
    message: 'Formal template opener: "I am writing to".',
    severity: 'warning',
  },
  {
    regex: /\bin today'?s (?:fast-paced|dynamic|modern) world\b/i,
    code: 'banned_ai_buzzword_fast_paced_world',
    message: 'AI slop: "in today\'s fast-paced world".',
    severity: 'error',
  },
  {
    regex: /\btouch base\b/i,
    code: 'banned_corporate_touch_base',
    message: 'Corporate jargon: "touch base".',
    severity: 'warning',
  },
  {
    regex: /\bcircle back\b/i,
    code: 'banned_corporate_circle_back',
    message: 'Corporate jargon: "circle back".',
    severity: 'warning',
  },
  {
    regex: /\b(?:synergy|game-changer|revolutionary|cutting-edge)\b/i,
    code: 'banned_marketing_hype',
    message: 'Hype word detected. Use concrete facts instead of marketing fluff.',
    severity: 'error',
  },
  {
    regex: /\b(?:unlock|delve|elevate|leverage)\b/i,
    code: 'banned_ai_tell_word',
    message: 'Overused AI buzzword detected (unlock / delve / elevate / leverage).',
    severity: 'warning',
  },
  {
    regex: /\bdear sir\s*\/\s*madam\b/i,
    code: 'banned_archaic_salutation',
    message: 'Archaic salutation "Dear Sir/Madam". Use person\'s first name or organisation name.',
    severity: 'error',
  },
];

const PLACEHOLDER_REGEX = /(\[[A-Z0-9_\s]{2,30}\]|\{[a-z0-9_]{2,30}\}|<[A-Za-z0-9_\s]{2,30}>)/i;

function countWords(str: string): number {
  return str.trim().split(/\s+/).filter(Boolean).length;
}

/** Check if any key tokens of a hook appear in the research record text. */
function isHookGrounded(hookFact: string, recordText: string): boolean {
  const normRecord = recordText.toLowerCase();
  const tokens = hookFact
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);
  if (!tokens.length) return true;
  // Match if at least 2 significant words or 50% of tokens appear in research
  const matches = tokens.filter((t) => normRecord.includes(t));
  return matches.length >= Math.min(2, tokens.length) || matches.length / tokens.length >= 0.4;
}

export function validatePersonalizationCopy(
  strategy: StrategyDossier,
  copy: OutreachCopy,
  record: ResearchRecord,
): PersonalizationQA {
  const issues: PersonalizationQAIssue[] = [];
  const allCopyText = [
    copy.email_body,
    copy.linkedin_message,
    copy.follow_up_body,
    ...copy.subject_lines.map((s) => s.text),
  ].join('\n');

  // 1. Scan for banned phrases
  for (const ban of BANNED_PATTERNS) {
    if (ban.regex.test(allCopyText)) {
      issues.push({
        severity: ban.severity,
        code: ban.code,
        field: 'email',
        message: ban.message,
      });
    }
  }

  // 2. Scan for unfilled template placeholders (e.g. [Name], {company})
  const placeholderMatch = allCopyText.match(PLACEHOLDER_REGEX);
  if (placeholderMatch) {
    issues.push({
      severity: 'error',
      code: 'unfilled_placeholder',
      field: 'email',
      message: `Unfilled template placeholder found: "${placeholderMatch[0]}". Must use actual names or natural phrasing.`,
    });
  }

  // 3. Email body word budget (ideal 70–150 words)
  const emailWords = countWords(copy.email_body);
  if (emailWords < 45) {
    issues.push({
      severity: 'warning',
      code: 'email_too_short',
      field: 'email',
      message: `Email body is very brief (${emailWords} words). Ensure context and value prop are clear.`,
    });
  } else if (emailWords > 185) {
    issues.push({
      severity: 'warning',
      code: 'email_too_long',
      field: 'email',
      message: `Email body is too long (${emailWords} words; target is 70–150 words). Busy professionals skip long cold emails.`,
    });
  }

  // 4. LinkedIn message character limit (hard ceiling: 300 chars, ideal: <= 280)
  const linkedinChars = copy.linkedin_message.trim().length;
  if (linkedinChars > 300) {
    issues.push({
      severity: 'error',
      code: 'linkedin_character_overflow',
      field: 'linkedin',
      message: `LinkedIn message exceeds 300 character limit (${linkedinChars} chars). It will be truncated or rejected by LinkedIn.`,
    });
  } else if (linkedinChars > 280) {
    issues.push({
      severity: 'warning',
      code: 'linkedin_character_tight',
      field: 'linkedin',
      message: `LinkedIn message is close to the limit (${linkedinChars}/300 chars). Consider trimming slightly.`,
    });
  }

  // 5. Follow-up email word budget (ideal 30–75 words)
  const followUpWords = countWords(copy.follow_up_body);
  if (followUpWords > 95) {
    issues.push({
      severity: 'warning',
      code: 'follow_up_too_long',
      field: 'follow_up',
      message: `Follow-up email is too long (${followUpWords} words; ideal is 30–75 words).`,
    });
  }

  // 6. Subject line variety
  if (copy.subject_lines.length < 2) {
    issues.push({
      severity: 'warning',
      code: 'subject_lines_insufficient',
      field: 'subject',
      message: `Only ${copy.subject_lines.length} subject line generated. 3 variations (direct, curiosity, value) are recommended for testing.`,
    });
  }
  for (const s of copy.subject_lines) {
    if (s.text.length > 65) {
      issues.push({
        severity: 'warning',
        code: 'subject_line_too_long',
        field: 'subject',
        message: `Subject line "${s.text.slice(0, 30)}..." is ${s.text.length} chars (keep under 60 chars for mobile previews).`,
      });
    }
  }

  // 7. Hook ground check against ResearchRecord
  const recordFullText = [
    record.identity.name,
    record.summary,
    ...record.background,
    ...record.work_and_projects,
    ...record.achievements,
    ...record.industry_activity,
    ...record.evidence.map((e) => `${e.claim} ${e.quote ?? ''}`),
  ]
    .filter(Boolean)
    .join(' ');

  const verifiedHookIds: string[] = [];
  for (const hook of strategy.hooks) {
    if (isHookGrounded(hook.fact, recordFullText)) {
      verifiedHookIds.push(hook.id);
    } else {
      issues.push({
        severity: 'warning',
        code: 'hook_ungrounded_in_research',
        field: 'strategy',
        message: `Hook "${hook.id}" (${hook.fact.slice(0, 45)}...) could not be strongly verified in the prospect's research dossier.`,
      });
    }
  }

  // 8. Primary hook usage in copy check
  if (strategy.primary_hook_id) {
    const primaryHook = strategy.hooks.find((h) => h.id === strategy.primary_hook_id);
    if (primaryHook) {
      const hookTokens = primaryHook.fact
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3);
      const copyLower = copy.email_body.toLowerCase();
      const inCopy = hookTokens.some((t) => copyLower.includes(t));
      if (!inCopy && hookTokens.length > 0) {
        issues.push({
          severity: 'warning',
          code: 'primary_hook_omitted_from_copy',
          field: 'email',
          message: `Primary hook "${primaryHook.fact.slice(0, 40)}..." does not appear to be referenced in the email body.`,
        });
      }
    }
  }

  // 9. Contact deliverability & safety check
  if (strategy.contact_audit) {
    const audit = strategy.contact_audit;
    if (audit.email_status === 'fake_or_scraping_artifact' && strategy.recommended_channel === 'email') {
      issues.push({
        severity: 'error',
        code: 'contact_target_unusable_fake',
        field: 'general',
        message: `Deliverability risk: Email address "${audit.best_contact_target}" was flagged as a scraping artifact or bot trap.`,
      });
    }
    if (audit.best_channel === 'none' || !audit.best_contact_target) {
      issues.push({
        severity: 'warning',
        code: 'contact_target_missing',
        field: 'general',
        message: 'No verified contact target identified for outreach.',
      });
    }
  }

  // Compute quality score (100 base)
  let score = 100;
  for (const issue of issues) {
    if (issue.severity === 'error') score -= 30;
    else if (issue.severity === 'warning') score -= 10;
  }
  score = Math.max(0, Math.min(100, score));

  const hasErrors = issues.some((i) => i.severity === 'error');
  const status: PersonalizationQA['status'] = hasErrors ? 'failed' : score >= 80 ? 'passed' : 'needs_review';

  return {
    status,
    score,
    issues,
    verified_hook_ids: verifiedHookIds,
  };
}
