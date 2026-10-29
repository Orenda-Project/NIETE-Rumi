# first-touch — Tests for one door, quiz maker and teacher home, with recorded goldens
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/first-touch kg=1baf97e587bf gen=d6d87f036765 overflow=54 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `one-door-entry.test.js` — /quiz one reply, OFF compared to golden
- `maker-fixture.js` — shared video-bank fixture
- `teacher-home.routes.test.js` — end-to-end teacher home router
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `__goldens__/` | → (no door; 10 files: 0 test + 10 support) |
| `_ingress-mocks.js` | Shared boundary mocks (Redis as a Map, WhatsApp send, loggers) for the student-ingress door tests |
| `maker-fixture.js` | Fixture for quiz-maker tests: synthetic video bank, one registered teacher, seeded into the in-memory Supabase |
| `teacher-home.routes.test.js` | End-to-end tests of the /api/internal/th router over in-memory Supabase: shell, home, class card, sends, events |
| `maker.cards.test.js` | Tests the maker cards: words match the real door matchers, wa.me links, forward line, inline script in a sandbox |
| `one*` | 12 files; most used `one-door-go-routes.test.js`: Tests the landing /api/internal/go routes on a real HTTP port: OFF 404, no-read question, who/role, bind |
| `walk-persona-seam.test.js` | Seam test of the sandbox walk-through row against the real landing router and bindings repo; OFF byte-identical |
| `maker.routes.test.js` | Tests the maker router: OFF answers 404 off:true, ON pages, other token kinds, step route, mount wrapper |
| `maker-fallback.test.js` | Tests the maker cta refused-send fallback: one counted reply, 20-point buttons, each button opens today's entry |
| `maker.cards.assessment-door.test.js` | Pins that the maker Test-paper card word reaches openAssessmentFlow exactly once through the real text handler |
| … | 71 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Don't re-record goldens on changed code; they were recorded on the base (`one-door-entry.test.js:7`)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/CLAUDE.md`? · `bot/scripts/quiz/CLAUDE.md`? · `bot/shared/database/CLAUDE.md`? · `bot/shared/handlers/CLAUDE.md`? · `bot/shared/services/cache/CLAUDE.md`? · `bot/shared/services/first-touch/CLAUDE.md`? (+2)
