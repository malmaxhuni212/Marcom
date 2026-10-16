import { SearchProviderError } from '@/marcom/search/errors';

export interface SafeResearchFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export class PermanentResearchError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PermanentResearchError';
  }
}

export function toSafeResearchFailure(error: unknown): SafeResearchFailure {
  if (error instanceof PermanentResearchError) {
    return { code: error.code, message: error.message, retryable: false };
  }
  if (error instanceof SearchProviderError) {
    switch (error.code) {
      case 'authentication_failed':
        return {
          code: 'SEARCH_PROVIDER_AUTHENTICATION_FAILED',
          message: 'The search provider rejected its configured credentials. An administrator must verify the deployment settings.',
          retryable: false,
        };
      case 'payment_required':
        return {
          code: 'SEARCH_PROVIDER_CREDIT_REQUIRED',
          message: 'The search provider has no available credit for this request.',
          retryable: false,
        };
      case 'rate_limited':
        return {
          code: 'SEARCH_PROVIDER_RATE_LIMITED',
          message: 'The search provider is temporarily rate limited. Please try again shortly.',
          retryable: true,
        };
      case 'timeout':
        return {
          code: 'SEARCH_PROVIDER_TIMEOUT',
          message: 'The search provider did not respond before the deadline. Please try again.',
          retryable: true,
        };
      case 'unavailable':
        return {
          code: 'SEARCH_PROVIDER_UNAVAILABLE',
          message: 'The search provider is temporarily unavailable. Please try again.',
          retryable: true,
        };
      case 'invalid_response':
        return {
          code: 'SEARCH_PROVIDER_INVALID_RESPONSE',
          message: 'The search provider returned an unusable response. Please try again.',
          retryable: true,
        };
      case 'configuration_error':
        return {
          code: 'SEARCH_PROVIDER_CONFIGURATION_ERROR',
          message: 'The search provider is not configured correctly.',
          retryable: false,
        };
      case 'invalid_request':
        return {
          code: 'SEARCH_PROVIDER_REJECTED_REQUEST',
          message: 'The configured search provider rejected this research request.',
          retryable: false,
        };
    }
  }

  return {
    code: 'RESEARCH_OPERATION_FAILED',
    message: 'Research could not continue. Please try again. If the problem repeats, ask an administrator to check the server logs.',
    retryable: true,
  };
}

export function safeResearchLog(event: string, error: unknown): void {
  const failure = toSafeResearchFailure(error);
  const original = error as { name?: unknown; code?: unknown; cause?: { name?: unknown; code?: unknown } };
  console.error(JSON.stringify({
    event,
    errorCode: failure.code,
    errorName: typeof original?.name === 'string' ? original.name : 'UnknownError',
    driverCode: typeof original?.code === 'string' ? original.code : undefined,
    causeName: typeof original?.cause?.name === 'string' ? original.cause.name : undefined,
    causeCode: typeof original?.cause?.code === 'string' ? original.cause.code : undefined,
    retryable: failure.retryable,
  }));
}
