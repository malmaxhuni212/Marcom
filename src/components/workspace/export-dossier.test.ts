import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProspectMarkdownDossier } from './export-dossier';
import type { ResearchEntry } from '@/marcom/schemas/research-record';
import type { PersonalizationEntry } from '@/marcom/schemas/personalization';

function mockResearchEntry(): ResearchEntry {
  return {
    record: {
      research_record_version: '1.1',
      record_id: 'rec-test-1',
      project_id: 'proj-1',
      brief_target_id: 'target-1',
      identity: {
        name: 'Dr Kerry Ryan',
        entity_kind: 'person',
        identity_verified: true,
      },
      target_type: 'Authors & Writers',
      role: 'Poet & Workshop Facilitator',
      organisation: 'Folkestone Lit Lab',
      country: 'United Kingdom',
      location: 'Folkestone, England',
      websites: [
        { url: 'https://kerryryan.co.uk', type: 'author', title: 'Kerry Ryan Official' },
      ],
      social_profiles: [
        {
          platform: 'instagram',
          profile_url: 'https://instagram.com/kerrypoet',
          username: 'kerrypoet',
          display_name: 'Kerry Ryan',
          verified_status: true,
          confidence: 'verified',
          source_ids: ['S2'],
        },
        {
          platform: 'x',
          profile_url: 'https://x.com/kerryryan',
          username: 'kerryryan',
          display_name: 'Kerry Ryan',
          verified_status: false,
          confidence: 'verified',
          source_ids: ['S3'],
        },
      ],
      public_contact: [
        {
          kind: 'email',
          value: 'kerry@example.com',
          is_professional: true,
          source_ids: ['S1'],
          confidence: 'verified',
        },
      ],
      key_contacts: [],
      background: ['MA in Creative Writing', 'Resident poet at Folkestone Harbour'],
      work_and_projects: ['Published The Good Other in 2024'],
      achievements: ['Shortlisted for Forward Prize'],
      industry_activity: ['Regular workshop host across Kent'],
      qualification_assessment: [
        {
          criterion: 'Published UK Poet',
          status: 'met',
          note: 'Has 2 published collections with UK presses',
          source_ids: ['S1', 'S2'],
        },
      ],
      reason_for_relevance: 'Actively publishing UK poet fitting the literary award criteria',
      fit: {
        score: 88,
        band: 'strong',
        rationale: 'Demonstrated publication track record matching award category guidelines',
      },
      summary: 'Prominent British poet and community writing facilitator based in Kent.',
      evidence: [
        {
          claim: 'Dr Kerry Ryan published The Good Other',
          field: 'work_and_projects',
          source_ids: ['S1'],
          quote: 'Kerry Ryan published her second collection The Good Other with Blueprint Press',
          confidence: 'verified',
        },
      ],
      sources: [
        {
          id: 'S1',
          url: 'https://kerryryan.co.uk/about',
          title: 'About Dr Kerry Ryan',
          source_type: 'author_website',
          retrieved_at: '2026-10-29T12:00:00Z',
        },
        {
          id: 'S2',
          url: 'https://instagram.com/kerrypoet',
          title: 'Kerry Ryan Instagram',
          source_type: 'social',
          retrieved_at: '2026-10-29T12:01:00Z',
        },
      ],
      unknowns: [
        {
          field: 'agent_representation',
          reason: 'No literary agency listed on official site',
        },
      ],
      contradictions: ['One profile lists residence as London instead of Folkestone'],
      research_confidence: 'high',
      matched_prospect_id: null,
      researched_at: '2026-10-29T12:00:00Z',
      research_agent_version: '1.2.0',
    },
    seed: {
      name: 'Dr Kerry Ryan',
      website: 'https://kerryryan.co.uk',
    },
    qa: { status: 'passed', issues: [] },
    relationship_status: 'contacted',
    model: 'openai/gpt-oss-20b',
    ai_provider: 'groq',
    searches: ['Kerry Ryan poet Folkestone'],
    search_provider: 'exa',
    search_request_ids: ['req-123'],
    search_usage: { requests: 1, estimated_cost_usd: 0.002, latency_ms: 450 },
    search_warnings: [],
    review: {
      project_id: 'proj-1',
      record_id: 'rec-test-1',
      status: 'shortlisted',
      note: 'Ideal fit for the poetry category outreach',
      reviewed_at: '2026-10-29T14:00:00Z',
      reviewed_by: 'reviewer@marcom.test',
    },
  };
}

