import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
    CATEGORY_MARGIN_BENCHMARKS,
    classifyCategoryClient,
    estimateCostPrice,
    getStartOfTodayIST,
    useDashboardStats,
} from '@/hooks/useDashboardStats';

let mockUser: { id: string } | null = { id: 'user-kirana-coldstart' };

jest.mock('@/services/AuthContext', () => ({
    useAuth: () => ({ user: mockUser, isGuest: false }),
}));

let mockEventsData: any[] = [];
let mockInventoryData: any[] = [];
let realtimeCallback: (() => void) | null = null;

const mockChannel: any = {
    on: jest.fn((_event: string, _opts: any, callback: () => void): any => {
        realtimeCallback = callback;
        return mockChannel;
    }),
    subscribe: jest.fn(() => ({
        unsubscribe: jest.fn(),
    })),
};

jest.mock('@/lib/supabase', () => ({
    supabase: {
        from: jest.fn((table: string) => {
            const query: any = {};
            ['select', 'eq', 'in', 'gte', 'is'].forEach((method) => {
                query[method] = jest.fn(() => query);
            });
            query.then = (resolve: any, reject: any) => {
                if (table === 'active_events') {
                    return Promise.resolve({ data: mockEventsData, error: null }).then(resolve, reject);
                }
                if (table === 'inventory' || table === 'staff_inventory') {
                    return Promise.resolve({ data: mockInventoryData, error: null }).then(resolve, reject);
                }
                return Promise.resolve({ data: [], error: null }).then(resolve, reject);
            };
            return query;
        }),
        channel: jest.fn(() => mockChannel),
        removeChannel: jest.fn(),
    },
}));

