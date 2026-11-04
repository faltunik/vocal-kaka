/**
 * Strict Role Privacy policy for voice profit queries (Constitution §8).
 * Kept dependency-free so unit tests can import it without Deno modules.
 */

export const STAFF_PROFIT_BLOCKED_MESSAGE =
    'Profit details are locked. Only store owners can view profit metrics.';

export function isProfitRestrictedForRole(role?: string | null): boolean {
    return role === 'staff';
}
