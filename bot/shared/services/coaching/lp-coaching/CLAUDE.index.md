# lp-coaching — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/coaching/lp-coaching -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `lp-coaching-linker.service.js` | Links an LP-list selection to the coaching session, resolving corpus asset versions or starting the upload flow |
| `lp-framework-prompt.service.js` | Per-framework instructions appended to lesson-plan generation prompts so plans suit the coaching framework |
| `lp-list-selection.handler.js` | Routes lp_select_/lp_upload_/lp_none_ list taps to the linker and continues the coaching flow (bd-wa5io) |
| `lp-outcome-ack.service.js` | Merges the lesson-plan outcome line into the Step 2/5 message via a Redis claim to save a billed bubble (NC3) |
| `lp-selection-format.js` | Formats a recent LP into a code-point-capped list row: topic title, grade/chapter/pages/recency description |
| `lp-selection-list.service.js` | Builds the WhatsApp interactive list for choosing a lesson plan, capped at 10 rows, buttons when none (bd-zrlcp) |
| `lp-step.service.js` | Single shared "land on the lesson-plan step" for every finish-photos path, plus LP re-prompt (bd-5azz0) |
| `lp-text-paste.service.js` | Accepts a lesson plan typed into the chat as the session's plan so Section B has a denominator (bd-we73k) |
| `recent-fidelity-lps.service.js` | Recent-LP source for the selection list from niete_lp_downloads plus catalog, incl. app-read plans (bd-wmfsp.5) |
| `send-lp-prompt.js` | Routes an LP prompt to sendInteractiveMessage for lists or buttons so list payloads no longer crash (bd-lqpog) |

## Who reads this (all, generated)
- `lp-coaching-linker.service.js` ← imported by `bot/shared/services/coaching/portal-lesson-plan-library.service.js:61:7807780f` · `bot/shared/services/coaching/lp-coaching/lp-list-selection.handler.js:73:3075aadd`
- `lp-list-selection.handler.js` ← imported by `bot/whatsapp-bot.js:1053:b8dc3d04`
- `lp-outcome-ack.service.js` ← imported by `bot/shared/services/coaching/analysis-processor.service.js:175:f9831fdc` · `bot/shared/services/coaching/lesson-plan-processor.service.js:99:3d5b20d0` · `bot/whatsapp-bot.js:691:cc407dee` · `bot/shared/services/coaching/lp-coaching/lp-list-selection.handler.js:184:52c69189`
- `lp-selection-format.js` ← imported by `bot/shared/routes/observe2-form-endpoint.js:199:750fb25d` · `bot/shared/services/coaching/lp-coaching/lp-list-selection.handler.js:99:f535e96b` · `bot/shared/services/coaching/lp-coaching/lp-selection-list.service.js:82:f535e96b`
- `lp-selection-list.service.js` ← imported by `bot/shared/services/observe/observe-resume.service.js:87:cfa10817` · `bot/shared/services/coaching/lp-coaching/lp-step.service.js:86:1eff0405`
- `lp-step.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:1114:f3d89c1a` · `bot/shared/services/coaching/classroom-photo/add-another.service.js:125:ba038c48` · `bot/shared/services/coaching/classroom-photo/capture.service.js:209:ba038c48` · `bot/whatsapp-bot.js:1069:ca28e603` (+1: `python3 kg/kg.py who-reads lp-step.service.js`)
- `lp-text-paste.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:932:c7729cba`
- `recent-fidelity-lps.service.js` ← imported by `bot/shared/routes/observe2-form-endpoint.js:188:6e7d24c6` · `bot/shared/services/coaching/portal-lesson-plan-library.service.js:62:136755af` · `bot/shared/services/observe/observe-resume.service.js:93:a32028e6` · `bot/whatsapp-bot.js:43:a639f234` (+2: `python3 kg/kg.py who-reads recent-fidelity-lps.service.js`)
- `send-lp-prompt.js` ← imported by `bot/shared/services/observe/observe-resume.service.js:88:1ed73adc` · `bot/whatsapp-bot.js:53:a2d13f6e` · `bot/shared/services/coaching/lp-coaching/lp-step.service.js:87:211ee0be`
- column `coaching_sessions.conversation_state` (written by `lp-step.service.js`) ← read by `bot/shared/handlers/text-message.handler.js:2034:a619795a` · `bot/shared/services/coaching/classroom-photo/add-another.service.js:85:739d5912` · `bot/shared/services/coaching/classroom-photo/capture.service.js:164:0125d837` · `bot/shared/services/coaching/classroom-photo/photo-yes.service.js:57:e9871896` (+8: `python3 kg/kg.py who-reads coaching_sessions.conversation_state`)
- column `coaching_sessions.has_lesson_plan` (written by `lp-coaching-linker.service.js`) ← read by `bot/shared/services/coaching/portal-class-check.js:135:60fc760c` · `dashboard/routes/portal.routes.js:7831:3f51afc5`
- column `coaching_sessions.lesson_plan_structured` (written by `lp-coaching-linker.service.js`) ← read by `bot/shared/services/coaching/fidelity/fidelity-recompute.service.js:58:2e68ba58`
- column `coaching_sessions.status` (written by `lp-step.service.js`) ← read by `bot/shared/calls/call-context.repo.js:64:24fe63d9` · `bot/shared/calls/call-tools.repo.js:52:23fca46d` · `bot/shared/handlers/text-message.handler.js:1923:21a55915` · `bot/shared/handlers/voice-message.handler.js:744:21a55915` (+39: `python3 kg/kg.py who-reads coaching_sessions.status`)
- table `coaching_sessions` whole row (`*`) (written by `lp-coaching-linker.service.js`, `lp-step.service.js`) ← read by `bot/shared/handlers/text-message.handler.js:1921:d2b02c3e`? · `bot/shared/handlers/voice-message.handler.js:742:d2b02c3e`? · `bot/shared/routes/observe-mewaka-endpoint.js:152:d2b02c3e`? · `bot/shared/services/coaching-orchestrator.service.js:225:d2b02c3e`? (+11: `python3 kg/kg.py who-reads coaching_sessions`)
- table `coaching_sessions` (written by `lp-coaching-linker.service.js`, `lp-step.service.js`) ← read by `bot/shared/calls/call-context.repo.js:63:5911672a`? · `bot/shared/calls/call-tools.repo.js:51:4a173bcd`? · `bot/shared/handlers/text-message.handler.js:1920:5911672a`? · `bot/shared/handlers/voice-message.handler.js:741:5911672a`? (+86: `python3 kg/kg.py who-reads coaching_sessions`)
- env `LP_OUTCOME_ACK_FALLBACK_MS` read at `bot/shared/services/coaching/lp-coaching/lp-outcome-ack.service.js:60:451e2ae0`

