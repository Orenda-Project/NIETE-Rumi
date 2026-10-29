# web-quiz — Jest suite for the kid-facing web quiz, hub, Challenge, stories and share flows
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/quiz/web-quiz kg=25edbeebadfc gen=0e6fe7382533 overflow=419 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `web-quiz.service.test.js` — core web child quiz service: endpoints, one-attempt, 503 when off
- `web-quiz-hub.test.js` — kid hub payload and the WhatsApp /quiz link that opens it
- `web-quiz-challenge.test.js` — Challenge tokens, 'Which is bigger?' and Read-aloud runs
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `__fixtures__/` | Invented storybook fixtures shared by web-quiz Stories tests → `__fixtures__/CLAUDE.md` |
| `__golden__/` | Recorded-from-base JSON goldens that pin web-quiz switch-off output → `__golden__/CLAUDE.md` |
| `__goldens__/` | → (no door; 2 files: 0 test + 2 support) |
| `fixtures/` | → (no door; 9 files: 0 test + 9 support) |
| `__snapshots__/` | → (not mapped: excluded; 13 files) |
| `fake-supabase.js` | In-memory Supabase stand-in applying eq/is/in/or/order/range filters; shared by most web-quiz and quiz tests |
| `fixture-phone.js` | Builds synthetic phone digits at runtime for tests, since the repo bans phone-shaped digit literals |
| `story*` | 8 files; most used `story-teacher.test.js`: Pins the teacher storybook send (web_quiz_stories_teacher): shelf, one quizzes row per book, /q/ open, story report |
| `web-quiz-identity-fixture.js` | Shared fixture for identity v2 tests: a synthetic school with two grade-4 sections, a quiz, a class code and collisions |
| … | 447 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- A scored or refused run's audio prefix is emptied completely, again after URL expiry (web-quiz-challenge-voice.test.js:3, COS ruling 7 Oct)
- Keep switch-off paths byte-identical: tests pin goldens recorded from base (web-quiz-live-read-v3-off.test.js:3)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/classes/CLAUDE.md`? · `bot/shared/services/quiz/pictures/CLAUDE.md`? · `bot/shared/services/settings/CLAUDE.md`? · `bot/shared/services/tts/CLAUDE.md`? · `bot/shared/utils/CLAUDE.md`? · `bot/tests/quiz/CLAUDE.md`? (+3)
