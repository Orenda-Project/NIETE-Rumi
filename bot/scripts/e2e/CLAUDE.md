# e2e — The local mock E2E lane: fake Graph API, local Postgres, local R2, stack scripts
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/scripts/e2e kg=41640515ec18 gen=3b1f9b74d046 overflow=18 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `local-stack.sh` — start the bot from one pinned commit
- `mock-graph-api.js` — Meta stand-in and outbox
- `local-db.sh` — per-run local database
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `child-test-sim/` | Simulated coach visit against a fake, mock or sandbox bot for the child test → `child-test-sim/CLAUDE.md` |
| `CLAUDE.index.md` | (unmapped) |
| `lp-feedback-e2e.js` | Local E2E smoke of the full LP feedback lifecycle against real NIETE Supabase with an in-memory Redis stub and stubbed… |
| `mock*` | 3 files; most used `mock-graph-api.js`: Local stand-in for Meta's WhatsApp Cloud API: serves /messages, keeps an ordered outbox, injects forged webhooks |
| `flow-emulator.js` | Plays Meta's side of a WhatsApp Flow from stored FLOW_JSON, including endpoint encryption; not a rendering test |
| … | 17 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `lesson_plans` (written by `lp-feedback-e2e.js`) ← read by `bot/shared/database/bot-helpers.js:411:611f2601`? · `bot/shared/routes/quiz-flow-endpoint.js:158:611f2601`? (+15)
- table `lp_feedback` (written by `lp-feedback-e2e.js`) ← read by `bot/shared/services/lp-feedback.service.js:305:5cdfa157`? · `bot/scripts/migration/apply-017-lp-feedback.js:74:3f0e2a4e`?
- … 1 more → `CLAUDE.index.md`

## Never (human)
- Never touch the NIETE production project; hero-text.js exits 3 on it (hero-text.js:17)
- A run must not kill another run's ports (bd-d2zge, local-stack-ports.test.sh:2)
- baseline/sandbox-copy refuse any source but the sandbox ref (local-db.sh:303)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- skills: `niete-mock-e2e`?
- docs: `.claude/skills/niete-mock-e2e/reference/exit-codes.md`? · `bot/scripts/CLAUDE.index.md`? · `bot/scripts/CLAUDE.md`? · `bot/scripts/e2e/CLAUDE.index.md`? · `bot/scripts/e2e/CLAUDE.md`? · `bot/scripts/e2e/child-test-sim/CLAUDE.index.md`? (+15)
