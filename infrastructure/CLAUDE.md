# infrastructure — DB schema, migrations, deploy configs, WhatsApp templates

<!-- kg:meta repo=NIETE-Rumi dir=infrastructure kg=a7ce79dd558f gen=eb2d1bd55981 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `scripts/migrate.js` — versioned migration runner using the schema_versions ledger
- `supabase/migrations/V1.8.3__coachip_job_runs_env_ref.sql` — newest versioned migration
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `branding/` | → (no door; 5 files) |
| `flows/` | WhatsApp Flow JSON deployed to the NIETE WABA; only registration is ported → `flows/CLAUDE.md` |
| `railway/` | → (no door; 2 files) |
| `scripts/` | Operator scripts: migrate, fresh-DB bootstrap, connection test, staging env → `scripts/CLAUDE.md` |
| `supabase/` | Fresh-install SQL (schema, RLS, seed) and versioned migrations for NIETE Supabase → `supabase/CLAUDE.md` |
| `sync/` | Maintainer-only config for syncing internal code to the public rumi-platform repo → `sync/CLAUDE.md` |
| `templates/` | WhatsApp message template JSON per WABA, plus submit and re-upload scripts → `templates/CLAUDE.md` |
| `CLAUDE.md` | (unmapped) |
| `CLAUDE.index.md` | (unmapped) |

## Who reads this (generated)
- (none)

## Never (human)
- Schema changes go in supabase/migrations/V*.sql; migrate.js applies only those (scripts/migrate.js:118)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- skills: `database-analysis`? · `digital-coach`?
- docs: `CLAUDE.md`? · `README.md`? · `infrastructure/CLAUDE.index.md`? · `infrastructure/CLAUDE.md`? · `infrastructure/flows/CLAUDE.md`? · `infrastructure/scripts/CLAUDE.md`? (+9)
