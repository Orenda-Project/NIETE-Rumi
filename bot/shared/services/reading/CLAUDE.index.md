# reading — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/services/reading -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `analysis.service.js` | Orchestrates the reading-assessment analysis pipeline: Soniox transcript, student segments, pronunciation, fluency,... |
| `auto-level-orchestrator.service.js` | ASER-style adaptive level assessment: start at story, 2 attempts per level, move down below 80% accuracy |
| `benchmark.service.js` | Config-driven JS reimplementation of the benchmark SQL RPCs; thresholds live in config/reading-benchmarks.js |
| `comprehension.service.js` | Generates 5 EGRA-style comprehension questions and evaluates bilingual answers against the 3-of-5 benchmark |
| `fluency.service.js` | Computes WCPM, accuracy, elapsed time and error analysis for a reading assessment |
| `passage-generation.service.js` | Generates grade-appropriate reading passages with an LLM, renders passage images with Canvas, uploads to R2, sends... |
| `pronunciation.service.js` | Pronunciation assessment: Azure phoneme-level for English, GPT-4o audio analysis for Urdu and others |
| `report.service.js` | Builds the reading assessment PDF report with PDFKit (header, WCPM badge, student info, progress bars) |
| `transcription.service.js` | Transcribes student reading audio with Soniox diarization, keeping only the student speaker with word timestamps |
| `vocabulary-image.service.js` | Text-only vocabulary distractor selection and fallback question shape; AI image path removed in bd-2540 |
| `voice-feedback.service.js` | Generates and voices encouraging reading feedback (LLM script, ElevenLabs or Uplift TTS, phonetic guidance) |

