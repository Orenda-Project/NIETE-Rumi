# app — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/child-test/app -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `add-child-switch.js` | Feature switch (app_settings sa_add_child, default off) letting a coach seat an off-roster child; read by sa-api.service |
| `all-grades-switch.js` | Feature switch (sa_all_grades, default off): coach picks Grade 1-5 per school for the day's list; read by sa-api.service |
| `any-school-switch.js` | Switch (sa_any_school) letting listed users see every live programme school, not only their own; used by sa-api.service |
| `app-api.service.js` | Bot side of the coach-app child test (card, timer, recorder); portal relays here over the internal API (bd-s1oo0.7) |
| `block-history.js` | Switch sa_block_by_history plus taken(): which battery blocks a returning child already did at the school |
| `ceiling-switch.js` | (unmapped) |
| `child-only-answer-switch.js` | (unmapped) |
| `coach-last-word-switch.js` | Switch (sa_coach_last_word) enabling POST /sa/last-word-hint suggestions for coaches; read by sa-api.service |
| `coach-name-guard-switch.js` | Round 8 switch (sa_r8_coach_name_guard): nulls a coach name that is a command/link so the dashboard shows 'unknown... |
| `dash-filters-switch.js` | Round 7b switch (sa_dash_filters): adds mode/block/coach/stops fields to saSessions for the results dashboard filters |
| `end-test-restart-switch.js` | Switch (sa_end_test_restart): a child ended early stays listed and can be restarted as a new attempt |
| `hide-practice-switch.js` | Round 8 switch (sa_r8_hide_practice): marks practice schools on the dashboard so the page hides them by default |
| `letter-gate-switch.js` | (unmapped) |
| `level-switch.js` | (unmapped) |
| `mcq-switch.js` | (unmapped) |
| `no-echo-ur-switch.js` | (unmapped) |
| `per-visit-switch.js` | (unmapped) |
| `practice-first-switch.js` | (unmapped) |
| `practice-only-switch.js` | Switch (child_test_practice_only): coaches off the pilot list get practice schools only; read by gate.isPracticeCoach |
| `rdf-switch.js` | Switch (sa_rdf_form) offering the short RDF form of the coach battery next to the full one |
| `rdf-w3-switch.js` | Switch (sa_rdf_w3_forms) offering the RDF auto and RDF manual forms and the W3 tasks in battery files |
| `resume-repick-switch.js` | Switch (sa_resume_repick): coach may re-pick the block of a resumed unfinished child session |
| `sa-api.service.js` | Coach app's self-administered Learning assessment API: schools, day list, outcomes, battery, presign, register, sessions |
| `sa-review.service.js` | Visit review for one self-administered session: per-item recordings, app vs agent marks, reviewer verdicts; portal... |
| `stop-rules-switch.js` | Switch (sa_stop_rules): applies EGRA stop rules to W3 letters/words/comprehension at scoring time in sa/score.js |
| `story-minute-switch.js` | (unmapped) |
| `variant-wait-switch.js` | Switch (sa_r8_variant_wait): score a rotated passage against the variant the phone showed, waiting for it; sa/score.js |
| `voice-help-switch.js` | (unmapped) |
| `voice-strict-switch.js` | (unmapped) |
| `words-prompt-switch.js` | (unmapped) |

