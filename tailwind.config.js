/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Fraunces"', 'Georgia', 'serif'],
      },
      colors: {
        leaf: {
          50: '#f2f9f1',
          100: '#e0f0dd',
          200: '#c1e0bd',
          300: '#95c98f',
          400: '#63a95c',
          500: '#3f8b3a',
          600: '#2e6f2a',
          700: '#265823',
          800: '#204620',
          900: '#1b3a1c',
          950: '#0d200e',
        },
        mango: {
          50: '#fff8ed',
          100: '#ffefd4',
          200: '#ffdba8',
          300: '#ffbf70',
          400: '#ff9a37',
          500: '#ff7d12',
          600: '#f05f06',
          700: '#c74606',
          800: '#9e380e',
          900: '#7f300f',
        },
        cream: {
          50: '#fdfbf7',
          100: '#faf6ee',
          200: '#f3ecdd',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(27, 58, 28, 0.06), 0 4px 12px rgba(27, 58, 28, 0.05)',
        lifted: '0 4px 8px rgba(27, 58, 28, 0.08), 0 12px 28px rgba(27, 58, 28, 0.10)',
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.25rem',
        '3xl': '1.75rem',
      },
    },
  },
  plugins: [],
};
