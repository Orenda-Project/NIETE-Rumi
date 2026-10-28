# ops — Operational probes against live infrastructure

<!-- kg:meta repo=NIETE-Rumi dir=scripts/ops kg=edaefc2d1a1c gen=1f43caa08d15 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `r2-cors-preflight.js` — checks R2 CORS for portal uploads without writing
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.md` | (unmapped) |
| `r2-cors-preflight.js` | Sends only the CORS OPTIONS preflight a browser would send for a portal upload PUT to R2; exit 1 if refused (bd-mzck5) |

## Who reads this (generated)
- env read here: `NODE_PATH` · `R2_ACCESS_KEY_ID` · `R2_BUCKET_NAME` · `R2_ENDPOINT` · `R2_SECRET_ACCESS_KEY`

## Never (human)
- Send a body or PUT from the preflight: it sends only OPTIONS so nothing is written (r2-cors-preflight.js:5-6)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `scripts/CLAUDE.index.md`? · `scripts/CLAUDE.md`? · `scripts/ops/CLAUDE.md`?
