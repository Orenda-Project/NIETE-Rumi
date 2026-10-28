# tests — Python tests for scripts/lib modules, the test-users predicate, ledger audit

<!-- kg:meta repo=NIETE-Rumi dir=scripts/tests kg=6f22052953fd gen=eaa09152f7f3 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `test_schema_ledger_audit.py` — shows how a runner is tested against a stand-in connection
- `test_predicate_sql.py` — pins the test-users predicate guards
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `test_legacy_taleemabad_import.py` | Red-first tests for lib/legacy_taleemabad_import.py decision logic (bd-s42dye.4) |
| `CLAUDE.md` | (unmapped) |
| `test_mark_test_users.py` | Tests mark_test_users selection merge, per-rule counts, empty-selection refusal and signed-ids drift refusals |
| `test_roster_school_backfill.py` | Red-first tests for roster_school_backfill decision classes (backfill, conflict, ambiguous, skipped) |
| `test_schema_ledger.py` | Tests schema_ledger version parsing, file/ledger diff, and which DDL in a migration becomes a probe |
| `test_set_organization.py` | Tests set_organization classification rules across the six sectors, HQ, test, Durbeen and deleted rows |
| `test_predicate_sql.py` | Pins the test-users predicate's coach guards and NULL-safe IS DISTINCT FROM role check |
| `test_schema_ledger_audit.py` | End-to-end test of schema-ledger-audit.py on a stand-in connection: output, SELECT-only statements, rollback |

## Who reads this (generated)
- (none)

## Never (human)
- Keep both coach guards in the test-users predicate; this test pins them (test_predicate_sql.py:7)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `scripts/CLAUDE.index.md`? · `scripts/CLAUDE.md`? · `scripts/lib/CLAUDE.index.md`? · `scripts/lib/CLAUDE.md`? · `scripts/tests/CLAUDE.md`?
