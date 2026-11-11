# setup — Repo-wide guard tests: schema, migrations, flows, hygiene ratchets and setup scripts
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/setup kg=b7a3bc269e1a gen=8f64d093ef57 overflow=75 rendered=2026-10-29 kg.py=1.1.0 -->

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
| `register*` | 3 files; most used `register-all-flows.test.js`: Tests bot/scripts/setup/register-all-flows: all 24 FLOW_CONFIGS and their registration against a mocked MetaAPI |
| `source-hygiene.test.js` | Guard for the public repo: no internal ticket refs in shipped source or docs/flows JSON authoring metadata |
| `validate-flows.test.js` | Tests validate-flows preflight: flows and templates exist and are PUBLISHED, encryption configured; returns valid/issues |
| `migrate.test.js` | Tests infrastructure/scripts/migrate MigrationRunner with a mocked supabase client: applied versions, ordering |
| `web*` | 3 files; most used `web-quiz-owned-paths.js`: Helper listing the web quiz's own path prefixes so module lists beside query goldens compare only inside them |
| … | 147 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Allowlists only shrink: a new offender or higher count fails (tests/setup/ratchet-verdict-lib.js:7)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- skills: `qa-testing`? · `whatsapp-flows`?
- docs: `.claude/CLAUDE.md`? · `.claude/skills/data-standards/reference/instances/niete-rumi.md`? · `CLAUDE.md`? · `bot/marketing/README.md`? · `bot/scripts/setup/CLAUDE.md`? · `docs/customization.md`? (+7)
