# qa — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=scripts/qa -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `look-gate/` | Phone-size layout gate for child-facing web quiz screens → `look-gate/CLAUDE.md` |
| `render-matrix/` | Render matrix: every web-quiz item shape drawn and checked for defects → `render-matrix/CLAUDE.md` |
| `commit-ledger-row.sh` | Commits only the new runs.jsonl row an E2E run appended, on the tested branch; never pushes, skips shared branches |
| `e2e-mock.sh` | One-command NIETE E2E on the mock lane with a per-run local DB; wraps run-suite.sh, results to .claude/qa/results |
| `e2e-mock.test.sh` | Hermetic test of e2e-mock.sh with run-suite.sh stubbed: argument passing, slot and DB handling (bd-amxdhg) |
| `e2e-web.sh` | Runs the portal browser E2E lane on a local stack at this HEAD: slots, --keep, --headed, --parallel (bd-hnhlgn.5) |
| `e2e-web.test.sh` | Pins the web lane's wiring without a browser: never touches :4000, made-up data, ledger-valid row, scenario/code parity |
| `impact.py` | Deterministic QA impact of a commit range: features touched, Gherkin specs synced, E2E run recorded; hook and CI |
| `install-hooks.sh` | Sets git core.hooksPath to .githooks/ (run by npm prepare); supports --quiet, --force, --uninstall |
| `mask-ledger.py` | Rewrites the QA runs ledger masking phones and home paths, in place and idempotent; --check for CI (bd-5gyspy.3) |
| `niete-e2e-schedule.sh` | Installs, inspects, removes or fires the two-hourly NIETE E2E LaunchAgent |
| `niete-e2e-scheduled.sh` | LaunchAgent wrapper: checks preconditions, writes BLOCKED report on refusal, takes driver lock, resolves scope from diff |
| `test_impact.py` | Stdlib assertion tests for qa/impact.py: feature mapping, spec-sync trailers, recorded-run detection on temp git repos |
| `test_niete_e2e_schedule.sh` | Tests the scheduled E2E run's --resolve-scope: which features a fire drives since the last recorded run (bd-dzyl6) |
| `verify-clean-clone.sh` | Proves the QA pipeline from a fresh clone with a scrubbed environment: hooks, markers, Claude Code hook payloads |

## Who reads this (all, generated)
- `impact.py` ← imported by `scripts/qa/test_impact.py:21:6ecef21a`
- env `CHECK_ONLY` read at `scripts/qa/niete-e2e-scheduled.sh:122:85c39f7e`
- env `CI` read at `scripts/qa/e2e-web.sh:225:30bb3321` · `scripts/qa/install-hooks.sh:26:91982967`
- env `COMMIT` read at `scripts/qa/e2e-web.sh:107:b3de0717`
- env `DATA` read at `scripts/qa/e2e-web.sh:211:98dfc534`
- env `DB_POOL_MIN` read at `scripts/qa/e2e-web.sh:214:c8e776f4`
- env `DB_POOL_SIZE` read at `scripts/qa/e2e-web.sh:214:c8e776f4`
- env `E2E_BOT_PORT` read at `scripts/qa/e2e-web.sh:267:16ff1446`
- env `E2E_CHROME_ON` read at `scripts/qa/impact.py:421:86aed7b1`
- env `E2E_LOCAL_DB` read at `scripts/qa/e2e-mock.sh:37:693d0243`
- env `E2E_MOCK_FEATURES` read at `scripts/qa/impact.py:397:a6810f1f`
- env `E2E_MOCK_RUN_SUITE` read at `scripts/qa/e2e-mock.sh:17:7cd334ee`
- env `E2E_NO_COMMIT` read at `scripts/qa/commit-ledger-row.sh:16:c7379a87` · `scripts/qa/e2e-web.sh:232:36454b43`
- env `E2E_TRIGGER` read at `scripts/qa/e2e-web.sh:225:30bb3321`
- env `E2E_WEB_PARALLEL` read at `scripts/qa/e2e-web.sh:126:78d87883`
- env `LOCAL_DB_PG_BIN` read at `scripts/qa/e2e-web.sh:47:9342117f`
- env `LOCAL_DB_PG_PORT` read at `scripts/qa/e2e-web.sh:271:d1a51606`
- env `NIETE_E2E_CDP_PORTS` read at `scripts/qa/niete-e2e-scheduled.sh:176:8bbdc5b5`
- env `NIETE_E2E_DRIVER` read at `scripts/qa/niete-e2e-schedule.sh:27:f67a1613` · `scripts/qa/niete-e2e-scheduled.sh:19:1789b710`
- env `NIETE_E2E_PULL` read at `scripts/qa/niete-e2e-scheduled.sh:145:7b5db049`
- env `NIETE_E2E_REPO` read at `scripts/qa/niete-e2e-schedule.sh:17:74094b66` · `scripts/qa/niete-e2e-scheduled.sh:18:74094b66`
- env `NIETE_E2E_SCOPE` read at `scripts/qa/niete-e2e-schedule.sh:51:a6b54b36` · `scripts/qa/niete-e2e-scheduled.sh:21:8c65f312`
- env `QA_CASSETTE_OWNER` read at `scripts/qa/impact.py:361:30ea4e2c`
- env `QA_E2E_PROOF` read at `scripts/qa/impact.py:644:04121841`
- env `QA_SPEC_FRESHNESS` read at `scripts/qa/impact.py:643:05d369a0`
- env `RUN_ID` read at `scripts/qa/e2e-web.sh:107:b3de0717`
- env `WA_TABS` read at `scripts/qa/niete-e2e-scheduled.sh:184:d26220ee`
- env `WEB_HEADED` read at `scripts/qa/e2e-web.sh:224:a872ef2f`
- env `WEB_SLOWMO` read at `scripts/qa/e2e-web.sh:229:e2b0960d`

## Tests (all, generated)
- `e2e-mock.sh` ← `scripts/qa/e2e-mock.test.sh`?
- `e2e-web.sh` ← `scripts/qa/e2e-web.test.sh`?
- `impact.py` ← `scripts/qa/test_impact.py`

## Related (all, generated)
- skills: `niete-mock-e2e`?
- docs: `.claude/qa/SCHEDULE.md`? · `.claude/qa/ledgers/README.md`? · `.githooks/README.md`? · `docs/qa-automation.md`? · `scripts/CLAUDE.md`?