## Who reads this (all, generated)
- `add-child-switch.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:62:2739d149`
- `all-grades-switch.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:59:c470a703`
- `any-school-switch.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:65:5dfe29a5`
- `app-api.service.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:76:83955dcf` · `bot/shared/services/child-test/app/sa-review.service.js:19:6a7c12b1`
- `block-history.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:55:b5dfe4f9`
- `ceiling-switch.js` ← imported by `bot/shared/services/child-test/sa/score.js:118:eaf3bd9a`
- `child-only-answer-switch.js` ← imported by `bot/shared/services/child-test/sa/score.js:117:e861eeac`
- `coach-last-word-switch.js` ← imported by `bot/shared/services/child-test/sa/score.js:109:6ae06b45` · `bot/shared/services/child-test/app/sa-api.service.js:63:317cbf62`
- `coach-name-guard-switch.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:70:5092edf4`
- `dash-filters-switch.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:67:933586b9`
- `end-test-restart-switch.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:66:bf703b11`
- `hide-practice-switch.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:68:b58a64a9`
- `letter-gate-switch.js` ← imported by `bot/shared/services/child-test/sa/score.js:112:78c8282b`
- `level-switch.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:71:c5a4dba5`
- `mcq-switch.js` ← imported by `bot/shared/services/child-test/sa-store.js:221:a7228eb8` · `bot/shared/services/child-test/sa/score.js:119:55ca8896` · `bot/shared/services/child-test/app/sa-api.service.js:72:a40d0d62`
- `no-echo-ur-switch.js` ← imported by `bot/shared/services/child-test/sa/score.js:116:29bc353b`
- `per-visit-switch.js` ← imported by `bot/shared/services/child-test/app/app-api.service.js:250:c74394e6` · `bot/shared/services/child-test/app/sa-api.service.js:60:7ef79205`
- `practice-first-switch.js` ← imported by `bot/shared/services/child-test/conversation/context.js:14:53582a8a` · `bot/shared/services/child-test/app/sa-api.service.js:69:c91ae99c`
- `practice-only-switch.js` ← imported by `bot/shared/services/child-test/app/app-api.service.js:83:0b89114b` · `bot/shared/services/child-test/app/sa-api.service.js:64:38022a6f`
- `rdf-switch.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:56:52e3beeb`
- `rdf-w3-switch.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:57:36a7eeb7`
- `resume-repick-switch.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:58:a5c58d0e`
- `stop-rules-switch.js` ← imported by `bot/shared/services/child-test/sa/score.js:108:9b745876` · `bot/shared/services/child-test/app/sa-api.service.js:61:d22b901d`
- `story-minute-switch.js` ← imported by `bot/shared/services/child-test/sa/score.js:121:3fe60660`
- `variant-wait-switch.js` ← imported by `bot/shared/services/child-test/sa/score.js:110:a813d896`
- `voice-help-switch.js` ← imported by `bot/shared/services/child-test/sa/score.js:114:cbe3971d`
- `voice-strict-switch.js` ← imported by `bot/shared/services/child-test/sa/score.js:111:588e7aec`
- `words-prompt-switch.js` ← imported by `bot/shared/services/child-test/sa/score.js:120:f9528595`
- env `CHILD_TEST_COACH_IDS` read at `bot/shared/services/child-test/app/app-api.service.js:81:7c1feadb`
- env `CHILD_TEST_ENABLED` read at `bot/shared/services/child-test/app/app-api.service.js:53:b63ce370`
- env `CHILD_TEST_R2_ENV` read at `bot/shared/services/child-test/app/app-api.service.js:58:882dfd55`
- env `CHILD_TEST_SA_LINK_ONE_PHONE` read at `bot/shared/services/child-test/app/sa-api.service.js:1186:b78d313b`
- env `CHILD_TEST_SA_SCORE_LATER` read at `bot/shared/services/child-test/app/sa-api.service.js:536:db6cf7d8`
- env `RAILWAY_ENVIRONMENT` read at `bot/shared/services/child-test/app/app-api.service.js:58:882dfd55`

## Tests (all, generated)
- `any-school-switch.js` ← `bot/tests/child-test/sa-any-school.test.js`
- `app-api.service.js` ← `bot/tests/child-test/sa-per-visit.test.js` · `bot/tests/child-test/sa-practice-only.test.js` · `tests/child-test/L0/app-scoring-claimed.test.js` · `tests/child-test/L16/one-rule-both-channels.test.js` · `tests/child-test/L7/app-integration.test.js`
- `block-history.js` ← `bot/tests/child-test/sa-block-history.test.js`
- `child-only-answer-switch.js` ← `bot/tests/child-test/sa-r28-child-only-answer.test.js`
- `letter-gate-switch.js` ← `bot/tests/child-test/sa-r28-letter-gate.test.js`
- `mcq-switch.js` ← `bot/tests/child-test/sa-r28-mcq-gate.test.js`
- `no-echo-ur-switch.js` ← `bot/tests/child-test/sa-r28-no-echo-ur.test.js`
- `per-visit-switch.js` ← `bot/tests/child-test/sa-per-visit.test.js`
- `practice-first-switch.js` ← `bot/tests/child-test/sa-practice-first.test.js`
- `practice-only-switch.js` ← `bot/tests/child-test/sa-practice-only.test.js`
- `sa-api.service.js` ← `bot/tests/child-test/sa-add-child.test.js` · `bot/tests/child-test/sa-all-grade-forms.test.js` · `bot/tests/child-test/sa-all-grades.test.js` · `bot/tests/child-test/sa-any-school.test.js` · `bot/tests/child-test/sa-block-history.test.js` · `bot/tests/child-test/sa-device-bundle.test.js` (+37: `python3 kg/kg.py who-reads bot/shared/services/child-test/app/sa-api.service.js`)
- `sa-review.service.js` ← `bot/tests/child-test/sa-review.test.js`
- `story-minute-switch.js` ← `bot/tests/child-test/sa-r28-story-minute.test.js`
- `voice-help-switch.js` ← `bot/tests/child-test/sa-score-voice-help.test.js`
- `voice-strict-switch.js` ← `bot/tests/child-test/sa-score-voice-strict.test.js`
- `words-prompt-switch.js` ← `bot/tests/child-test/sa-r28-words-prompt.test.js`

## Related (all, generated)
- docs: `bot/shared/services/child-test/CLAUDE.md`?
