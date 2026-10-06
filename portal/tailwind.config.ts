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
        // bd-5rz1v.9 — the "Send a lesson" button: a soft light that sweeps
        // across it (rests for the first 55% of each 4s), and a ring that
        // pulses out of its arrow. Transform and box-shadow only; each use
        // pairs them with motion-reduce:.
        "send-sheen": {
          "0%, 55%": { transform: "translateX(-135%) skewX(-18deg)" },
          "100%": { transform: "translateX(290%) skewX(-18deg)" },
        },
        "send-halo": {
          "0%": { boxShadow: "0 0 0 0 rgba(255,255,255,0.65)" },
          "100%": { boxShadow: "0 0 0 14px rgba(255,255,255,0)" },
        },
        // bd-o15qnr.9 — the coach app v2's Record live / Upload recording squares,
        // copied from the v21 canvas (Visit.dc.html). Used only as motion-safe:.
        "coach-rec-ring": {
          "0%": { transform: "scale(.55)", opacity: ".9" },
          "100%": { transform: "scale(1.35)", opacity: "0" },
        },
        "coach-rec-beat": {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(.86)" },
        },
        "coach-up-nudge": {
          "0%, 70%, 100%": { transform: "translateY(0)" },
          "35%": { transform: "translateY(-3px)" },
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
        "send-sheen": "send-sheen 4s ease-in-out infinite",
        "send-halo": "send-halo 2s ease-out infinite",
        "coach-rec-ring": "coach-rec-ring 1.8s ease-out infinite",
        "coach-rec-beat": "coach-rec-beat 1.6s ease-in-out infinite",
        "coach-up-nudge": "coach-up-nudge 2.4s ease-in-out infinite",
      },
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- unchanged since the scaffold; lint flagged it once this file was touched
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
