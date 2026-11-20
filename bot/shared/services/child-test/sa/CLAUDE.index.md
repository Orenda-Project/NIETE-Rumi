# sa — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/child-test/sa -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `build-w3.js` | Builds the RDF auto and RDF manual W3 forms by picking items from the official banks (switch sa_rdf_w3_forms) |
| `build.js` | Builds the self-administered battery bank and per-form runtime files from item-bank.v3 with source paths on every item |
| `counts.js` | Round 8 switch sa_r8_counts: per-subsection practice trims and extra items for RDF forms |
| `last-word-hint.js` | Aligns heard words to passage words to suggest the last word read (switch sa_coach_last_word); sa-api saLastWordHint |
| `level.js` | (unmapped) |
| `review-store.js` | Sole reader/writer of child_test_sa_item_reviews: agent marks per item plus the reviewer's own mark and note |
| `reviewed-lines.js` | Overlays content reviewers' wording of Jugnu's lines (sa-lines-reviewed.v1.json) onto the built SA bank; also audioKey |
| `score.js` | Scores self-administered spoken tasks in the bot (CHILD_TEST_SA_SCORER): scoreRow plus a sweep claiming parked rows |
| `scripts.js` | Jugnu's spoken instruction lines for the SA battery in English and Urdu, adapted from EGRA/EGMA scripts, gender-neutral |
| `set-aside.js` | Naming rule (zz.r<attempt>_<task>) for rows of a restarted child's ended attempt; readers of session tasks skip them |
| `ur-tashdeed.js` | Adds shadda and vowels to Jugnu's Urdu narrations for the voice input only (switch sa_voice_tashdeed); no requires |
| `voice-activity.js` | (unmapped) |
| `voice-help.js` | (unmapped) |
| `voice-manifest.js` | Lists every line Jugnu speaks once with key, language and ear_check flag, so one clip serves all tasks using it |

## Who reads this (all, generated)
- `build-w3.js` ← imported by `bot/shared/services/child-test/sa/build.js:20:4f7a86ac`
- `build.js` ← imported by `bot/scripts/child-test/build-sa-bank.js:16:34f356b8`
- `counts.js` ← imported by `dashboard/routes/sa-battery-switches.js:228:c975a915` · `bot/shared/services/child-test/sa/build-w3.js:22:6ce17fda` · `bot/shared/services/child-test/sa/score.js:235:84a91658`
- `last-word-hint.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:74:048b2c5b`
- `level.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:73:a093766f`
- `review-store.js` ← imported by `bot/shared/services/child-test/app/sa-review.service.js:37:2ae41dd9`
- `reviewed-lines.js` ← imported by `bot/shared/services/child-test/sa/build.js:21:e282362f`
- `score.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:751:dfafea0e` · `bot/whatsapp-bot.js:3060:1f15208c`
- `scripts.js` ← imported by `dashboard/routes/sa-battery-switches.js:229:36bc0454` · `bot/shared/services/child-test/sa/build-w3.js:21:e8856283` · `bot/shared/services/child-test/sa/build.js:19:41b0657a`
- `set-aside.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:75:e5ebbf41` · `bot/shared/services/child-test/app/sa-review.service.js:20:e5ebbf41` · `bot/shared/services/child-test/sa-store.js:289:2ca04ca8` · `bot/shared/services/child-test/sa/score.js:123:1d2f1506`
- `ur-tashdeed.js` ← imported by `bot/scripts/child-test/record-sa-voice.js:99:46fcd804`
- `voice-activity.js` ← imported by `bot/shared/services/child-test/sa/score.js:113:a25eddb9`
- `voice-help.js` ← imported by `bot/shared/services/child-test/sa/score.js:115:8eaa2105`
- `voice-manifest.js` ← imported by `bot/scripts/child-test/record-sa-voice.js:92:f01bc739`
- table `child_test_blocks` whole row (`*`) (written by `score.js`) ← read by `bot/shared/services/child-test/check-flow/check-store.js:49:b0acb96c`?
- table `child_test_blocks` (written by `score.js`) ← read by `scripts/child-test/smoke-sandbox.js:83:c2d8ba96`?
- env `CHILD_TEST_R2_ENV` read at `bot/shared/services/child-test/sa/score.js:180:20458b92`
- env `CHILD_TEST_SA_CLIP_WAIT_S` read at `bot/shared/services/child-test/sa/score.js:178:d15c63b4`
- env `CHILD_TEST_SA_MIN_SPEECH_S` read at `bot/shared/services/child-test/sa/score.js:177:41a507f4`
- env `CHILD_TEST_SA_SCORER` read at `bot/shared/services/child-test/sa/score.js:153:d5200c1c`
- env `CHILD_TEST_SA_SCORER_SINCE_H` read at `bot/shared/services/child-test/sa/score.js:179:1d49f224`
- env `CHILD_TEST_SA_SCORE_MAX_INFLIGHT` read at `bot/shared/services/child-test/sa/score.js:172:e5e7073d`
- env `CHILD_TEST_SA_SECOND_VOICE` read at `bot/shared/services/child-test/sa/score.js:176:9c025eec`
- env `CHILD_TEST_SA_SPEECH_GATE` read at `bot/shared/services/child-test/sa/score.js:175:c09403b8`
- env `FFMPEG_PATH` read at `bot/shared/services/child-test/sa/voice-activity.js:76:a2264dda`
- env `RAILWAY_ENVIRONMENT` read at `bot/shared/services/child-test/sa/score.js:180:20458b92`

