const NUMERIC_STRING = /^\s*\d+(?:\.\d+)?\s*$/;

/**
 * Parses a user/model supplied quantity.
 * Accepts only finite numbers strictly greater than zero or numeric strings.
 */
export function parsePositiveQuantity(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value > 0 ? value : null;
    }

    if (typeof value === 'string') {
        if (!NUMERIC_STRING.test(value)) return null;

        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    return null;
}

/**
 * Parses a total transaction amount (e.g. "300 rupaye ka").
 * Accepts only finite numbers greater than or equal to zero or numeric strings.
 * Zero is valid so unpriced transactions can be stored explicitly.
 */
export function parseNonNegativeAmount(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value >= 0 ? value : null;
    }

    if (typeof value === 'string') {
        if (!NUMERIC_STRING.test(value)) return null;

        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    }

    return null;
}
