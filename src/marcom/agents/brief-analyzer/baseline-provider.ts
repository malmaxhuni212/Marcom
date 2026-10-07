/**
 * OFFLINE BASELINE for the Brief Analyzer.
 *
 * This is NOT the Brief Analyzer's intelligence. It is a deterministic, rule-based stand-in that
 * implements the LLMProvider interface so the full pipeline (prompt -> JSON -> validation ->
 * evaluation) can run without real AI calls (which are out of scope for this phase).
 *
 * Its scores establish a FLOOR. A real model plugged in through LLMProvider must beat it.
 * Known weaknesses (intentionally not hidden): weak conflict detection, crude target phrase
 * extraction, cannot attribute criteria to specific targets reliably.
 */
import type { LLMProvider, LLMRequest } from '../../llm/provider';
import { STRUCTURED_BRIEF_VERSION, type Criterion, type StructuredBrief, type Target } from '../../schemas/structured-brief';
import { findApproximations, findVagueTerms, splitSentences } from '../../validation/text-utils';
import { BRIEF_END, BRIEF_START } from './analyzer';

const GEOGRAPHIES = [
  'United Kingdom', 'UK', 'England', 'Scotland', 'Wales', 'Northern Ireland', 'Ireland', 'London', 'Manchester',
  'North of England', 'Midlands', 'Bristol', 'Edinburgh', 'Glasgow', 'United States', 'USA', 'US', 'Canada',
  'Europe', 'European', 'EU', 'Germany', 'Berlin', 'France', 'Paris', 'Spain', 'Spanish', 'Portugal', 'Portuguese',
  'Lisbon', 'Italy', 'Netherlands', 'Nordics', 'Australia', 'India', 'Japan', 'Brazil', 'Africa', 'East Africa',
  'Kenya', 'Uganda', 'Tanzania', 'Nigeria', 'Asia', 'North America', 'Latin America', 'New York', 'Los Angeles',
  'worldwide', 'global', 'globally', 'international',
];

const SOURCE_HINTS: Record<string, string> = {
  linkedin: 'professional networking profiles (e.g. LinkedIn)',
  imdb: 'film credit databases (e.g. IMDb)',
  bfi: 'national film body listings (e.g. BFI)',
  festival: 'festival programmes and listings',
  'companies house': 'company registries (e.g. Companies House)',
  crunchbase: 'company databases (e.g. Crunchbase)',
  website: 'official websites',
  press: 'press and news coverage',
  news: 'press and news coverage',
  github: 'code repositories (e.g. GitHub)',
  journal: 'academic journals and publications',
  publication: 'academic journals and publications',
  'google scholar': 'academic journals and publications',
  directory: 'industry directories',
  instagram: 'public social profiles (e.g. Instagram)',
  catalogue: 'publisher catalogues',
  'trade press': 'trade press',
};

const CHANNELS = ['email', 'linkedin', 'instagram', 'phone', 'twitter', 'x/twitter', 'letter', 'in person', 'contact form', 'dm'];
const TONES = ['warm', 'friendly', 'formal', 'professional', 'casual', 'concise', 'playful', 'respectful', 'enthusiastic', 'informal', 'personal', 'direct'];

const TARGET_VERB = /\b(?:find|identify|research|source|recruit|reach out to|reach|contact|target|looking for|locate|shortlist|get in touch with|approach)\s+/i;
const TARGET_STOP = /\s+(?:who|that|which|in|from|based|across|for|to|with|whose|at|on|and then|so|by|published|working|currently)\b|[,.;:()]|$/i;

function clean(s: string) {
  return s.replace(/\s+/g, ' ').trim();
}

function criterion(text: string, origin: Criterion['origin'] = 'explicit'): Criterion {
  return { text: clean(text), origin, needs_operational_definition: findVagueTerms(text).length > 0 };
}

