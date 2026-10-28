# observe — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/observe -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `bd-2hjqk-multi-remove.test.js` | bd-2hjqk: removing several teachers from one school in one pass (multi-select TEACHER_PICK, cap 30, optional reason) |
| `bd-44003-roster-scope.test.js` | bd-44003: roster inheritance refuses when one school_ext_id covers two schools (canonicalSchoolName, leader-assignment) |
| `bd-5n1a2-resolve-teacher-empty-school.test.js` | bd-5n1a2: resolveTeacher in leader-source retries unfiltered when school_ext_id is empty, still null for unknown |
| `bd-5rz1v.6-portal-observe-silent-failures.test.js` | bd-5rz1v.6: a failed portal-started observation fails loudly in logs and tells the coach nothing on WhatsApp |
| `bd-5rz1v.6-portal-observe-step.test.js` | bd-5rz1v.6: observeStep derives the coach portal's current step (draft, talk, listening, report) from the row alone |
| `bd-5rz1v.6-portal-observe-transcription.test.js` | bd-5rz1v.6: observePostTranscription for portal observations queues analysis directly, skipping WhatsApp gates |
| `bd-5rz1v.6-portal-observe-worker.test.js` | bd-5rz1v.6: onAnalysisReady and processDebriefRecording store results for the portal and send nothing to WhatsApp |
| `bd-5rz1v.6-portal-observe.test.js` | bd-5rz1v.6: startPortalObservation writes the row, queues transcription, links the teacher's plan and photos |
| `bd-5rz1v.6.9-portal-observation-no-step-messages.test.js` | bd-5rz1v.6.9: a coach's portal observation sends no teacher-worded Step 1/5 or 2/5 progress messages |
| `bd-fmf24g.66-coach-plan-no-teacher-whatsapp.test.js` | bd-fmf24g.66: an unreadable plan attached by a coach must not WhatsApp the teacher; a self-upload still does |
| `bd-n6fl1-untapped-age-ceiling.test.js` | bd-n6fl1: age ceiling in observe-untapped.service expires reports too old to chase instead of nudging them |
| `bd-n6fl1-untapped-sweep-blind.test.js` | bd-n6fl1: the untapped-report sweep reads the whole pool oldest first, not an unordered limit(500) that went blind |
| `bd-trksw9-narrative-failure.test.js` | bd-trksw9: generateReportNarrative retries once then returns null, and a failed narrative must not ship a hollow report |
| `bd-zq0ea-debrief-duplicate-recording.test.js` | bd-zq0ea: a coach's debrief recording sent against another pending observation is analysed once, with bilingual refusal |
| `coach-fewer-bubbles-webhook.test.js` | Drives the real /webhook route: FICO form submit and next-step buttons collapse into fewer coach WhatsApp messages |
| `coach-fewer-bubbles.test.js` | Pins the observe flow's merged messages (debrief guide plus instruction, praise on coach card) and the 4096 split |
| `coach-no-teacher-progress-steps.test.js` | A coach's observation is not narrated with the teacher-worded Step 1/5 and 2/5 coaching progress lines |
| `iab-probe.test.js` | Pins the WhatsApp in-app-browser phone probe page: token gating, file-attach options and POST /api/iab-probe/upload |
| `nameless-teacher-is-findable.test.js` | Pins that a teacher with an empty first_name stays findable: name chain extended, patch rows keep a label |
| `observe-language-market-fallback.test.js` | Pins that observe-language's market fallback agrees with the registry's first offered language (Urdu) |
| `report-invite-refused.test.js` | Pins that a report invite template refused by WhatsApp is a failed send in observe-send and the untapped reminder |
| `row-122-principal-dc-intent.test.js` | Row 122: a principal who declared DC intent gets own-lesson coaching, not the HITL teacher-binding list |
| `send-interactive-fallback.test.js` | Report-send never goes silent when WhatsApp refuses a roster list: retry, then a typed-details ask (observe-send) |
| `send-preview-per-teacher.test.js` | "Someone else" report preview: the preview job is keyed by recipient so a second teacher's preview is not dropped |
| `teacher-edit-commit.test.js` | bd-o15qnr.13: portal Edit-teacher commits via teacher-edit-commit.service with per-school authorisation checks |
| `teacher-edit.test.js` | Pins /observe teacher edit (name, level, phone): classifyTarget FREE/SHELL/TAKEN when moving a number |

## Who reads this (all, generated)
- env `OBSERVE_FICO_FLOW_HAS_FIDELITY` read at `tests/observe/bd-5rz1v.6-portal-observe-worker.test.js:364:aa16fa7d`
- env `OBSERVE_MEWAKA_FLOW_ID` read at `tests/observe/row-122-principal-dc-intent.test.js:46:2b5a7d7d`
- env `OPENAI_API_KEY` read at `tests/observe/bd-5rz1v.6.9-portal-observation-no-step-messages.test.js:19:334ba0e9` · `tests/observe/bd-n6fl1-untapped-sweep-blind.test.js:21:334ba0e9`
- env `OPENROUTER_API_KEY` read at `tests/observe/bd-5rz1v.6.9-portal-observation-no-step-messages.test.js:20:6d424b49` · `tests/observe/bd-n6fl1-untapped-sweep-blind.test.js:20:6d424b49`
- env `SUPABASE_SERVICE_ROLE_KEY` read at `tests/observe/bd-5rz1v.6.9-portal-observation-no-step-messages.test.js:18:cd796d8a` · `tests/observe/bd-n6fl1-untapped-sweep-blind.test.js:19:cd796d8a`
- env `SUPABASE_URL` read at `tests/observe/bd-5rz1v.6.9-portal-observation-no-step-messages.test.js:17:d1ac37ba` · `tests/observe/bd-n6fl1-untapped-sweep-blind.test.js:18:d1ac37ba`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/coaching/CLAUDE.index.md`? · `bot/shared/services/observe/CLAUDE.index.md`? · `bot/shared/services/observe/CLAUDE.md`? · `bot/shared/services/observe/assignment/CLAUDE.md`? · `bot/workers/CLAUDE.index.md`? · `dashboard/middleware/CLAUDE.md`? · `dashboard/routes/CLAUDE.index.md`? · `dashboard/services/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/observe/CLAUDE.index.md`? · `tests/observe/CLAUDE.md`?
