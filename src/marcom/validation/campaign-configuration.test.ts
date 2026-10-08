import assert from 'node:assert/strict';
import test from 'node:test';
import type { StructuredBrief } from '../schemas/structured-brief';
import { validateResearchReadyConfiguration } from './campaign-configuration';

function validBrief(): StructuredBrief {
  return {
    structured_brief_version: '1.0',
    project: {
      name: 'Independent film outreach',
      description: 'Find potential collaborators for a new film project.',
      primary_objective: 'Build a qualified collaborator shortlist.',
      secondary_objectives: [],
      success_metrics: [],
    },
    targets: [{
      id: 'target-a',
      target_type: 'Independent film producers',
      entity_kind: 'person',
      description: 'Producers with recent independent film experience.',
      geography_mode: 'specified',
      geography: ['United Kingdom'],
      qualification_criteria: [],
      exclusion_criteria: [],
      priority: 'primary',
    }],
    research: {
      required_fields: ['Name', 'Role', 'Source URL'],
      preferred_source_types: ['Official websites'],
      evidence_requirements: ['Source URL for every material fact'],
      verification_requirements: [],
      unknown_handling: 'Keep missing values unknown.',
      search_settings: {
        keywords: ['independent film producer'],
        excluded_keywords: [],
        preferred_domains: [],
        excluded_domains: [],
        default_result_limit: 10,
      },
    },
    personalization: { allowed: [], preferred_details: [], tone: [], avoid: [] },
    outreach: { objectives: [], channels: [], tone: [], approval_required: true },
    database: { fields: [{ name: 'Name', required: true, purpose: 'Identity', expected_source: 'research' }] },
    human_review: { requirements: [], approval_points: ['Review campaign configuration'] },
    constraints: [],
    conflicts: [],
    approximations: [],
    unknowns_requiring_confirmation: [],
  };
}

test('accepts a complete research-ready campaign configuration', () => {
  assert.deepEqual(validateResearchReadyConfiguration(validBrief()), { ok: true, errors: [] });
});

test('requires a human to make geography and entity type explicit', () => {
  const brief = validBrief();
  brief.targets[0].entity_kind = 'unknown';
  brief.targets[0].geography_mode = 'unspecified';
  brief.targets[0].geography = [];

  const result = validateResearchReadyConfiguration(brief);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((error) => error.path), [
    'targets.0.entity_kind',
    'targets.0.geography_mode',
  ]);
});

test('accepts an explicit unrestricted geography without locations', () => {
  const brief = validBrief();
  brief.targets[0].geography_mode = 'unrestricted';
  brief.targets[0].geography = [];

  assert.equal(validateResearchReadyConfiguration(brief).ok, true);
});

test('requires bounded search settings and a usable keyword', () => {
  const brief = validBrief();
  brief.research.search_settings = {
    keywords: [],
    excluded_keywords: [],
    preferred_domains: [],
    excluded_domains: [],
    default_result_limit: 10,
  };

  const result = validateResearchReadyConfiguration(brief);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].path, 'research.search_settings.keywords');
});

