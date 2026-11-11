# assessment — Assessment generator: ICT textbook import and offline quality evals
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=scripts/assessment kg=8d650a59f75f gen=7dec6b577411 overflow=0 rendered=2026-11-10 kg.py=1.1.0 -->

## Entry points
- `import-ict-textbooks.py` — which ICT books load, via lib/textbook_import.py
- `eval-run.js` — runs the real generation pipeline offline and keeps every artifact
- `eval-plan.js` — which chapters and exam specs each book gets
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `eval/` | → (no door; 2 files) |
| `fixtures/` | → (no door; 1 files) |
| `eval*` | 3 files; most used `eval-plan.js`: Pure planner for the assessment eval: chapter picks per book and two exam specs; used by eval-run.js |
| `corpus_import.py` | (unmapped) |
| `en_book_import.py` | (unmapped) |
| `gb_import.py` | (unmapped) |
| `test*` | 4 files; most used `test_import_corpus_cli.py`: (unmapped) |
| `books-6-12.json` | (unmapped) |
| `import-ict-textbooks.py` | Thin ICT book list that drives lib/textbook_import.py to load textbook pages and chapters for the assessment generator |

## Who reads this (generated)
- `corpus_import.py` ← imported by `scripts/assessment/test_import_corpus_cli.py:20:3122c406` · `scripts/assessment/import-ict-textbooks.py:87:6809cee8`
- `en_book_import.py` ← imported by `scripts/assessment/import-ict-textbooks.py:95:7608d063` · `scripts/assessment/test_en_book_import.py:21:ef66eec2`
- `eval-plan.js` ← imported by `scripts/assessment/eval-per-type-counts.js:40:9730d1c6` · `scripts/assessment/eval-run.js:46:1bcddaf9`
- `gb_import.py` ← imported by `scripts/assessment/import-ict-textbooks.py:91:8fcc064b` · `scripts/assessment/test_gb_import.py:19:849aa77e`
- `test_import_corpus_cli.py` ← imported by `scripts/assessment/test_import_corpus_cli_wire.py:14:b8066d44`
- env read here: `EVAL_EXPECT_SUPABASE_REF` · `SUPABASE_URL`

## Never (human)
- Assessment files must be identical on main and sandbox (scripts/assessment-parity.sh:2)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `scripts/assessment/test_en_book_import.py` (en_book_import.py)
- `scripts/assessment/test_gb_import.py` (gb_import.py)
- `scripts/assessment/test_import_corpus_cli.py` (corpus_import.py)
- `tests/assessment/eval-plan.test.js` (eval-plan.js)

## Related (generated)
- docs: `scripts/CLAUDE.md`?
