/** @type {import('tailwindcss').Config} */
import { MONOCHROME_DARK } from './theme.js'

export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        'arc-accent': MONOCHROME_DARK.colors.accent,
        'arc-bg': MONOCHROME_DARK.colors.background,
        'arc-card': MONOCHROME_DARK.colors.surface,
        'arc-elevated': MONOCHROME_DARK.colors.elevated,
        'arc-border': MONOCHROME_DARK.colors.border,
        'arc-border-emphasis': MONOCHROME_DARK.colors.borderEmphasis,
        'arc-elevated-border': MONOCHROME_DARK.colors.elevatedBorder,
        'arc-text': MONOCHROME_DARK.colors.text,
        'arc-text-dim': MONOCHROME_DARK.colors.muted,
        'arc-hint': MONOCHROME_DARK.colors.hint,
        'arc-success': MONOCHROME_DARK.colors.success,
        'arc-danger': MONOCHROME_DARK.colors.danger,
        'arc-info': MONOCHROME_DARK.colors.info,
        'arc-purple': MONOCHROME_DARK.colors.purple,
      },
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
