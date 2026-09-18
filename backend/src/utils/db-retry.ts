/**
 * Detects if an error is a connection-related error that should be retried
 */
export function isConnectionError(error: any): boolean {
  if (!error) return false;

  // Check error codes
  const code = error.code || error.errno;
  const connectionErrorCodes = ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND'];
  if (connectionErrorCodes.includes(code)) {
    return true;
  }

  // Check error message for connection-related keywords
  const message = (error.message || '').toLowerCase();
  const connectionErrorPatterns = [
    'connection terminated',
    'connection closed',
    'connection refused',
    'connection reset',
    'terminating connection',
    'server closed the connection',
    'connect econnrefused',
    'socket hang up',
    'econnreset',
    'timeout',
    'timed out',
  ];

  return connectionErrorPatterns.some((pattern) => message.includes(pattern));
}

/**
 * Retries a database operation up to `maxRetries` times (total of maxRetries + 1 attempts) on connection errors.
 * Non-connection errors are thrown immediately. Only retries idempotent operations (SELECT queries).
 *
 * @param fn - Function that returns a thenable (query or promise)
 * @param maxRetries - Max number of retries (default 2, total of 3 attempts)
 * @param delayMs - Delay between retries in milliseconds (default 400ms)
 * @returns Result of the operation
 */
export async function withRetry<T>(
  fn: () => any,
  maxRetries: number = 2,
  delayMs: number = 400
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = fn();
      return await result;
    } catch (error) {
      lastError = error;

      // Only retry on connection errors
      if (!isConnectionError(error)) {
        throw error;
      }

      // Don't retry after the last attempt
      if (attempt === maxRetries) {
        throw error;
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