function mockPersonalization(): PersonalizationEntry {
  return {
    personalization_version: '1.0',
    record_id: 'rec-test-1',
    project_id: 'proj-1',
    prospect_name: 'Dr Kerry Ryan',
    target_type: 'Authors & Writers',
    batch_id: null,
    batch_number: null,
    status: 'approved',
    strategy: {
      readiness: 'ready',
      readiness_reason: 'Verified contact and high relevance',
      prospect_snapshot: 'British poet based in Kent',
      recipient_priorities: 'Publishing quality poetry',
      relevance_thesis: 'Matches category criteria',
      campaign_objective: 'Submissions',
      outreach_goal: 'Invitation to submit',
      recipient_incentive: 'Recognition and award prize',
      hook: {
        fact: 'Published The Good Other',
        source_id: 'S1',
        category: 'work',
        angle: 'Highlight shared themes in The Good Other',
      },
      backup_hook: null,
      primary_contact: {
        channel: 'email',
        value: 'kerry@example.com',
        deliverability_status: 'deliverable',
        verification_status: 'verified',
        confidence: 'high',
        source_id: 'S1',
        target_display: 'kerry@example.com',
        channel_reason: 'Direct verified email ensures deliverability',
      },
      angle: 'Highlight shared themes in The Good Other',
      channel_reason: 'Direct verified email ensures deliverability',
      avoid: ['Do not use generic congratulatory flattery'],
      human_checks: ['Verify recipient is accepting anthology submissions'],
    } as any,
    copy: {
      subject_lines: [
        { text: 'Maya Poetry Book Awards — Note on The Good Other', style: 'value' },
        { text: 'Submission invitation for Dr Kerry Ryan', style: 'direct' },
      ],
      email_body: 'Dear Dr. Ryan,\n\nI admired your work on The Good Other...',
      alternative_opening: null,
      linkedin_message: 'Hi Kerry, following your poetry publications in Kent...',
      follow_up_body: 'Hi Kerry, just following up on our invitation...',
      hook_usage: 'Used The Good Other in opening line',
    },
    ai_copy: null,
    edited_by_human: false,
    qa: null,
    auto_revisions: 0,
    models: { strategist: 'test', writer: 'test' },
    timings_ms: { strategist: 100, writer: 100 },
    generated_at: '2026-10-29T14:30:00Z',
    updated_at: '2026-10-29T14:30:00Z',
    reviewed_at: null,
    reviewer_note: null,
    error: null,
  };
}

test('buildProspectMarkdownDossier formats all intelligence fields cleanly', () => {
  const entry = mockResearchEntry();
  const draft = mockPersonalization();
  const md = buildProspectMarkdownDossier({ entry, draft, projectName: 'Maya Poetry Awards' });

  // Header & project
  assert.match(md, /# Prospect Intelligence Dossier: Dr Kerry Ryan/);
  assert.match(md, /Maya Poetry Awards/);
  assert.match(md, /Authors & Writers/);

  // Executive summary & qualification
  assert.match(md, /## 1\. Executive Summary/);
  assert.match(md, /Qualification Rating:\*\* Strong Fit/);
  assert.match(md, /Fit Rationale:\*\* Demonstrated publication track record/);
  assert.doesNotMatch(md, /88\/100/);
  assert.match(md, /Folkestone, England, United Kingdom/);

  // Contacts
  assert.match(md, /## 2\. Verified Contact Routes/);
  assert.match(md, /kerry@example\.com/);
  assert.match(md, /https:\/\/instagram\.com\/kerrypoet/);

  // Background
  assert.match(md, /## 3\. Professional Background & Track Record/);
  assert.match(md, /Shortlisted for Forward Prize/);

  // Criteria
  assert.match(md, /## 4\. Qualification Criteria Assessment/);
  assert.match(md, /Published UK Poet/);
  assert.match(md, /Identified Gaps & Unknowns/);
  assert.match(md, /Flagged Contradictions/);

  // Evidence
  assert.match(md, /## 5\. Source Citations & Evidence Trail/);
  assert.match(md, /Kerry Ryan published her second collection/);
  assert.match(md, /https:\/\/kerryryan\.co\.uk\/about/);

  // Outreach draft
  assert.match(md, /## 6\. Outreach Strategy & Personalized Drafts/);
  assert.match(md, /Dear Dr\. Ryan/);
  assert.match(md, /Hi Kerry, following your poetry publications/);

  // Review status
  assert.match(md, /## 7\. Internal Review & Notes/);
  assert.match(md, /Ideal fit for the poetry category outreach/);
});

test('buildProspectMarkdownDossier formats organisation with key contacts', () => {
  const entry = mockResearchEntry();
  entry.record.identity.entity_kind = 'organisation';
  entry.record.identity.name = 'Folkestone Literature Trust';
  entry.record.key_contacts = [
    {
      name: 'Sarah Jenkins',
      role: 'Creative Director',
      department: 'Partnerships',
      email: 'sarah@folkestonelit.org',
      linkedin_url: 'https://linkedin.com/in/sarah-jenkins',
      phone: null,
      relevance: 'Leads external project submissions and partner programmes',
      source_ids: ['S1'],
      confidence: 'verified',
    },
  ];

  const md = buildProspectMarkdownDossier({ entry });

  assert.match(md, /# Prospect Intelligence Dossier: Folkestone Literature Trust/);
  assert.match(md, /Organisation Key Contacts & Routes/);
  assert.match(md, /Sarah Jenkins/);
  assert.match(md, /Creative Director · Partnerships/);
  assert.match(md, /sarah@folkestonelit\.org/);
  assert.match(md, /Leads external project submissions/);
});
