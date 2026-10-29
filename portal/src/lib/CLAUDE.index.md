# lib — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/lib -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `app-links.cjs` | Android App Links decision: is an appUrlOpen link our /portal/ origin, where to route it; CommonJS shared with root jest |
| `app-target.cjs` | Decides portal vs marketing site and the API base url (hostname, native, build target); CommonJS shared with root jest |
| `back-button.cjs` | Android hardware back-key rule: close dialog, leave on home pages, else history back, recording exception (bd-5rz1v.10) |
| `bootReads.test.ts` | Tests takeBoot (bootReads.ts): the index.html boot read is handed over once, then null (bd-sex15q.34) |
| `bootReads.ts` | takeBoot and prime helpers: one-shot hand-over of the /config and /me reads index.html started; early /coachip/home |
| `firstScreen.test.ts` | Tests warmFirstScreen/isCoachipEntry (firstScreen.ts): which first-screen chunks load at boot per path (bd-sex15q.34) |
| `firstScreen.ts` | warmFirstScreen: starts downloading dashboard, teacher Home, coach insights, RM chunks and /config at boot |
| `fontLink.test.ts` | Reads index.html and index.css: Google Fonts link must not request Noto Nastaliq Urdu; own woff2 face leads --font-urdu |
| `funnel-route.cjs` | normaliseRoute: strips ids/query from a /portal path for the app funnel; mirrored server-side (bd-4r3rei) |
| `funnelTracking.ts` | Marketing funnel client: session id, trackVisit and CTA clicks posted to /api/track, builds the WhatsApp url |
| `lazyOptional.test.tsx` | Tests lazyOptional (lazyPage.ts): draws on arrival, retries a failed chunk, a never-loading chunk never blocks the page |
| `lazyPage.prefetch.test.ts` | Tests prefetchPages (lazyPage.ts): skipped on data saver or 3g-or-slower lines, runs on 4g or no connection API |
| `lazyPage.test.tsx` | Tests lazyPage (lazyPage.ts): a chunk removed by a deploy reloads once, a second failure shows the error (bd-fxk3t8) |
| `lazyPage.ts` | lazyPage/lazyOptional/prefetchPages: code-split pages that reload once after a deploy removes chunks; idle prefetch |
| `runtime.browser.test.ts` | Tests classifyBrowser (runtime.ts): Capacitor app is native, WhatsApp in-app browser detected from UA (bd-fmf24g.30) |
| `runtime.ts` | Runtime adapter: reads Capacitor, Vite env, location, feeds app-target.cjs; isNativeApp, isPortalTarget, classifyBrowser |
| `textDir.ts` | latinDir/useTextDir: marks data strings with no Urdu as dir=ltr on Urdu pages so clamps and ellipsis work (bd-fmf24g.62) |
| `urduLatin.test.tsx` | Guards that Urdu mode keeps the English font for Latin text: Arabic-only Nastaliq range, one English stack (index.css) |
| `urduLeading.test.ts` | Reads index.css to pin Urdu line-height, clip-room and 13px minimum rules (bd-fmf24g.24); real check is urdu-fit/run.mjs |
| `utils.ts` | cn(): clsx plus tailwind-merge class-name helper used across shadcn and portal components |
| `whatsapp.botNumber.test.tsx` | Tests chat buttons use the bot number from /api/portal/config, never a baked-in one; none means no button |
| `whatsapp.ts` | WhatsApp links: picker url, validBotNumber, useBotChatUrl reading the tier's bot from /config; no bot number baked in |

