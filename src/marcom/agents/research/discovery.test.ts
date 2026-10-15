import assert from 'node:assert/strict';
import test from 'node:test';
import type { LLMProvider } from '../../llm/provider';
import type { SearchProvider } from '../../search/provider';
import type { StructuredBrief } from '../../schemas/structured-brief';
import { discoverProspectSeeds } from './discovery';

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
