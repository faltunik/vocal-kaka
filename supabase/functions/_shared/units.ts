import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface UnitDefinition {
    code: string;
    name: string;
    baseUnit: string;
    category: string;
    conversionFactor: number;
    aliases: string[];
}

export interface UnitResolution {
    quantity: number;
    unit: string | null;
    baseUnit: string | null;
    recognized: boolean;
    originalQuantity: number;
    originalUnit: string | null;
}

/**
 * In-memory view of the `unit_registry` table. `learn()` lets the pipeline
 * absorb units resolved by the `resolve-unit` edge function without a reload.
 */
export class UnitNormalizer {
    private aliasMap = new Map<string, UnitDefinition>();

    constructor(definitions: UnitDefinition[]) {
        for (const definition of definitions) {
            this.learn(definition);
        }
    }

    learn(definition: UnitDefinition): void {
        const key = definition.code.trim().toLowerCase();
        this.aliasMap.set(key, definition);
        for (const alias of definition.aliases ?? []) {
            this.aliasMap.set(String(alias).trim().toLowerCase(), definition);
        }
    }

    isRecognized(unit?: string | null): boolean {
        if (!unit) return false;
        return this.aliasMap.has(unit.trim().toLowerCase());
    }

    resolve(quantity: number, unit?: string | null): UnitResolution {
        const originalUnit = typeof unit === 'string' && unit.trim() ? unit.trim() : null;
        if (originalUnit == null || !Number.isFinite(quantity)) {
            return {
                quantity,
                unit: originalUnit,
                baseUnit: null,
                recognized: false,
                originalQuantity: quantity,
                originalUnit,
            };
        }

        const definition = this.aliasMap.get(originalUnit.toLowerCase());
        if (!definition) {
            return {
                quantity,
                unit: originalUnit,
                baseUnit: null,
                recognized: false,
                originalQuantity: quantity,
                originalUnit,
            };
        }

        return {
            quantity: quantity * Number(definition.conversionFactor),
            unit: definition.baseUnit,
            baseUnit: definition.baseUnit,
            recognized: true,
            originalQuantity: quantity,
            originalUnit,
        };
    }
}

export async function loadUnitNormalizer(admin: SupabaseClient): Promise<UnitNormalizer> {
    // Deterministic order so duplicate aliases across rows resolve consistently
    const { data, error } = await admin
        .from('unit_registry')
        .select('code, name, base_unit, category, conversion_factor, aliases')
        .order('code', { ascending: true });

    if (error) {
        console.error('[units] failed to load unit registry:', error.message);
        return new UnitNormalizer([]);
    }

    return new UnitNormalizer((data ?? []).map(row => ({
        code: String(row.code),
        name: String(row.name),
        baseUnit: String(row.base_unit),
        category: String(row.category),
        conversionFactor: Number(row.conversion_factor),
        aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
    })));
}

/** Asks the resolve-unit function to learn an unknown unit (AI + registry write). */
export async function resolveUnknownUnit(
    supabaseUrl: string,
    serviceKey: string,
    unit: string,
    itemHint?: string
): Promise<UnitDefinition | null> {
    try {
        const response = await fetch(`${supabaseUrl}/functions/v1/resolve-unit`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${serviceKey}`,
                apikey: serviceKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ unit, itemHint }),
        });
        if (!response.ok) {
            console.warn(`[units] resolve-unit failed with ${response.status}`);
            return null;
        }

        const data = await response.json();
        const resolved = data?.unit;
        if (!resolved || typeof resolved.code !== 'string') return null;

        return {
            code: resolved.code,
            name: resolved.name ?? resolved.code,
            baseUnit: resolved.baseUnit,
            category: resolved.category,
            conversionFactor: Number(resolved.conversionFactor),
            aliases: Array.isArray(resolved.aliases) ? resolved.aliases.map(String) : [unit],
        };
    } catch {
        return null;
    }
}
