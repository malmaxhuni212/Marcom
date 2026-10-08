export type SearchErrorCode =
  | 'authentication_failed'
  | 'configuration_error'
  | 'invalid_request'
  | 'invalid_response'
  | 'payment_required'
  | 'rate_limited'
  | 'timeout'
  | 'unavailable';

export class SearchProviderError extends Error {
  constructor(
    public readonly code: SearchErrorCode,
    message: string,
    public readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SearchProviderError';
  }
}
