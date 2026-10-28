# first-touch — Tests for one door, quiz maker and teacher home, with recorded goldens
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/first-touch kg=411d1b860f2f gen=7a05b645849f overflow=58 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `one-door-entry.test.js` — /quiz one reply, OFF compared to golden
- `maker-fixture.js` — shared video-bank fixture
- `teacher-home.routes.test.js` — end-to-end teacher home router
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `__goldens__/` | Recorded byte-for-byte outputs of OFF-switch first-touch behaviour → `__goldens__/CLAUDE.md` |
| `_ingress-mocks.js` | Shared boundary mocks (Redis as a Map, WhatsApp send, loggers) for the student-ingress door tests |
| `maker-fixture.js` | Fixture for quiz-maker tests: synthetic video bank, one registered teacher, seeded into the in-memory Supabase |
| `teacher-home.routes.test.js` | End-to-end tests of the /api/internal/th router over in-memory Supabase: shell, home, class card, sends, events |
| `maker.cards.test.js` | Tests the maker cards: words match the real door matchers, wa.me links, forward line, inline script in a sandbox |
| `one*` | 12 files; most used `one-door-go-routes.test.js`: Tests the landing /api/internal/go routes on a real HTTP port: OFF 404, no-read question, who/role, bind |
| `walk-persona-seam.test.js` | Seam test of the sandbox walk-through row against the real landing router and bindings repo; OFF byte-identical |
| `maker.routes.test.js` | Tests the maker router: OFF answers 404 off:true, ON pages, other token kinds, step route, mount wrapper |
| … | 58 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `INTERNAL_API_KEY` · `OPENAI_API_KEY` · `OPENROUTER_API_KEY` · `PAKISTAN_LP_FLOW_ID` · `PG_BIN` · `QUIZ_MENU_HANDSET_ROUTING` · `REFERRAL_BOT_NUMBER` · `REGISTRATION_AFTER_PLAN` · `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_URL` · `TEACHER_HOME_RECORD` · `WEB_QUIZ_KID_KEY` (+1)

## Never (human)
- Don't re-record goldens on changed code; they were recorded on the base (`one-door-entry.test.js:7`)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/CLAUDE.index.md`? · `bot/CLAUDE.md`? · `bot/scripts/quiz/CLAUDE.index.md`? · `bot/scripts/quiz/CLAUDE.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/database/CLAUDE.index.md`? (+16)
