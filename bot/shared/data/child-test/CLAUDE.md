# child-test — Child test (Jugnu) item banks, passages, generated batteries and word lists
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/data/child-test kg=21c7f1674fa3 gen=5d2a4a40ea9f overflow=20 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `item-bank.v3.json` — official-source bank the self-administered batteries are built from
- `passages/README.md` — passage registry rules
- `sa/` — generated batteries served to the app
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `passages/` | One JSON file per Challenge reading/listening passage → `passages/CLAUDE.md` |
| `sa/` | Generated Jugnu batteries per surface, grade and language → `sa/CLAUDE.md` |
| `vocab/` | → (no door; 7 files) |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `item-bank.v*.json` | 3 versions — v4 imported; v4: v4 Challenge content-registry bank: maths ids over v3 Set A, anchor blocks, period list, draw weights |
| `item*` | 3 files; most used `item-bank.sa.v1.json`: (unmapped) |
| … | 3 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `item-bank.v1.json` ← imported by `bot/shared/services/child-test/app/app-api.service.js:101:cceed7b8` · `bot/shared/services/child-test/item-bank.js:14:e4c34bb8` (+1)
- `item-bank.sa.v1.json` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:460:dccaa0b9` · `bot/shared/services/child-test/sa/score.js:162:c0d0e3dc`
- `item-bank.v3.json` ← imported by `bot/shared/services/child-test/item-bank.js:139:12a5564f`
- `item-bank.v4.json` ← imported by `bot/shared/services/child-test/item-bank.js:200:6ffff5b1`

## Never (human)
- Never edit sa/*.json by hand; regenerate with bot/scripts/child-test/build-sa-bank.js (sa/coach.G1.A.json rule field)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/child-test/sa-bank.test.js` (item-bank.sa-extra.v1.json, item-bank.sa-w3.v1.json, item-bank.v3.json)
- `bot/tests/child-test/sa-rdf-w3.test.js` (item-bank.sa-extra.v1.json, item-bank.sa-w3.v1.json, item-bank.v3.json)
- … 17 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/data/CLAUDE.md`? · `bot/shared/data/child-test/CLAUDE.index.md`? · `bot/shared/data/child-test/CLAUDE.md`? · `bot/shared/data/child-test/passages/CLAUDE.index.md`? · `bot/shared/data/child-test/passages/CLAUDE.md`? · `bot/shared/data/child-test/passages/README.md`? (+6)
