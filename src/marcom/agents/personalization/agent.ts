/**
 * Personalization Agent (Agent 3) Orchestrator.
 *
 * Implements a strict two-model separation of concerns across any project, industry, audience, and channel:
 *   1. Model 1 (The Strategist):
 *      - Deeply analyzes the project brief, prospect research dossier, and verified evidence.
 *      - Connects verified research facts to a meaningful reason for contacting them (never decoration).
 *      - Identifies the strongest truthful recipient incentive (`recipient_incentive`).
 *      - Rigorously audits all candidate contact routes (direct vs generic vs key contacts vs fake).
 *      - Handles sparse or conflicting research honestly (flags limitations and caps `confidence` instead of manufacturing angles).
 *
 *   2. Model 2 (The Copywriter):
 *      - Receives the StrategyDossier and confirmed campaign facts.
 *      - Produces natural, human, incentive-driven outreach following:
 *        Relevant connection -> Recipient benefit -> Concrete opportunity -> Easy next step.
 *      - Provides an `alternative_opening` when a second verified angle exists (or `null` when research is sparse).
 *      - Self-corrects via deterministic QA validation (`validatePersonalizationCopy`) if clichés, generic copy, unsupported claims, or length limits fail.
 */

import { extractJson, type LLMProvider } from '../../llm/provider';
import { GroqProvider } from '../../llm/groq-provider';
import { loadPersonalizationPrompts } from '../prompt-loader';
import {
  buildContextualTemplateValues,
  type CategoryOutreachTemplate,
  decideTemplateUsageMode,
  defaultLeadPersonalizationSettings,
  extractTemplateDirectives,
  LEAD_APPROACH_LABELS,
  LEAD_CTA_LABELS,
  LEAD_DEPTH_LABELS,
  LEAD_EXPLANATION_LABELS,
  LEAD_LENGTH_LABELS,
  LEAD_TONE_LABELS,
  type LeadPersonalizationSettings,
  type OutreachCopy,
  OutreachCopySchema,
  PERSONALIZATION_VERSION,
  type PersonalizationConfidence,
  type PersonalizationEntry,
  type PersonalizationSettings,
  resolveCategoryTemplateForProspect,
  resolveTemplateDirectivesInText,
  type StrategyDossier,
  StrategyDossierSchema,
  TEMPLATE_USAGE_MODE_LABELS,
  type TemplateUsageMode,
} from '../../schemas/personalization';
import { validatePersonalizationCopy } from './qa';
import type { StructuredBrief } from '../../schemas/structured-brief';
import type { ResearchEntry, ResearchRecord } from '../../schemas/research-record';
import type { MemoryStore } from '../../memory/store';
import { retrieveMemoryContext } from '../../memory/retrieval';
import {
  applyFeedbackTextRules,
  applyFeedbackToLeadSettings,
  formatFeedbackPromptBlock,
  getRelevantFeedback,
} from '../../personalization/feedback';

export interface RunPersonalizationOptions {
  projectId: string;
  brief: StructuredBrief;
  entry: ResearchEntry;
  settings: PersonalizationSettings;
  leadSettings?: LeadPersonalizationSettings;
  store: MemoryStore;
  strategistModel?: string;
  writerModel?: string;
  strategistProvider?: LLMProvider;
  writerProvider?: LLMProvider;
  force?: boolean;
  /** Reviewer feedback on the previous draft that this rewrite must apply. */
  rewriteFeedback?: string | null;
  /** The draft the rewrite feedback refers to. */
  previousCopy?: OutreachCopy | null;
}