describe('Cold-Start & Negative Inventory Margins (useDashboardStats)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUser = { id: 'user-kirana-coldstart' };
        mockEventsData = [];
        mockInventoryData = [];
        realtimeCallback = null;
    });

    describe('1. 4-Tier Category Margin Benchmarks', () => {
        it('has accurate trade-standard gross margins for all 4 categories', () => {
            expect(CATEGORY_MARGIN_BENCHMARKS.FMCG).toBe(0.12); // 12% margin -> Cost = 88%
            expect(CATEGORY_MARGIN_BENCHMARKS.STAPLES).toBe(0.06); // 6% margin -> Cost = 94%
            expect(CATEGORY_MARGIN_BENCHMARKS.DAIRY_BAKERY).toBe(0.08); // 8% margin -> Cost = 92%
            expect(CATEGORY_MARGIN_BENCHMARKS.GENERAL).toBe(0.10); // 10% default -> Cost = 90%
        });

        it('estimateCostPrice calculates correct category cost prices', () => {
            // Packaged FMCG: Cost = 88% of selling price
            expect(estimateCostPrice(100, 'FMCG')).toBe(88);
            expect(estimateCostPrice(20, 'FMCG')).toBeCloseTo(17.6, 2);

            // Staples: Cost = 94% of selling price
            expect(estimateCostPrice(100, 'STAPLES')).toBe(94);
            expect(estimateCostPrice(50, 'STAPLES')).toBe(47);

            // Dairy & Bakery: Cost = 92% of selling price
            expect(estimateCostPrice(100, 'DAIRY_BAKERY')).toBe(92);
            expect(estimateCostPrice(40, 'DAIRY_BAKERY')).toBeCloseTo(36.8, 2);

            // General / Unclassified fallback: Cost = 90% of selling price
            expect(estimateCostPrice(100, 'GENERAL')).toBe(90);
            expect(estimateCostPrice(10, 'GENERAL')).toBe(9);

            // Zero selling price yields 0 cost
            expect(estimateCostPrice(0, 'FMCG')).toBe(0);
        });
    });

    describe('2. Client-Side Category Classifier', () => {
        it('classifies Dairy & Bakery items from English and vernacular keywords', () => {
            expect(classifyCategoryClient('Amul Taaza Milk 500ml')).toBe('DAIRY_BAKERY');
            expect(classifyCategoryClient('Harvest Gold White Bread')).toBe('DAIRY_BAKERY');
            expect(classifyCategoryClient('Doodh packet')).toBe('DAIRY_BAKERY');
            expect(classifyCategoryClient('Fresh Dahi 200g')).toBe('DAIRY_BAKERY');
            expect(classifyCategoryClient('Mother Dairy Paneer')).toBe('DAIRY_BAKERY');
            expect(classifyCategoryClient('Amul Butter 100g')).toBe('DAIRY_BAKERY');
            expect(classifyCategoryClient('Pav 6pcs')).toBe('DAIRY_BAKERY');
            expect(classifyCategoryClient('Table Eggs 6pcs')).toBe('DAIRY_BAKERY');
        });

        it('classifies Staples & Loose Commodities from keywords and units', () => {
            expect(classifyCategoryClient('Madhur Pure Sugar')).toBe('STAPLES');
            expect(classifyCategoryClient('Fortune Mustard Oil 1L')).toBe('STAPLES');
            expect(classifyCategoryClient('Aashirvaad Shudh Chakki Atta')).toBe('STAPLES');
            expect(classifyCategoryClient('Basmati Chawal')).toBe('STAPLES');
            expect(classifyCategoryClient('Tata Salt')).toBe('STAPLES');
            expect(classifyCategoryClient('Toor Dal Loose', 'kg')).toBe('STAPLES');
            expect(classifyCategoryClient('Refined Tel', 'l')).toBe('STAPLES');
            expect(classifyCategoryClient('Loose grain', 'kg')).toBe('STAPLES');
        });

        it('classifies Packaged FMCG products and brand anchors', () => {
            expect(classifyCategoryClient('Maggi 2-Minute Masala Noodles')).toBe('FMCG');
            expect(classifyCategoryClient('Parle-G Gold Biscuits')).toBe('FMCG');
            expect(classifyCategoryClient('Britannia Good Day Butter Cookies')).toBe('FMCG');
            expect(classifyCategoryClient('Lays Classic Salted Chips')).toBe('FMCG');
            expect(classifyCategoryClient('Colgate Strong Teeth Toothpaste')).toBe('FMCG');
            expect(classifyCategoryClient('Lifebuoy Total Soap')).toBe('FMCG');
            expect(classifyCategoryClient('Surf Excel Detergent Bar')).toBe('FMCG');
            expect(classifyCategoryClient('Cadbury Dairy Milk Silk')).toBe('FMCG');
        });

        it('falls back to GENERAL for unclassified items', () => {
            expect(classifyCategoryClient('Cello Ball Pen')).toBe('GENERAL');
            expect(classifyCategoryClient('Classmate Notebook')).toBe('GENERAL');
            expect(classifyCategoryClient('Matchbox Pack of 10')).toBe('GENERAL');
        });
    });

    describe('3. Profit Calculation & Fixing 100% Margin Glitch', () => {
        it('fixes the 100% glitch: calculates estimated profit when purchase price is null', async () => {
            // Sold 2 loaves of bread @ ₹40 each before afternoon wholesale delivery bill
            // Total revenue = ₹80.
            // With old bug: cost = 0 => profit = ₹80 (100% fake profit).
            // With fix: Dairy & Bakery 8% margin => cost = 92% of 40 = 36.80.
            // Expected profit = 2 * (40 - 36.80) = 6.40.
            mockEventsData = [
                {
                    payload: {
                        product: 'Harvest Gold Bread',
                        quantity: 2,
                        price: 40,
                    },
                },
            ];
            mockInventoryData = [
                {
                    name: 'Harvest Gold Bread',
                    selling_price: 40,
                    last_purchase_price: null, // Uninvoiced morning delivery
                    category: 'DAIRY_BAKERY',
                },
            ];

            const { result } = renderHook(() => useDashboardStats());

            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(result.current.sales).toBe(80);
            expect(result.current.profit).toBeCloseTo(6.4, 2);
            expect(result.current.profit).not.toBe(80); // 100% fake profit is ELIMINATED!
            expect(result.current.transactionCount).toBe(1);
            expect(result.current.estimatedProfitCount).toBe(1);
        });

        it('correctly applies FMCG 12% benchmark when purchase price is 0', async () => {
            // Sold 5 Maggi packets @ ₹14 each.
            // Total sales = 70.
            // Cost = 14 * 0.88 = 12.32.
            // Profit = 5 * (14 - 12.32) = 5 * 1.68 = 8.40 (12% margin).
            mockEventsData = [
                {
                    payload: {
                        product: 'Maggi Noodles',
                        quantity: 5,
                        price: 14,
                    },
                },
            ];
            mockInventoryData = [
                {
                    name: 'Maggi Noodles',
                    selling_price: 14,
                    last_purchase_price: 0, // 0 treated as missing cost
                    category: 'FMCG',
                },
            ];

            const { result } = renderHook(() => useDashboardStats());

            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(result.current.sales).toBe(70);
            expect(result.current.profit).toBeCloseTo(8.4, 2);
            expect(result.current.estimatedProfitCount).toBe(1);
        });

        it('correctly applies Staples 6% benchmark when item is unstocked (cold-start)', async () => {
            // Sold 10 kg Sugar @ ₹44/kg with no prior inventory record
            // Total sales = 440.
            // Inferred category: STAPLES -> 6% margin -> Cost = 44 * 0.94 = 41.36.
            // Profit = 10 * (44 - 41.36) = 10 * 2.64 = 26.40.
            mockEventsData = [
                {
                    payload: {
                        product: 'Madhur Sugar',
                        quantity: 10,
                        price: 44,
                        unit: 'kg',
                    },
                },
            ];
            mockInventoryData = []; // Item not in catalog yet

            const { result } = renderHook(() => useDashboardStats());

            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(result.current.sales).toBe(440);
            expect(result.current.profit).toBeCloseTo(26.4, 2);
            expect(result.current.estimatedProfitCount).toBe(1);
        });

        it('uses exact wholesale cost when last_purchase_price is known and positive', async () => {
            // Sold 2 loaves of bread @ ₹40 with known wholesale cost of ₹35
            // Expected profit = 2 * (40 - 35) = 10.00 exact!
            mockEventsData = [
                {
                    payload: {
                        product: 'Harvest Gold Bread',
                        quantity: 2,
                        price: 40,
                    },
                },
            ];
            mockInventoryData = [
                {
                    name: 'Harvest Gold Bread',
                    selling_price: 40,
                    last_purchase_price: 35,
                    category: 'DAIRY_BAKERY',
                },
            ];

            const { result } = renderHook(() => useDashboardStats());

            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(result.current.sales).toBe(80);
            expect(result.current.profit).toBe(10);
            expect(result.current.estimatedProfitCount).toBe(0); // Not estimated!
        });

        it('converges from estimated to exact profit upon afternoon wholesale restocking', async () => {
            // Step 1: Morning sale - uninvoiced
            mockEventsData = [
                {
                    payload: {
                        product: 'Amul Milk',
                        quantity: 5,
                        price: 27,
                    },
                },
            ];
            mockInventoryData = [
                {
                    name: 'Amul Milk',
                    selling_price: 27,
                    last_purchase_price: null,
                    category: 'DAIRY_BAKERY',
                },
            ];

            const { result } = renderHook(() => useDashboardStats());

            await waitFor(() => expect(result.current.loading).toBe(false));

            // Morning: Estimated profit at 8% margin: 5 * (27 - 24.84) = 10.80
            expect(result.current.sales).toBe(135);
            expect(result.current.profit).toBeCloseTo(10.8, 2);
            expect(result.current.estimatedProfitCount).toBe(1);

            // Step 2: Afternoon purchase invoice logged @ ₹25 wholesale cost
            mockInventoryData = [
                {
                    name: 'Amul Milk',
                    selling_price: 27,
                    last_purchase_price: 25,
                    category: 'DAIRY_BAKERY',
                },
            ];

            // Trigger realtime re-fetch
            await act(async () => {
                realtimeCallback?.();
            });

            await waitFor(() => expect(result.current.profit).toBe(10));

            // Afternoon: Exact profit converged to 5 * (27 - 25) = 10.00
            expect(result.current.sales).toBe(135);
            expect(result.current.profit).toBe(10);
            expect(result.current.estimatedProfitCount).toBe(0);
        });

        it('returns zero sales and profit when selling price is missing or zero', async () => {
            mockEventsData = [
                {
                    payload: {
                        product: 'Mystery Unpriced Item',
                        quantity: 2,
                    },
                },
            ];
            mockInventoryData = [
                {
                    name: 'Mystery Unpriced Item',
                    selling_price: null,
                    last_purchase_price: null,
                },
            ];

            const { result } = renderHook(() => useDashboardStats());

            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(result.current.sales).toBe(0);
            expect(result.current.profit).toBe(0);
            expect(result.current.transactionCount).toBe(1);
        });

        it('returns empty stats when no user is logged in', async () => {
            mockUser = null;

            const { result } = renderHook(() => useDashboardStats());

            expect(result.current.sales).toBe(0);
            expect(result.current.profit).toBe(0);
            expect(result.current.transactionCount).toBe(0);
            expect(result.current.estimatedProfitCount).toBe(0);
        });
    });

    describe('4. Financial Accuracy, Value-Based Sales, Returns & Expenses', () => {
        it('calculates IST midnight correctly without UTC day lag', () => {
            const istDate = getStartOfTodayIST();
            expect(istDate).toBeInstanceOf(Date);
            // IST is UTC+5:30 -> ISO string time should end in 18:30:00.000Z of previous day
            const iso = istDate.toISOString();
            expect(iso.endsWith('18:30:00.000Z')).toBe(true);
        });

        it('correctly calculates revenue and profit for value-based loose sales', async () => {
            // "₹20 ki cheeni": amount_spent = 20, calculated_quantity = 0.5 kg, selling_price = 40, cost = 36
            mockEventsData = [
                {
                    type: 'SOLD',
                    payload: {
                        product: 'Sugar',
                        amount_spent: 20,
                        calculated_quantity: 0.5,
                        price: 40,
                        unit: 'kg',
                        is_value_based: true,
                    },
                },
            ];
            mockInventoryData = [
                {
                    name: 'Sugar',
                    selling_price: 40,
                    last_purchase_price: 36,
                    category: 'STAPLES',
                },
            ];

            const { result } = renderHook(() => useDashboardStats());

            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(result.current.sales).toBe(20);
            // Cost = 0.5 * 36 = 18. Profit = 20 - 18 = 2
            expect(result.current.profit).toBe(2);
            expect(result.current.transactionCount).toBe(1);
        });

        it('deducts customer returns from daily sales and profit', async () => {
            // Sale of 2 items @ ₹50 (cost ₹40) -> sales +100, profit +20
            // Return of 1 item @ ₹50 (cost ₹40) -> sales -50, profit -10
            mockEventsData = [
                {
                    type: 'SOLD',
                    payload: {
                        product: 'Refined Oil',
                        quantity: 2,
                        price: 50,
                    },
                },
                {
                    type: 'CUSTOMER_RETURN',
                    payload: {
                        product: 'Refined Oil',
                        quantity: 1,
                        price: 50,
                    },
                },
            ];
            mockInventoryData = [
                {
                    name: 'Refined Oil',
                    selling_price: 50,
                    last_purchase_price: 40,
                    category: 'STAPLES',
                },
            ];

            const { result } = renderHook(() => useDashboardStats());

            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(result.current.sales).toBe(50);
            expect(result.current.profit).toBe(10);
            expect(result.current.transactionCount).toBe(1);
        });

        it('deducts operational expenses from net daily profit', async () => {
            // Sale of ₹100 with ₹20 profit
            // Shop expense: ₹15 for packaging material
            mockEventsData = [
                {
                    type: 'SOLD',
                    payload: {
                        product: 'Good Day',
                        quantity: 5,
                        price: 20,
                    },
                },
                {
                    type: 'EXPENSE',
                    payload: {
                        amount: 15,
                        description: 'Packaging bags',
                    },
                },
            ];
            mockInventoryData = [
                {
                    name: 'Good Day',
                    selling_price: 20,
                    last_purchase_price: 16,
                    category: 'FMCG',
                },
            ];

            const { result } = renderHook(() => useDashboardStats());

            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(result.current.sales).toBe(100);
            // Gross profit = 5 * (20 - 16) = 20. Net profit after ₹15 expense = 5.
            expect(result.current.profit).toBe(5);
        });

        it('safely guards against unnormalized wholesale sack purchase anomalies', async () => {
            // An unnormalized purchase bill recorded ₹2,100 sack price directly on last_purchase_price
            // Retail selling price is ₹44/kg. Without anomaly guard, profit would be 1 * (44 - 2100) = -2056!
            // With anomaly guard (costPrice > sellPrice * 2.5), it caps cost to category benchmark (STAPLES 6% margin -> cost 41.36)
            mockEventsData = [
                {
                    type: 'SOLD',
                    payload: {
                        product: 'Sugar',
                        quantity: 1,
                        price: 44,
                        unit: 'kg',
                    },
                },
            ];
            mockInventoryData = [
                {
                    name: 'Sugar',
                    selling_price: 44,
                    last_purchase_price: 2100, // Sack price anomaly!
                    category: 'STAPLES',
                },
            ];

            const { result } = renderHook(() => useDashboardStats());

            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(result.current.sales).toBe(44);
            expect(result.current.profit).toBeCloseTo(2.64, 2);
            expect(result.current.estimatedProfitCount).toBe(1);
        });
    });
});
