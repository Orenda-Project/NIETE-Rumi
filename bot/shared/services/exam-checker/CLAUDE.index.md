# exam-checker — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/exam-checker -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `annotation.service.js` | Draws grades, ticks, margin feedback and score circle onto exam images with Canvas (Caveat, Nastaliq fonts) |
| `delivery.service.js` | Sends graded exam results and annotated images to the teacher on WhatsApp |
| `exam-checker.orchestrator.js` | Thin coordinator of the exam-checking workflow: delegates OCR, grading, annotation, delivery; owns session states |
| `exam-session.service.js` | Manages exam-checking sessions in Supabase plus Redis with key prefix and TTL for the orchestrator |
| `feedback.service.js` | Generates Hattie Feed Up/Back/Forward pedagogical feedback for graded exam answers |
| `grading-scale.service.js` | Converts marks to board-specific grades (FBISE, Cambridge IGCSE, Punjab Matric) for exam grading |
| `grading.service.js` | Grades student answers against a marking scheme with an LLM, using board scales and structured feedback |
| `index.js` | Barrel export of the exam-checker orchestrator and its services |
| `ocr.service.js` | Extracts exam-image text with Mistral then Chandra fallback, adding Surya bounding boxes for annotation placement |
| `question-detector.service.js` | Analyzes OCR results to detect students and question types by patterns for the exam checker |
| `surya.service.js` | Calls Datalab's Surya detection API for text-line positions used to place exam annotations |

## Who reads this (all, generated)
- `annotation.service.js` ← imported by `bot/shared/services/exam-checker/exam-checker.orchestrator.js:346:0cd52a27` · `bot/shared/services/exam-checker/index.js:13:0cd52a27`
- `delivery.service.js` ← imported by `bot/shared/services/exam-checker/exam-checker.orchestrator.js:391:9e8b05d5` · `bot/shared/services/exam-checker/index.js:14:9e8b05d5`
- `exam-checker.orchestrator.js` ← imported by `bot/shared/services/exam-checker/index.js:8:476011f4`
- `exam-session.service.js` ← imported by `bot/shared/routes/exam-confirm-endpoint.js:30:bf50eaaf` · `bot/shared/services/exam-checker/exam-checker.orchestrator.js:55:40627fc8` · `bot/shared/services/exam-checker/index.js:9:40627fc8`
- `feedback.service.js` ← imported by `bot/shared/services/exam-checker/grading.service.js:15:89307e87` · `bot/shared/services/exam-checker/index.js:17:89307e87`
- `grading-scale.service.js` ← imported by `bot/shared/services/exam-checker/grading.service.js:14:b60adf8a` · `bot/shared/services/exam-checker/index.js:16:b60adf8a`
- `grading.service.js` ← imported by `bot/shared/services/exam-checker/exam-checker.orchestrator.js:345:f90ff460` · `bot/shared/services/exam-checker/index.js:12:f90ff460`
- `index.js` ← imported by `bot/shared/handlers/exam-checker.handler.js:10:4f4dac76` · `bot/workers/exam-grading.worker.js:26:44b162ab`
- `ocr.service.js` ← imported by `bot/shared/services/exam-checker/exam-checker.orchestrator.js:161:6176d15f` · `bot/shared/services/exam-checker/index.js:10:6176d15f`
- `question-detector.service.js` ← imported by `bot/shared/services/exam-checker/exam-checker.orchestrator.js:162:7b8c901d` · `bot/shared/services/exam-checker/index.js:11:7b8c901d`
- `surya.service.js` ← imported by `bot/shared/services/exam-checker/index.js:15:d7a2c4b5` · `bot/shared/services/exam-checker/ocr.service.js:13:d7a2c4b5`
- column `exam_check_sessions.status` (written by `exam-session.service.js`) ← read by `bot/workers/exam-grading.worker.js:326:8d5d70f6`
- column `exam_check_sessions.user_id` (written by `exam-session.service.js`) ← read by `bot/workers/exam-grading.worker.js:326:8d5d70f6`
- table `exam_check_sessions` (written by `exam-session.service.js`) ← read by `bot/workers/exam-grading.worker.js:325:3d8d7449`?
- env `CHANDRA_API_KEY` read at `bot/shared/services/exam-checker/ocr.service.js:232:b6b3ed5d` · `bot/shared/services/exam-checker/surya.service.js:20:ae3e6115`
- env `CHANDRA_API_URL` read at `bot/shared/services/exam-checker/ocr.service.js:17:008b70cb`
- env `DATALAB_API_KEY` read at `bot/shared/services/exam-checker/surya.service.js:20:ae3e6115`
- env `EXAM_CHECKER_STUDENTS_FLOW_ID` read at `bot/shared/services/exam-checker/exam-checker.orchestrator.js:192:f40da013`
- env `MISTRAL_API_KEY` read at `bot/shared/services/exam-checker/ocr.service.js:158:c6e1f1e7`
- env `SURYA_API_URL` read at `bot/shared/services/exam-checker/surya.service.js:19:ddc484b0`

## Tests (all, generated)
- `exam-checker.orchestrator.js` ← `tests/exam-checker/confirm-students-flow.test.js`
- `grading.service.js` ← `tests/exam-checker/grading-service.test.js`

## Related (all, generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/exam-checker/CLAUDE.index.md`? · `bot/shared/services/exam-checker/CLAUDE.md`? · `tests/exam-checker/CLAUDE.md`?
