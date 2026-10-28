# child-test — Child learning-assessment (EGRA/EGMA): draw, coach chat, scoring, check Flow
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/child-test kg=15c6085191c1 gen=1ff882f94f02 overflow=114 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `store.js` — main reader/writer of child_test_draws/sessions/blocks (check-flow, sa/score touch them)
- `tasks.js` — the 18 battery-v3 task ids every lane imports
- `conversation/machine.js` — coach-side flow from /egra to check
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `app/` | Coach-app API and app_settings switches for the self-administered assessment → `app/CLAUDE.md` |
| `check-flow/` | WhatsApp Flow where a coach confirms or corrects the AI's marks → `check-flow/CLAUDE.md` |
| `conversation/` | Coach's WhatsApp side of the child test: state machine, steps, recovery sweep → `conversation/CLAUDE.md` |
| `draw/` | Which children a coach tests: seeded per-class draw, cycles, term sets, visit keys → `draw/CLAUDE.md` |
| … | 10 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `students` (written by `store.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:316:2f35b0c2`? · `bot/shared/routes/edit-class-endpoint.js:44:2f35b0c2`? (+43)
- column `students.id` (written by `store.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:317:d73b0171` · `bot/shared/routes/edit-class-endpoint.js:45:dc16e319` (+42)
- … 22 more → `CLAUDE.index.md`

## Never (human)
- Write ai_marks only once: AI writes filter ai_marks IS NULL, trigger child_test_blocks_keep_marks (store.js:10-11)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/e2e-mock/child-test-v3-sim-real.test.js` (item-bank.js, store.js, tasks.js)
- `tests/e2e-mock/child-test-v3-visit.test.js` (item-bank.js, store.js, tasks.js)
- … 82 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/scripts/e2e/child-test-sim/CLAUDE.index.md`? · `bot/scripts/e2e/child-test-sim/CLAUDE.md`? · `bot/shared/data/child-test/passages/CLAUDE.index.md`? · `bot/shared/data/child-test/passages/CLAUDE.md`? · `bot/shared/data/child-test/passages/README.md`? · `bot/shared/services/CLAUDE.index.md`? (+30)
