# lib — Pure decision logic imported by the write scripts so judgement is testable
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=scripts/lib kg=6bcff30d5419 gen=972e41d34453 overflow=9 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `roster_school_backfill.py` — example pure classifier: no I/O, no database
- `schema_ledger.py` — migration-vs-ledger diff and probe planning
- `training-band-derivation.js` — grade band to training program mapping
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `training-band-derivation.js` | Derives a teacher's grade band(s) and training programs from users.training_bands, levels and grades (bd-2672) |
| `legacy-media-rehost.rules.js` | Pure rules: which legacy training media need re-hosting, and target refs; used by rehost-legacy-training-media.js |
| `test_textbook_import.py` | Red-first unittest for textbook_import normalisation, one case per defect found in 27 ICT books (bd-60012) |
| `textbook_import.py` | General importer: reads a book's OCR pages and chapters from the staging tenant, writes our textbook tables |
| `legacy_taleemabad_import.py` | Pure decision logic (question filters, ordering, insert vs update plan) behind import-legacy-taleemabad.py (bd-s42dye.4) |
| `mark_test_users.py` | Pure helpers merging predicate rows with an allowlist and counting selections per rule for mark-test-users.py |
| `roster_school_backfill.py` | Pure classifier (backfill, conflict, ambiguous, skipped) for backfill-school-id-from-roster.py |
| … | 2 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `legacy-media-rehost.rules.js` ← imported by `scripts/rehost-legacy-training-media.js:91:b653db42`
- `textbook_import.py` ← imported by `scripts/lib/test_textbook_import.py:11:f7838b5f`
- `training-band-derivation.js` ← imported by `scripts/backfill-training-assignments.js:63:f4d9178f`

## Never (human)
- Add I/O to these modules: runners own reads and the one transaction, modules own judgement (roster_school_backfill.py:2)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `scripts/lib/test_textbook_import.py` (textbook_import.py)
- `scripts/tests/test_legacy_taleemabad_import.py`? (legacy_taleemabad_import.py)
- … 7 more → `CLAUDE.index.md`

## Related (generated)
- docs: `scripts/CLAUDE.md`?
