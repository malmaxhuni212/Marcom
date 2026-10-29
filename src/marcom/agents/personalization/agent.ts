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
  type OutreachCopy,
  OutreachCopySchema,
  PERSONALIZATION_VERSION,
  type PersonalizationConfidence,
  type PersonalizationEntry,
  type PersonalizationSettings,
  type StrategyDossier,
  StrategyDossierSchema,
} from '../../schemas/personalization';
import { validatePersonalizationCopy } from './qa';
import type { StructuredBrief } from '../../schemas/structured-brief';
import type { ResearchEntry, ResearchRecord } from '../../schemas/research-record';
import type { MemoryStore } from '../../memory/store';
import { retrieveMemoryContext } from '../../memory/retrieval';

export interface RunPersonalizationOptions {
  projectId: string;
  brief: StructuredBrief;
  entry: ResearchEntry;
  settings: PersonalizationSettings;
  store: MemoryStore;
  strategistModel?: string;
  writerModel?: string;
  strategistProvider?: LLMProvider;
  writerProvider?: LLMProvider;
  force?: boolean;
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
): string {
  const r = research.record;
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
): string {
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

    `\n=== WRITING STYLE & WARMTH REQUIREMENTS ===`,
    `1. Greeting & Warm Beginning: Start with "${recommendedGreeting}", then open the first paragraph with a brief, warm human line (such as "I hope your week is going well.") before smoothly connecting to their work or organisation.`,
    `2. Explain the Project Clearly (Never Assume They Know Us): The recipient has NEVER heard of ${brief?.project?.name || settings.organisation || 'our project'} before. Do not mention the project name as if they already know what it is. Always introduce it with a short, plain-English phrase explaining what it actually is (e.g., "We run the Maya Book Awards, an international book prize celebrating standout fiction and non-fiction."). Also make subject lines self-explanatory to a newcomer (never use bare shorthand like "Maya 2026").`,
    `3. Don't Overcomplicate: Use plain, everyday English that is direct, polite, easy to understand, and a smooth read from start to finish. Use natural words like "especially" instead of robotic phrases like "including titles like" or "such as titles like".`,
    `4. NO EM-DASHES (—) OR ASTERISKS (*): Never use the "—" character or markdown asterisks (*title*) anywhere in the message text or subject lines. Use commas or periods instead.`,
    `5. Simple Next Step: End with one easy, low-pressure question (never push for a "15-minute virtual coffee" or calendar invite on first contact). Output JSON only.`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function normalizeOutreachCopy(
  copy: OutreachCopy,
  record: ResearchRecord,
  prospectName: string,
): OutreachCopy {
  const cleanText = (text: string) =>
    text
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
  const properGreeting = isOrg ? `Hi ${prospectName} team,` : `Hi ${cleanFirstName},`;

  const fixGreetingAndWarmth = (body: string, ensureWarmStart: boolean): string => {
    let cleaned = cleanText(body);
    // Replace bare "Hi," / "Hello," or awkward "Hi support team," / "Hi info team," with proper greeting
    cleaned = cleaned.replace(
      /^(?:hi|hello|dear)(?:\s+(?:support|info|admin|enquiries|inquiries|general|helpdesk)?\s*team)?\s*,/i,
      properGreeting,
    );

    if (!ensureWarmStart) return cleaned;

    const parts = cleaned.split(/\n\s*\n/);
    if (parts.length >= 2 && /^(?:hi|hello|dear)\b/i.test(parts[0]!.trim())) {
      const firstPara = parts[1]!.trim();
      const hasWarmStart = /^(?:i hope\b|hope\s+(?:you|your|things|all)\b|wishing\s+you\b|thank\s+you\b|thanks\s+for\b|it'?s\s+great\b|great\s+to\b)/i.test(
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
    email_body: fixGreetingAndWarmth(copy.email_body, true),
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
    store,
    strategistModel = 'openai/gpt-oss-20b',
    writerModel = 'openai/gpt-oss-20b',
    force = false,
  } = options;

  const prompts = loadPersonalizationPrompts();
  const record = entry.record;
  const prospectName = record.identity.name || entry.seed.name;

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
  const strategistPrompt = buildStrategistUserPrompt(brief, entry, settings, memoryNotes.join('\n'));

  let strategy: StrategyDossier | null = null;
  const tStrategistStart = Date.now();

  try {
    const rawStrategy = await (strategistProvider as GroqProvider).complete(
      {
        system: `${prompts.globalRules}\n\n${prompts.strategist}`,
        user: strategistPrompt,
        maxTokens: 4096,
      },
      { temperature: 0.15, reasoningEffort: 'low' },
    );
    const parsed = extractJson(rawStrategy);
    const parsedStrategy = StrategyDossierSchema.parse(parsed);
    strategy = normalizeStrategyDossier(parsedStrategy, record, brief);
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
  const baseWriterPrompt = buildWriterUserPrompt(strategy, entry, settings, prospectName, brief);

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
          maxTokens: 4096,
        },
        { temperature: 0.2 + attempt * 0.05, reasoningEffort: 'low' },
      );

      const parsed = extractJson(rawCopy);
      copy = normalizeOutreachCopy(OutreachCopySchema.parse(parsed), record, prospectName);

      // Run deterministic QA with full project brief & confirmed campaign facts context
      qaResult = validatePersonalizationCopy(strategy, copy, record, { brief, settings });

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
    models: { strategist: strategistModel, writer: writerModel },
    timings_ms: { strategist: strategistTime, writer: writerTime },
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    reviewed_at: null,
    reviewer_note: limitationSummary,
    error: null,
  };
}
