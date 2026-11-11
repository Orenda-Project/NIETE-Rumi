# src — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `assets/` | Images for the marketing site and portal chrome: logos, hero art, illustrations → `assets/CLAUDE.md` |
| `components/` | Marketing-site sections (Hero, Navigation, story blocks) plus shared shadcn UI → `components/CLAUDE.md` |
| `hooks/` | Small shared React hooks: toasts, mobile breakpoint, marketing funnel tracking → `hooks/CLAUDE.md` |
| `i18n/` | → (no door; 3 files) |
| `lib/` | Runtime helpers: app target, Android links/back key, lazy chunks, Urdu text, WhatsApp → `lib/CLAUDE.md` |
| `pages/` | Public marketing pages: landing, How it works, 404 → `pages/CLAUDE.md` |
| `portal/` | Portal feature folders: analytics, COACHIP kit, FLN pages, teacher/coach apps → `portal/CLAUDE.md` |
| `test/` | Vitest guards on the shipped shell: index.html, brand tokens, route chunks, boot reads → `test/CLAUDE.md` |
| `App.tsx` | Portal root: QueryClient, router, lazy page chunks; / is marketing Index or PortalRoot by target; mounts portal routes |
| `index.css` | Global Tailwind layers, NIETE brand tokens, Urdu Nastaliq face (Arabic-only range), Urdu leading and clip rules |
| `main.tsx` | React entry: mounts App into #root and loads index.css and the i18n config |
| `vite-env.d.ts` | Vite client type reference for import.meta.env typings |

## Who reads this (all, generated)
- `App.tsx` ← imported by `portal/src/main.tsx:2:2af48748`
- `index.css` ← imported by `portal/scripts/urdu-fit/harness.tsx:9:3ba0d33b` · `portal/src/main.tsx:3:3b87cfb4` · `portal/src/portal/fln/player/bench/states.tsx:7:3ba0d33b`

## Tests (all, generated)
- `App.tsx` ← `portal/src/portal/auth/analytics-login.route.test.tsx` · `portal/src/portal/fln/tests/appRoute.test.tsx` · `portal/src/portal/pages/PortalAccount.test.tsx` · `portal/src/portal/pages/PortalDeleteAccount.test.tsx` · `portal/src/portal/pages/PortalPrivacy.test.tsx` · `portal/src/portal/teacher/lessons/leaders.app.test.tsx` (+2: `python3 kg/kg.py who-reads portal/src/App.tsx`)

## Related (all, generated)
- docs: `docs/app-funnel-telemetry.md`? · `docs/migration/09-play-store-launch.md`? · `docs/migration/09a-capacitor-wrapping.md`? · `portal/CLAUDE.md`?
