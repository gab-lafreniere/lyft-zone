/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Tes couleurs existantes
        accent: {
          DEFAULT: "#ff6b00",
          50: "#fff4ed",
          100: "#ffe6d6",
          200: "#ffc9a8",
          300: "#ffab7a",
          400: "#ff8e4d",
          500: "#ff6b00",
          600: "#e65f00",
          700: "#bf4f00",
          800: "#993f00",
          900: "#733000",
        },
        ink: "#0f172a",
        surface: "#f7f7f8",

        // Aliases pour le design Stitch
        primary: "#19e6d4",
        "background-light": "#f6f8f8",
        "background-dark": "#112120",
        "accent-blue": "#e0f2fe",
        "accent-teal": "#ccfbf1",
      },
      boxShadow: {
        soft: "0 10px 30px rgba(15,23,42,0.08)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
      fontFamily: {
        display: ["Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
};