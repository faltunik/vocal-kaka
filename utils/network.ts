/** Shared transport-error classification for offline retry decisions. */

export function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && 'message' in error) {
        const message = (error as { message?: unknown }).message;
        if (typeof message === 'string') return message;
    }
    return String(error);
}

/**
 * True for transport-level failures (offline, DNS, timeout, aborted) that are
 * safe and necessary to retry. Server/validation rejections are NOT network
 * errors and must not be retried forever. "connection" is matched only in
 * specific transport phrases so permanent DB errors are not misclassified.
 */
export function isNetworkError(error: unknown): boolean {
    const message = errorMessage(error).toLowerCase();
    return message.includes('network request failed')
        || message.includes('fetch failed')
        || message.includes('failed to fetch')
        || message.includes('aborted')
        || message.includes('timeout')
        || message.includes('timed out')
        || message.includes('connection refused')
        || message.includes('connection reset')
        || message.includes('connection lost')
        || message.includes('connection closed')
        || message.includes('connection terminated')
        || message.includes('connection error');
}
