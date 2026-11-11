# assessment — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/scripts/assessment -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `backfill-paper-versions.js` | One-off dry-run-first backfill turning pre-versioning edited papers into two versions; needs --expect-ref guard |
| `repair-backfilled-v1-created-at.js` | Repairs v1 rows the first paper-versions backfill wrote with wrong created_at (bd-5ioto.11); dry run default |

## Who reads this (all, generated)
- `backfill-paper-versions.js` ← imported by `bot/scripts/assessment/repair-backfilled-v1-created-at.js:26:3a44c431`
- column `assessment_papers.answer_key_r2_key` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:174:16468a3d`
- column `assessment_papers.attempt` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-orchestrator.service.js:422:ea7ca533`
- column `assessment_papers.created_at` (written by `backfill-paper-versions.js`, `repair-backfilled-v1-created-at.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:174:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:419:2e6454e9` · `bot/shared/services/assessment/assessment-revision.service.js:484:5173b1ec` · `bot/shared/services/assessment/repeat-guard.js:82:57ea56b0` (+1: `python3 kg/kg.py who-reads assessment_papers.created_at`)
- column `assessment_papers.edited_from` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:174:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:421:62e6c849` · `bot/shared/services/assessment/assessment-revision.service.js:483:d03971b6` · `bot/scripts/assessment/repair-backfilled-v1-created-at.js:69:e3ab478d`
- column `assessment_papers.exam_json` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-revision.service.js:108:dc9b27f2` · `bot/shared/services/assessment/repeat-guard.js:82:57ea56b0`
- column `assessment_papers.file_r2_key` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:174:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:419:2e6454e9`
- column `assessment_papers.id` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:174:16468a3d` · `bot/shared/services/assessment/assessment-feedback.service.js:67:760b644f` · `bot/shared/services/assessment/assessment-orchestrator.service.js:131:7d5d31c5` · `bot/shared/services/assessment/assessment-revision.service.js:108:dc9b27f2` (+1: `python3 kg/kg.py who-reads assessment_papers.id`)
- column `assessment_papers.question_count` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-orchestrator.service.js:419:2e6454e9` · `bot/shared/services/assessment/assessment-revision.service.js:507:01339c15`
- column `assessment_papers.request_id` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:174:16468a3d` · `bot/shared/services/assessment/assessment-feedback.service.js:67:760b644f` · `bot/shared/services/assessment/assessment-orchestrator.service.js:420:a62a38f3` · `bot/shared/services/assessment/assessment-revision.service.js:108:dc9b27f2` (+1: `python3 kg/kg.py who-reads assessment_papers.request_id`)
- column `assessment_papers.status` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:174:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:145:71e60a4b` · `bot/shared/services/assessment/assessment-revision.service.js:108:dc9b27f2` · `bot/shared/services/assessment/repeat-guard.js:82:57ea56b0`
- column `assessment_papers.total_marks` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-orchestrator.service.js:419:2e6454e9` · `bot/shared/services/assessment/assessment-revision.service.js:507:01339c15`
- column `assessment_papers.updated_at` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-orchestrator.service.js:419:2e6454e9`
- table `assessment_papers` (written by `backfill-paper-versions.js`, `repair-backfilled-v1-created-at.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:173:d5e4566e`? · `bot/shared/services/assessment/assessment-feedback.service.js:67:760b644f`? · `bot/shared/services/assessment/assessment-orchestrator.service.js:129:5783e845`? · `bot/shared/services/assessment/assessment-revision.service.js:102:d5e4566e`? (+4: `python3 kg/kg.py who-reads assessment_papers`)

## Tests (all, generated)
- `backfill-paper-versions.js` ← `tests/assessment/backfill-paper-versions.test.js` · `tests/assessment/repair-backfilled-v1-created-at.test.js`
- `repair-backfilled-v1-created-at.js` ← `tests/assessment/repair-backfilled-v1-created-at.test.js`

## Related (all, generated)
- docs: `bot/scripts/CLAUDE.md`?
