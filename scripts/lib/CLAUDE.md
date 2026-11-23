# lib — Pure decision logic imported by the write scripts so judgement is testable
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=scripts/lib kg=bf557da4c770 gen=c556dacc71af overflow=23 rendered=2026-11-20 kg.py=1.1.0 -->

## Entry points
- `roster_school_backfill.py` — example pure classifier: no I/O, no database
- `schema_ledger.py` — migration-vs-ledger diff and probe planning
- `training-band-derivation.js` — grade band to training program mapping
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 2 files) |
| `certificate-issuing-env.js` | (unmapped) |
| `textbook_import.py` | General importer: reads a book's OCR pages and chapters from the staging tenant, writes our textbook tables |
| `training-band-derivation.js` | Derives a teacher's grade band(s) and training programs from users.training_bands, levels and grades (bd-2672) |
| `corpus_reader.py` | (unmapped) |
| `gb*` | 3 files; most used `gb-roster.js`: (unmapped) |
| `legacy-media-rehost.rules.js` | Pure rules: which legacy training media need re-hosting, and target refs; used by rehost-legacy-training-media.js |
| `test*` | 4 files; most used `test_textbook_import.py`: Red-first unittest for textbook_import normalisation, one case per defect found in 27 ICT books (bd-60012) |
| `roster_school_backfill.py` | Pure classifier (backfill, conflict, ambiguous, skipped) for backfill-school-id-from-roster.py |
| … | 11 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `certificate-issuing-env.js` ← imported by `scripts/release-isaps-held-attempts.js:26:22b68bd0` · `scripts/settle-certificates.js:28:22b68bd0` (+1)
- `textbook_import.py` ← imported by `scripts/lib/corpus_reader.py:43:00575dd4` · `scripts/lib/gb_reader.py:34:204bd090` (+1)
- `corpus_reader.py` ← imported by `scripts/lib/gb_reader.py:33:f242b5b9` · `scripts/lib/test_corpus_reader.py:16:90a09856`
- `gb-roster.js` ← imported by `scripts/seed-gb-roster.js:21:c3f46b81`
- … 3 more → `CLAUDE.index.md`

## Never (human)
- Add I/O to these modules: runners own reads and the one transaction, modules own judgement (roster_school_backfill.py:2)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `scripts/lib/test_corpus_reader.py` (corpus_reader.py)
- `scripts/lib/test_gb_reader.py` (gb_reader.py)
- … 14 more → `CLAUDE.index.md`

## Related (generated)
- docs: `scripts/CLAUDE.md`?
