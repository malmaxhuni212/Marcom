import type { ResearchEntry, ReviewStatus } from '../schemas/research-record';

export interface EvidenceCoverage {
  supported: number;
  unsupported: number;
  total: number;
  percent: number;
}
export interface ResearchReviewSummary {
  total: number;
  needs_review: number;
  shortlisted: number;
  rejected: number;
  enrichment_requested: number;
  possible_duplicates: number;
}

export function reviewStatus(entry: ResearchEntry): ReviewStatus {
  return entry.review?.status ?? 'needs_review';
}

export function evidenceCoverage(entry: ResearchEntry): EvidenceCoverage {
  const supportedFields = new Set(entry.record.evidence.map((item) => item.field));
  const unsupportedFields = new Set(entry.record.unknowns.map((item) => item.field));
  const supported = supportedFields.size;
  const unsupported = [...unsupportedFields].filter((field) => !supportedFields.has(field)).length;
  const total = supported + unsupported;
  return {
    supported,
    unsupported,
    total,
    percent: total === 0 ? 0 : Math.round((supported / total) * 100),
  };
}

export function summarizeResearch(entries: ResearchEntry[]): ResearchReviewSummary {
  const summary: ResearchReviewSummary = {
    total: entries.length,
    needs_review: 0,
    shortlisted: 0,
    rejected: 0,
    enrichment_requested: 0,
    possible_duplicates: 0,
  };
  for (const entry of entries) {
    summary[reviewStatus(entry)] += 1;
    if (entry.record.matched_prospect_id) summary.possible_duplicates += 1;
  }
  return summary;
}
