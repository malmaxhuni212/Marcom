import type { StructuredBrief } from '../schemas/structured-brief';

export interface ConfigurationIssue {
  path: string;
  message: string;
}

export interface ConfigurationValidationResult {
  ok: boolean;
  errors: ConfigurationIssue[];
}

/**
 * Checks only the information needed to save a research-ready campaign.
 * Outreach fields are intentionally not blocking at this stage.
 */
export function validateResearchReadyConfiguration(brief: StructuredBrief): ConfigurationValidationResult {
  const errors: ConfigurationIssue[] = [];

  if (!brief.project.name?.trim()) {
    errors.push({ path: 'project.name', message: 'Campaign name is required.' });
  }
  if (!brief.project.primary_objective.trim()) {
    errors.push({ path: 'project.primary_objective', message: 'Primary objective is required.' });
  }
  if (brief.targets.length === 0) {
    errors.push({ path: 'targets', message: 'Add at least one target audience.' });
  }

  brief.targets.forEach((target, index) => {
    const base = `targets.${index}`;
    if (!target.target_type.trim()) {
      errors.push({ path: `${base}.target_type`, message: 'Target audience name is required.' });
    }
    if (target.entity_kind === 'unknown') {
      errors.push({ path: `${base}.entity_kind`, message: 'Choose whether this target is a person, organisation, or either.' });
    }
    if (!target.geography_mode || target.geography_mode === 'unspecified') {
      errors.push({ path: `${base}.geography_mode`, message: 'Choose specific locations or confirm that there is no geographic restriction.' });
    }
    if (target.geography_mode === 'specified' && !target.geography.some((location) => location.trim())) {
      errors.push({ path: `${base}.geography`, message: 'Add at least one location for this target audience.' });
    }
  });

  const settings = brief.research.search_settings;
  if (!settings) {
    errors.push({ path: 'research.search_settings', message: 'Search settings are required.' });
  } else if (!settings.keywords.some((keyword) => keyword.trim())) {
    errors.push({ path: 'research.search_settings.keywords', message: 'Add at least one search keyword or phrase.' });
  } else if (!Number.isInteger(settings.default_result_limit) || settings.default_result_limit < 1 || settings.default_result_limit > 25) {
    errors.push({ path: 'research.search_settings.default_result_limit', message: 'Default result limit must be between 1 and 25.' });
  }

  if (brief.database.fields.length === 0) {
    errors.push({ path: 'database.fields', message: 'Add at least one prospect record field.' });
  } else if (brief.database.fields.some((field) => !field.name.trim())) {
    errors.push({ path: 'database.fields', message: 'Every prospect record field needs a name.' });
  }

  return { ok: errors.length === 0, errors };
}

