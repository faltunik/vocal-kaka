import {
    executeActions,
    executeActionsSync,
    toEventInserts,
    round,
    findCommodityBenchmark,
    DEFAULT_COMMODITY_REGISTRY,
    ParsedAction,
    InventoryPriceRecord,
} from '@/supabase/functions/_shared/actions';
import { SupabaseInventoryRepository } from '@/data/repositories/SupabaseInventoryRepository';
import { supabase } from '@/lib/supabase';

describe('ValueBasedSales Engine ("Rupee-First" Loose Sales)', () => {
    describe('round helper & decimal precision', () => {
        it('rounds mass (kg) and volume (l) to exactly 3 decimal places', () => {
            // Sugar: 20 / 44 = 0.45454545... -> 0.455 kg
            expect(round(20 / 44, 3)).toBe(0.455);

            // Jeera: 10 / 400 = 0.025 kg
            expect(round(10 / 400, 3)).toBe(0.025);

            // Mustard Oil: 50 / 140 = 0.35714285... -> 0.357 L
            expect(round(50 / 140, 3)).toBe(0.357);

            // Fresh Paneer: 150 / 360 = 0.41666666... -> 0.417 kg
            expect(round(150 / 360, 3)).toBe(0.417);

            // Toor Dal benchmark: 30 / 160 = 0.1875 -> 0.188 kg
            expect(round(30 / 160, 3)).toBe(0.188);
        });

        it('handles exact division without floating point artifacts', () => {
            expect(round(50 / 100, 3)).toBe(0.5);
            expect(round(100 / 50, 3)).toBe(2);
            expect(round(10 / 40, 3)).toBe(0.25);
        });
    });

    describe('Commodity Benchmark Registry Lookup', () => {
        it('resolves standard commodities by canonical name', () => {
            const sugar = findCommodityBenchmark('Sugar');
            expect(sugar).not.toBeNull();
            expect(sugar?.benchmarkPrice).toBe(44.00);
            expect(sugar?.baseUnit).toBe('kg');

            const cumin = findCommodityBenchmark('Cumin');
            expect(cumin?.benchmarkPrice).toBe(420.00);

            const oil = findCommodityBenchmark('Mustard Oil');
            expect(oil?.benchmarkPrice).toBe(145.00);
            expect(oil?.baseUnit).toBe('l');
        });

        it('resolves commodities by vernacular Hinglish aliases', () => {
            expect(findCommodityBenchmark('cheeni')?.commodityKey).toBe('sugar');
            expect(findCommodityBenchmark('jeera')?.commodityKey).toBe('cumin');
            expect(findCommodityBenchmark('sarson tel')?.commodityKey).toBe('mustard_oil');
            expect(findCommodityBenchmark('kaju')?.commodityKey).toBe('cashew');
            expect(findCommodityBenchmark('aata')?.commodityKey).toBe('wheat_flour');
            expect(findCommodityBenchmark('aloo')?.commodityKey).toBe('potato');
        });

        it('returns null for unknown items', () => {
            expect(findCommodityBenchmark('unknown_masala_xyz')).toBeNull();
        });
    });

    describe('Fallback Pricing Cascade (4 Tiers)', () => {
        // TIER 1: Selling Price from DB
        describe('Tier 1: inventory.selling_price', () => {
            it('uses existing selling price when available (Sugar @ ₹44/kg for ₹20)', async () => {
                const actions: ParsedAction[] = [
                    { intent: 'SALE', item: 'Sugar', amount: 20, quantity: null },
                ];

                const db: Record<string, InventoryPriceRecord> = {
                    Sugar: { selling_price: 44.00, last_purchase_price: 38.00, base_unit: 'kg' },
                };

                const result = await executeActions(actions, { inventory: db });

                expect(result.events).toHaveLength(1);
                const event = result.events[0];
                expect(event.type).toBe('SOLD');
                expect(event.payload).toMatchObject({
                    product: 'Sugar',
                    quantity: 0.455,
                    unit: 'kg',
                    amount: 20,
                    amount_spent: 20,
                    is_value_based: true,
                    unit_price_used: 44.00,
                    price_source: 'inventory_selling_price',
                    pricing_unresolved: false,
                    needs_weight_review: false,
                });
            });

            it('uses store custom selling price (Cumin @ ₹400/kg for ₹10)', async () => {
                const actions: ParsedAction[] = [
                    { intent: 'SALE', item: 'Cumin', amount: 10, quantity: null },
                ];

                const db: Record<string, InventoryPriceRecord> = {
                    Cumin: { selling_price: 400.00, base_unit: 'kg' },
                };

                const result = await executeActions(actions, db);

                expect(result.events).toHaveLength(1);
                expect(result.events[0].payload).toMatchObject({
                    product: 'Cumin',
                    quantity: 0.025,
                    unit: 'kg',
                    amount_spent: 10,
                    unit_price_used: 400.00,
                    price_source: 'inventory_selling_price',
                });
            });
        });

        // TIER 2: category benchmark markup on last purchase cost
        describe('Tier 2: purchase_price_markup (category margin)', () => {
            it('uses the STAPLES margin (6%) for staples cost prices', async () => {
                const actions: ParsedAction[] = [
                    { intent: 'SALE', item: 'Toor Dal', amount: 56, quantity: null },
                ];

                // Cost 100 + 6% STAPLES margin = 106; 56 / 106 = 0.528 kg
                const db: Record<string, InventoryPriceRecord> = {
                    'Toor Dal': {
                        selling_price: null,
                        last_purchase_price: 100.00,
                        base_unit: 'kg',
                        category: 'STAPLES',
                    },
                };

                const result = await executeActions(actions, { inventory: db });

                expect(result.events).toHaveLength(1);
                expect(result.events[0].payload).toMatchObject({
                    product: 'Toor Dal',
                    quantity: 0.528,
                    unit: 'kg',
                    amount_spent: 56,
                    is_value_based: true,
                    unit_price_used: 106.00,
                    price_source: 'purchase_price_markup',
                    pricing_unresolved: false,
                    needs_weight_review: false,
                });
            });

            it('uses the FMCG margin (12%) when the catalog says so', async () => {
                const actions: ParsedAction[] = [
                    { intent: 'SALE', item: 'Colgate Total', amount: 56, quantity: null },
                ];

                // Cost 100 + 12% FMCG margin = 112; 56 / 112 = 0.5
                const db: Record<string, InventoryPriceRecord> = {
                    'Colgate Total': {
                        selling_price: null,
                        last_purchase_price: 100.00,
                        base_unit: 'pcs',
                        category: 'FMCG',
                    },
                };

                const result = await executeActions(actions, { inventory: db });

                expect(result.events[0].payload).toMatchObject({
                    quantity: 0.5,
                    unit: 'pcs',
                    unit_price_used: 112.00,
                    price_source: 'purchase_price_markup',
                });
            });
        });

        // TIER 3: Benchmark Reference Registry (Cold-Start Stores)
        describe('Tier 3: commodity_reference benchmark registry', () => {
            it('uses benchmark rate when item is unpriced in inventory (Sugar: ₹44/kg)', async () => {
                const actions: ParsedAction[] = [
                    { intent: 'SALE', item: 'Sugar', amount: 20, quantity: null },
                ];

                // Item exists but has no prices configured
                const db: Record<string, InventoryPriceRecord> = {
                    Sugar: { selling_price: null, last_purchase_price: null, base_unit: 'kg' },
                };

                const result = await executeActions(actions, { inventory: db });

                expect(result.events).toHaveLength(1);
                expect(result.events[0].payload).toMatchObject({
                    product: 'Sugar',
                    quantity: 0.455,
                    unit: 'kg',
                    amount_spent: 20,
                    is_value_based: true,
                    unit_price_used: 44.00,
                    price_source: 'commodity_reference',
                    pricing_unresolved: false,
                    needs_weight_review: false,
                });
            });

            it('uses benchmark rate when item does not exist in inventory at all', async () => {
                const actions: ParsedAction[] = [
                    { intent: 'SALE', item: 'Paneer', amount: 150, quantity: null },
                ];

                // Empty inventory DB (cold start)
                const result = await executeActions(actions, {});

                expect(result.events).toHaveLength(1);
                // Paneer benchmark: 360/kg. 150 / 360 = 0.41666... -> 0.417 kg
                expect(result.events[0].payload).toMatchObject({
                    product: 'Paneer',
                    quantity: 0.417,
                    unit: 'kg',
                    amount_spent: 150,
                    is_value_based: true,
                    unit_price_used: 360.00,
                    price_source: 'commodity_reference',
                    pricing_unresolved: false,
                });
            });

            it('resolves alias names against commodity registry (jeera -> Cumin benchmark)', async () => {
                const actions: ParsedAction[] = [
                    { intent: 'SALE', item: 'jeera', amount: 42, quantity: null },
                ];

                const result = await executeActions(actions, {});

                expect(result.events).toHaveLength(1);
                // Cumin benchmark: 420/kg. 42 / 420 = 0.1 kg
                expect(result.events[0].payload).toMatchObject({
                    product: 'jeera',
                    quantity: 0.1,
                    unit: 'kg',
                    amount_spent: 42,
                    is_value_based: true,
                    unit_price_used: 420.00,
                    price_source: 'commodity_reference',
                });
            });
        });

        // TIER 4: Graceful Financial-Only Safety Net
        describe('Tier 4: unresolved safety net', () => {
            it('records transaction with quantity: 0 and needs_weight_review: true when rate cannot be resolved', async () => {
                const actions: ParsedAction[] = [
                    { intent: 'SALE', item: 'Anjaan Masala', amount: 25, quantity: null },
                ];

                const result = await executeActions(actions, {});

                expect(result.events).toHaveLength(1);
                const event = result.events[0];
                expect(event.type).toBe('SOLD');
                // Crucial: Transaction is NOT dropped! Revenue is recorded, stock delta is 0
                expect(event.payload).toMatchObject({
                    product: 'Anjaan Masala',
                    quantity: 0,
                    amount: 25,
                    amount_spent: 25,
                    is_value_based: true,
                    unit_price_used: null,
                    price_source: 'unresolved',
                    pricing_unresolved: true,
                    needs_weight_review: true,
                });
            });
        });
    });

    describe('Disambiguation: Packaged FMCG vs Loose Value Sales', () => {
        it('treats price-point packaged FMCG variants as count sales (not value sales)', async () => {
            // "10 waala Kurkure 2 packet" -> count: 2, amount: 20
            const actions: ParsedAction[] = [
                { intent: 'SALE', item: 'Kurkure 10', quantity: 2, unit: 'packet', amount: 20 },
            ];

            const result = await executeActions(actions);

            expect(result.events).toHaveLength(1);
            const event = result.events[0];
            expect(event.payload).toMatchObject({
                product: 'Kurkure 10',
                quantity: 2,
                unit: 'packet',
                amount: 20,
            });
            expect(event.payload.is_value_based).toBeUndefined();
        });

        it('drops SALE only if BOTH quantity and amount are null', async () => {
            const actions: ParsedAction[] = [
                { intent: 'SALE', item: 'Sugar', quantity: null, amount: null },
            ];

            const result = await executeActions(actions);
            expect(result.events).toHaveLength(0);
        });
    });

    describe('Async DB lookup simulation & executeActionsSync / toEventInserts', () => {
        it('works with async DB lookup functions', async () => {
            const asyncLookup = jest.fn().mockImplementation(async (itemName: string) => {
                if (itemName.toLowerCase() === 'mustard oil') {
                    return { selling_price: 140.00, base_unit: 'l' };
                }
                return null;
            });

            const actions: ParsedAction[] = [
                { intent: 'SALE', item: 'Mustard Oil', amount: 50, quantity: null },
            ];

            const result = await executeActions(actions, { inventory: asyncLookup });

            expect(asyncLookup).toHaveBeenCalledWith('Mustard Oil');
            expect(result.events).toHaveLength(1);
            expect(result.events[0].payload).toMatchObject({
                product: 'Mustard Oil',
                quantity: 0.357,
                unit: 'l',
                amount_spent: 50,
                unit_price_used: 140.00,
                is_value_based: true,
            });
        });

        it('toEventInserts backwards compatibility executes synchronously', () => {
            const actions: ParsedAction[] = [
                { intent: 'SALE', item: 'Sugar', amount: 20, quantity: null },
            ];

            const result = toEventInserts(actions, undefined, {
                Sugar: { selling_price: 44.00, base_unit: 'kg' },
            });

            expect(result.events).toHaveLength(1);
            expect(result.events[0].payload).toMatchObject({
                product: 'Sugar',
                quantity: 0.455,
                amount_spent: 20,
                is_value_based: true,
                unit_price_used: 44.00,
            });
        });

        it('toEventInserts uses the store price map instead of the static benchmark', () => {
            const actions: ParsedAction[] = [
                { intent: 'SALE', item: 'Sugar', amount: 20, quantity: null },
            ];

            // Store sells sugar at ₹50/kg, benchmark is ₹44/kg
            const result = toEventInserts(actions, undefined, {
                Sugar: { selling_price: 50.00, base_unit: 'kg' },
            });

            expect(result.events[0].payload).toMatchObject({
                product: 'Sugar',
                quantity: 0.4,
                unit: 'kg',
                unit_price_used: 50.00,
                price_source: 'inventory_selling_price',
            });
        });

        it('toEventInserts keeps price maps working when a normalizer is supplied', () => {
            const actions: ParsedAction[] = [
                { intent: 'SALE', item: 'Sugar', amount: 20, quantity: null },
            ];
            const normalizer = {
                resolve: (quantity: number, unit?: string | null) => ({
                    quantity,
                    unit: unit ?? null,
                    baseUnit: null,
                    recognized: false,
                    originalQuantity: quantity,
                    originalUnit: unit ?? null,
                }),
            };

            const result = toEventInserts(actions, normalizer, {
                Sugar: { selling_price: 50.00, base_unit: 'kg' },
            });

            expect(result.events[0].payload).toMatchObject({
                quantity: 0.4,
                unit_price_used: 50.00,
                price_source: 'inventory_selling_price',
            });
        });
    });

    describe('Unpriced sale resolution RPC wiring', () => {
        it('calls resolve_unpriced_sale with the event id and confirmed rate', async () => {
            const rpc = supabase.rpc as jest.Mock;
            rpc.mockResolvedValueOnce({ data: true, error: null });
            const repository = new SupabaseInventoryRepository();

            const result = await repository.resolveUnpricedSale('event-1', 40);

            expect(rpc).toHaveBeenCalledWith('resolve_unpriced_sale', {
                p_event_id: 'event-1',
                p_rate_per_unit: 40,
            });
            expect(result).toBe(true);
        });

        it('returns false when the resolution RPC fails', async () => {
            const rpc = supabase.rpc as jest.Mock;
            rpc.mockResolvedValueOnce({ data: null, error: { message: 'not authorized' } });
            const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            await expect(
                new SupabaseInventoryRepository().resolveUnpricedSale('event-1', 40)
            ).resolves.toBe(false);

            errorSpy.mockRestore();
        });
    });
});
