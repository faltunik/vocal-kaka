import { OpenFoodFactsService } from '@/services/external/OpenFoodFactsService';

const originalFetch = global.fetch;

function jsonResponse(body: unknown, ok = true, status = 200) {
    return {
        ok,
        status,
        json: jest.fn().mockResolvedValue(body),
    };
}

describe('OpenFoodFactsService', () => {
    let fetchMock: jest.Mock;

    beforeEach(() => {
        fetchMock = jest.fn();
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it.each<[unknown, string]>([
        ['2 x 1.5 l', 'l'],
        ['6 x 330 ml', 'ml'],
        ['500 g', 'g'],
        ['500ml', 'ml'],
        ['1L', 'l'],
        ['1,5 kg', 'kg'],
        ['250 mg', 'mg'],
        ['20 cl', 'cl'],
        ['2 pcs', 'pcs'],
        ['2 x 6', 'pcs'],
        [undefined, 'pcs'],
        ['unknown', 'pcs'],
    ])('maps quantity %p to unit %p', async (quantity, expectedUnit) => {
        fetchMock.mockResolvedValue(jsonResponse({
            status: 1,
            product: { product_name: 'Test Product', quantity },
        }));

        const product = await OpenFoodFactsService.getProductByBarcode('123');

        expect(product).not.toBeNull();
        expect(product!.unit).toBe(expectedUnit);
        expect(product!.unit).not.toBe('x');
    });

    it('returns the product details on success', async () => {
        fetchMock.mockResolvedValue(jsonResponse({
            status: 1,
            product: { product_name: 'Whole Milk', brands: 'Farm Co', quantity: '1 L' },
        }));

        const product = await OpenFoodFactsService.getProductByBarcode('4006381333931');

        expect(product).toEqual({
            name: 'Whole Milk',
            unit: 'l',
            barcode: '4006381333931',
            brand: 'Farm Co',
        });
    });

    it('returns null for a non-ok response', async () => {
        fetchMock.mockResolvedValue(jsonResponse({}, false, 500));

        await expect(OpenFoodFactsService.getProductByBarcode('123')).resolves.toBeNull();
    });

    it('returns null when the product is not found', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ status: 0 }));

        await expect(OpenFoodFactsService.getProductByBarcode('123')).resolves.toBeNull();
    });

    it('returns null when fetch rejects', async () => {
        fetchMock.mockRejectedValue(new Error('network down'));

        await expect(OpenFoodFactsService.getProductByBarcode('123')).resolves.toBeNull();
    });

    it('returns null when the request is aborted', async () => {
        const abortError = new Error('Aborted');
        abortError.name = 'AbortError';
        fetchMock.mockRejectedValue(abortError);

        await expect(OpenFoodFactsService.getProductByBarcode('123')).resolves.toBeNull();
    });

    it('aborts and returns null after the timeout', async () => {
        jest.useFakeTimers();
        fetchMock.mockImplementation((_url: string, init: RequestInit) =>
            new Promise((_resolve, reject) => {
                init.signal?.addEventListener('abort', () => {
                    const abortError = new Error('Aborted');
                    abortError.name = 'AbortError';
                    reject(abortError);
                });
            })
        );

        const pending = OpenFoodFactsService.getProductByBarcode('123');
        jest.advanceTimersByTime(8000);

        await expect(pending).resolves.toBeNull();
    });

    it('sends a User-Agent header and an abort signal', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ status: 0 }));

        await OpenFoodFactsService.getProductByBarcode('123');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://world.openfoodfacts.org/api/v0/product/123.json');
        expect(init.headers['User-Agent']).toBe('VocalStock/1.0');
        expect(init.signal).toBeDefined();
    });
});
