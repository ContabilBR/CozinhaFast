/**
 * Detects if an error is a connection-related error that should be retried.
 * Checks both the error message and code, including nested cause objects.
 */
export function isConnectionError(err: any): boolean {
  if (!err) return false;

  const errorPatterns = [
    'ECONNRESET',
    'ECONNREFUSED',
    'ENOTFOUND',
    'connection terminated',
    'connection closed',
    'connection refused',
    'connection reset',
    'terminating connection',
    'server closed the connection',
    'socket hang up',
    'connect econnrefused',
    'econnreset',
    'timed out',
    'timeout',
  ];

  const checkString = (str: string | undefined) => {
    if (!str) return false;
    const lower = str.toLowerCase();
    return errorPatterns.some(p => lower.includes(p.toLowerCase()));
  };

  // Check message and code
  if (checkString(err.message) || checkString(err.code)) {
    return true;
  }

  // Check nested cause (from Drizzle or other wrappers)
  if (err.cause) {
    if (checkString(err.cause.message) || checkString(err.cause.code)) {
      return true;
    }
  }

  return false;
}

/**
 * Retries a database operation up to `maxRetries` times on connection errors.
 * Non-connection errors are thrown immediately.
 *
 * @param fn - Function that returns a promise
 * @param maxRetries - Max number of retries (default 2, total of 3 attempts)
 * @param delayMs - Delay between retries in milliseconds (default 400ms)
 * @returns Result of the operation
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 2,
  delayMs: number = 400
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
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
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

/**
 * Wraps a Drizzle SELECT query builder with automatic retry logic on connection errors.
 * Transparently adds retry behavior to query chains without breaking promise integration.
 *
 * @param queryBuilder - The initial Drizzle query builder from db.select()
 * @param recreateQuery - Function that returns a fresh db.select() with the same table
 * @param methodChain - The chain of methods to replay (for recursive wrapping)
 * @returns A proxy that transparently adds retry behavior to the query chain
 */
export function wrapSelectWithRetry(
  queryBuilder: any,
  recreateQuery: () => any,
  methodChain: Array<{ method: string; args: any[] }> = []
): any {
  return new Proxy(queryBuilder, {
    get(target, prop: string | symbol) {
      const value = target[prop];

      // Handle promise-like methods that trigger query execution
      const promiseMethods = ['then', 'catch', 'finally'];
      if (promiseMethods.includes(prop as string)) {
        return function (...promiseArgs: any[]) {
          // Create a function that rebuilds and executes the query fresh on each attempt
          const executeQuery = () => {
            // Start with a fresh select call
            let qb = recreateQuery();

            // Replay the entire method chain on the fresh builder
            for (const { method, args: methodArgs } of methodChain) {
              qb = qb[method](...methodArgs);
            }

            return qb;
          };

          // Execute with retry logic
          const retryablePromise = withRetry(executeQuery);

          // Delegate the promise method to the retried result
          return retryablePromise[prop](...promiseArgs);
        };
      }

      // Handle query builder methods - record and continue chain
      if (typeof value === 'function' && prop !== Symbol.toStringTag) {
        return function (...methodArgs: any[]) {
          // Record this method call for replay on retry
          const newChain = [...methodChain, { method: prop as string, args: methodArgs }];

          // Execute the method on the current builder to continue building
          const nextBuilder = value.apply(target, methodArgs);

          // Return a wrapped proxy with the updated chain
          return wrapSelectWithRetry(nextBuilder, recreateQuery, newChain);
        };
      }

      return value;
    },
  });
}

/**
 * Applies automatic retry logic to all SELECT queries on a database instance.
 * Wraps the db.select() method so every query chain automatically retries on connection errors
 * without requiring changes to individual query call sites.
 *
 * @param db - The Drizzle database instance (app.db)
 * @param maxRetries - Max number of retries (default 2)
 * @param delayMs - Delay between retries in milliseconds (default 400ms)
 */
export function enableSelectRetry(
  db: any,
  maxRetries: number = 2,
  delayMs: number = 400
): void {
  const originalSelect = db.select.bind(db);

  db.select = function (...args: any[]) {
    const queryBuilder = originalSelect(...args);

    // Return a wrapped query builder that will retry on connection errors
    return wrapSelectWithRetry(queryBuilder, () => originalSelect(...args), []);
  };
}
