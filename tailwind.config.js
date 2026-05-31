/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        'arc-gold':    '#d4af37',
        'arc-purple':  '#7f77dd',
        'arc-bg':      '#0a0a0f',
        'arc-card':    '#14141c',
        'arc-border':  '#1f1f2a',
        'arc-text':    '#e5e5e5',
        'arc-text-dim':'#888888',
        'arc-success': '#97c459',
        'arc-danger':  '#e24b4a',
        'arc-info':    '#1d9bf0',
      },
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
