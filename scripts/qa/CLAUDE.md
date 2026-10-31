# qa — the shared engine link, the web lane, ledger masking and the scheduled LaunchAgent
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=scripts/qa kg=8f41bbd9e993 gen=c1e35c0aa9b5 overflow=5 rendered=2026-10-30 kg.py=1.1.0 -->

## Entry points
- `link-engine.sh` — borrow the shared E2E engine from rumi-agent-home and point git at `.githooks` (`npm install` runs it)
- `e2e-web.sh` — the portal browser E2E lane on a local stack at this HEAD
- `niete-e2e-schedule.sh` — install, inspect or fire the two-hourly scheduled E2E run
- The mock lane and the impact check run from the engine: `npm run e2e:mock`, `npm run qa:impact` (bd-9157r.1)
<!-- read: bd-9157r.9 2026-10-30 -->

## Children (generated)
| path | purpose |
|---|---|
| `look-gate/` | Phone-size layout gate for child-facing web quiz screens → `look-gate/CLAUDE.md` |
| `render-matrix/` | Render matrix: every web-quiz item shape drawn and checked for defects → `render-matrix/CLAUDE.md` |
| `link-engine.sh` | Links the shared E2E engine from rumi-agent-home into .claude/qa/engine and sets core.hooksPath; npm prepare runs it |
| `e2e-web.test.sh` | Pins the web lane's wiring without a browser: never touches :4000, made-up data, ledger-valid row, scenario/code parity |
| `engine-bridge.test.sh` | Holds the borrowed-engine line: no engine copy committed here; every git, npm and Claude entry point still works |
| `mask-ledger.py` | Rewrites the QA runs ledger masking phones and home paths, in place and idempotent; --check for CI (bd-5gyspy.3) |
| … | 5 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `CHECK_ONLY` · `CI` · `COMMIT` · `DATA` · `DB_POOL_MIN` · `DB_POOL_SIZE` · `E2E_BOT_PORT` · `E2E_ENGINE` · `E2E_NO_COMMIT` · `E2E_TRIGGER` · `E2E_WEB_PARALLEL` · `LOCAL_DB_PG_BIN` (+10)

## Never (human)
- Copy an engine file back in here: the harness is borrowed through `link-engine.sh`, and `engine-bridge.test.sh` fails on a copy (bd-9157r.1)
- Leave raw phones or home paths in the ledger: the repo is public (mask-ledger.py:4, bd-5gyspy.3)
<!-- read: bd-9157r.9 2026-10-30 -->

## Tests (generated)
- `scripts/qa/e2e-web.test.sh`? (e2e-web.sh)

## Related (generated)
- docs: `.claude/CLAUDE.md`? · `.claude/commands/niete-e2e.md`? · `.claude/qa/README.md`? · `.claude/qa/SCHEDULE.md`? · `.claude/qa/ledgers/README.md`? · `.githooks/README.md`? (+2)
