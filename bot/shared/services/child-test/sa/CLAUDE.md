# sa — Self-administered battery: bank builder, in-bot spoken-task scorer, Jugnu lines
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/child-test/sa kg=fb5932b403ac gen=1ca9adf4031c overflow=51 rendered=2026-11-06 kg.py=1.1.0 -->

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
| `reviewed-lines.js` | Overlays content reviewers' wording of Jugnu's lines (sa-lines-reviewed.v1.json) onto the built SA bank; also audioKey |
| `set-aside.js` | Naming rule (zz.r<attempt>_<task>) for rows of a restarted child's ended attempt; readers of session tasks skip them |
| … | 6 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `set-aside.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:68:e5ebbf41` · `bot/shared/services/child-test/app/sa-review.service.js:20:e5ebbf41` (+2)
- `counts.js` ← imported by `dashboard/routes/sa-battery-switches.js:121:c975a915` · `bot/shared/services/child-test/sa/score.js:199:84a91658`
- `score.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:664:dfafea0e` · `bot/whatsapp-bot.js:2994:1f15208c`
- `scripts.js` ← imported by `bot/shared/services/child-test/sa/build-w3.js:21:f61e9aac` · `bot/shared/services/child-test/sa/build.js:17:41b0657a`
- … 18 more → `CLAUDE.index.md`

## Never (human)
- Set-aside rows use zz.r<attempt>_ names; every task reader must skip them (set-aside.js:5)
<!-- read: map-read-niete-bot 2026-10-29 -->

## The MCQ reading floor (human, sa_r28_mcq)
- ON, `sa-store.js putResults` parks a story MCQ row (`*.story_mcq_w3`, not unrated) instead of marking it at sync (marks are written once); `score.js` admits it without a recording, waits for its passage's marks (`passageOf` maps `_mcq` as `_comp`) and writes `mcqMarks`: the oral questions' own `compGate`. Unrated MCQ rows are marked from the phone as before, never gated.
- Gated: `correct 0, of = of_all − unavailable, tap_correct 0, tap_attempted` (the phone's), `detail { kind: 'mcq', stopped_by_rule, stop_detail: 'comprehension', stop_why: 'first_line' | 'under_10_words', gated, of_all, of_asked: 0, items[] (not_reached, stop_rule, gated, raw_verdict correct|wrong), raw { tap_correct, tap_attempted, answers } }`. Passed: the phone's marks + `detail.gate_checked: true, stop_why: null`; no passage marks (none, or failed for good): `gate_checked: false`.
- Comparability: both versions apply the same server-side gate on the same passage marks (first-line stop, under 10 words heard); the MCQ's comprehension share and mean are compared with the oral's on the gate-passed population, with the gated share printed by delivery. Known limit, as the oral: an STT-silent passage gates a child who may have read; printed, not fixed here.

## Tests (generated)
- `bot/tests/child-test/sa-rdf-w3.test.js` (build-w3.js, build.js, reviewed-lines.js, voice-manifest.js)
- `bot/tests/child-test/record-sa-voice-v4.test.js` (ur-tashdeed.js, voice-manifest.js)
- … 35 more → `CLAUDE.index.md`

## Related (generated)
- (none)
