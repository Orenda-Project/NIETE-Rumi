# portal — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `.github/` | → (no door; 1 files) |
| `android/` | → (no door; 56 files) |
| `budget/` | → (no door; 2 files) |
| `public/` | Static files served as-is: service worker, WhatsApp PDF hand-off pages, robots, prototype → `public/CLAUDE.md` |
| `scripts/` | Local developer scripts for the portal (not part of the build) → `scripts/CLAUDE.md` |
| `src/` | Portal source root: app entry, global CSS, i18n; routes and portal code live in src/portal → `src/CLAUDE.md` |
| `.gitignore` | (unmapped) |
| `ANDROID.md` | How to build, sync and test the NIETE Android app (Capacitor wrapper of this SPA): JDK 21, SDK 35, fixed appId; current |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `GITHUB_ACTIONS_SETUP.md` | Historic setup guide for the Lovable-to-dashboard auto-deploy GitHub Action (PAT, secrets); superseded, kept as a note |
| `README.md` | Upstream open-source README: teacher portal as an optional Phase 2 add-on (setup, build, hosting); generic, not NIETE |
| `capacitor.config.ts` | Capacitor config for the Android app: fixed appId, webDir dist, opt-in NIETE_OTA remote origin, API host allowlist |
| `components.json` | shadcn/ui CLI config: tsx, tailwind.config.ts, src/index.css, @/ aliases for components, utils, ui, lib, hooks |
| `eslint.config.js` | ESLint flat config for portal ts/tsx: recommended + typescript-eslint + react-hooks, react-refresh warn, unused-vars off |
| `index.html` | Vite entry page: coachip-boot script prefetching /config and /me, static app shell in #root, fonts, NIETE Portal title |
| `package.json` | Portal manifest (rumi-portal): vite web/app build modes, android:* scripts, vitest, test:budget, React/Radix deps |
| `postcss.config.js` | PostCSS config enabling tailwindcss and autoprefixer for the portal build |
| `tailwind.config.ts` | Tailwind config: shadcn HSL tokens plus newui and COACHIP colour tokens (bd-5rz1v.12, bd-sex15q.42) |
| `tsconfig.app.json` | TypeScript config for src: ES2020, bundler resolution, react-jsx, non-strict, @/ alias |
| `tsconfig.json` | TypeScript root: project references to app and node configs, @/ path alias, lenient null checks |
| `tsconfig.node.json` | TypeScript config for vite.config.ts only: ES2022, strict |
| `vite.config.ts` | Vite config: dev port 8080, React SWC plugin, lovable-tagger in dev, @ alias to src |
| `vitest.budget.config.ts` | Vitest config for bundle budgets only (budget/**/*.budget.test.ts, node env, 60 s timeout); npm run test:budget |
| `vitest.config.ts` | Vitest config: jsdom, globals, setup src/test/setup.ts, runs src/**/*.test.ts(x); the portal's default test runner |

## Who reads this (all, generated)
- env `NIETE_KEYSTORE_PASSWORD` read at `portal/capacitor.config.ts:114:6278f831`
- env `NIETE_KEYSTORE_PATH` read at `portal/capacitor.config.ts:113:4a49cd85`
- env `NIETE_KEY_ALIAS` read at `portal/capacitor.config.ts:115:ddf9c790`
- env `NIETE_KEY_PASSWORD` read at `portal/capacitor.config.ts:116:ebec54db`
- env `NIETE_OTA` read at `portal/capacitor.config.ts:51:77589ace`
- env `VITE_API_BASE_URL` read at `portal/capacitor.config.ts:30:7028a07a`

## Tests (all, generated)
- `tailwind.config.ts` ← `portal/src/portal/components/coaching/SendLessonButton.test.tsx` · `portal/src/portal/newui/tokens.test.ts`

## Related (all, generated)
- docs: `.github/workflows/CLAUDE.index.md`? · `.github/workflows/CLAUDE.md`? · `CLAUDE.md`? · `dashboard/CLAUDE.index.md`? · `dashboard/lib/CLAUDE.index.md`? · `dashboard/lib/CLAUDE.md`? · `docs/CLAUDE.index.md`? · `docs/migration/09-play-store-launch.md`? · `docs/migration/09a-capacitor-wrapping.md`? · `docs/migration/CLAUDE.index.md`? · `docs/migration/DEPLOYMENT.md`? · `docs/monitoring.md`? · `docs/onboarding/local-portal.md`? · `portal/ANDROID.md`? · `portal/CLAUDE.index.md`? · `portal/CLAUDE.md`? · `portal/GITHUB_ACTIONS_SETUP.md`? · `portal/README.md`? · `portal/public/CLAUDE.md`? · `portal/scripts/CLAUDE.md`? · `portal/src/CLAUDE.index.md`? · `portal/src/CLAUDE.md`? · `portal/src/lib/CLAUDE.index.md`? · `portal/src/lib/CLAUDE.md`? · `portal/src/portal/components/coaching/CLAUDE.index.md`? · `portal/src/portal/components/coaching/CLAUDE.md`? · `portal/src/portal/newui/CLAUDE.index.md`? · `portal/src/portal/newui/CLAUDE.md`? · `portal/src/portal/newui/DESIGN.md`? · `tests/portal/CLAUDE.index.md`? · `tests/portal/CLAUDE.md`?
