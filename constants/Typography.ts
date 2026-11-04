import { TextStyle } from 'react-native';

/**
 * Legibility-first type scale (system font, respects device text size).
 * Body starts at 17; captions never below 14.
 */
export const Typography: Record<
    'display' | 'largeTitle' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'caption' | 'captionStrong',
    TextStyle
> = {
    display: { fontSize: 40, fontWeight: '700', letterSpacing: -0.5, lineHeight: 46 },
    largeTitle: { fontSize: 32, fontWeight: '700', letterSpacing: -0.4, lineHeight: 38 },
    title: { fontSize: 24, fontWeight: '700', letterSpacing: -0.2, lineHeight: 30 },
    heading: { fontSize: 20, fontWeight: '600', lineHeight: 26 },
    body: { fontSize: 17, fontWeight: '400', lineHeight: 23 },
    bodyStrong: { fontSize: 17, fontWeight: '600', lineHeight: 23 },
    caption: { fontSize: 14, fontWeight: '400', lineHeight: 19 },
    captionStrong: { fontSize: 14, fontWeight: '600', lineHeight: 19 },
};
