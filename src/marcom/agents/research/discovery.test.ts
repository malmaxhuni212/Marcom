import assert from 'node:assert/strict';
import test from 'node:test';
import type { LLMProvider } from '../../llm/provider';
import type { SearchProvider } from '../../search/provider';
import type { StructuredBrief } from '../../schemas/structured-brief';
import { buildDiscoveryQuery, discoverProspectSeeds } from './discovery';
import { buildContactQueries, isOrganisationProspect } from './agent';
import { normalizeAndQA } from './qa';

const brief: StructuredBrief = {
  structured_brief_version: '1.0',
  project: {
    name: 'Generic creative campaign',
    description: 'Find suitable contributors for a creative project.',
    primary_objective: 'Build a relevant prospect list.',
    secondary_objectives: [],
    success_metrics: ['One evidence-backed prospect'],
  },
  targets: [
    {
      id: 'target-a',
      target_type: 'writers',
      entity_kind: 'person',
      description: 'Writers with a public portfolio.',
      geography_mode: 'specified',
      geography: ['United Kingdom'],
      qualification_criteria: [],
      exclusion_criteria: [],
      priority: 'primary',
    },
  ],
  research: {
    required_fields: ['name'],
    preferred_source_types: ['portfolio'],
    evidence_requirements: ['Public source URL'],
    verification_requirements: ['Name must be present in the source'],
    unknown_handling: 'Preserve unknown values.',
  },
  personalization: {
    allowed: [],
    preferred_details: [],
    tone: [],
    avoid: [],
  },
  outreach: {
    objectives: ['Invite suitable contributors'],
    channels: ['email'],
    tone: ['professional'],
    approval_required: true,
  },
  database: {
    fields: [
      {
        name: 'name',
        required: true,
        purpose: 'Identify the prospect',
        expected_source: 'research',
      },
    ],
  },
  human_review: {
    requirements: ['Review the evidence'],
    approval_points: ['Before outreach'],
  },
  constraints: [],
  conflicts: [],
  approximations: [],
  unknowns_requiring_confirmation: [],
};

const searchProvider: SearchProvider = {
  key: 'test-search',
  capabilities: () => ({
    maximumResults: 10,
    supportsDomainFilters: true,
    supportsCategory: true,
  }),
  async search(request) {
    return {
      providerKey: 'test-search',
      providerRequestId: 'search-request-1',
      query: request.query,
      candidates: [
        {
          providerResultId: 'result-1',
          url: 'https://example.com/alex-writer',
          title: 'Alex Writer',
          author: null,
          publishedAt: null,
          text: 'Alex Writer is a UK writer with a public creative portfolio.',
          highlights: [],
          score: 0.9,
        },
      ],
      latencyMs: 1,
      usage: { requests: 1, estimatedCostUsd: 0 },
      warnings: [],
    };
  },
};

const llmProvider: LLMProvider = {
  name: 'test-llm',
  async complete() {
    return JSON.stringify({
      candidates: [
        {
          name: 'Alex Writer',
          organisation: null,
          website: 'https://example.com/alex-writer',
          source_url: 'https://example.com/alex-writer',
          entity_kind: 'person',
        },
      ],
    });
  },
};

test('discovery completes without depending on a developer-specific filesystem path', async () => {
  const target = brief.targets[0];
  assert.ok(target);

  const result = await discoverProspectSeeds({
    brief,
    target,
    desiredCount: 1,
    searchProvider,
    llmProvider,
  });

  assert.equal(result.seeds.length, 1);
  assert.equal(result.seeds[0]?.name, 'Alex Writer');
});

test('buildDiscoveryQuery diversifies search queries across iterations', () => {
  const target = brief.targets[0];
  assert.ok(target);

  const iter0 = buildDiscoveryQuery({ brief, target, iteration: 0 });
  const iter1 = buildDiscoveryQuery({ brief, target, iteration: 1 });
  const iter2 = buildDiscoveryQuery({ brief, target, iteration: 2 });
  const iter4 = buildDiscoveryQuery({ brief, target, iteration: 4 });

  // Iteration 0 uses direct target & geography
  assert.ok(iter0.query.includes('writers'));
  assert.equal(iter0.category, 'people');

  // Iteration 1 switches to directory/roster search and relaxes category
  assert.ok(iter1.query.includes('directory roster'));
  assert.equal(iter1.category, undefined);

  // Queries across iterations are distinct to avoid duplicate web results
  assert.notEqual(iter0.query, iter1.query);
  assert.notEqual(iter1.query, iter2.query);
  assert.notEqual(iter0.query, iter4.query);
});

