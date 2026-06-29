import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/**
 * Turno palette — dark court-green with an optic-yellow (pickleball) accent and
 * coral for hold/alerts. Mirrors the prototype's CSS custom properties.
 */
const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--ink)",
        surface: {
          DEFAULT: "var(--surface)",
          2: "var(--surface-2)",
          raise: "var(--raise)",
        },
        ball: {
          DEFAULT: "var(--ball)",
          dim: "var(--ball-dim)",
        },
        line: "var(--line)",
        coral: "var(--coral)",
        muted: "var(--muted)",
        sage: "var(--sage)",
        // shadcn tokens (mapped onto the Turno theme)
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--ink)",
        foreground: "var(--line)",
        primary: {
          DEFAULT: "var(--ball)",
          foreground: "#10231d",
        },
        secondary: {
          DEFAULT: "var(--surface-2)",
          foreground: "var(--line)",
        },
        destructive: {
          DEFAULT: "var(--coral)",
          foreground: "#10231d",
        },
        accent: {
          DEFAULT: "var(--raise)",
          foreground: "var(--line)",
        },
        popover: {
          DEFAULT: "var(--surface)",
          foreground: "var(--line)",
        },
        card: {
          DEFAULT: "var(--surface)",
          foreground: "var(--line)",
        },
      },
      fontFamily: {
        sans: ["Outfit", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SF Mono", "Menlo", "Consolas", "monospace"],
      },
      borderRadius: {
        lg: "var(--r)",
        md: "calc(var(--r) - 4px)",
        sm: "calc(var(--r) - 8px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [animate],
};

export default config;
