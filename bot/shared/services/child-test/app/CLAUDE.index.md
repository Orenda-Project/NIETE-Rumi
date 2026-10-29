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
| `coach-last-word-switch.js` | Switch (sa_coach_last_word) enabling POST /sa/last-word-hint suggestions for coaches; read by sa-api.service |
| `coach-name-guard-switch.js` | Round 8 switch (sa_r8_coach_name_guard): nulls a coach name that is a command/link so the dashboard shows 'unknown... |
| `dash-filters-switch.js` | Round 7b switch (sa_dash_filters): adds mode/block/coach/stops fields to saSessions for the results dashboard filters |
| `end-test-restart-switch.js` | Switch (sa_end_test_restart): a child ended early stays listed and can be restarted as a new attempt |
| `hide-practice-switch.js` | Round 8 switch (sa_r8_hide_practice): marks practice schools on the dashboard so the page hides them by default |
| `practice-only-switch.js` | Switch (child_test_practice_only): coaches off the pilot list get practice schools only; read by gate.isPracticeCoach |
| `rdf-switch.js` | Switch (sa_rdf_form) offering the short RDF form of the coach battery next to the full one |
| `rdf-w3-switch.js` | Switch (sa_rdf_w3_forms) offering the RDF auto and RDF manual forms and the W3 tasks in battery files |
| `resume-repick-switch.js` | Switch (sa_resume_repick): coach may re-pick the block of a resumed unfinished child session |
| `sa-api.service.js` | Coach app's self-administered Learning assessment API: schools, day list, outcomes, battery, presign, register, sessions |
| `sa-review.service.js` | Visit review for one self-administered session: per-item recordings, app vs agent marks, reviewer verdicts; portal... |
| `stop-rules-switch.js` | Switch (sa_stop_rules): applies EGRA stop rules to W3 letters/words/comprehension at scoring time in sa/score.js |
| `variant-wait-switch.js` | Switch (sa_r8_variant_wait): score a rotated passage against the variant the phone showed, waiting for it; sa/score.js |

## Who reads this (all, generated)
- `add-child-switch.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:59:2739d149`
- `all-grades-switch.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:57:c470a703`
- `any-school-switch.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:62:5dfe29a5`
- `app-api.service.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:69:83955dcf` · `bot/shared/services/child-test/app/sa-review.service.js:19:6a7c12b1`
- `block-history.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:53:b5dfe4f9`
- `coach-last-word-switch.js` ← imported by `bot/shared/services/child-test/sa/score.js:85:6ae06b45` · `bot/shared/services/child-test/app/sa-api.service.js:60:317cbf62`
- `coach-name-guard-switch.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:66:5092edf4`
- `dash-filters-switch.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:64:933586b9`
- `end-test-restart-switch.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:63:bf703b11`
- `hide-practice-switch.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:65:b58a64a9`
- `practice-only-switch.js` ← imported by `bot/shared/services/child-test/app/app-api.service.js:83:0b89114b` · `bot/shared/services/child-test/app/sa-api.service.js:61:38022a6f`
- `rdf-switch.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:54:52e3beeb`
- `rdf-w3-switch.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:55:36a7eeb7`
- `resume-repick-switch.js` ← imported by `bot/shared/services/child-test/app/sa-api.service.js:56:a5c58d0e`
- `stop-rules-switch.js` ← imported by `bot/shared/services/child-test/sa/score.js:84:9b745876` · `bot/shared/services/child-test/app/sa-api.service.js:58:d22b901d`
- `variant-wait-switch.js` ← imported by `bot/shared/services/child-test/sa/score.js:86:a813d896`
- env `CHILD_TEST_COACH_IDS` read at `bot/shared/services/child-test/app/app-api.service.js:81:7c1feadb`
- env `CHILD_TEST_ENABLED` read at `bot/shared/services/child-test/app/app-api.service.js:53:b63ce370`
- env `CHILD_TEST_R2_ENV` read at `bot/shared/services/child-test/app/app-api.service.js:58:882dfd55`
- env `CHILD_TEST_SA_LINK_ONE_PHONE` read at `bot/shared/services/child-test/app/sa-api.service.js:1020:b78d313b`
- env `CHILD_TEST_SA_SCORE_LATER` read at `bot/shared/services/child-test/app/sa-api.service.js:480:db6cf7d8`
- env `RAILWAY_ENVIRONMENT` read at `bot/shared/services/child-test/app/app-api.service.js:58:882dfd55`

## Tests (all, generated)
- `any-school-switch.js` ← `bot/tests/child-test/sa-any-school.test.js`
- `app-api.service.js` ← `bot/tests/child-test/sa-practice-only.test.js` · `tests/child-test/L0/app-scoring-claimed.test.js` · `tests/child-test/L16/one-rule-both-channels.test.js` · `tests/child-test/L7/app-integration.test.js`
- `block-history.js` ← `bot/tests/child-test/sa-block-history.test.js`
- `practice-only-switch.js` ← `bot/tests/child-test/sa-practice-only.test.js`
- `sa-api.service.js` ← `bot/tests/child-test/sa-add-child.test.js` · `bot/tests/child-test/sa-all-grade-forms.test.js` · `bot/tests/child-test/sa-all-grades.test.js` · `bot/tests/child-test/sa-any-school.test.js` · `bot/tests/child-test/sa-block-history.test.js` · `bot/tests/child-test/sa-device-events.test.js` (+18: `python3 kg/kg.py who-reads bot/shared/services/child-test/app/sa-api.service.js`)
- `sa-review.service.js` ← `bot/tests/child-test/sa-review.test.js`

## Related (all, generated)
- docs: `bot/shared/services/child-test/CLAUDE.md`?
