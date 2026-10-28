# video-reco — Tests for video recommendation: clip pick, copy, name redaction, strip, send and A/B
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/coaching/video-reco kg=6023d8071cd2 gen=039df0fd114f overflow=62 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `engine.test.js` — engine.recommendForReport: flag off no-op, never throws, shadow storage, none reasons
- `redact-names.test.js` — no person's name may survive into a quote; read before touching copy or quote code
- Run from repo root: `node tests/run.js tests/coaching/video-reco --maxWorkers=2`; shared helpers in fixtures/ and fixtures-strip.js
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fixtures/` | → (no door; 2 test files) |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `skip*` | 3 files; most used `skip-iab.test.js`: bd-9dbhh0.1: no WhatsApp clip message unless VIDEO_RECO_WA_MESSAGE is on; link in the caption and strip hint |
| `r7c.test.js` | bd-8hhqhf R7c: seven panel-driven asks before the A/B, e.g. a child's name in the card never reaches the fallback |
| `r7e-moment.test.js` | bd-8hhqhf R7e: moment rule (no greeting-time moments), B10 closure chapters and copy residuals from panel rows |
| `r7f.test.js` | bd-8hhqhf R7f: routes, gap, closure, Urdu line and owed silences from panel rows; retry citing a greeting |
| `r7g.test.js` | bd-8hhqhf R7g: retired step-text route, F5-label closed-question rule, card-frame move check, tag leaks and silences |
| `v13f.test.js` | bd-8hhqhf: card-sentence fallback trims long sentences at a word boundary; name check ignores honorifics and roles |
| … | 62 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `VIDEO_RECO_ENABLED`

## Never (human)
- No person's name survives into a quote or stored reason (`redact-names.test.js:3`; bd-8hhqhf R7g/R7i redaction tests)
- store.write must obey the V1.7.1/V1.7.2 CHECKs, read from the migration files (`r7n-attempts-check.test.js:8`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/video-reco/CLAUDE.md`? · `bot/shared/data/CLAUDE.md`? · `bot/shared/services/child-test/scoring/tasks/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/report-v2/CLAUDE.index.md`? · `bot/shared/services/coaching/video-reco/CLAUDE.index.md`? (+10)
