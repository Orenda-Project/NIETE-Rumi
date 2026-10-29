# auth — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/auth -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `AnalyticsLogin.tsx` | Name-and-password sign-in page for analytics-only accounts, routed at /portal/analytics/login (bd-xxi78f.5) |
| `AuthField.tsx` | One labelled input of the sign-in pages with icon, show/hide password button and an error row (bd-fmf24g.64) |
| `AuthFrame.tsx` | Shared frame for the four signed-out pages: indigo band, white card, legal footer (bd-fmf24g.64) |
| `CodeSlots.tsx` | Six-slot WhatsApp code entry drawn over one real input so paste and autofill work (bd-fmf24g.64) |
| `RegisterOnWhatsApp.tsx` | Builds the wa.me chat link and the Register on WhatsApp button shown to unregistered numbers (bd-x7aprz.3) |
| `admin-login.test.tsx` | Pins the NIETE Admin title, Admin badge and Back arrow on AnalyticsLogin, English and Urdu (bd-xxi78f.5) |
| `analytics-login.route.test.tsx` | Pins that /portal/analytics/login opens signed out through the real route table and both guards |
| `analytics-login.test.tsx` | Pins AnalyticsLogin: name+password fields, login via useAuth().login, errors under fields, 56px targets |
| `auth.pages.test.tsx` | Pins the login and its three sibling auth pages: one frame, language pill, Urdu RTL, error mapping (bd-fmf24g.64) |
| `auth.skeleton.test.tsx` | Pins the sign-in loading outline and the busy BottomButton instead of a white screen (bd-fmf24g.64) |
| `auth.source.test.ts` | Source-scan test: auth pages keep design rules and their copy is registered, filled and label-only (bd-fmf24g.64) |
| `copy.ts` | English and Urdu label copy for the four auth pages and the analytics sign-in (machine-drafted Urdu, bd-fmf24g.64) |
| `errors.test.ts` | Pins errors.ts: server failures become short labels by HTTP status for login, reset and name sign-in |
| `errors.ts` | Maps /api/portal login, reset and verify failures by HTTP status to short in-app labels (portal.routes.js statuses) |
| `password-sign-in.test.tsx` | Pins phone+password login with no code sign-in, plus Forgot password and Admin login buttons (bd-xxi78f) |
| `setup-link.test.tsx` | Pins no-dead-end flows: Register on WhatsApp for unknown numbers and old /portal/setup/<token> links (bd-x7aprz.3) |

## Who reads this (all, generated)
- `AnalyticsLogin.tsx` ← imported by `portal/src/App.tsx:157:bb67d799`
- `AuthField.tsx` ← imported by `portal/src/portal/pages/PortalLogin.tsx:15:528d22bb` · `portal/src/portal/pages/PortalPasswordReset.tsx:8:528d22bb` · `portal/src/portal/pages/PortalPasswordResetVerify.tsx:8:528d22bb` · `portal/scripts/urdu-fit/harness.tsx:23:f2917c8a` (+1: `python3 kg/kg.py who-reads AuthField.tsx`)
- `AuthFrame.tsx` ← imported by `portal/src/portal/pages/PortalLogin.tsx:14:d59c6ee0` · `portal/src/portal/pages/PortalPasswordReset.tsx:7:d59c6ee0` · `portal/src/portal/pages/PortalPasswordResetVerify.tsx:7:d59c6ee0` · `portal/src/portal/pages/PortalSetup.tsx:8:fd012934` (+3: `python3 kg/kg.py who-reads AuthFrame.tsx`)
- `CodeSlots.tsx` ← imported by `portal/src/portal/pages/PortalPasswordResetVerify.tsx:9:ed444010` · `portal/scripts/urdu-fit/harness.tsx:24:3e57496b`
- `RegisterOnWhatsApp.tsx` ← imported by `portal/src/portal/pages/PortalLogin.tsx:16:ff0a5313` · `portal/src/portal/pages/PortalPasswordReset.tsx:10:ff0a5313` · `portal/src/portal/pages/PortalSetup.tsx:9:eb4a1b57`
- `copy.ts` ← imported by `portal/src/portal/pages/PortalLogin.tsx:17:25434c4a` · `portal/src/portal/pages/PortalPasswordReset.tsx:9:25434c4a` · `portal/src/portal/pages/PortalPasswordResetVerify.tsx:10:25434c4a` · `portal/src/portal/pages/PortalSetup.tsx:10:25434c4a` (+6: `python3 kg/kg.py who-reads copy.ts`)
- `errors.ts` ← imported by `portal/src/portal/pages/PortalLogin.tsx:18:16581d16` · `portal/src/portal/pages/PortalPasswordReset.tsx:11:87ea1547` · `portal/src/portal/pages/PortalPasswordResetVerify.tsx:11:3473e3aa` · `portal/src/portal/pages/PortalSetup.tsx:11:35143b1a` (+1: `python3 kg/kg.py who-reads errors.ts`)

## Tests (all, generated)
- `AnalyticsLogin.tsx` ← `portal/src/portal/auth/admin-login.test.tsx` · `portal/src/portal/auth/analytics-login.test.tsx`
- `RegisterOnWhatsApp.tsx` ← `portal/src/lib/whatsapp.botNumber.test.tsx`
- `copy.ts` ← `portal/src/portal/auth/auth.source.test.ts`
- `errors.ts` ← `portal/src/portal/auth/errors.test.ts`

## Related (all, generated)
- docs: `portal/src/CLAUDE.md`? · `portal/src/portal/CLAUDE.md`? · `portal/src/portal/newui/checks/CLAUDE.md`? · `portal/src/portal/services/CLAUDE.md`?
