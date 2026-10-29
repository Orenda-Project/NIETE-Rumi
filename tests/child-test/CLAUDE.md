# child-test — EGRA/EGMA child test a coach runs over WhatsApp; one folder per build lane
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test kg=91216adab1ac gen=61c357efa661 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `L4/conversation.test.js` — end-to-end coach conversation; L<n> folders are lanes (L5 scoring, L6 check Flow)
- `L26/journey-v2.test.js` — v2 journey; L36/journey-v3.test.js is battery v3 (CHILD_TEST_BATTERY)
- Run from repo root: `node tests/run.js tests/child-test --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| 14 sub-dirs, each with `CLAUDE.md` | `L1/` · `L2/` · `L25/` · `L27/` · `L28/` · `L29/` · `L3/` · `L36/` · `L37/` · `L38/` · `L39/` · `L4/` · `L5/` · `L6/` |
| 27 sub-dirs without a door | `L0/` (4 tests) · `L10/` (1 tests) · `L11/` (3 tests) · `L12/` (7 tests) · `L13/` (1 tests) · +22 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Real-Chromium render tests run a child node process because the root suite stubs playwright-core (tests/child-test/L2/real-render.test.js:4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `tests/CLAUDE.md`?
