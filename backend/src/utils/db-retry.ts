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
 * Retries a database operation up to 2 times (3 total attempts) on connection errors
 * with a 400ms delay between retries. Non-connection errors are thrown immediately.
 */
export async function withRetry<T>(
  fn: () => any, // Function that returns a thenable (query builder or promise)
  maxRetries: number = 2
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = fn(); // Get the thenable (query or promise)
      return await result; // Wait for it to resolve/execute
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

      // Wait 400ms before retrying
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  throw lastError;
}

/**
 * Creates a proxy around the database client that automatically retries
 * database operations on transient connection failures.
 *
 * Wraps promises and thenables (like Drizzle query builders) to catch
 * connection errors and retry them.
 */
export function createDbProxy(db: any): any {
  return new Proxy(db, {
    get(target, prop) {
      const value = target[prop];

      // For functions, return a wrapper that handles their results
      if (typeof value === 'function') {
        return function (...args: any[]) {
          const result = value.apply(target, args);
          return wrapThenable(result);
        };
      }

      return value;
    },
  });
}

/**
 * Wraps a thenable (promise or Drizzle query builder) to apply retry logic
 */
function wrapThenable(value: any): any {
  // If not a thenable, return as-is
  if (!value || typeof value.then !== 'function') {
    return value;
  }

  // Create a wrapper promise that applies retry logic
  return new Proxy(value, {
    get(target, prop) {
      // Intercept .then() to apply retry logic
      if (prop === 'then') {
        return function (...args: any[]) {
          // Create a retryable operation that calls the original then
          return withRetry(() => target.then(...args));
        };
      }

      // For other properties/methods, return the original
      const subValue = target[prop];
      if (typeof subValue === 'function') {
        return function (...args: any[]) {
          const result = subValue.apply(target, args);
          return wrapThenable(result);
        };
      }

      return subValue;
    },
  });
}
