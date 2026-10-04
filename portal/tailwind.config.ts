import type { Config } from "tailwindcss";
// bd-5rz1v.12 — the new UI's colours come from ONE file; see src/portal/newui/DESIGN.md.
import { tailwindColors as newUiColors, tailwindShadows as newUiShadows } from "./src/portal/newui/tokens";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        error: "hsl(var(--error))",
        // bd-5rz1v.12 — new UI (Direction B): bg-nu-ink, text-nu-leaf, text-nu-nav-label, …
        nu: newUiColors,
      },
      // bd-5rz1v.19 — the new UI's button edges and menu-bar shadow: shadow-nu-button, shadow-nu-nav, …
      boxShadow: newUiShadows,
      fontFamily: {
        'urdu': ['"Noto Nastaliq Urdu"', 'serif'],
        'arabic': ['"Noto Sans Arabic"', 'sans-serif'],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        // bd-5rz1v — the Coaching pages' live signals: the record button's
        // ripples, the "needs your answer" dot, the sound bars while recording,
        // and the stripe across a progress bar. Each use pairs them with
        // motion-reduce:animate-none.
        "rec-wave": {
          "0%": { transform: "scale(0.6)", opacity: "0.85" },
          "100%": { transform: "scale(1)", opacity: "0" },
        },
        "rec-core": {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.07)" },
        },
        "attention-ring": {
          "0%": { transform: "scale(0.6)", opacity: "0.75" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
        "sound-level": {
          "0%, 100%": { transform: "scaleY(0.25)" },
          "50%": { transform: "scaleY(1)" },
        },
        "progress-stripe": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(250%)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "rec-wave": "rec-wave 2s ease-out infinite",
        "rec-core": "rec-core 2s ease-in-out infinite",
        "attention-ring": "attention-ring 1.6s ease-out infinite",
        "sound-level": "sound-level 0.9s ease-in-out infinite",
        "progress-stripe": "progress-stripe 1.4s ease-in-out infinite",
      },
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- unchanged since the scaffold; lint flagged it once this file was touched
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
