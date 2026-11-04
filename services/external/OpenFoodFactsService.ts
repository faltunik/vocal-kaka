export interface ExternalProduct {
    name: string;
    unit: string;
    barcode: string;
    brand?: string;
}

const REQUEST_TIMEOUT_MS = 8000;
const USER_AGENT = 'VocalStock/1.0';
const QUANTITY_UNIT_PATTERN = /(\d+(?:[.,]\d+)?)\s*(kg|mg|ml|cl|g|l|pcs)(?![a-z])/i;
const ALLOWED_UNITS = new Set(['kg', 'g', 'mg', 'l', 'ml', 'cl', 'pcs']);

export class OpenFoodFactsService {
    private static BASE_URL = 'https://world.openfoodfacts.org/api/v0/product';

    static async getProductByBarcode(barcode: string): Promise<ExternalProduct | null> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
            const response = await fetch(`${this.BASE_URL}/${barcode}.json`, {
                signal: controller.signal,
                headers: { 'User-Agent': USER_AGENT },
            });

            if (!response.ok) return null;

            const data = await response.json();

            if (data.status === 1 && data.product) {
                const p = data.product;

                const name = p.product_name || p.product_name_en || p.generic_name || 'Unknown Product';

                return {
                    name,
                    unit: this.extractUnit(p.quantity),
                    barcode,
                    brand: p.brands
                };
            }
            return null;

        } catch {
            return null;
        } finally {
            clearTimeout(timeout);
        }
    }

    private static extractUnit(quantity: unknown): string {
        if (typeof quantity !== 'string') return 'pcs';

        const match = QUANTITY_UNIT_PATTERN.exec(quantity);
        if (!match) return 'pcs';

        const unit = match[2].toLowerCase();
        return ALLOWED_UNITS.has(unit) ? unit : 'pcs';
    }
}
