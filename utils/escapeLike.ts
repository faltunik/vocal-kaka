/** Escapes LIKE/ILIKE wildcards so user input matches literally. */
export function escapeLikePattern(value: string): string {
    return value.replace(/[\\%_*]/g, (match) => `\\${match}`);
}
