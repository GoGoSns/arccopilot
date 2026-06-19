/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        'arc-accent':    '#ffffff',
        'arc-purple':  '#7f77dd',
        'arc-bg':      '#0a0a0a',
        'arc-card':    '#141414',
        'arc-border':  '#2a2a2a',
        'arc-text':    '#ffffff',
        'arc-text-dim':'#9a9a9a',
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