## Tests (all, generated)
- `build-w3.js` ← `bot/tests/child-test/sa-rdf-w3.test.js` · `bot/tests/child-test/sa-w2-story-lines.test.js`
- `build.js` ← `bot/tests/child-test/sa-bank-wording.test.js` · `bot/tests/child-test/sa-bank.test.js` · `bot/tests/child-test/sa-r28-bank.test.js` · `bot/tests/child-test/sa-rdf-w3.test.js` · `bot/tests/child-test/sa-reviewed-lines.test.js` · `bot/tests/child-test/sa-runtime.test.js` (+1: `python3 kg/kg.py who-reads bot/shared/services/child-test/sa/build.js`)
- `counts.js` ← `bot/tests/child-test/sa-r28-bank.test.js` · `bot/tests/child-test/sa-r28-base-served.test.js` · `bot/tests/child-test/sa-r28-ceiling.test.js` · `bot/tests/child-test/sa-r28-words-prompt.test.js`
- `last-word-hint.js` ← `bot/tests/child-test/sa-last-word-hint.test.js`
- `level.js` ← `bot/tests/child-test/sa-r20-level.test.js` · `bot/tests/child-test/sa-r28-base-served.test.js` · `bot/tests/child-test/sa-r28-ceiling.test.js` · `bot/tests/child-test/sa-r28-mcq-gate.test.js` · `bot/tests/child-test/sa-r28-mcq-of-all.test.js` · `bot/tests/child-test/sa-r28-mcq-readers.test.js`
- `review-store.js` ← `bot/tests/child-test/sa-review-store.test.js`
- `reviewed-lines.js` ← `bot/tests/child-test/sa-r10-lines.test.js` · `bot/tests/child-test/sa-rdf-w3.test.js` · `bot/tests/child-test/sa-reviewed-lines.test.js` · `bot/tests/child-test/sa-reviewer-answers.test.js` · `bot/tests/child-test/sa-reviewer-drafts.test.js`
- `score.js` ← `bot/tests/child-test/sa-r28-bank.test.js` · `bot/tests/child-test/sa-r28-base-served.test.js` · `bot/tests/child-test/sa-r28-ceiling-no-response.test.js` · `bot/tests/child-test/sa-r28-ceiling-words-prompt.test.js` · `bot/tests/child-test/sa-r28-ceiling.test.js` · `bot/tests/child-test/sa-r28-child-only-answer.test.js` (+24: `python3 kg/kg.py who-reads bot/shared/services/child-test/sa/score.js`)
- `scripts.js` ← `bot/tests/child-test/sa-reading.test.js` · `bot/tests/child-test/sa-voice-sustained-sounds.test.js` · `dashboard/tests/sa-r12-intro-once.service.test.js` · `dashboard/tests/sa-r13-oral-rule.service.test.js` · `dashboard/tests/sa-r13-whole-stop.service.test.js`
- `set-aside.js` ← `bot/tests/child-test/sa-restart.test.js`
- `ur-tashdeed.js` ← `bot/tests/child-test/record-sa-voice-v4.test.js` · `bot/tests/child-test/sa-voice-tashdeed.test.js`
- `voice-activity.js` ← `bot/tests/child-test/sa-r28-letter-gate.test.js`
- `voice-help.js` ← `bot/tests/child-test/sa-score-voice-help.test.js`
- `voice-manifest.js` ← `bot/tests/child-test/record-sa-voice-v4-english-ops.test.js` · `bot/tests/child-test/record-sa-voice-v4-equals.test.js` · `bot/tests/child-test/record-sa-voice-v4-praise.test.js` · `bot/tests/child-test/record-sa-voice-v4-relevel.test.js` · `bot/tests/child-test/record-sa-voice-v4-sounds.test.js` · `bot/tests/child-test/record-sa-voice-v4.test.js` (+5: `python3 kg/kg.py who-reads bot/shared/services/child-test/sa/voice-manifest.js`)

## Related (all, generated)
- (none)
