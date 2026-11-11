# coaching — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/teacher/coaching -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CoachingAll.test.tsx` | Pins All DC observations: date range, server-counted KPI tiles vs prior period, lessons by day as bands (bd-fmf24g.4) |
| `CoachingAll.tsx` | All DC observations page (See all from Recent): DateRangeBar, KPI tiles from /teacher/coaching/history, lessons by day |
| `CoachingHome.tsx` | Digital Coaching main page: Start DC observation card, Summary, Analysing, Recent DC Observations with See all |
| `CoachingPages.test.tsx` | Pins the Digital Coaching pages and the one-screen draft: grade/subject, record or upload, submit (bd-fmf24g.4, .76) |
| `NewObservation.live.test.tsx` | Pins live moves on the one screen while recording with a library plan and card; Submit sends ticks (bd-v0toag.31.4) |
| `NewObservation.tsx` | The one Digital Coaching screen: Grade and subject, Recording, Lesson plan, Photos, Submit, progress; /coaching/new |
| `ReportPage.iabRows.test.tsx` | Pins ICT feedback rows 34-36 on a ready report: no clock on audio, Quick Quiz placement (bd-bmc9a0.4) |
| `ReportPage.quiz.test.tsx` | Pins 'Quiz this lesson' on a ready Digital Coach report, own lessons only, never on a coach visit report |
| `ReportPage.test.tsx` | Pins the shared report page (DC lesson and coach visit): progress steps, narrative sections, toReportData (bd-fmf24g.4) |
| `ReportPage.tsx` | Shared report page for a DC lesson and a coach's visit: progress, then headline, moments, reflection, audio, Download |
| `ReportPage.videoReco.test.tsx` | Pins the report with a recommended clip card under Try next class; absent or null draws today's page (bd-gzfdu9) |
| `SendPage.live.test.tsx` | Pins live moves on the recording page with a library plan; ticks go into the draft and Submit (bd-v0toag.31.3) |
| `SendPage.tsx` | Recording page and send step on the shared send flow (useSendFlow with v2 paths); /portal/teacher/coaching/send |
| `VideoRecoCard.test.tsx` | Pins VideoRecoCard: thumbnail, title, minutes and language, why line, one Watch link; nothing without a card (bd-gzfdu9) |
| `VideoRecoCard.tsx` | Recommended training-clip card under Try next class on a report, with one full-width Watch link to the player |
| `api.ts` | Digital Coaching reads (GET /teacher/coaching/history) plus history shaping: items, KPIs, lesson chips and day groups |
| `backFlow.test.tsx` | Pins that Back from the lesson-plan library returns to the one screen as left, not Home (bd-fmf24g.68) |
| `checks.test.tsx` | Style and copy guard for Coaching pages: logical start/end, motion-safe, copy.ts words, 56px targets (bd-fmf24g.4) |
| `classCheck.test.ts` | Tests the list line for a recording that did not sound like a class, in English and Urdu (bd-aqotzx) |
| `coaching.ur.test.tsx` | Renders Digital Coaching hub, one screen, send, report and All DC observations in Urdu (bd-fmf24g.13.2) |
| `copy.ts` | English and Urdu words for all Digital Coaching screens (machine-drafted Urdu), registered as COPY_ENTRY |
| `draft.live.test.ts` | Tests the live record riding in the draft from Stop to Submit: kept for same recording and lesson (bd-v0toag.31.3) |
| `draft.ts` | In-memory draft of recording, lesson plan, class and photos so pages can be left and returned to (holdDraft) |
| `headings.test.tsx` | Pins renamed DC headings (Class recording, Lesson analysis, Reflection question) in English and Urdu (bd-dpen4t) |
| `libraryPick.test.tsx` | Pins From the library for the picked class: chapters, a tap attaches the plan, returns to one screen (bd-fgj73x.5) |
| `libraryPick.ts` | pick=dc mode for the Lesson Plans pages: choosing a plan attaches it to the DC draft and steps back to the one screen |
| `micBlocked.test.ts` | Tests micBlockedLine variants (first refusal, browser blocked, refused again) in both languages (bd-qccbrv) |
| `micBlocked.ts` | Chooses the 'Microphone blocked' help line from what actually happened and the browser's permission state (bd-qccbrv) |
| `navigate.ts` | goTo wrapper around browser navigation so tests can stub it; used to open a signed report link (bd-oawrlt) |
| `oneScreen.test.tsx` | Pins the one-screen Digital Coaching flow: main page, /coaching/new, library, Urdu teacher, lesson-plan link landing |
| `parts.tsx` | Shared Coaching pieces: section headings, plan picker, photo grid and problems, dock, recording and waiting cards |
| `paths.ts` | Path builders for Coaching pages: home, send, new (one screen), all, and one lesson's report |
| `pendingRecording.test.tsx` | Pins a classroom recording sent on WhatsApp waiting in Digital Coaching and attaching on the one screen (bd-c5reix) |
| `photoCamera.test.tsx` | Pins Take photo and From gallery tiles on DC photos, up to 10, accept list for Android camera (bd-rt8wky) |
| `picker.ur.test.tsx` | Renders the lesson-plan picker sheet and library steps in Urdu on DC pages via COACHING picker words (bd-fmf24g.13) |
| `planLabel.test.tsx` | Pins an uploaded plan labelled 'Lesson plan' with its filename, not 'Plan photo', in both languages (bd-hsgah5) |
| `report.ts` | Report data layer: GET /coaching-session/:id and /teacher/coaching/:id/journey shaped for the kit's ReportBody |
| `reportLive.tsx` | Reflection question and answer (text or voice) and class-check notice shared by the report and one screen |
| `routes.tsx` | Registers lazy Digital Coaching pages (home, new, send, all, report) under /portal/teacher/coaching via TeacherGate |
| `saveRecording.test.tsx` | Pins the Save recording button and its confirmation line in both languages on the one screen (bd-bmc9a0.2) |
| `submitFailure.test.tsx` | Pins Submit failures naming the failed part (Recording, Lesson plan, Photo N); 'No internet' only offline (bd-bmc9a0.1) |
| `useDcReport.ts` | Hook polling one DC observation (5s then 15s) to ready, loading its session and journey, and sending the answer |

