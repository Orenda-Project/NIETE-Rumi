# assessment — Tests for the assessment/exam generator: WhatsApp Flow, portal editor, FDE board papers
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/assessment kg=59698648c243 gen=f4f0830026d0 overflow=254 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `golden.test.js` — start here: pins today's prompts, printed papers/keys, options payloads against fixtures/golden
- `assessment-orchestrator.service.test.js` — the request-to-delivered-paper job; `fde-chain.test.js` is the end-to-end board paper
- Root jest (config `tests/jest.config.js`): from repo root `node tests/run.js tests/assessment --maxWorkers=2`; `npm test` is the baseline gate
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 214 files: 0 test + 214 support) |
| `helpers/` | Shared fakes and replay helpers for the assessment tests (not test files themselves) → `helpers/CLAUDE.md` |
| `topics/` | Tests for assessment topics: curriculum-matrix grouping, topic papers, topic answer key → `topics/CLAUDE.md` |
| `fde-edit.test.js` | Pins editing a board-pattern paper: selection keeps _layout, a changed answer drops worked scheme points (E8.1/E8.2) |
| `assessment-chat-ack.test.js` | Pins generation and rebuild ending by closing the Flow with an in-chat acknowledgement, not a SUBMITTED screen |
| `assessment-paper-fde.renderer.test.js` | Pins the printed board-pattern paper and marking scheme: recomputed counts, header total 100, choiceLine (fde renderer) |
| `fde-r6s2.test.js` | Round 6 second pass: pins that appended source/chapter/level tags never print and the pages-paper covers line |
| … | 257 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Do not let non-board papers change: golden tests pin them byte for byte (golden.test.js:5)
- Every Flow test that builds a title or row must carry an Urdu fixture (assessment-urdu-fixtures.test.js:2)
- Do not rename fixtures/fde files: tests load them by built name (fde-r12-sst.test.js:35 `${name}.json`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/assessment/CLAUDE.md`? · `bot/shared/services/assessment/CLAUDE.md`? · `bot/shared/services/assessment/patterns/CLAUDE.md`? · `bot/shared/services/assessment/patterns/early/CLAUDE.md`? · `scripts/assessment/CLAUDE.md`? · `tests/CLAUDE.md`? (+1)
