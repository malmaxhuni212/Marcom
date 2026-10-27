/**
 * Deterministic QA validator for Personalization (Agent 3).
 *
 * Runs after Model 2 produces copy and enforces the 10 Personalization Quality Control rules:
 *  1. Specific to recipient (catches generic messages that could be sent to dozens of unrelated people)
 *  2. Opening based on verified & relevant detail (no generic clichés or decorative flattery)
 *  3. Clear connection between recipient and opportunity
 *  4. Explicit, credible recipient incentive (no unsupported guarantees)
 *  5. Natural human voice (no corporate jargon, "explore synergies", or AI slop)
 *  6. Concise, non-promotional structure within channel word/character budgets
 *  7. Low-friction, context-appropriate Call to Action
 *  8. All factual/numeric claims grounded in the Research Record or approved project facts
 *  9. No false urgency, exaggerated promises, or invented familiarity
 * 10. Respects `strategy.avoid` and flags honest limitations when research is sparse/conflicting
 */

import type { ResearchRecord } from '../../schemas/research-record';
import type { StructuredBrief } from '../../schemas/structured-brief';
import type {
  OutreachCopy,
  PersonalizationQA,
  PersonalizationQAIssue,
  PersonalizationSettings,
  StrategyDossier,
} from '../../schemas/personalization';

export interface PersonalizationQAContext {
  brief?: StructuredBrief;
  settings?: PersonalizationSettings;
  allowedFactsText?: string;
}

