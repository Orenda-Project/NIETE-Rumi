# first-touch — One-door /quiz entry, quiz-maker and teacher-home pages, all switch-gated
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/first-touch kg=16210eb3b196 gen=58d1348490cc overflow=166 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `one-door.service.js` — the single reply for any quiz request
- `role.service.js` — server-side who holds this phone
- `mounts.js` — ordered optional mounts run by whatsapp-bot.js
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `teacher-home.flags.js` | Reads the teacher home switches quiz_teacher_home, _paged and server_timing; JSON-true semantics, 30s cache |
| `maker*` | 13 files; most used `maker.bank.js`: Builds the quiz-maker chip tree (grade, subject, topic) from the live video-bank quizzes and makes the quiz |
| … | 33 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `quiz_share_codes` (written by `teacher-home.send.js`) ← read by `bot/shared/services/quiz/child-identity-reuse.js:31:2111be10`? · `bot/shared/services/quiz/handout-class.service.js:193:5b028a07`? (+28)
- column `quiz_share_codes.active` (written by `teacher-home.send.js`) ← read by `bot/shared/services/quiz/story-teacher.service.js:193:2c3900c5` · `bot/shared/services/quiz/web-quiz-bank.js:148:49548c18` (+9)
- … 49 more → `CLAUDE.index.md`

## Never (human)
- Never put phone or user id in a URL, page or log (`bot/shared/services/first-touch/go-nonce.js:3`)
- Switch OFF must stay byte-identical; goldens pin it (`bot/tests/first-touch/one-door-entry.test.js:7`)
- A mount that throws costs only itself: whatsapp-bot.js:94 catches per mount and calls mount-failed.js
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/first-touch/teacher-home.routes.test.js` (maker.bank.js, maker.page.js, teacher-home-counts.flag.js, teacher-home.copy.js, teacher-home.flags.js, teacher-home.model.js, teacher-home.more-flags.js, teacher-home.page.js, teacher-home.routes.js, teacher-home.sent.js, teacher-home.strings.js, teacher-home.token.js, teacher-stories-stale.flag.js)
- … 84 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.md`? · `bot/shared/services/first-touch/CLAUDE.index.md`? · `bot/shared/services/first-touch/CLAUDE.md`? · `bot/tests/first-touch/CLAUDE.index.md`? · `bot/tests/push/CLAUDE.md`? (+4)
