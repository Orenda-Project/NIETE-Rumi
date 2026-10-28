# web-quiz — Jest suite for the kid-facing web quiz, hub, Challenge, stories and share flows
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/quiz/web-quiz kg=054cf1dc1073 gen=f09e862f6ea8 overflow=448 rendered=2026-10-28 kg.py=1.0.0 -->

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
| `__goldens__/` | Recorded-from-base JSON goldens for the teacher class-week and report pages → `__goldens__/CLAUDE.md` |
| `fixtures/` | → (no door; 9 test files) |
| `fake-supabase.js` | In-memory Supabase stand-in applying eq/is/in/or/order/range filters; shared by most web-quiz and quiz tests |
| … | 424 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `quizzes` (written by `web-quiz-identity.test.js` (+2)) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853`? · `bot/scripts/quiz/restore-bank-recorded-voices.js:107:5a5a53e8`? (+61)
- column `quizzes.id` (written by `web-quiz-videos-ur-titles.test.js` (+1)) ← read by `bot/scripts/quiz/backfill-bank-quiz-audio.js:134:6e461853` · `bot/scripts/quiz/restore-bank-recorded-voices.js:107:5a5a53e8` (+60)
- … 24 more → `CLAUDE.index.md`

## Never (human)
- A scored or refused run's audio prefix is emptied completely, again after URL expiry (web-quiz-challenge-voice.test.js:3, COS ruling 7 Oct)
- Keep switch-off paths byte-identical: tests pin goldens recorded from base (web-quiz-live-read-v3-off.test.js:3)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/scripts/quiz/CLAUDE.index.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/data/child-test/CLAUDE.index.md`? · `bot/shared/data/child-test/CLAUDE.md`? · `bot/shared/routes/CLAUDE.index.md`? (+28)