const BANNED_PATTERNS: { regex: RegExp; code: string; message: string; severity: 'error' | 'warning' }[] = [
  {
    regex: /\bhope this (?:email|message|note) finds you well\b/i,
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
    regex: /\b(?:noticed|admire|impressed by) your (?:impressive |great |amazing |fantastic )?work in the (?:industry|field|sector|space)\b/i,
    code: 'banned_cliche_impressive_work_in_industry',
    message: 'Generic flattery opener: "noticed your impressive work in the industry". Reference a specific verified project or role instead.',
    severity: 'error',
  },
  {
    regex: /\bcongratulations on your continued success\b/i,
    code: 'banned_cliche_continued_success',
    message: 'Empty flattery opener: "Congratulations on your continued success".',
    severity: 'error',
  },
  {
    regex: /\bi wanted to reach out\b/i,
    code: 'banned_cliche_wanted_to_reach_out',
    message: 'Self-centered opening: "I wanted to reach out". Open with a relevant connection to their work instead.',
    severity: 'error',
  },
  {
    regex: /\breaching out to introduce (?:our|myself|my)\b/i,
    code: 'banned_cliche_introduce_organisation',
    message: 'Sender-centric template opener: "reaching out to introduce our organisation". Lead with relevance to the recipient.',
    severity: 'error',
  },
  {
    regex: /\bi am writing to\b/i,
    code: 'banned_cliche_i_am_writing_to',
    message: 'Formal template opener: "I am writing to".',
    severity: 'warning',
  },
  {
    regex: /\bin today'?s (?:fast-paced|dynamic|modern|ever-changing) world\b/i,
    code: 'banned_ai_buzzword_fast_paced_world',
    message: 'AI slop: "in today\'s fast-paced world".',
    severity: 'error',
  },
  {
    regex: /\bexplore synergies\b/i,
    code: 'banned_corporate_explore_synergies',
    message: 'Corporate jargon: "explore synergies" is forbidden. State the concrete opportunity plainly.',
    severity: 'error',
  },
  {
    regex: /\bmutually beneficial partnership\b/i,
    code: 'banned_corporate_mutually_beneficial',
    message: 'Template cliché: "mutually beneficial partnership". Explain the actual benefit for the recipient instead.',
    severity: 'warning',
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
    regex: /\b(?:synergy|synergies|game-changer|revolutionary|cutting-edge)\b/i,
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
  {
    regex: /\b(?:guaranteed (?:exposure|sales|results|roi|reach|coverage|revenue|leads)|we guarantee|guarantee you will)\b/i,
    code: 'unsupported_guarantee',
    message: 'Unsupported guarantee detected. Never promise guaranteed exposure, sales, reach, or outcomes.',
    severity: 'error',
  },
  {
    regex: /\b(?:act now|limited time only|don'?t miss out|once in a lifetime opportunity|spots are filling up fast)\b/i,
    code: 'false_urgency',
    message: 'False urgency or high-pressure sales language detected.',
    severity: 'error',
  },
];

const PLACEHOLDER_REGEX = /(\[[A-Z0-9_\s]{2,30}\]|\{[a-z0-9_]{2,30}\}|<[A-Za-z0-9_\s]{2,30}>)/i;

const GENERIC_STOPWORDS = new Set([
  'about', 'above', 'across', 'after', 'again', 'against', 'along', 'also', 'although', 'always',
  'among', 'around', 'author', 'authors', 'award', 'awards', 'based', 'because', 'been', 'before',
  'being', 'between', 'both', 'book', 'books', 'brief', 'building', 'business', 'campaign', 'Chief',
  'client', 'clients', 'community', 'communities', 'company', 'companies', 'contact', 'could',
  'current', 'currently', 'department', 'director', 'doing', 'during', 'each', 'early', 'editor',
  'email', 'enterprise', 'every', 'executive', 'experience', 'field', 'first', 'focus', 'focused',
  'following', 'founder', 'from', 'further', 'future', 'general', 'global', 'great', 'group',
  'growth', 'having', 'head', 'hello', 'help', 'helping', 'here', 'high', 'however', 'human',
  'impact', 'important', 'include', 'including', 'independent', 'individual', 'industry',
  'information', 'initiative', 'initiatives', 'interest', 'interested', 'into', 'invite', 'involved',
  'known', 'large', 'launch', 'lead', 'leader', 'leading', 'learned', 'level', 'like', 'limited',
  'local', 'looking', 'make', 'making', 'management', 'manager', 'many', 'market', 'marketing',
  'media', 'member', 'members', 'message', 'might', 'more', 'most', 'much', 'multiple', 'name',
  'named', 'national', 'need', 'network', 'next', 'note', 'noted', 'number', 'offer', 'offering',
  'office', 'official', 'often', 'only', 'open', 'operations', 'opportunity', 'opportunities',
  'organisation', 'organization', 'organisations', 'organizations', 'other', 'others', 'outreach',
  'over', 'overview', 'owner', 'page', 'part', 'partner', 'partners', 'partnership', 'partnerships',
  'people', 'person', 'personal', 'platform', 'plus', 'potential', 'practice', 'president',
  'primary', 'product', 'products', 'professional', 'professionals', 'profile', 'program',
  'programme', 'programmes', 'programs', 'project', 'projects', 'public', 'published', 'publisher',
  'publishing', 'quality', 'question', 'range', 'reach', 'reading', 'really', 'recent', 'recently',
  'record', 'region', 'related', 'relevant', 'research', 'resource', 'resources', 'result',
  'results', 'review', 'right', 'role', 'running', 'sales', 'same', 'scale', 'sector', 'seeing',
  'seen', 'senior', 'series', 'service', 'services', 'several', 'share', 'sharing', 'short',
  'should', 'since', 'small', 'social', 'solution', 'solutions', 'some', 'something', 'space',
  'special', 'specific', 'staff', 'stage', 'standard', 'start', 'started', 'state', 'still',
  'strategic', 'strategy', 'strong', 'studio', 'study', 'subject', 'success', 'successful', 'such',
  'support', 'supporting', 'system', 'systems', 'take', 'taking', 'target', 'team', 'teams',
  'technology', 'their', 'them', 'then', 'there', 'these', 'they', 'thing', 'things', 'think',
  'this', 'those', 'through', 'time', 'times', 'title', 'today', 'together', 'tool', 'tools',
  'topic', 'topics', 'total', 'toward', 'towards', 'track', 'training', 'trust', 'type', 'types',
  'under', 'united', 'university', 'until', 'update', 'upon', 'used', 'useful', 'using', 'value',
  'various', 'very', 'view', 'voice', 'want', 'wanted', 'well', 'were', 'what', 'when', 'where',
  'whether', 'which', 'while', 'with', 'within', 'without', 'work', 'working', 'works', 'world',
  'would', 'write', 'writer', 'writers', 'writing', 'year', 'years', 'your', 'yours',
]);

function countWords(str: string): number {
  return str.trim().split(/\s+/).filter(Boolean).length;
}

function extractSpecificTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !GENERIC_STOPWORDS.has(w));
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
  const matches = tokens.filter((t) => normRecord.includes(t));
  return matches.length >= Math.min(2, tokens.length) || matches.length / tokens.length >= 0.4;
}

