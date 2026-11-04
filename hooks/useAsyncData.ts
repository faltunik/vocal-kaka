import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

interface UseAsyncDataOptions<T> {
    initialData: T;
    enabled?: boolean;
    refetchOnFocus?: boolean;
}

/**
 * Shared async-data hook with request-id cancellation and optional focus refetch.
 * `key` should capture every input the fetcher depends on (e.g. `${userId}:${threshold}`).
 */
export function useAsyncData<T>(key: string, fetcher: () => Promise<T>, options: UseAsyncDataOptions<T>) {
    const { initialData, enabled = true, refetchOnFocus = false } = options;
    const [state, setState] = useState<{ key: string; data: T }>({ key, data: initialData });
    const [loading, setLoading] = useState(enabled);
    const [error, setError] = useState<Error | null>(null);
    const requestIdRef = useRef(0);
    const hasFocusedRef = useRef(false);

    // Synchronously drop data belonging to a previous key (e.g. a previous account)
    // so it is never rendered for the new key.
    if (state.key !== key) {
        setState({ key, data: initialData });
        setError(null);
        setLoading(enabled);
    }

    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;
    const enabledRef = useRef(enabled);
    enabledRef.current = enabled;
    const keyRef = useRef(key);
    keyRef.current = key;

    const refetch = useCallback(async () => {
        if (!enabledRef.current) return;

        const requestId = ++requestIdRef.current;
        const requestKey = keyRef.current;
        setLoading(true);
        try {
            const result = await fetcherRef.current();
            if (requestId !== requestIdRef.current) return;
            setState({ key: requestKey, data: result });
            setError(null);
        } catch (e) {
            if (requestId !== requestIdRef.current) return;
            console.error('[useAsyncData] Fetch failed:', e);
            setError(e instanceof Error ? e : new Error(String(e)));
        } finally {
            if (requestId === requestIdRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!enabled) {
            requestIdRef.current++;
            setState({ key: keyRef.current, data: initialData });
            setError(null);
            setLoading(false);
            return;
        }

        setLoading(true);
        void refetch();

        return () => {
            requestIdRef.current++;
        };
        // initialData is intentionally not a dependency (callers pass constant initial values)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, enabled, refetch]);

    useFocusEffect(useCallback(() => {
        if (!refetchOnFocus) return;
        // The mount effect already fetched; only refetch on later focus events
        if (!hasFocusedRef.current) {
            hasFocusedRef.current = true;
            return;
        }
        void refetch();
    }, [refetch, refetchOnFocus]));

    return { data: state.data, loading, error, refetch };
}
