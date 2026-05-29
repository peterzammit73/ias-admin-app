/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    fontSize: {
      'xs': '0.875rem',   // 14px
      'sm': '1rem',       // 16px
      'base': '1.125rem',   // 18px
      'lg': '1.25rem',    // 20px
      'xl': '1.5rem',     // 24px
      '2xl': '1.875rem',  // 30px
      '3xl': '2.25rem',   // 36px
      '4xl': '3rem',      // 48px
      '5xl': '3.75rem',   // 60px
      '6xl': '4.5rem',    // 72px
    },
    extend: {},
  },
  plugins: [],
}