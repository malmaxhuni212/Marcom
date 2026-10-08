/**
 * Research normaliser + deterministic QA.
 *
 * The browser-search model returns loosely-shaped JSON (structured outputs are unavailable with
 * browser_search). This module converts it into a validated ResearchRecord and enforces the
 * no-fabrication rules in code, not just in the prompt:
 *
 *  - a source is kept only if the browser tool actually returned that URL
 *  - evidence is kept only if it still cites at least one kept source
 *  - a contact is kept only if its value appears verbatim in text the tool returned
 *  - website / LinkedIn / profiles must have been seen by the tool
 *  - "met" criteria need a source, otherwise they become "unknown"
 *  - fit score and confidence are capped when identity or evidence is weak
 */
import {
  RESEARCH_RECORD_VERSION,
  ResearchRecordSchema,
  type ClaimConfidence,
  type Evidence,
  type FitAssessment,
  type ProspectSeed,
  type PublicContact,
  type ResearchQA,
  type ResearchQAIssue,
  type ResearchRecord,
  type Source,
} from '../../schemas/research-record';
import type { SeenSource } from '../../search/provider';

export const RESEARCH_AGENT_VERSION = 'research-agent/0.1.0';

export interface NormalizeContext {
  projectId: string;
  targetId: string;
  targetType: string;
  seed: ProspectSeed;
  seen: SeenSource[];
  pages: { url: string; text: string }[];
  toolText: string;
  matchedProspectId: string | null;
  relationshipStatus: string | null;
}

// ---------- small coercion helpers ----------
const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s && !/^(null|n\/a|unknown|none|not found|-)$/i.test(s) ? s : null;
};
const strArr = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v ? [v] : []).map(str).filter((x): x is string => !!x).slice(0, 12);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => {
  const s = String(v ?? '').toLowerCase().trim();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
};
const conf = (v: unknown): ClaimConfidence => oneOf(v, ['verified', 'likely', 'uncertain'] as const, 'uncertain');

