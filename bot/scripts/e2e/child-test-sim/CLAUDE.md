# child-test-sim — Simulated coach visit against a fake, mock or sandbox bot for the child test
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/scripts/e2e/child-test-sim kg=21d34871772c gen=e87f31eca44e overflow=13 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `driver.js` — CLI entry and modes
- `coach.js` — plays the visit step by step
- `transports.js` — how the coach reaches a bot
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `check-play.js` | Plays the simulated coach doing the child-test check Flow per child (INIT, per-screen data exchange, completion) |
| `coach.js` | Plays one simulated coach's five-child visit against a bot via a transport, logging each step to a timeline |
| `timeline.js` | Writes one JSON line per simulated-visit event and summarises per-child timing and rtt samples |
| `driver.js` | CLI driver for the child-test visit simulation in fake, mock or sandbox mode, timed end to end |
| `CLAUDE.md` | (unmapped) |
| … | 8 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `observation_field_forms` (written by `seed-visit.js`) ← read by `bot/shared/services/child-test/app/app-api.service.js:184:9343047e`? · `bot/shared/services/child-test/app/sa-api.service.js:96:cff3d781`? (+4)
- column `observation_field_forms.observer_user_id` (written by `seed-visit.js`) ← read by `bot/shared/services/child-test/app/app-api.service.js:185:bbf37085` · `bot/shared/services/child-test/app/sa-api.service.js:97:d5a7d17b` (+3)
- column `observation_field_forms.visit_context` (written by `seed-visit.js`) ← read by `bot/shared/services/child-test/app/app-api.service.js:185:bbf37085` · `bot/shared/services/child-test/app/sa-api.service.js:97:d5a7d17b` (+3)
- … 5 more → `CLAUDE.index.md`

## Never (human)
- seed-visit.js writes to the NIETE sandbox only; it throws on any other project ref (seed-visit.js:32)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/scripts/e2e/CLAUDE.index.md`? · `bot/scripts/e2e/CLAUDE.md`? · `bot/scripts/e2e/child-test-sim/CLAUDE.index.md`? · `bot/scripts/e2e/child-test-sim/CLAUDE.md`? · `bot/shared/services/child-test/CLAUDE.index.md`? (+7)
