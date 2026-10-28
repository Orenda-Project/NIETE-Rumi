# coachip-media — COACHIP audio clip (R7) and circle (R8) streaming service and routes

<!-- kg:meta repo=NIETE-Rumi dir=tests/coachip-media kg=34a9a728c325 gen=6299d7151f7d overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `coachip-clip.service.test.js` — 300 s presign, 200/206/416 range streaming
- `coachip-media.routes.test.js` — R7/R8 over HTTP with scope and audit rows (needs Postgres)
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/coachip-media --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `coachip-media.routes.test.js` | bd-sex15q.16: COACHIP clip (R7) and circle media (R8) HTTP routes on a throwaway Postgres: scope, 404s, audit rows |
| `CLAUDE.md` | (unmapped) |
| `coachip-clip.service.test.js` | bd-sex15q.16: coachip-clip.service presigns 300 s R2 GetObject and streams audio with 200/206/416 range handling |

## Who reads this (generated)
- (none)

## Never (human)
- Presigned clip URLs last 300 s, never the 3600 s default (tests/coachip-media/coachip-clip.service.test.js:5)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `dashboard/routes/CLAUDE.index.md`? · `dashboard/services/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/coachip-media/CLAUDE.md`?
