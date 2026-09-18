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

  // Check nested cause
  if (err.cause) {
    if (checkString(err.cause.message) || checkString(err.cause.code)) {
      return true;
    }
  }

  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = 2,
  delayMs: number = 400
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Only retry on connection errors
      if (!isConnectionError(error)) {
        throw error;
      }

      // Don't retry on the last attempt
      if (attempt === retries) {
        throw error;
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