## Who reads this (all, generated)
- `CoachingAll.tsx` ← imported by `portal/src/portal/teacher/coaching/routes.tsx:6:f9a7506b`
- `CoachingHome.tsx` ← imported by `portal/src/portal/teacher/coaching/routes.tsx:7:a6d2f841`
- `NewObservation.tsx` ← imported by `portal/src/portal/teacher/coaching/routes.tsx:8:a8febbe1`
- `ReportPage.tsx` ← imported by `portal/src/portal/teacher/observations/ObservationsHome.tsx:15:9c304788` · `portal/src/portal/teacher/coaching/NewObservation.tsx:40:60fa3514` · `portal/src/portal/teacher/coaching/routes.tsx:9:a22ba7e2`
- `SendPage.tsx` ← imported by `portal/src/portal/teacher/coaching/routes.tsx:10:06580ebf`
- `VideoRecoCard.tsx` ← imported by `portal/src/portal/teacher/coaching/ReportPage.tsx:26:f1294e79`
- `api.ts` ← imported by `portal/src/portal/teacher/coaching/CoachingAll.tsx:11:1d1a68ee` · `portal/src/portal/teacher/coaching/CoachingHome.tsx:13:09857597` · `portal/src/portal/teacher/coaching/NewObservation.tsx:31:34c9a5b4` · `portal/src/portal/teacher/coaching/parts.tsx:11:a34ef007`
- `copy.ts` ← imported by `portal/src/portal/coach/insights/player/FullRecordingLink.tsx:4:dd128a06` · `portal/src/portal/coach/insights/player/MomentPlayer.tsx:4:dd128a06` · `portal/src/portal/teacher/observations/ObservationsHome.tsx:13:2a40a059` · `portal/src/portal/teacher/observations/api.ts:4:127570ec` (+12: `python3 kg/kg.py who-reads copy.ts`)
- `draft.ts` ← imported by `portal/src/portal/teacher/coaching/CoachingHome.tsx:15:280453e1` · `portal/src/portal/teacher/coaching/NewObservation.tsx:30:dce23d54` · `portal/src/portal/teacher/coaching/SendPage.tsx:21:ea7b2d37` · `portal/src/portal/teacher/coaching/libraryPick.ts:3:f6eddd6f` (+1: `python3 kg/kg.py who-reads draft.ts`)
- `libraryPick.ts` ← imported by `portal/src/portal/teacher/lessons/ChaptersPage.tsx:13:26410b36` · `portal/src/portal/teacher/lessons/LessonsPage.tsx:16:ee32a9b1` · `portal/src/portal/teacher/lessons/ViewerPage.tsx:18:526ee5ca` · `portal/src/portal/teacher/lessons/useOpenLesson.ts:9:b9946829` (+1: `python3 kg/kg.py who-reads libraryPick.ts`)
- `micBlocked.ts` ← imported by `portal/src/portal/teacher/coaching/NewObservation.tsx:35:8e26a7fb` · `portal/src/portal/teacher/coaching/SendPage.tsx:23:8e26a7fb`
- `navigate.ts` ← imported by `portal/src/portal/teacher/coaching/ReportPage.tsx:20:6497f9ad`
- `parts.tsx` ← imported by `portal/src/portal/coach/pages/CoachCheckSend.tsx:5:1e0daade` · `portal/src/portal/teacher/observations/ObservationsHome.tsx:14:25443756` · `portal/src/portal/teacher/coaching/CoachingHome.tsx:17:76009a49` · `portal/src/portal/teacher/coaching/NewObservation.tsx:36:ac50f96b` (+3: `python3 kg/kg.py who-reads parts.tsx`)
- `paths.ts` ← imported by `portal/src/portal/teacher/analytics/AnalyticsPage.tsx:21:d1a155d5` · `portal/src/portal/teacher/home/chips.ts:3:87d7f35f` · `portal/src/portal/teacher/home/look/cardWords.ts:3:bf1a9029` · `portal/src/portal/teacher/coaching/CoachingAll.tsx:13:a390a921` (+8: `python3 kg/kg.py who-reads paths.ts`)
- `report.ts` ← imported by `portal/src/portal/teacher/coaching/NewObservation.tsx:38:f788ba17` · `portal/src/portal/teacher/coaching/ReportPage.tsx:23:37dc5b07` · `portal/src/portal/teacher/coaching/useDcReport.ts:8:ea899991`
- `reportLive.tsx` ← imported by `portal/src/portal/teacher/coaching/NewObservation.tsx:39:553171dd` · `portal/src/portal/teacher/coaching/ReportPage.tsx:24:553171dd`
- `useDcReport.ts` ← imported by `portal/src/portal/teacher/coaching/NewObservation.tsx:41:306bf5d4` · `portal/src/portal/teacher/coaching/ReportPage.tsx:25:306bf5d4` · `portal/src/portal/teacher/coaching/reportLive.tsx:12:1673f6ed`