function extractTargets(sentences: string[], brief: string): Target[] {
  const phrases: string[] = [];
  for (const s of sentences) {
    const parts = s.split(/;|\(\w\)|\b(?:plus|as well as|and also)\b/i);
    for (const part of parts) {
      const m = part.match(TARGET_VERB);
      if (!m) {
        // lettered/bulleted list items under a target heading
        continue;
      }
      let rest = part.slice((m.index ?? 0) + m[0].length);
      rest = rest.replace(/^(?:potential|relevant|some|a few|a list of|the|a|an|new|more|\d+[+]?)\s+/i, '');
      rest = rest.replace(/^(?:potential|relevant|some|the)\s+/i, '');
      const stop = rest.search(TARGET_STOP);
      const phrase = clean(stop > 0 ? rest.slice(0, stop) : rest);
      if (phrase && phrase.split(' ').length <= 7 && !/^(their|them|it|out|people for the thing)$/i.test(phrase)) phrases.push(phrase);
    }
  }
  const unique = [...new Map(phrases.map((p) => [p.toLowerCase(), p])).values()];
  const globalGeo = GEOGRAPHIES.filter((g) => new RegExp(`\\b${g}\\b`).test(brief));

  if (unique.length === 0) {
    return [
      {
        id: 'target-a',
        target_type: 'unknown',
        entity_kind: 'unknown',
        description: 'The brief does not state who should be researched.',
        geography: globalGeo,
        qualification_criteria: [],
        exclusion_criteria: [],
        priority: 'unspecified',
      },
    ];
  }

  return unique.map((p, i) => {
    const sentence = sentences.find((s) => s.toLowerCase().includes(p.toLowerCase())) ?? '';
    const localGeo = GEOGRAPHIES.filter((g) => new RegExp(`\\b${g}\\b`).test(sentence));
    const isOrg = /\b(compan|organi[sz]ation|business|brand|agenc|supplier|publisher|charit|venue|institution|shop|roaster|cooperative|outlet|firm|studio)/i.test(p);
    const isPerson = /\b(people|person|producer|director|author|engineer|journalist|scientist|lead|leader|founder|host|creator|designer|cinematographer|manager|head|candidate|speaker|artist|writer)/i.test(p);
    return {
      id: `target-${String.fromCharCode(97 + i)}`,
      target_type: p,
      entity_kind: isOrg && !isPerson ? 'organisation' : isPerson && !isOrg ? 'person' : 'either',
      description: clean(sentence),
      geography: localGeo.length ? localGeo : globalGeo,
      qualification_criteria: [],
      exclusion_criteria: [],
      priority: i === 0 ? 'primary' : 'secondary',
    } satisfies Target;
  });
}

