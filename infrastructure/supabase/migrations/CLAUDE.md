# migrations — Versioned NIETE migrations V1.0.0 to V1.8.3; some carry a ROLLBACK_ file
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=infrastructure/supabase/migrations kg=2dea2d11fdef gen=4c6904c8664b overflow=448 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `V1.8.0__coachip_insights.sql` — largest: 19 coachip_* tables and 25 enum types
- `V1.4.4__drop_first_last_name_columns.sql` — example of a code-first, drop-later migration
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.md` | (unmapped) |
| `V1.2.8__lp612_runtime_lesson_plans.sql` | Creates niete_lp612_segments (6-12 lesson menu) and niete_lp612_renders (cached renders handed to teachers) |
| `CLAUDE.index.md` | (unmapped) |
| `ROLLBACK_V1.4.0__lp612_render_degraded.sql` | Reverses V1.4.0: drops niete_lp612_renders.render_degraded; roll code back first as worker and serving read it |
| `ROLLBACK_V1.5.6__assessment_paper_versions.sql` | Reverses V1.5.6: drops edited_from, its check and indexes, renumbering version rows as extra attempts |
| … | 136 more → `CLAUDE.index.md` |

## Who reads this (generated)
- table `users` (written by `V1.0.3__users_teacher_uuid_backfill.sql` (+2)) ← read by `bot/scripts/assessment/backfill-paper-versions.js:158:cbfae632`? · `bot/shared/calls/call-context.repo.js:30:61dfd735`? (+171)
- table `app_settings` (written by `ROLLBACK_V1.5.6__assessment_paper_versions.sql` (+7)) ← read by `bot/shared/config/feature-flags.js:92:8d5282ae`? · `bot/shared/config/model-settings.js:162:19a9a79a`? (+124)
- … 312 more → `CLAUDE.index.md`

## Never (human)
- V1.4.4 drops users.first_name/last_name only after the reading code is live (V1.4.4__drop_first_last_name_columns.sql:3)
- No BEGIN/COMMIT in a migration (V1.8.0__coachip_insights.sql:20, exec_sql refuses it)
- Roll code back before ROLLBACK_V1.4.0 drops render_degraded (ROLLBACK_V1.4.0__lp612_render_degraded.sql:2-3)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `docs/LP_PATHS.md`? · `docs/pulling-updates.md`? · `infrastructure/CLAUDE.md`? · `infrastructure/supabase/CLAUDE.index.md`? · `infrastructure/supabase/CLAUDE.md`? · `infrastructure/supabase/migrations/CLAUDE.index.md`? (+1)
