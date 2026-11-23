# data — Static data the bot loads: child-test banks, LP SLO tags, Urdu term lists
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=bot/shared/data kg=f15dfc3d9cd6 gen=22ac55b1dd28 overflow=2 rendered=2026-11-20 kg.py=1.1.0 -->

## Entry points
- `child-test/` — EGRA/EGMA item banks and passages
- `lp612-fbise-slo-tags.json` — segment to SLO map for 6-12 LPs
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `child-test/` | Child test (Jugnu) item banks, passages, generated batteries and word lists → `child-test/CLAUDE.md` |
| `video-catalog.v*.json` | 2 versions — v1 imported; v2: (unmapped) |
| `lp612-fbise-slo-tags.json` | Map of 6-12 LP segment ids to FBISE SLO codes and status (Summative etc.) |
| `video-reco-urdu-terms.v1.json` | Urdu terms the video-recommendation engine may use in teacher-facing reason lines, owned by the pedagogy panel |
| `lp-own-goal-words.json` | (unmapped) |
| `lp-own-rubric-v3.json` | (unmapped) |

## Who reads this (generated)
- `lp612-fbise-slo-tags.json` ← imported by `bot/shared/services/lp612-fbise-tags.js:11:3246f1c6` · `bot/shared/services/lp612-own-slo.js:9:3246f1c6`
- `lp-own-goal-words.json` ← imported by `bot/shared/services/lp-own-goal-guard.js:18:e65316a6`
- `lp-own-rubric-v3.json` ← imported by `bot/shared/services/lp612-own-rubric.js:14:c67d6de7`
- `video-reco-urdu-terms.v1.json` ← imported by `bot/shared/services/coaching/video-reco/urdu-terms.js:11:b8bb2c00`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `tests/coaching/video-reco/r7b-silence.test.js` (video-catalog.v1.json)
- `tests/coaching/video-reco/r7j-urdu.test.js` (video-reco-urdu-terms.v1.json)
- `tests/coaching/video-reco/r7k-vetoes.test.js` (video-catalog.v1.json)
- `tests/coaching/video-reco/r7l.test.js` (video-catalog.v1.json)
- `tests/coaching/video-reco/r7o-71.test.js` (video-catalog.v1.json)
- `tests/coaching/video-reco/r7o-a.test.js` (video-catalog.v1.json)
- `tests/coaching/video-reco/r7o-b.test.js` (video-catalog.v1.json)
- `tests/coaching/video-reco/r7o-c.test.js` (video-catalog.v1.json)
- `tests/coaching/video-reco/r7o-nfs.test.js` (video-catalog.v1.json)
- `tests/lp612/fbise-slo-chips.test.js` (lp612-fbise-slo-tags.json)
- … 2 more → `CLAUDE.index.md`

## Related (generated)
- docs: `bot/shared/CLAUDE.md`?
