# web-quiz — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=scripts/web-quiz -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `counts/` | Read-only sandbox counts of what web-quiz surfaces serve → `counts/CLAUDE.md` |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `backfill-video-language.js` | Fills NULL student_videos.language from each video's lesson quiz language or script majority; --expect-ref guarded |
| `fixture-students.js` | Prints the web quiz's test-children ids as JSON using the same fixture rule as the weekly numbers |
| `load-stories.js` | Loads storybooks, voices and questions into one environment's DB and storage via story-load; --expect-ref guarded |
| `readalong-build.js` | Builds read-along audio and per-word timings from passage text via Soniox or ElevenLabs with ffmpeg pacing and spend cap |
| `strip-dry.js` | Read-only by-hand run of web-quiz weeklyStrip that prints rows to stdout instead of writing web_quiz_strip_weekly |

## Who reads this (all, generated)
- column `student_videos.language` (written by `backfill-video-language.js`) ← read by `bot/shared/services/quiz/web-quiz-bank.js:77:615b1933`
- table `student_videos` (written by `backfill-video-language.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:130:1b43cbb0`? · `bot/shared/routes/student-videos-endpoint.js:43:774bb5a8`? · `bot/shared/services/first-touch/maker.bank.js:71:c7c9316d`? · `bot/shared/services/quiz/video-quiz.service.js:242:774bb5a8`? (+7: `python3 kg/kg.py who-reads student_videos`)
- env `ELEVENLABS_API_KEY` read at `scripts/web-quiz/readalong-build.js:103:b44288e3`
- env `SONIOX_API_KEY` read at `scripts/web-quiz/readalong-build.js:57:1438c31e`
- env `SONIOX_TTS_API_KEY` read at `scripts/web-quiz/readalong-build.js:57:1438c31e`

## Tests (all, generated)
- `backfill-video-language.js` ← `bot/tests/quiz/web-quiz/backfill-video-language.test.js`
- `fixture-students.js` ← `bot/tests/quiz/web-quiz/fixture-students-cli.test.js`
- `load-stories.js` ← `bot/tests/quiz/web-quiz/load-stories-script.test.js`
- `readalong-build.js` ← `bot/tests/quiz/web-quiz/readalong-spend-cap.test.js`
- `strip-dry.js` ← `bot/tests/quiz/web-quiz/web-quiz-strip-dry.test.js`

## Related (all, generated)
- docs: `bot/tests/quiz/web-quiz/CLAUDE.index.md`? · `scripts/CLAUDE.index.md`? · `scripts/CLAUDE.md`? · `scripts/web-quiz/CLAUDE.index.md`? · `scripts/web-quiz/CLAUDE.md`? · `scripts/web-quiz/counts/CLAUDE.md`?
