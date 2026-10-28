# meta-bill-cut — Tests the Oct 2026 fix rounds that cut billed WhatsApp sends and stray typing

<!-- kg:meta repo=NIETE-Rumi dir=tests/meta-bill-cut kg=03bcc435b4c6 gen=4df971f43eb7 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `fx7-reaction-only-taps.test.js` — the class rule: reaction-only taps never leave typing on
- `fx4-round3.test.js` — every lesson-plan door shows typing; coach observations stay immediate
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/meta-bill-cut --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `fx4-round3.test.js` | bd-w2daa.26: every lesson-plan door shows typing, coach observations stay immediate, pasted plan handed to the job |
| `fx3-silent-turn-typing.test.js` | bd-w2daa.24: typing indicator is cancelled on turns where the bot sends nothing (quiet-hour redirect, slow door) |
| `fx6-round4.test.js` | bd-w2daa.28: commit-card answers get distinct reactions; typed survey reason is answered by a reaction alone |
| `fx1-handoff-typing-and-acks.test.js` | bd-w2daa.22 FX1: deferred LP-outcome line rides the job's Step 2/5, with typing fallback and coach control case |
| `fx7-reaction-only-taps.test.js` | bd-w2daa.31: reaction-only taps never leave typing in the chat header (registry taps, coaching survey, K-5) |
| `CLAUDE.md` | (unmapped) |
| `fx3-photo-burst-lock.test.js` | bd-w2daa.24: a gallery burst of photos is stored without overwrite and answered with ONE prompt carrying the count |

## Who reads this (generated)
- env read here: `FX4_DEBUG` · `FX6_DEBUG`

## Never (human)
- A tap answered only by a reaction must never leave typing in the chat header (fx7-reaction-only-taps.test.js:5)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/config/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/classroom-photo/CLAUDE.index.md`? · `bot/shared/services/coaching/coaching-card/CLAUDE.index.md`? · `bot/shared/services/coaching/lp-coaching/CLAUDE.index.md`? (+3)
