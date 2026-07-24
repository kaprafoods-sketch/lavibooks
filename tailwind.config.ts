import type { Config } from "tailwindcss";

// LV / Lavi Books — luxe dark identity. Deep charcoal + champagne-gold accent,
// tabular monospaced numerals for all money, emerald gain / rose loss.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          900: "#0b0b0d",
          800: "#121216",
          700: "#191920",
          600: "#22222b",
          500: "#2e2e39",
        },
        gold: {
          DEFAULT: "#c9a86a",
          bright: "#e2c789",
          dim: "#8a7548",
        },
        gain: "#34d399",
        loss: "#fb7185",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "Inter", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
