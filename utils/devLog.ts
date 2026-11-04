/** Development-only logging so production builds stay quiet. */

export function devLog(...args: unknown[]): void {
    if (__DEV__) {
        console.log(...args);
    }
}

export function devWarn(...args: unknown[]): void {
    if (__DEV__) {
        console.warn(...args);
    }
}
