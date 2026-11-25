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
- column `assessment_papers.answer_key_r2_key` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:177:16468a3d`
- column `assessment_papers.attempt` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-orchestrator.service.js:452:ea7ca533`
- column `assessment_papers.created_at` (written by `backfill-paper-versions.js`, `repair-backfilled-v1-created-at.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:177:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:449:2e6454e9` · `bot/shared/services/assessment/assessment-revision.service.js:486:5173b1ec` · `bot/shared/services/assessment/paper-reuse.js:83:07cafb09` (+2: `python3 kg/kg.py who-reads assessment_papers.created_at`)
- column `assessment_papers.edited_from` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:177:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:451:62e6c849` · `bot/shared/services/assessment/assessment-revision.service.js:485:d03971b6` · `bot/shared/services/assessment/paper-reuse.js:81:62e6c849` (+1: `python3 kg/kg.py who-reads assessment_papers.edited_from`)
- column `assessment_papers.exam_json` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-revision.service.js:108:dc9b27f2` · `bot/shared/services/assessment/paper-reuse.js:68:d237b35a` · `bot/shared/services/assessment/repeat-guard.js:82:57ea56b0`
- column `assessment_papers.file_r2_key` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:177:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:449:2e6454e9` · `bot/shared/services/share-send.service.js:138:d8862cc7`
- column `assessment_papers.id` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:177:16468a3d` · `bot/shared/services/assessment/assessment-feedback.service.js:67:760b644f` · `bot/shared/services/assessment/assessment-orchestrator.service.js:138:7d5d31c5` · `bot/shared/services/assessment/assessment-revision.service.js:108:dc9b27f2` (+3: `python3 kg/kg.py who-reads assessment_papers.id`)
- column `assessment_papers.model` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/paper-reuse.js:77:4e808f9b`
- column `assessment_papers.question_count` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-orchestrator.service.js:449:2e6454e9` · `bot/shared/services/assessment/assessment-revision.service.js:509:01339c15` · `bot/shared/services/assessment/paper-reuse.js:77:4e808f9b` · `bot/shared/services/share-send.service.js:138:d8862cc7`
- column `assessment_papers.request_id` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:177:16468a3d` · `bot/shared/services/assessment/assessment-feedback.service.js:67:760b644f` · `bot/shared/services/assessment/assessment-orchestrator.service.js:450:a62a38f3` · `bot/shared/services/assessment/assessment-revision.service.js:108:dc9b27f2` (+1: `python3 kg/kg.py who-reads assessment_papers.request_id`)
- column `assessment_papers.status` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:177:16468a3d` · `bot/shared/services/assessment/assessment-orchestrator.service.js:157:71e60a4b` · `bot/shared/services/assessment/assessment-revision.service.js:108:dc9b27f2` · `bot/shared/services/assessment/paper-reuse.js:80:51f3f107` (+2: `python3 kg/kg.py who-reads assessment_papers.status`)
- column `assessment_papers.total_marks` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-orchestrator.service.js:449:2e6454e9` · `bot/shared/services/assessment/assessment-revision.service.js:509:01339c15`
- column `assessment_papers.updated_at` (written by `backfill-paper-versions.js`) ← read by `bot/shared/services/assessment/assessment-orchestrator.service.js:449:2e6454e9`
- table `assessment_papers` (written by `backfill-paper-versions.js`, `repair-backfilled-v1-created-at.js`) ← read by `bot/shared/services/assessment/assessment-browse.service.js:176:d5e4566e`? · `bot/shared/services/assessment/assessment-feedback.service.js:67:760b644f`? · `bot/shared/services/assessment/assessment-orchestrator.service.js:136:bee96f39`? · `bot/shared/services/assessment/assessment-revision.service.js:102:d5e4566e`? (+6: `python3 kg/kg.py who-reads assessment_papers`)

## Tests (all, generated)
- `backfill-paper-versions.js` ← `tests/assessment/backfill-paper-versions.test.js` · `tests/assessment/repair-backfilled-v1-created-at.test.js`
- `repair-backfilled-v1-created-at.js` ← `tests/assessment/repair-backfilled-v1-created-at.test.js`

## Related (all, generated)
- docs: `bot/scripts/CLAUDE.md`?
