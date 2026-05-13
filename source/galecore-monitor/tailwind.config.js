/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'bg-primary':   '#0a0e1a',
        'bg-secondary': '#111827',
        'bg-tertiary':  '#1f2937',
        'border-dark':  '#1e2d40',
        'text-primary': '#e2e8f0',
        'text-muted':   '#6b7280',
        'green-gc':     '#00c896',
        'red-gc':       '#ef4444',
        'yellow-gc':    '#f59e0b',
        'blue-gc':      '#3b82f6',
        'white-line':   '#94a3b8',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