test('organisation contact discovery builds team and LinkedIn people queries', () => {
  const orgTarget = {
    ...brief.targets[0]!,
    entity_kind: 'organisation' as const,
    target_type: 'universities',
  };
  assert.equal(isOrganisationProspect({ name: 'Bristol University', entity_kind: 'organisation' }, orgTarget), true);
  assert.equal(isOrganisationProspect({ name: 'Alex Writer', entity_kind: 'person' }, orgTarget), false);

  const queries = buildContactQueries(
    { name: 'Bristol University', entity_kind: 'organisation' },
    ['partnerships manager', 'industry liaison', 'head of film'],
  );
  assert.ok(queries.team.includes('Bristol University'));
  assert.ok(queries.team.includes('partnerships manager'));
  assert.ok(queries.people.includes('at Bristol University'));
});

test('normalizeAndQA keeps verified key contacts and strips unverified ones for organisations', () => {
  const toolText = [
    'SOURCE ID: S1',
    'URL: https://bristol-arts.ac.uk/about/team',
    'TITLE: Bristol Arts University Team',
    'CONTENT: Bristol Arts University media department. Dr Sarah Jenkins is Head of Industry Partnerships (s.jenkins@bristol-arts.ac.uk). Connect on https://www.linkedin.com/in/sarah-jenkins-bristol',
  ].join('\n');

  const { record, qa } = normalizeAndQA(
    {
      name: 'Bristol Arts University',
      entity_kind: 'organisation',
      identity_verified: true,
      websites: [{ url: 'https://bristol-arts.ac.uk/about/team', type: 'company', title: 'Bristol Arts University' }],
      social_profiles: [],
      public_contact: [],
      key_contacts: [
        {
          name: 'Dr Sarah Jenkins',
          role: 'Head of Industry Partnerships',
          department: 'Media Department',
          email: 's.jenkins@bristol-arts.ac.uk',
          linkedin_url: 'https://www.linkedin.com/in/sarah-jenkins-bristol',
          phone: null,
          relevance: 'Leads external industry partnerships for the media faculty.',
          source_ids: ['S1'],
          confidence: 'verified',
        },
        {
          name: 'Invented Person',
          role: 'Director',
          department: null,
          email: 'fake@bristol-arts.ac.uk',
          linkedin_url: null,
          phone: null,
          relevance: 'Hallucinated contact',
          source_ids: ['S1'],
          confidence: 'verified',
        },
      ],
      evidence: [
        {
          claim: 'Dr Sarah Jenkins is Head of Industry Partnerships at Bristol Arts University.',
          field: 'contacts',
          sources: ['S1'],
          confidence: 'verified',
          quote: 'Dr Sarah Jenkins is Head of Industry Partnerships (s.jenkins@bristol-arts.ac.uk).',
        },
      ],
      sources: [
        {
          id: 'S1',
          url: 'https://bristol-arts.ac.uk/about/team',
          title: 'Bristol Arts University Team',
          type: 'official website',
        },
      ],
      fit_score: 85,
      fit_rationale: 'Strong fit with verified partnership lead.',
      summary: 'Bristol Arts University has a dedicated industry partnerships lead.',
      confidence: 'high',
    },
    {
      projectId: 'proj-1',
      targetId: 'target-a',
      targetType: 'universities',
      seed: { name: 'Bristol Arts University', entity_kind: 'organisation' },
      seen: [
        { url: 'https://bristol-arts.ac.uk/about/team', title: 'Bristol Arts University Team', via: 'page' },
        { url: 'https://www.linkedin.com/in/sarah-jenkins-bristol', title: 'Sarah Jenkins LinkedIn', via: 'search' },
      ],
      pages: [{ url: 'https://bristol-arts.ac.uk/about/team', text: toolText }],
      toolText,
      matchedProspectId: null,
      relationshipStatus: null,
    },
  );

  assert.equal(record.key_contacts?.length, 1);
  assert.equal(record.key_contacts?.[0]?.name, 'Dr Sarah Jenkins');
  assert.equal(record.key_contacts?.[0]?.email, 's.jenkins@bristol-arts.ac.uk');
  assert.equal(record.key_contacts?.[0]?.linkedin_url, 'https://www.linkedin.com/in/sarah-jenkins-bristol');
  // Since a verified key contact has email & LinkedIn, 'contact' should not be flagged as unknown
  assert.equal(record.unknowns.some((u) => u.field === 'contact'), false);
  // And the invented person triggered an unverified_key_contact warning
  assert.equal(qa.issues.some((i) => i.code === 'unverified_key_contact'), true);
});
