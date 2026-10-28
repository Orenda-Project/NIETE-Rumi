# public — Static files served as-is: service worker, WhatsApp PDF hand-off pages, robots, prototype

<!-- kg:meta repo=NIETE-Rumi dir=portal/public kg=7af42dacae1b gen=eaa1fce5bc8b overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `open-file.html` — landing for 'Open in another app' from WhatsApp's browser
- `assess-sw.js` — offline worker for the leader assessment page
- No tests run here; assess-sw.js is read by src/portal/components/assess/assessSw.test.ts (vitest)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `v10p-bf8102dd5f4dd6b9/` | Static v10 phone prototype (English and Urdu screens) for sandbox phone testing → `v10p-bf8102dd5f4dd6b9/CLAUDE.md` |
| `v9h-b17a6a909a0664e9/` | Hosted v9 G1-5 lesson pages (73 chapter dirs, 1,084 pages) linked from v10 cards → `v9h-b17a6a909a0664e9/CLAUDE.md` |
| `CLAUDE.md` | (unmapped) |
| `assess-sw.js` | Offline service worker for the leader assessment at /portal/leader/assess: caches shell, assets, GET /api/portal reads |
| `favicon.ico` | (unmapped) |
| `favicon.png` | (unmapped) |
| `iab-pdf-go.html` | bd-fmf24g.58 throwaway page, path without .pdf; forwards Chrome to a sample PDF to dodge WhatsApp in-app browser crash |
| `iab-pdf-handoff-sample.pdf` | (unmapped) |
| `iab-pdf-handoff.html` | bd-fmf24g.58 throwaway phone test page: can WhatsApp's Android in-app browser hand a PDF to another app without crashing |
| `open-file.html` | Landing for 'Open in another app' from WhatsApp's browser; decodes ?f= base64url, forwards to an allowed host's file |
| `placeholder.svg` | (unmapped) |
| `robots.txt` | robots.txt allowing Googlebot, Bingbot, Twitterbot, facebookexternalhit and all other crawlers |

## Who reads this (generated)
- (none)

## Never (human)
- Forward open-file.html to hosts outside ShareActions' HANDOFF_HOST (open-file.html:19, ShareActions.tsx:77)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `portal/CLAUDE.index.md`? · `portal/CLAUDE.md`? · `portal/public/CLAUDE.md`? · `portal/public/v10p-bf8102dd5f4dd6b9/CLAUDE.index.md`? · `portal/public/v10p-bf8102dd5f4dd6b9/CLAUDE.md`? · `portal/public/v9h-b17a6a909a0664e9/CLAUDE.md`?
