import assert from 'node:assert/strict';
import test from 'node:test';
import type { LLMProvider, LLMRequest } from '../../llm/provider';
import { InMemoryStore, type MemoryStore } from '../../memory/store';
import {
  buildDefaultCategoryTemplate,
  decideTemplateUsageMode,
  defaultLeadPersonalizationSettings,
  getProjectCategoryTemplates,
  type LeadPersonalizationSettings,
  type OutreachCopy,
  type PersonalizationSettings,
  resolveCategoryTemplateForProspect,
  type StrategyDossier,
} from '../../schemas/personalization';
import {
  deleteProjectPersonalizations,
  getPersonalizationSettings as getFilePersonalizationSettings,
  savePersonalizationSettings as saveFilePersonalizationSettings,
} from '../../memory/personalization-store';
import type { ResearchEntry, ResearchRecord } from '../../schemas/research-record';
import type { StructuredBrief } from '../../schemas/structured-brief';
import {
  buildAdaptivePersonalizationEntry,
  buildStrategistUserPrompt,
  buildWriterUserPrompt,
  normalizeStrategyDossier,
  runPersonalizationAgent,
} from './agent';
import {
  appendFeedback,
  createFeedbackItem,
  getRelevantFeedback,
} from '../../personalization/feedback';
import { validatePersonalizationCopy } from './qa';

function createEmptyStore(): MemoryStore {
  return new InMemoryStore({
    lunim: [],
    projects: [],
    prospects: [],
    relationships: [],
    decisions: [],
    learnings: [],
  });
}

function makeBrief(overrides?: Partial<StructuredBrief['project']> & {
  targetType?: string;
  entityKind?: 'person' | 'organisation' | 'either';
  targetDescription?: string;
  outreachObjective?: string;
}): StructuredBrief {
  return {
    structured_brief_version: '1.0',
    project: {
      name: overrides?.name ?? 'Meridian Climate Tech Summit',
      description:
        overrides?.description ??
        'Annual European forum connecting industrial decarbonisation leaders with grid-scale storage buyers.',
      primary_objective:
        overrides?.primary_objective ??
        'Invite vetted industry leaders and partner organisations to contribute to the 2026 programme.',
      secondary_objectives: overrides?.secondary_objectives ?? [],
      success_metrics: overrides?.success_metrics ?? ['Qualified replies from relevant prospects'],
    },
    targets: [
      {
        id: 'target-1',
        target_type: overrides?.targetType ?? 'industry_leaders',
        entity_kind: overrides?.entityKind ?? 'person',
        description: overrides?.targetDescription ?? 'Senior leaders and organisations working on relevant initiatives.',
        geography_mode: 'specified',
        geography: ['United Kingdom', 'Europe'],
        qualification_criteria: [
          {
            text: 'Active in relevant domain',
            origin: 'explicit',
            needs_operational_definition: false,
          },
        ],
        exclusion_criteria: [],
        priority: 'primary',
      },
    ],
    research: {
      required_fields: ['name', 'role', 'organisation'],
      preferred_source_types: ['official_site', 'press'],
      evidence_requirements: ['Direct quote or URL'],
      verification_requirements: ['Verify identity'],
      unknown_handling: 'Record unknowns honestly',
    },
    personalization: {
      allowed: ['Published projects, speaking roles, organisational programmes'],
      preferred_details: ['Named initiatives, recent publications, verified remit'],
      tone: ['warm_professional', 'conversational'],
      avoid: ['Generic flattery', 'Unsupported guarantees', 'Corporate buzzwords'],
    },
    outreach: {
      objectives: [overrides?.outreachObjective ?? 'Establish a relevant connection and propose a low-friction next step'],
      channels: ['email', 'linkedin'],
      tone: ['human', 'direct'],
      approval_required: true,
    },
    database: {
      fields: [{ name: 'name', required: true, purpose: 'Prospect name', expected_source: 'research' }],
    },
    human_review: {
      requirements: ['All outreach must remain drafts for human review'],
      approval_points: ['Before sending'],
    },
    constraints: [],
    conflicts: [],
    approximations: [],
    unknowns_requiring_confirmation: [],
  };
}

