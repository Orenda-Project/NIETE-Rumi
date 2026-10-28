# L12 — Simulation stack: outbound echo, Axiom reply source, seed-visit, stack guards

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test/L12 kg=564cd3646d10 gen=e067a9a488c5 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `sim-stack.test.js` — runs sim-stack.sh refusal paths
- `outbound-echo.test.js` — whatsapp.outbound_echo for synthetic phones
- Run from repo root: `node tests/run.js tests/child-test/L12 --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `outbound-echo.test.js` | Tests whatsapp.outbound_echo: listed synthetic phones get sent text echoed so the sandbox driver can read replies |
| `CLAUDE.md` | (unmapped) |
| `coach-l4-protocol.test.js` | Coach player against L4's real conversation machine: list rows, Present/Absent/Refused, card images, voice-note ack |
| `driver-replies-resolve.test.js` | Pins that the sim driver resolves a bare module name from sandbox.json next to the driver (L12) |
| `replies-axiom.test.js` | Tests the sim driver's Axiom reply source: builds APL for whatsapp.outbound_echo lines, refuses non-digit phones |
| `seed-visit.test.js` | Tests seed-visit: seeds today's observe2 visit for the SIM coach, sandbox-only, idempotent per day, removable |
| `sim-stack.test.js` | Runs sim-stack.sh for real: refuses a non-sandbox env, a production DATABASE_URL or a wrong R2 bucket before seeding |
| `timeline-sent-at.test.js` | Pins that an inbound item carrying the bot's sent_ms lands on the sim timeline at bot-send time, not Axiom ingest time |

## Who reads this (generated)
- (none)

## Never (human)
- sim-stack.sh refuses anything not the NIETE sandbox before seeding (tests/child-test/L12/sim-stack.test.js:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `tests/child-test/CLAUDE.md`? · `tests/child-test/L12/CLAUDE.md`?
