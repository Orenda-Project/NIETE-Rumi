# helpers — Shared helpers for COACHIP tests: temp Postgres, app mount, fictional seed rows

<!-- kg:meta repo=NIETE-Rumi dir=tests/coachip/helpers kg=26d645e8a6b5 gen=6331fe5cbf6c overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `pg-harness.js` — throwaway Postgres on a temp unix socket; skips when no server binary
- `seed.js` — fictional rows (fake v4 UUIDs, no real names, phones or places)
- Helpers only, no *.test.js, so no runner picks them directly; used by `tests/coachip/*.test.js`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `pg-harness.js` | Test helper: starts a throwaway Postgres per test file (unix socket, temp dir) carrying the insights and live tables |
| `app.js` | Test helper: mounts the real COACHIP router on dashboard's express with a session stub and Postgres-backed flag readers |
| `seed.js` | Test helper: fictional users, schools and coaching rows with fake v4 UUIDs, per COACHIP FIXTURES rules |
| `CLAUDE.md` | (unmapped) |
| `insights-seed.js` | Test helper seeding fictional COACHIP insight rows (library, rollups, moments) with fixed provenance values |

## Who reads this (generated)
- env read here: `PG_BIN`

## Never (human)
- Seed data stays fictional: no names, phones or URLs (tests/coachip/helpers/insights-seed.js:5)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `dashboard/lib/CLAUDE.index.md`? · `dashboard/routes/CLAUDE.index.md`? · `dashboard/services/CLAUDE.index.md`? · `tests/coachip/CLAUDE.index.md`? · `tests/coachip/CLAUDE.md`? · `tests/coachip/helpers/CLAUDE.md`?
