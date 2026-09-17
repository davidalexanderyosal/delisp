/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#080c17',
          800: '#0d1424',
          700: '#141d31',
          600: '#1d2942',
          500: '#2b3a58',
        },
        zone: {
          good: '#34d399',
          near: '#fbbf24',
          off: '#f87171',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
