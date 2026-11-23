# assessment — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=scripts/assessment -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `eval/` | → (no door; 2 files) |
| `fixtures/` | → (no door; 1 files) |
| `books-6-12.json` | (unmapped) |
| `corpus_import.py` | (unmapped) |
| `en_book_import.py` | (unmapped) |
| `eval-per-type-counts.js` | Eval: checks the assessment generator delivers the per-question-type counts asked for, using deliberately uneven splits |
| `eval-plan.js` | Pure planner for the assessment eval: chapter picks per book and two exam specs; used by eval-run.js |
| `eval-run.js` | Runs real BookContent, Generation and Renderer services over every ICT book offline, saving pages, prompts, JSON, papers |
| `gb_import.py` | (unmapped) |
| `import-ict-textbooks.py` | Thin ICT book list that drives lib/textbook_import.py to load textbook pages and chapters for the assessment generator |
| `test_en_book_import.py` | (unmapped) |
| `test_gb_import.py` | (unmapped) |
| `test_import_corpus_cli.py` | (unmapped) |
| `test_import_corpus_cli_wire.py` | (unmapped) |

## Who reads this (all, generated)
- `corpus_import.py` ← imported by `scripts/assessment/test_import_corpus_cli.py:20:3122c406` · `scripts/assessment/import-ict-textbooks.py:87:6809cee8`
- `en_book_import.py` ← imported by `scripts/assessment/import-ict-textbooks.py:95:7608d063` · `scripts/assessment/test_en_book_import.py:21:ef66eec2`
- `eval-plan.js` ← imported by `scripts/assessment/eval-per-type-counts.js:40:9730d1c6` · `scripts/assessment/eval-run.js:46:1bcddaf9`
- `gb_import.py` ← imported by `scripts/assessment/import-ict-textbooks.py:91:8fcc064b` · `scripts/assessment/test_gb_import.py:19:849aa77e`
- `test_import_corpus_cli.py` ← imported by `scripts/assessment/test_import_corpus_cli_wire.py:14:b8066d44`
- env `EVAL_EXPECT_SUPABASE_REF` read at `scripts/assessment/eval-per-type-counts.js:31:9fd1bd13` · `scripts/assessment/eval-run.js:35:17a530d4`
- env `SUPABASE_URL` read at `scripts/assessment/eval-per-type-counts.js:30:eb876ebc` · `scripts/assessment/eval-run.js:34:eb876ebc`

## Tests (all, generated)
- `corpus_import.py` ← `scripts/assessment/test_import_corpus_cli.py`
- `en_book_import.py` ← `scripts/assessment/test_en_book_import.py`
- `eval-plan.js` ← `tests/assessment/eval-plan.test.js`
- `gb_import.py` ← `scripts/assessment/test_gb_import.py`

## Related (all, generated)
- docs: `scripts/CLAUDE.md`?
