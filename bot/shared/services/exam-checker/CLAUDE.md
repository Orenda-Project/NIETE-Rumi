# exam-checker — Exam-paper checker: OCR, grading, annotation and delivery behind one orchestrator
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/exam-checker kg=539ee641d5d4 gen=32aa9a67ddc3 overflow=18 rendered=2026-11-20 kg.py=1.1.0 -->

## Entry points
- `exam-checker.orchestrator.js` — thin coordinator of the whole workflow
- `grading.service.js` — LLM grading against the marking scheme
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `exam-session.service.js` | Manages exam-checking sessions in Supabase plus Redis with key prefix and TTL for the orchestrator |
| `grading.service.js` | Grades student answers against a marking scheme with an LLM, using board scales and structured feedback |
| `annotation.service.js` | Draws grades, ticks, margin feedback and score circle onto exam images with Canvas (Caveat, Nastaliq fonts) |
| `delivery.service.js` | Sends graded exam results and annotated images to the teacher on WhatsApp |
| `exam-checker.orchestrator.js` | Thin coordinator of the exam-checking workflow: delegates OCR, grading, annotation, delivery; owns session states |
| … | 6 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `exam-session.service.js` ← imported by `bot/shared/routes/exam-confirm-endpoint.js:30:bf50eaaf` · `bot/shared/services/exam-checker/exam-checker.orchestrator.js:55:40627fc8` (+1)
- `annotation.service.js` ← imported by `bot/shared/services/exam-checker/exam-checker.orchestrator.js:346:0cd52a27` · `bot/shared/services/exam-checker/index.js:13:0cd52a27`
- `delivery.service.js` ← imported by `bot/shared/services/exam-checker/exam-checker.orchestrator.js:391:9e8b05d5` · `bot/shared/services/exam-checker/index.js:14:9e8b05d5`
- `feedback.service.js` ← imported by `bot/shared/services/exam-checker/grading.service.js:15:89307e87` · `bot/shared/services/exam-checker/index.js:17:89307e87`
- … 16 more → `CLAUDE.index.md`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/handlers/exam-checker-text-reply.test.js` (index.js)
- `tests/exam-checker/confirm-students-flow.test.js` (exam-checker.orchestrator.js)
- … 1 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/CLAUDE.md`?
