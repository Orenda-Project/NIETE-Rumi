# sa — Self-administered battery: bank builder, in-bot spoken-task scorer, Jugnu lines
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/child-test/sa kg=50424d58999b gen=ec0dbc84682b overflow=44 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `build.js` — builds the SA bank and runtime batteries from official banks
- `score.js` — scores parked spoken rows (CHILD_TEST_SA_SCORER)
- `scripts.js` — Jugnu's spoken lines, English and Urdu
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `score.js` | Scores self-administered spoken tasks in the bot (CHILD_TEST_SA_SCORER): scoreRow plus a sweep claiming parked rows |
| `voice-manifest.js` | Lists every line Jugnu speaks once with key, language and ear_check flag, so one clip serves all tasks using it |
| `build.js` | Builds the self-administered battery bank and per-form runtime files from item-bank.v3 with source paths on every item |
| `set-aside.js` | Naming rule (zz.r<attempt>_<task>) for rows of a restarted child's ended attempt; readers of session tasks skip them |
| `scripts.js` | Jugnu's spoken instruction lines for the SA battery in English and Urdu, adapted from EGRA/EGMA scripts, gender-neutral |
| … | 6 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `set-aside.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:68:e5ebbf41` · `bot/shared/services/child-test/app/sa-review.service.js:20:e5ebbf41` (+2)
- `counts.js` ← imported by `dashboard/routes/sa-battery-switches.js:99:c975a915` · `bot/shared/services/child-test/sa/score.js:199:84a91658`
- `score.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:663:dfafea0e` · `bot/whatsapp-bot.js:2981:1f15208c`
- `scripts.js` ← imported by `bot/shared/services/child-test/sa/build-w3.js:21:f61e9aac` · `bot/shared/services/child-test/sa/build.js:17:41b0657a`
- … 18 more → `CLAUDE.index.md`

## Never (human)
- Set-aside rows use zz.r<attempt>_ names; every task reader must skip them (set-aside.js:5)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/child-test/sa-rdf-w3.test.js` (build-w3.js, build.js, voice-manifest.js)
- `bot/tests/child-test/record-sa-voice-v4.test.js` (ur-tashdeed.js, voice-manifest.js)
- … 28 more → `CLAUDE.index.md`

## Related (generated)
- (none)
