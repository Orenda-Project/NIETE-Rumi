# draw — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/child-test/draw -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `class-label.js` | Names a classroom as teachers read it (Grade 3 - B, evening, short form) in English and Urdu (R1 7.1) |
| `cycle.js` | Maps a date to its Pakistan-time quarter cycle id (ICT-YYYY-Qn) and the Aug-Jul academic session code |
| `index.js` | The child draw: snapshot frame per class, seeded order, todaysList, markOutcome promoting alternates, addChild |
| `shuffle.js` | Seeded Fisher-Yates shuffle (HMAC of cycle and class) so ranks are unpredictable yet auditable; stores only a digest |
| `term-set.js` | Picks the card set (A/B) for a cycle, alternating by quarter, and the CHILD_TEST_FORM_POLICY switch |
| `visit-key.js` | Parses and builds visit keys (cs:/day:) for child-test draws on visits with no observe2 field form |

## Who reads this (all, generated)
- `class-label.js` ← imported by `bot/shared/services/child-test/check-flow/check-store.js:20:a8c1bf9b` · `bot/shared/services/child-test/draw/index.js:44:4677f11c`
- `cycle.js` ← imported by `bot/shared/services/sa-game/store-adapter.js:30:a6c5b7c9` · `scripts/child-test/seed-sandbox.js:152:9fd5cd5b` · `bot/shared/services/child-test/draw/index.js:41:7dc6d43d`
- `index.js` ← imported by `bot/shared/services/child-test/app/app-api.service.js:109:7ce125b7` · `scripts/child-test/smoke-sandbox.js:28:ea229281`
- `shuffle.js` ← imported by `bot/shared/services/child-test/draw/index.js:42:edd7d628`
- `term-set.js` ← imported by `bot/shared/services/child-test/draw/index.js:45:dd1063fc`
- `visit-key.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:51:02a8f71f` · `bot/shared/services/child-test/conversation/machine.js:51:4db8f781` · `bot/shared/services/child-test/store.js:20:6d6c2fb6` · `scripts/child-test/smoke-sandbox.js:30:164cfe0b` (+1: `python3 kg/kg.py who-reads visit-key.js`)
- env `CHILD_TEST_DRAW_SECRET` read at `bot/shared/services/child-test/draw/index.js:533:1de8cefe`
- env `CHILD_TEST_FORM_POLICY` read at `bot/shared/services/child-test/draw/term-set.js:16:056a6d72`
- env `CHILD_TEST_TERM_SET_BASE` read at `bot/shared/services/child-test/draw/term-set.js:22:c9e3e90a`

## Tests (all, generated)
- `cycle.js` ← `bot/tests/sa-game/sa-game-sink.test.js` · `tests/child-test/L3/cycle-shuffle.test.js`
- `index.js` ← `tests/child-test/L20/child-no.test.js` · `tests/child-test/L25/draw-v2.test.js` · `tests/child-test/L3/cycle-shuffle.test.js` · `tests/child-test/L3/draw-add-child.test.js` · `tests/child-test/L3/draw-all-grades.test.js` · `tests/child-test/L3/draw.test.js` (+3: `python3 kg/kg.py who-reads bot/shared/services/child-test/draw/index.js`)
- `shuffle.js` ← `tests/child-test/L3/cycle-shuffle.test.js` · `tests/child-test/L3/draw.test.js`
- `visit-key.js` ← `tests/child-test/L3b/machine-visit-key.test.js` · `tests/child-test/L3b/visit-key-grade.test.js` · `tests/child-test/L3b/visit-key.test.js` · `tests/child-test/L4/integration-l3.test.js`

## Related (all, generated)
- docs: `bot/shared/services/child-test/CLAUDE.index.md`? · `bot/shared/services/child-test/CLAUDE.md`? · `bot/shared/services/child-test/draw/CLAUDE.index.md`? · `bot/shared/services/child-test/draw/CLAUDE.md`? · `bot/tests/sa-game/CLAUDE.md`?
