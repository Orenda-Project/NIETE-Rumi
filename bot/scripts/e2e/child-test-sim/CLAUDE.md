# child-test-sim — Simulated coach visit against a fake, mock or sandbox bot for the child test

<!-- kg:meta repo=NIETE-Rumi dir=bot/scripts/e2e/child-test-sim kg=98a7e472af19 gen=c607a43bd2ea overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `driver.js` — CLI entry and modes
- `coach.js` — plays the visit step by step
- `transports.js` — how the coach reaches a bot
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `check-play.js` | Plays the simulated coach doing the child-test check Flow per child (INIT, per-screen data exchange, completion) |
| `coach.js` | Plays one simulated coach's five-child visit against a bot via a transport, logging each step to a timeline |
| `timeline.js` | Writes one JSON line per simulated-visit event and summarises per-child timing and rtt samples |
| `driver.js` | CLI driver for the child-test visit simulation in fake, mock or sandbox mode, timed end to end |
| `replay-check.js` | Replays a finished run's AI marks through the coach check offline under chosen pre-fill modes and coach models (bd-s1oo… |
| `transports.js` | Mock and sandbox transports through which the simulated coach sends messages and media to a bot |
| `fake-bot-v3.js` | In-process stand-in for the bot side of a battery-v3 visit, used by driver --battery v3 dry mode and coach tests |
| `replies-axiom.js` | Rebuilds what the sandbox bot sent a synthetic coach from its outbound_echo logs in Axiom, for sandbox mode |
| `fake-bot.js` | HTTP peer standing in for the child-test conversation before the real handler existed; speaks CONTRACT v0.2 ids |
| `seed-visit.js` | Seeds (or removes) today's sealed observe2 visit for the simulated coach in the NIETE sandbox only |
| `coach-actions.json` | Timing model: seconds each simulated coach action costs inside the check Flow, with sources |
| `sim-stack.sh` | Brings up or tears down the local mock-lane stack for the child-test simulation, refusing prod refs (bd-s1oo0.13) |

## Who reads this (generated)
- (none)

## Never (human)
- seed-visit.js writes to the NIETE sandbox only; it throws on any other project ref (seed-visit.js:32)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/e2e/CLAUDE.md`? · `bot/vendor/lp-v9/diagrams/types/CLAUDE.md`? · `scripts/child-test/CLAUDE.md`?
