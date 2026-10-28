# child-test — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/data/child-test -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `passages/` | One JSON file per Challenge reading/listening passage → `passages/CLAUDE.md` |
| `sa/` | Generated Jugnu batteries per surface, grade and language → `sa/CLAUDE.md` |
| `vocab/` | → (no door; 7 files) |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `item-bank.sa-extra.v1.json` | Official-only EGRA/EGMA extra items for the self-administered Jugnu battery; input to sa/build.js |
| `item-bank.sa-w3.v1.json` | Item picks for the RDF auto/manual forms (sa_rdf_w3_forms switch), referencing official bank items; input to sa/build.js |
| `item-bank.sa.v1.json` | (unmapped) |
| `item-bank.v1.json` | Original child-test item bank (v2 content): cues, EGRA/EGMA items and Urdu prompts, loaded by child-test item-bank.js |
| `item-bank.v3.json` | v3 child-test item bank built from official EGRA/EGMA sources (lane L35); base for Set A and sa bank builds |
| `item-bank.v4.json` | v4 Challenge content-registry bank: maths ids over v3 Set A, anchor blocks, period list, draw weights |
| `sa-lines-reviewed.v1.json` | Reviewer-shortened Jugnu script lines (Oct 2026) applied over the built bank by sa/reviewed-lines.js |
| `setup-picture-en.png` | (unmapped) |
| `setup-picture-ur.png` | (unmapped) |

## Who reads this (all, generated)
- `item-bank.sa.v1.json` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:460:dccaa0b9` · `bot/shared/services/child-test/sa/score.js:162:c0d0e3dc`
- `item-bank.v1.json` ← imported by `bot/shared/services/child-test/app/app-api.service.js:101:cceed7b8` · `bot/shared/services/child-test/item-bank.js:14:e4c34bb8` · `bot/scripts/child-test/build-print-pack-v2.js:35:0103d76c`
- `item-bank.v3.json` ← imported by `bot/shared/services/child-test/item-bank.js:139:12a5564f`
- `item-bank.v4.json` ← imported by `bot/shared/services/child-test/item-bank.js:200:6ffff5b1`

## Tests (all, generated)
- `item-bank.sa-extra.v1.json` ← `bot/tests/child-test/sa-bank.test.js` · `bot/tests/child-test/sa-extra.test.js` · `bot/tests/child-test/sa-rdf-w3.test.js` · `bot/tests/child-test/sa-reading-2.test.js` · `bot/tests/child-test/sa-reading-3.test.js` · `bot/tests/child-test/sa-reading.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/data/child-test/item-bank.sa-extra.v1.json`)
- `item-bank.sa-w3.v1.json` ← `bot/tests/child-test/sa-bank.test.js` · `bot/tests/child-test/sa-rdf-w3.test.js` · `bot/tests/child-test/sa-runtime.test.js`
- `item-bank.sa.v1.json` ← `bot/tests/child-test/sa-all-grade-forms.test.js` · `bot/tests/child-test/sa-rdf-w3-server.test.js` · `bot/tests/child-test/sa-rdf.test.js` · `bot/tests/child-test/sa-score.test.js`
- `item-bank.v1.json` ← `tests/child-test/L29/print-pack-v2.test.js` · `tests/child-test/L33/coach-card.test.js` · `tests/child-test/L34/coach-card-reach.test.js` · `tests/child-test/L7/app-integration.test.js`
- `item-bank.v3.json` ← `bot/tests/child-test/sa-bank.test.js` · `bot/tests/child-test/sa-rdf-w3.test.js` · `bot/tests/child-test/sa-runtime.test.js` · `bot/tests/quiz/web-quiz/challenge-passage-gate.test.js` · `bot/tests/quiz/web-quiz/challenge-title-leak.test.js` · `tests/child-test/L38/print-pack-v3.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/data/child-test/item-bank.v3.json`)

## Related (all, generated)
- docs: `bot/shared/data/CLAUDE.md`? · `bot/shared/data/child-test/CLAUDE.index.md`? · `bot/shared/data/child-test/CLAUDE.md`? · `bot/shared/data/child-test/passages/CLAUDE.index.md`? · `bot/shared/data/child-test/passages/CLAUDE.md`? · `bot/shared/data/child-test/passages/README.md`? · `bot/shared/data/child-test/sa/CLAUDE.index.md`? · `bot/shared/data/child-test/sa/CLAUDE.md`? · `bot/tests/child-test/CLAUDE.index.md`? · `bot/tests/child-test/CLAUDE.md`? · `bot/tests/quiz/web-quiz/CLAUDE.index.md`? · `bot/tests/quiz/web-quiz/CLAUDE.md`? · `tests/child-test/L29/CLAUDE.md`? · `tests/child-test/L33/CLAUDE.md`? · `tests/child-test/L34/CLAUDE.md`? · `tests/child-test/L38/CLAUDE.md`? · `tests/child-test/L7/CLAUDE.index.md`? · `tests/child-test/L7/CLAUDE.md`?
