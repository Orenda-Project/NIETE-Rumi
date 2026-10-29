# lib — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=scripts/lib -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `legacy-media-rehost.rules.js` | Pure rules: which legacy training media need re-hosting, and target refs; used by rehost-legacy-training-media.js |
| `legacy_taleemabad_import.py` | Pure decision logic (question filters, ordering, insert vs update plan) behind import-legacy-taleemabad.py (bd-s42dye.4) |
| `mark_test_users.py` | Pure helpers merging predicate rows with an allowlist and counting selections per rule for mark-test-users.py |
| `roster_school_backfill.py` | Pure classifier (backfill, conflict, ambiguous, skipped) for backfill-school-id-from-roster.py |
| `schema_ledger.py` | Pure helpers that diff migration files against schema_versions and plan strong/weak probes for schema-ledger-audit.py |
| `set_organization.py` | Rules and transactional apply normalizing users.organization to niete in the six ICT sectors; for set-organization.py |
| `test_textbook_import.py` | Red-first unittest for textbook_import normalisation, one case per defect found in 27 ICT books (bd-60012) |
| `textbook_import.py` | General importer: reads a book's OCR pages and chapters from the staging tenant, writes our textbook tables |
| `training-band-derivation.js` | Derives a teacher's grade band(s) and training programs from users.training_bands, levels and grades (bd-2672) |

## Who reads this (all, generated)
- `legacy-media-rehost.rules.js` ← imported by `scripts/rehost-legacy-training-media.js:91:b653db42`
- `textbook_import.py` ← imported by `scripts/lib/test_textbook_import.py:11:f7838b5f`
- `training-band-derivation.js` ← imported by `scripts/backfill-training-assignments.js:63:f4d9178f`

## Tests (all, generated)
- `legacy-media-rehost.rules.js` ← `tests/training/bd-s42dye-4-legacy-media-rehost.test.js`
- `legacy_taleemabad_import.py` ← `scripts/tests/test_legacy_taleemabad_import.py`?
- `mark_test_users.py` ← `scripts/tests/test_mark_test_users.py`?
- `roster_school_backfill.py` ← `scripts/tests/test_roster_school_backfill.py`?
- `schema_ledger.py` ← `scripts/tests/test_schema_ledger.py`?
- `set_organization.py` ← `scripts/tests/test_set_organization.py`?
- `textbook_import.py` ← `scripts/lib/test_textbook_import.py`
- `training-band-derivation.js` ← `tests/training/bd-2672-backfill-assignment.test.js` · `tests/training/bd-43478-band-selection.test.js`

## Related (all, generated)
- docs: `scripts/CLAUDE.md`?
