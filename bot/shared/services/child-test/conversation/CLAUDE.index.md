# conversation — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/child-test/conversation -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `bank-v3.js` | Conversation's read of the v3 item bank: task ids in visit order, task specs and booklet page numbers (CONTRACT 21.3) |
| `context.js` | Infers where a child test happens (visit, school, observed teacher's Grade 3/5 class) so the coach is asked nothing... |
| `copy.js` | Coach copy for the child test from the ux-strings catalog (childTest* keys), Urdu default, Urdu digits |
| `gate.js` | Pure gate: CHILD_TEST_ENABLED, coach/leader role and ICT region decide who may start the child test |
| `identity.js` | Names a drawn child to coach/teacher: full name, classroom label, class teacher; never a roll number (CONTRACT 18-19) |
| `list.js` | Pure builder of today's child list message and per-class-teacher messages from draw.todaysList (L25) |
| `machine.js` | The coach-side child-test state machine: /egra list, presence, per-block voice notes, scoring hand-off, check |
| `nudge.js` | Sends the once-only unsent-draft nudge when a step has no voice note after ~4 min; runs from recovery sweep |
| `offer.js` | Sends the 'Test 5 children now?' offer after an observation; kept apart from machine.js to avoid a require cycle |
| `ports.js` | Lazy handles to the other lanes' modules (draw, store, scoring, check-flow, render, item bank) as the conversation... |
| `recovery.js` | Restart-safe scoring: runScoring plus a sweep that re-runs blocks left pending after a deploy and sends the check |
| `state.js` | Redis state of a coach's place in the child test (ctst:state:<coach>); context only, never a permission check |
| `steps-v3.js` | Pure battery-v3 step messages, one per task, from the catalog and bank-v3 (bd-s1oo0.50.2, CONTRACT 21.4) |
| `steps.js` | Pure v2 coach-journey step texts: story/maths step messages, presence line, child line (bd-s1oo0.46.2) |
| `switches.js` | Reads CHILD_TEST_BATTERY, MATHS_MODE, CHECK_MODE and nudge env switches on every call (v2 default) |

## Who reads this (all, generated)
- `bank-v3.js` ← imported by `bot/shared/services/child-test/conversation/machine.js:58:cead2762` · `bot/shared/services/child-test/conversation/steps-v3.js:29:53baadc1`
- `context.js` ← imported by `bot/shared/services/child-test/conversation/machine.js:47:b83c332c`
- `copy.js` ← imported by `bot/shared/services/child-test/check-flow/review-v3.js:30:796122bb` · `bot/shared/services/child-test/check-flow/review-view.js:10:37ad926e` · `bot/shared/services/child-test/check-flow/review.js:39:2b2f4732` · `bot/shared/services/child-test/check-flow/send-check.js:16:2db4f1eb` (+9: `python3 kg/kg.py who-reads copy.js`)
- `gate.js` ← imported by `bot/shared/handlers/text-message.handler.js:978:83e9366e` · `bot/shared/services/child-test/app/app-api.service.js:68:61d0ef1b` · `bot/shared/services/child-test/conversation/machine.js:50:9fe99608` · `bot/shared/services/child-test/conversation/nudge.js:26:2f7122e7` (+2: `python3 kg/kg.py who-reads gate.js`)
- `identity.js` ← imported by `bot/shared/services/child-test/check-flow/context.js:12:b9c81850` · `bot/shared/services/child-test/check-flow/review-v3.js:31:ad3926a9` · `bot/shared/services/child-test/check-flow/review-view.js:11:ad3926a9` · `bot/shared/services/child-test/conversation/list.js:26:8fb52023` (+3: `python3 kg/kg.py who-reads identity.js`)
- `machine.js` ← imported by `bot/shared/handlers/child-test.handler.js:22:c985fd7f`
- `nudge.js` ← imported by `bot/shared/services/child-test/conversation/recovery.js:413:f68ba8d8`
- `offer.js` ← imported by `bot/shared/handlers/child-test.handler.js:23:9f078fce` · `bot/shared/routes/observe2-check-endpoint.js:357:a6f3dd3a` · `bot/shared/services/observe/observe-send.service.js:1381:59faad7f`
- `ports.js` ← imported by `bot/shared/services/child-test/conversation/context.js:13:4e1846df` · `bot/shared/services/child-test/conversation/machine.js:44:4e1846df` · `bot/shared/services/child-test/conversation/nudge.js:21:4e1846df` · `bot/shared/services/child-test/conversation/recovery.js:40:4e1846df`
- `recovery.js` ← imported by `bot/shared/services/child-test/app/app-api.service.js:120:132855cd` · `bot/whatsapp-bot.js:2975:14e81fbd` · `bot/shared/services/child-test/conversation/machine.js:46:56b05edd`
- `state.js` ← imported by `bot/shared/services/child-test/conversation/machine.js:45:d2f7fb10` · `bot/shared/services/child-test/conversation/nudge.js:22:d2f7fb10` · `bot/shared/services/child-test/conversation/recovery.js:41:d2f7fb10`
- `steps-v3.js` ← imported by `bot/shared/services/child-test/conversation/machine.js:57:771c9077` · `bot/shared/services/child-test/conversation/nudge.js:76:9300d160`
- `steps.js` ← imported by `bot/shared/services/child-test/conversation/machine.js:56:fc40f77f` · `bot/shared/services/child-test/conversation/nudge.js:24:fc40f77f` · `bot/shared/services/child-test/conversation/ports.js:33:1d0ca99c` · `bot/shared/services/child-test/conversation/steps-v3.js:28:fc40f77f`
- `switches.js` ← imported by `bot/shared/services/child-test/conversation/machine.js:55:b6b9a3ba` · `bot/shared/services/child-test/conversation/nudge.js:23:b6b9a3ba` · `bot/shared/services/child-test/conversation/recovery.js:45:b6b9a3ba`
- env `CHILD_TEST_COACH_IDS` read at `bot/shared/services/child-test/conversation/gate.js:44:2210325c`
- env `CHILD_TEST_ENABLED` read at `bot/shared/services/child-test/conversation/gate.js:36:6d03d129`
- env `CHILD_TEST_INCHAT_CARDS` read at `bot/shared/services/child-test/conversation/machine.js:87:d61ab3c8`
- env `CHILD_TEST_OBSERVE_LINK` read at `bot/shared/services/child-test/conversation/gate.js:32:26186562`
- env `CHILD_TEST_R2_ENV` read at `bot/shared/services/child-test/conversation/machine.js:88:6ddf7d82` · `bot/shared/services/child-test/conversation/recovery.js:69:20458b92`
- env `CHILD_TEST_REGIONS` read at `bot/shared/services/child-test/conversation/gate.js:52:8d48f763`
- env `CHILD_TEST_SCORE_RECOVERY_OFF` read at `bot/shared/services/child-test/conversation/recovery.js:65:557e8816`
- env `CHILD_TEST_SETUP_PICTURE_DIR` read at `bot/shared/services/child-test/conversation/machine.js:1244:12cb3ae4`
- env `CHILD_TEST_STEP_NUDGE_MS` read at `bot/shared/services/child-test/conversation/switches.js:36:c0fba9bf`
- env `RAILWAY_ENVIRONMENT` read at `bot/shared/services/child-test/conversation/machine.js:88:6ddf7d82` · `bot/shared/services/child-test/conversation/recovery.js:69:20458b92`

## Tests (all, generated)
- `bank-v3.js` ← `tests/child-test/L36/journey-v3.test.js` · `tests/child-test/L38/print-pack-v3.test.js`
- `copy.js` ← `tests/child-test/L13/claim-and-cards.test.js`
- `gate.js` ← `bot/tests/child-test/sa-practice-only.test.js` · `tests/child-test/L4/gate.test.js`
- `identity.js` ← `tests/child-test/L0/identity.test.js` · `tests/child-test/L25/list-identity.test.js` · `tests/child-test/L26/journey-v2.test.js`
- `list.js` ← `tests/child-test/L25/list-identity.test.js`
- `machine.js` ← `tests/child-test/L17/score-recovery.test.js`
- `nudge.js` ← `tests/child-test/L26/integration-l3-v2.test.js` · `tests/child-test/L26/journey-v2.test.js` · `tests/child-test/L36/journey-v3.test.js` · `tests/e2e-mock/child-test-v3-sim-real.test.js` · `tests/e2e-mock/child-test-v3-visit.test.js`
- `ports.js` ← `tests/child-test/L11/protocol.test.js` · `tests/child-test/L13/claim-and-cards.test.js` · `tests/child-test/L17/score-recovery.test.js` · `tests/child-test/L19/child-names.test.js` · `tests/child-test/L20/strip-matching.test.js` · `tests/child-test/L21/teacher-offer.test.js` (+12: `python3 kg/kg.py who-reads bot/shared/services/child-test/conversation/ports.js`)
- `recovery.js` ← `tests/child-test/L0/app-scoring-claimed.test.js` · `tests/child-test/L17/score-recovery.test.js` · `tests/child-test/L25/no-roll.test.js` · `tests/child-test/L26/journey-v2.test.js` · `tests/child-test/L36/journey-v3.test.js`
- `state.js` ← `tests/child-test/L36/journey-v3.test.js` · `tests/child-test/L3b/machine-visit-key.test.js`
- `steps-v3.js` ← `tests/child-test/L36/journey-v3.test.js`
- `steps.js` ← `tests/child-test/L26/journey-v2.test.js` · `tests/child-test/L31/bidi-steps.test.js` · `tests/child-test/L34/step-reach.test.js`
- `switches.js` ← `tests/child-test/L36/journey-v3.test.js`

## Related (all, generated)
- docs: `bot/shared/services/child-test/CLAUDE.md`?
