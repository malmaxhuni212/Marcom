import assert from 'node:assert/strict';
import test from 'node:test';
import type { ResearchEntry, ReviewStatus } from '../schemas/research-record';
import { evidenceCoverage, reviewStatus, summarizeResearch } from './review';

function makeEntry(status?: ReviewStatus, duplicate = false): ResearchEntry {
  return {
    record: {
      research_record_version: '1.1',
      record_id: `record-${status ?? 'new'}`,
      project_id: 'project-1',
      brief_target_id: 'target-1',
      identity: { name: 'Sample Prospect', entity_kind: 'person', identity_verified: true },
      target_type: 'Writers',
      role: 'Writer',
      organisation: null,
      country: 'United Kingdom',
      location: 'London',
      websites: [], social_profiles: [], public_contact: [], background: [], work_and_projects: [], achievements: [], industry_activity: [],
      qualification_assessment: [],
      reason_for_relevance: null,
      fit: { score: 70, band: 'strong', rationale: 'Matches the approved target.' },
      summary: 'A short factual profile.',
      evidence: [
        { claim: 'Based in London.', field: 'location', source_ids: ['source-1'], quote: null, confidence: 'verified' },
        { claim: 'Works as a writer.', field: 'role', source_ids: ['source-1'], quote: null, confidence: 'likely' },
      ],
      sources: [{ id: 'source-1', url: 'https://example.com/profile', title: 'Profile', source_type: 'official profile', retrieved_at: null }],
      unknowns: [
        { field: 'role', reason: 'Exact title is unclear.' },
        { field: 'public_contact', reason: 'No public contact route found.' },
      ],
      contradictions: [],
      research_confidence: 'medium',
      matched_prospect_id: duplicate ? 'existing-prospect' : null,
      researched_at: '2026-10-08T12:00:00.000Z',
      research_agent_version: 'test',
    },
    seed: { name: 'Sample Prospect', entity_kind: 'person' },
    qa: { status: 'passed', issues: [] },
    relationship_status: null,
    model: 'test-model',
    searches: [], search_provider: 'exa', search_request_ids: [], search_usage: { requests: 1, estimated_cost_usd: 0, latency_ms: 100 }, search_warnings: [],
    review: status ? { project_id: 'p1', record_id: 'r1', reviewed_by: 'system', status, note: null, reviewed_at: '2026-10-08T12:00:00.000Z' } : undefined,
  };
}

test('new research defaults to needs review', () => {
  assert.equal(reviewStatus(makeEntry()), 'needs_review');
});

test('evidence coverage counts distinct supported and unsupported fields', () => {
  assert.deepEqual(evidenceCoverage(makeEntry()), {
    supported: 2,
    unsupported: 1,
    total: 3,
    percent: 67,
  });
});

test('research summary counts review states and duplicate flags', () => {
  assert.deepEqual(
    summarizeResearch([
      makeEntry(),
      makeEntry('shortlisted', true),
      makeEntry('rejected'),
      makeEntry('enrichment_requested'),
    ]),
    {
      total: 4,
      needs_review: 1,
      shortlisted: 1,
      rejected: 1,
      enrichment_requested: 1,
      possible_duplicates: 1,
    },
  );
});