/** Strip greeting and sign-off lines so we test the substantive body of the email. */
function stripGreetingAndSignoff(emailBody: string, prospectName: string): string {
  const lines = emailBody
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return '';

  // Remove greeting line if it starts with Hi / Hello / Dear
  if (/^(?:hi|hello|dear|good\s+(?:morning|afternoon))\b/i.test(lines[0])) {
    lines.shift();
  }

  // Also strip prospect's own first/last name tokens so merely writing their name doesn't count as specific research usage
  let body = lines.join(' ');
  for (const part of prospectName.split(/\s+/).filter((p) => p.length > 2)) {
    const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    body = body.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), ' ');
  }
  return body;
}

export function validatePersonalizationCopy(
  strategy: StrategyDossier,
  copy: OutreachCopy,
  record: ResearchRecord,
  context?: PersonalizationQAContext,
): PersonalizationQA {
  const issues: PersonalizationQAIssue[] = [];
  const allCopyText = [
    copy.email_body,
    copy.alternative_opening ?? '',
    copy.linkedin_message,
    copy.follow_up_body,
    ...copy.subject_lines.map((s) => s.text),
  ]
    .filter(Boolean)
    .join('\n');

  // 1. Scan for banned phrases, decorative flattery, corporate jargon, false urgency & unsupported guarantees
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
    record.role ?? '',
    record.organisation ?? '',
    record.summary,
    ...record.background,
    ...record.work_and_projects,
    ...record.achievements,
    ...record.industry_activity,
    ...(record.key_contacts ?? []).map((k) => `${k.name} ${k.role ?? ''} ${k.department ?? ''} ${k.relevance ?? ''}`),
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

  // 8. Primary hook usage & Generic-Message-Despite-Facts check (Quality Control #1 & #2)
  const substantiveEmail = stripGreetingAndSignoff(copy.email_body, record.identity.name || '').toLowerCase();
  const specificWorkCorpus = [
    ...record.work_and_projects,
    ...record.achievements,
    ...record.industry_activity,
    ...strategy.hooks.filter((h) => verifiedHookIds.includes(h.id)).map((h) => h.fact),
  ]
    .filter(Boolean)
    .join(' ');
  const specificTokens = Array.from(new Set(extractSpecificTokens(specificWorkCorpus)));
  const matchedSpecificTokens = specificTokens.filter((t) => substantiveEmail.includes(t));

  let primaryHookOmitted = false;
  if (strategy.primary_hook_id) {
    const primaryHook = strategy.hooks.find((h) => h.id === strategy.primary_hook_id);
    if (primaryHook) {
      const hookTokens = Array.from(new Set(extractSpecificTokens(primaryHook.fact)));
      const copyLower = copy.email_body.toLowerCase();
      const matchedHookTokens = hookTokens.filter((t) => copyLower.includes(t));
      const requiredMatches = hookTokens.length >= 3 ? 2 : 1;
      if (hookTokens.length > 0 && matchedHookTokens.length < requiredMatches) {
        primaryHookOmitted = true;
        issues.push({
          severity: primaryHook.strength === 'strong' ? 'error' : 'warning',
          code: 'primary_hook_omitted_from_copy',
          field: 'email',
          message: `Primary hook "${primaryHook.fact.slice(0, 45)}..." is not referenced in the email body. Connect the verified detail to the opportunity.`,
        });
      }
    }
  }

  // If the prospect has specific verified facts (work, projects, achievements, or strong/moderate hooks)
  // but the email body fails to reference specific tokens from their work/projects (or omits a strong primary hook), flag as generic!
  const hasStrongOrModerateHook = strategy.hooks.some(
    (h) => verifiedHookIds.includes(h.id) && (h.strength === 'strong' || h.strength === 'moderate'),
  );
  const minRequiredSpecific = specificTokens.length >= 3 ? 2 : 1;
  if (
    (specificTokens.length >= 2 || hasStrongOrModerateHook) &&
    (matchedSpecificTokens.length < minRequiredSpecific || (primaryHookOmitted && hasStrongOrModerateHook))
  ) {
    issues.push({
      severity: 'error',
      code: 'generic_copy_despite_facts',
      field: 'email',
      message:
        'Message reads like a generic template that could be sent to anyone in the industry despite verified research facts being available. Reference the prospect\'s specific work, programme, or organisation.',
    });
  }

  // 9. Decorative flattery check (mentioning an award/work with "congratulations" without connecting it)
  if (
    /\bcongratulations on (?:winning|your recent|receiving|being awarded)\b/i.test(copy.email_body) &&
    !/\b(?:because|which is why|given your|fits with|aligns with|relevant to)\b/i.test(copy.email_body)
  ) {
    issues.push({
      severity: 'warning',
      code: 'decorative_research_flattery',
      field: 'email',
      message:
        'Opening congratulates the recipient on an achievement without clearly connecting how it relates to the opportunity.',
    });
  }

  // 10. Unsupported factual/numeric claims check (Quality Control #8 & Scenario #10)
  const briefText = context?.brief
    ? JSON.stringify(context.brief)
    : '';
  const settingsFactsText = context?.settings
    ? [
        ...(context.settings.campaign_facts ?? []),
        context.settings.extra_guidance ?? '',
        context.settings.call_to_action_link ?? '',
        context.settings.organisation ?? '',
      ].join(' ')
    : '';
  const allowedCorpus = [
    recordFullText,
    briefText,
    settingsFactsText,
    context?.allowedFactsText ?? '',
    // If no external context was supplied, also allow numbers that were already in the strategy's campaign objective/facts
    !context ? `${strategy.campaign_objective} ${strategy.outreach_goal}` : '',
  ]
    .join(' ')
    .toLowerCase();

  // Check for specific currency figures, percentages, multipliers, or large audience/sales numbers in copy
  const numericClaims = allCopyText.match(
    /(?:(?:£|\$|€)\s?\d[\d,.]*\s*(?:k|m|million|billion|thousand)?|\b\d+(?:\.\d+)?%|\b\d+x\b|\b\d{1,3}(?:,\d{3})+\s*(?:\+)?\s*(?:readers|customers|leads|subscribers|downloads|views|impressions|attendees|users|companies|buyers|members)\b)/gi,
  ) ?? [];

  for (const rawClaim of numericClaims) {
    const cleaned = rawClaim.trim().toLowerCase();
    // Extract the core number/currency token (e.g. "£10,000", "40%", "50,000")
    const coreTokenMatch = cleaned.match(/(?:£|\$|€)\s?\d[\d,.]*\s*(?:k|m)?|\d+(?:\.\d+)?%|\d+x|\d{1,3}(?:,\d{3})+/) ?? [cleaned];
    const coreToken = coreTokenMatch[0].replace(/\s+/g, '');
    const normalizedAllowed = allowedCorpus.replace(/\s+/g, '');
    if (coreToken && !normalizedAllowed.includes(coreToken)) {
      issues.push({
        severity: 'error',
        code: 'unsupported_claim_in_copy',
        field: 'email',
        message: `Unsupported numeric or promotional claim "${rawClaim.trim()}" is not present in the Research Record or confirmed campaign facts.`,
      });
    }
  }

  // Also check for unverified superlative outcome promises (e.g., "double your revenue", "reach millions of readers", "featured in major national press")
  const unverifiedOutcomePatterns: { regex: RegExp; label: string }[] = [
    { regex: /\b(?:double|triple|quadruple|10x) your (?:sales|revenue|pipeline|leads|audience|reach)\b/i, label: 'unverified multiplier outcome claim' },
    { regex: /\breach (?:millions|hundreds of thousands) of (?:readers|customers|buyers|users)\b/i, label: 'unsupported reach claim' },
    { regex: /\bguaranteed (?:press|media|placement|coverage|shortlist|selection)\b/i, label: 'unsupported media/selection guarantee' },
  ];
  for (const pat of unverifiedOutcomePatterns) {
    const match = allCopyText.match(pat.regex);
    if (match && !allowedCorpus.includes(match[0].toLowerCase())) {
      issues.push({
        severity: 'error',
        code: 'unsupported_claim_in_copy',
        field: 'email',
        message: `Unsupported promotional claim "${match[0]}" (${pat.label}) is not backed by approved project facts.`,
      });
    }
  }

  // 11. Check for violations of `strategy.avoid` or `record.contradictions`
  for (const avoidItem of strategy.avoid) {
    // Look for quoted phrases in strategy.avoid (e.g. 'Do not mention "Project Chimera"')
    const quotedMatches = avoidItem.match(/"([^"]{4,60})"/g);
    if (quotedMatches) {
      for (const q of quotedMatches) {
        const phrase = q.slice(1, -1).toLowerCase();
        if (phrase && allCopyText.toLowerCase().includes(phrase)) {
          issues.push({
            severity: 'error',
            code: 'avoid_rule_violated',
            field: 'email',
            message: `Draft mentions "${q.slice(1, -1)}", which was explicitly flagged in Things to Avoid (${avoidItem}).`,
          });
        }
      }
    }
  }

  // 12. Recipient incentive & Low-friction CTA checks (Quality Control #4 & #7)
  if (!strategy.recipient_incentive || strategy.recipient_incentive.trim().length < 8) {
    issues.push({
      severity: 'warning',
      code: 'missing_recipient_incentive',
      field: 'strategy',
      message: 'Recipient incentive is missing or too vague in the strategy dossier.',
    });
  }

  if (!copy.email_body.includes('?')) {
    issues.push({
      severity: 'warning',
      code: 'missing_question_cta',
      field: 'email',
      message: 'Email body does not end with a clear, easy-to-answer question for the recipient.',
    });
  }

  if (/\b(?:30-minute|45-minute|60-minute|an hour of your time|schedule a full demo this week)\b/i.test(copy.email_body)) {
    issues.push({
      severity: 'warning',
      code: 'high_friction_cta',
      field: 'email',
      message: 'Call to action asks for a high-commitment meeting on first contact. Prefer a lower-friction next step.',
    });
  }

  // 13. Alternative opening check
  if (copy.alternative_opening) {
    const normAlt = copy.alternative_opening.trim().toLowerCase();
    const normBody = copy.email_body.trim().toLowerCase();
    if (normAlt.length > 15 && normBody.includes(normAlt)) {
      issues.push({
        severity: 'warning',
        code: 'alternative_opening_duplicate',
        field: 'email',
        message: 'Alternative opening repeats the primary email body verbatim instead of offering a distinct valid angle.',
      });
    }
  }

  // 14. Contact deliverability & safety check
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
