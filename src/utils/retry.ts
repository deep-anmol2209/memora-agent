export interface RetryOptions {
    /** Number of retries after the initial attempt. Default 2 (3 attempts total). */
    retries?: number;
    minDelayMs?: number;
    maxDelayMs?: number;
    isRetryable?: (error: unknown) => boolean;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function defaultIsRetryable(error: unknown): boolean {
    const status =
        (error as { status?: number }).status ??
        (error as { statusCode?: number }).statusCode;

    if (typeof status === "number") {
        // Rate limited or server-side failure — safe to retry.
        return status === 429 || status >= 500;
    }

    // Network-level failures (fetch throws TypeError on connection issues).
    if (error instanceof TypeError) {
        return true;
    }

    return false;
}

/**
 * Runs `fn` with exponential backoff + jitter on retryable failures.
 * Non-retryable errors (bad request, auth failure, validation errors, etc.)
 * are rethrown immediately.
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const {
        retries = 2,
        minDelayMs = 300,
        maxDelayMs = 4000,
        isRetryable = defaultIsRetryable
    } = options;

    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            if (attempt === retries || !isRetryable(error)) {
                throw error;
            }

            const backoff = Math.min(maxDelayMs, minDelayMs * 2 ** attempt);
            const jittered = backoff * (0.75 + Math.random() * 0.5);

            await sleep(jittered);
        }
    }

    throw lastError;
}