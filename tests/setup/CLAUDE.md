# setup — Repo-wide guard tests: schema, migrations, flows, hygiene ratchets and setup scripts
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/setup kg=7f646ede6560 gen=432f4a33d9d5 overflow=81 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `ratchet-verdict-lib.js` — shrink-only allowlist verdict most gates here share (fail above list, warn below)
- `test-seam-gates-lib.js` — big pure-reader library behind the repo-mock, copy-deck and select-column gates
- Root jest: `node tests/run.js tests/setup --maxWorkers=2` from repo root; `npm test` is the baseline gate
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `_audit-helpers/` | Static require-graph helper used by the orphan, cycle and unresolved-require audits → `_audit-helpers/CLAUDE.md` |
| `ratchet-verdict-lib.js` | Shared verdict for shrink-only allowlist gates: fail above the list, warn below, returns failures and warnings |
| `test-seam-gates-lib.js` | Large shared library of pure readers behind the test-seam gates (repo mocks, copy deck, select columns, fresh-profile) |
| `CLAUDE.index.md` | (unmapped) |
| `source-hygiene.test.js` | Guard for the public repo: no internal ticket refs in shipped source or docs/flows JSON authoring metadata |
| … | 80 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `students` (written by `select-columns-exist.test.js`) ← read by `bot/shared/routes/attendance-marking-endpoint.js:316:2f35b0c2`? · `bot/shared/routes/edit-class-endpoint.js:44:2f35b0c2`? (+44)
- table `niete_lp612_renders` (written by `schema-completeness.test.js`) ← read by `bot/shared/services/coaching/portal-lesson-plan-library.service.js:117:3534712c`?
- table `students` whole row (`*`) (written by `select-columns-exist.test.js`) ← read by `bot/shared/services/student-list.service.js:362:d2b02c3e`?
- … 1 more → `CLAUDE.index.md`

## Never (human)
- Allowlists only shrink: a new offender or higher count fails (tests/setup/ratchet-verdict-lib.js:7)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- skills: `qa-testing`? · `whatsapp-flows`?
- docs: `.claude/CLAUDE.md`? · `.claude/skills/data-standards/reference/instances/niete-rumi.md`? · `CLAUDE.md`? · `bot/marketing/README.md`? · `bot/scripts/setup/CLAUDE.index.md`? · `bot/scripts/setup/CLAUDE.md`? (+18)
