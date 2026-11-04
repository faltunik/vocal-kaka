import fs from 'fs';
import path from 'path';
import {
    STAFF_PROFIT_BLOCKED_MESSAGE,
    isProfitRestrictedForRole,
} from '@/supabase/functions/_shared/profitPrivacy';

describe('profit privacy policy (TASK-07)', () => {
    it('restricts only the staff role', () => {
        expect(isProfitRestrictedForRole('staff')).toBe(true);
        expect(isProfitRestrictedForRole('owner')).toBe(false);
        expect(isProfitRestrictedForRole('admin')).toBe(false);
        expect(isProfitRestrictedForRole(null)).toBe(false);
        expect(isProfitRestrictedForRole(undefined)).toBe(false);
    });

    it('returns a locked message instead of profit data', () => {
        expect(STAFF_PROFIT_BLOCKED_MESSAGE).toMatch(/locked/i);
        expect(STAFF_PROFIT_BLOCKED_MESSAGE).toMatch(/owners/i);
    });

    it('is enforced by buildAnswers before any ledger read', () => {
        const source = fs.readFileSync(
            path.resolve(__dirname, '../../supabase/functions/_shared/answers.ts'),
            'utf8'
        );

        expect(source).toContain('isProfitRestrictedForRole(scope.role)');
        expect(source).toContain('STAFF_PROFIT_BLOCKED_MESSAGE');
    });
});
