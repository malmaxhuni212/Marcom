import assert from 'node:assert/strict';
import test from 'node:test';
import { findDuplicate } from './repositories/research-repository';
import type { ResearchEntry } from '@/marcom/schemas/research-record';

function entry(name: string, website: string): ResearchEntry {
  return {
    record: {
      research_record_version: '1.1',
      record_id: 'record-1',
      project_id: 'campaign-1',
      brief_target_id: 'target-1',
      identity: { name, entity_kind: 'organisation', identity_verified: true },
      target_type: 'Publisher',
      role: null,
      organisation: name,
      country: null,
      location: null,
      websites: [{ url: website, type: 'company', title: name }],
      social_profiles: [],
      public_contact: [],
      background: [],
      work_and_projects: [],
      achievements: [],
      industry_activity: [],
      qualification_assessment: [],
      reason_for_relevance: null,
      fit: { score: 50, band: 'possible', rationale: 'Test fixture' },
      summary: 'Test fixture',
      evidence: [],
      sources: [],
      unknowns: [],
      contradictions: [],
      research_confidence: 'medium',
      matched_prospect_id: null,
      researched_at: '2026-01-01T00:00:00.000Z',
      research_agent_version: 'test',
    },
    seed: { name, website },
    qa: { status: 'passed', issues: [] },
    relationship_status: null,
    model: 'test-model',
    ai_provider: 'fake',
    searches: ['test query'],
    search_provider: 'fake',
    search_request_ids: [],
    search_usage: { requests: 1, estimated_cost_usd: 0, latency_ms: 1 },
    search_warnings: [],
  };
}

test('duplicate lookup matches normalized names', () => {
  const existing = entry('Example Publishing Ltd.', 'https://example.test/about');
  assert.equal(findDuplicate([existing], { name: 'example publishing ltd' }), existing);
});

test('duplicate lookup matches canonical URLs', () => {
  const existing = entry('Example Publishing', 'https://www.example.test/about/?utm_source=test');
  assert.equal(
    findDuplicate([existing], { name: 'A different label', website: 'https://example.test/about' }),
    existing,
  );
});
