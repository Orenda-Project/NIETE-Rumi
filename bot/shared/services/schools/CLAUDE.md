# schools — School lookup from the schools table and the legacy-migration transforms

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/services/schools kg=b6fb6143f7e9 gen=33a59a1d7b4c overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `school-resolver.service.js` — user to school via users.school_id
- `school-search.service.js` — registration Flow school picker
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `school-search.service.js` | Searches schools by typed text for the registration Flow school step; only real, non-test rows (bd-x7aprz.2) |
| `school-card-door.js` | Parses /school card [EMIS or name] and picks the school whose page the link opens |
| `school-resolver.service.js` | Resolves a user's school through the users.school_id to schools FK, with EMIS lookup |
| `school-migration.transform.js` | Pure transforms for the legacy Postgres to Supabase schools/principals migration, run by scripts/migrate-schools.py |

## Who reads this (generated)
- `school-card-door.js` ← imported by `bot/shared/handlers/text-message.handler.js:234:ea91fd53` · `bot/shared/services/app-redirect.service.js:656:7104e6a8`
- `school-search.service.js` ← imported by `bot/shared/routes/registration-endpoint.js:95:1fc82996` · `bot/shared/services/schools/school-card-door.js:102:cc6600ce`
- `school-resolver.service.js` ← imported by `bot/shared/routes/registration-endpoint.js:47:32923e9e`

## Never (human)
- Search returns only existing, non-test schools; a miss is an empty list, never a guess (school-search.service.js:18,96)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/app-redirect/app-link-coach-school-card.test.js` (school-card-door.js)
- `tests/database/bd-2533-school-migration.test.js` (school-migration.transform.js)
- `tests/database/bd-2533-school-resolver.test.js` (school-resolver.service.js)
- `tests/registration/bd-x7aprz2-registration-v5.test.js` (school-search.service.js)
- `tests/registration/bd-x7aprz9-finish-closes-flow.test.js` (school-search.service.js)

## Related (generated)
- skills: `registration`?
- docs: `bot/shared/services/CLAUDE.md`?
