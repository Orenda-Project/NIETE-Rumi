# L0 — Contract guards: check Flow input types, child identity, app scoring claim

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test/L0 kg=141d376d1d8e gen=7e5837f744e6 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `check-count-inputs.test.js` — count inputs must be text not phone (bd-s1oo0.43)
- `identity.test.js` — child named by full name, roll never shown
- Run from repo root: `node tests/run.js tests/child-test/L0 --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `check-count-inputs.test.js` | bd-s1oo0.43: check Flow count inputs must be text, not input-type phone, which WhatsApp validated as phone numbers |
| `CLAUDE.md` | (unmapped) |
| `app-scoring-claimed.test.js` | Pins that the app scoring channel goes through recovery.runScoring's DB claim like WhatsApp and the sweep (CR-L17-4) |
| `identity.test.js` | CONTRACT §18: a drawn child is named by full name first, roll only as hint; rollOf finds none (L25); identity module |
| `check-flow-meta-types.test.js` | bd-s1oo0.19: check Flow numeric inputs init from number data and count inputs from strings so Meta will publish it |

## Who reads this (generated)
- env read here: `CHILD_TEST_PREFILL_MODE`

## Never (human)
- Check Flow count inputs must not be input-type phone (tests/child-test/L0/check-count-inputs.test.js:52)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/child-test/app/CLAUDE.index.md`? · `bot/shared/services/child-test/check-flow/CLAUDE.index.md`? · `bot/shared/services/child-test/check-flow/CLAUDE.md`? · `bot/shared/services/child-test/conversation/CLAUDE.index.md`? · `bot/shared/services/child-test/conversation/CLAUDE.md`? · `tests/child-test/CLAUDE.md`? (+1)
