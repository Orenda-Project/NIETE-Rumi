# conversation-state — One-row-per-teacher conversation state store and the resume sweeper
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/conversation-state kg=2f8c12138e63 gen=24acc33e0e89 overflow=4 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `state-store.test.js` — conversation-state.service as the single read/write home
- `no-legacy-state-stores.test.js` — static guard that no other store owns state
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/conversation-state --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `recording-ends-coaching-wait.test.js` | A classroom recording ends the "send me your recording" wait so the six-hour resume nudge does not fire |
| `resume-quiet-hours.test.js` | The resume offer defers at night (PKT quiet hours) and is sent once in the morning with the step kept |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `flows-on-the-store.test.js` | Per-teacher waits (video, lesson-plan topic) moved from Redis keys onto the conversation-state store |
| `cross-flow-safety.test.js` | One state row per teacher: opening the menu must not overwrite an in-progress video or other flow |
| `intent-never-dropped.test.js` | A menu tap with no surviving state still opens lesson planning or training instead of "selection expired" |
| `resume-offer.test.js` | The resume sweeper offers each expired paused flow back once and records that it asked |
| `clear-expired.contract.test.js` | bd-43517: clearState clears an EXPIRED row of the named flow, which is what the sweeper hands it; live-row control |
| `sweep-does-not-clobber.test.js` | The resume sweep does not overwrite state of a teacher who became active between select and write |
| … | 4 more → `CLAUDE.index.md` |

## Who reads this (generated)
- (none)

## Never (human)
- Only conversation-state.service owns conversation state (tests/conversation-state/no-legacy-state-stores.test.js:2)
- The sweep must not overwrite a teacher who came back (tests/conversation-state/sweep-does-not-clobber.test.js:2)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/database/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/nudges/CLAUDE.index.md`? · `bot/shared/services/video/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? (+2)
