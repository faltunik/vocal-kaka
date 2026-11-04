/**
 * Extracts a user-safe message from an unknown thrown value without resorting
 * to `any`. Falls back when the value carries no usable message.
 */
export function getErrorMessage(error: unknown, fallback = 'An unexpected error occurred.'): string {
    if (error instanceof Error && error.message.trim()) {
        return error.message;
    }
    if (typeof error === 'string' && error.trim()) {
        return error;
    }
    if (error && typeof error === 'object' && 'message' in error) {
        const message = (error as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim()) {
            return message;
        }
    }
    return fallback;
}
