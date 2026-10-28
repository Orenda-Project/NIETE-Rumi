# conversation-state — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/conversation-state -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `clear-expired.contract.test.js` | bd-43517: clearState clears an EXPIRED row of the named flow, which is what the sweeper hands it; live-row control |
| `cross-flow-safety.test.js` | One state row per teacher: opening the menu must not overwrite an in-progress video or other flow |
| `every-flow-is-decided.test.js` | Every flow on the conversation store must be explicitly decided in all three enumerations, found by reading code |
| `flows-on-the-store.test.js` | Per-teacher waits (video, lesson-plan topic) moved from Redis keys onto the conversation-state store |
| `intent-never-dropped.test.js` | A menu tap with no surviving state still opens lesson planning or training instead of "selection expired" |
| `no-legacy-state-stores.test.js` | Static guard: no code uses legacy conversation_state stores; conversation-state.service is the only owner |
| `recording-ends-coaching-wait.test.js` | A classroom recording ends the "send me your recording" wait so the six-hour resume nudge does not fire |
| `resume-offer.test.js` | The resume sweeper offers each expired paused flow back once and records that it asked |
| `resume-quiet-hours.test.js` | The resume offer defers at night (PKT quiet hours) and is sent once in the morning with the step kept |
| `state-store.test.js` | conversation-state.service as the one read/write home for "what is this teacher doing", keyed by teacher alone |
| `sweep-does-not-clobber.test.js` | The resume sweep does not overwrite state of a teacher who became active between select and write |
| `sweep-observability.test.js` | bd-43520: the resume sweep (driven from a worker) logs its failures and every tally field can yield a log line |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/shared/database/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/nudges/CLAUDE.index.md`? · `bot/shared/services/video/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/conversation-state/CLAUDE.index.md`? · `tests/conversation-state/CLAUDE.md`?
