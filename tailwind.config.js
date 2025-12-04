/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        serif: ['Playfair Display', 'serif'],
      },
      colors: {
        void: '#030303',
        panel: '#080808',
        border: '#1F1F1F',
        primary: '#E2E2E2',
        secondary: '#888888',
        accent: '#D4FF00',
        accentDim: '#4D5C00',
        danger: '#FF3333',
        warning: '#FFBF00',
        kimchi: '#FF4D00',
      },
      backgroundImage: {
        'grid-pattern': "linear-gradient(to right, #1a1a1a 1px, transparent 1px), linear-gradient(to bottom, #1a1a1a 1px, transparent 1px)",
        'eclipse-glow': 'radial-gradient(circle at 50% 0%, #222222 0%, #030303 60%)',
      },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'scanline': 'scanline 8s linear infinite',
      },
      keyframes: {
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' }
        }
      }
    }
  },
  plugins: [],
}