export function normalizeName(s: string): string {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Canonical form for URL comparison: no scheme, no www, no query/fragment, no trailing slash. */
export function canonicalUrl(u: string): string {
  return u
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

const hostOf = (u: string) => canonicalUrl(u).split('/')[0];

const OUTREACH_PATTERN = /\b(dear\s+\w+|i hope (this|you)|we('d| would) love to|reach(ing)? out to you|looking forward to (hearing|working)|best regards|kind regards)\b/i;

export function fitBand(score: number): FitAssessment['band'] {
  if (score <= 20) return 'irrelevant';
  if (score <= 40) return 'weak';
  if (score <= 60) return 'possible';
  if (score <= 80) return 'strong';
  return 'highly_relevant';
}

export function normalizeAndQA(raw: unknown, ctx: NormalizeContext): { record: ResearchRecord; qa: ResearchQA } {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const issues: ResearchQAIssue[] = [];
  const unknowns: { field: string; reason: string }[] = [];
  const issue = (severity: ResearchQAIssue['severity'], code: string, message: string) => issues.push({ severity, code, message });
  const addUnknown = (field: string, reason: string) => {
    if (!unknowns.some((u) => u.field === field)) unknowns.push({ field, reason });
  };

  const seenCanon = new Set(ctx.seen.map((s) => canonicalUrl(s.url)));
  const toolTextLower = ctx.toolText.toLowerCase();
  const toolDigits = ctx.toolText.replace(/\D/g, '');
  const wasSeen = (url: string) => {
    const c = canonicalUrl(url);
    return c.length > 3 && (seenCanon.has(c) || toolTextLower.includes(c));
  };

  // ---------- sources ----------
  const now = new Date().toISOString();
  const sources: Source[] = [];
  const keptIds = new Set<string>();
  const sourceTypeById = new Map<string, string>();
  const rawSources: any[] = Array.isArray(d.sources) ? d.sources : [];
  rawSources.forEach((s, i) => {
    const url = str(s?.url);
    const id = str(s?.id) ?? `S${i + 1}`;
    if (!url) return;
    if (!wasSeen(url)) {
      issue('warning', 'unverified_source', `Removed source not returned by web search: ${url}`);
      return;
    }
    if (keptIds.has(id)) return;
    const type = str(s?.type) ?? 'other';
    keptIds.add(id);
    sourceTypeById.set(id, type.toLowerCase());
    sources.push({ id, url, title: str(s?.title), source_type: type, retrieved_at: now });
  });

  const keepIds = (v: unknown): string[] => strArr(v).filter((id) => keptIds.has(id));

  // ---------- evidence ----------
  const evidence: Evidence[] = [];
  for (const e of Array.isArray(d.evidence) ? d.evidence : []) {
    const claim = str(e?.claim);
    if (!claim) continue;
    const ids = keepIds(e?.sources ?? e?.source_ids);
    if (!ids.length) {
      issue('warning', 'unsupported_claim', `Removed claim without a verified source: "${claim.slice(0, 120)}"`);
      continue;
    }
    let confidence = conf(e?.confidence);
    // A directory/aggregator alone can never make something "verified".
    const onlyWeak = ids.every((id) => /directory|aggregator|other/.test(sourceTypeById.get(id) ?? ''));
    if (onlyWeak && confidence === 'verified') confidence = ids.length > 1 ? 'likely' : 'uncertain';
    evidence.push({ claim, field: str(e?.field) ?? 'other', source_ids: ids, quote: str(e?.quote), confidence });
  }

  // ---------- contacts (verbatim check) ----------
  const contacts: PublicContact[] = [];
  const kinds = ['email', 'contact_form', 'phone', 'agent_or_representative', 'other'] as const;
  for (const c of Array.isArray(d.contacts) ? d.contacts : []) {
    const value = str(c?.value);
    if (!value) continue;
    const kind = oneOf(c?.kind, kinds, 'other');
    const ids = keepIds(c?.source ? [c.source] : c?.sources ?? c?.source_ids);
    let verbatim: boolean;
    if (kind === 'phone') {
      const digits = value.replace(/\D/g, '');
      verbatim = digits.length >= 6 && toolDigits.includes(digits);
    } else if (/^https?:\/\//i.test(value) || /\.[a-z]{2,}\//i.test(value)) {
      verbatim = wasSeen(value);
    } else {
      verbatim = toolTextLower.includes(value.toLowerCase());
    }
    if (!verbatim) {
      issue('warning', 'unverified_contact', `Removed ${kind} "${value}" — not found verbatim in any searched page.`);
      addUnknown(kind === 'email' ? 'email' : kind, 'No publicly verified value found.');
      continue;
    }
    if (!ids.length) {
      // Value is real (seen verbatim) but the citation was invalid: attribute it to the page that contains it.
      const needle = kind === 'phone' ? null : value.toLowerCase();
      const page = ctx.pages.find((p) =>
        needle ? p.text.toLowerCase().includes(needle) : p.text.replace(/\D/g, '').includes(value.replace(/\D/g, '')),
      );
      if (!page) {
        issue('warning', 'unattributed_contact', `Removed ${kind} "${value}" — could not attribute it to a specific page.`);
        continue;
      }
      let src = sources.find((s) => canonicalUrl(s.url) === canonicalUrl(page.url));
      if (!src) {
        src = { id: `S${sources.length + 1}-auto`, url: page.url, title: null, source_type: 'other', retrieved_at: now };
        sources.push(src);
        keptIds.add(src.id);
        sourceTypeById.set(src.id, 'other');
      }
      issue('info', 'contact_source_fixed', `Contact "${value}" re-attributed to ${page.url}.`);
      contacts.push({ kind, value, is_professional: c?.is_professional !== false, source_ids: [src.id], confidence: 'uncertain' });
      continue;
    }
    contacts.push({ kind, value, is_professional: c?.is_professional !== false, source_ids: ids, confidence: conf(c?.confidence) });
  }
  if (!contacts.length) addUnknown('contact', 'No legitimate public contact route was verified.');

  // ---------- websites and socials ----------
  const checkUrl = (field: string, v: unknown): string | null => {
    const url = str(v);
    if (!url) return null;
    if (wasSeen(url)) return url;
    issue("warning", "unverified_url", `Removed ${field} "${url}" - not returned by web search.`);
    addUnknown(field, "URL could not be verified from search results.");
    return null;
  };
  const websites = (Array.isArray(d.websites) ? d.websites : [])
    .map(w => ({ url: checkUrl("website", w?.url), type: (str(w?.type) || "personal"), title: str(w?.title) }))
    .filter(w => w.url);
  if (!websites.length) addUnknown("website", "No official website verified.");

  const social_profiles = (Array.isArray(d.social_profiles) ? d.social_profiles : [])
    .map(s => ({
      platform: (str(s?.platform) || "linkedin"),
      profile_url: checkUrl("social", s?.profile_url),
      username: str(s?.username) || null,
      display_name: str(s?.display_name) || null,
      verified_status: typeof s?.verified_status === "boolean" ? s.verified_status : false,
      confidence: conf(s?.confidence),
      source_ids: keepIds(s?.source_ids)
    }))
    .filter(s => s.profile_url);

  // ---------- qualification criteria ----------
  const criteria = (Array.isArray(d.criteria) ? d.criteria : [])
    .map((c: any) => {
      const criterion = str(c?.criterion);
      if (!criterion) return null;
      let status = oneOf(c?.status, ['met', 'not_met', 'partially_met', 'unknown'] as const, 'unknown');
      const ids = keepIds(c?.sources ?? c?.source_ids);
      let note = str(c?.note);
      if ((status === 'met' || status === 'partially_met' || status === 'not_met') && !ids.length) {
        note = `Downgraded to unknown: no verified source. ${note ?? ''}`.trim();
        status = 'unknown';
      }
      return { criterion, status, note, source_ids: ids };
    })
    .filter(Boolean) as ResearchRecord['qualification_assessment'];

  // ---------- identity ----------
  const name = str(d.name) ?? ctx.seed.name;
  const entityKind = oneOf(d.entity_kind, ['person', 'organisation'] as const,
    ctx.seed.entity_kind === 'organisation' ? 'organisation' : 'person');
  let identityVerified = d.identity_verified === true && sources.length > 0;
  if (d.identity_verified === true && !identityVerified) {
    issue('warning', 'identity_unsupported', 'Model claimed identity verified, but no verified sources remain.');
  }
  if (!identityVerified) issue('warning', 'identity_unverified', 'Identity could not be confirmed from reliable sources — human review needed.');
  if (normalizeName(name) && normalizeName(ctx.seed.name) && !normalizeName(name).includes(normalizeName(ctx.seed.name).split(' ')[0])) {
    issue('warning', 'name_mismatch', `Research returned "${name}" for seed "${ctx.seed.name}" — confirm it is the same entity.`);
  }

  // ---------- model-provided unknowns / contradictions ----------
  for (const u of Array.isArray(d.unknowns) ? d.unknowns : []) {
    const field = str(u?.field ?? u);
    if (field) addUnknown(field, str(u?.reason) ?? 'Not found in public sources.');
  }
  const contradictions = strArr(d.contradictions);
  if (contradictions.length) issue('warning', 'contradictions', `${contradictions.length} contradiction(s) between sources.`);

  // ---------- fit score (capped by evidence strength) ----------
  let score = Math.round(Number(d.fit_score));
  if (!Number.isFinite(score)) score = 0;
  score = Math.max(0, Math.min(100, score));
  const original = score;
  if (evidence.length === 0) score = Math.min(score, 20);
  else if (evidence.length < 2) score = Math.min(score, 60);
  if (!identityVerified) score = Math.min(score, 40);
  if (score !== original) issue('info', 'fit_capped', `Fit score capped from ${original} to ${score} due to limited verified evidence.`);
  let rationale = str(d.fit_rationale) ?? '';
  const summary = str(d.summary) ?? '';

  if (OUTREACH_PATTERN.test(summary) || OUTREACH_PATTERN.test(rationale)) {
    issue('warning', 'outreach_language', 'Research text contained outreach-style language; the Research Agent must not write messages.');
  }
  if (!rationale) rationale = 'No evidence-based rationale provided.';

  // ---------- overall confidence ----------
  let confidence = oneOf(d.confidence, ['high', 'medium', 'low'] as const, 'low');
  if (!identityVerified || sources.length === 0) confidence = 'low';
  else if (confidence === 'high' && (evidence.length < 3 || sources.length < 2)) confidence = 'medium';

  if (ctx.relationshipStatus === 'do_not_contact') {
    issue('error', 'do_not_contact', 'Memory marks this prospect as DO NOT CONTACT.');
  }
  if (ctx.matchedProspectId) {
    issue('info', 'known_prospect', `Matches existing prospect in memory (${ctx.matchedProspectId}).`);
  }
  if (sources.length === 0) {
    issue('error', 'no_sources', 'No verifiable sources were found. Nothing in this record is confirmed.');
  }

  const record: ResearchRecord = {
    research_record_version: RESEARCH_RECORD_VERSION,
    record_id: `r-${normalizeName(name).replace(/\s+/g, '-').slice(0, 40) || 'prospect'}-${Date.now().toString(36)}`,
    project_id: ctx.projectId,
    brief_target_id: ctx.targetId,
    identity: { name, entity_kind: entityKind, identity_verified: identityVerified },
    target_type: ctx.targetType,
    role: str(d.role),
    organisation: str(d.organisation),
    country: str(d.country),
    location: str(d.location),
    websites: websites as any,
    social_profiles: social_profiles as any,
    public_contact: contacts,
    background: Array.isArray(d.background) ? d.background.map(String) : [],
    work_and_projects: Array.isArray(d.work_and_projects) ? d.work_and_projects.map(String) : [],
    achievements: Array.isArray(d.achievements) ? d.achievements.map(String) : [],
    industry_activity: Array.isArray(d.industry_activity) ? d.industry_activity.map(String) : [],
    qualification_assessment: criteria,
    reason_for_relevance: rationale,
    fit: { score, band: fitBand(score), rationale },
    summary,
    evidence,
    sources,
    unknowns,
    contradictions,
    research_confidence: confidence,
    matched_prospect_id: ctx.matchedProspectId,
    researched_at: now,
    research_agent_version: RESEARCH_AGENT_VERSION,
  };

  const parsed = ResearchRecordSchema.safeParse(record);
  if (!parsed.success) {
    issue('error', 'schema_invalid', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }

  const status: ResearchQA['status'] = issues.some((i) => i.severity === 'error')
    ? (sources.length === 0 || !parsed.success ? 'failed' : 'needs_review')
    : issues.some((i) => i.severity === 'warning')
      ? 'needs_review'
      : 'passed';

  return { record, qa: { status, issues } };
}

export { hostOf };


