# L6 — Check Flow: prefill from AI marks, endpoint, coach marks and edits, completion
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/child-test/L6 kg=6bce1d80b876 gen=616993e6460f overflow=1 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `prefill.test.js` — confident marks arrive filled, unsure empty
- `endpoint.test.js` — POST /api/flows/child-test-check
- `check-flow-contract.test.js` — committed Flow JSON
- Run from repo root: `node tests/run.js tests/child-test/L6 --maxWorkers=2` (root jest, tests/jest.config.js)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 1 test files) |
| `endpoint.test.js` | Tests POST /api/flows/child-test-check: token ownership, INIT pre-fill from ai_marks, per-screen coach_marks and edits |
| `send-and-complete.test.js` | Tests sendCheck (Flow in data_exchange mode), recognising a check completion, and the sandbox-only registration guard |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `prefill.test.js` | Tests check Flow prefill from ai_marks: confident marks arrive filled, below-bar arrive empty and required (bd-s1oo0.6) |
| `check-flow-contract.test.js` | Check Flow contract guards (bd-s1oo0.6): committed docs/flows/child-test-check.json equals generator output; consistent |
| `marks.test.js` | Tests posted coach input becoming coach_marks plus coach_edits {path, ai, coach}; AI marks are never modified |
| `real-thresholds.test.js` | Tests the check form on real scoring thresholds: a NEVER-bar field arrives empty however confident the model is |
| `webhook-completion.test.js` | Drives the REAL webhook with a check nfm_reply completion so it is claimed, not dropped to attendance or generic replies |
| `l5-bars.test.js` | Tests the check asks per-language bars from scoring thresholds: same story confidence fills English, not Urdu |
| … | 1 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/setup/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/child-test/check-flow/CLAUDE.index.md`? · `bot/shared/services/child-test/scoring/CLAUDE.index.md`? · `bot/shared/utils/CLAUDE.index.md`? (+3)
