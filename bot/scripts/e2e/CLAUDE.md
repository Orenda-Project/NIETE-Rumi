# e2e — The local mock E2E lane: fake Graph API, local Postgres, local R2, stack scripts
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/scripts/e2e kg=9577b3ca0ffe gen=9b6c656e466f overflow=12 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `local-stack.sh` — start the bot from one pinned commit
- `mock-graph-api.js` — Meta stand-in and outbox
- `local-db.sh` — per-run local database
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `child-test-sim/` | Simulated coach visit against a fake, mock or sandbox bot for the child test → `child-test-sim/CLAUDE.md` |
| `lp-feedback-e2e.js` | Local E2E smoke of the full LP feedback lifecycle against real NIETE Supabase with an in-memory Redis stub and stubbed… |
| `mock*` | 3 files; most used `mock-graph-api.js`: Local stand-in for Meta's WhatsApp Cloud API: serves /messages, keeps an ordered outbox, injects forged webhooks |
| `flow-emulator.js` | Plays Meta's side of a WhatsApp Flow from stored FLOW_JSON, including endpoint encryption; not a rendering test |
| `dns-pin.js` | node -r preload giving the mock lane a public-resolver DNS fallback when the machine's resolver fails |
| `flow-inventory.js` | Fetches each published Flow JSON by id, stores it as a fixture, records drift against repo copies and a component census |
| `local*` | 13 files; most used `local-stack.sh`: Starts the bot from one pinned commit in a detached worktree behind the mock Graph API for the E2E mock lane; up/down/r… |
| `lp612-doc.js` | Puts or removes one Grades 6-12 lesson document in the lane's R2 bucket so backfilled deliveries have renders to point… |
| … | 29 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Never touch the NIETE production project; hero-text.js exits 3 on it (hero-text.js:17)
- A run must not kill another run's ports (bd-d2zge, local-stack-ports.test.sh:2)
- baseline/sandbox-copy refuse any source but the sandbox ref (local-db.sh:303)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- skills: `niete-mock-e2e`?
- docs: `.claude/skills/niete-mock-e2e/reference/exit-codes.md`? · `bot/scripts/CLAUDE.md`? · `bot/shared/services/cache/CLAUDE.md`? · `docs/e2e-mock-lane.md`? · `docs/onboarding/local-portal.md`?