function listAfter(sentence: string, keyword: RegExp): string[] {
  const m = sentence.match(keyword);
  if (!m) return [];
  return sentence
    .slice((m.index ?? 0) + m[0].length)
    .split(/,|\band\b|\//)
    .map((x) => clean(x.replace(/[.:]$/, '')))
    .filter((x) => x && x.split(' ').length <= 5);
}

export function baselineAnalyze(brief: string): StructuredBrief {
  const sentences = splitSentences(brief);
  const lower = brief.toLowerCase();

  const nameMatch =
    brief.match(/^(?:project(?:\s+name)?|title|campaign)\s*[:\-–]\s*(.+)$/im) ??
    brief.match(/^([A-Z][\w']+(?:\s+[A-Z][\w']+){0,3})\s+(?:is|—|-|–)\s/m);
  const name = nameMatch ? clean(nameMatch[1]) : null;

  const objectiveRe = /\b(goal|objective|aim|we want|we need|we're looking|we are looking|looking to|purpose|help us|so that|in order to)\b/i;
  const primary = sentences.find((s) => objectiveRe.test(s)) ?? sentences.find((s) => TARGET_VERB.test(s)) ?? '';
  const secondary = sentences.filter((s) => s !== primary && /\b(also|secondary|additionally|as well|second goal)\b/i.test(s));
  const metrics = sentences.filter((s) => /\b(success|measure|kpi|metric|aim for|target of|responses|meetings|sign-?ups|submissions)\b/i.test(s));

  const targets = extractTargets(sentences, brief);

  const exclusionRe = /\b(exclude|excluding|do not (?:contact|include|approach|target)|don't (?:contact|include|approach|target)|not interested in|except|no (?:agencies|recruiters|competitors)|should not be|must not be|skip|ignore|anyone (?:we|who) (?:have|already))/i;
  const qualRe = /\b(must|should|need to|needs to|required|at least|with experience|who have|that have|who has|ideally|preferably|criteria|only|with a track record|credits?|published)\b/i;
  const avoidRe = /\b(avoid|don't mention|do not mention|never mention|no mention|without mentioning)\b/i;

  const exclusions = sentences.filter((s) => exclusionRe.test(s));
  const quals = sentences.filter((s) => qualRe.test(s) && !exclusionRe.test(s) && !avoidRe.test(s) && !/\b(tone|email|message|outreach)\b/i.test(s));

  for (const t of targets) {
    const own = (list: string[]) => {
      const specific = list.filter((s) => t.target_type !== 'unknown' && s.toLowerCase().includes(t.target_type.toLowerCase().split(' ').slice(-1)[0]));
      return specific.length ? specific : targets.length === 1 ? list : [];
    };
    t.qualification_criteria = own(quals).map((s) => criterion(s));
    t.exclusion_criteria = own(exclusions).map((s) => criterion(s));
    // vague words in the target phrase itself are criteria needing definition
    for (const v of findVagueTerms(t.target_type)) {
      t.qualification_criteria.push({ text: `"${v}" (as used in the brief)`, origin: 'explicit', needs_operational_definition: true });
    }
  }
  // exclusions not attributable to any target become constraints
  const attributed = new Set(targets.flatMap((t) => t.exclusion_criteria.map((c) => c.text)));
  const looseExclusions = exclusions.filter((s) => !attributed.has(clean(s)));

  const fieldSentences = sentences.filter((s) => /\b(capture|record|collect|columns?|fields?|include their|we need their|get their|details)\b/i.test(s));
  const briefFields = [...new Set(fieldSentences.flatMap((s) => listAfter(s, /\b(?:capture|record|collect|columns?|fields?|include their|we need their|get their)\b[:\s]*/i)))];

  const sources = [...new Set(Object.entries(SOURCE_HINTS).filter(([k]) => lower.includes(k)).map(([, v]) => v))];
  const channels = CHANNELS.filter((c) => new RegExp(`\\b${c.replace('/', '\\/')}\\b`, 'i').test(brief) && sentences.some((s) => /\b(reach|contact|outreach|message|send|via|through|channel)\b/i.test(s) && s.toLowerCase().includes(c)));
  const tones = TONES.filter((t) => new RegExp(`\\b${t}\\b`, 'i').test(brief));

  const personalisationAllowed = sentences.filter((s) => /\b(mention|reference|personalis|personaliz|tailor|refer to)\b/i.test(s) && !avoidRe.test(s));
  const avoid = sentences.filter((s) => avoidRe.test(s));
  const constraints = [
    ...sentences.filter((s) => /\b(budget|deadline|by (?:end of|the end|next)|within|weeks?|months?|gdpr|compliance|no paid|free tools|limit|maximum|no more than|must use)\b/i.test(s)),
    ...looseExclusions,
  ].map(clean);

  // --- unknowns
  const unknowns: StructuredBrief['unknowns_requiring_confirmation'] = [];
  for (const v of findVagueTerms(brief)) {
    const quote = sentences.find((s) => new RegExp(`\\b${v}\\b`, 'i').test(s)) ?? null;
    unknowns.push({ topic: `Definition of "${v}"`, reason: `"${v}" is not operationally defined; a human must specify how to measure it.`, quote, blocking: true });
  }
  if (!name) unknowns.push({ topic: 'Project name', reason: 'No project name stated.', quote: null, blocking: false });
  if (targets[0].target_type === 'unknown') unknowns.push({ topic: 'Target type', reason: 'The brief does not say who or what to research.', quote: null, blocking: true });
  if (targets.some((t) => t.geography.length === 0)) unknowns.push({ topic: 'Geography', reason: 'No geography/location specified for at least one target group.', quote: null, blocking: false });
  if (!primary) unknowns.push({ topic: 'Primary objective', reason: 'The purpose of the project is not stated.', quote: null, blocking: true });
  if (channels.length === 0) unknowns.push({ topic: 'Outreach channel', reason: 'No outreach channel specified.', quote: null, blocking: false });
  if (briefFields.length === 0) unknowns.push({ topic: 'Required database fields', reason: 'The brief does not specify which fields to capture.', quote: null, blocking: false });

  // --- conflicts (weak heuristic)
  const conflicts: StructuredBrief['conflicts'] = [];
  const toneConflict = (['formal', 'casual'] as const).every((t) => tones.includes(t)) || (['formal', 'playful'] as const).every((t) => tones.includes(t));
  if (toneConflict) {
    const q = sentences.filter((s) => /\b(formal|casual|playful)\b/i.test(s));
    conflicts.push({ description: 'Contradictory tone instructions.', quotes: q });
  }

  const approximations = findApproximations(brief).map((quote) => ({
    quote,
    interpretation: 'Approximate value from the brief. Treat as indicative, not as a hard threshold; confirm before using as a filter.',
  }));

  const systemFields: StructuredBrief['database']['fields'] = [
    { name: 'name', required: true, purpose: 'Identity of the person or organisation.', expected_source: 'research' },
    { name: 'target_type', required: true, purpose: 'Which brief target group the record belongs to.', expected_source: 'system' },
    { name: 'sources', required: true, purpose: 'Evidence trail for every important claim.', expected_source: 'research' },
    { name: 'research_confidence', required: true, purpose: 'High / medium / low confidence in the record.', expected_source: 'research' },
    { name: 'review_status', required: true, purpose: 'Human approval state.', expected_source: 'human' },
  ];
  const fields = [
    ...systemFields,
    ...briefFields
      .filter((f) => !systemFields.some((s) => s.name === f.toLowerCase()))
      .map((f) => ({ name: f, required: true, purpose: 'Requested in the brief.', expected_source: 'research' as const })),
  ];

  return {
    structured_brief_version: STRUCTURED_BRIEF_VERSION,
    project: {
      name,
      description: clean(sentences.slice(0, 2).join(' ')),
      primary_objective: clean(primary),
      secondary_objectives: secondary.map(clean),
      success_metrics: metrics.map(clean),
    },
    targets,
    research: {
      required_fields: briefFields.length ? briefFields : ['name', 'role or type', 'organisation', 'location', 'reason for relevance'],
      preferred_source_types: sources.length ? sources : ['public professional sources appropriate to the target type'],
      evidence_requirements: ['Every qualification claim must cite at least one public source.'],
      verification_requirements: ['Confirm identity before recording.', 'Contact details only if published verbatim by a public source.'],
      unknown_handling: 'Record unverifiable values as unknown with a reason. Never guess.',
    },
    personalization: {
      allowed: personalisationAllowed.map(clean),
      preferred_details: [],
      tone: tones.length ? tones : ['Lunim default voice: human, approachable, professional, clear (organisational context)'],
      avoid: avoid.map(clean),
    },
    outreach: {
      objectives: primary ? [clean(primary)] : [],
      channels,
      tone: tones,
      approval_required: true,
    },
    database: { fields },
    human_review: {
      requirements: ['Human reviews every prospect and every draft before outreach.'],
      approval_points: ['Approve structured brief', 'Approve research records', 'Approve outreach drafts'],
    },
    constraints: [...new Set(constraints)],
    conflicts,
    approximations,
    unknowns_requiring_confirmation: unknowns,
  };
}

/** LLMProvider adapter so the baseline flows through the exact same pipeline as a real model. */
export class BaselineBriefProvider implements LLMProvider {
  model = 'baseline';
  readonly name = 'offline-baseline-heuristic';
  async complete(request: LLMRequest): Promise<string> {
    const start = request.user.indexOf(BRIEF_START);
    const end = request.user.indexOf(BRIEF_END);
    const brief = start >= 0 && end > start ? request.user.slice(start + BRIEF_START.length, end).trim() : request.user;
    return JSON.stringify(baselineAnalyze(brief), null, 2);
  }
}