## Tests (all, generated)
- `lp-coaching-linker.service.js` ← `tests/coaching/coaching-flow-integration.test.js` · `tests/coaching/fidelity/corpus-ref-carries-subject.test.js` · `tests/coaching/fidelity/lp-corpus-linker.test.js` · `tests/coaching/lp-coaching-link.test.js`
- `lp-framework-prompt.service.js` ← `tests/coaching/coaching-flow-integration.test.js` · `tests/coaching/lp-coaching-link.test.js`
- `lp-list-selection.handler.js` ← `bot/tests/observe/bd-2kxxa2-media-target.test.js` · `bot/tests/observe/cancelled-observation-stays-cancelled.test.js` · `tests/coaching/lp-list-selection-handler.test.js` · `tests/coaching/meta-bill-nc3-lp-outcome-on-step2.test.js` · `tests/coaching/observe-gates.test.js`
- `lp-outcome-ack.service.js` ← `tests/meta-bill-cut/fx1-handoff-typing-and-acks.test.js` · `tests/meta-bill-cut/fx4-round3.test.js`
- `lp-selection-format.js` ← `tests/coaching/fidelity/lp-selection-format.test.js` · `tests/observe2/external-plan.test.js`
- `lp-selection-list.service.js` ← `tests/coaching/coaching-flow-integration.test.js` · `tests/coaching/fidelity/lp-corpus-linker.test.js` · `tests/coaching/fidelity/lp-selection-rowcap.test.js` · `tests/coaching/lp-coaching-link.test.js` · `tests/coaching/lp-observation-prompt.test.js` · `tests/language/urdu-gender-neutral-copy.test.js`
- `lp-step.service.js` ← `bot/tests/observe/bd-5azz0-lp-step.test.js` · `bot/tests/observe/bd-wwcgf-teacher-gets-observer-form.test.js` · `bot/tests/observe/cancelled-observation-stays-cancelled.test.js`
- `lp-text-paste.service.js` ← `tests/coaching/bd-we73k-pasted-lesson-plan.test.js`
- `recent-fidelity-lps.service.js` ← `tests/coaching/fidelity/recent-fidelity-lps-app-opens.test.js` · `tests/coaching/fidelity/recent-fidelity-lps.test.js` · `tests/observe2/external-plan.test.js`
- `send-lp-prompt.js` ← `tests/coaching/send-lp-prompt.test.js`

## Related (all, generated)
- docs: `bot/shared/services/coaching/CLAUDE.md`?