function makeSettings(overrides?: Partial<PersonalizationSettings>): PersonalizationSettings {
  return {
    sender_name: 'Elena Vance',
    sender_role: 'Programme Lead',
    organisation: 'Meridian Forum',
    signature: 'Elena Vance\nProgramme Lead, Meridian Forum',
    call_to_action_link: 'https://meridianforum.example.org/brief',
    campaign_facts: [
      'The forum takes place in London on 14 November 2026.',
      'Sessions bring together 120 municipal utilities and industrial grid operators.',
    ],
    extra_guidance: '',
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeResearchEntry(overrides?: Partial<ResearchRecord>): ResearchEntry {
  const record: ResearchRecord = {
    research_record_version: '1.1',
    record_id: overrides?.record_id ?? 'rec-1',
    project_id: 'proj-1',
    brief_target_id: 'target-1',
    target_type: overrides?.target_type ?? 'industry_leaders',
    identity: {
      name: 'Dr. Marcus Thorne',
      entity_kind: 'person',
      identity_verified: true,
      ...overrides?.identity,
    },
    role: 'Director of Grid Modernisation',
    organisation: 'NorthSea Energy Cooperative',
    location: 'Edinburgh, UK',
    country: 'United Kingdom',
    summary:
      'Dr. Marcus Thorne leads the Orkney Microgrid Balancing Pilot at NorthSea Energy Cooperative and published the 2025 Long-Duration Thermal Storage whitepaper.',
    background: ['12 years leading regional grid integration projects in Scotland'],
    work_and_projects: [
      'Orkney Microgrid Balancing Pilot (2025–2026)',
      '2025 Long-Duration Thermal Storage Whitepaper',
    ],
    achievements: ['Delivered 99.4% renewable dispatch reliability across the Orkney island interconnect'],
    industry_activity: ['Keynote speaker on municipal storage procurement at EuroGrid 2025'],
    public_contact: [
      {
        kind: 'email',
        value: 'm.thorne@northsea-coop.org.uk',
        source_ids: ['S1'],
        confidence: 'verified',
        is_professional: true,
      },
    ],
    key_contacts: [],
    websites: [{ url: 'https://northsea-coop.org.uk/projects/orkney', type: 'project', title: 'Orkney Pilot' }],
    social_profiles: [
      {
        platform: 'linkedin',
        profile_url: 'https://linkedin.com/in/marcus-thorne-grid',
        username: 'marcus-thorne-grid',
        display_name: 'Dr. Marcus Thorne',
        verified_status: true,
        confidence: 'verified',
        source_ids: ['S1'],
      },
    ],
    qualification_assessment: [],
    reason_for_relevance: 'Direct fit for grid storage roundtable.',
    fit: {
      score: 92,
      band: 'highly_relevant',
      rationale: 'Direct fit for municipal grid storage roundtable.',
    },
    sources: [
      {
        id: 'S1',
        url: 'https://northsea-coop.org.uk/projects/orkney',
        title: 'Orkney Microgrid Balancing Pilot',
        source_type: 'official_site',
        retrieved_at: new Date().toISOString(),
      },
    ],
    evidence: [
      {
        field: 'work_and_projects',
        claim: 'Leads the Orkney Microgrid Balancing Pilot at NorthSea Energy Cooperative',
        quote: 'Dr. Marcus Thorne directs the Orkney Microgrid Balancing Pilot.',
        source_ids: ['S1'],
        confidence: 'verified',
      },
    ],
    unknowns: [],
    contradictions: [],
    research_confidence: 'high',
    matched_prospect_id: null,
    researched_at: new Date().toISOString(),
    research_agent_version: '1.1',
    ...overrides,
  };

  return {
    record,
    seed: { name: record.identity.name ?? 'Prospect' },
    qa: { status: 'passed', issues: [] },
    relationship_status: null,
    model: 'test-research-model',
    searches: [],
    search_provider: 'test',
    search_request_ids: [],
    search_usage: { requests: 1, estimated_cost_usd: 0, latency_ms: 1 },
    search_warnings: [],
  };
}

function makeBaseStrategy(overrides?: Partial<StrategyDossier>): StrategyDossier {
  return {
    readiness: 'ready',
    readiness_reason: 'Strong verified project hooks and direct professional email.',
    confidence: 'high',
    prospect_snapshot:
      'Dr. Marcus Thorne is Director of Grid Modernisation at NorthSea Energy Cooperative, leading the Orkney Microgrid Balancing Pilot.',
    recipient_priorities:
      'Improving renewable dispatch reliability and evaluating long-duration storage economics for regional microgrids.',
    relevance_thesis:
      'His hands-on work balancing islanded microgrids in Orkney directly matches the municipal utility roundtable topic at Meridian Forum.',
    recipient_incentive:
      'Direct peer exchange with 120 European municipal utilities and industrial grid operators evaluating long-duration storage models.',
    potential_objections: ['Time commitment to prepare materials for a November session in London'],
    campaign_objective: 'Invite Marcus to contribute a case study to the municipal storage roundtable',
    outreach_goal: 'Share the 1-page roundtable brief and confirm interest in joining the session',
    narrative_approach:
      'Connect the Orkney Microgrid Balancing Pilot dispatch reliability findings to the 120 municipal utilities attending in London and offer the 1-page brief as a low-friction next step.',
    hooks: [
      {
        id: 'H1',
        fact: 'Leads the Orkney Microgrid Balancing Pilot at NorthSea Energy Cooperative',
        evidence_quote: 'Dr. Marcus Thorne directs the Orkney Microgrid Balancing Pilot.',
        source_ids: ['S1'],
        why_it_resonates: 'Municipal grid operators at the forum are specifically looking for real-world islanded balancing data.',
        strength: 'strong',
      },
      {
        id: 'H2',
        fact: 'Authored the 2025 Long-Duration Thermal Storage Whitepaper',
        evidence_quote: null,
        source_ids: ['S1'],
        why_it_resonates: 'Connects directly to the procurement track on thermal vs battery storage.',
        strength: 'moderate',
      },
    ],
    primary_hook_id: 'H1',
    angle:
      'Connects the Orkney Microgrid Balancing Pilot findings with municipal utility operators seeking practical dispatch data.',
    tone: {
      register: 'peer',
      guidance: 'Direct, technical peer-to-peer tone; zero fluff.',
    },
    recommended_channel: 'email',
    channel_reason: 'Verified direct work email on official whitepaper.',
    contact_audit: {
      best_channel: 'email',
      best_contact_target: 'm.thorne@northsea-coop.org.uk',
      why_best_route: 'Verified direct individual email with personal LinkedIn as backup.',
      is_direct_contact: true,
      email_status: 'verified_direct',
      backup_route: 'https://linkedin.com/in/marcus-thorne-grid',
      evaluated_routes: [
        {
          channel: 'email',
          value: 'm.thorne@northsea-coop.org.uk',
          verdict: 'recommended',
          quality_assessment: 'Direct professional address',
          priority: 1,
        },
      ],
    },
    call_to_action: 'Would it be useful if I sent the one-page brief for the November roundtable in London?',
    avoid: ['Do not exaggerate commercial sponsorship commitments'],
    human_checks: ['Confirm Orkney pilot phase 2 timeline before session scheduling'],
    ...overrides,
  };
}

function makeMockProvider(handler: (req: LLMRequest, callIndex: number) => unknown): LLMProvider {
  let calls = 0;
  return {
    name: 'mock-personalization-llm',
    async complete(req: LLMRequest) {
      calls += 1;
      return JSON.stringify(handler(req, calls));
    },
  };
}

// ============================================================================
// SCENARIO 1: Strong person-level research record
// ============================================================================
test('Scenario 1: Strong person-level research record produces specific, incentive-driven outreach with alternative opening and high confidence', async () => {
  const brief = makeBrief();
  const settings = makeSettings();
  const entry = makeResearchEntry();
  const strategy = makeBaseStrategy();

  const copy: OutreachCopy = {
    subject_lines: [
      { text: 'Orkney microgrid data / Meridian storage roundtable', style: 'direct' },
      { text: 'Sharing Orkney dispatch lessons with municipal grids', style: 'value' },
      { text: 'Quick question on your 2025 thermal storage paper', style: 'curiosity' },
    ],
    email_body: `Hi Marcus,

Your work on the Orkney Microgrid Balancing Pilot at NorthSea Energy Cooperative stood out to us because several municipal utilities attending our November forum are tackling the same islanded dispatch challenges.

On 14 November 2026 in London, Meridian Forum is bringing together 120 municipal utilities and industrial grid operators to compare real-world storage deployment models. Contributing a short case study on the Orkney pilot would put your team's findings directly in front of European utility procurement leads.

Would it be useful if I sent the one-page brief for the November roundtable in London?

Best regards,
Elena Vance
Programme Lead, Meridian Forum`,
    alternative_opening:
      'Your 2025 Long-Duration Thermal Storage Whitepaper raised practical procurement questions that several municipal grid operators in our November cohort are currently evaluating.',
    linkedin_message:
      'Hi Marcus — your work on the Orkney Microgrid Balancing Pilot is directly relevant to a roundtable of 120 municipal utilities we are hosting in London on 14 Nov. Open to seeing the 1-page session brief?',
    follow_up_body: `Hi Marcus,

Following up briefly in case the roundtable brief is of interest for NorthSea Energy Cooperative. We are finalising the municipal utility speakers next month and would welcome a practical perspective from the Orkney pilot. Happy to send the one-pager if useful?`,
    hook_usage: 'Used H1 (Orkney Microgrid Balancing Pilot) in the opening and H2 (Thermal Storage Whitepaper) in the alternative opening.',
  };

  const result = await runPersonalizationAgent({
    projectId: 'proj-1',
    brief,
    entry,
    settings,
    store: createEmptyStore(),
    strategistProvider: makeMockProvider(() => strategy),
    writerProvider: makeMockProvider(() => copy),
  });

  assert.equal(result.status, 'draft');
  assert.equal(result.strategy?.confidence, 'high');
  assert.equal(result.strategy?.recommended_channel, 'email');
  assert.ok(result.strategy?.recipient_incentive.includes('120 European municipal utilities'));
  assert.ok(result.copy?.alternative_opening?.includes('Long-Duration Thermal Storage Whitepaper'));
  assert.equal(result.qa?.status, 'passed');
  assert.equal(result.qa?.score, 100);
});

// ============================================================================
// SCENARIO 2 & 7: Sparse research / No compelling personalised angle
// ============================================================================
test('Scenario 2 & 7: Sparse research and no compelling personal angle does not manufacture familiarity, sets low confidence, and flags the limitation honestly', async () => {
  const brief = makeBrief();
  const settings = makeSettings();
  const sparseEntry = makeResearchEntry({
    record_id: 'rec-sparse',
    identity: {
      name: 'Hannah Lindqvist',
      entity_kind: 'person',
      identity_verified: true,
    },
    role: 'Head of Grid Operations',
    organisation: 'Nordic Municipal Power',
    summary: 'Hannah Lindqvist serves as Head of Grid Operations at Nordic Municipal Power.',
    background: [],
    work_and_projects: [],
    achievements: [],
    industry_activity: [],
    research_confidence: 'low',
    unknowns: [{ field: 'work_and_projects', reason: 'No public speaking or project publications found' }],
  });

  const rawStrategy = makeBaseStrategy({
    readiness: 'needs_more_research',
    readiness_reason: 'Only role and organisation confirmed; no personal publications found.',
    confidence: 'high',
    hooks: [
      {
        id: 'H1',
        fact: 'Serves as Head of Grid Operations at Nordic Municipal Power',
        evidence_quote: null,
        source_ids: ['S1'],
        why_it_resonates: 'Role oversees municipal grid operations relevant to the forum.',
        strength: 'weak',
      },
    ],
    primary_hook_id: 'H1',
    angle: 'Role-level connection as Head of Grid Operations at Nordic Municipal Power.',
    recipient_incentive: 'Peer benchmarking with 120 municipal utilities and industrial grid operators in London.',
    avoid: [],
    human_checks: [],
  });

  const honestCopy: OutreachCopy = {
    subject_lines: [
      { text: 'Nordic Municipal Power / November grid operators forum', style: 'direct' },
      { text: 'Benchmarking notes from 120 municipal utilities', style: 'value' },
      { text: 'Grid operations roundtable on 14 November', style: 'curiosity' },
    ],
    email_body: `Hi Hannah,

Because you oversee grid operations at Nordic Municipal Power, I wanted to share a practical forum that may be relevant to your team's current planning.

On 14 November 2026 in London, Meridian Forum is bringing together 120 municipal utilities and industrial grid operators to compare grid-scale storage and balancing approaches. Attending or nominating a colleague gives your operations team direct access to peer utility case studies.

Would you be the right person to review the one-page programme overview, or is there someone else on your team I should send it to?

Best regards,
Elena Vance`,
    alternative_opening: null,
    linkedin_message:
      'Hi Hannah — given your role leading grid operations at Nordic Municipal Power, would a 1-page overview of our 14 Nov London forum with 120 municipal utilities be relevant to your team?',
    follow_up_body: `Hi Hannah,

Following up briefly in case the 14 November municipal utilities roundtable in London is relevant for Nordic Municipal Power. Would it be helpful if I shared the one-page agenda?`,
    hook_usage: 'Used honest role and organisation remit (H1) without manufacturing personal hooks.',
  };

  const result = await runPersonalizationAgent({
    projectId: 'proj-1',
    brief,
    entry: sparseEntry,
    settings,
    store: createEmptyStore(),
    strategistProvider: makeMockProvider(() => rawStrategy),
    writerProvider: makeMockProvider(() => honestCopy),
  });

  assert.equal(result.status, 'draft');
  assert.equal(result.strategy?.confidence, 'low');
  assert.equal(result.copy?.alternative_opening, null);
  assert.ok(
    result.strategy?.human_checks.some((c) => c.toLowerCase().includes('limited person-level research')),
    'Should flag sparse research limitation in human_checks',
  );
  assert.ok(
    result.reviewer_note?.toLowerCase().includes('low personalization confidence'),
    'Should surface low confidence limitation in reviewer_note',
  );
});

// ============================================================================
// SCENARIO 3: Company or organisation rather than an individual (with KeyContacts)
// ============================================================================
test('Scenario 3: Organisation prospect with discovered KeyContacts routes outreach to the responsible decision-maker and organisation remit', async () => {
  const brief = makeBrief({
    entityKind: 'organisation',
    targetType: 'publishing_organisations',
    name: 'Independent Translation Grant Programme',
    primary_objective: 'Partner with independent presses to co-fund translated fiction titles in 2026.',
  });
  const settings = makeSettings({
    organisation: 'European Literary Translation Trust',
    campaign_facts: [
      'Grants cover up to 60% of certified translation costs for independent presses.',
      'Spring application window closes on 30 November 2026.',
    ],
  });
  const orgEntry = makeResearchEntry({
    record_id: 'rec-org',
    identity: {
      name: 'Harbourlight Press',
      entity_kind: 'organisation',
      identity_verified: true,
    },
    role: 'Independent Literary Publisher',
    organisation: 'Harbourlight Press',
    summary: 'Harbourlight Press is an independent publisher in Bristol with an expanding European translated fiction list.',
    work_and_projects: ['Baltic Voices in Translation series (launched 2025)'],
    public_contact: [
      { kind: 'email', value: 'info@harbourlightpress.co.uk', source_ids: ['S1'], confidence: 'likely', is_professional: true },
    ],
    key_contacts: [
      {
        name: 'Clara Mensah',
        role: 'Rights & Co-Editions Director',
        department: 'Editorial & Rights',
        email: 'c.mensah@harbourlightpress.co.uk',
        linkedin_url: 'https://linkedin.com/in/clara-mensah-publishing',
        phone: null,
        relevance: 'Handles translation grants, rights partnerships, and co-editions',
        source_ids: ['S1'],
        confidence: 'verified',
      },
    ],
  });

  const prompt = buildStrategistUserPrompt(brief, orgEntry, settings, '');
  assert.ok(prompt.includes('[KeyContact:Clara Mensah — Rights & Co-Editions Director · Editorial & Rights] Direct Email: c.mensah@harbourlightpress.co.uk'));
  assert.ok(prompt.includes('Personal LinkedIn: https://linkedin.com/in/clara-mensah-publishing'));

  const orgStrategy = makeBaseStrategy({
    prospect_snapshot: 'Harbourlight Press is a Bristol independent publisher running the Baltic Voices in Translation series, with Clara Mensah directing Rights & Co-Editions.',
    relevance_thesis: 'Their Baltic Voices in Translation list directly qualifies for our co-funding translation grants.',
    recipient_incentive: 'Co-funding covering up to 60% of certified translation costs for Harbourlight Press’s upcoming translated fiction slate.',
    hooks: [
      {
        id: 'H1',
        fact: 'Launched the Baltic Voices in Translation series in 2025',
        evidence_quote: null,
        source_ids: ['S1'],
        why_it_resonates: 'Directly eligible for co-funded translation support.',
        strength: 'strong',
      },
    ],
    primary_hook_id: 'H1',
    angle: 'Supporting Harbourlight Press’s Baltic Voices in Translation series with 60% translation co-funding.',
    recommended_channel: 'email',
    contact_audit: {
      best_channel: 'email',
      best_contact_target: 'c.mensah@harbourlightpress.co.uk',
      why_best_route: 'Clara Mensah is the verified Rights & Co-Editions Director handling translation grants, avoiding the generic info@ inbox.',
      is_direct_contact: true,
      email_status: 'verified_direct',
      backup_route: 'https://linkedin.com/in/clara-mensah-publishing',
      evaluated_routes: [
        {
          channel: 'email',
          value: 'c.mensah@harbourlightpress.co.uk',
          verdict: 'recommended',
          quality_assessment: 'Named decision-maker email',
          priority: 1,
        },
        {
          channel: 'email',
          value: 'info@harbourlightpress.co.uk',
          verdict: 'generic_gatekeeper',
          quality_assessment: 'General publisher inbox',
          priority: 2,
        },
      ],
    },
    call_to_action: 'Would it be useful if I sent the eligibility summary for your 2026 Baltic Voices titles before the 30 November window?',
  });

  const writerPrompt = buildWriterUserPrompt(orgStrategy, orgEntry, settings, 'Harbourlight Press', brief);
  assert.ok(writerPrompt.includes('Clara Mensah (Rights & Co-Editions Director, Editorial & Rights)'));
});

// ============================================================================
// SCENARIO 4, 5 & 6: Cross-Project Adaptability (Partnership, Commercial B2B, Recruitment)
// ============================================================================
test('Scenario 4, 5 & 6: Adapts value proposition, tone, and CTA across Partnership, Commercial B2B, and Recruitment projects without Maya assumptions', async () => {
  // Scenario 4: Partnership Opportunity
  const partnershipBrief = makeBrief({
    name: 'OpenFin Developer Ecosystem Alliance',
    primary_objective: 'Co-host technical workshops with regional fintech associations.',
    targetType: 'ecosystem_partners',
  });
  // Scenario 5: Commercial B2B Opportunity
  const commercialBrief = makeBrief({
    name: 'VeriSupply Cold-Chain Telemetry',
    primary_objective: 'Help pharmaceutical distributors cut cold-chain excursion spoilage.',
    targetType: 'logistics_directors',
  });
  // Scenario 6: Technical Recruitment Project
  const recruitmentBrief = makeBrief({
    name: 'Aether Robotics Principal Controls Search',
    primary_objective: 'Recruit a Principal Flight Controls Engineer for autonomous aerial inspection.',
    targetType: 'robotics_engineers',
  });

  const entry = makeResearchEntry({
    identity: {
      name: 'Soren Lindholm',
      entity_kind: 'person',
      identity_verified: true,
    },
    role: 'Lead Flight Control Architect',
    organisation: 'NordDrone Systems',
    work_and_projects: ['Designed the Gust-Rejecting Attitude Controller for offshore wind inspection drones'],
  });

  const pPrompt = buildStrategistUserPrompt(partnershipBrief, entry, makeSettings({ organisation: 'OpenFin' }), '');
  const cPrompt = buildStrategistUserPrompt(commercialBrief, entry, makeSettings({ organisation: 'VeriSupply' }), '');
  const rPrompt = buildStrategistUserPrompt(recruitmentBrief, entry, makeSettings({ organisation: 'Aether Robotics' }), '');

  assert.ok(pPrompt.includes('OpenFin Developer Ecosystem Alliance'));
  assert.ok(cPrompt.includes('VeriSupply Cold-Chain Telemetry'));
  assert.ok(rPrompt.includes('Aether Robotics Principal Controls Search'));
  assert.ok(!pPrompt.toLowerCase().includes('maya'));
  assert.ok(!cPrompt.toLowerCase().includes('maya'));
  assert.ok(!rPrompt.toLowerCase().includes('maya'));
});

// ============================================================================
// SCENARIO 8: Conflicting or uncertain information
// ============================================================================
test('Scenario 8: Conflicting research lowers confidence, populates Things to Avoid, and blocks drafts that state contradicted claims', () => {
  const brief = makeBrief();
  const conflictedEntry = makeResearchEntry({
    contradictions: [
      'Directory lists him as VP at Solaris Grid, but 2026 press release states he left Solaris Grid in 2024.',
    ],
  });

  const rawStrategy = makeBaseStrategy({
    confidence: 'high',
    avoid: ['Do not mention "Solaris Grid" as his current employer'],
  });

  const normalized = normalizeStrategyDossier(rawStrategy, conflictedEntry.record, brief);
  assert.equal(normalized.confidence, 'low', 'Confidence must be capped at low when contradictions exist');
  assert.ok(
    normalized.avoid.some((a) => a.includes('Conflicting research')),
    'Contradiction must be added to strategy.avoid',
  );
  assert.ok(
    normalized.human_checks.some((c) => c.includes('Verify conflicting detail')),
    'Contradiction must be added to strategy.human_checks',
  );

  // If a draft accidentally mentions the forbidden "Solaris Grid" phrase, QA must fail it with avoid_rule_violated
  const badCopy: OutreachCopy = {
    subject_lines: [
      { text: 'Orkney pilot & Solaris Grid', style: 'direct' },
      { text: 'Storage roundtable in London', style: 'value' },
      { text: 'November utility forum', style: 'curiosity' },
    ],
    email_body: `Hi Marcus,

Given your work on the Orkney Microgrid Balancing Pilot and your role at Solaris Grid, we would love to share the brief for our 14 November 2026 London forum with 120 municipal utilities.

Would it be useful if I sent the one-page brief?

Best,
Elena`,
    alternative_opening: null,
    linkedin_message: 'Hi Marcus — saw your Orkney Microgrid Balancing Pilot work. Open to seeing our 14 Nov London brief?',
    follow_up_body: 'Hi Marcus, following up on the Orkney pilot roundtable brief. Would you like me to send it over?',
    hook_usage: 'Used H1',
  };

  const qa = validatePersonalizationCopy(normalized, badCopy, conflictedEntry.record);
  assert.equal(qa.status, 'failed');
  assert.ok(qa.issues.some((i) => i.code === 'avoid_rule_violated'));
});

// ============================================================================
// SCENARIO 9: A message that sounds generic despite containing accurate facts
// ============================================================================
test('Scenario 9: QA catches generic copy and decorative flattery when strong facts exist, and agent auto-revises into a specific message', async () => {
  const brief = makeBrief();
  const settings = makeSettings();
  const entry = makeResearchEntry();
  const strategy = makeBaseStrategy();

  // Attempt 1: Generic template copy that ignores the Orkney Microgrid Balancing Pilot and uses banned clichés
  const genericAttempt1: OutreachCopy = {
    subject_lines: [
      { text: 'Invitation to Meridian Forum', style: 'direct' },
      { text: 'Collaboration opportunity', style: 'value' },
      { text: 'Quick question for you', style: 'curiosity' },
    ],
    email_body: `Hi Marcus,

I noticed your impressive work in the industry and wanted to reach out to introduce our organisation. Congratulations on your continued success as Director of Grid Modernisation.

We are hosting an upcoming event in London on 14 November 2026 and would love to explore synergies with you. Our organisation brings together industry professionals to discuss energy topics and share insights.

Would you be open to a quick call?

Best regards,
Elena Vance`,
    alternative_opening: null,
    linkedin_message: 'Hi Marcus, I noticed your impressive work in the industry and wanted to reach out to explore synergies.',
    follow_up_body: 'Hi Marcus, just following up on my previous email about our event.',
    hook_usage: 'General role mention',
  };

  // Verify QA deterministically catches the generic template & banned patterns
  const qaAttempt1 = validatePersonalizationCopy(strategy, genericAttempt1, entry.record, { brief, settings });
  assert.equal(qaAttempt1.status, 'failed');
  const codes = qaAttempt1.issues.map((i) => i.code);
  assert.ok(codes.includes('banned_cliche_impressive_work_in_industry'));
  assert.ok(codes.includes('banned_cliche_continued_success'));
  assert.ok(codes.includes('banned_corporate_explore_synergies'));
  assert.ok(codes.includes('primary_hook_omitted_from_copy'));
  assert.ok(codes.includes('generic_copy_despite_facts'));

  // Attempt 2: Specific, human, incentive-driven copy returned on self-correction pass
  const specificAttempt2: OutreachCopy = {
    subject_lines: [
      { text: 'Orkney Microgrid Balancing Pilot / 14 Nov London', style: 'direct' },
      { text: 'Peer exchange with 120 municipal utilities', style: 'value' },
      { text: 'NorthSea Energy case study in London', style: 'curiosity' },
    ],
    email_body: `Hi Marcus,

The dispatch reliability data from your Orkney Microgrid Balancing Pilot at NorthSea Energy Cooperative addresses the exact question several municipal utilities in our November cohort are trying to solve.

On 14 November 2026 in London, we are bringing together 120 municipal utilities and industrial grid operators to compare long-duration and microgrid balancing models. Sharing a short case study from Orkney would connect your team directly with European utility engineers planning 2027 procurements.

Would you like to see the one-page roundtable brief to check if the format fits your calendar?

Best,
Elena Vance`,
    alternative_opening:
      'Your 2025 Long-Duration Thermal Storage Whitepaper maps closely to the procurement questions our 120 municipal utilities are debating in London this November.',
    linkedin_message:
      'Hi Marcus — the dispatch results from your Orkney Microgrid Balancing Pilot fit a 120-utility roundtable we are hosting in London on 14 Nov. Open to seeing the 1-page brief?',
    follow_up_body:
      'Hi Marcus, following up briefly in case sharing the Orkney Microgrid Balancing Pilot findings with our 120 municipal utilities in London on 14 November is of interest. Happy to send the one-page brief?',
    hook_usage: 'Used H1 (Orkney Microgrid Balancing Pilot) in the opening sentence and connected it to the 120 municipal utilities.',
  };

  const result = await runPersonalizationAgent({
    projectId: 'proj-1',
    brief,
    entry,
    settings,
    store: createEmptyStore(),
    strategistProvider: makeMockProvider(() => strategy),
    writerProvider: makeMockProvider((_req, callIndex) => (callIndex === 1 ? genericAttempt1 : specificAttempt2)),
  });

  assert.equal(result.auto_revisions, 1, 'Agent should self-correct after Attempt 1 failed QA');
  assert.equal(result.qa?.status, 'passed');
  assert.ok(result.copy?.email_body.includes('Orkney Microgrid Balancing Pilot'));
});

// ============================================================================
// SCENARIO 10: A message that is persuasive but makes unsupported claims
// ============================================================================
test('Scenario 10: QA catches persuasive messages with unverified numeric/promotional claims or guarantees and triggers self-correction', async () => {
  const brief = makeBrief();
  const settings = makeSettings();
  const entry = makeResearchEntry();
  const strategy = makeBaseStrategy();

  // Attempt 1: Persuasive message that invents unverified numbers (£250,000 grant, 45% cost reduction, 50,000+ readers, guaranteed exposure)
  const unsupportedClaimsCopy: OutreachCopy = {
    subject_lines: [
      { text: 'Orkney Microgrid Balancing Pilot / Meridian Forum', style: 'direct' },
      { text: 'Unlock £250,000 in partner funding in London', style: 'value' },
      { text: 'NorthSea Energy Cooperative case study', style: 'curiosity' },
    ],
    email_body: `Hi Marcus,

Your work on the Orkney Microgrid Balancing Pilot at NorthSea Energy Cooperative is a natural fit for our 14 November 2026 London forum.

Participating gives NorthSea Energy Cooperative guaranteed exposure to 50,000+ readers, access to a £250,000 innovation grant pool, and a 45% faster procurement cycle with European utilities. Don't miss out on this limited time only slot.

Would it be useful if I sent the one-page brief for the November roundtable?

Best,
Elena Vance`,
    alternative_opening: null,
    linkedin_message:
      'Hi Marcus — your Orkney Microgrid Balancing Pilot qualifies for guaranteed exposure and £250,000 partner funding at our 14 Nov forum. Open to the brief?',
    follow_up_body:
      'Hi Marcus, following up on the Orkney Microgrid Balancing Pilot invitation for our 14 November London forum. Would you like the one-page brief?',
    hook_usage: 'Used H1',
  };

  const qa1 = validatePersonalizationCopy(strategy, unsupportedClaimsCopy, entry.record, { brief, settings });
  assert.equal(qa1.status, 'failed');
  const codes = qa1.issues.map((i) => i.code);
  assert.ok(codes.includes('unsupported_claim_in_copy'), 'Must flag unverified £250,000 / 45% / 50,000+ claims');
  assert.ok(codes.includes('unsupported_guarantee'), 'Must flag guaranteed exposure');
  assert.ok(codes.includes('false_urgency'), 'Must flag don\'t miss out / limited time only');

  // Attempt 2: Grounded strictly in verified research (99.4% Orkney dispatch reliability) and confirmed campaign facts (120 municipal utilities, 14 November 2026)
  const groundedCopy: OutreachCopy = {
    subject_lines: [
      { text: 'Orkney Microgrid Balancing Pilot / 14 Nov London', style: 'direct' },
      { text: 'Sharing Orkney dispatch data with 120 utilities', style: 'value' },
      { text: 'NorthSea Energy Cooperative at Meridian Forum', style: 'curiosity' },
    ],
    email_body: `Hi Marcus,

Achieving 99.4% renewable dispatch reliability on the Orkney Microgrid Balancing Pilot at NorthSea Energy Cooperative is directly relevant to the utility engineers attending our London forum.

On 14 November 2026, Meridian Forum brings together 120 municipal utilities and industrial grid operators to examine practical microgrid and storage deployment data. Presenting a short case study on the Orkney pilot would put your team's engineering work in front of municipal grid decision-makers across Europe.

Would it be useful if I sent the one-page brief for the November roundtable in London?

Best,
Elena Vance`,
    alternative_opening:
      'Your 2025 Long-Duration Thermal Storage Whitepaper addresses the exact procurement trade-offs that 120 municipal utilities will be reviewing at our 14 November forum in London.',
    linkedin_message:
      'Hi Marcus — your 99.4% dispatch reliability results on the Orkney Microgrid Balancing Pilot would resonate with the 120 municipal utilities at our 14 Nov London forum. Open to seeing the 1-page brief?',
    follow_up_body:
      'Hi Marcus, following up briefly in case presenting the Orkney Microgrid Balancing Pilot to 120 municipal utilities in London on 14 November is relevant for NorthSea Energy Cooperative. Shall I send the one-pager?',
    hook_usage: 'Used H1 and verified 99.4% Orkney achievement.',
  };

  const result = await runPersonalizationAgent({
    projectId: 'proj-1',
    brief,
    entry,
    settings,
    store: createEmptyStore(),
    strategistProvider: makeMockProvider(() => strategy),
    writerProvider: makeMockProvider((_req, callIndex) => (callIndex === 1 ? unsupportedClaimsCopy : groundedCopy)),
  });

  assert.equal(result.auto_revisions, 1);
  assert.equal(result.qa?.status, 'passed');
  assert.equal(result.qa?.score, 100);
});

// ============================================================================
// SCENARIO 11: Generic message despite containing accurate research (biographical recap)
// ============================================================================
test('Scenario 11: QA catches messages that insert accurate research into a generic biographical template, and self-corrects into a natural connection', async () => {
  const brief = makeBrief();
  const settings = makeSettings();
  const entry = makeResearchEntry();
  const strategy = makeBaseStrategy({
    recipient_priorities: 'Validating islanded microgrid balancing data and long-duration thermal storage economics.',
    potential_objections: ['Time commitment required to prepare a presentation', 'Unclear whether attendees are technical peers or sales vendors'],
    narrative_approach: 'Lead directly with the 120-utility technical peer exchange in London and connect it to the Orkney dispatch reliability findings, addressing time friction upfront.',
  });

  // Attempt 1: Contains the exact researched fact ("Orkney Microgrid Balancing Pilot") but recites the bio back to them in a generic AI template
  const bioRecapCopy: OutreachCopy = {
    subject_lines: [
      { text: 'Orkney Microgrid Balancing Pilot', style: 'direct' },
      { text: 'Meridian Forum invitation', style: 'value' },
      { text: 'Connecting with NorthSea Energy Cooperative', style: 'curiosity' },
    ],
    email_body: `Hi Marcus,

According to your LinkedIn profile, you have 12 years of experience and lead the Orkney Microgrid Balancing Pilot at NorthSea Energy Cooperative. That is why I am reaching out to you today.

We are hosting the Meridian Forum in London on 14 November 2026 with 120 municipal utilities and industrial grid operators. It is a great opportunity for professionals like you to share insights on long-duration storage models.

Would it be useful if I sent the one-page brief for the November roundtable in London?

Best,
Elena Vance`,
    alternative_opening: null,
    linkedin_message:
      'Hi Marcus — I saw on your profile that you lead the Orkney Microgrid Balancing Pilot. Open to seeing our 14 Nov London forum brief for 120 municipal utilities?',
    follow_up_body:
      'Hi Marcus, following up on the Orkney Microgrid Balancing Pilot invitation for our 14 November London forum with 120 municipal utilities. Shall I send the brief?',
    hook_usage: 'Inserted H1 into opening',
  };

  const qa1 = validatePersonalizationCopy(strategy, bioRecapCopy, entry.record, { brief, settings });
  assert.equal(qa1.status, 'failed');
  const codes = qa1.issues.map((i) => i.code);
  assert.ok(codes.includes('biographical_recap_or_superficial_research'), 'Must flag biographical recap ("According to your LinkedIn profile")');
  assert.ok(codes.includes('superficial_template_filler'), 'Must flag superficial filler ("for professionals like you")');
  assert.ok(codes.includes('banned_ai_transition'), 'Must flag predictable AI transition ("That is why I am reaching out")');

  // Attempt 2: Leads with the relevant peer exchange and connects the Orkney findings without reciting Marcus's CV back to him
  const naturalCopy: OutreachCopy = {
    subject_lines: [
      { text: '14 Nov utility roundtable / Orkney dispatch data', style: 'direct' },
      { text: '120 municipal grid operators comparing storage models', style: 'value' },
      { text: 'Orkney Microgrid Balancing Pilot — London peer session', style: 'curiosity' },
    ],
    email_body: `Hi Marcus,

On 14 November 2026 in London, 120 European municipal utilities and industrial grid operators are meeting at Meridian Forum for a closed-door engineering exchange on long-duration storage and islanded balancing.

Because several participating utilities are currently benchmarking microgrid dispatch reliability against your findings from the Orkney Microgrid Balancing Pilot at NorthSea Energy Cooperative, your perspective would add real technical weight to the session — with no slide deck required.

Would it be useful if I sent the one-page roundtable brief so you can see the participating utilities and format?

Best,
Elena Vance`,
    alternative_opening:
      'Several municipal utilities joining us in London on 14 November are evaluating the thermal storage trade-offs you analysed in your 2025 Long-Duration Thermal Storage Whitepaper.',
    linkedin_message:
      'Hi Marcus — 120 municipal utilities are meeting in London on 14 Nov to compare storage models, and several are looking at the Orkney Microgrid Balancing Pilot. Open to seeing the 1-page brief?',
    follow_up_body:
      'Hi Marcus, following up briefly in case the 14 November engineering exchange with 120 municipal utilities in London is relevant for NorthSea Energy Cooperative. Happy to send the one-page brief?',
    hook_usage: 'Led with the 120-utility peer exchange (opportunity-led narrative) and connected it to H1 (Orkney Microgrid Balancing Pilot).',
  };

  const result = await runPersonalizationAgent({
    projectId: 'proj-1',
    brief,
    entry,
    settings,
    store: createEmptyStore(),
    strategistProvider: makeMockProvider(() => strategy),
    writerProvider: makeMockProvider((_req, callIndex) => (callIndex === 1 ? bioRecapCopy : naturalCopy)),
  });

  assert.equal(result.auto_revisions, 1);
  assert.equal(result.qa?.status, 'passed');
  assert.equal(result.qa?.score, 100);
});

// ============================================================================
// SCENARIO 12: Mentions the recipient's work but offers no meaningful incentive
// ============================================================================
test('Scenario 12: QA catches messages that mention the recipient but offer no meaningful recipient incentive, and self-corrects to include clear value exchange', async () => {
  const brief = makeBrief();
  const settings = makeSettings();
  const entry = makeResearchEntry();
  const strategy = makeBaseStrategy();

  // Attempt 1: Mentions the Orkney Microgrid Balancing Pilot accurately, but frames the ask purely around what the sender wants ("we need speakers to fill our agenda") with zero recipient benefit
  const senderCentricCopy: OutreachCopy = {
    subject_lines: [
      { text: 'Orkney Microgrid Balancing Pilot / Meridian Forum', style: 'direct' },
      { text: 'Speaker request for November', style: 'value' },
      { text: 'NorthSea Energy Cooperative', style: 'curiosity' },
    ],
    email_body: `Hi Marcus,

Your work on the Orkney Microgrid Balancing Pilot at NorthSea Energy Cooperative caught our attention.

We are organising the Meridian Forum in London on 14 November 2026 and we need speakers to fill our afternoon programme so we can hit our target before registration closes. We need your help to complete the panel lineup this month.

Can you confirm if you will speak at our event?

Best,
Elena Vance`,
    alternative_opening: null,
    linkedin_message:
      'Hi Marcus — we saw your Orkney Microgrid Balancing Pilot work and we need speakers to fill our 14 Nov London agenda. Can you help us?',
    follow_up_body:
      'Hi Marcus, following up to see if you can help us fill our speaker slot on 14 November regarding the Orkney Microgrid Balancing Pilot. Can you join?',
    hook_usage: 'Used H1',
  };

  const qa1 = validatePersonalizationCopy(strategy, senderCentricCopy, entry.record, { brief, settings });
  assert.equal(qa1.status, 'failed');
  assert.ok(
    qa1.issues.some((i) => i.code === 'missing_recipient_incentive_in_copy'),
    'Must flag messages that mention the recipient but offer no meaningful recipient incentive',
  );

  // Attempt 2: Articulates a clear, credible recipient incentive (direct peer exchange with 120 European municipal utilities and industrial grid operators)
  const recipientValueCopy: OutreachCopy = {
    subject_lines: [
      { text: 'Orkney Microgrid Balancing Pilot / 120 municipal utilities', style: 'direct' },
      { text: 'Peer exchange on long-duration storage in London', style: 'value' },
      { text: 'NorthSea Energy Cooperative case study on 14 Nov', style: 'curiosity' },
    ],
    email_body: `Hi Marcus,

Your work on the Orkney Microgrid Balancing Pilot at NorthSea Energy Cooperative addresses the exact islanded balancing questions that utility engineers in our November cohort are working through.

On 14 November 2026 in London, Meridian Forum brings together 120 European municipal utilities and industrial grid operators evaluating long-duration storage models. Contributing a brief case study from Orkney gives your team a direct peer exchange with municipal procurement and grid integration leads across Europe.

Would it be useful if I sent the one-page brief for the November roundtable in London?

Best,
Elena Vance`,
    alternative_opening:
      'Your 2025 Long-Duration Thermal Storage Whitepaper speaks directly to the storage procurement models that 120 European municipal utilities will be comparing in London on 14 November.',
    linkedin_message:
      'Hi Marcus — contributing a short Orkney Microgrid Balancing Pilot case study on 14 Nov in London connects your team with 120 European municipal utilities evaluating storage models. Open to the 1-page brief?',
    follow_up_body:
      'Hi Marcus, following up in case connecting with 120 European municipal utilities and industrial grid operators in London on 14 November around the Orkney Microgrid Balancing Pilot is useful for NorthSea Energy Cooperative. Shall I send the one-pager?',
    hook_usage: 'Connected H1 to the recipient incentive (peer exchange with 120 European municipal utilities).',
  };

  const result = await runPersonalizationAgent({
    projectId: 'proj-1',
    brief,
    entry,
    settings,
    store: createEmptyStore(),
    strategistProvider: makeMockProvider(() => strategy),
    writerProvider: makeMockProvider((_req, callIndex) => (callIndex === 1 ? senderCentricCopy : recipientValueCopy)),
  });

  assert.equal(result.auto_revisions, 1);
  assert.equal(result.qa?.status, 'passed');
  assert.equal(result.qa?.score, 100);
});

// ============================================================================
// SCENARIO 13: Sponsorship, Partnership, Sales & Recruitment Non-Interchangeable Adaptation
// ============================================================================
test('Scenario 13: Produces distinct, non-formulaic strategies and messages across Sponsorship, Partnership, Sales, and Recruitment scenarios', async () => {
  const scenarios = [
    {
      kind: 'sponsorship',
      brief: makeBrief({
        name: 'UK Clean Grid Engineering Fellowship',
        primary_objective: 'Secure corporate fellowship sponsors from regional energy technology providers.',
        targetType: 'sponsors',
        outreachObjective: 'Share the fellowship sponsorship prospectus and gauge alignment with their engineering talent pipeline.',
      }),
      settings: makeSettings({
        organisation: 'Clean Grid Foundation',
        campaign_facts: [
          'Sponsors are paired directly with 15 final-year power-systems postgraduates for 6-month applied industry placements.',
        ],
      }),
      strategy: makeBaseStrategy({
        recipient_priorities: 'Recruiting scarce power-systems engineers for microgrid and thermal storage R&D in Scotland.',
        recipient_incentive: 'Direct placement access to 15 final-year power-systems postgraduates for 6-month applied industry placements.',
        potential_objections: ['Unclear sponsorship ROI versus direct university recruiting'],
        narrative_approach: 'Start with the postgraduate engineering placement pipeline and connect it to the technical staffing demands of scaling the Orkney Microgrid Balancing Pilot.',
        call_to_action: 'Would it be useful to see the two-page fellowship placement overview for 2026?',
      }),
      copy: {
        subject_lines: [
          { text: 'Power-systems postgraduate placements / NorthSea Energy', style: 'direct' as const },
          { text: 'Applied engineering fellows for microgrid R&D', style: 'value' as const },
          { text: 'Orkney Microgrid Balancing Pilot — 2026 fellowship cohort', style: 'curiosity' as const },
        ],
        email_body: `Hi Marcus,

Sponsors of the 2026 UK Clean Grid Engineering Fellowship are paired directly with 15 final-year power-systems postgraduates for 6-month applied industry placements.

As NorthSea Energy Cooperative builds on the Orkney Microgrid Balancing Pilot and your 2025 Long-Duration Thermal Storage Whitepaper, hosting an applied fellow offers a practical way to evaluate specialist grid-balancing talent on live project work before making permanent hires.

Would it be useful to see the two-page fellowship placement overview for 2026?

Best,
Elena Vance`,
        alternative_opening:
          'Scaling technical initiatives like the Orkney Microgrid Balancing Pilot often depends on finding power-systems engineers who already understand islanded dispatch constraints.',
        linkedin_message:
          'Hi Marcus — our 2026 Fellowship pairs sponsors with 15 power-systems postgraduates for 6-month placements, which could support your Orkney Microgrid Balancing Pilot team. Open to the 2-page overview?',
        follow_up_body:
          'Hi Marcus, following up in case hosting a power-systems postgraduate fellow for 6-month applied work alongside the Orkney Microgrid Balancing Pilot is useful for NorthSea Energy Cooperative. Happy to send the overview?',
        hook_usage: 'Led with the concrete placement benefit (15 power-systems postgraduates) and tied it to H1 (Orkney Microgrid Balancing Pilot).',
      },
    },
    {
      kind: 'sales',
      brief: makeBrief({
        name: 'VoltSim Hardware-in-the-Loop Grid Emulator',
        primary_objective: 'Introduce modular HIL fault-testing hardware to utility grid modernisation directors.',
        targetType: 'enterprise_buyers',
        outreachObjective: 'Offer a technical benchmark comparison showing sub-millisecond inverter fault simulation.',
      }),
      settings: makeSettings({
        organisation: 'VoltSim Labs',
        campaign_facts: [
          'VoltSim emulates islanded inverter fault cascades in hardware before field commissioning.',
        ],
      }),
      strategy: makeBaseStrategy({
        recipient_priorities: 'Maintaining the 99.4% renewable dispatch reliability achieved on the Orkney interconnect as new thermal and battery assets are added.',
        recipient_incentive: 'Testing islanded inverter fault cascades in hardware before field commissioning on the Orkney interconnect.',
        potential_objections: ['Integration compatibility with existing SCADA and protection relays'],
        narrative_approach: 'Open with the engineering challenge of protecting 99.4% dispatch reliability during microgrid expansion and offer a zero-commitment technical benchmark note.',
        call_to_action: 'Would the four-page technical benchmark on islanded inverter fault emulation be relevant to your engineering team?',
      }),
      copy: {
        subject_lines: [
          { text: 'Inverter fault emulation for the Orkney interconnect', style: 'direct' as const },
          { text: 'Hardware-in-the-loop testing before microgrid commissioning', style: 'value' as const },
          { text: 'Protecting 99.4% dispatch reliability on islanded grids', style: 'curiosity' as const },
        ],
        email_body: `Hi Marcus,

Maintaining 99.4% renewable dispatch reliability on the Orkney Microgrid Balancing Pilot gets harder each time new inverter-based storage assets are added to an islanded interconnect.

At VoltSim Labs, we built a hardware emulator that tests islanded inverter fault cascades before field commissioning, plugging directly into standard utility SCADA and relay test benches without custom firmware.

Would the four-page technical benchmark on islanded inverter fault emulation be relevant to your engineering team?

Best,
Elena Vance`,
        alternative_opening:
          'Your 2025 Long-Duration Thermal Storage Whitepaper highlighted the switching transients that occur when hybrid storage assets cycle on constrained regional grids.',
        linkedin_message:
          'Hi Marcus — we built a hardware emulator that tests islanded inverter fault cascades before field commissioning, relevant to your Orkney Microgrid Balancing Pilot. Useful if I send the 4-page technical benchmark?',
        follow_up_body:
          'Hi Marcus, following up in case our four-page technical benchmark on testing islanded inverter fault cascades before field commissioning is useful for the Orkney Microgrid Balancing Pilot team. Shall I send it over?',
        hook_usage: 'Opened with the operational challenge of maintaining 99.4% dispatch reliability on the Orkney Microgrid Balancing Pilot (H1).',
      },
    },
    {
      kind: 'recruitment',
      brief: makeBrief({
        name: 'European Grid Resilience Advisory Board Search',
        primary_objective: 'Recruit three senior utility grid directors to the paid Technical Advisory Board.',
        targetType: 'advisory_candidates',
        outreachObjective: 'Share the advisory board charter and time commitment (four quarterly half-day reviews).',
      }),
      settings: makeSettings({
        organisation: 'Continental Grid Resilience Initiative',
        campaign_facts: [
          'The Technical Advisory Board meets four times a year (half-day reviews) and shapes European islanded-grid interoperability standards.',
        ],
      }),
      strategy: makeBaseStrategy({
        recipient_priorities: 'Ensuring islanded and coastal microgrid realities are represented in European grid interoperability standards.',
        recipient_incentive: 'Direct seat shaping European islanded-grid interoperability standards with a bounded commitment of four half-day reviews per year.',
        potential_objections: ['Concern that advisory roles demand excessive travel or administrative time away from NorthSea Energy Cooperative'],
        narrative_approach: 'Directly state the why-you thesis grounded in the Orkney Microgrid Balancing Pilot and immediately clarify the bounded four half-day commitment.',
        call_to_action: 'Are you open to reviewing the two-page Advisory Board charter to see if the remit interests you?',
      }),
      copy: {
        subject_lines: [
          { text: 'Technical Advisory Board seat — islanded grid standards', style: 'direct' as const },
          { text: 'Representing microgrid operators on the 2026 Advisory Board', style: 'value' as const },
          { text: 'Orkney Microgrid Balancing Pilot / European standards charter', style: 'curiosity' as const },
        ],
        email_body: `Hi Marcus,

We are appointing three practicing utility engineering directors to the Continental Grid Resilience Technical Advisory Board to shape European islanded-grid interoperability standards, and your work leading the Orkney Microgrid Balancing Pilot makes you a standout candidate.

The role is structured to fit alongside an active operational remit at NorthSea Energy Cooperative: four half-day reviews a year, giving your team a direct voice in how upcoming islanded and thermal storage standards are drafted.

Are you open to reviewing the two-page Advisory Board charter to see if the remit interests you?

Best,
Elena Vance`,
        alternative_opening:
          'Having authored the 2025 Long-Duration Thermal Storage Whitepaper while running the Orkney Microgrid Balancing Pilot, you bring rare field experience to European storage standard-setting.',
        linkedin_message:
          'Hi Marcus — we are inviting three utility directors to our Technical Advisory Board shaping European islanded-grid standards (four half-day reviews/year), and your Orkney Microgrid Balancing Pilot stood out. Open to seeing the charter?',
        follow_up_body:
          'Hi Marcus, following up briefly on the Technical Advisory Board charter for shaping European islanded-grid interoperability standards. Given your leadership of the Orkney Microgrid Balancing Pilot, would you be open to taking a look?',
        hook_usage: 'Used direct why-you recruitment thesis grounded in H1 (Orkney Microgrid Balancing Pilot) and addressed time-commitment friction.',
      },
    },
  ];

  for (const s of scenarios) {
    const entry = makeResearchEntry();
    const res = await runPersonalizationAgent({
      projectId: `proj-${s.kind}`,
      brief: s.brief,
      entry,
      settings: s.settings,
      store: createEmptyStore(),
      strategistProvider: makeMockProvider(() => s.strategy),
      writerProvider: makeMockProvider(() => s.copy),
    });

    assert.equal(res.qa?.status, 'passed', `${s.kind} scenario should pass QA cleanly`);
    assert.equal(res.qa?.score, 100, `${s.kind} scenario should achieve a 100 QA score`);
    assert.ok((res.strategy?.recipient_priorities?.length ?? 0) > 10, `${s.kind} should populate recipient_priorities`);
    assert.ok((res.strategy?.potential_objections?.length ?? 0) > 0, `${s.kind} should populate potential_objections`);
    assert.ok((res.strategy?.narrative_approach?.length ?? 0) > 10, `${s.kind} should populate narrative_approach`);
  }
});

// ============================================================================
// SCENARIO 14: Per-Lead Personalization Settings across Author, Sponsor, Literary Org & Business Partner
// ============================================================================
test('Scenario 14: Per-lead Personalization Settings produce recipient-aware defaults and meaningfully different messages across Author, Sponsor, Literary Organisation, and Business Partnership prospects', () => {
  const literaryBrief = makeBrief({
    name: '2026 International Indie Literary Prize & Readers Showcase',
    description:
      'Annual literary prize and curated bookshop showcase connecting independent fiction and poetry authors with 85 independent bookshops and festival programmers.',
    primary_objective:
      'Invite independent authors, literary organisations, sponsors, and business partners to participate in the 2026 showcase.',
    outreachObjective:
      'Highlight concrete reader visibility, curated bookshop distribution, and brand alignment benefits for each participant.',
  });
  const campaignSettings = makeSettings({
    sender_name: 'Clara Mendel',
    sender_role: 'Programme Director',
    organisation: 'Indie Literary Showcase',
    campaign_facts: [
      'Selected titles and partners are featured across 85 independent bookshops and regional literary festivals in Autumn 2026.',
    ],
  });

  // 1. Individual Author
  const authorEntry = makeResearchEntry({
    record_id: 'rec-author-1',
    target_type: 'Independent Fiction Authors',
    identity: {
      name: 'Amara Okafor',
      entity_kind: 'person',
      identity_verified: true,
    },
    role: 'Novelist & Essayist',
    organisation: null,
    summary: 'Award-shortlisted literary novelist based in Bristol, author of "The Salt Meridian" (2025).',
    work_and_projects: ['Published the 2025 literary novel "The Salt Meridian" with Peninsula Press'],
    achievements: ['Shortlisted for the 2025 Coastal Fiction Prize'],
    reason_for_relevance: 'Independent literary novelist with an active UK readership and 2025 release.',
  });

  // 2. Potential Sponsor
  const sponsorEntry = makeResearchEntry({
    record_id: 'rec-sponsor-1',
    target_type: 'Corporate Cultural Sponsors',
    identity: {
      name: 'Alder & Finch Paper Co.',
      entity_kind: 'organisation',
      identity_verified: true,
    },
    role: 'Brand Partnerships Team',
    organisation: 'Alder & Finch Paper Co.',
    summary: 'B-Corp archival book-paper manufacturer sponsoring independent publishing and print craft initiatives.',
    work_and_projects: ['Sponsored the 2025 Northern Small Press Print Bursary'],
    achievements: ['Supplied FSC-certified archival paper to 40 UK independent publishers in 2025'],
    reason_for_relevance: 'Active corporate sponsor of independent publishing and literary print awards.',
  });

  // 3. Literary Organisation
  const literaryOrgEntry = makeResearchEntry({
    record_id: 'rec-lit-org-1',
    target_type: 'Literary Organisations & Writing Centres',
    identity: {
      name: 'Scottish Emerging Writers Trust',
      entity_kind: 'organisation',
      identity_verified: true,
    },
    role: 'Programmes & Mentoring Team',
    organisation: 'Scottish Emerging Writers Trust',
    summary: 'Non-profit literary development organisation supporting debut novelists and poets across Scotland.',
    work_and_projects: ['Runs the annual Highland Debut Fiction Fellowship for 12 emerging authors'],
    achievements: ['Placed 9 fellowship alumni with independent UK publishers in 2025'],
    reason_for_relevance: 'Directly supports emerging literary authors who stand to benefit from bookshop showcase visibility.',
  });

  // 4. Business Partnership Prospect
  const businessPartnerEntry = makeResearchEntry({
    record_id: 'rec-partner-1',
    target_type: 'Business Partnership & Distribution Prospects',
    identity: {
      name: 'Julian Mercer',
      entity_kind: 'person',
      identity_verified: true,
    },
    role: 'Managing Director',
    organisation: 'Lantern Bookshop Collective',
    summary: 'Managing Director of Lantern Bookshop Collective, a network of 28 independent bookshops and subscription boxes.',
    work_and_projects: ['Launched the 2025 Independent Fiction Monthly Curation Box across 28 regional bookshops'],
    achievements: ['Grew independent press title sales by 34% across member shops in 2025'],
    reason_for_relevance: 'Commercial distribution and curation partner reaching independent fiction readers.',
  });

  // Verify sensible recipient-aware defaults differ by archetype
  const authorDefaults = defaultLeadPersonalizationSettings(authorEntry.record);
  const sponsorDefaults = defaultLeadPersonalizationSettings(sponsorEntry.record);
  const litOrgDefaults = defaultLeadPersonalizationSettings(literaryOrgEntry.record);
  const partnerDefaults = defaultLeadPersonalizationSettings(businessPartnerEntry.record);

  assert.equal(authorDefaults.tone, 'friendly', 'Individual author should default to friendly tone');
  assert.equal(authorDefaults.communication_approach, 'relationship_first', 'Individual author should default to relationship-first');
  assert.equal(sponsorDefaults.tone, 'professional', 'Potential sponsor should default to professional tone');
  assert.equal(sponsorDefaults.communication_approach, 'incentive_driven', 'Potential sponsor should default to incentive-driven');
  assert.equal(litOrgDefaults.tone, 'professional', 'Literary organisation should default to professional tone');
  assert.equal(partnerDefaults.message_length, 'very_short', 'Managing Director should default to very_short length');
  assert.equal(partnerDefaults.communication_approach, 'opportunity_first', 'Managing Director should default to opportunity-first');

  // Verify changing settings produces meaningfully different drafts for the same prospect
  const warmShortConfig: LeadPersonalizationSettings = {
    tone: 'friendly',
    message_length: 'very_short',
    personalization_depth: 'light',
    communication_approach: 'direct',
    explanation_level: 'minimal',
    call_to_action: 'soft',
    additional_instructions: 'Keep it warm, avoid sounding promotional, and focus on bookshop visibility.',
    updated_at: null,
  };

  const formalDetailedConfig: LeadPersonalizationSettings = {
    tone: 'formal',
    message_length: 'detailed',
    personalization_depth: 'deep',
    communication_approach: 'incentive_driven',
    explanation_level: 'detailed',
    call_to_action: 'direct',
    additional_instructions: 'Emphasise the 85 independent bookshops and ask directly about submitting The Salt Meridian.',
    updated_at: null,
  };

  const draftWarmShort = buildAdaptivePersonalizationEntry({
    projectId: 'proj-lit',
    researchEntry: authorEntry,
    brief: literaryBrief,
    settings: campaignSettings,
    leadSettings: warmShortConfig,
  });

  const draftFormalDetailed = buildAdaptivePersonalizationEntry({
    projectId: 'proj-lit',
    researchEntry: authorEntry,
    brief: literaryBrief,
    settings: campaignSettings,
    leadSettings: formalDetailedConfig,
  });

  assert.notEqual(
    draftWarmShort.copy?.email_body,
    draftFormalDetailed.copy?.email_body,
    'Changing tone, length, depth, approach, explanation, and CTA must produce meaningfully different messages',
  );
  assert.ok(
    draftFormalDetailed.copy!.email_body.startsWith('Dear Amara,'),
    'Formal tone should use "Dear ..." salutation',
  );
  assert.ok(
    draftWarmShort.copy!.email_body.startsWith('Hi Amara,'),
    'Friendly tone should use "Hi ..." salutation',
  );
  assert.ok(
    draftFormalDetailed.copy!.email_body.split(/\s+/).length >
      draftWarmShort.copy!.email_body.split(/\s+/).length + 25,
    'Detailed message length + detailed explanation must be meaningfully longer than very_short + minimal',
  );
  assert.ok(
    draftFormalDetailed.copy!.email_body.includes('Coastal Fiction Prize'),
    'Deep personalization must weave in secondary verified achievements (Coastal Fiction Prize)',
  );

  // Verify Strategist and Writer prompts explicitly include the per-lead settings block
  const strategistPrompt = buildStrategistUserPrompt(
    literaryBrief,
    authorEntry,
    campaignSettings,
    '',
    formalDetailedConfig,
  );
  assert.ok(strategistPrompt.includes('INDIVIDUAL LEAD PERSONALIZATION SETTINGS'));
  assert.ok(strategistPrompt.includes('Tone: Formal'));
  assert.ok(strategistPrompt.includes('Level of Personalisation: Deep'));
  assert.ok(strategistPrompt.includes('Emphasise the 85 independent bookshops'));

  const writerPrompt = buildWriterUserPrompt(
    draftFormalDetailed.strategy!,
    authorEntry,
    campaignSettings,
    'Amara Okafor',
    literaryBrief,
    formalDetailedConfig,
  );
  assert.ok(writerPrompt.includes('Call to Action Style: Direct'));

  // Verify all 4 archetypes generate accurate, relevant, incentive-driven drafts with zero em-dashes
  const allFourArchetypes = [
    { label: 'author', entry: authorEntry, cfg: authorDefaults },
    { label: 'sponsor', entry: sponsorEntry, cfg: sponsorDefaults },
    { label: 'literary_org', entry: literaryOrgEntry, cfg: litOrgDefaults },
    { label: 'business_partner', entry: businessPartnerEntry, cfg: partnerDefaults },
  ];

  for (const item of allFourArchetypes) {
    const generated = buildAdaptivePersonalizationEntry({
      projectId: 'proj-lit',
      researchEntry: item.entry,
      brief: literaryBrief,
      settings: campaignSettings,
      leadSettings: item.cfg,
    });
    assert.ok(generated.copy, `${item.label} should have generated copy`);
    assert.equal(generated.lead_settings?.tone, item.cfg.tone, `${item.label} should persist its own lead_settings`);
    assert.ok(
      !generated.copy!.email_body.includes('—') && !generated.copy!.email_body.includes('–'),
      `${item.label} email body must not contain em-dashes or en-dashes`,
    );
    assert.ok(
      (generated.strategy?.recipient_incentive?.length ?? 0) > 15,
      `${item.label} strategy must include a concrete recipient incentive`,
    );
  }
});

// ============================================================================
// SCENARIO 15: Project-Specific Personalised Outreach Templates (Maya Poetry Book Awards)
// ============================================================================
test('Scenario 15: Maya Poetry Book Awards category templates dynamically load, persist edits per project, and guide the Personalization Agent (use, adapt, inspiration, ignore) while preserving genuine personalisation', () => {
  const mayaProjectId = 'test-maya-poetry-awards-templates';
  const otherProjectId = 'test-flowpilot-isolation-templates';

  // Build Maya Poetry Book Awards brief with Authors, Sponsors, and Organisations categories
  const mayaBrief: StructuredBrief = {
    ...makeBrief({
      name: 'Maya Poetry Book Awards',
      description:
        'An international poetry and literary awards programme celebrating independent and published voices while building a long-term author community.',
      primary_objective:
        'Generate 2,000+ quality poetry and book submissions from relevant authors and build recurring community and sponsor partnerships.',
      secondary_objectives: [
        'Increase international awareness of Maya Poetry Book Awards.',
        'Develop recurring partnership and sponsorship opportunities.',
        'Create a long-term author community and referral network.',
      ],
    }),
    targets: [
      {
        id: 'cat-authors',
        target_type: 'Authors',
        entity_kind: 'person',
        description: 'Independent, emerging, and published poets and authors active in literary communities.',
        geography_mode: 'specified',
        geography: ['United Kingdom', 'United States'],
        qualification_criteria: [
          { text: 'Published a poetry collection or literary work.', origin: 'explicit', needs_operational_definition: false },
        ],
        exclusion_criteria: [],
        priority: 'primary',
      },
      {
        id: 'cat-sponsors',
        target_type: 'Sponsors',
        entity_kind: 'organisation',
        description: 'Cultural foundations, publishing patrons, and brands capable of sponsoring the Maya Poetry Book Awards.',
        geography_mode: 'specified',
        geography: ['United Kingdom', 'United States'],
        qualification_criteria: [
          { text: 'History of supporting literary or cultural initiatives.', origin: 'explicit', needs_operational_definition: false },
        ],
        exclusion_criteria: [],
        priority: 'secondary',
      },
      {
        id: 'cat-organisations',
        target_type: 'Organisations',
        entity_kind: 'organisation',
        description: 'Writing groups, poetry societies, literary magazines, and independent publisher networks.',
        geography_mode: 'specified',
        geography: ['United Kingdom', 'United States'],
        qualification_criteria: [
          { text: 'Active membership of poets, authors, or literary readers.', origin: 'explicit', needs_operational_definition: false },
        ],
        exclusion_criteria: [],
        priority: 'secondary',
      },
    ],
  };

  const baseMayaSettings = makeSettings({
    sender_name: 'Hannah Sterling',
    sender_role: 'Awards Director',
    organisation: 'Maya Poetry Book Awards',
    campaign_facts: [
      'Shortlisted poets receive international showcase visibility, anthology publication, and trade distribution support.',
    ],
  });

  // 1. Dynamically load initial pre-built templates for Authors, Sponsors, and Organisations
  const initialTemplates = getProjectCategoryTemplates(mayaBrief, baseMayaSettings);
  assert.equal(initialTemplates.length, 3, 'Should dynamically create templates for all 3 Maya lead categories');
  assert.deepEqual(
    initialTemplates.map((t) => t.target_type),
    ['Authors', 'Sponsors', 'Organisations'],
  );
  for (const tpl of initialTemplates) {
    assert.equal(tpl.is_custom, false, `${tpl.target_type} initial template should be marked pre-built`);
    assert.ok(tpl.subject_line.includes('Maya Poetry Book Awards'), `${tpl.target_type} subject should reference project`);
    assert.ok(tpl.body.length > 120, `${tpl.target_type} body should be a complete editable outreach message`);
    assert.ok(
      tpl.body.includes('[specific detail about their work or organisation]') &&
        tpl.body.includes('[specific collaboration or request]') &&
        tpl.body.includes('[personalised benefit or reason it could be valuable to them]') &&
        tpl.body.includes('£7,000 in prizes, including a £3,000 top prize') &&
        tpl.body.includes('4 January 2027') &&
        tpl.body.includes('https://poetrybookawards.co.uk'),
      `${tpl.target_type} Maya template should include the contextual cues and Maya award details`,
    );
  }

  // Verify dynamic category addition: adding a 4th category ("Universities & Creative Writing Programmes") automatically generates a 4th template
  const expandedBrief: StructuredBrief = {
    ...mayaBrief,
    targets: [
      ...mayaBrief.targets,
      {
        id: 'cat-universities',
        target_type: 'Universities & Creative Writing Programmes',
        entity_kind: 'organisation',
        description: 'MFA programmes and university poetry societies.',
        geography_mode: 'specified',
        geography: ['United Kingdom'],
        qualification_criteria: [],
        exclusion_criteria: [],
        priority: 'secondary',
      },
    ],
  };
  const expandedTemplates = getProjectCategoryTemplates(expandedBrief, baseMayaSettings);
  assert.equal(expandedTemplates.length, 4, 'Adding a new lead category dynamically adds a corresponding template');
  assert.equal(expandedTemplates[3]!.target_type, 'Universities & Creative Writing Programmes');

  // 2. Edit each template (Authors, Sponsors, Organisations), save persistently, and confirm changes persist after reload
  const editedAuthorsTemplate = {
    target_id: 'cat-authors',
    target_type: 'Authors',
    subject_line: 'Maya Poetry Book Awards: Autumn Anthology & Submission Invite',
    body: [
      'Hi there,',
      'I hope your week is going well. We are inviting standout contemporary voices to enter the Maya Poetry Book Awards this season.',
      'Through the Maya Poetry Book Awards, shortlisted collections are featured in our Autumn Poetry Anthology and presented to 60 partner bookshops and festival curators.',
      'Would it be useful if I sent over the one-page submission guide and eligibility dates so you can see if it fits your plans?',
      'Warmly,\nHannah Sterling',
    ].join('\n\n'),
    is_custom: true,
    updated_at: new Date().toISOString(),
  };

  const editedSponsorsTemplate = {
    target_id: 'cat-sponsors',
    target_type: 'Sponsors',
    subject_line: 'Headline Partner & Patronage: Maya Poetry Book Awards',
    body: [
      'Hi there,',
      'I hope your week is going well. Given your commitment to literary arts patronage, I wanted to share our partnership framework for the Maya Poetry Book Awards.',
      'We are uniting 2,000+ poets, independent presses, and literary audiences, offering Headline Partners dedicated category naming rights and year-round brand alignment across our anthology and awards gala.',
      'Would you be open to a brief conversation or reviewing our concise sponsorship deck?',
      'Best regards,\nHannah Sterling',
    ].join('\n\n'),
    is_custom: true,
    updated_at: new Date().toISOString(),
  };

  const editedOrgsTemplate = {
    target_id: 'cat-organisations',
    target_type: 'Organisations',
    subject_line: 'Community Partner Invitation: Maya Poetry Book Awards',
    body: [
      'Hi team,',
      'I hope your week is going well. We admire how you champion emerging poets and wanted to invite your community to partner with the Maya Poetry Book Awards.',
      'Community Partners receive priority showcase slots for their member poets, reciprocal spotlighting in our international newsletter, and a dedicated member entry waiver code.',
      'Could you let me know if I may share our short Community Partner pack, or point me to the best colleague on your team?',
      'Best regards,\nHannah Sterling',
    ].join('\n\n'),
    is_custom: true,
    updated_at: new Date().toISOString(),
  };

  saveFilePersonalizationSettings(mayaProjectId, {
    ...baseMayaSettings,
    category_templates: {
      'cat-authors': editedAuthorsTemplate,
      'cat-sponsors': editedSponsorsTemplate,
      'cat-organisations': editedOrgsTemplate,
    },
  });

  // Reload from persistent storage and verify edits persisted
  const reloadedMayaSettings = getFilePersonalizationSettings(mayaProjectId);
  const reloadedTemplates = getProjectCategoryTemplates(mayaBrief, reloadedMayaSettings);
  assert.equal(reloadedTemplates.length, 3);
  assert.ok(reloadedTemplates.every((t) => t.is_custom === true), 'All 3 edited templates should persist as custom');
  assert.ok(
    reloadedTemplates.find((t) => t.target_id === 'cat-authors')?.body.includes('Autumn Poetry Anthology'),
    'Edited Authors template content must persist after reload',
  );
  assert.ok(
    reloadedTemplates.find((t) => t.target_id === 'cat-sponsors')?.body.includes('Headline Partners dedicated category naming rights'),
    'Edited Sponsors template content must persist after reload',
  );
  assert.ok(
    reloadedTemplates.find((t) => t.target_id === 'cat-organisations')?.body.includes('dedicated member entry waiver code'),
    'Edited Organisations template content must persist after reload',
  );

  // 3. Verify project isolation: another project cannot share or overwrite Maya's templates
  saveFilePersonalizationSettings(otherProjectId, {
    sender_name: 'Owen Patel',
    organisation: 'FlowPilot Automation',
    category_templates: {
      'cat-authors': {
        target_id: 'cat-authors',
        target_type: 'Operations Teams',
        subject_line: 'FlowPilot workflow automation',
        body: 'Hi there,\n\nWe help operations teams automate manual invoice processing.\n\nBest,\nOwen',
        is_custom: true,
        updated_at: new Date().toISOString(),
      },
    },
  });
  const mayaAfterOtherSave = getFilePersonalizationSettings(mayaProjectId);
  const otherReloaded = getFilePersonalizationSettings(otherProjectId);
  assert.ok(
    mayaAfterOtherSave.category_templates?.['cat-authors']?.body.includes('Autumn Poetry Anthology'),
    'Saving templates in another project must never overwrite Maya templates',
  );
  assert.ok(
    otherReloaded.category_templates?.['cat-authors']?.body.includes('automate manual invoice processing'),
    'Second project retains its own independent templates',
  );

  // 4. Generate messages for multiple prospects across Authors, Sponsors, and Organisations
  //    and verify the agent intelligently chooses USE, ADAPT, INSPIRATION, or IGNORE while keeping genuine personalisation!

  // Prospect 1A (Author - 1 primary collection -> USE mode)
  const authorUseProspect = makeResearchEntry({
    record_id: 'maya-author-use',
    brief_target_id: 'cat-authors',
    target_type: 'Authors',
    identity: { name: 'Nadia Al-Mansoor', entity_kind: 'person', identity_verified: true },
    role: 'Poet',
    organisation: null,
    summary: 'London-based poet and author of the 2025 collection "Lanterns on the Thames".',
    work_and_projects: ['Published the 2025 poetry collection "Lanterns on the Thames"'],
    achievements: [],
    reason_for_relevance: 'Published contemporary poet with a 2025 collection eligible for the Maya Poetry Book Awards.',
  });

  // Prospect 1B (Author - multi-work + award -> ADAPT mode)
  const authorAdaptProspect = makeResearchEntry({
    record_id: 'maya-author-adapt',
    brief_target_id: 'cat-authors',
    target_type: 'Authors',
    identity: { name: 'Callum MacLeod', entity_kind: 'person', identity_verified: true },
    role: 'Poet & Pamphlet Editor',
    organisation: 'Clyde Verse Press',
    summary: 'Glasgow poet, author of "Tidewrack" and "granite hymns", winner of the 2025 Northern Verse Bursary.',
    work_and_projects: [
      'Published the 2025 collection "Tidewrack" exploring Scottish maritime history',
      'Co-edited the "Granite Hymns" spoken-word anthology in 2024',
    ],
    achievements: ['Won the 2025 Northern Verse Bursary'],
    reason_for_relevance: 'Award-winning poet with two recent works and an active literary following.',
  });

  // Prospect 1C (Author - research contradiction / closed to standard prize submissions -> IGNORE mode)
  const authorIgnoreProspect = makeResearchEntry({
    record_id: 'maya-author-ignore',
    brief_target_id: 'cat-authors',
    target_type: 'Authors',
    identity: { name: 'Prof. Evelyn Thorne', entity_kind: 'person', identity_verified: true },
    role: 'Poet Laureate & Chair of Judging',
    organisation: 'Oxford Poetics Forum',
    summary: 'Senior poet who paused submissions to competitive book awards while chairing the Oxford Poetics Forum.',
    work_and_projects: ['Edited the 2025 Oxford Lectures on Contemporary Form'],
    achievements: [],
    contradictions: ['Publicly stated she no longer enters competitive book prizes as a contestant, focusing on guest lectures and community mentorship.'],
    reason_for_relevance: 'Influential poetry figure better suited to a bespoke community/referral conversation than a standard entry pitch.',
  });

  // Prospect 2A (Sponsor - 1 core patronage programme -> USE mode)
  const sponsorUseProspect = makeResearchEntry({
    record_id: 'maya-sponsor-use',
    brief_target_id: 'cat-sponsors',
    target_type: 'Sponsors',
    identity: { name: 'Vanguard Literary Foundation', entity_kind: 'organisation', identity_verified: true },
    role: 'Cultural Grants Team',
    organisation: 'Vanguard Literary Foundation',
    summary: 'UK arts foundation funding poetry prizes and independent literary showcases.',
    work_and_projects: ['Funded the 2025 Regional Poetry Translation Grant'],
    achievements: [],
    reason_for_relevance: 'Active philanthropic sponsor of poetry awards and translation initiatives.',
  });

  // Prospect 2B (Sponsor - busy Managing Director with very_short / opportunity_first settings -> INSPIRATION mode)
  const sponsorInspirationProspect = makeResearchEntry({
    record_id: 'maya-sponsor-inspiration',
    brief_target_id: 'cat-sponsors',
    target_type: 'Sponsors',
    identity: { name: 'Sterling & Co. Fine Stationery', entity_kind: 'organisation', identity_verified: true },
    role: 'CEO & Managing Director',
    organisation: 'Sterling & Co. Fine Stationery',
    summary: 'Luxury notebook and pen brand led by CEO Marcus Sterling, sponsoring literary festivals.',
    work_and_projects: ['Partnered with the 2025 Edinburgh Bookbinders Showcase'],
    achievements: ['Named 2025 UK Cultural Patron of the Year'],
    reason_for_relevance: 'High-fit corporate sponsor where the CEO needs a crisp, executive-level pitch.',
  });

  // Prospect 3A (Organisation - 1 core poetry network -> USE mode)
  const orgUseProspect = makeResearchEntry({
    record_id: 'maya-org-use',
    brief_target_id: 'cat-organisations',
    target_type: 'Organisations',
    identity: { name: 'Pennine Poets Collective', entity_kind: 'organisation', identity_verified: true },
    role: 'Community Coordinator',
    organisation: 'Pennine Poets Collective',
    summary: 'Regional poetry society with 350 active poet members across Northern England.',
    work_and_projects: ['Organises the monthly Pennine Stanza Workshop for 350 member poets'],
    achievements: [],
    reason_for_relevance: 'Active poetry community whose members match the Maya Poetry Book Awards.',
  });

  // Prospect 3B (Organisation - multi-programme literary press & magazine -> ADAPT mode)
  const orgAdaptProspect = makeResearchEntry({
    record_id: 'maya-org-adapt',
    brief_target_id: 'cat-organisations',
    target_type: 'Organisations',
    identity: { name: 'Meridian Verse Magazine', entity_kind: 'organisation', identity_verified: true },
    role: 'Editorial & Partnerships Team',
    organisation: 'Meridian Verse Magazine',
    summary: 'Independent poetry journal and small-press network publishing debut pamphlet poets.',
    work_and_projects: [
      'Publishes the quarterly Meridian Verse Debut Pamphlet Series',
      'Hosts the annual London Small Press Poetry Fair',
    ],
    achievements: ['Featured 45 debut poets across its 2025 print issues'],
    reason_for_relevance: 'Leading poetry magazine and event organiser with direct reach to emerging poets.',
  });

  const draftAuthorUse = buildAdaptivePersonalizationEntry({
    projectId: mayaProjectId,
    researchEntry: authorUseProspect,
    brief: mayaBrief,
    settings: reloadedMayaSettings,
  });
  const draftAuthorAdapt = buildAdaptivePersonalizationEntry({
    projectId: mayaProjectId,
    researchEntry: authorAdaptProspect,
    brief: mayaBrief,
    settings: reloadedMayaSettings,
  });
  const draftAuthorIgnore = buildAdaptivePersonalizationEntry({
    projectId: mayaProjectId,
    researchEntry: authorIgnoreProspect,
    brief: mayaBrief,
    settings: reloadedMayaSettings,
  });
  const draftSponsorUse = buildAdaptivePersonalizationEntry({
    projectId: mayaProjectId,
    researchEntry: sponsorUseProspect,
    brief: mayaBrief,
    settings: reloadedMayaSettings,
  });
  const draftSponsorInspiration = buildAdaptivePersonalizationEntry({
    projectId: mayaProjectId,
    researchEntry: sponsorInspirationProspect,
    brief: mayaBrief,
    settings: reloadedMayaSettings,
    leadSettings: defaultLeadPersonalizationSettings(sponsorInspirationProspect.record),
  });
  const draftOrgUse = buildAdaptivePersonalizationEntry({
    projectId: mayaProjectId,
    researchEntry: orgUseProspect,
    brief: mayaBrief,
    settings: reloadedMayaSettings,
  });
  const draftOrgAdapt = buildAdaptivePersonalizationEntry({
    projectId: mayaProjectId,
    researchEntry: orgAdaptProspect,
    brief: mayaBrief,
    settings: reloadedMayaSettings,
  });

  // Verify intelligent template mode decisions across the prospects
  assert.equal(draftAuthorUse.strategy?.template_usage_mode, 'use', 'Standard single-work author should USE the Authors template');
  assert.equal(draftAuthorAdapt.strategy?.template_usage_mode, 'adapt', 'Multi-work award-winning author should ADAPT the Authors template');
  assert.equal(draftAuthorIgnore.strategy?.template_usage_mode, 'ignore', 'Author with contradiction against prize submissions should IGNORE the standard template');
  assert.equal(draftSponsorUse.strategy?.template_usage_mode, 'use', 'Standard cultural foundation sponsor should USE the Sponsors template');
  assert.equal(draftSponsorInspiration.strategy?.template_usage_mode, 'inspiration', 'CEO sponsor with very_short executive settings should use the template as INSPIRATION');
  assert.equal(draftOrgUse.strategy?.template_usage_mode, 'use', 'Single-programme poetry society should USE the Organisations template');
  assert.equal(draftOrgAdapt.strategy?.template_usage_mode, 'adapt', 'Multi-programme poetry magazine should ADAPT the Organisations template');

  // Verify edited template phrases appear in USE/ADAPT drafts, while genuine prospect personalisation is preserved
  assert.ok(
    draftAuthorUse.copy!.email_body.includes('Autumn Poetry Anthology') &&
      draftAuthorUse.copy!.email_body.includes('Lanterns on the Thames'),
    'Author USE draft must reflect edited Authors template AND Nadia\'s verified book "Lanterns on the Thames"',
  );
  assert.ok(
    draftAuthorAdapt.copy!.email_body.includes('Autumn Poetry Anthology') &&
      draftAuthorAdapt.copy!.email_body.includes('Tidewrack') &&
      draftAuthorAdapt.copy!.email_body.includes('Northern Verse Bursary'),
    'Author ADAPT draft must reuse edited template positioning while structuring around Callum\'s works and bursary',
  );
  assert.ok(
    !draftAuthorIgnore.copy!.email_body.includes('Autumn Poetry Anthology') &&
      draftAuthorIgnore.copy!.email_body.includes('Oxford Lectures on Contemporary Form'),
    'Author IGNORE draft must NOT use the standard submission template phrasing and must instead write an original message around her Oxford work',
  );
  assert.ok(
    draftSponsorUse.copy!.email_body.includes('Headline Partners dedicated category naming rights') &&
      draftSponsorUse.copy!.email_body.includes('Regional Poetry Translation Grant'),
    'Sponsor USE draft must reflect edited Sponsors template AND Vanguard\'s Regional Poetry Translation Grant',
  );
  assert.ok(
    draftOrgUse.copy!.email_body.includes('dedicated member entry waiver code') &&
      draftOrgUse.copy!.email_body.includes('Pennine Stanza Workshop'),
    'Organisation USE draft must reflect edited Organisations template AND Pennine Stanza Workshop',
  );
  assert.ok(
    draftOrgAdapt.copy!.email_body.includes('dedicated member entry waiver code') &&
      draftOrgAdapt.copy!.email_body.includes('Meridian Verse Debut Pamphlet Series'),
    'Organisation ADAPT draft must adapt edited Organisations template AND reference Meridian Verse Debut Pamphlet Series',
  );

  // 5. Verify that further editing a template updates future generations without overwriting existing prospect messages
  const previousNadiaEmail = draftAuthorUse.copy!.email_body;
  saveFilePersonalizationSettings(mayaProjectId, {
    ...reloadedMayaSettings,
    category_templates: {
      ...reloadedMayaSettings.category_templates,
      'cat-authors': {
        ...editedAuthorsTemplate,
        body: [
          'Hi there,',
          'I hope your week is going well.',
          'Through the Maya Poetry Book Awards, finalists are invited to our live London Southbank Poetry Gala and receive international press representation.',
          'Would you like me to send the short submission overview?',
          'Warmly,\nHannah Sterling',
        ].join('\n\n'),
        updated_at: new Date().toISOString(),
      },
    },
  });

  const updatedMayaSettings = getFilePersonalizationSettings(mayaProjectId);
  const futureAuthorDraft = buildAdaptivePersonalizationEntry({
    projectId: mayaProjectId,
    researchEntry: authorUseProspect,
    brief: mayaBrief,
    settings: updatedMayaSettings,
  });

  assert.ok(
    futureAuthorDraft.copy!.email_body.includes('London Southbank Poetry Gala'),
    'Future message generations must reflect the newly edited template',
  );
  assert.ok(
    previousNadiaEmail.includes('Autumn Poetry Anthology') &&
      !previousNadiaEmail.includes('London Southbank Poetry Gala'),
    'Previously generated prospect draft remains untouched unless regenerated',
  );

  // 6. Verify fallback when no template exists for a category
  const unmappedProspect = makeResearchEntry({
    record_id: 'maya-unmapped',
    brief_target_id: 'non-existent-target',
    target_type: ' Literary Podcast Hosts ',
    identity: { name: ' Clara Bell ', entity_kind: 'person', identity_verified: true },
    role: 'Host',
    organisation: 'Verse & Voice Podcast',
    work_and_projects: ['Hosts the weekly Verse & Voice Poetry Interview Podcast'],
  });
  const emptyTemplateBrief: StructuredBrief = { ...mayaBrief, targets: [] as any };
  const resolvedNone = resolveCategoryTemplateForProspect(unmappedProspect.record, emptyTemplateBrief, baseMayaSettings);
  assert.equal(resolvedNone, null, 'Should return null when no category template exists');
  const unmappedDraft = buildAdaptivePersonalizationEntry({
    projectId: mayaProjectId,
    researchEntry: unmappedProspect,
    brief: emptyTemplateBrief,
    settings: baseMayaSettings,
  });
  assert.ok(
    unmappedDraft.copy!.email_body.includes('Verse & Voice Poetry Interview Podcast'),
    'When no template exists for a category, the agent still generates a personalised message from the brief and research',
  );

  // 7. Verify contextual cue understanding for both bracketed [...] and parenthetical (...) templates
  //    (e.g. [personalised benefit or reason it could be valuable to them] and (personalised benefit or reason it could be valuable to them))
  const defaultMayaAuthorDraft = buildAdaptivePersonalizationEntry({
    projectId: mayaProjectId,
    researchEntry: authorUseProspect,
    brief: mayaBrief,
    settings: baseMayaSettings,
  });
  assert.ok(
    !defaultMayaAuthorDraft.copy!.email_body.includes('[Name]') &&
      !defaultMayaAuthorDraft.copy!.email_body.includes('[specific detail') &&
      !defaultMayaAuthorDraft.copy!.email_body.includes('[specific collaboration') &&
      !defaultMayaAuthorDraft.copy!.email_body.includes('[personalised benefit'),
    'All bracketed contextual cues [...] in the Maya template must be resolved in context',
  );
  assert.ok(
    defaultMayaAuthorDraft.copy!.email_body.includes('Lanterns on the Thames') &&
      defaultMayaAuthorDraft.copy!.email_body.includes('£7,000 in prizes') &&
      defaultMayaAuthorDraft.copy!.email_body.includes('4 January 2027') &&
      defaultMayaAuthorDraft.copy!.email_body.includes('https://poetrybookawards.co.uk') &&
      defaultMayaAuthorDraft.copy!.email_body.includes('Hannah Sterling'),
    'Resolved Maya draft must weave in the verified book, contextual benefit, competition dates, URL, and sender name',
  );
  assert.equal(
    defaultMayaAuthorDraft.qa?.status,
    'passed',
    `Resolved Maya template draft must pass QA cleanly (issues: ${JSON.stringify(defaultMayaAuthorDraft.qa?.issues ?? [])})`,
  );

  // Also test parenthetical cues (...) inside a custom template alongside factual parentheses like (including a £3,000 top prize)
  const parentheticalMayaSettings = makeSettings({
    ...baseMayaSettings,
    category_templates: {
      'cat-sponsors': {
        target_id: 'cat-sponsors',
        target_type: 'Sponsors',
        subject_line: 'Maya Poetry Book Awards — Partnership with (Name)',
        body: [
          'Hi (Name),',
          'I came across (specific detail about their work or organisation) and thought there could be an interesting connection with the Maya Poetry Book Awards.',
          'Maya is an international poetry book competition for indie writers, self-published poets and books from small, truly independent presses. With £7,000 in prizes (including a £3,000 top prize), it offers authors an opportunity for recognition and greater visibility.',
          "We're reaching out to explore (specific collaboration or request) because (personalised benefit or reason it could be valuable to them).",
          'Next year’s competition opens on 4 January 2027. You can find out more at https://poetrybookawards.co.uk.',
          "Would you be open to exploring this further? We'd be happy to share more details.",
          'Best,\n\n(Name)\n\nMaya Poetry Book Awards',
        ].join('\n\n'),
        is_custom: true,
        updated_at: new Date().toISOString(),
      },
    },
  });

  const parenSponsorDraft = buildAdaptivePersonalizationEntry({
    projectId: mayaProjectId,
    researchEntry: sponsorUseProspect,
    brief: mayaBrief,
    settings: parentheticalMayaSettings,
  });
  assert.ok(
    !parenSponsorDraft.copy!.email_body.includes('(specific detail') &&
      !parenSponsorDraft.copy!.email_body.includes('(specific collaboration') &&
      !parenSponsorDraft.copy!.email_body.includes('(personalised benefit') &&
      !parenSponsorDraft.copy!.email_body.includes('(Name)'),
    'All instructional parenthetical cues (...) must be understood and resolved in context',
  );
  assert.ok(
    parenSponsorDraft.copy!.email_body.includes('(including a £3,000 top prize)'),
    'Normal factual parentheses like "(including a £3,000 top prize)" must remain intact',
  );
  assert.ok(
    parenSponsorDraft.copy!.email_body.includes('Regional Poetry Translation Grant') &&
      parenSponsorDraft.copy!.email_body.includes('sponsorship or patronage partnership with Vanguard Literary Foundation') &&
      parenSponsorDraft.copy!.email_body.includes('prominent brand alignment'),
    'Parenthetical cues must resolve to the sponsor\'s verified grant work, sponsorship request, and tailored sponsor benefit',
  );

  // Clean up test settings files
  deleteProjectPersonalizations(mayaProjectId);
  deleteProjectPersonalizations(otherProjectId);
});

// ============================================================================
// SCENARIO 16: Reviewer Feedback Memory & Rewrite from Feedback
// ============================================================================
test('Scenario 16: Post-personalization feedback is saved for future references (project, category, lead scopes) and immediately rewrites drafts based on feedback', () => {
  const feedbackProjectId = 'test-feedback-memory-project';
  const brief = makeBrief({
    name: 'Maya Poetry Book Awards',
    description: 'International poetry book competition for indie writers and small independent presses.',
    primary_objective: 'Invite authors to enter the 2027 Maya Poetry Book Awards.',
    targetType: 'Authors',
  });

  const leadEllen = makeResearchEntry({
    record_id: 'lead-ellen',
    brief_target_id: 'target-1',
    target_type: 'Authors',
    identity: { name: 'Ellen Montrose', entity_kind: 'person', identity_verified: true },
    role: 'Poet & Creative Writing Lecturer',
    organisation: 'Hofstra University',
    work_and_projects: ['Published the poetry collection "The Rooftop Party"'],
  });

  const leadSecondAuthor = makeResearchEntry({
    record_id: 'lead-second-author',
    brief_target_id: 'target-1',
    target_type: 'Authors',
    identity: { name: 'Julian Vance', entity_kind: 'person', identity_verified: true },
    role: 'Indie Poet',
    organisation: null,
    work_and_projects: ['Published the 2025 collection "Harbour Echoes"'],
  });

  const initialSettings = makeSettings({
    sender_name: 'Maya Editorial Team',
    organisation: 'Maya Poetry Book Awards',
  });

  // 1. Initial personalization for Ellen follows the Maya template directly
  const initialDraft = buildAdaptivePersonalizationEntry({
    projectId: feedbackProjectId,
    researchEntry: leadEllen,
    brief,
    settings: initialSettings,
  });
  assert.ok(
    initialDraft.copy!.email_body.includes('I came across') &&
      initialDraft.copy!.email_body.includes('The Rooftop Party') &&
      initialDraft.copy!.email_body.includes('greater visibility'),
    'Initial draft follows the Maya template and resolves the contextual cues',
  );

  // 2. Reviewer gives feedback on Ellen's draft and clicks "Save & rewrite":
  //    "Replace 'greater visibility' with 'international reader discovery' and don't mention 'small, truly independent presses'"
  const feedbackItem = createFeedbackItem({
    text: 'Replace "greater visibility" with "international reader discovery" and don\'t mention "small, truly independent presses"',
    scope: 'project',
    record: leadEllen.record,
  });
  const savedSettings = saveFilePersonalizationSettings(feedbackProjectId, {
    ...initialSettings,
    feedback_memory: appendFeedback(initialSettings.feedback_memory, feedbackItem),
  });

  const rewrittenEllenDraft = buildAdaptivePersonalizationEntry({
    projectId: feedbackProjectId,
    researchEntry: leadEllen,
    brief,
    settings: savedSettings,
    existing: initialDraft,
    rewriteFeedback: feedbackItem.text,
  });

  assert.ok(
    !rewrittenEllenDraft.copy!.email_body.includes('small, truly independent presses'),
    'Rewritten draft immediately removes the unwanted sentence based on feedback',
  );
  assert.ok(
    rewrittenEllenDraft.copy!.email_body.includes('international reader discovery') &&
      !rewrittenEllenDraft.copy!.email_body.includes('greater visibility'),
    'Rewritten draft applies the requested phrase replacement from feedback',
  );

  // 3. Future personalization for a completely different prospect (Julian Vance) automatically remembers and applies the learned feedback!
  const reloadedSettings = getFilePersonalizationSettings(feedbackProjectId);
  const relevantForJulian = getRelevantFeedback(reloadedSettings, leadSecondAuthor.record);
  assert.equal(relevantForJulian.length, 1, 'Project-scoped feedback must be retrieved for future prospects');

  const futureJulianDraft = buildAdaptivePersonalizationEntry({
    projectId: feedbackProjectId,
    researchEntry: leadSecondAuthor,
    brief,
    settings: reloadedSettings,
  });
  assert.ok(
    !futureJulianDraft.copy!.email_body.includes('small, truly independent presses') &&
      futureJulianDraft.copy!.email_body.includes('international reader discovery') &&
      futureJulianDraft.copy!.email_body.includes('Harbour Echoes'),
    'Future prospect draft automatically learns and applies the saved reviewer feedback',
  );

  // 4. Verify Strategist and Writer LLM prompts include both LEARNED REVIEWER PREFERENCES and REWRITE REQUEST blocks
  const strategyPrompt = buildStrategistUserPrompt(
    brief,
    leadSecondAuthor,
    reloadedSettings,
    '',
    undefined,
    'Make the tone more formal and concise',
  );
  assert.ok(
    strategyPrompt.includes('=== LEARNED REVIEWER PREFERENCES') &&
      strategyPrompt.includes('=== REWRITE REQUEST'),
    'Strategist prompt must include learned reviewer preferences and active rewrite instructions',
  );

  const writerPrompt = buildWriterUserPrompt(
    rewrittenEllenDraft.strategy!,
    leadEllen,
    reloadedSettings,
    'Ellen Montrose',
    brief,
    undefined,
    'Keep it under 90 words and highlight the £3,000 top prize',
    initialDraft.copy,
  );
  assert.ok(
    writerPrompt.includes('=== LEARNED REVIEWER PREFERENCES') &&
      writerPrompt.includes('=== REWRITE REQUEST') &&
      writerPrompt.includes('Keep it under 90 words and highlight the £3,000 top prize'),
    'Writer prompt must include learned reviewer preferences, the rewrite instruction, and the previous draft context',
  );

  deleteProjectPersonalizations(feedbackProjectId);
});


