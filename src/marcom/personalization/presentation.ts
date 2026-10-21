export type PersonalizationAvailability = 'loading' | 'absent' | 'generating' | 'ready' | 'error';

export interface PersonalizationActionPresentation {
  label: string;
  disabled: boolean;
  action: 'generate' | 'view';
}

export function getPersonalizationActionPresentation(
  availability: PersonalizationAvailability,
): PersonalizationActionPresentation {
  switch (availability) {
    case 'loading':
      return { label: 'Checking outreach…', disabled: true, action: 'view' };
    case 'generating':
      return { label: 'Generating outreach…', disabled: true, action: 'generate' };
    case 'ready':
      return { label: 'View personalised outreach', disabled: false, action: 'view' };
    case 'error':
      return { label: 'Retry outreach generation', disabled: false, action: 'generate' };
    case 'absent':
    default:
      return { label: 'Generate personalised outreach', disabled: false, action: 'generate' };
  }
}
