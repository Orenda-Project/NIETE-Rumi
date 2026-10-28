# src — Portal source root: app entry, global CSS, i18n; routes and portal code live in src/portal
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src kg=80a34ea132ba gen=5783a4af0168 overflow=10 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `App.tsx` — all routes; lazy chunks via lazyPage; portal route tables imported from ./portal
- `index.css` — brand tokens and Urdu typography rules guarded by tests in lib/ and test/
- `i18n/config.ts` — en/ur only, Urdu first
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
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
| `CLAUDE.md` | (unmapped) |
| `CLAUDE.index.md` | (unmapped) |
| … | 4 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `index.css` ← imported by `portal/scripts/urdu-fit/harness.tsx:9:3ba0d33b` · `portal/src/main.tsx:3:3b87cfb4` (+1)
- `App.tsx` ← imported by `portal/src/main.tsx:2:2af48748`

## Never (human)
- Add locales beyond en and ur: supportedLngs mirrors the bot's offer (i18n/config.ts:17-21)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/auth/analytics-login.route.test.tsx` (App.tsx)
- `portal/src/portal/fln/tests/appRoute.test.tsx` (App.tsx)
- … 6 more → `CLAUDE.index.md`

## Related (generated)
- docs: `docs/CLAUDE.index.md`? · `docs/app-funnel-telemetry.md`? · `docs/migration/09-play-store-launch.md`? · `docs/migration/09a-capacitor-wrapping.md`? · `docs/migration/CLAUDE.index.md`? · `portal/CLAUDE.index.md`? (+21)
