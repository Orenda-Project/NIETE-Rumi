# web-quiz — Web quiz content loading, backfills and by-hand health runs

<!-- kg:meta repo=NIETE-Rumi dir=scripts/web-quiz kg=ba0692947b14 gen=10540b000014 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `load-stories.js` — loads storybooks into one environment, --expect-ref guarded
- `strip-dry.js` — weekly health numbers without writing
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `counts/` | Read-only sandbox counts of what web-quiz surfaces serve → `counts/CLAUDE.md` |
| `backfill-video-language.js` | Fills NULL student_videos.language from each video's lesson quiz language or script majority; --expect-ref guarded |
| `fixture-students.js` | Prints the web quiz's test-children ids as JSON using the same fixture rule as the weekly numbers |
| `load-stories.js` | Loads storybooks, voices and questions into one environment's DB and storage via story-load; --expect-ref guarded |
| `readalong-build.js` | Builds read-along audio and per-word timings from passage text via Soniox or ElevenLabs with ffmpeg pacing and spend cap |
| `strip-dry.js` | Read-only by-hand run of web-quiz weeklyStrip that prints rows to stdout instead of writing web_quiz_strip_weekly |

## Who reads this (generated)
- table `student_videos` (written by `backfill-video-language.js`) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:130:1b43cbb0`? · `bot/shared/routes/student-videos-endpoint.js:43:774bb5a8`? (+9)
- column `student_videos.language` (written by `backfill-video-language.js`) ← read by `bot/shared/services/quiz/web-quiz-bank.js:77:615b1933`
- env read here: `ELEVENLABS_API_KEY` · `SONIOX_API_KEY` · `SONIOX_TTS_API_KEY`

## Never (human)
- backfill-video-language.js prints counts only, never an id or title (backfill-video-language.js:12)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/quiz/web-quiz/backfill-video-language.test.js` (backfill-video-language.js)
- `bot/tests/quiz/web-quiz/fixture-students-cli.test.js` (fixture-students.js)
- `bot/tests/quiz/web-quiz/load-stories-script.test.js` (load-stories.js)
- `bot/tests/quiz/web-quiz/readalong-spend-cap.test.js` (readalong-build.js)
- `bot/tests/quiz/web-quiz/web-quiz-strip-dry.test.js` (strip-dry.js)

## Related (generated)
- docs: `scripts/CLAUDE.md`?
