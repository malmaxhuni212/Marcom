/**
 * Personalization Agent (Agent 3) Orchestrator.
 *
 * Implements a strict two-model separation of concerns:
 *   1. Model 1 (The Strategist):
 *      - Deeply analyzes prospect research dossier and verified evidence.
 *      - Rigorously audits all candidate contact routes (real vs fake, direct vs gatekeeper, best place to contact them and why).
 *      - Selects verified hooks, campaign angle, tone, and call to action.
 *      - Assesses readiness honestly (blocks outreach if contact routes are unverified/fake).
 *
 *   2. Model 2 (The Copywriter):
 *      - Receives ONLY the StrategyDossier (with contact audit) and confirmed campaign facts.
 *      - Produces high-converting, human-sounding outreach tailored to the channel (email body, 3 subject lines, LinkedIn note, follow-up).
 *      - Self-corrects via automated QA validation if cliches, buzzwords, or length limits fail.
 */

import { extractJson } from '../../llm/provider';
import { GroqProvider } from '../../llm/groq-provider';
import { loadPersonalizationPrompts } from '../prompt-loader';
import {
  type OutreachCopy,
  OutreachCopySchema,
  PERSONALIZATION_VERSION,
  type PersonalizationEntry,
  type PersonalizationSettings,
  type StrategyDossier,
  StrategyDossierSchema,
} from '../../schemas/personalization';
import { validatePersonalizationCopy } from './qa';
import type { StructuredBrief } from '../../schemas/structured-brief';
import type { ResearchEntry } from '../../schemas/research-record';
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
  force?: boolean;
}

