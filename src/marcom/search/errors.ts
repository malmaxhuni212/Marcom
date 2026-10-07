export class SearchError extends Error {
  constructor(
    public code: 'auth_failed' | 'rate_limited' | 'quota_exceeded' | 'timeout' | 'invalid_response' | 'unavailable' | 'configuration_error',
    message: string,
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'SearchError';
  }
}
