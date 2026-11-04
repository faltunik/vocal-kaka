export const Colors = {
    // Apple/OpenAI-inspired minimalist light theme
    light: {
        // Text
        text: '#111113',
        textSecondary: '#8A8A8E',
        icon: '#8A8A8E',

        // Surfaces
        background: '#F7F7F8',
        surface: '#FFFFFF',
        surfaceElevated: '#F2F2F4',
        card: '#FFFFFF',
        border: '#ECECEE',
        borderStrong: '#D8D8DC',

        // Primary actions (black, like OpenAI); the voice orb uses `success`
        tint: '#111113',
        onTint: '#FFFFFF',

        // Semantic
        success: '#3D7A57',
        onSuccess: '#FFFFFF',
        successSoft: '#E8F3EC',
        warning: '#F5A524',
        warningText: '#8A5A00',
        warningSoft: '#FFF6E5',
        review: '#F5A524',
        danger: '#E5484D',
        onDanger: '#FFFFFF',
        dangerSoft: '#FDECEC',
        notification: '#E5484D',

        overlay: 'rgba(0,0,0,0.45)',
    },

    // Retained for a future dark mode; the app currently ships the light theme.
    dark: {
        text: '#F7F7F8',
        textSecondary: '#B9BAC0',
        icon: '#B9BAC0',

        background: '#0B0B0C',
        surface: '#17171A',
        surfaceElevated: '#202024',
        card: '#17171A',
        border: '#2C2C31',
        borderStrong: '#6E6E73',

        tint: '#00E1FF',
        onTint: '#001418',

        success: '#2EE59D',
        onSuccess: '#00241A',
        warning: '#FFB020',
        review: '#FFB020',
        danger: '#FF5A5F',
        onDanger: '#2B0A0C',
        notification: '#FF5A5F',

        overlay: 'rgba(0,0,0,0.65)',
    },
};
