# lib — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/vendor/lp-v9/lib -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `clean_figure.py` | Lifts a faint textbook scan's tones before it goes into the LP; CLI taking src and dst |
| `continuous.js` | Two-page printed layout (teaching page, then teacher-support page) per operator ruling (bd-f01ob v6) |
| `domtext.js` | Extracts rendered DOM text nodes so gates like MATH_LEAK read what a teacher actually sees |
| `fbise_chips.js` | Prints each SLO's FBISE Summative/Formative status chip in the outcome box from doc.fbise_slos (bd-f01ob) |
| `fonts.js` | Resolves and base64-embeds fonts so rendered LP HTML and PDFs look identical on any machine |
| `migrate.js` | Lifts an lp_doc 2.0 into the 3.0 shape in memory at render time; never rewrites the stored artefact |
| `overlay.js` | Applies the Urdu ur_overlay (JSON-pointer map) and printed label packs to a cloned lp_doc at render time |
| `pdfmeta.js` | Writes lesson_id, book_stem and schema_version into PDF metadata instead of printing them on the teacher's page |
| `questions.js` | Lists every question an LP asks with a stable ref, shared by the renderer and lint (REF_ABSENT, DUP_QUESTION) |
| `religious_facts.js` | Three mechanical lint checks on how plans name and classify surahs, e.g. disjoint letters as a surah name (bd-nnd27p) |
| `rich.js` | Inline text pipeline for lp_doc strings: bold, KaTeX math and mhchem into HTML |
| `template.js` | Builds the self-contained two-page A4 LP HTML from an lp_doc: sections, chips, cards and layout |
| `validate.js` | Schema validation shared by render, lint and tests; picks the 3.0 or 2.0 schema from schema_version |

## Who reads this (all, generated)
- `continuous.js` ← imported by `bot/vendor/lp-v9/render_lp.js:27:b108d8d8`
- `domtext.js` ← imported by `bot/vendor/lp-v9/lint_lp.js:52:ea145c91`
- `fbise_chips.js` ← imported by `bot/vendor/lp-v9/lib/template.js:29:c18b5960`
- `fonts.js` ← imported by `bot/shared/services/quiz/quiz-math.js:205:f7f657cc` · `bot/shared/services/quiz/transcript-quiz-card.js:26:e409cd03` · `bot/shared/services/quiz/transcript-quiz-figure.js:35:e409cd03` · `bot/vendor/lp-v9/render_lp.js:25:1007f682` (+1: `python3 kg/kg.py who-reads fonts.js`)
- `migrate.js` ← imported by `bot/vendor/lp-v9/lib/template.js:27:97d8a010`
- `overlay.js` ← imported by `bot/shared/services/lp612-author.service.js:63:a6ab6c97` · `bot/vendor/lp-v9/lint_lp.js:49:6395c51e` · `bot/vendor/lp-v9/render_lp.js:23:e99c399b` · `bot/vendor/lp-v9/lib/template.js:25:407af061`
- `pdfmeta.js` ← imported by `bot/vendor/lp-v9/render_lp.js:26:23afa7cf`
- `questions.js` ← imported by `bot/vendor/lp-v9/lint_lp.js:53:420eb334` · `bot/vendor/lp-v9/lib/template.js:28:d1e35413`
- `religious_facts.js` ← imported by `bot/vendor/lp-v9/lint_lp.js:55:30a7a942`
- `rich.js` ← imported by `bot/shared/services/quiz/quiz-math.js:179:991497b6` · `bot/vendor/lp-v9/lint_lp.js:50:e778133a` · `bot/vendor/lp-v9/lib/fbise_chips.js:8:ab4acf76` · `bot/vendor/lp-v9/lib/template.js:24:b2462af9`
- `template.js` ← imported by `bot/vendor/lp-v9/lint_lp.js:51:b4742e94` · `bot/vendor/lp-v9/render_lp.js:22:d35135a6`
- `validate.js` ← imported by `bot/shared/services/lp612-author.service.js:60:8c195dd6` · `bot/vendor/lp-v9/lint_lp.js:48:3f517c5a` · `bot/vendor/lp-v9/render_lp.js:24:3f517c5a`

## Tests (all, generated)
- `fonts.js` ← `tests/lp612/vendor-integrity.test.js`
- `migrate.js` ← `tests/setup/migrate.test.js`?
- `overlay.js` ← `bot/tests/lp-v8/bd-k3ry8-pupil-says-label.test.js` · `tests/lp612/erq-heading-teacher-words.test.js` · `tests/lp612/fbise-slo-chips.test.js`
- `religious_facts.js` ← `tests/lp612/religious-facts.test.js`
- `rich.js` ← `tests/lp612/bidi-caps.test.js`
- `template.js` ← `bot/tests/lp-v8/bd-psa3u-urdu-badges.test.js` · `tests/lp612/bidi-caps.test.js` · `tests/lp612/erq-heading-teacher-words.test.js` · `tests/lp612/fbise-slo-chips.test.js` · `tests/lp612/figure-widen-repair.test.js` · `tests/lp612/footer-page-ref-visible.test.js` (+7: `python3 kg/kg.py who-reads bot/vendor/lp-v9/lib/template.js`)
- `validate.js` ← `tests/lp612/fbise-slo-chips.test.js` · `tests/lp612/vendor-integrity.test.js`

## Related (all, generated)
- docs: `bot/tests/lp-v8/CLAUDE.index.md`? · `bot/vendor/lp-v9/CLAUDE.index.md`? · `bot/vendor/lp-v9/CLAUDE.md`? · `bot/vendor/lp-v9/SYNC.md`? · `bot/vendor/lp-v9/lib/CLAUDE.index.md`? · `bot/vendor/lp-v9/lib/CLAUDE.md`? · `tests/lp612/CLAUDE.index.md`? · `tests/setup/CLAUDE.index.md`?
