# data — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=bot/shared/data -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `child-test/` | Child test (Jugnu) item banks, passages, generated batteries and word lists → `child-test/CLAUDE.md` |
| `lp-own-goal-words.json` | (unmapped) |
| `lp-own-rubric-v3.json` | (unmapped) |
| `lp612-fbise-slo-tags.json` | Map of 6-12 LP segment ids to FBISE SLO codes and status (Summative etc.) |
| `video-catalog.v1.json` | (unmapped) |
| `video-catalog.v2.json` | (unmapped) |
| `video-reco-urdu-terms.v1.json` | Urdu terms the video-recommendation engine may use in teacher-facing reason lines, owned by the pedagogy panel |

## Who reads this (all, generated)
- `lp-own-goal-words.json` ← imported by `bot/shared/services/lp-own-goal-guard.js:18:e65316a6`
- `lp-own-rubric-v3.json` ← imported by `bot/shared/services/lp612-own-rubric.js:14:c67d6de7`
- `lp612-fbise-slo-tags.json` ← imported by `bot/shared/services/lp612-fbise-tags.js:11:3246f1c6` · `bot/shared/services/lp612-own-slo.js:9:3246f1c6`
- `video-reco-urdu-terms.v1.json` ← imported by `bot/shared/services/coaching/video-reco/urdu-terms.js:11:b8bb2c00`

## Tests (all, generated)
- `lp612-fbise-slo-tags.json` ← `tests/lp612/fbise-slo-chips.test.js` · `tests/lp612/own-ways.test.js` · `tests/portal/lp612-own-slo-route.test.js`
- `video-catalog.v1.json` ← `tests/coaching/video-reco/r7b-silence.test.js` · `tests/coaching/video-reco/r7k-vetoes.test.js` · `tests/coaching/video-reco/r7l.test.js` · `tests/coaching/video-reco/r7o-71.test.js` · `tests/coaching/video-reco/r7o-a.test.js` · `tests/coaching/video-reco/r7o-b.test.js` (+2: `python3 kg/kg.py who-reads bot/shared/data/video-catalog.v1.json`)
- `video-reco-urdu-terms.v1.json` ← `tests/coaching/video-reco/r7j-urdu.test.js`

## Related (all, generated)
- docs: `bot/shared/CLAUDE.md`?
