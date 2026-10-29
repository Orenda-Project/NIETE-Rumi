# auth — Signed-out pages: login, forgot password, set-up link, analytics name login
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/auth kg=a42163ac5817 gen=8abc17fa1422 overflow=17 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `AuthFrame.tsx` — the one frame (band, card, legal footer) every signed-out page wears
- `errors.ts` — HTTP status to short label map for login/reset; read before touching messages
- Tests colocated, vitest: `cd portal && npx vitest run src/portal/auth`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `copy.ts` | English and Urdu label copy for the four auth pages and the analytics sign-in (machine-drafted Urdu, bd-fmf24g.64) |
| `analytics-login.route.test.tsx` | Pins that /portal/analytics/login opens signed out through the real route table and both guards |
| `auth*` | 3 files; most used `auth.source.test.ts`: Source-scan test: auth pages keep design rules and their copy is registered, filled and label-only (bd-fmf24g.64) |
| `AuthFrame.tsx` | Shared frame for the four signed-out pages: indigo band, white card, legal footer (bd-fmf24g.64) |
| … | 12 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/pages/PortalLogin.tsx:17:25434c4a` · `portal/src/portal/pages/PortalPasswordReset.tsx:9:25434c4a` (+8)
- `AuthFrame.tsx` ← imported by `portal/src/portal/pages/PortalLogin.tsx:14:d59c6ee0` · `portal/src/portal/pages/PortalPasswordReset.tsx:7:d59c6ee0` (+5)
- `AuthField.tsx` ← imported by `portal/src/portal/pages/PortalLogin.tsx:15:528d22bb` · `portal/src/portal/pages/PortalPasswordReset.tsx:8:528d22bb` (+3)
- … 4 more → `CLAUDE.index.md`

## Never (human)
- Map failures by HTTP status, never show server sentences (errors.ts:6, statuses from dashboard/routes/portal.routes.js)
- Copy is label-only 1-4 words, enforced by auth/auth.source.test.ts (bd-fmf24g.64)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/lib/whatsapp.botNumber.test.tsx` (RegisterOnWhatsApp.tsx)
- `portal/src/portal/auth/admin-login.test.tsx` (AnalyticsLogin.tsx)
- … 3 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/CLAUDE.md`? · `portal/src/portal/CLAUDE.md`? · `portal/src/portal/newui/checks/CLAUDE.md`? · `portal/src/portal/services/CLAUDE.md`?
