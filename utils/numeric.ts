const NUMERIC_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** Parses a form field into a finite decimal number; blank/invalid → null. */
export function parseOptionalNumber(raw: string): number | null {
    const trimmed = raw.trim();
    if (!trimmed || !NUMERIC_PATTERN.test(trimmed)) return null;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : null;
}

/** Non-negative finite number or null (blank/invalid → null). */
export function parseNonNegativeNumber(raw: string): number | null {
    const value = parseOptionalNumber(raw);
    return value != null && value >= 0 ? value : null;
}

/** Positive finite number or null (blank/invalid/<=0 → null). */
export function parsePositiveNumber(raw: string): number | null {
    const value = parseOptionalNumber(raw);
    return value != null && value > 0 ? value : null;
}
