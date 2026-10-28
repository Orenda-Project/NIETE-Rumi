# assessment — Assessment generator: ICT textbook import and offline quality evals

<!-- kg:meta repo=NIETE-Rumi dir=scripts/assessment kg=27b783fa3f9d gen=624a1c2cb6cb overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `import-ict-textbooks.py` — which ICT books load, via lib/textbook_import.py
- `eval-run.js` — runs the real generation pipeline offline and keeps every artifact
- `eval-plan.js` — which chapters and exam specs each book gets
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `eval/` | → (no door; 2 files) |
| `eval-plan.js` | Pure planner for the assessment eval: chapter picks per book and two exam specs; used by eval-run.js |
| `CLAUDE.md` | (unmapped) |
| `eval-per-type-counts.js` | Eval: checks the assessment generator delivers the per-question-type counts asked for, using deliberately uneven splits |
| `eval-run.js` | Runs real BookContent, Generation and Renderer services over every ICT book offline, saving pages, prompts, JSON, papers |
| `import-ict-textbooks.py` | Thin ICT book list that drives lib/textbook_import.py to load textbook pages and chapters for the assessment generator |

## Who reads this (generated)
- `eval-plan.js` ← imported by `scripts/assessment/eval-per-type-counts.js:40:9730d1c6` · `scripts/assessment/eval-run.js:46:1bcddaf9`
- env read here: `EVAL_EXPECT_SUPABASE_REF` · `SUPABASE_URL`

## Never (human)
- Assessment files must be identical on main and sandbox (scripts/assessment-parity.sh:2)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/assessment/eval-plan.test.js` (eval-plan.js)

## Related (generated)
- docs: `scripts/CLAUDE.index.md`? · `scripts/CLAUDE.md`? · `scripts/assessment/CLAUDE.md`?
