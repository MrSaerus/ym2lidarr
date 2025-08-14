import type { Config } from 'tailwindcss';

export default {
    darkMode: 'class',
    content: [
        './pages/**/*.{ts,tsx,js,jsx}',
        './components/**/*.{ts,tsx,js,jsx}',
        './lib/**/*.{ts,tsx,js,jsx}',
    ],
    theme: {
        extend: {
            colors: {
                // Микс Lidarr (синие/зелёные) + Yandex Music (жёлтый)
                primary: { DEFAULT: '#3b82f6' }, // Lidarr blue
                accent: { DEFAULT: '#22c55e' },  // Lidarr green
                ym: { yellow: '#FFCC00' },       // Yandex Music yellow
                bg: {
                    light: '#f7f8fb',
                    dark: '#0f1217',
                    panelLight: '#ffffff',
                    panelDark: '#171b22',
                    panelDark2: '#1e2430',
                    borderDark: '#2a2f3a',
                },
            },
            boxShadow: {
                panel: '0 1px 2px rgba(0,0,0,.25), 0 8px 24px rgba(0,0,0,.14)',
            },
            fontFamily: {
                sans: [
                    'Inter',
                    'ui-sans-serif',
                    'system-ui',
                    '-apple-system',
                    'Segoe UI',
                    'Roboto',
                    'Helvetica Neue',
                    'Arial',
                ],
                mono: [
                    'ui-monospace',
                    'SFMono-Regular',
                    'Menlo',
                    'Consolas',
                    'Liberation Mono',
                    'monospace',
                ],
            },
        },
    },
    plugins: [],
} satisfies Config;
