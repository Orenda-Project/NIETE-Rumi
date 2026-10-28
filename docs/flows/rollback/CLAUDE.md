# rollback — Frozen snapshots of live Flows taken before a cutover, for rollback

<!-- kg:meta repo=NIETE-Rumi dir=docs/flows/rollback kg=87f53aae934c gen=eace843a3a43 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `registration-flow.prod-2010172012940869.pre-v5-2026-10-19.json` — prod registration before v5
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.md` | (unmapped) |
| `assessment-gen-flow.prod-v3-2026-09-05.json` | Rollback snapshot: the assessment-gen Flow as live in prod on 2026-09-05 (v5.1, five screens) |
| `assessment-review-flow.prod-v7-2026-09-30.json` | Rollback snapshot: the assessment-review Flow as live in prod on 2026-09-30 (v7.0, eleven screens) |
| `observe-visit-v2.pre-teacher-admin.json` | Rollback snapshot of observe-visit-v2 before the teacher-admin screens (24 screens); byte-identical to the staging copy |
| `observe-visit-v2.staging-pre-teacher-admin.json` | Staging rollback snapshot of observe-visit-v2 before teacher-admin; byte-identical duplicate of the other copy |
| `registration-flow.prod-2010172012940869.pre-v5-2026-10-19.json` | Rollback snapshot: the prod registration Flow before the v5 cutover on 2026-10-19 (v6.3, five screens) |

## Who reads this (generated)
- (none)

## Never (human)
- Do not edit snapshots; they are before-images. The two observe-visit-v2 files are byte-identical duplicates
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `docs/flows/CLAUDE.index.md`? · `docs/flows/CLAUDE.md`? · `docs/flows/rollback/CLAUDE.md`?
- flows: `assessment-gen-flow.prod-v3-2026-09-05.json`? · `assessment-review-flow.prod-v7-2026-09-30.json`? · `observe-visit-v2.pre-teacher-admin.json`? · `observe-visit-v2.staging-pre-teacher-admin.json`? · `registration-flow.prod-2010172012940869.pre-v5-2026-10-19.json`?
