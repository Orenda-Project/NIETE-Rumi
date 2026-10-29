# qa — E2E runners, QA impact check, hooks and the scheduled LaunchAgent
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=scripts/qa kg=af69fe628860 gen=e58e2d4a4859 overflow=6 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `e2e-mock.sh` — one-command mock-lane E2E run
- `impact.py` — which features a commit range touched and whether specs synced
- `install-hooks.sh` — one-time git hooksPath setup
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `look-gate/` | Phone-size layout gate for child-facing web quiz screens → `look-gate/CLAUDE.md` |
| `render-matrix/` | Render matrix: every web-quiz item shape drawn and checked for defects → `render-matrix/CLAUDE.md` |
| `impact.py` | Deterministic QA impact of a commit range: features touched, Gherkin specs synced, E2E run recorded; hook and CI |
| `install-hooks.sh` | Sets git core.hooksPath to .githooks/ (run by npm prepare); supports --quiet, --force, --uninstall |
| `e2e*` | 4 files; most used `e2e-web.test.sh`: Pins the web lane's wiring without a browser: never touches :4000, made-up data, ledger-valid row, scenario/code parity |
| `mask-ledger.py` | Rewrites the QA runs ledger masking phones and home paths, in place and idempotent; --check for CI (bd-5gyspy.3) |
| `test_impact.py` | Stdlib assertion tests for qa/impact.py: feature mapping, spec-sync trailers, recorded-run detection on temp git repos |
| … | 8 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `impact.py` ← imported by `scripts/qa/test_impact.py:21:6ecef21a`
- env read here: `CHECK_ONLY` · `CI` · `COMMIT` · `DATA` · `DB_POOL_MIN` · `DB_POOL_SIZE` · `E2E_BOT_PORT` · `E2E_CHROME_ON` · `E2E_LOCAL_DB` · `E2E_MOCK_FEATURES` · `E2E_MOCK_RUN_SUITE` · `E2E_NO_COMMIT` (+16)

## Never (human)
- Let commit-ledger-row.sh push or stage anything but runs.jsonl (commit-ledger-row.sh:7)
- Leave raw phones or home paths in the ledger: the repo is public (mask-ledger.py:4, bd-5gyspy.3)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `scripts/qa/e2e-mock.test.sh`? (e2e-mock.sh)
- `scripts/qa/e2e-web.test.sh`? (e2e-web.sh)
- … 1 more → `CLAUDE.index.md`

## Related (generated)
- skills: `niete-mock-e2e`?
- docs: `.claude/qa/SCHEDULE.md`? · `.claude/qa/ledgers/README.md`? · `.githooks/README.md`? · `docs/qa-automation.md`? · `scripts/CLAUDE.md`?
