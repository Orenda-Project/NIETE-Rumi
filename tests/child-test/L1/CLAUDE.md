# L1 — Item bank accessor and content validator for item-bank.v1.json

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test/L1 kg=0f6e77b56d6d gen=876594e52eed overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `item-bank.test.js` — accessor over the committed bank
- `item-bank.schema.mjs` — node:test validator, run through item-bank.schema.test.js
- Run from repo root: `node tests/run.js tests/child-test/L1 --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `item-bank.test.js` | Tests the child-test item bank accessor (version, getForm per grade and form) over item-bank.v1.json (bd-s1oo0.1) |
| `CLAUDE.md` | (unmapped) |
| `item-bank.schema.test.js` | Jest wrapper running item-bank.schema.mjs on the committed item bank so any bank edit is shape-checked (bd-s1oo0.1) |
| `item-bank.schema.mjs` | Zero-dependency node:test validator for item-bank.v1.json: ids, token counts, story lengths, maths answers, Urdu text |

## Who reads this (generated)
- env read here: `ITEM_BANK_PATH`

## Never (human)
- item-bank.schema.mjs is not a .test.js file, so only its wrapper test runs it under root jest (tests/child-test/L1/item-bank.schema.test.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `tests/child-test/CLAUDE.md`? · `tests/child-test/L1/CLAUDE.md`?
