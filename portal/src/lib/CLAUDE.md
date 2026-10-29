# lib — Runtime helpers: app target, Android links/back key, lazy chunks, Urdu text, WhatsApp
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/lib kg=18a2ba92790a gen=1a66a40e565d overflow=64 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `runtime.ts` — reads Capacitor/env and applies the pure rules in app-target.cjs
- `lazyPage.ts` — chunk loading that survives deploys
- Tests are vitest (portal/vitest.config.ts, jsdom, setup src/test/setup.ts): `cd portal && npx vitest run src/lib`.
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `utils.ts` | cn(): clsx plus tailwind-merge class-name helper used across shadcn and portal components |
| `lazyPage*` | 3 files; most used `lazyPage.ts`: lazyPage/lazyOptional/prefetchPages: code-split pages that reload once after a deploy removes chunks; idle prefetch |
| `runtime.ts` | Runtime adapter: reads Capacitor, Vite env, location, feeds app-target.cjs; isNativeApp, isPortalTarget, classifyBrowser |
| `whatsapp.ts` | WhatsApp links: picker url, validBotNumber, useBotChatUrl reading the tier's bot from /config; no bot number baked in |
| … | 18 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `utils.ts` ← imported by `portal/src/components/ui/alert-dialog.tsx:4:a05a987a` · `portal/src/components/ui/badge.tsx:4:a05a987a` (+219)
- `runtime.ts` ← imported by `portal/src/App.tsx:6:84711a37` · `portal/src/portal/components/AppLinkListener.tsx:3:2073a29f` (+17)
- `lazyPage.ts` ← imported by `portal/src/App.tsx:32:f8a16879` · `portal/src/portal/components/PortalLayout.tsx:2:52e3f833` (+10)
- `whatsapp.ts` ← imported by `portal/src/components/FinalCTA.tsx:2:eff5b19a` · `portal/src/components/Hero.tsx:2:eff5b19a` (+9)
- … 13 more → `CLAUDE.index.md`

## Never (human)
- Add imports to the .cjs files: they are plain CommonJS shared with root jest (app-target.cjs:11)
- Let funnel-route.cjs drift from the server's normaliseRoute: parity test tests/app-funnel/route-parity.test.js (funnel-route.cjs:7)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `dashboard/tests/portal-host.service.test.js` (app-target.cjs)
- `portal/src/lib/bootReads.test.ts` (bootReads.ts)
- … 39 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/ANDROID.md`? · `portal/src/CLAUDE.md`? · `portal/src/components/CLAUDE.md`? · `portal/src/pages/CLAUDE.md`? · `portal/src/portal/auth/CLAUDE.md`?
