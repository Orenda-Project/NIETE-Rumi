# pages — Public marketing pages: landing, How it works, 404

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/pages kg=0878d27ca3fa gen=3e2e6901216f overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `Index.tsx` — landing page at / on non-portal hosts
- `HowItWorks.tsx` — /how-it-works, with tracked WhatsApp CTA
- `NotFound.tsx` — catch-all 404
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.md` | (unmapped) |
| `HowItWorks.tsx` | Marketing How-it-works page at /how-it-works with step explainer and chat-on-WhatsApp CTA tracked via funnelTracking |
| `NotFound.tsx` | 404 page with NIETE logo; logs the missing path; catch-all route in App.tsx |
| `Index.tsx` | Marketing landing page at / (non-portal hosts): composes Navigation, Hero and story sections, tracks the page visit |

## Who reads this (generated)
- `NotFound.tsx` ← imported by `portal/src/App.tsx:9:086ac2f5` · `portal/src/portal/coach/card/frame.tsx:6:eb976e2e`
- `HowItWorks.tsx` ← imported by `portal/src/App.tsx:70:e837ae71`
- `Index.tsx` ← imported by `portal/src/App.tsx:69:6a073008`

## Never (human)
- Fall back to another bot when none is configured: no number means no chat button (lib/whatsapp.ts:11)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/lib/whatsapp.botNumber.test.tsx` (HowItWorks.tsx)

## Related (generated)
- docs: `portal/src/CLAUDE.index.md`? · `portal/src/CLAUDE.md`? · `portal/src/lib/CLAUDE.index.md`? · `portal/src/lib/CLAUDE.md`? · `portal/src/pages/CLAUDE.md`?
