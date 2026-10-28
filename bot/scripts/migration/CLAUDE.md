# migration — One-off NIETE migration appliers, lesson-plan imports and surveys

<!-- kg:meta repo=NIETE-Rumi dir=bot/scripts/migration kg=7af68769af35 gen=9dd1097a41e9 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `apply-018-lp-v8-assets.js` — applies migration 018
- `verify-018-preflight.py` — read-only live schema check first
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.md` | (unmapped) |
| `import-tbcore-lps.js` | Imports NBF and Taleemabad lesson plans from Taleemabad prod Postgres into curriculum_lp_ast; dry-run supported |
| `apply-017-lp-feedback.js` | Applies migration 017 (lp_feedback table) to NIETE Supabase via pooler, falling back to printed SQL |
| `apply-018-lp-v8-assets.js` | Applies migration 018 (niete_lp_assets, niete_lp_downloads, lp_feedback.useful_component); idempotent |
| `survey-lp-counts.js` | Counts lesson-plan rows per corpus with count queries to avoid the 1000-row cap |
| `survey-lp-inventory.js` | One-shot inventory of lesson-plan corpora in NIETE Supabase and taleemabad-core prod, to plan the next import wave |
| `verify-018-preflight.py` | Read-only preflight proving migration 018's tables and columns exist in compatible types on the live database |

## Who reads this (generated)
- table `curriculum_lp_ast` whole row (`*`) (written by `import-tbcore-lps.js`) ← read by `bot/scripts/render/render-one-lp.js:115:d61f3f19`? · `bot/scripts/render/render-v7-lp.js:56:94380945`? (+1)
- table `curriculum_lp_ast` (written by `import-tbcore-lps.js`) ← read by `bot/shared/services/curriculum-lp-ast.service.js:62:fe1db9e9`? · `bot/scripts/migration/survey-lp-inventory.js:37:fe1db9e9`?
- env read here: `NIETE_ENV_PATH` · `SUPABASE_DB_PASSWORD` · `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_URL` · `TALEEMABAD_DB_HOST` · `TALEEMABAD_DB_NAME` · `TALEEMABAD_DB_PASSWORD` · `TALEEMABAD_DB_PORT` · `TALEEMABAD_DB_SCHEMA` · `TALEEMABAD_DB_USER`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/CLAUDE.index.md`? · `bot/scripts/CLAUDE.md`? · `bot/scripts/migration/CLAUDE.md`? · `docs/migration/01-lesson-plans.md`? · `docs/migration/CLAUDE.index.md`?
