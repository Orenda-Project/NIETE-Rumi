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
- column `assessment_papers.answer_key_r2_key` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:162:16468a3d`
- column `assessment_papers.attempt` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-orchestrator.service.js:417:ea7ca533`
- column `assessment_papers.created_at` (written by `backfill-paper-versions.js`, `repair-backfilled-v1-created-at.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:162:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:414:2e6454e9` · `bot/shared/services/assessment/assessment-revision.service.js:478:5173b1ec` · `bot/scripts/assessment/repair-backfilled-v1-created-at.js:69:e3ab478d`
- column `assessment_papers.edited_from` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:162:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:416:62e6c849` · `bot/shared/services/assessment/assessment-revision.service.js:477:d03971b6` · `bot/scripts/assessment/repair-backfilled-v1-created-at.js:69:e3ab478d`
- column `assessment_papers.exam_json` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-revision.service.js:102:dc9b27f2`
- column `assessment_papers.file_r2_key` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:162:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:414:2e6454e9`
- column `assessment_papers.id` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:162:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:130:7d5d31c5` · `bot/shared/services/assessment/assessment-revision.service.js:102:dc9b27f2` · `bot/scripts/assessment/repair-backfilled-v1-created-at.js:69:e3ab478d`
- column `assessment_papers.question_count` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-orchestrator.service.js:414:2e6454e9` · `bot/shared/services/assessment/assessment-revision.service.js:501:01339c15`
- column `assessment_papers.request_id` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:162:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:415:a62a38f3` · `bot/shared/services/assessment/assessment-revision.service.js:102:dc9b27f2`
- column `assessment_papers.status` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:162:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:144:71e60a4b` · `bot/shared/services/assessment/assessment-revision.service.js:102:dc9b27f2`
- column `assessment_papers.total_marks` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-orchestrator.service.js:414:2e6454e9` · `bot/shared/services/assessment/assessment-revision.service.js:501:01339c15`
- column `assessment_papers.updated_at` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-orchestrator.service.js:414:2e6454e9`
- table `assessment_papers` (written by `backfill-paper-versions.js`, `repair-backfilled-v1-created-at.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:161:d5e4566e`? · `bot/shared/services/assessment/assessment-orchestrator.service.js:128:5783e845`? · `bot/shared/services/assessment/assessment-revision.service.js:96:d5e4566e`? · `dashboard/routes/portal.routes.js:1756:f8c4de9c`? (+2: `python3 kg/kg.py who-reads assessment_papers`)

## Tests (all, generated)
- `backfill-paper-versions.js` ← `tests/assessment/backfill-paper-versions.test.js` · `tests/assessment/repair-backfilled-v1-created-at.test.js`
- `repair-backfilled-v1-created-at.js` ← `tests/assessment/repair-backfilled-v1-created-at.test.js`

## Related (all, generated)
- docs: `bot/scripts/CLAUDE.md`?
