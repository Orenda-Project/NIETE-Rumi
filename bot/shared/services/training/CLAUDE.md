# training — Teacher training: modules, quizzes, certificates, I-SAPS exams and grading
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/training kg=33956c8fc35e gen=4adc78edab7d overflow=168 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `quiz-delivery.service.js` — WhatsApp quiz state machine
- `certificate.service.js` — issues level certificates
- `progress.service.js` — only writer of progress rows
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `quiz-delivery.service.js` | WhatsApp Q-by-Q state machine for grand (level) and module quizzes: serving, grading, retries, certificates |
| `isaps*` | 12 files; most used `isaps-module-exam.rules.js`: I-SAPS end-of-module exam slot, per-module source quiz id mapping and offer message rules |
| … | 16 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `users` (written by `band-selection.service.js`) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+170)
- … 71 more → `CLAUDE.index.md`

## Never (human)
- Bot completions write teacher_training_progress only via progress.service.js (:9-14); the portal also upserts it (dashboard/routes/portal.routes.js:5712)
- Teachers must never see model_answer or rubric of an I-SAPS CRQ (isaps-crq.rules.js:9, bd-60113)
- Pilot vendors in PILOT_WATERMARK_VENDORS get a watermarked certificate even in prod; empty since 2026-10-01 (certificate-env.rules.js:52-63; pinned by tests/training/isaps-pilot-watermark.test.js)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/training/isaps-crq-hold.test.js` (certificate.service.js, isaps-crq-hold.rules.js, isaps-module-exam.rules.js, isaps-score-sheet.rules.js, quiz-delivery.service.js)
- `tests/training/isaps-golive-gates.test.js` (certificate-env.rules.js, content-delivery.service.js, isaps-crq-paper.rules.js, isaps-module-exam.rules.js, quiz-delivery.service.js)
- … 81 more → `CLAUDE.index.md`

## Related (generated)
- docs: `CLAUDE.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/training/CLAUDE.index.md`? · `bot/shared/services/training/CLAUDE.md`? · `docs/migration/02-teacher-training.md`? (+8)
