# web — Web-lane Gherkin for the teacher, coach and leader portal and the child quiz page
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/features/web kg=e8386888cacb gen=2a486d6133b6 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `portal-smoke.feature` — every main page, every role, healthy
- `web-quiz-child-page.feature` — child quiz page at /q/<code> (@WQ scenarios)
- Run with `npm run e2e:web -- <feature>` (local stack, demo school network); no jest runner picks these up
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `fde-board-pattern.feature` | Web spec (@FB): Grade 5 board-pattern paper in one tap, FDE hub switch, rate limit; some scenarios need sandbox |
| `portal*` | 3 files; most used `portal-smoke.feature`: Web-lane smoke spec: every main page for every role (teacher v2, classic, coach v2) opens healthy |
| `coach-portal.feature` | Web-lane spec (@CP): coach app v2 pages all land healthy or redirect to the Training Library; covers portal/coach/** |
| `leader-portal.feature` | Web-lane spec: principal portal pages (home, Teachers, Observations, School Analytics, lessons) open healthy |
| `teacher*` | 8 files; most used `teacher-training.feature`: Web-lane spec: teacher Training courses, classic Training, and the written capstone exam marking and recording |
| `web-quiz-child-page.feature` | Web spec (@WQ): child quiz page at /q/<code>: link preview, league table, returning child remembered on the phone |
| `web-quiz-item-types.feature` | Web spec: every web quiz item type renders large tap targets in en and ur; order-by-tapping with no dragging |

## Who reads this (generated)
- (none)

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `.claude/qa/agents/niete-fde-board-pattern-agent.md`? · `tests/features/CLAUDE.md`? · `tests/features/web/CLAUDE.index.md`? · `tests/features/web/CLAUDE.md`?
