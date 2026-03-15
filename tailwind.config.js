/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'story-purple': {
          DEFAULT: '#7C3AED',
          light: '#A78BFA',
          dark: '#5B21B6',
        },
        'story-yellow': {
          DEFAULT: '#F59E0B',
          light: '#FCD34D',
          dark: '#D97706',
        },
        'story-green': {
          DEFAULT: '#10B981',
          light: '#6EE7B7',
          dark: '#059669',
        },
        'story-pink': {
          DEFAULT: '#EC4899',
          light: '#F9A8D4',
          dark: '#BE185D',
        },
        'story-blue': {
          DEFAULT: '#3B82F6',
          light: '#93C5FD',
          dark: '#1D4ED8',
        },
        'cream': '#FEFCE8',
      },
      fontFamily: {
        sans: ['Nunito', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Nunito', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'xl': '1rem',
        '2xl': '1.5rem',
        '3xl': '2rem',
      },
      boxShadow: {
        'story': '0 4px 24px rgba(124, 58, 237, 0.12)',
        'card': '0 2px 12px rgba(0, 0, 0, 0.08)',
      },
    },
  },
  plugins: [],
}