function buildStrategistUserPrompt(
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

  for (const s of r.social_profiles.slice(0, 2)) {
    const isPersonal = s.profile_url.includes('/in/') || !s.profile_url.includes('/company/');
    candidateRoutes.push(`- [Social:${s.platform}] URL: ${s.profile_url} (Type: ${isPersonal ? 'Personal Profile' : 'Company/Org Page'}, Verified: ${s.verified_status ? 'Yes' : 'No'})`);
  }

  // Also include any contact mentions in evidence quotes
  const contactEvidence = r.evidence
    .filter(
      (e) =>
        e.field === 'public_contact' ||
        e.field === 'social_profiles' ||
        e.claim.toLowerCase().includes('email')
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
    : '- (No extra campaign facts provided; rely on brief)';

  return [
    `=== PROJECT & BRIEF ===`,
    `Project: ${brief.project.name || 'Campaign'}`,
    `Primary Objective: ${brief.project.primary_objective || brief.project.description}`,
    `Target Audience: ${target?.target_type || r.target_type} (${target?.entity_kind || 'person'})`,
    target?.description ? `Target Description: ${target.description}` : '',
    `Personalization Allowed: ${brief.personalization.allowed.join('; ') || 'Standard professional'}`,
    `Personalization Preferred: ${brief.personalization.preferred_details.join('; ') || 'Specific titles, awards, achievements'}`,
    `Tone Required: ${brief.personalization.tone.join(', ') || 'Professional, human'}`,
    `Forbidden In Brief: ${brief.personalization.avoid.join('; ') || 'Generic flattery, invasive details'}`,
    settings.extra_guidance ? `Extra Team Guidance: ${settings.extra_guidance}` : '',

    `\n=== CONFIRMED CAMPAIGN FACTS (Only these may be mentioned) ===`,
    factsList,
    settings.call_to_action_link ? `Campaign Link: ${settings.call_to_action_link}` : '',

    `\n=== PROSPECT RESEARCH DOSSIER ===`,
    `Name: ${r.identity.name || research.seed.name}`,
    `Entity Kind: ${r.identity.entity_kind}`,
    `Identity Verified: ${r.identity.identity_verified}`,
    `Role: ${r.role || 'Unknown'}`,
    `Organisation: ${r.organisation || 'Independent'}`,
    `Location: ${r.location || r.country || 'Unknown'}`,
    `Background: ${r.background.slice(0, 5).join('; ') || 'Not specified'}`,
    `Work & Projects: ${r.work_and_projects.slice(0, 8).join('; ') || 'None listed'}`,
    `Achievements & Awards: ${r.achievements.slice(0, 6).join('; ') || 'None listed'}`,
    `Industry Activity: ${r.industry_activity.slice(0, 4).join('; ') || 'None listed'}`,
    `Summary: ${r.summary}`,
    `Evidence Highlights:\n${evidenceFormatted || '- No direct evidence quotes'}`,
    r.unknowns.length ? `Known Unknowns: ${r.unknowns.map((u) => `${u.field} (${u.reason})`).join('; ')}` : '',
    research.qa.issues.length ? `QA Flags: ${research.qa.issues.map((i) => `[${i.severity}] ${i.message}`).join('; ')}` : '',

    `\n=== CANDIDATE CONTACT ROUTES TO AUDIT ===`,
    routesFormatted,

    `\n=== CONTACT ROUTE AUDIT INSTRUCTIONS ===`,
    `1. Rigorously evaluate every single contact route above.`,
    `2. Distinguish:`,
    `   - verified_direct (named individual email, high conversion)`,
    `   - generic_inbox (info@, enquiries@, submissions@, contact@). For organizations/publishers this is appropriate; for individuals this is a gatekeeper.`,
    `   - fake_or_scraping_artifact (abuse@, privacy@, whois@, bot traps). NEVER recommend or use these.`,
    `   - personal LinkedIn profile (high response rate for individuals) vs company page.`,
    `   - website contact/submission forms.`,
    `3. Pick the single best place to contact them, provide the exact destination in best_contact_target, explain WHY in why_best_route, and assign a backup_route.`,
    `4. Populate the 'contact_audit' object completely.`,

    memoryNote ? `\n=== MEMORY CONTEXT ===\n${memoryNote}` : '',

    `\nAnalyze this prospect thoroughly. Output the JSON StrategyDossier object only.`,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildWriterUserPrompt(
  strategy: StrategyDossier,
  research: ResearchEntry,
  settings: PersonalizationSettings,
  prospectName: string,
): string {
  const hooksFormatted = strategy.hooks
    .map(
      (h) =>
        `- [${h.id}] (${h.strength}) ${h.fact}${h.evidence_quote ? ` (Evidence: "${h.evidence_quote}")` : ''}\n  Why it resonates: ${h.why_it_resonates}`,
    )
    .join('\n');

  const factsList = settings.campaign_facts.length
    ? settings.campaign_facts.map((f) => `- ${f}`).join('\n')
    : '- (See strategy for context)';

  const audit = strategy.contact_audit;

  return [
    `=== SENDER IDENTITY ===`,
    `Sender Name: ${settings.sender_name || 'Campaign Team'}`,
    settings.sender_role ? `Sender Role: ${settings.sender_role}` : '',
    settings.organisation ? `Organisation: ${settings.organisation}` : '',
    settings.signature ? `Signature Block: ${settings.signature}` : '',

    `\n=== CONFIRMED CAMPAIGN FACTS (Do not invent anything beyond this) ===`,
    factsList,
    settings.call_to_action_link ? `Action Link: ${settings.call_to_action_link}` : '',

    `\n=== STRATEGY DOSSIER FOR ${prospectName.toUpperCase()} ===`,
    `Prospect Snapshot: ${strategy.prospect_snapshot}`,
    `Relevance Thesis: ${strategy.relevance_thesis}`,
    `Outreach Goal: ${strategy.outreach_goal}`,
    `Core Angle: ${strategy.angle}`,
    `Tone Register: ${strategy.tone.register} (${strategy.tone.guidance})`,
    `Recommended Channel: ${strategy.recommended_channel}`,
    audit ? `Best Contact Target: ${audit.best_contact_target} (${audit.best_channel})` : '',
    audit ? `Channel Context: ${audit.is_direct_contact ? 'Direct 1-to-1 conversation with the individual' : 'Role-based or team inbox (e.g. submissions/enquiries)'}` : '',
    audit ? `Email Status: ${audit.email_status}` : '',
    audit ? `Why this route: ${audit.why_best_route}` : '',
    `Call to Action (Ask): ${strategy.call_to_action}`,
    `Primary Hook to Feature: ${strategy.primary_hook_id || 'None'}`,
    `Available Hooks:\n${hooksFormatted}`,
    `Strictly Avoid for This Prospect:\n${strategy.avoid.map((a) => `- ${a}`).join('\n') || '- None'}`,

    `\nDraft the complete outreach package for ${prospectName}. Follow the system guidelines strictly. Output JSON only.`,
  ]
    .filter(Boolean)
    .join('\n');
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

  const startTime = Date.now();
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
  const strategistProvider = new GroqProvider({ model: strategistModel, pool: 'personalization' });
  const strategistPrompt = buildStrategistUserPrompt(brief, entry, settings, memoryNotes.join('\n'));

  let strategy: StrategyDossier | null = null;
  const tStrategistStart = Date.now();

  try {
    const rawStrategy = await strategistProvider.complete(
      {
        system: `${prompts.globalRules}\n\n${prompts.strategist}`,
        user: strategistPrompt,
        maxTokens: 4096,
      },
      { temperature: 0.15, reasoningEffort: 'low' },
    );
    const parsed = extractJson(rawStrategy);
    strategy = StrategyDossierSchema.parse(parsed);
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

  // If Strategist concluded the lead is not ready or not recommended, halt copywriter unless forced
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
  const writerProvider = new GroqProvider({ model: writerModel, pool: 'personalization' });
  const baseWriterPrompt = buildWriterUserPrompt(strategy, entry, settings, prospectName);

  let copy: OutreachCopy | null = null;
  let qaResult = null;
  let autoRevisions = 0;
  const tWriterStart = Date.now();

  let currentWriterPrompt = baseWriterPrompt;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const rawCopy = await writerProvider.complete(
        {
          system: `${prompts.globalRules}\n\n${prompts.writer}`,
          user: currentWriterPrompt,
          maxTokens: 4096,
        },
        { temperature: 0.2 + attempt * 0.05, reasoningEffort: 'low' },
      );

      const parsed = extractJson(rawCopy);
      copy = OutreachCopySchema.parse(parsed);

      // Run deterministic QA
      qaResult = validatePersonalizationCopy(strategy, copy, record);

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

      currentWriterPrompt = `${baseWriterPrompt}\n\nCRITICAL FIX REQUIRED (Your previous draft failed automated QA validation):\n${errorList}\n\nPlease regenerate the JSON output fixing the above errors strictly. Do not use banned phrases and keep LinkedIn message under 280 characters.`;
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
    reviewer_note: null,
    error: null,
  };
}
