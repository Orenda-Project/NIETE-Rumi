# training — Teacher training: modules, quizzes, certificates, I-SAPS exams and grading
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/training kg=ef96f9ad34eb gen=995d16d35737 overflow=172 rendered=2026-11-10 kg.py=1.1.0 -->

## Entry points
- `quiz-delivery.service.js` — WhatsApp quiz state machine
- `certificate.service.js` — issues level certificates
- `progress.service.js` — only writer of progress rows
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `quiz-delivery.service.js` | WhatsApp Q-by-Q state machine for grand (level) and module quizzes: serving, grading, retries, certificates |
| `certificate*` | 3 files; most used `certificate.service.js`: Issues level certificates after a passed level exam for WhatsApp and portal; code generation and quiz-score guard |
| … | 29 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `users` (written by `band-selection.service.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+192)
- … 74 more → `CLAUDE.index.md`

## Never (human)
- Bot completions write teacher_training_progress only via progress.service.js (:9-14); the portal also upserts it (dashboard/routes/portal.routes.js:5712)
- Teachers must never see model_answer or rubric of an I-SAPS CRQ (isaps-crq.rules.js:9, bd-60113)
- Pilot vendors in PILOT_WATERMARK_VENDORS get a watermarked certificate even in prod; empty since 2026-10-01 (certificate-env.rules.js:52-63; pinned by tests/training/isaps-pilot-watermark.test.js)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/training/bd-arghnv-3-blank-stem-never-served.test.js` (capstone-delivery.service.js, isaps-crq-paper.rules.js, progress.service.js, question-stem.rules.js, quiz-delivery.service.js, quiz-serving.service.js)
- `tests/fixtures/delegate-training-to-bot.js` (capstone-delivery.service.js, certificate.service.js, paper-marking.service.js, quiz-delivery.service.js, quiz-serving.service.js)
- … 87 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/CLAUDE.md`? · `docs/migration/02-teacher-training.md`? · `docs/reports/bug131-phase3-grand-quiz.md`?