export function formatLeadSettingsPromptBlock(
  leadSettings: LeadPersonalizationSettings,
  record: ResearchRecord,
): string {
  const toneLabel = LEAD_TONE_LABELS[leadSettings.tone];
  const lengthLabel = LEAD_LENGTH_LABELS[leadSettings.message_length];
  const depthInfo = LEAD_DEPTH_LABELS[leadSettings.personalization_depth];
  const approachInfo = LEAD_APPROACH_LABELS[leadSettings.communication_approach];
  const explanationInfo = LEAD_EXPLANATION_LABELS[leadSettings.explanation_level];
  const ctaInfo = LEAD_CTA_LABELS[leadSettings.call_to_action];

  const wordBudgetMap: Record<LeadPersonalizationSettings['message_length'], string> = {
    very_short: '40–65 words (1–2 crisp paragraphs; cut all preamble)',
    short: '65–95 words (2–3 concise paragraphs)',
    balanced: '95–130 words (3 well-paced paragraphs)',
    detailed: '130–170 words (3–4 paragraphs with fuller context and proposition detail)',
  };

  return [
    `\n=== INDIVIDUAL LEAD PERSONALIZATION SETTINGS (Configured for ${record.identity.name || 'this prospect'}) ===`,
    `- Tone: ${toneLabel} (${leadSettings.tone})`,
    `- Message Length: ${lengthLabel} — Target email length: ${wordBudgetMap[leadSettings.message_length]}`,
    `- Level of Personalisation: ${depthInfo.label} — ${depthInfo.description}`,
    `- Communication Approach: ${approachInfo.label} — ${approachInfo.description}`,
    `- Explanation Level: ${explanationInfo.label} — ${explanationInfo.description}`,
    `- Call to Action Style: ${ctaInfo.label} — ${ctaInfo.description}`,
    leadSettings.additional_instructions?.trim()
      ? `- Additional User Instructions for This Lead: "${leadSettings.additional_instructions.trim()}"`
      : '',
    `- Good Judgment Rule: Combine Project Brief + Research Record + Memory + these Individual Personalization Settings. Let these settings actively shape the tone, opening flow, research depth, explanation level, and CTA, while adapting naturally to this recipient (${record.role || record.target_type}${record.organisation ? ` at ${record.organisation}` : ''}) so the message never sounds forced or inappropriate.`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatCategoryTemplatePromptBlock(
  resolved: ReturnType<typeof resolveCategoryTemplateForProspect>,
  decision: { mode: TemplateUsageMode; reason: string },
  record: ResearchRecord,
  brief?: StructuredBrief,
  settings?: PersonalizationSettings,
): string {
  const prospectName = record.identity.name || record.organisation || 'this prospect';
  if (!resolved) {
    return [
      `\n=== PROJECT-SPECIFIC CATEGORY OUTREACH TEMPLATE ===`,
      `- No template exists for category "${record.target_type}". Generate a genuinely personalised message using the project brief and available research.`,
    ].join('\n');
  }

  const { template, isCustom } = resolved;
  const modeInfo = TEMPLATE_USAGE_MODE_LABELS[decision.mode];
  const contextualValues = buildContextualTemplateValues(record, brief, settings, template);
  const directives = extractTemplateDirectives(template.body, contextualValues);
  const resolvedPreview = resolveTemplateDirectivesInText(
    template.body,
    record,
    brief,
    settings,
    template,
  );

  const directivesSection =
    directives.length > 0
      ? [
          `\n=== CONTEXTUAL CUES INSIDE THE TEMPLATE (Understand the Intent in Context — Never Leave Raw Brackets/Parentheses) ===`,
          `The template contains bracketed [...] or parenthetical (...) guidance cues. Understand what each cue is asking for in the context of ${prospectName} and resolve it naturally:`,
          ...directives.map(
            (d) =>
              `- ${d.rawToken} -> Understand context (${d.kind.replace(/_/g, ' ')}): ${d.explanation}`,
          ),
          `\n=== TEMPLATE RESOLVED FOR ${prospectName.toUpperCase()} (Use This Structure & Wording for "use" / "adapt") ===\n${resolvedPreview}`,
        ].join('\n')
      : '';

  return [
    `\n=== PROJECT-SPECIFIC CATEGORY OUTREACH TEMPLATE (Category: ${template.target_type}) ===`,
    `Template Source: ${isCustom ? 'Edited & Saved by Project Team' : 'Pre-Built from Project Brief'}`,
    template.subject_line ? `Reference Subject Line: ${template.subject_line}` : '',
    `Reference Message Template:\n${template.body}`,
    directivesSection,
    `\n=== HOW TO USE THIS CATEGORY TEMPLATE FOR ${prospectName.toUpperCase()} ===`,
    `- Primary Reference Framework (NOT Mail-Merge): This template establishes consistent messaging, positioning, and outreach objectives for ${template.target_type}.`,
    `- Recommended Decision for ${prospectName}: ${modeInfo.label.toUpperCase()} (${decision.mode}) — ${decision.reason}`,
    `- CRITICAL IN "use" OR "adapt" MODE: Follow the template's paragraph flow, positioning, confirmed dates (e.g. 4 Jan 2027), prize amounts (e.g. £7,000 / £3,000), and links (e.g. https://poetrybookawards.co.uk). Fulfill every placeholder with natural, prospect-specific verified research. NEVER output raw brackets.
- Category Incentives & Requests:
  * Authors: Opportunity to enter, compete for the prizes, and gain reader recognition.
  * Sponsors / Funders: Appropriate funding/support opportunity with community alignment. Strictly DO NOT invent financial returns or commercial sales ROI.
  * Organisations: Relevant partnership, community engagement, or promotional opportunity for their member writers.`,
    `- Cohesive Flow & Natural Transitions: The message must read as one natural conversation rather than separate sections joined together. Establish a genuine, organic connection between the prospect's verified work and the project before introducing the opportunity. Ensure smooth, logical transitions between the opening hook, project overview, and partnership ask. Tailor the value proposition directly to their specific organisation or remit so the outreach feels convincing, clear, and unawkward.`,
    `- You retain freedom to choose between:`,
    `  * "use" (Use the template): Follow its structure and messaging while adding meaningful, verified personalisation and resolving any contextual cues naturally.`,
    `  * "adapt" (Adapt the template): Preserve the template's core paragraphs, facts, dates, and URL while adapting the research connection and benefit phrasing to weave in the prospect's multiple works or achievements.`,
    `  * "inspiration" (Use it as inspiration): Take the core positioning and objectives, but write a substantially different message.`,
    `  * "ignore" (Ignore the template): Write an entirely original message when the template would produce an irrelevant, unnatural, or less effective result.`,
    `- Never sacrifice message quality or genuine personalisation simply to follow the template.`,
  ]
    .filter(Boolean)
    .join('\n');
}

function hasUsableContactRoute(record: ResearchRecord, strategy: StrategyDossier): boolean {
  if (
    strategy.contact_audit &&
    strategy.contact_audit.best_channel !== 'none' &&
    strategy.contact_audit.best_contact_target &&
    strategy.contact_audit.email_status !== 'fake_or_scraping_artifact'
  ) {
    return true;
  }
  const hasPublicContact = record.public_contact.some(
    (c) => c.value && !/^(?:abuse|privacy|whois|noreply|no-reply|postmaster)@/i.test(c.value),
  );
  const hasKeyContact = (record.key_contacts ?? []).some((k) => Boolean(k.email || k.linkedin_url || k.phone));
  const hasSocial = record.social_profiles.some((s) => Boolean(s.profile_url));
  const hasWebsite = record.websites.some((w) => Boolean(w.url));
  return hasPublicContact || hasKeyContact || hasSocial || hasWebsite;
}

/**
 * Deterministically normalizes and enforces honest guardrails on the StrategyDossier:
 * - Ensures `recipient_incentive` is grounded and non-empty.
 * - Propagates research contradictions into `avoid` and `human_checks`, capping confidence.
 * - When research is sparse or lacks strong/moderate hooks, prevents manufactured familiarity,
 *   caps `confidence` at `'low'`, flags the limitation, and allows an honest role/organisation draft
 *   if a valid contact route exists.
 */
export function normalizeStrategyDossier(
  rawStrategy: StrategyDossier,
  record: ResearchRecord,
  brief: StructuredBrief,
  leadSettings?: LeadPersonalizationSettings,
  settings?: PersonalizationSettings,
): StrategyDossier {
  const strategy: StrategyDossier = {
    ...rawStrategy,
    recipient_priorities: rawStrategy.recipient_priorities ?? '',
    potential_objections: [...(rawStrategy.potential_objections ?? [])],
    narrative_approach: rawStrategy.narrative_approach ?? '',
    avoid: [...rawStrategy.avoid],
    human_checks: [...rawStrategy.human_checks],
    hooks: [...rawStrategy.hooks],
  };

  // Resolve category outreach template & evaluate usage mode for this prospect
  const resolvedTemplate = resolveCategoryTemplateForProspect(record, brief, settings);
  const templateDecision = decideTemplateUsageMode(
    record,
    brief,
    resolvedTemplate?.template,
    leadSettings,
  );
  if (
    !rawStrategy.template_usage_reason ||
    rawStrategy.template_usage_reason.trim().length < 5 ||
    templateDecision.mode === 'ignore'
  ) {
    strategy.template_usage_mode = templateDecision.mode;
    strategy.template_usage_reason = templateDecision.reason;
  } else {
    strategy.template_usage_mode = rawStrategy.template_usage_mode ?? templateDecision.mode;
    strategy.template_usage_reason = rawStrategy.template_usage_reason;
  }

  if (leadSettings) {
    if (leadSettings.personalization_depth === 'light' && strategy.hooks.length > 1) {
      strategy.hooks = strategy.hooks.slice(0, 1);
    } else if (leadSettings.personalization_depth === 'moderate' && strategy.hooks.length > 2) {
      strategy.hooks = strategy.hooks.slice(0, 2);
    }
    const toneRegisterMap: Record<LeadPersonalizationSettings['tone'], StrategyDossier['tone']['register']> = {
      professional: 'warm_professional',
      friendly: 'warm_professional',
      conversational: 'peer',
      confident: 'peer',
      persuasive: 'enthusiastic',
      formal: 'formal',
    };
    strategy.tone = {
      register: toneRegisterMap[leadSettings.tone] ?? strategy.tone.register,
      guidance: `${LEAD_TONE_LABELS[leadSettings.tone]} tone, ${LEAD_LENGTH_LABELS[leadSettings.message_length].toLowerCase()} length, ${LEAD_APPROACH_LABELS[leadSettings.communication_approach].label.toLowerCase()} approach, ${LEAD_EXPLANATION_LABELS[leadSettings.explanation_level].label.toLowerCase()} explanation.${leadSettings.additional_instructions ? ` Additional guidance: ${leadSettings.additional_instructions}` : ''}`,
    };
  }

  // 1. Ensure recipient_incentive is always present and grounded
  if (!strategy.recipient_incentive || strategy.recipient_incentive.trim().length < 8) {
    const primaryObj = brief.project.primary_objective || brief.project.description || strategy.outreach_goal;
    strategy.recipient_incentive = strategy.outreach_goal
      ? `${strategy.outreach_goal} (${primaryObj})`
      : `Relevant opportunity aligned with ${record.organisation || record.role || record.target_type}: ${primaryObj}`;
  }

  // 2. Ensure angle is concise and specific
  if (!strategy.angle || strategy.angle.trim().length < 5) {
    strategy.angle = strategy.relevance_thesis || `Relevant ${record.target_type} alignment with ${brief.project.name || 'the project'}.`;
  }

  // 3. Ensure recipient_priorities is grounded in verified evidence or honest role remit
  if (!strategy.recipient_priorities || strategy.recipient_priorities.trim().length < 5) {
    const topWork = record.work_and_projects[0] || record.industry_activity[0];
    strategy.recipient_priorities = topWork
      ? `Focused on ${topWork}${record.organisation ? ` at ${record.organisation}` : ''}.`
      : `Professional remit as ${record.role || record.target_type}${record.organisation ? ` at ${record.organisation}` : ''}.`;
  }

  // 4. Check for sparse research or lack of compelling personal angle
  const substantiveFactsCount =
    record.work_and_projects.length + record.achievements.length + record.industry_activity.length;
  const strongOrModerateHooks = strategy.hooks.filter(
    (h) => h.strength === 'strong' || h.strength === 'moderate',
  );
  const isSparseResearch =
    substantiveFactsCount === 0 ||
    strongOrModerateHooks.length === 0 ||
    record.research_confidence === 'low';

  let confidence: PersonalizationConfidence = strategy.confidence || 'medium';

  if (isSparseResearch) {
    confidence = 'low';
    const limitationNote =
      'Limited person-level research available: using an honest role/organisation-level angle rather than manufacturing personal familiarity.';
    if (!strategy.human_checks.some((c) => c.toLowerCase().includes('limited') || c.toLowerCase().includes('sparse'))) {
      strategy.human_checks.push(limitationNote);
    }
    const avoidFabrication =
      'Do not manufacture personal hooks, unverified projects, or fake familiarity not grounded in the Research Record.';
    if (!strategy.avoid.some((a) => a.toLowerCase().includes('manufacture') || a.toLowerCase().includes('unverified'))) {
      strategy.avoid.push(avoidFabrication);
    }

    if (!strategy.narrative_approach || strategy.narrative_approach.trim().length < 5) {
      strategy.narrative_approach =
        'Lead directly and honestly with the opportunity and why their role or organisation is relevant, without pretending to have deep personal research.';
    }
    if (strategy.potential_objections.length === 0) {
      strategy.potential_objections.push(
        'Recipient may not be the direct handler for this remit — offer an easy option to point us to the appropriate colleague.',
      );
    }

    // Section 8/9 requirement: "If the research does not support meaningful personalisation, do not fabricate it.
    // Use the strongest honest approach available and flag the limitation."
    if (
      strategy.readiness === 'needs_more_research' &&
      record.identity.identity_verified &&
      hasUsableContactRoute(record, strategy)
    ) {
      strategy.readiness = 'ready';
      strategy.readiness_reason = `${strategy.readiness_reason} (Proceeding with honest role/organisation-level draft and low confidence flag).`;
    }
  } else {
    if (!strategy.narrative_approach || strategy.narrative_approach.trim().length < 5) {
      strategy.narrative_approach =
        'Connect their verified work directly to the value exchange and desired action in a natural, non-formulaic flow tailored to the channel.';
    }
    if (strategy.potential_objections.length === 0) {
      strategy.potential_objections.push(
        'Time commitment or immediate fit uncertainty — keep the next step low-friction and proportionate.',
      );
    }
  }

  // 4. Propagate conflicting or uncertain research information into `avoid` & `human_checks`
  if (record.contradictions.length > 0) {
    confidence = 'low';
    for (const contradiction of record.contradictions) {
      const avoidEntry = `Conflicting research — do not state as fact: ${contradiction}`;
      if (!strategy.avoid.some((a) => a.includes(contradiction))) {
        strategy.avoid.push(avoidEntry);
      }
      const checkEntry = `Verify conflicting detail before sending: ${contradiction}`;
      if (!strategy.human_checks.some((c) => c.includes(contradiction))) {
        strategy.human_checks.push(checkEntry);
      }
    }
  }

  if (record.unknowns.length > 0 && confidence === 'high' && strongOrModerateHooks.length < 2) {
    confidence = 'medium';
  }

  strategy.confidence = confidence;
  return strategy;
}

export function buildStrategistUserPrompt(
  brief: StructuredBrief,
  research: ResearchEntry,
  settings: PersonalizationSettings,
  memoryNote: string,
  leadSettings?: LeadPersonalizationSettings,
  rewriteFeedback?: string | null,
): string {
  const r = research.record;
  const resolvedLeadSettings = leadSettings ?? settings.lead_settings?.[r.record_id];
  const target = (brief.targets as any[]).find((t) => t.id === r.brief_target_id) || brief.targets?.[0];

  const evidenceFormatted = r.evidence
    .slice(0, 10)
    .map((e) => `- Claim: "${e.claim}" (Sources: ${e.source_ids.join(', ')}) ${e.quote ? `Quote: "${e.quote}"` : ''}`)
    .join('\n');

  // Candidate Contact Routes Extraction & Classification
  const candidateRoutes: string[] = [];

  for (const c of r.public_contact.slice(0, 3)) {
    candidateRoutes.push(`- [Contact:${c.kind}] Value: ${c.value} (Confidence: ${c.confidence}, Professional: ${c.is_professional ? 'Yes' : 'No'})`);
  }

  for (const w of r.websites.slice(0, 2)) {
    candidateRoutes.push(`- [Website:${w.type}] URL: ${w.url}${w.title ? ` (Title: ${w.title})` : ''}`);
  }

  for (const s of r.social_profiles.slice(0, 8)) {
    const isPersonal = s.profile_url.includes('/in/') || !s.profile_url.includes('/company/');
    candidateRoutes.push(`- [Social:${s.platform}] URL: ${s.profile_url} (Type: ${isPersonal ? 'Personal Profile' : 'Company/Org Page'}, Verified: ${s.verified_status ? 'Yes' : 'No'})`);
  }

  for (const person of (r.key_contacts ?? []).slice(0, 6)) {
    const roleLabel = [person.role, person.department].filter(Boolean).join(' · ') || 'Relevant Contact';
    if (person.email) {
      candidateRoutes.push(
        `- [KeyContact:${person.name} — ${roleLabel}] Direct Email: ${person.email} (Confidence: ${person.confidence}${person.relevance ? `, Relevance: ${person.relevance}` : ''})`,
      );
    }
    if (person.linkedin_url) {
      candidateRoutes.push(
        `- [KeyContact:${person.name} — ${roleLabel}] Personal LinkedIn: ${person.linkedin_url} (Confidence: ${person.confidence}${person.relevance ? `, Relevance: ${person.relevance}` : ''})`,
      );
    }
    if (person.phone) {
      candidateRoutes.push(`- [KeyContact:${person.name} — ${roleLabel}] Phone: ${person.phone} (Confidence: ${person.confidence})`);
    }
    if (!person.email && !person.linkedin_url && !person.phone) {
      candidateRoutes.push(`- [KeyContact:${person.name} — ${roleLabel}] Identified handler (${person.relevance || 'Relevant role'})`);
    }
  }

  // Also include any contact mentions in evidence quotes
  const contactEvidence = r.evidence
    .filter(
      (e) =>
        e.field === 'public_contact' ||
        e.field === 'social_profiles' ||
        e.claim.toLowerCase().includes('email'),
    )
    .slice(0, 2)
    .map((e) => `  * Evidence note: "${e.claim}"`);

  if (contactEvidence.length) {
    candidateRoutes.push(...contactEvidence);
  }

  const routesFormatted = candidateRoutes.length
    ? candidateRoutes.join('\n')
    : '- No direct contact routes, websites, or social links recorded';

  const factsList = settings.campaign_facts.length
    ? settings.campaign_facts.map((f) => `- ${f}`).join('\n')
    : '- (No extra campaign facts provided; rely strictly on the project brief)';

  const secondaryObjectives = Array.isArray((brief.project as any).secondary_objectives)
    ? (brief.project as any).secondary_objectives.join('; ')
    : '';
  const outreachObjectives = Array.isArray((brief as any).outreach_objectives)
    ? (brief as any).outreach_objectives
        .map((o: any) => (typeof o === 'string' ? o : `${o.objective || o.title || ''}: ${o.description || ''}`))
        .join('; ')
    : '';

  return [
    `=== PROJECT & BRIEF ===`,
    `Project: ${brief.project.name || 'Outreach Project'}`,
    brief.project.description ? `Project Description: ${brief.project.description}` : '',
    `Primary Objective: ${brief.project.primary_objective || brief.project.description}`,
    secondaryObjectives ? `Secondary Objectives: ${secondaryObjectives}` : '',
    outreachObjectives ? `Outreach Objectives: ${outreachObjectives}` : '',
    `Target Audience: ${target?.target_type || r.target_type} (${target?.entity_kind || r.identity.entity_kind || 'person'})`,
    target?.description ? `Target Description: ${target.description}` : '',
    `Personalization Allowed: ${brief.personalization.allowed.join('; ') || 'Standard professional'}`,
    `Personalization Preferred: ${brief.personalization.preferred_details.join('; ') || 'Specific projects, programmes, roles, achievements'}`,
    `Tone Required: ${brief.personalization.tone.join(', ') || 'Professional, human, conversational'}`,
    `Forbidden In Brief: ${brief.personalization.avoid.join('; ') || 'Generic flattery, unsupported guarantees, invasive details'}`,
    settings.extra_guidance ? `Extra Team Guidance: ${settings.extra_guidance}` : '',

    `\n=== CONFIRMED CAMPAIGN FACTS (Only these may be mentioned) ===`,
    factsList,
    settings.call_to_action_link ? `Campaign Link: ${settings.call_to_action_link}` : '',

    `\n=== PROSPECT RESEARCH DOSSIER ===`,
    `Name: ${r.identity.name || research.seed.name}`,
    `Entity Kind: ${r.identity.entity_kind}`,
    `Identity Verified: ${r.identity.identity_verified}`,
    `Research Confidence: ${r.research_confidence}`,
    `Role: ${r.role || 'Unknown'}`,
    `Organisation: ${r.organisation || 'Independent'}`,
    `Location: ${r.location || r.country || 'Unknown'}`,
    `Background: ${r.background.slice(0, 5).join('; ') || 'Not specified'}`,
    `Work & Projects: ${r.work_and_projects.slice(0, 8).join('; ') || 'None listed'}`,
    `Achievements & Awards: ${r.achievements.slice(0, 6).join('; ') || 'None listed'}`,
    `Industry Activity: ${r.industry_activity.slice(0, 4).join('; ') || 'None listed'}`,
    `Summary: ${r.summary}`,
    `Evidence Highlights:\n${evidenceFormatted || '- No direct evidence quotes'}`,
    r.contradictions.length
      ? `Contradictions / Uncertain Info (DO NOT state as fact; add to avoid): ${r.contradictions.join('; ')}`
      : '',
    r.unknowns.length ? `Known Unknowns: ${r.unknowns.map((u) => `${u.field} (${u.reason})`).join('; ')}` : '',
    research.qa.issues.length ? `QA Flags: ${research.qa.issues.map((i) => `[${i.severity}] ${i.message}`).join('; ')}` : '',

    `\n=== CANDIDATE CONTACT ROUTES TO AUDIT ===`,
    routesFormatted,

    `\n=== STRATEGIC & CONTACT AUDIT INSTRUCTIONS ===`,
    `1. Understand the recipient before writing — do NOT impose a fixed message structure or universal template:`,
    `   - What do they care about professionally based on verified evidence? ('recipient_priorities')`,
    `   - Why are we contacting this recipient specifically? ('relevance_thesis' & 'angle' — connect verified facts to the opportunity, never decorative praise or biographical recaps)`,
    `   - What is the credible value exchange for them? ('recipient_incentive' — why considering the request is worthwhile for them, without unsupported promises)`,
    `   - What objections, uncertainties, or practical considerations might prevent them from responding? ('potential_objections')`,
    `   - What natural opening style and flow fits this specific recipient, purpose (invitation, sponsorship, partnership, sales, recruitment, PR), and channel? ('narrative_approach')`,
    `   - What action does the project need them to take, and what is the proportionate next step? ('outreach_goal' & 'call_to_action')`,
    `2. Assess Personalization Confidence ('confidence': 'high' | 'medium' | 'low'):`,
    `   - If research is sparse or no strong personalised angle can be established, do NOT manufacture one. Set confidence to 'low', use an honest opportunity-led or role-relevant approach, and note the limitation in 'human_checks'.`,
    `   - If contradictions exist in the research record, put disputed claims in 'avoid' and set confidence to 'low'.`,
    `3. Rigorously evaluate every contact route and populate 'contact_audit' completely.`,

    memoryNote ? `\n=== MEMORY CONTEXT & RELATIONSHIP HISTORY ===\n${memoryNote}` : '',
    formatCategoryTemplatePromptBlock(
      resolveCategoryTemplateForProspect(r, brief, settings),
      decideTemplateUsageMode(
        r,
        brief,
        resolveCategoryTemplateForProspect(r, brief, settings)?.template,
        resolvedLeadSettings,
      ),
      r,
      brief,
      settings,
    ),
    resolvedLeadSettings ? formatLeadSettingsPromptBlock(resolvedLeadSettings, r) : '',
    formatFeedbackPromptBlock(getRelevantFeedback(settings, r), { rewriteFeedback }),

    `\nAnalyze this prospect thoroughly. Output the JSON StrategyDossier object only.`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildWriterUserPrompt(
  strategy: StrategyDossier,
  research: ResearchEntry,
  settings: PersonalizationSettings,
  prospectName: string,
  brief?: StructuredBrief,
  leadSettings?: LeadPersonalizationSettings,
  rewriteFeedback?: string | null,
  previousCopy?: OutreachCopy | null,
): string {
  const resolvedLeadSettings = leadSettings ?? settings.lead_settings?.[research.record.record_id];
  const hooksFormatted = strategy.hooks
    .map(
      (h) =>
        `- [${h.id}] (${h.strength}) ${h.fact}${h.evidence_quote ? ` (Evidence: "${h.evidence_quote}")` : ''}\n  Connection to opportunity: ${h.why_it_resonates}`,
    )
    .join('\n');

  const factsList = settings.campaign_facts.length
    ? settings.campaign_facts.map((f) => `- ${f}`).join('\n')
    : '- (Rely strictly on the project brief and strategy dossier)';

  const audit = strategy.contact_audit;
  const keyPeopleLines = (research.record.key_contacts ?? [])
    .slice(0, 4)
    .map((p) => `- ${p.name}${p.role ? ` (${p.role}${p.department ? `, ${p.department}` : ''})` : ''}: ${[p.email, p.linkedin_url, p.relevance].filter(Boolean).join(' · ')}`)
    .join('\n');

  const hasMultipleAngles =
    strategy.hooks.filter((h) => h.strength === 'strong' || h.strength === 'moderate').length >= 2 ||
    research.record.work_and_projects.length + research.record.achievements.length >= 2;

  const isOrg = research.record.identity.entity_kind === 'organisation';
  const cleanFirstName = prospectName
    .replace(/^(?:dr|prof|mr|ms|mrs|miss)\.?\s+/i, '')
    .replace(/\([^)]*\)/g, '')
    .trim()
    .split(/\s+/)[0] || prospectName;
  const recommendedGreeting = isOrg ? `Hi ${prospectName} team,` : `Hi ${cleanFirstName},`;

  return [
    `=== PROJECT CONTEXT ===`,
    brief?.project?.name ? `Project Name: ${brief.project.name}` : '',
    brief?.project?.description ? `What the Project Is (Plain Description): ${brief.project.description}` : '',
    brief?.project?.primary_objective ? `Project Objective: ${brief.project.primary_objective}` : '',
    `Campaign Objective for Prospect: ${strategy.campaign_objective}`,

    `\n=== SENDER IDENTITY ===`,
    `Sender Name: ${settings.sender_name || 'Campaign Team'}`,
    settings.sender_role ? `Sender Role: ${settings.sender_role}` : '',
    settings.organisation ? `Organisation: ${settings.organisation}` : '',
    settings.signature ? `Signature Block: ${settings.signature}` : '',

    `\n=== CONFIRMED CAMPAIGN FACTS (Do not invent any numbers, dates, or claims beyond this) ===`,
    factsList,
    settings.call_to_action_link ? `Action Link: ${settings.call_to_action_link}` : '',

    `\n=== STRATEGY DOSSIER FOR ${prospectName.toUpperCase()} ===`,
    `Entity Kind: ${research.record.identity.entity_kind}`,
    `Recommended Greeting: ${recommendedGreeting} (NEVER write "Hi support team," or bare "Hi,")`,
    `Prospect Snapshot: ${strategy.prospect_snapshot}`,
    strategy.recipient_priorities ? `Recipient Professional Priorities: ${strategy.recipient_priorities}` : '',
    `Personalization Confidence: ${strategy.confidence.toUpperCase()}`,
    `Why Them Specifically (Relevance Thesis): ${strategy.relevance_thesis}`,
    `Personalization Angle: ${strategy.angle}`,
    `Recipient Incentive / Value Exchange: ${strategy.recipient_incentive}`,
    strategy.potential_objections?.length
      ? `Practical Considerations / Objections to Address Naturally:\n${strategy.potential_objections.map((o) => `- ${o}`).join('\n')}`
      : '',
    strategy.narrative_approach
      ? `Adaptive Narrative Approach (No rigid template): ${strategy.narrative_approach}`
      : '',
    `Desired Action / Outreach Goal: ${strategy.outreach_goal}`,
    `Tone Register: ${strategy.tone.register} (${strategy.tone.guidance})`,
    `Recommended Channel: ${strategy.recommended_channel}`,
    audit ? `Best Contact Target: ${audit.best_contact_target} (${audit.best_channel})` : '',
    audit ? `Channel Context: ${audit.is_direct_contact ? 'Direct 1-to-1 conversation with the individual / named handler' : 'Role-based or team inbox (e.g. partnerships/submissions/enquiries)'}` : '',
    audit ? `Why this route: ${audit.why_best_route}` : '',
    keyPeopleLines ? `Key Decision-Makers at Organisation:\n${keyPeopleLines}` : '',
    `Proportionate Call to Action (Ask): ${strategy.call_to_action}`,
    `Primary Hook ID: ${strategy.primary_hook_id || 'None'}`,
    `Verified Hooks:\n${hooksFormatted || '- None (use honest role/organisation relevance without manufacturing personal hooks)'}`,
    `Alternative Opening Instruction: ${
      hasMultipleAngles
        ? 'Provide one meaningfully different 1-2 sentence opening in "alternative_opening" based on a secondary verified hook or distinct opportunity-first angle (plain text, no asterisks).'
        : 'Only one honest angle exists (sparse research); set "alternative_opening" to null.'
    }`,
    `Strictly Avoid for This Prospect:\n${strategy.avoid.map((a) => `- ${a}`).join('\n') || '- None'}`,
    strategy.human_checks.length
      ? `Limitations / Reviewer Notes:\n${strategy.human_checks.map((c) => `- ${c}`).join('\n')}`
      : '',
    formatCategoryTemplatePromptBlock(
      resolveCategoryTemplateForProspect(research.record, brief, settings),
      {
        mode:
          strategy.template_usage_mode ??
          decideTemplateUsageMode(
            research.record,
            brief,
            resolveCategoryTemplateForProspect(research.record, brief, settings)?.template,
            resolvedLeadSettings,
          ).mode,
        reason:
          strategy.template_usage_reason ||
          decideTemplateUsageMode(
            research.record,
            brief,
            resolveCategoryTemplateForProspect(research.record, brief, settings)?.template,
            resolvedLeadSettings,
          ).reason,
      },
      research.record,
      brief,
      settings,
    ),
    resolvedLeadSettings ? formatLeadSettingsPromptBlock(resolvedLeadSettings, research.record) : '',
    formatFeedbackPromptBlock(getRelevantFeedback(settings, research.record), {
      rewriteFeedback,
      previousCopy,
    }),

    `\n=== WRITING STYLE & CONVERSION REQUIREMENTS ===`,
    `1. Greeting & Opening: Start with "${recommendedGreeting}". Match your opening sentence to the prospect's Communication Approach (${resolvedLeadSettings ? LEAD_APPROACH_LABELS[resolvedLeadSettings.communication_approach].label : 'warm and natural'}): if Relationship-first or Friendly, open with a warm human check-in and connection; if Direct or Opportunity-first, lead immediately with the relevant point or opportunity without filler.`,
    `2. Explain the Project Clearly (Calibrated to Explanation Level: ${resolvedLeadSettings ? LEAD_EXPLANATION_LABELS[resolvedLeadSettings.explanation_level].label : 'Balanced'}): The recipient may not know ${brief?.project?.name || settings.organisation || 'our project'} yet. Introduce what the project offers and why it matters clearly, and prioritize what the recipient stands to gain (Recipient Incentive).`,
    `3. Concise, Human Voice (Target Length: ${resolvedLeadSettings ? LEAD_LENGTH_LABELS[resolvedLeadSettings.message_length] : 'Short and concise'}): Use plain, everyday English that feels individually written. Avoid repetitive explanations, excessive compliments, and corporate jargon.`,
    `4. NO EM-DASHES (—) OR ASTERISKS (*): Never use the "—" character or markdown asterisks (*title*) anywhere in the message text or subject lines. Use commas or periods instead.`,
    `5. Clear Next Step (CTA Style: ${resolvedLeadSettings ? LEAD_CTA_LABELS[resolvedLeadSettings.call_to_action].label : 'Soft and low-pressure'}): Make the requested action clear and easy to reply to. Output JSON only.`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function normalizeOutreachCopy(
  copy: OutreachCopy,
  record: ResearchRecord,
  prospectName: string,
  leadSettings?: LeadPersonalizationSettings,
  brief?: StructuredBrief,
  settings?: PersonalizationSettings,
): OutreachCopy {
  const activeTemplate = resolveCategoryTemplateForProspect(record, brief, settings)?.template ?? null;
  const cleanText = (text: string) =>
    resolveTemplateDirectivesInText(text, record, brief, settings, activeTemplate)
      .replace(/\*+([^*\n]+)\*+/g, '$1')
      // Replace non-breaking hyphens with normal hyphens
      .replace(/\u2011/g, '-')
      // Replace paired em-dashes (e.g. " — phrase — ") or single em-dashes/spaced en-dashes with a clean comma
      .replace(/\s*\u2014\s*([^\u2014\n.!?;]+?)\s*\u2014\s*/g, ', $1, ')
      .replace(/\s*[\u2014\u2013]\s*/g, ', ')
      .replace(/,\s*,/g, ',')
      .replace(/\.\s*,/g, '.')
      // Replace robotic "including titles like" / "such as titles like" / "including works like" with "especially"
      .replace(/\b(?:including|such as) (?:titles|books|works|projects) like\b/gi, 'especially')
      .trim();

  const isOrg = record.identity.entity_kind === 'organisation';
  const cleanFirstName =
    prospectName
      .replace(/^(?:dr|prof|mr|ms|mrs|miss)\.?\s+/i, '')
      .replace(/\([^)]*\)/g, '')
      .trim()
      .split(/\s+/)[0] || prospectName;
  const isFormal = leadSettings?.tone === 'formal';
  const properGreeting = isFormal
    ? `Dear ${isOrg ? `${prospectName} team` : cleanFirstName},`
    : isOrg
      ? `Hi ${prospectName} team,`
      : `Hi ${cleanFirstName},`;

  const templateHasWarmStart = activeTemplate
    ? /\b(?:i hope\b|hope\s+(?:you|your)\b)/i.test(activeTemplate.body)
    : true;
  const shouldEnsureWarmCheckIn = activeTemplate
    ? templateHasWarmStart
    : leadSettings
      ? (leadSettings.communication_approach === 'relationship_first' || leadSettings.tone === 'friendly') &&
        leadSettings.message_length !== 'very_short'
      : true;

  const fixGreetingAndWarmth = (body: string, ensureWarmStart: boolean): string => {
    let cleaned = cleanText(body);
    // Replace bare "Hi," / "Hello," or awkward "Hi support team," / "Hi info team," with proper greeting
    cleaned = cleaned.replace(
      /^(?:hi|hello|dear)(?:\s+(?:support|info|admin|enquiries|inquiries|general|helpdesk)?\s*team)?\s*,/i,
      properGreeting,
    );
    if (isFormal) {
      cleaned = cleaned.replace(/^hi\s+([^,\n]+),/i, 'Dear $1,');
    }

    if (!ensureWarmStart) return cleaned;

    const parts = cleaned.split(/\n\s*\n/);
    if (parts.length >= 2 && /^(?:hi|hello|dear)\b/i.test(parts[0]!.trim())) {
      const firstPara = parts[1]!.trim();
      const hasWarmStart = /^(?:i hope\b|hope\s+(?:you|your|things|all)\b|wishing\s+you\b|thank\s+you\b|thanks\s+for\b|it'?s\s+great\b|great\s+to\b|i\s+came\s+across\b)/i.test(
        firstPara,
      );
      if (!hasWarmStart) {
        parts[1] = `I hope your week is going well. ${firstPara}`;
        cleaned = parts.join('\n\n');
      }
    }
    return cleaned;
  };

  return {
    ...copy,
    subject_lines: copy.subject_lines.map((s) => ({
      ...s,
      text: cleanText(s.text),
    })),
    email_body: fixGreetingAndWarmth(copy.email_body, shouldEnsureWarmCheckIn),
    alternative_opening: copy.alternative_opening ? cleanText(copy.alternative_opening) : null,
    linkedin_message: cleanText(copy.linkedin_message).replace(
      /^(?:hi|hello)\s+(?:support|info|admin|enquiries|inquiries|general)\s+team\s*,/i,
      `Hi ${isOrg ? `${prospectName} team` : cleanFirstName},`,
    ),
    follow_up_body: fixGreetingAndWarmth(copy.follow_up_body, false),
    hook_usage: cleanText(copy.hook_usage),
  };
}

export async function runPersonalizationAgent(options: RunPersonalizationOptions): Promise<PersonalizationEntry> {
  const {
    projectId,
    brief,
    entry,
    settings,
    leadSettings,
    store,
    strategistModel = 'openai/gpt-oss-20b',
    writerModel = 'openai/gpt-oss-20b',
    force = false,
  } = options;

  const prompts = loadPersonalizationPrompts();
  const record = entry.record;
  const prospectName = record.identity.name || entry.seed.name;
  const resolvedLeadSettings = leadSettings ?? settings.lead_settings?.[record.record_id];
  const learnedFeedback = getRelevantFeedback(settings, record);

  // Retrieve project and relationship memory
  const memoryContext = retrieveMemoryContext(
    {
      task: 'personalization',
      project_id: projectId,
      target_type: record.target_type,
      prospect_names: [prospectName],
    },
    store,
  );

  const memoryNotes: string[] = [];
  const rel = (memoryContext.relationship_context as any[]).find((r) => r.prospect_id === record.matched_prospect_id);
  if (rel) {
    memoryNotes.push(`Relationship status: ${rel.status} (${rel.events.length} past events)`);
  }
  for (const d of memoryContext.human_decisions) {
    memoryNotes.push(`Human Decision: [${d.decision}] ${d.reason}`);
  }

  // -------------------------------------------------------------
  // MODEL 1: The Strategist
  // -------------------------------------------------------------
  const strategistProvider: LLMProvider =
    options.strategistProvider ?? new GroqProvider({ model: strategistModel, pool: 'personalization' });
  const strategistPrompt = buildStrategistUserPrompt(
    brief,
    entry,
    settings,
    memoryNotes.join('\n'),
    resolvedLeadSettings,
    options.rewriteFeedback,
  );

  let strategy: StrategyDossier | null = null;
  const tStrategistStart = Date.now();

  try {
    const rawStrategy = await (strategistProvider as GroqProvider).complete(
      {
        system: `${prompts.globalRules}\n\n${prompts.strategist}`,
        user: strategistPrompt,
        maxTokens: 2500,
      },
      { temperature: 0.15, reasoningEffort: 'low' },
    );
    const parsed = extractJson(rawStrategy);
    const parsedStrategy = StrategyDossierSchema.parse(parsed);
    strategy = normalizeStrategyDossier(parsedStrategy, record, brief, resolvedLeadSettings, settings);
  } catch (error) {
    console.error(`Personalization Strategist failed for ${prospectName}:`, error);
    return {
      personalization_version: PERSONALIZATION_VERSION,
      record_id: record.record_id,
      project_id: projectId,
      prospect_name: prospectName,
      target_type: record.target_type,
      batch_id: entry.batch_id ?? null,
      batch_number: entry.batch_number ?? null,
      status: 'failed',
      strategy: null,
      copy: null,
      ai_copy: null,
      edited_by_human: false,
      qa: null,
      auto_revisions: 0,
      lead_settings: resolvedLeadSettings ?? null,
      models: { strategist: strategistModel, writer: writerModel },
      timings_ms: { strategist: Date.now() - tStrategistStart, writer: 0 },
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      reviewed_at: null,
      reviewer_note: null,
      error: `Strategist model failed: ${(error as Error).message}`,
    };
  }

  const strategistTime = Date.now() - tStrategistStart;

  // If Strategist concluded the lead is not ready (e.g. no usable contact route or unverified identity) or not recommended, halt copywriter unless forced
  if (!force && strategy.readiness !== 'ready') {
    return {
      personalization_version: PERSONALIZATION_VERSION,
      record_id: record.record_id,
      project_id: projectId,
      prospect_name: prospectName,
      target_type: record.target_type,
      batch_id: entry.batch_id ?? null,
      batch_number: entry.batch_number ?? null,
      status: strategy.readiness === 'not_recommended' ? 'rejected' : 'needs_more_research',
      strategy,
      copy: null,
      ai_copy: null,
      edited_by_human: false,
      qa: null,
      auto_revisions: 0,
      lead_settings: resolvedLeadSettings ?? null,
      models: { strategist: strategistModel, writer: writerModel },
      timings_ms: { strategist: strategistTime, writer: 0 },
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      reviewed_at: null,
      reviewer_note: `Strategist: ${strategy.readiness_reason}`,
      error: null,
    };
  }

  // -------------------------------------------------------------
  // MODEL 2: The Copywriter (with auto-correction loop)
  // -------------------------------------------------------------
  const writerProvider: LLMProvider =
    options.writerProvider ?? new GroqProvider({ model: writerModel, pool: 'personalization' });
  const baseWriterPrompt = buildWriterUserPrompt(
    strategy,
    entry,
    settings,
    prospectName,
    brief,
    resolvedLeadSettings,
    options.rewriteFeedback,
    options.previousCopy,
  );

  let copy: OutreachCopy | null = null;
  let qaResult = null;
  let autoRevisions = 0;
  const tWriterStart = Date.now();

  let currentWriterPrompt = baseWriterPrompt;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const rawCopy = await (writerProvider as GroqProvider).complete(
        {
          system: `${prompts.globalRules}\n\n${prompts.writer}`,
          user: currentWriterPrompt,
          maxTokens: 2500,
        },
        { temperature: 0.2 + attempt * 0.05, reasoningEffort: 'low' },
      );

      const parsed = extractJson(rawCopy);
      copy = normalizeOutreachCopy(
        OutreachCopySchema.parse(parsed),
        record,
        prospectName,
        resolvedLeadSettings,
        brief,
        settings,
      );

      // Safety net: enforce concrete wording-level reviewer feedback (e.g. "don't mention X", drop check-ins)
      if (learnedFeedback.length > 0) {
        copy = {
          ...copy,
          email_body: applyFeedbackTextRules(copy.email_body, learnedFeedback),
          follow_up_body: applyFeedbackTextRules(copy.follow_up_body, learnedFeedback),
        };
      }

      // Run deterministic QA with full project brief, confirmed campaign facts & individual lead settings
      qaResult = validatePersonalizationCopy(strategy, copy, record, {
        brief,
        settings,
        leadSettings: resolvedLeadSettings,
      });

      // If QA has no severe errors, we accept it
      if (qaResult.status !== 'failed' || attempt === 2) {
        break;
      }

      // Self-correction pass: explain the exact QA failures to the model
      autoRevisions += 1;
      const errorList = qaResult.issues
        .filter((i) => i.severity === 'error')
        .map((i) => `- [${i.code}] ${i.message}`)
        .join('\n');

      currentWriterPrompt = `${baseWriterPrompt}\n\nCRITICAL FIX REQUIRED (Your previous draft failed automated QA validation):\n${errorList}\n\nPlease regenerate the JSON output fixing the above errors strictly:\n- Reference specific verified details from the prospect's hooks/work/organisation and connect them to the recipient's benefit.\n- Remove all unsupported numbers, guarantees, and banned clichés.\n- Keep LinkedIn message under 280 characters.`;
    } catch (writerError) {
      console.warn(`Writer attempt ${attempt + 1} failed for ${prospectName}:`, writerError);
      if (attempt === 2) {
        return {
          personalization_version: PERSONALIZATION_VERSION,
          record_id: record.record_id,
          project_id: projectId,
          prospect_name: prospectName,
          target_type: record.target_type,
          batch_id: entry.batch_id ?? null,
          batch_number: entry.batch_number ?? null,
          status: 'failed',
          strategy,
          copy: null,
          ai_copy: null,
          edited_by_human: false,
          qa: null,
          auto_revisions: autoRevisions,
          lead_settings: resolvedLeadSettings ?? null,
          models: { strategist: strategistModel, writer: writerModel },
          timings_ms: { strategist: strategistTime, writer: Date.now() - tWriterStart },
          generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          reviewed_at: null,
          reviewer_note: null,
          error: `Copywriter model failed: ${(writerError as Error).message}`,
        };
      }
    }
  }

  const writerTime = Date.now() - tWriterStart;

  const limitationSummary =
    strategy.confidence === 'low' && strategy.human_checks.length > 0
      ? `Low personalization confidence: ${strategy.human_checks[0]}`
      : null;

  return {
    personalization_version: PERSONALIZATION_VERSION,
    record_id: record.record_id,
    project_id: projectId,
    prospect_name: prospectName,
    target_type: record.target_type,
    batch_id: entry.batch_id ?? null,
    batch_number: entry.batch_number ?? null,
    status: qaResult?.status === 'failed' ? 'needs_more_research' : 'draft',
    strategy,
    copy,
    ai_copy: copy ? JSON.parse(JSON.stringify(copy)) : null,
    edited_by_human: false,
    qa: qaResult,
    auto_revisions: autoRevisions,
    lead_settings: resolvedLeadSettings ?? null,
    models: { strategist: strategistModel, writer: writerModel },
    timings_ms: { strategist: strategistTime, writer: writerTime },
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    reviewed_at: null,
    reviewer_note: limitationSummary,
    error: null,
  };
}

/**
 * Settings-aware, evidence-grounded generator that combines:
 * Project Brief + Research Record + Campaign Settings + Individual Lead Personalization Settings.
 * Used as a deterministic fallback and for verifying settings-driven differentiation.
 */
export function buildAdaptivePersonalizationEntry(params: {
  projectId: string;
  researchEntry: ResearchEntry;
  brief?: StructuredBrief | null;
  settings: PersonalizationSettings;
  leadSettings?: LeadPersonalizationSettings | null;
  existing?: PersonalizationEntry | null;
  /** Reviewer feedback on the previous draft that this rewrite must apply. */
  rewriteFeedback?: string | null;
}): PersonalizationEntry {
  const { projectId, researchEntry, brief, settings, existing } = params;
  const rec = researchEntry.record;
  const storedLeadCfg =
    params.leadSettings ??
    settings.lead_settings?.[rec.record_id] ??
    existing?.lead_settings ??
    defaultLeadPersonalizationSettings(rec);

  // Learned reviewer feedback (project / category / this lead) + the current rewrite request
  const learnedFeedback = getRelevantFeedback(settings, rec);
  const rewriteText = params.rewriteFeedback?.trim();
  const activeFeedback = rewriteText && !learnedFeedback.some((f) => f.text.trim() === rewriteText)
    ? [
        {
          id: 'rewrite',
          text: rewriteText,
          scope: 'lead' as const,
          record_id: rec.record_id,
          prospect_name: rec.identity.name ?? null,
          target_type: rec.target_type ?? null,
          target_id: rec.brief_target_id ?? null,
          created_at: new Date().toISOString(),
        },
        ...learnedFeedback,
      ]
    : learnedFeedback;
  const leadCfg = applyFeedbackToLeadSettings(storedLeadCfg, activeFeedback);

  const strip = (text: string) => text.replace(/\s*[—–]\s*/g, ', ').replace(/,\s*,/g, ',').trim();
  const prospectName = rec.identity.name || researchEntry.seed.name || 'Prospect';
  const isOrg = rec.identity.entity_kind === 'organisation';
  const keyPerson = rec.key_contacts?.[0];
  const cleanFirstName = isOrg
    ? keyPerson?.name?.trim().split(/\s+/)[0] || `${prospectName} team`
    : prospectName
        .replace(/^(?:dr|prof|mr|ms|mrs|miss)\.?\s+/i, '')
        .replace(/\([^)]*\)/g, '')
        .trim()
        .split(/\s+/)[0] || prospectName;

  const campaignName = brief?.project?.name || settings.organisation || 'our initiative';
  const projectDesc = strip(
    brief?.project?.description ||
      brief?.project?.primary_objective ||
      'a curated initiative connecting standout work with relevant audiences and partners',
  ).replace(/\.$/, '');
  const primaryObjective = strip(
    brief?.project?.primary_objective ||
      brief?.outreach?.objectives?.[0] ||
      'explore a relevant collaboration',
  ).replace(/\.$/, '');
  const confirmedFact1 = settings.campaign_facts?.[0] ? strip(settings.campaign_facts[0]).replace(/\.$/, '') : '';
  const confirmedFact2 = settings.campaign_facts?.[1] ? strip(settings.campaign_facts[1]).replace(/\.$/, '') : '';

  const work1 = strip(
    rec.work_and_projects?.[0] ||
      rec.achievements?.[0] ||
      rec.industry_activity?.[0] ||
      rec.reason_for_relevance ||
      `your work${rec.organisation ? ` at ${rec.organisation}` : ''}`,
  ).replace(/\.$/, '');
  const work2 = strip(
    rec.work_and_projects?.[1] ||
      rec.achievements?.[0] ||
      rec.industry_activity?.[0] ||
      rec.background?.[0] ||
      '',
  ).replace(/\.$/, '');
  const achievement1 = strip(rec.achievements?.[0] || rec.industry_activity?.[0] || '').replace(/\.$/, '');

  // Determine recipient-specific incentive based on prospect type and campaign facts
  const targetHaystack = `${rec.target_type ?? ''} ${rec.role ?? ''} ${rec.organisation ?? ''}`.toLowerCase();
  const isAuthor = /\b(?:author|writer|novelist|poet)\b/.test(targetHaystack);
  const isSponsor = /\b(?:sponsor|sponsorship|corporate|funder|foundation)\b/.test(targetHaystack);
  const isPartner = /\b(?:partner|partnership|business|enterprise|director|commercial)\b/.test(targetHaystack);

  const recipientBenefit = strip(
    confirmedFact1 ||
      (isAuthor
        ? `connecting ${work1} with a wider readership, trade visibility, and long-term recognition through ${campaignName}`
        : isSponsor
          ? `direct visibility and alignment for ${rec.organisation || prospectName} alongside vetted participants in ${campaignName}`
          : isPartner
            ? `a practical collaboration that connects ${rec.organisation || prospectName} directly with the audience and network behind ${campaignName}`
            : `meaningful visibility, peer exchange, and alignment with ${campaignName} (${primaryObjective})`),
  ).replace(/\.$/, '');

  // Greeting by Tone
  const greeting =
    leadCfg.tone === 'formal'
      ? `Dear ${isOrg ? `${prospectName} team` : cleanFirstName},`
      : `Hi ${isOrg ? `${prospectName} team` : cleanFirstName},`;

  // Sign-off by Tone
  const senderSignoff =
    settings.signature?.trim() ||
    [
      settings.sender_name?.trim() || 'The Campaign Team',
      [settings.sender_role?.trim(), settings.organisation?.trim() || brief?.project?.name].filter(Boolean).join(', '),
    ]
      .filter(Boolean)
      .join('\n');
  const signoffClosing =
    leadCfg.tone === 'formal'
      ? 'Yours sincerely,'
      : leadCfg.tone === 'friendly' || leadCfg.tone === 'conversational'
        ? 'Warmly,'
        : 'Best regards,';
  const fullSignoff = /^(?:warmly|best|regards|sincerely|yours|cheers|thank you|thanks)\b/i.test(senderSignoff)
    ? senderSignoff
    : `${signoffClosing}\n${senderSignoff}`;

  // Research hook clause calibrated to Personalization Depth (light / moderate / deep)
  let researchClause = '';
  if (leadCfg.personalization_depth === 'light') {
    researchClause = `Given your work on ${work1}${rec.organisation && !work1.includes(rec.organisation) ? ` at ${rec.organisation}` : ''}`;
  } else if (leadCfg.personalization_depth === 'moderate') {
    researchClause =
      work2 && work2 !== work1
        ? `Following your work on ${work1} and ${work2}${rec.organisation && !work1.includes(rec.organisation) ? ` at ${rec.organisation}` : ''}`
        : `Following your work on ${work1} and your focus as ${rec.role || rec.target_type}${rec.organisation ? ` at ${rec.organisation}` : ''}`;
  } else {
    // deep
    const extraDetail =
      achievement1 && achievement1 !== work1
        ? `, alongside ${achievement1},`
        : work2 && work2 !== work1
          ? ` and ${work2},`
          : '';
    researchClause = `Your work on ${work1}${extraDetail}${rec.organisation && !work1.includes(rec.organisation) ? ` at ${rec.organisation}` : ''} stood out to us because of how closely it aligns with ${rec.reason_for_relevance ? strip(rec.reason_for_relevance).replace(/\.$/, '').toLowerCase() : primaryObjective.toLowerCase()}`;
  }

  // Project explanation calibrated to Explanation Level (minimal / balanced / detailed)
  let explanationBlock = '';
  if (leadCfg.explanation_level === 'minimal') {
    explanationBlock = `Through ${campaignName} (${projectDesc}), ${recipientBenefit}.`;
  } else if (leadCfg.explanation_level === 'balanced') {
    explanationBlock = `We are running ${campaignName}, ${projectDesc}. For ${isOrg ? prospectName : 'you'}, participating offers a clear benefit: ${recipientBenefit}.`;
  } else {
    // detailed
    const extraFactSentence = confirmedFact2
      ? ` ${confirmedFact2}.`
      : ` Our goal is to ${primaryObjective.charAt(0).toLowerCase() + primaryObjective.slice(1)}.`;
    explanationBlock = `We are organising ${campaignName}, ${projectDesc}.${extraFactSentence} Specifically for ${rec.organisation || prospectName}, this provides a tangible value exchange: ${recipientBenefit}, while connecting directly with the priorities behind ${work1}.`;
  }

  // Opening & structure calibrated to Communication Approach + Tone
  const warmCheckIn =
    leadCfg.tone === 'friendly'
      ? 'I hope you are having a great week. '
      : leadCfg.tone === 'conversational'
        ? 'Hope your week is going well. '
        : leadCfg.communication_approach === 'relationship_first'
          ? 'I hope your week is going well. '
          : '';

  let openingParagraph = '';
  if (leadCfg.communication_approach === 'relationship_first') {
    openingParagraph = `${warmCheckIn}${researchClause}${researchClause.endsWith('.') ? '' : ', and I wanted to reach out personally.'}`;
  } else if (leadCfg.communication_approach === 'opportunity_first') {
    openingParagraph = `${warmCheckIn}I am reaching out with an opportunity through ${campaignName} (${projectDesc}) that connects directly to ${work1}.`;
  } else if (leadCfg.communication_approach === 'incentive_driven') {
    openingParagraph = `${warmCheckIn}Because ${recipientBenefit}, we immediately thought of ${work1}${rec.organisation && !work1.includes(rec.organisation) ? ` at ${rec.organisation}` : ''}.`;
  } else if (leadCfg.communication_approach === 'direct') {
    openingParagraph = `${researchClause}. We would like to invite ${isOrg ? prospectName : 'you'} to consider ${campaignName}.`;
  } else {
    // consultative
    openingParagraph = `${warmCheckIn}${researchClause}, which prompted a question about how ${rec.organisation || 'your team'} is approaching collaborations like ${campaignName} this year.`;
  }

  // Call to Action calibrated to Call to Action setting (soft / further_discussion / specific_request / direct)
  const linkSuffix = settings.call_to_action_link ? ` (${settings.call_to_action_link})` : '';
  let ctaSentence = '';
  if (leadCfg.call_to_action === 'soft') {
    ctaSentence = `Would it be useful if I sent over a short one-page overview${linkSuffix} so you can see if it is of interest?`;
  } else if (leadCfg.call_to_action === 'further_discussion') {
    ctaSentence = `Would you be open to a brief conversation or exchanging a few thoughts on how ${campaignName} could align with your plans?`;
  } else if (leadCfg.call_to_action === 'specific_request') {
    ctaSentence = `Could you let me know if I may send the brief overview${linkSuffix} for ${work1}, or point me to the best person on your team?`;
  } else {
    // direct
    ctaSentence = `Would ${isOrg ? prospectName : 'you'} be interested in participating in ${campaignName}${linkSuffix} this season?`;
  }

  // Incorporate additional instructions naturally if present
  const additionalNote = leadCfg.additional_instructions?.trim()
    ? strip(leadCfg.additional_instructions.trim())
    : '';

  // Resolve project-specific category outreach template & decide how to apply it
  const resolvedTemplate = resolveCategoryTemplateForProspect(rec, brief, settings);
  const templateDecision = decideTemplateUsageMode(
    rec,
    brief,
    resolvedTemplate?.template,
    leadCfg,
  );
  const contextualValues = buildContextualTemplateValues(
    rec,
    brief,
    settings,
    resolvedTemplate?.template,
  );
  const templateDirectives = resolvedTemplate
    ? extractTemplateDirectives(resolvedTemplate.template.body, contextualValues)
    : [];

  const resolvedFullTemplateBody = resolvedTemplate
    ? strip(
        resolveTemplateDirectivesInText(
          resolvedTemplate.template.body,
          rec,
          brief,
          settings,
          resolvedTemplate.template,
        ),
      )
    : '';

  const templateCoreParas = resolvedFullTemplateBody
    .split(/\n\s*\n/)
    .map((p) => strip(p))
    .filter(
      (p) =>
        p.length > 15 &&
        !/^(?:hi|hello|dear)\b/i.test(p) &&
        !/^(?:warmly|best|regards|sincerely|yours|cheers|thank you|thanks)[,\n]/i.test(p),
    );

  // Extract a concise core positioning sentence from the category template when available
  const templatePositioningPara =
    templateCoreParas.find((p) => !p.endsWith('?') && !/^i hope your week/i.test(p)) ||
    templateCoreParas[0] ||
    '';
  const templateCtaPara = templateCoreParas.find((p) => p.includes('?')) || '';

  // Assemble Email Body calibrated to Message Length AND Category Template Decision (use / adapt / inspiration / ignore)
  let emailParagraphs: string[];
  const templateBodyHasWarmCheckIn = resolvedTemplate
    ? /\b(?:i hope\b|hope\s+(?:you|your)\b)/i.test(resolvedTemplate.template.body)
    : false;
  if ((templateDecision.mode === 'use' || templateDecision.mode === 'adapt') && resolvedFullTemplateBody) {
    // Template defines intended structure, messaging, and positioning: preserve all paragraphs!
    const resolvedParas = resolvedFullTemplateBody
      .split(/\n\s*\n/)
      .map((p) => strip(p))
      .filter(Boolean);
    if (resolvedParas.length > 0 && /^(?:hi|hello|dear)\b/i.test(resolvedParas[0]!)) {
      resolvedParas[0] = greeting;
    } else {
      resolvedParas.unshift(greeting);
    }
    if (templateDecision.mode === 'use' && templateDirectives.length === 0 && resolvedParas.length > 1) {
      if (!resolvedParas.some((p) => p.toLowerCase().includes(work1.toLowerCase()))) {
        resolvedParas[1] = `${resolvedParas[1]} Following your work on ${work1}, we thought of you immediately.`;
      }
    }
    if (templateDecision.mode === 'adapt' && resolvedParas.length > 1) {
      const hasWork1 = resolvedParas.some((p) => p.toLowerCase().includes(work1.toLowerCase()));
      const hasAchievement = achievement1 && resolvedParas.some((p) => p.includes(achievement1));
      
      if (achievement1 && !hasAchievement) {
        if (!hasWork1) {
          resolvedParas[1] = `${resolvedParas[1]} Following your work on ${work1} alongside ${achievement1}, this connects directly to our initiative.`;
        } else {
          resolvedParas[1] = `${resolvedParas[1]} Alongside your recognition with ${achievement1}, this offers a compelling fit.`;
        }
      } else if (!hasWork1) {
        resolvedParas[1] = `${resolvedParas[1]} Following your work on ${work1}, we wanted to reach out directly.`;
      }

      if (contextualValues.secondaryWorkDetail) {
        let cleanSecondary = contextualValues.secondaryWorkDetail.replace(/^(?:your\s+)?(?:work\s+on\s+)?/i, '').trim();
        if (rec.organisation && contextualValues.verifiedWorkDetail.includes(rec.organisation)) {
          cleanSecondary = cleanSecondary.split(' at ')[0] || cleanSecondary;
        }
        if (resolvedParas[1]!.includes(contextualValues.verifiedWorkDetail)) {
          resolvedParas[1] = resolvedParas[1]!.replace(
            contextualValues.verifiedWorkDetail,
            `${contextualValues.verifiedWorkDetail} and ${cleanSecondary}`,
          );
        }
      }
    }
    if (
      templateBodyHasWarmCheckIn &&
      warmCheckIn &&
      resolvedParas.length > 1 &&
      !/^(?:i hope\b|hope\s+(?:you|your))/i.test(resolvedParas[1]!)
    ) {
      resolvedParas[1] = `${warmCheckIn}${resolvedParas[1]}`;
    }
    const hasExistingSignoff = resolvedParas.some((p) =>
      /^(?:warmly|best|regards|sincerely|yours|cheers|thank you|thanks)\b/im.test(p) ||
      (settings.sender_name && p.includes(settings.sender_name)) ||
      (settings.organisation && p.includes(settings.organisation)),
    );
    if (!hasExistingSignoff) {
      resolvedParas.push(fullSignoff);
    }

    if (leadCfg.message_length === 'very_short' && resolvedParas.length > 2) {
      const corePara = resolvedParas.find((p) => p.includes(work1) || p.includes(contextualValues.verifiedWorkDetail)) || resolvedParas[1] || '';
      const ctaQuestion = resolvedParas.find((p) => p.includes('?')) || ctaSentence;
      const ctaPara = `${ctaQuestion}\n\n${fullSignoff}`;
      emailParagraphs = [greeting, corePara, ctaPara];
    } else {
      emailParagraphs = resolvedParas;
    }
  } else if (templateDecision.mode === 'use' && templatePositioningPara) {
    const templateMiddle =
      templatePositioningPara.toLowerCase().includes(recipientBenefit.slice(0, 20).toLowerCase())
        ? `${templatePositioningPara} Specifically for ${isOrg ? prospectName : 'you'}, this connects directly with ${work1}.`
        : `${templatePositioningPara} For ${isOrg ? prospectName : 'you'}, this offers ${recipientBenefit}.`;
    const resolvedCta = templateCtaPara || ctaSentence;
    emailParagraphs = [
      greeting,
      openingParagraph,
      templateMiddle,
      `${resolvedCta}\n\n${fullSignoff}`,
    ];
  } else if (templateDecision.mode === 'adapt' && templatePositioningPara) {
    const firstTemplateSentence = strip(templatePositioningPara.split(/(?<=\.)\s+/)[0] || templatePositioningPara);
    const adaptedExplanation = `${firstTemplateSentence} ${explanationBlock}`;
    emailParagraphs = [
      greeting,
      openingParagraph,
      adaptedExplanation,
      `${ctaSentence}\n\n${fullSignoff}`,
    ];
  } else if (leadCfg.message_length === 'very_short') {
    emailParagraphs = [
      greeting,
      `${openingParagraph} ${leadCfg.explanation_level === 'minimal' ? `Through ${campaignName}, ${recipientBenefit}.` : explanationBlock}`,
      `${ctaSentence}\n\n${fullSignoff}`,
    ];
  } else if (leadCfg.message_length === 'short') {
    emailParagraphs = [
      greeting,
      openingParagraph,
      `${explanationBlock} ${ctaSentence}`,
      `${fullSignoff}`,
    ];
  } else if (leadCfg.message_length === 'balanced') {
    emailParagraphs = [
      greeting,
      openingParagraph,
      explanationBlock,
      `${ctaSentence}\n\n${fullSignoff}`,
    ];
  } else {
    // detailed
    const contextPara =
      work2 && work2 !== work1
        ? `When we reviewed both ${work1} and ${work2}, it was clear that your perspective${rec.role ? ` as ${rec.role}` : ''} brings the exact depth that makes ${campaignName} valuable for participants.`
        : `Given your track record with ${work1}${rec.location ? ` in ${rec.location}` : ''}, we believe ${campaignName} offers a timely and relevant fit without requiring a heavy time commitment upfront.`;
    emailParagraphs = [
      greeting,
      openingParagraph,
      explanationBlock,
      contextPara,
      `${ctaSentence}\n\n${fullSignoff}`,
    ];
  }

  const emailBody = applyFeedbackTextRules(strip(emailParagraphs.join('\n\n')), activeFeedback);

  const linkedinMessage = strip(
    `${greeting} ${work1.slice(0, 85)} caught our attention for ${campaignName} (${recipientBenefit.slice(0, 80)}). ${
      leadCfg.call_to_action === 'direct'
        ? 'Interested in participating?'
        : leadCfg.call_to_action === 'further_discussion'
          ? 'Open to a quick discussion?'
          : 'Open to seeing the 1-page overview?'
    }`,
  ).slice(0, 280);

  const followUpBody = applyFeedbackTextRules(
    strip(
      `${greeting}\n\nFollowing up briefly on my note regarding ${campaignName} and how it connects to ${work1}. ${ctaSentence}\n\n${fullSignoff}`,
    ),
    activeFeedback,
  );

  const hasEmail =
    (rec.public_contact?.some((c) => c.kind === 'email' && c.value) ?? false) ||
    (rec.key_contacts?.some((k) => Boolean(k.email)) ?? false);
  const hasLinkedIn =
    (rec.social_profiles?.some((s) => s.platform === 'linkedin' && s.profile_url) ?? false) ||
    (rec.key_contacts?.some((k) => Boolean(k.linkedin_url)) ?? false);
  const recommendedChannel = hasEmail ? 'email' : hasLinkedIn ? 'linkedin' : 'contact_form';

  const toneRegisterMap: Record<LeadPersonalizationSettings['tone'], StrategyDossier['tone']['register']> = {
    professional: 'warm_professional',
    friendly: 'warm_professional',
    conversational: 'peer',
    confident: 'peer',
    persuasive: 'enthusiastic',
    formal: 'formal',
  };

  const hooks: StrategyDossier['hooks'] = [
    {
      id: 'H1',
      fact: work1,
      evidence_quote: rec.evidence?.[0]?.quote ?? null,
      source_ids: rec.sources?.[0]?.id ? [rec.sources[0].id] : ['S1'],
      why_it_resonates: strip(rec.reason_for_relevance || `Connects ${prospectName}'s work directly to ${campaignName}.`),
      strength: 'strong',
    },
  ];
  if (leadCfg.personalization_depth !== 'light' && work2 && work2 !== work1) {
    hooks.push({
      id: 'H2',
      fact: work2,
      evidence_quote: rec.evidence?.[1]?.quote ?? null,
      source_ids: rec.sources?.[0]?.id ? [rec.sources[0].id] : ['S1'],
      why_it_resonates: strip(`Provides a secondary verified touchpoint for ${prospectName}.`),
      strength: 'moderate',
    });
  }

  const strategy: StrategyDossier = {
    readiness: 'ready',
    readiness_reason: 'Verified research profile and configured per-lead outreach strategy.',
    prospect_snapshot: strip(
      rec.summary || `${prospectName}${rec.role ? ` (${rec.role})` : ''} is a verified prospect for ${campaignName}.`,
    ),
    recipient_priorities: strip(rec.reason_for_relevance || work1),
    relevance_thesis: strip(
      rec.reason_for_relevance || `${prospectName}'s work on ${work1} aligns directly with ${campaignName}.`,
    ),
    campaign_objective: primaryObjective,
    outreach_goal: strip(brief?.outreach?.objectives?.[0] || primaryObjective),
    recipient_incentive: recipientBenefit,
    potential_objections: ['Calendar availability and clarity on next steps'],
    narrative_approach: `${LEAD_APPROACH_LABELS[leadCfg.communication_approach].label} approach with ${LEAD_DEPTH_LABELS[leadCfg.personalization_depth].label.toLowerCase()} personalisation and ${LEAD_EXPLANATION_LABELS[leadCfg.explanation_level].label.toLowerCase()} explanation.${additionalNote ? ` Custom guidance: ${additionalNote}` : ''}`,
    hooks,
    primary_hook_id: 'H1',
    angle: strip(`Connect ${work1} to ${recipientBenefit}.`),
    tone: {
      register: toneRegisterMap[leadCfg.tone],
      guidance: `${LEAD_TONE_LABELS[leadCfg.tone]} tone, ${LEAD_LENGTH_LABELS[leadCfg.message_length].toLowerCase()} length, ${LEAD_CTA_LABELS[leadCfg.call_to_action].label.toLowerCase()} CTA.${additionalNote ? ` ${additionalNote}` : ''}`,
    },
    recommended_channel: recommendedChannel,
    channel_reason:
      recommendedChannel === 'email'
        ? 'Verified email route available in the research dossier.'
        : recommendedChannel === 'linkedin'
          ? 'Verified LinkedIn profile available for direct outreach.'
          : 'Official website contact route available in the research dossier.',
    contact_audit: existing?.strategy?.contact_audit ?? null,
    call_to_action: ctaSentence,
    avoid: ['Avoid unverified claims or generic AI clichés'],
    human_checks: [],
    confidence: rec.identity.identity_verified ? 'high' : 'medium',
    template_usage_mode: templateDecision.mode,
    template_usage_reason: templateDecision.reason,
  };

  const templateSubject =
    templateDecision.mode !== 'ignore' && resolvedTemplate?.template.subject_line?.trim()
      ? strip(resolvedTemplate.template.subject_line).slice(0, 58)
      : null;

  const copy: OutreachCopy = {
    subject_lines: [
      {
        text:
          contextualValues.tailoredSubjectLines?.direct ||
          strip(`${work1.slice(0, 32)} / ${campaignName}`).slice(0, 58),
        style: 'direct',
      },
      {
        text:
          contextualValues.tailoredSubjectLines?.curiosity ||
          strip(`Question for ${cleanFirstName} regarding ${work1.slice(0, 28)}`).slice(0, 58),
        style: 'curiosity',
      },
      {
        text:
          contextualValues.tailoredSubjectLines?.value ||
          templateSubject ||
          strip(`${campaignName}: opportunity for ${isOrg ? prospectName : cleanFirstName}`).slice(0, 58),
        style: 'value',
      },
    ],
    email_body: emailBody,
    alternative_opening:
      work2 && work2 !== work1
        ? strip(`Your work on ${work2} also maps closely to what we are building with ${campaignName}.`)
        : null,
    linkedin_message: linkedinMessage,
    follow_up_body: followUpBody,
    hook_usage: strip(
      `Template decision: ${TEMPLATE_USAGE_MODE_LABELS[templateDecision.mode].label} (${templateDecision.mode}). Applied ${LEAD_TONE_LABELS[leadCfg.tone]} tone, ${LEAD_LENGTH_LABELS[leadCfg.message_length]} length, ${LEAD_DEPTH_LABELS[leadCfg.personalization_depth].label} depth, and ${LEAD_APPROACH_LABELS[leadCfg.communication_approach].label} approach referencing ${work1.slice(0, 80)}.`,
    ),
  };

  const qa = validatePersonalizationCopy(strategy, copy, rec, {
    brief: brief ?? undefined,
    settings,
    leadSettings: leadCfg,
  });

  const now = new Date().toISOString();
  return {
    personalization_version: PERSONALIZATION_VERSION,
    record_id: rec.record_id,
    project_id: projectId,
    prospect_name: prospectName,
    target_type: rec.target_type,
    batch_id: existing?.batch_id ?? researchEntry.batch_id ?? null,
    batch_number: existing?.batch_number ?? researchEntry.batch_number ?? null,
    status: existing?.status === 'approved' ? 'approved' : 'draft',
    strategy,
    copy,
    ai_copy: copy,
    edited_by_human: false,
    qa,
    auto_revisions: existing?.auto_revisions ?? 0,
    lead_settings: storedLeadCfg,
    previous_versions: existing?.previous_versions,
    models: existing?.models ?? { strategist: 'openai/gpt-oss-20b', writer: 'openai/gpt-oss-20b' },
    timings_ms: existing?.timings_ms ?? { strategist: 0, writer: 0 },
    generated_at: existing?.generated_at ?? now,
    updated_at: now,
    reviewed_at: existing?.reviewed_at ?? null,
    reviewer_note: existing?.reviewer_note ?? null,
    error: null,
  };
}
