# sa — Self-administered battery: bank builder, in-bot spoken-task scorer, Jugnu lines
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/child-test/sa kg=a72be660e0f3 gen=cf349281aebc overflow=77 rendered=2026-11-27 kg.py=1.1.0 -->

## Entry points
- `build.js` — builds the SA bank and runtime batteries from official banks
- `score.js` — scores parked spoken rows (CHILD_TEST_SA_SCORER)
- `scripts.js` — Jugnu's spoken lines, English and Urdu
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `score.js` | Scores self-administered spoken tasks in the bot (CHILD_TEST_SA_SCORER): scoreRow plus a sweep claiming parked rows |
| `voice*` | 3 files; most used `voice-manifest.js`: Lists every line Jugnu speaks once with key, language and ear_check flag, so one clip serves all tasks using it |
| `build.js` | Builds the self-administered battery bank and per-form runtime files from item-bank.v3 with source paths on every item |
| `level.js` | (unmapped) |
| `scripts.js` | Jugnu's spoken instruction lines for the SA battery in English and Urdu, adapted from EGRA/EGMA scripts, gender-neutral |
| `counts.js` | Round 8 switch sa_r8_counts: per-subsection practice trims and extra items for RDF forms |
| … | 8 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `set-aside.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:75:e5ebbf41` · `bot/shared/services/child-test/app/sa-review.service.js:20:e5ebbf41` (+2)
- `counts.js` ← imported by `dashboard/routes/sa-battery-switches.js:228:c975a915` · `bot/shared/services/child-test/sa/build-w3.js:22:6ce17fda` (+1)
- `scripts.js` ← imported by `dashboard/routes/sa-battery-switches.js:229:36bc0454` · `bot/shared/services/child-test/sa/build-w3.js:21:e8856283` (+1)
- `score.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:779:dfafea0e` · `bot/whatsapp-bot.js:3101:1f15208c`
- … 22 more → `CLAUDE.index.md`

## Never (human)
- Set-aside rows use zz.r<attempt>_ names; every task reader must skip them (set-aside.js:5)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/child-test/sa-rdf-w3.test.js` (build-w3.js, build.js, reviewed-lines.js, voice-manifest.js)
- `bot/tests/child-test/sa-r28-bank.test.js` (build.js, counts.js, score.js)
- … 58 more → `CLAUDE.index.md`

## Related (generated)
- (none)
