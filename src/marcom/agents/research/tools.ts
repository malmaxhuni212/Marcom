/**
 * Research tool interfaces.
 *
 * The Research Agent never talks to the web directly — it receives `ResearchTools`.
 * Tool *specifications* for future model function-calling live in agents/research/tools/*.json.
 *
 * Implementations available now:
 *  - FixtureResearchTools: offline corpus (agents/research/examples/<scenario>/corpus.json) for tests.
 * Real web search / fetch implementations are intentionally not built in this phase.
 */
import { readFileSync } from 'node:fs';

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface PageDocument {
  url: string;
  title: string;
  content: string;
  source_type: string;
  retrieved_at: string;
}

export interface ResearchTools {
  search(query: string): Promise<SearchResult[]>;
  fetch(url: string): Promise<PageDocument | null>;
}

/** What a model-backed extractor returns for one document. Treated as UNTRUSTED until verified. */
export interface CandidateDraft {
  name: string | null;
  entity_kind: 'person' | 'organisation';
  role?: string | null;
  organisation?: string | null;
  country?: string | null;
  location?: string | null;
  website?: string | null;
  linkedin?: string | null;
  instagram?: string | null;
  other_public_profiles?: string[];
  public_contact?: { kind: 'email' | 'contact_form' | 'phone' | 'agent_or_representative' | 'other'; value: string; is_professional: boolean }[];
  relevant_experience?: string[];
  relevant_projects?: string[];
  achievements?: string[];
  industry_involvement?: string[];
  /** Claims with the verbatim quote that supports them (quote is checked against the document). */
  claims?: { field: string; claim: string; quote: string | null }[];
  qualification?: { criterion: string; status: 'met' | 'not_met' | 'partially_met' | 'unknown'; note: string | null }[];
  reason_for_relevance?: string | null;
}

export interface CandidateExtractor {
  readonly name: string;
  extract(doc: PageDocument, context: { targetType: string; criteria: string[] }): Promise<CandidateDraft[]>;
}

interface Corpus {
  pages: PageDocument[];
}

export class FixtureResearchTools implements ResearchTools {
  private pages: PageDocument[];
  readonly searchLog: string[] = [];
  constructor(corpusFile: string) {
    this.pages = (JSON.parse(readFileSync(corpusFile, 'utf8')) as Corpus).pages;
  }
  async search(query: string): Promise<SearchResult[]> {
    this.searchLog.push(query);
    const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
    return this.pages
      .map((p) => ({ p, score: terms.filter((t) => p.content.toLowerCase().includes(t)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(({ p }) => ({ url: p.url, title: p.title, snippet: p.content.slice(0, 140) }));
  }
  async fetch(url: string): Promise<PageDocument | null> {
    return this.pages.find((p) => p.url === url) ?? null;
  }
}

/** Replays recorded extractor outputs (simulating a model, including its mistakes). */
export class FixtureExtractor implements CandidateExtractor {
  readonly name = 'fixture-extractor';
  private byUrl: Record<string, CandidateDraft[]>;
  constructor(extractionsFile: string) {
    this.byUrl = JSON.parse(readFileSync(extractionsFile, 'utf8'));
  }
  async extract(doc: PageDocument): Promise<CandidateDraft[]> {
    return this.byUrl[doc.url] ?? [];
  }
}
