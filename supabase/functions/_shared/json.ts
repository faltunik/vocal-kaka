/**
 * Tolerant JSON extraction for LLM output: bare JSON, fenced blocks, or the
 * first `{` … last `}` slice. Shared by every provider so parsing behaviour
 * cannot drift between Meta, Groq and OpenRouter.
 */
export function extractJsonObject(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        // fall through
    }

    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
        try {
            return JSON.parse(fenced[1].trim());
        } catch {
            // fall through
        }
    }

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try {
            return JSON.parse(text.slice(start, end + 1));
        } catch {
            // fall through
        }
    }

    return null;
}