## Tests (all, generated)
- `CoachingAll.tsx` ← `portal/src/portal/teacher/coaching/CoachingAll.test.tsx` · `portal/src/portal/teacher/coaching/coaching.ur.test.tsx`
- `CoachingHome.tsx` ← `portal/src/portal/teacher/coaching/CoachingPages.test.tsx` · `portal/src/portal/teacher/coaching/backFlow.test.tsx` · `portal/src/portal/teacher/coaching/coaching.ur.test.tsx` · `portal/src/portal/teacher/coaching/libraryPick.test.tsx`
- `NewObservation.tsx` ← `portal/src/portal/teacher/coaching/CoachingPages.test.tsx` · `portal/src/portal/teacher/coaching/NewObservation.live.test.tsx` · `portal/src/portal/teacher/coaching/backFlow.test.tsx` · `portal/src/portal/teacher/coaching/coaching.ur.test.tsx` · `portal/src/portal/teacher/coaching/libraryPick.test.tsx` · `portal/src/portal/teacher/coaching/picker.ur.test.tsx`
- `ReportPage.tsx` ← `portal/src/portal/teacher/coaching/ReportPage.iabRows.test.tsx` · `portal/src/portal/teacher/coaching/ReportPage.quiz.test.tsx` · `portal/src/portal/teacher/coaching/ReportPage.test.tsx` · `portal/src/portal/teacher/coaching/ReportPage.videoReco.test.tsx` · `portal/src/portal/teacher/coaching/coaching.ur.test.tsx`
- `SendPage.tsx` ← `portal/src/portal/teacher/coaching/CoachingPages.test.tsx` · `portal/src/portal/teacher/coaching/SendPage.live.test.tsx` · `portal/src/portal/teacher/coaching/backFlow.test.tsx` · `portal/src/portal/teacher/coaching/coaching.ur.test.tsx`
- `VideoRecoCard.tsx` ← `portal/src/portal/teacher/coaching/VideoRecoCard.test.tsx`
- `api.ts` ← `portal/src/portal/teacher/coaching/classCheck.test.ts` · `portal/src/portal/teacher/coaching/coaching.ur.test.tsx`
- `copy.ts` ← `portal/src/portal/teacher/coaching/CoachingAll.test.tsx` · `portal/src/portal/teacher/coaching/CoachingPages.test.tsx` · `portal/src/portal/teacher/coaching/NewObservation.live.test.tsx` · `portal/src/portal/teacher/coaching/ReportPage.iabRows.test.tsx` · `portal/src/portal/teacher/coaching/ReportPage.test.tsx` · `portal/src/portal/teacher/coaching/ReportPage.videoReco.test.tsx` (+17: `python3 kg/kg.py who-reads portal/src/portal/teacher/coaching/copy.ts`)
- `draft.ts` ← `portal/src/portal/teacher/coaching/CoachingPages.test.tsx` · `portal/src/portal/teacher/coaching/NewObservation.live.test.tsx` · `portal/src/portal/teacher/coaching/SendPage.live.test.tsx` · `portal/src/portal/teacher/coaching/backFlow.test.tsx` · `portal/src/portal/teacher/coaching/coaching.ur.test.tsx` · `portal/src/portal/teacher/coaching/draft.live.test.ts` (+6: `python3 kg/kg.py who-reads portal/src/portal/teacher/coaching/draft.ts`)
- `libraryPick.ts` ← `portal/src/portal/teacher/coaching/libraryPick.test.tsx`?
- `micBlocked.ts` ← `portal/src/portal/teacher/coaching/micBlocked.test.ts`
- `parts.tsx` ← `portal/src/portal/teacher/coaching/checks.test.tsx` · `portal/src/portal/teacher/coaching/photoCamera.test.tsx` · `portal/src/portal/teacher/coaching/planLabel.test.tsx`
- `paths.ts` ← `portal/src/portal/teacher/analytics/AnalyticsPage.test.tsx` · `portal/src/portal/teacher/coaching/CoachingAll.test.tsx` · `portal/src/portal/teacher/coaching/CoachingPages.test.tsx` · `portal/src/portal/teacher/coaching/NewObservation.live.test.tsx` · `portal/src/portal/teacher/coaching/ReportPage.iabRows.test.tsx` · `portal/src/portal/teacher/coaching/ReportPage.quiz.test.tsx` (+11: `python3 kg/kg.py who-reads portal/src/portal/teacher/coaching/paths.ts`)
- `report.ts` ← `portal/src/portal/teacher/coaching/ReportPage.test.tsx` · `portal/src/portal/teacher/coaching/coaching.ur.test.tsx` · `portal/src/portal/teacher/coaching/headings.test.tsx`
- `routes.tsx` ← `portal/src/portal/teacher/coaching/CoachingAll.test.tsx` · `portal/src/portal/teacher/coaching/CoachingPages.test.tsx` · `portal/src/portal/teacher/coaching/oneScreen.test.tsx` · `portal/src/portal/teacher/coaching/pendingRecording.test.tsx` · `portal/src/portal/teacher/coaching/saveRecording.test.tsx` · `portal/src/portal/teacher/coaching/submitFailure.test.tsx`

## Related (all, generated)
- docs: `portal/src/portal/newui/checks/CLAUDE.md`? · `portal/src/portal/newui/coaching/CLAUDE.md`? · `portal/src/portal/teacher/CLAUDE.md`? · `portal/src/portal/teacher/share/CLAUDE.md`?
