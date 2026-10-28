# observe — Tests the /observe coach flow: portal observations, send, edit teacher, sweeps
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/observe kg=30aea7134d85 gen=57227309ec27 overflow=6 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `bd-5rz1v.6-portal-observe.test.js` — startPortalObservation, the portal-run observation entry
- `teacher-edit.test.js` — name, level and phone edits; classifyTarget on a new number
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/observe --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `bd*` | 14 files; most used `bd-5rz1v.6-portal-observe-worker.test.js`: bd-5rz1v.6: onAnalysisReady and processDebriefRecording store results for the portal and send nothing to WhatsApp |
| `CLAUDE.index.md` | (unmapped) |
| `iab-probe.test.js` | Pins the WhatsApp in-app-browser phone probe page: token gating, file-attach options and POST /api/iab-probe/upload |
| `CLAUDE.md` | (unmapped) |
| `coach*` | 3 files; most used `coach-fewer-bubbles.test.js`: Pins the observe flow's merged messages (debrief guide plus instruction, praise on coach card) and the 4096 split |
| `row-122-principal-dc-intent.test.js` | Row 122: a principal who declared DC intent gets own-lesson coaching, not the HITL teacher-binding list |
| `report-invite-refused.test.js` | Pins that a report invite template refused by WhatsApp is a failed send in observe-send and the untapped reminder |
| … | 6 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `OBSERVE_FICO_FLOW_HAS_FIDELITY` · `OBSERVE_MEWAKA_FLOW_ID` · `OPENAI_API_KEY` · `OPENROUTER_API_KEY` · `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_URL`

## Never (human)
- A portal-started observation sends nothing to WhatsApp, the operator's rule (bd-5rz1v.6-portal-observe-silent-failures.test.js:4)
- The untapped sweep must read an ordered pool, not an unordered limit(500) (bd-n6fl1-untapped-sweep-blind.test.js:4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/observe/CLAUDE.index.md`? · `bot/shared/services/observe/CLAUDE.md`? · `bot/shared/services/observe/assignment/CLAUDE.md`? · `bot/workers/CLAUDE.index.md`? (+7)
