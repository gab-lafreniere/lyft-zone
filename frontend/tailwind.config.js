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

        // Design V2 aliases resolve only inside .lz-v2, where these variables exist.
        "lz-v2": {
          bg: "var(--lz-v2-color-bg)",
          "bg-deep": "var(--lz-v2-color-bg-deep)",
          surface: "var(--lz-v2-color-surface)",
          "surface-raised": "var(--lz-v2-color-surface-raised)",
          "surface-interactive": "var(--lz-v2-color-surface-interactive)",
          "surface-strong": "var(--lz-v2-color-surface-strong)",
          text: "var(--lz-v2-color-text)",
          "text-strong": "var(--lz-v2-color-text-strong)",
          "text-muted": "var(--lz-v2-color-text-muted)",
          action: "var(--lz-v2-color-action)",
          "on-action": "var(--lz-v2-color-on-action)",
          info: "var(--lz-v2-color-info)",
          danger: "var(--lz-v2-color-danger)",
          border: "var(--lz-v2-color-border)",
          focus: "var(--lz-v2-color-focus)",
        },
      },
      boxShadow: {
        soft: "0 10px 30px rgba(15,23,42,0.08)",
        "lz-v2-action-glow": "var(--lz-v2-shadow-action-glow)",
        "lz-v2-info-glow": "var(--lz-v2-shadow-info-glow)",
      },
      borderRadius: {
        xl2: "1.25rem",
        "lz-v2-sm": "var(--lz-v2-radius-sm)",
        "lz-v2-md": "var(--lz-v2-radius-md)",
        "lz-v2-lg": "var(--lz-v2-radius-lg)",
        "lz-v2-xl": "var(--lz-v2-radius-xl)",
      },
      fontFamily: {
        display: ["Inter", "sans-serif"],
        "lz-v2-display": ["Sora", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        "lz-v2-body": ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      spacing: {
        "lz-v2-gutter": "var(--lz-v2-page-gutter)",
        "lz-v2-section": "var(--lz-v2-space-10)",
      },
    },
  },
  plugins: [],
};
