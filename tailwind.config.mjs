import tailwindcssAnimate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
const config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "var(--color-primary)",
          light: "var(--color-primary-light)",
          dark: "var(--color-primary-dark)",
        },
        secondary: {
          DEFAULT: "var(--color-secondary)",
          light: "var(--color-secondary-light)",
        },
        brand: {
          turchese: "var(--color-brand-turchese)",
          grigio: "var(--color-brand-grigio)",
          verde: "var(--color-brand-verde)",
          arancio: "var(--color-brand-arancio)",
          rosso: "var(--color-brand-rosso)",
          fucsia: "var(--color-brand-fucsia)",
        },
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        danger: "var(--color-danger)",
        storico: "var(--color-storico)",
        bg: {
          DEFAULT: "var(--color-bg)",
          page: "var(--color-bg-page)",
        },
        border: "var(--color-border)",
        text: {
          DEFAULT: "var(--color-text)",
          muted: "var(--color-text-muted)",
        },
      },
      fontFamily: {
        tenorite: ["Tenorite", "system-ui", "sans-serif"],
        sans: ["system-ui", "sans-serif"],
      },
      transitionDuration: {
        page: "200ms",
        card: "150ms",
        modal: "250ms",
        radar: "800ms",
        badge: "400ms",
        focus: "120ms",
      },
      transitionTimingFunction: {
        "ease-out": "ease-out",
        ease: "ease",
        spring: "cubic-bezier(0.68, -0.55, 0.265, 1.55)",
      },
      boxShadow: {
        card: "0 8px 24px rgba(0, 161, 190, 0.12)",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
