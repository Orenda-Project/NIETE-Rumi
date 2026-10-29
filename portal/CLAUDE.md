# portal — React SPA: public marketing site plus the NIETE teacher/coach portal and Android app
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal kg=868bf8996d71 gen=55c5ad4a0217 overflow=11 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `package.json` — scripts: build, build:app (Android), test (vitest), test:budget, android:*
- `src/App.tsx` — router: marketing pages vs the portal route tables
- `capacitor.config.ts` — Android wrapper config (appId, OTA, API allowlist)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `.github/` | → (no door; 1 files) |
| `android/` | → (no door; 56 files) |
| `budget/` | → (no door; 2 files) |
| `public/` | Static files served as-is: service worker, WhatsApp PDF hand-off pages, robots, prototype → `public/CLAUDE.md` |
| `scripts/` | Local developer scripts for the portal (not part of the build) → `scripts/CLAUDE.md` |
| `src/` | Portal source root: app entry, global CSS, i18n; routes and portal code live in src/portal → `src/CLAUDE.md` |
| `ANDROID.md` | How to build, sync and test the NIETE Android app (Capacitor wrapper of this SPA): JDK 21, SDK 35, fixed appId; current |
| `README.md` | Upstream open-source README: teacher portal as an optional Phase 2 add-on (setup, build, hosting); generic, not NIETE |
| `GITHUB_ACTIONS_SETUP.md` | Historic setup guide for the Lovable-to-dashboard auto-deploy GitHub Action (PAT, secrets); superseded, kept as a note |
| `capacitor.config.ts` | Capacitor config for the Android app: fixed appId, webDir dist, opt-in NIETE_OTA remote origin, API host allowlist |
| … | 13 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `NIETE_KEYSTORE_PASSWORD` · `NIETE_KEYSTORE_PATH` · `NIETE_KEY_ALIAS` · `NIETE_KEY_PASSWORD` · `NIETE_OTA` · `VITE_API_BASE_URL`

## Never (human)
- Change Capacitor appId pk.edu.niete: Play identifies the app by package name (capacitor.config.ts:91)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/components/coaching/SendLessonButton.test.tsx` (tailwind.config.ts)
- `portal/src/portal/newui/tokens.test.ts` (tailwind.config.ts)

## Related (generated)
- docs: `.github/workflows/CLAUDE.md`? · `CLAUDE.md`? · `dashboard/lib/CLAUDE.md`? · `docs/migration/09-play-store-launch.md`? · `docs/migration/09a-capacitor-wrapping.md`? · `docs/migration/DEPLOYMENT.md`? (+8)
