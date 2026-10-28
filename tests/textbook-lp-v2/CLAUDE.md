# textbook-lp-v2 — Textbook-grounded LP services: ToC loading, topic match, pre-gen lookup, template

<!-- kg:meta repo=NIETE-Rumi dir=tests/textbook-lp-v2 kg=0c8e2e3fb09f gen=ecc4167c6d0c overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `handler-curriculum.test.js` — curriculum handler serves a pre-gen PDF path, never throws (bd-1349)
- `lesson-plan-template.test.js` — buildLessonPlanPrompt is the single section source (bd-1841)
- Root jest (tests/jest.config.js): from repo root `node tests/run.js tests/textbook-lp-v2 --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `lesson-plan-template.test.js` | Pins buildLessonPlanPrompt as the single coherent section set with consistent card counts (bd-1841) |
| `CLAUDE.md` | (unmapped) |
| `pregen-lookup.test.js` | Pins PreGenLookupService.findPreGenLP: returns R2 keys only for completed pre_generated_lps rows, null otherwise |
| `toc-loading.test.js` | Pins ToC loader storing chapters from ToC JSON into textbook_toc (bd-628) |
| `topic-matching.test.js` | Pins TopicMatchingService matching typed topics to textbook units/chapters by keyword (bd-632) |
| `handler-curriculum.test.js` | Pins handleCurriculumLessonPlan: serves pre-generated PDF path or returns page_prompt fallback, never throws (bd-1349) |

## Who reads this (generated)
- (none)

## Never (human)
- The curriculum handler must never throw and sends a file path not a Buffer (handler-curriculum.test.js:4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `docs/CLAUDE.index.md`? · `docs/customization.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/textbook-lp-v2/CLAUDE.md`?
