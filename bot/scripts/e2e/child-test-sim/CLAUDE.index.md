# child-test-sim — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/scripts/e2e/child-test-sim -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `check-play.js` | Plays the simulated coach doing the child-test check Flow per child (INIT, per-screen data exchange, completion) |
| `coach-actions.json` | Timing model: seconds each simulated coach action costs inside the check Flow, with sources |
| `coach.js` | Plays one simulated coach's five-child visit against a bot via a transport, logging each step to a timeline |
| `driver.js` | CLI driver for the child-test visit simulation in fake, mock or sandbox mode, timed end to end |
| `fake-bot-v3.js` | In-process stand-in for the bot side of a battery-v3 visit, used by driver --battery v3 dry mode and coach tests |
| `fake-bot.js` | HTTP peer standing in for the child-test conversation before the real handler existed; speaks CONTRACT v0.2 ids |
| `replay-check.js` | Replays a finished run's AI marks through the coach check offline under chosen pre-fill modes and coach models (bd-s1oo… |
| `replies-axiom.js` | Rebuilds what the sandbox bot sent a synthetic coach from its outbound_echo logs in Axiom, for sandbox mode |
| `seed-visit.js` | Seeds (or removes) today's sealed observe2 visit for the simulated coach in the NIETE sandbox only |
| `sim-stack.sh` | Brings up or tears down the local mock-lane stack for the child-test simulation, refusing prod refs (bd-s1oo0.13) |
| `timeline.js` | Writes one JSON line per simulated-visit event and summarises per-child timing and rtt samples |
| `transports.js` | Mock and sandbox transports through which the simulated coach sends messages and media to a bot |

## Who reads this (all, generated)
- column `observation_field_forms.observer_user_id` (written by `seed-visit.js`) ← read by `bot/shared/services/child-test/app/app-api.service.js:185:bbf37085` · `bot/shared/services/child-test/app/sa-api.service.js:97:d5a7d17b` · `bot/shared/services/child-test/conversation/context.js:49:0950e2a7` · `bot/shared/services/child-test/store.js:156:5f914959` (+1: `python3 kg/kg.py who-reads observation_field_forms.observer_user_id`)
- column `observation_field_forms.opened_at` (written by `seed-visit.js`) ← read by `bot/shared/services/observe/observe2/field-form.store.js:80:852be94c`
- column `observation_field_forms.sealed_at` (written by `seed-visit.js`) ← read by `bot/shared/services/child-test/app/app-api.service.js:185:bbf37085` · `bot/shared/services/observe/observe2/field-form.store.js:73:c9e664ab`
- column `observation_field_forms.teacher_user_id` (written by `seed-visit.js`) ← read by `bot/shared/services/child-test/conversation/context.js:49:0950e2a7` · `bot/shared/services/observe/observe2/field-form.store.js:201:7be969cb`
- column `observation_field_forms.visit_context` (written by `seed-visit.js`) ← read by `bot/shared/services/child-test/app/app-api.service.js:185:bbf37085` · `bot/shared/services/child-test/app/sa-api.service.js:97:d5a7d17b` · `bot/shared/services/child-test/conversation/context.js:49:0950e2a7` · `bot/shared/services/child-test/store.js:156:5f914959` (+1: `python3 kg/kg.py who-reads observation_field_forms.visit_context`)
- table `observation_field_forms` whole row (`*`) (written by `seed-visit.js`) ← read by `bot/shared/services/observe/observe2/field-form.store.js:57:d2b02c3e`?
- table `observation_field_forms` (written by `seed-visit.js`) ← read by `bot/shared/services/child-test/app/app-api.service.js:184:9343047e`? · `bot/shared/services/child-test/app/sa-api.service.js:96:cff3d781`? · `bot/shared/services/child-test/conversation/context.js:48:88aad8a1`? · `bot/shared/services/child-test/store.js:155:455ceb8f`? (+2: `python3 kg/kg.py who-reads observation_field_forms`)
- env `CHILD_TEST_PREFILL_MODE` read at `bot/scripts/e2e/child-test-sim/driver.js:121:57b8dc69`
- env `E2E_MOCK_URL` read at `bot/scripts/e2e/child-test-sim/driver.js:180:d9ca7dd8`
- env `SUPABASE_SERVICE_ROLE_KEY` read at `bot/scripts/e2e/child-test-sim/seed-visit.js:85:24e899d1`
- env `SUPABASE_URL` read at `bot/scripts/e2e/child-test-sim/seed-visit.js:82:eb12de3c`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/scripts/e2e/CLAUDE.index.md`? · `bot/scripts/e2e/CLAUDE.md`? · `bot/scripts/e2e/child-test-sim/CLAUDE.index.md`? · `bot/scripts/e2e/child-test-sim/CLAUDE.md`? · `bot/shared/services/child-test/CLAUDE.index.md`? · `bot/shared/services/child-test/CLAUDE.md`? · `bot/shared/services/child-test/check-flow/CLAUDE.index.md`? · `bot/shared/services/child-test/check-flow/CLAUDE.md`? · `bot/vendor/lp-v9/diagrams/types/CLAUDE.index.md`? · `bot/vendor/lp-v9/diagrams/types/CLAUDE.md`? · `scripts/child-test/CLAUDE.index.md`? · `scripts/child-test/CLAUDE.md`?
