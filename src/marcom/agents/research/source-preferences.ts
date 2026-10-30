import type { SocialProfile } from '../../schemas/research-record';
import type { StructuredBrief } from '../../schemas/structured-brief';

export type SocialPlatform = SocialProfile['platform'];

const SOCIAL_PLATFORMS: readonly SocialPlatform[] = [
  'linkedin',
  'instagram',
  'facebook',
  'x',
  'tiktok',
  'youtube',
  'threads',
  'bluesky',
  'goodreads',
  'substack',
  'medium',
  'other',
];

const PLATFORM_SOURCE_RULES: ReadonlyArray<{
  platform: Exclude<SocialPlatform, 'linkedin' | 'other'>;
  pattern: RegExp;
  domains: readonly string[];
}> = [
  { platform: 'instagram', pattern: /\b(?:instagram|insta|ig)\b/i, domains: ['instagram.com'] },
  { platform: 'facebook', pattern: /\b(?:facebook|fb)\b/i, domains: ['facebook.com'] },
  { platform: 'x', pattern: /(?:^|[^a-z0-9])(?:twitter|x\.com|x)(?:$|[^a-z0-9])/i, domains: ['x.com', 'twitter.com'] },
  { platform: 'tiktok', pattern: /\b(?:tiktok|tik\s*tok)\b/i, domains: ['tiktok.com'] },
  { platform: 'youtube', pattern: /\b(?:youtube|yt)\b/i, domains: ['youtube.com'] },
  { platform: 'threads', pattern: /\bthreads\b/i, domains: ['threads.net', 'threads.com'] },
  { platform: 'bluesky', pattern: /\b(?:bluesky|bsky)\b/i, domains: ['bsky.app'] },
  { platform: 'goodreads', pattern: /\bgoodreads\b/i, domains: ['goodreads.com'] },
  { platform: 'substack', pattern: /\bsubstack\b/i, domains: ['substack.com'] },
  { platform: 'medium', pattern: /\bmedium\b/i, domains: ['medium.com'] },
];

const EXTRA_SOURCE_RULES: ReadonlyArray<{
  pattern: RegExp;
  domains: readonly string[];
}> = [
  { pattern: /\bgithub\b/i, domains: ['github.com'] },
  { pattern: /\bgitlab\b/i, domains: ['gitlab.com'] },
  { pattern: /\bcrunchbase\b/i, domains: ['crunchbase.com'] },
];

const DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/** Normalizes a user-supplied domain or URL into a bare lowercase hostname (e.g. "instagram.com"). */
export function normalizeDomain(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase().replace(/^@+/, '');
  if (!trimmed) return null;

  let candidate = trimmed;
  if (/^https?:\/\//i.test(candidate)) {
    try {
      candidate = new URL(candidate).hostname.toLowerCase();
    } catch {
      return null;
    }
  } else {
    candidate = candidate.split(/[/?#]/)[0] ?? '';
  }

  candidate = candidate.replace(/^www\./, '').replace(/\.+$/, '');
  if (!candidate || candidate.length > 255 || !DOMAIN_PATTERN.test(candidate)) {
    return null;
  }
  return candidate;
}

function domainMatches(domain: string, target: string): boolean {
  return domain === target || domain.endsWith(`.${target}`);
}

export interface ResearchSourcePreferences {
  /** Normalized domains from `research.search_settings.preferred_domains`. */
  preferredDomains: string[];
  /** Normalized domains from `research.search_settings.excluded_domains`. */
  excludedDomains: string[];
  /** Extra non-LinkedIn domains resolved from `preferred_domains` + `preferred_source_types` (capped to 50). */
  extraSourceDomains: string[];
  /** Non-LinkedIn social platforms explicitly requested in the campaign configuration. */
  requestedSocialPlatforms: SocialPlatform[];
}

/**
 * Resolves campaign domain filters and human-written `preferred_source_types` (e.g. "Facebook",
 * "Twitter", "Instagram", "Substack") into concrete search domains for additive open-web Exa calls.
 *
 * LinkedIn is intentionally not added to `extraSourceDomains` from `preferred_source_types` because
 * Exa's `category: "people"` index already covers LinkedIn by default.
 */
export function resolveResearchSourcePreferences(brief: StructuredBrief): ResearchSourcePreferences {
  const settings = brief.research?.search_settings;
  const excludedSet = new Set<string>();
  for (const item of settings?.excluded_domains ?? []) {
    const domain = normalizeDomain(item);
    if (domain) excludedSet.add(domain);
  }
  const excludedDomains = [...excludedSet].slice(0, 50);

  const isExcluded = (domain: string) =>
    excludedDomains.some((excluded) => domainMatches(domain, excluded));

  const preferredSet = new Set<string>();
  for (const item of settings?.preferred_domains ?? []) {
    const domain = normalizeDomain(item);
    if (domain && !isExcluded(domain)) preferredSet.add(domain);
  }
  const preferredDomains = [...preferredSet].slice(0, 50);

  const extraSet = new Set<string>(
    preferredDomains.filter((domain) => !domainMatches(domain, 'linkedin.com')),
  );
  const requestedPlatforms = new Set<SocialPlatform>();

  const checkPlatformForDomain = (domain: string) => {
    for (const rule of PLATFORM_SOURCE_RULES) {
      if (rule.domains.some((d) => domainMatches(domain, d))) {
        requestedPlatforms.add(rule.platform);
      }
    }
  };
  for (const domain of preferredDomains) {
    checkPlatformForDomain(domain);
  }

  for (const sourceType of brief.research?.preferred_source_types ?? []) {
    const text = sourceType.trim();
    if (!text) continue;

    const explicitDomain = normalizeDomain(text);
    if (explicitDomain && !domainMatches(explicitDomain, 'linkedin.com') && !isExcluded(explicitDomain)) {
      extraSet.add(explicitDomain);
      checkPlatformForDomain(explicitDomain);
    }

    for (const rule of PLATFORM_SOURCE_RULES) {
      if (rule.pattern.test(text)) {
        requestedPlatforms.add(rule.platform);
        for (const domain of rule.domains) {
          if (!isExcluded(domain)) extraSet.add(domain);
        }
      }
    }

    for (const rule of EXTRA_SOURCE_RULES) {
      if (rule.pattern.test(text)) {
        for (const domain of rule.domains) {
          if (!isExcluded(domain)) extraSet.add(domain);
        }
      }
    }
  }

  return {
    preferredDomains,
    excludedDomains,
    extraSourceDomains: [...extraSet].slice(0, 50),
    requestedSocialPlatforms: [...requestedPlatforms],
  };
}

/** Detects the social platform from a URL hostname first, falling back to a normalized model label. */
export function inferSocialPlatform(url: string, rawPlatform?: string | null): SocialPlatform {
  const domain = normalizeDomain(url);
  if (domain) {
    if (domainMatches(domain, 'linkedin.com')) return 'linkedin';
    if (domainMatches(domain, 'instagram.com')) return 'instagram';
    if (domainMatches(domain, 'facebook.com') || domainMatches(domain, 'fb.com')) return 'facebook';
    if (domainMatches(domain, 'x.com') || domainMatches(domain, 'twitter.com')) return 'x';
    if (domainMatches(domain, 'tiktok.com')) return 'tiktok';
    if (domainMatches(domain, 'youtube.com') || domainMatches(domain, 'youtu.be')) return 'youtube';
    if (domainMatches(domain, 'threads.net') || domainMatches(domain, 'threads.com')) return 'threads';
    if (domainMatches(domain, 'bsky.app')) return 'bluesky';
    if (domainMatches(domain, 'goodreads.com')) return 'goodreads';
    if (domainMatches(domain, 'substack.com')) return 'substack';
    if (domainMatches(domain, 'medium.com')) return 'medium';
  }

  const label = (rawPlatform ?? '').trim().toLowerCase();
  if (label === 'twitter' || label === 'x/twitter' || label === 'x.com') return 'x';
  if (label === 'insta' || label === 'ig') return 'instagram';
  if (label === 'fb') return 'facebook';
  if ((SOCIAL_PLATFORMS as readonly string[]).includes(label)) {
    return label as SocialPlatform;
  }
  return 'other';
}

/** True when a URL points to a known social profile domain rather than a standalone website. */
export function isSocialProfileUrl(url: string): boolean {
  const platform = inferSocialPlatform(url, null);
  return platform !== 'other';
}