## Who reads this (all, generated)
- `app-links.cjs` ← imported by `portal/src/portal/components/AppLinkListener.tsx:5:1cf0cb7e` · `portal/src/lib/runtime.ts:12:7dd7b9ce`
- `app-target.cjs` ← imported by `portal/capacitor.config.ts:3:eb551b02` · `portal/src/lib/runtime.ts:10:0566a3e7`
- `back-button.cjs` ← imported by `portal/src/portal/components/BackButtonHandler.tsx:6:8f28e5c4`
- `bootReads.ts` ← imported by `portal/src/App.tsx:34:38044852` · `portal/src/portal/coach/insights/api.ts:7:3324e143` · `portal/src/portal/hooks/useAuth.ts:8:c44d11c3` · `portal/src/portal/lib/useNewUi.ts:5:c44d11c3`
- `firstScreen.ts` ← imported by `portal/src/App.tsx:33:f9d97506` · `portal/src/portal/hooks/AuthProvider.tsx:5:1a044021`
- `funnel-route.cjs` ← imported by `portal/src/portal/lib/appFunnel.ts:1:f13f2889`
- `funnelTracking.ts` ← imported by `portal/src/components/FinalCTA.tsx:5:6b304a1d` · `portal/src/components/Hero.tsx:5:6b304a1d` · `portal/src/components/Navigation.tsx:6:6b304a1d` · `portal/src/hooks/useFunnelTracking.ts:6:755610e5` (+1: `python3 kg/kg.py who-reads funnelTracking.ts`)
- `lazyPage.ts` ← imported by `portal/src/App.tsx:32:f8a16879` · `portal/src/portal/components/PortalLayout.tsx:2:52e3f833` · `portal/src/portal/pages/PortalDashboard.tsx:2:30d5645c` · `portal/src/portal/teacher/analytics/routes.tsx:3:a99d9950` (+8: `python3 kg/kg.py who-reads lazyPage.ts`)
- `runtime.ts` ← imported by `portal/src/App.tsx:6:84711a37` · `portal/src/portal/components/AppLinkListener.tsx:3:2073a29f` · `portal/src/portal/components/BackButtonHandler.tsx:3:d8ecf33b` · `portal/src/portal/components/CertificatesPanel.tsx:52:fd0d80d0` (+15: `python3 kg/kg.py who-reads runtime.ts`)
- `textDir.ts` ← imported by `portal/src/portal/newui/InnerBar.tsx:7:85f7d44b` · `portal/src/portal/newui/List.tsx:7:85f7d44b` · `portal/src/portal/teacher/TeacherPage.tsx:7:a8f6c61b` · `portal/src/portal/teacher/home/look/HomeBand.tsx:3:a8f6c61b` (+3: `python3 kg/kg.py who-reads textDir.ts`)
- `utils.ts` ← imported by `portal/src/components/ui/alert-dialog.tsx:4:a05a987a` · `portal/src/components/ui/badge.tsx:4:a05a987a` · `portal/src/components/ui/button.tsx:5:a05a987a` · `portal/src/components/ui/card.tsx:3:a05a987a` (+217: `python3 kg/kg.py who-reads utils.ts`)
- `whatsapp.ts` ← imported by `portal/src/components/FinalCTA.tsx:2:eff5b19a` · `portal/src/components/Hero.tsx:2:eff5b19a` · `portal/src/components/Navigation.tsx:2:eff5b19a` · `portal/src/pages/HowItWorks.tsx:2:eff5b19a` (+7: `python3 kg/kg.py who-reads whatsapp.ts`)
- env `MODE` read at `portal/src/lib/lazyPage.ts:67:a41c959a`
- env `PROD` read at `portal/src/lib/runtime.ts:53:cc7428bc`
- env `VITE_API_BASE_URL` read at `portal/src/lib/runtime.ts:54:a6b1897d`
- env `VITE_APP_TARGET` read at `portal/src/lib/runtime.ts:44:f9f6e6f6`
- env `VITE_TRACKING_API_URL` read at `portal/src/lib/funnelTracking.ts:6:813d3283`

## Tests (all, generated)
- `app-links.cjs` ← `tests/portal/app-links.test.js`
- `app-target.cjs` ← `dashboard/tests/portal-host.service.test.js` · `tests/portal/android-ota-same-origin.test.js` · `tests/portal/android-ota.test.js` · `tests/portal/api-base-url-never-localhost.test.js` · `tests/portal/app-target.test.js`
- `back-button.cjs` ← `portal/src/portal/components/coaching/BottomSheet.test.tsx` · `portal/src/portal/newui/pullup.test.tsx` · `portal/src/portal/newui/sheet.test.tsx` · `tests/portal/back-button.test.js`
- `bootReads.ts` ← `portal/src/lib/bootReads.test.ts`
- `firstScreen.ts` ← `portal/src/lib/firstScreen.test.ts`
- `funnel-route.cjs` ← `tests/app-funnel/route-parity.test.js`
- `lazyPage.ts` ← `portal/src/lib/lazyOptional.test.tsx` · `portal/src/lib/lazyPage.prefetch.test.ts` · `portal/src/lib/lazyPage.test.tsx` · `portal/src/portal/components/PortalLayout.notices.test.tsx` · `portal/src/portal/teacher/analytics/SchoolView.test.tsx` · `portal/src/portal/teacher/assessment/topicsStep.test.tsx` (+10: `python3 kg/kg.py who-reads portal/src/lib/lazyPage.ts`)
- `runtime.ts` ← `portal/src/lib/runtime.browser.test.ts` · `portal/src/portal/components/CertificatesPanel.test.tsx` · `portal/src/portal/pages/PortalCurriculum.tab.test.tsx` · `portal/src/portal/pages/PortalCurriculum.viewer.test.tsx`
- `whatsapp.ts` ← `portal/src/lib/whatsapp.botNumber.test.tsx` · `portal/src/portal/auth/setup-link.test.tsx` · `portal/src/portal/coach/disagreements/CoachingBox.test.tsx` · `portal/src/portal/coach/disagreements/suggestion.test.ts` · `portal/src/portal/fln/send/SendPage.test.tsx` · `portal/src/portal/fln/share/ShareBar.test.tsx` (+2: `python3 kg/kg.py who-reads portal/src/lib/whatsapp.ts`)

## Related (all, generated)
- docs: `portal/ANDROID.md`? · `portal/src/CLAUDE.md`? · `portal/src/components/CLAUDE.md`? · `portal/src/pages/CLAUDE.md`? · `portal/src/portal/auth/CLAUDE.md`?