## Who reads this (all, generated)
- `analysis.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:1835:f9417b65` · `bot/shared/handlers/voice-message.handler.js:442:02457105` · `bot/shared/services/reading-assessment.service.js:524:df107a41` · `bot/whatsapp-bot.js:1222:78683bde`
- `auto-level-orchestrator.service.js` ← imported by `bot/shared/handlers/flow-response.handler.js:52:c17cec4c`
- `benchmark.service.js` ← imported by `bot/shared/services/reading/analysis.service.js:24:2bf3cc60`
- `comprehension.service.js` ← imported by `bot/shared/handlers/text-message.handler.js:1724:e6cd291e` · `bot/shared/handlers/voice-message.handler.js:313:e6cd291e` · `bot/whatsapp-bot.js:1194:98859d86` · `bot/shared/services/reading/analysis.service.js:1159:651118f1`
- `fluency.service.js` ← imported by `bot/shared/services/reading/analysis.service.js:588:d851c211` · `bot/shared/services/reading/voice-feedback.service.js:27:d851c211`
- `passage-generation.service.js` ← imported by `bot/shared/handlers/flow-response.handler.js:51:e9ceb3eb` · `bot/shared/services/reading-assessment.service.js:364:e0652009`
- `pronunciation.service.js` ← imported by `bot/shared/services/reading/analysis.service.js:544:f9eb1bda`
- `report.service.js` ← imported by `bot/shared/services/reading/analysis.service.js:759:ace59629`
- `transcription.service.js` ← imported by `bot/shared/services/reading/analysis.service.js:495:b5c5c779`
- `vocabulary-image.service.js` ← imported by `bot/shared/services/reading/comprehension.service.js:19:63eeea0a`
- `voice-feedback.service.js` ← imported by `bot/shared/services/reading/analysis.service.js:1004:8efca90d`
- column `reading_assessments.accuracy_percentage` (written by `analysis.service.js`) ← read by `dashboard/routes/portal.routes.js:8257:6033d135`
- column `reading_assessments.completed_at` (written by `analysis.service.js`) ← read by `dashboard/routes/portal.routes.js:8257:6033d135`
- column `reading_assessments.passage_type` (written by `auto-level-orchestrator.service.js`) ← read by `dashboard/routes/portal.routes.js:8257:6033d135`
- column `reading_assessments.report_pdf_url` (written by `analysis.service.js`) ← read by `dashboard/routes/portal.routes.js:8257:6033d135`
- column `reading_assessments.status` (written by `analysis.service.js`, `auto-level-orchestrator.service.js`, `passage-generation.service.js`) ← read by `bot/shared/handlers/voice-message.handler.js:490:1099729a` · `bot/shared/services/context.service.js:170:a69ef692` · `bot/shared/services/reading-assessment.service.js:29:a9e5e72d` · `bot/shared/services/redis-comprehension.service.js:85:64fad2d6` (+3: `python3 kg/kg.py who-reads reading_assessments.status`)
- column `reading_assessments.voice_feedback_url` (written by `analysis.service.js`) ← read by `dashboard/routes/portal.routes.js:8257:6033d135`
- column `reading_assessments.wcpm` (written by `analysis.service.js`) ← read by `dashboard/routes/portal.routes.js:8257:6033d135`
- table `reading_assessments` whole row (`*`) (written by `analysis.service.js`, `auto-level-orchestrator.service.js`, `passage-generation.service.js`) ← read by `bot/shared/handlers/voice-message.handler.js:517:d2b02c3e`? · `bot/shared/services/feature-registration.service.js:147:7a0c163a`? · `dashboard/database/queries.js:749:7a0c163a`? · `dashboard/routes/portal.routes.js:8332:d2b02c3e`? (+2: `python3 kg/kg.py who-reads reading_assessments`)
- table `reading_assessments` (written by `analysis.service.js`, `auto-level-orchestrator.service.js`, `passage-generation.service.js`) ← read by `bot/shared/handlers/flow-response.handler.js:326:4337985e`? · `bot/shared/handlers/text-message.handler.js:1734:4337985e`? · `bot/shared/handlers/voice-message.handler.js:323:4337985e`? · `bot/shared/services/context.service.js:165:4337985e`? (+11: `python3 kg/kg.py who-reads reading_assessments`)
- env `AZURE_SPEECH_KEY` read at `bot/shared/services/reading/pronunciation.service.js:42:b0f86cfa`
- env `AZURE_SPEECH_REGION` read at `bot/shared/services/reading/pronunciation.service.js:43:996ea854`
- env `R2_ACCESS_KEY_ID` read at `bot/shared/services/reading/analysis.service.js:946:d6f2a7a2` · `bot/shared/services/reading/passage-generation.service.js:1142:d6f2a7a2` · `bot/shared/services/reading/voice-feedback.service.js:788:d6f2a7a2`
- env `R2_BUCKET_NAME` read at `bot/shared/services/reading/analysis.service.js:951:90ddb4d1` · `bot/shared/services/reading/passage-generation.service.js:1147:90ddb4d1` · `bot/shared/services/reading/voice-feedback.service.js:793:90ddb4d1`
- env `R2_ENDPOINT` read at `bot/shared/services/reading/analysis.service.js:944:2684789e` · `bot/shared/services/reading/passage-generation.service.js:1140:2684789e` · `bot/shared/services/reading/voice-feedback.service.js:786:2684789e`
- env `R2_PUBLIC_URL` read at `bot/shared/services/reading/passage-generation.service.js:212:69d9f0f1`
- env `R2_SECRET_ACCESS_KEY` read at `bot/shared/services/reading/analysis.service.js:947:5687c9ca` · `bot/shared/services/reading/passage-generation.service.js:1143:5687c9ca` · `bot/shared/services/reading/voice-feedback.service.js:789:5687c9ca`
- env `READING_BENCHMARKS_USE_RPC` read at `bot/shared/services/reading/analysis.service.js:635:6decc396`
- env `USE_PASSAGE_BACKGROUNDS` read at `bot/shared/services/reading/passage-generation.service.js:38:9c754d77`

## Tests (all, generated)
- `benchmark.service.js` ← `tests/reading/benchmark-service.test.js`
- `report.service.js` ← `tests/reports/reading-report-service.test.js`
- `voice-feedback.service.js` ← `tests/reading/voice-feedback-gateway.test.js`

## Related (all, generated)
- skills: `reading-assessment`?
- docs: `bot/shared/services/CLAUDE.md`? · `docs/agent-customization.md`? · `docs/customization.md`?
