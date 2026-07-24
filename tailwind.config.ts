import type { Config } from "tailwindcss";

// LV / Lavi Books — LIGHT luxe identity. White ground, near-black ink, black
// pill CTAs, restrained green/rose for gain/loss. Tabular monospaced numerals
// for all money. The `ink` and `neutral` scales are tuned so the entire app —
// which is written in utility classes — reads correctly on a light background
// without touching every page.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces (higher number = further back). Light values.
        ink: {
          900: "#FFFFFF", // app background
          800: "#FFFFFF", // card surface (border-defined)
          700: "#F5F5F5", // input / hover fill
          600: "#E6E6E6", // hairline borders
          500: "#929292", // stronger borders (brand input border)
        },
        // Text scale, inverted so text-neutral-100 is darkest (emphasis) and
        // higher numbers are lighter/muted — matches how pages use it.
        neutral: {
          100: "#1A1A1A", // emphasis text (brand textPrimary)
          200: "#262626", // body text
          300: "#404040",
          400: "#525252",
          500: "#6B6B6B", // labels
          600: "#9A9A9A", // muted
          700: "#D4D4D4", // faint dividers
          800: "#E7E7E7",
          900: "#F5F5F5",
        },
        // Brand accent = near-black (LV wordmark is black). Used for chips/marks.
        gold: {
          DEFAULT: "#1A1A1A",
          bright: "#000000",
          dim: "#6B6B6B",
        },
        gain: "#0F9D58",
        loss: "#E11D48",
        brand: {
          primary: "#FEE500",
          green: "#06C755",
        },
      },
      fontFamily: {
        sans: ["Louis Vuitton Web", "Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
        heading: ["Louis Vuitton Web", "Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        lg: "8px",
        xl: "8px",
      },
    },
  },
  plugins: [],
};
export default config;
