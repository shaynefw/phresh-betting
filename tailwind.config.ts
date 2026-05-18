import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#05070d",
          panel: "#0a0f1a",
          card: "#0d1422",
          elevated: "#111a2e",
        },
        border: {
          DEFAULT: "#1a2540",
          strong: "#243456",
        },
        accent: {
          DEFAULT: "#22a8ff",
          glow: "#3fb8ff",
          dim: "#0d6cb1",
        },
        good: "#22c55e",
        bad: "#ef4444",
        warn: "#f59e0b",
        // Pending = unresolved bet. Purple distinguishes it from win/loss/void
        // (green/red/grey) and from the warn-amber "Testing Phase" banner.
        pending: "#a855f7",
        muted: "#7280a0",
        ink: {
          DEFAULT: "#e6efff",
          dim: "#a3b3d1",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(34,168,255,0.4), 0 0 24px rgba(34,168,255,0.15)",
        card: "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.4)",
      },
      backgroundImage: {
        "grid-glow":
          "linear-gradient(180deg, rgba(34,168,255,0.06) 0%, rgba(34,168,255,0) 70%)",
      },
    },
  },
  plugins: [],
};

export default config;
