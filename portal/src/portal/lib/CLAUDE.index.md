# lib — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/lib -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `assess/` | Coach Learning-assessment support: results maths, copy, offline visit store → `assess/CLAUDE.md` |
| `childTest/` | Coach child-test block machine, check form, local recordings and uploader → `childTest/CLAUDE.md` |
| `live/` | Live moves while a teacher records: tick state and Soniox stream tee → `live/CLAUDE.md` |
| `analyticsView.ts` | Hook keeping the Analytics page's tab (#hash) and date window (?from=&to=) in the URL so links, reload and back work |
| `appFunnel.test.ts` | bd-4r3rei: pins appFunnel's queueing, route normalisation, batching, 401/429 pauses; never throws into a page |
| `appFunnel.ts` | bd-4r3rei: fire-and-forget page-view/drop-off beacon, batched, sent to the app-funnel route; carries no ids or PII |
| `assessmentRoutes.ts` | bd-5rz1v.13: the list of the new UI's Assessment routes (home, request, mine) that App.tsx and its test both mount |
| `audioHash.ts` | bd-c5reix: sha256 of a picked recording (size-capped) so the app can check for a prior send before uploading |
| `classKey.test.ts` | bd-1p5nkt: pins libraryKeyFor/sameSubjectName: an Urdu or Maths class opens its own subject, never the first Urdu name |
| `classKey.ts` | bd-1p5nkt: maps a teacher's class (any-script name or featureKey) to its lesson-plan catalogue subject key |
| `clockText.ts` | clockText: formats milliseconds as a recording clock, MM:SS or H:MM:SS (bd-5rz1v) |
| `coachCopy.neutral.test.ts` | bd-5rz1v.6.6: pins coachObserve's entry, tracker and step-chip copy as gender-neutral (no her/she/hers) |
| `coachObserve.test.ts` | bd-5rz1v.6: pins coachObserve entry copy, step-to-tracker mapping and sendObservation/sendTalk through coach endpoints |
| `coachObserve.ts` | bd-5rz1v.6: coach /observe entry copy, from=coach link helpers and observation home path for the portal |
| `coachingCard.ts` | withoutScore: strips the legacy "currently N/M" suffix from stored coaching-card actions at display time |
| `coachingSend.pickedFile.test.ts` | bd-bmc9a0.1: pins that sendLesson PUTs in-memory copies of picked files and reports unreadable files, not "No internet" |
| `coachingSend.saved.test.ts` | bd-c5reix: pins sendLesson for a WhatsApp-saved recording: starts from its key, skips audio upload, 409 already_sent |
| `coachingSend.test.ts` | bd-5rz1v: pins sendLesson: all files to R2 then start; class, liveMoves and plan pick travel; any failure blocks start |
| `coachingSend.ts` | bd-5rz1v: Send to Digital Coach; uploads every file to R2 via presign, then starts analysis only if all arrived |
| `coachingUi.ts` | bd-5rz1v.26: useCoachingUi picks which Coaching screens a user gets (new, self or classic) from flags and role |
| `coachingUpload.audio.test.ts` | bd-i0u6n2: pins checkAudioFile: video refused with its own line, audio-typed files taken whatever the name |
| `coachingUpload.sniff.test.ts` | bd-qbbikm: pins sniffAudioExt/checkAudioFile: a nameless real recording is accepted from its first bytes |
| `coachingUpload.ts` | bd-7hyj7: browser-side file rules (type, size, sniffing) for audio, plan and photo uploads, mirroring the bot's KINDS |
| `dcUploadReport.ts` | bd-1d6g8o: reports why a Digital Coach upload failed (step, kind, status) to the /funnel/dc-upload-failed route |
| `gradeSubjects.test.ts` | bd-fmf24g.3: pins loadGradeSubjects: feature passed through, well-formed pairs kept, failure not read as no classes |
| `gradeSubjects.ts` | bd-fmf24g.3: loadGradeSubjects fetches the teacher's grade/subject pairs from GET /api/portal/me/grade-subjects |
| `homeRoute.test.ts` | bd-s6qbts.3: pins homeFor/redirectFor: teachers and leaders unchanged; analytics-only accounts kept on schools analytics |
| `homeRoute.ts` | bd-s6qbts.3: homeFor/redirectFor decide where a signed-in user belongs (leader, analytics-only, teacher dashboard) |
| `keepAwake.test.ts` | bd-5rz1v: pins keepScreenOn: native KeepScreen plugin first, Wake Lock fallback re-taken on return, never throws |
| `keepAwake.ts` | bd-5rz1v: keeps the screen on while recording via the native KeepScreen plugin or the Screen Wake Lock API |
| `leaderRole.test.ts` | bd-2434: pins leaderRole: five NIETE leader roles, case/space-insensitive isLeader, false for teachers and missing role |
| `leaderRole.ts` | bd-2434: isLeader/resolveRole, the five school-leader roles; mirrors bot LEADER_ROLES and dashboard/lib/leader-role.js |
| `legalLinks.ts` | bd-3wb0s/bd-nvnf2: privacy-policy and delete-account paths and the deletion mailto, shared by nav, login and legal pages |
| `lessonHandoff.ts` | bd-5rz1v.7: in-memory hand-off of the recording a teacher picked on Coaching to the record page |
| `lessonPlanOpen.page.test.tsx` | bd-fmf24g.3: pins useLessonPlanOpener: opens over Curriculum by default, or in a given viewer page carrying state |
| `lessonPlanOpen.test.ts` | bd-5rz1v.15/bd-7tgiyc: pins lessonPlanOpen: 6-12 open marked ?open=1, grades 1-5 pdf link, assessment paper in viewer |
| `lessonPlanOpen.ts` | bd-5rz1v.10: opens a lesson plan (curriculum, assessment paper, 6-12 render) via signed link or in-app viewer |
| `lessonRecorder.test.ts` | bd-5rz1v: pins LessonRecorder: slices saved as they arrive, pause excluded, WebM duration written, mic released |
| `lessonRecorder.ts` | bd-5rz1v: LessonRecorder wraps MediaRecorder, saves each chunk to IndexedDB, pause-aware, writes WebM duration on stop |
| `linkSession.ts` | Helpers for a scoped link session opened from a template button (/t/<token>): area home and expired-link page |
| `moduleQuiz.ts` | bd-zgme6: completesModule, whether a module-quiz attempt passed, mirroring the server's training-progress write |
| `newUiMemory.ts` | bd-5rz1v.12: in-memory last portal_new_ui answer per user, readable outside components (recording logout guard) |
| `pdfjs.ts` | bd-5rz1v.10: dynamic loader for the legacy pdf.js build so its ~1.5 MB chunk loads only when a plan is opened |
| `pdfjsRuntime.ts` | bd-5rz1v.10: imports pdf.js and its classic-worker script; only lib/pdfjs.ts loads it dynamically |
| `phone.test.ts` | bd-s6qbts.5: pins phone.ts: account-name vs phone detection, PK/intl mobile checks unchanged, accountNameOf |
| `phone.ts` | bd-2510/bd-2511: client-side Pakistani mobile normalisation/validation mirroring the server's sanitizePhoneNumber |
| `planSteps.test.ts` | bd-v0toag.8: pins planSteps: line joining, step-heading search order, step spans and locateStep over fake PDF text |
| `planSteps.ts` | bd-v0toag.8: locates each of the five step headings in a lesson-plan PDF's text so the viewer can jump to and mark it |
| `recentLessonPlans.test.ts` | bd-k23p38: pins mergeRecent/loadRecentLessonPlans: one newest-first list, Preparing/Ready rows, 10-item cap, whenLabel |
| `recentLessonPlans.ts` | bd-k23p38: merges GET /lesson-plans/recent and /lp612/mine into one last-10 list for the Lesson Plans page |
| `recordFlow.ts` | bd-5rz1v: shared bits of the record-and-send page: lessonFilename, useMicLevel, hasHistoryBehind |
| `recordingBarShown.ts` | bd-5rz1v.14: React context saying whether the recording bar shows above the menu, so bottom actions sit above it |
| `recordingSession.tsx` | bd-5rz1v.10: provider holding the in-progress lesson recording above the routes, plus clock and logout-guard hooks |
| `recordingStore.test.ts` | bd-5rz1v: pins recordingStore: chunks kept in order, finish marking, latest unsent, delete (node env + fake-indexeddb) |
| `recordingStore.ts` | bd-5rz1v: IndexedDB store of lesson-recording chunks so a reload or failed upload never loses the lesson |
| `recordingSupport.test.ts` | bd-5rz1v: pins pickRecordingType and canRecordHere: WebM then MP4 fallback, app build gate for the microphone |
| `recordingSupport.ts` | bd-5rz1v: canRecordHere/pickRecordingType, whether Record now works (getUserMedia, MediaRecorder, app build 1216+) |
| `scoreBands.test.ts` | Pins portal scoreBands.ts equal to the bot's bot/shared/config/score-bands.js on thresholds, boundaries and wording |
| `scoreBands.ts` | Observation scores shown as bands, never numbers; portal copy of the bot's bot/shared/config/score-bands.js |
| `shellHint.ts` | bd-fxk3t8: remembers which frame (teacher v2 or classic) the device last showed, so the shell paints the right one first |
| `stableSignedUrl.test.ts` | bd-ymavij: pins useStableSignedUrl: keeps a re-signed link for the same file, renews on new file or after 45 minutes |
| `stableSignedUrl.ts` | bd-ymavij: useStableSignedUrl keeps a re-signed link steady while it points at the same file, so <audio> is not reloaded |
| `trainingLoadError.test.ts` | bd-44003: pins classifyTrainingLoadError: locked level shows server words persistently; retry only for plain failures |
| `trainingLoadError.ts` | bd-44003: classifies why a training level failed to load into actionable messages (locked, empty, generic) |
| `trainingRoutes.ts` | bd-klecr: the list of training routes under /portal/training and /portal/training/v2 mounted by App.tsx and tests |
| `transcript.test.ts` | bd-5rz1v: pins parseTranscript: timed speaker turns, unsplittable lines kept as plain words, empty input |
| `transcript.ts` | bd-5rz1v: parseTranscript turns the bot's "[mm:ss] Speaker (LANG): words" paragraphs into speaker turns |
| `unitLock.test.ts` | bd-vej4h: pins unitRowState: locked unit disabled with a hint, next/passed open, no lock info opens as before |
| `unitLock.ts` | bd-vej4h: unitRowState turns a unit's bot-sent lock (passed/next/locked) into a disabled flag and hint |
| `useBack.test.tsx` | bd-fmf24g.68: pins useBack/BackLink: history back when an in-app screen is behind, else the page's backTo |
| `useBack.tsx` | bd-fmf24g.68: useBack/BackLink, Back goes to the previous in-app screen, or the page's fixed parent when none |
| `useChildTest.ts` | bd-s1oo0.7: useChildTest, is the coach child test on for this user (read from /config, fail-closed) |
| `useChildTestSa.ts` | useChildTestSa: is the coach's Learning assessment on for this user (read from /config, fail-closed) |
| `useCoachRecording.ts` | bd-o15qnr.9: screenless coach recording engine: LessonRecorder, screen hold, mic level, clock, leave guard |
| `useNewUi.boot.test.ts` | bd-sex15q.34: pins readConfigShared taking index.html's boot /config read instead of asking again; fallbacks |
| `useNewUi.test.tsx` | Pins useNewUi: null while /config loads, true from newUi flag, false on failure or throw, waits until ready |
| `useNewUi.ts` | bd-5rz1v.12: useNewUi reads portal_new_ui once from GET /config (shared read) and remembers it per user |
| `useRecordingBackGuard.ts` | bd-5rz1v.8: pushes a history entry while recording so Back cannot silently stop the lesson |
| `useSelfObservation.ts` | bd-3bvfj: useSelfObservation, is teacher self-observation on (read from /config, fail-closed) |
| `voiceAnswer.test.ts` | bd-eygg2f: pins useVoiceAnswer (record, stop, cap, blocked mic) and sendVoiceAnswer (presign, PUT, answer with key) |
| `voiceAnswer.ts` | bd-eygg2f: records a spoken reflection answer and sends it via presign, R2 PUT and POST /coaching-session/:id/reflection |
| `webmDuration.ts` | bd-5rz1v: withDuration writes the recorded length into a MediaRecorder WebM header using fix-webm-duration |

## Who reads this (all, generated)
- `analyticsView.ts` ← imported by `portal/src/portal/analytics/BandToggle.tsx:1:f8cf43fe` · `portal/src/portal/analytics/view.ts:1:f8cf43fe` · `portal/src/portal/components/AnalyticsControls.tsx:1:eaaabbbd` · `portal/src/portal/pages/PortalCoachingAnalytics.tsx:9:f8cf43fe` (+1: `python3 kg/kg.py who-reads analyticsView.ts`)
- `appFunnel.ts` ← imported by `portal/src/portal/components/AppFunnelTracker.tsx:3:0ee418ac`
- `assessmentRoutes.ts` ← imported by `portal/src/App.tsx:12:b2ebe6be` · `portal/src/portal/pages/PortalAssessment.tsx:6:1fe3b824`
- `audioHash.ts` ← imported by `portal/src/portal/teacher/coaching/NewObservation.tsx:8:0eeaa26e` · `portal/src/portal/lib/coachingSend.ts:23:efd296a0`
- `classKey.ts` ← imported by `portal/src/portal/newui/coaching/PlanSheet.tsx:2:9c25de35` · `portal/src/portal/teacher/coaching/NewObservation.tsx:33:2c86cb75`
- `clockText.ts` ← imported by `portal/src/portal/components/RecordingBar.tsx:4:01e07525` · `portal/src/portal/newui/AudioPlayer.tsx:4:01e07525` · `portal/src/portal/newui/coaching/LogoutWhileRecording.tsx:3:fd8fd456` · `portal/src/portal/newui/coaching/RecordPage.tsx:12:fd8fd456` (+3: `python3 kg/kg.py who-reads clockText.ts`)
- `coachObserve.ts` ← imported by `portal/src/portal/coach/observe/sender.ts:4:cd472dc3` · `portal/src/portal/coach/pages/CoachCheckSend.tsx:16:2f9d6a72` · `portal/src/portal/coach/pages/CoachObservation.tsx:15:952d452e` · `portal/src/portal/coach/pages/CoachRecord.tsx:17:e8961fc6` (+7: `python3 kg/kg.py who-reads coachObserve.ts`)
- `coachingCard.ts` ← imported by `portal/src/portal/components/coaching/LessonPage.tsx:11:da6e2961` · `portal/src/portal/newui/coaching/LessonView.tsx:14:da6e2961` · `portal/src/portal/pages/PortalCoachingDetail.tsx:15:80b15f32`
- `coachingSend.ts` ← imported by `portal/src/portal/coach/observe/sender.ts:2:8dcca6ca` · `portal/src/portal/coach/pages/CoachCheckSend.tsx:15:3bd4760b` · `portal/src/portal/coach/reports/Debrief.tsx:10:31a21fd1` · `portal/src/portal/components/coaching/LibraryPicker.tsx:5:b29f1690` (+11: `python3 kg/kg.py who-reads coachingSend.ts`)
- `coachingUi.ts` ← imported by `portal/src/portal/pages/PortalCoaching.tsx:18:57049ca0` · `portal/src/portal/pages/PortalCoachingDetail.tsx:19:57049ca0` · `portal/src/portal/pages/PortalCoachingRecord.tsx:24:57049ca0`
- `coachingUpload.ts` ← imported by `portal/src/portal/coach/observe/format.ts:2:b413a3d0` · `portal/src/portal/coach/observe/sender.ts:3:5ddbff68` · `portal/src/portal/coach/pages/CoachAttach.tsx:14:55344ceb` · `portal/src/portal/coach/pages/CoachCheckSend.tsx:14:489f6aad` (+15: `python3 kg/kg.py who-reads coachingUpload.ts`)
- `dcUploadReport.ts` ← imported by `portal/src/portal/lib/coachingSend.ts:24:f294a37a`
- `gradeSubjects.ts` ← imported by `portal/src/portal/fln/FlnBandBody.tsx:30:620bb4ea` · `portal/src/portal/fln/PlanPage.tsx:22:ab466394` · `portal/src/portal/teacher/assessment/AssessmentAll.tsx:4:d9bf80c5` · `portal/src/portal/teacher/assessment/NewPaperSteps.tsx:5:d9bf80c5` (+5: `python3 kg/kg.py who-reads gradeSubjects.ts`)
- `homeRoute.ts` ← imported by `portal/src/portal/analytics/AnalyticsOnlyGuard.tsx:4:dbf21a70` · `portal/src/portal/analytics/SchoolsAnalytics.tsx:6:773ddff6` · `portal/src/portal/auth/AnalyticsLogin.tsx:5:efb89fd1` · `portal/src/portal/pages/PortalLogin.tsx:6:458c5cd8` (+4: `python3 kg/kg.py who-reads homeRoute.ts`)
- `keepAwake.ts` ← imported by `portal/src/portal/components/assess/AssessEngineSlot.tsx:4:71d9260a` · `portal/src/portal/components/childTest/BlockRecorder.tsx:10:08526c26` · `portal/src/portal/lib/recordingSession.tsx:4:eb181c03` · `portal/src/portal/lib/useCoachRecording.ts:3:eb181c03`
- `leaderRole.ts` ← imported by `portal/src/portal/coach/card/frame.tsx:4:a06a1dee` · `portal/src/portal/coach/training/CoachAppGuard.tsx:6:a06a1dee` · `portal/src/portal/coach/useCoachV2.ts:2:5fc21211` · `portal/src/portal/components/PortalNavigation.tsx:6:f920f73d` (+14: `python3 kg/kg.py who-reads leaderRole.ts`)
- `legalLinks.ts` ← imported by `portal/src/portal/analytics/AnalyticsFrame.tsx:6:709a02a6` · `portal/src/portal/auth/AuthFrame.tsx:7:cdccd347` · `portal/src/portal/coach/profile/CoachProfile.tsx:5:6b044365` · `portal/src/portal/pages/PortalAccount.tsx:7:cdccd347` (+2: `python3 kg/kg.py who-reads legalLinks.ts`)
- `lessonHandoff.ts` ← imported by `portal/src/portal/components/coaching/CoachingHome.tsx:11:c3f78d14` · `portal/src/portal/newui/coaching/CoachingMain.tsx:11:c3f78d14` · `portal/src/portal/newui/coaching/useSendFlow.ts:6:1e61cfde` · `portal/src/portal/pages/PortalCoachingRecord.tsx:19:d8ce4570`
- `lessonPlanOpen.ts` ← imported by `portal/src/portal/components/LessonPlanViewer.tsx:10:25ffad5f` · `portal/src/portal/newui/home/HomeList.tsx:8:2c42934c` · `portal/src/portal/newui/lessons/LessonPlanPages.tsx:9:5f2ae71c` · `portal/src/portal/newui/lessons/NewLessonPlans.tsx:6:2c3be284` (+10: `python3 kg/kg.py who-reads lessonPlanOpen.ts`)
- `lessonRecorder.ts` ← imported by `portal/src/portal/coach/reports/Debrief.tsx:12:0a06a66a` · `portal/src/portal/components/childTest/BlockRecorder.tsx:8:41c894a0` · `portal/src/portal/components/coaching/coach/CoachRecorder.tsx:6:062de58b` · `portal/src/portal/pages/LeaderObserveRecord.tsx:21:4fad32c4` (+3: `python3 kg/kg.py who-reads lessonRecorder.ts`)
- `linkSession.ts` ← imported by `portal/src/portal/components/PortalLayout.tsx:17:2bc29f95` · `portal/src/portal/services/api.ts:3:424cc801`
- `moduleQuiz.ts` ← imported by `portal/src/portal/pages/PortalTraining.tsx:34:24d43496` · `portal/src/portal/pages/PortalTrainingV2.tsx:63:24d43496`
- `newUiMemory.ts` ← imported by `portal/src/portal/lib/recordingSession.tsx:5:81c708e1` · `portal/src/portal/lib/useNewUi.ts:4:34ae70a5`
- `pdfjs.ts` ← imported by `portal/src/portal/components/LessonPlanViewer.tsx:4:e8099668`
- `pdfjsRuntime.ts` ← imported by `portal/src/portal/lib/pdfjs.ts:22:560108a6`
- `phone.ts` ← imported by `portal/src/portal/pages/PortalLogin.tsx:8:f26e479f` · `portal/src/portal/pages/PortalPasswordReset.tsx:4:29f10a0b`
- `planSteps.ts` ← imported by `portal/src/portal/components/LessonPlanPage.tsx:3:f2ff354d` · `portal/src/portal/components/stepMark.tsx:3:a3dc191d`
- `recentLessonPlans.ts` ← imported by `portal/src/portal/components/RecentLessonPlans.tsx:19:0bdef622` · `portal/src/portal/newui/lessons/RecentPlans.tsx:5:8537de9b` · `portal/src/portal/teacher/lessons/LessonsHome.tsx:5:df62c16c` · `portal/src/portal/teacher/lessons/recent.ts:1:c43a169e`
- `recordFlow.ts` ← imported by `portal/src/portal/newui/coaching/RecordPage.tsx:13:3d654a19` · `portal/src/portal/newui/coaching/useSendFlow.ts:7:c8a72620` · `portal/src/portal/pages/PortalCoachingRecord.tsx:23:c1900708` · `portal/src/portal/teacher/coaching/NewObservation.tsx:10:97f782ff` (+1: `python3 kg/kg.py who-reads recordFlow.ts`)
- `recordingBarShown.ts` ← imported by `portal/src/portal/components/PortalLayout.tsx:7:b87c9694` · `portal/src/portal/newui/BottomButton.tsx:5:b87c9694`
- `recordingSession.tsx` ← imported by `portal/src/App.tsx:27:274089c5` · `portal/src/portal/coach/profile/CoachMore.tsx:4:63eb10bd` · `portal/src/portal/components/BackButtonHandler.tsx:4:1317bca8` · `portal/src/portal/components/PortalLayout.tsx:6:1317bca8` (+18: `python3 kg/kg.py who-reads recordingSession.tsx`)
- `recordingStore.ts` ← imported by `portal/src/portal/coach/observe/sender.ts:5:277a112a` · `portal/src/portal/coach/pages/CoachCheckSend.tsx:17:f5c1ef7c` · `portal/src/portal/coach/reports/Debrief.tsx:14:b3b29004` · `portal/src/portal/components/coaching/CoachingHome.tsx:10:203c6c37` (+7: `python3 kg/kg.py who-reads recordingStore.ts`)
- `recordingSupport.ts` ← imported by `portal/src/portal/coach/reports/Debrief.tsx:13:404d621b` · `portal/src/portal/components/assess/AssessPreflight.tsx:5:b8ac5182` · `portal/src/portal/components/childTest/BlockRecorder.tsx:9:dd10a98a` · `portal/src/portal/components/coaching/CoachingHome.tsx:9:f88c2c76` (+8: `python3 kg/kg.py who-reads recordingSupport.ts`)
- `scoreBands.ts` ← imported by `portal/src/portal/coach/analytics/model.ts:3:3a5c0f05` · `portal/src/portal/components/CoachingSessionCard.tsx:6:0492c2de` · `portal/src/portal/components/ObservationsSection.tsx:6:69c593d6` · `portal/src/portal/components/ScoreBreakdown.tsx:22:2e9a69e7` (+13: `python3 kg/kg.py who-reads scoreBands.ts`)
- `shellHint.ts` ← imported by `portal/src/App.tsx:31:cab40266` · `portal/src/lib/firstScreen.ts:10:d5e189fc` · `portal/src/portal/coach/card/CoachLanding.tsx:2:27b88e2b` · `portal/src/portal/coach/card/frame.tsx:6:27b88e2b` (+10: `python3 kg/kg.py who-reads shellHint.ts`)
- `stableSignedUrl.ts` ← imported by `portal/src/portal/teacher/coaching/ReportPage.tsx:21:e88bfdd5` · `portal/src/portal/teacher/coaching/useDcReport.ts:4:e88bfdd5`
- `trainingLoadError.ts` ← imported by `portal/src/portal/pages/PortalTraining.tsx:40:e5f4b0f7` · `portal/src/portal/pages/PortalTrainingV2.tsx:69:e5f4b0f7`
- `trainingRoutes.ts` ← imported by `portal/src/App.tsx:13:2acae975` · `portal/src/portal/pages/PortalTrainingPage.tsx:7:63f792d2`
- `transcript.ts` ← imported by `portal/src/portal/components/coaching/LessonPage.tsx:10:57287a06` · `portal/src/portal/newui/coaching/LessonView.tsx:13:57287a06`
- `unitLock.ts` ← imported by `portal/src/portal/newui/training/trainingApi.ts:3:67ac52f1` · `portal/src/portal/pages/PortalTrainingV2.tsx:73:072cef91`
- `useBack.tsx` ← imported by `portal/src/portal/auth/AnalyticsLogin.tsx:6:ad58d2f4` · `portal/src/portal/coach/pages/CoachObservation.tsx:3:00c0ddc3` · `portal/src/portal/coach/reports/Debrief.tsx:25:00c0ddc3` · `portal/src/portal/coach/reports/SendReport.tsx:19:00c0ddc3` (+7: `python3 kg/kg.py who-reads useBack.tsx`)
- `useChildTest.ts` ← imported by `portal/src/portal/coach/pages/CoachHome.tsx:11:6760a4aa` · `portal/src/portal/components/PortalNavigation.tsx:7:72067460` · `portal/src/portal/pages/LeaderChildTest.tsx:8:72067460`
- `useChildTestSa.ts` ← imported by `portal/src/portal/coach/pages/CoachHome.tsx:12:ed8eddf1` · `portal/src/portal/coach/profile/CoachMore.tsx:13:ed8eddf1` · `portal/src/portal/coach/training/CoachAppGuard.tsx:7:ed8eddf1` · `portal/src/portal/components/PortalNavigation.tsx:8:e814a79d` (+1: `python3 kg/kg.py who-reads useChildTestSa.ts`)
- `useCoachRecording.ts` ← imported by `portal/src/portal/coach/pages/CoachRecord.tsx:15:4f75a484` · `portal/src/portal/components/coaching/coach/CoachRecorder.tsx:7:879b7888`
- `useNewUi.ts` ← imported by `portal/src/App.tsx:36:e5e523e4` · `portal/src/lib/whatsapp.ts:2:0e65200b` · `portal/src/portal/coach/card/useSchoolCard.ts:2:7121dc62` · `portal/src/portal/coach/disagreements/api.ts:2:853829bc` (+15: `python3 kg/kg.py who-reads useNewUi.ts`)
- `useRecordingBackGuard.ts` ← imported by `portal/src/portal/coach/pages/CoachRecord.tsx:16:6a2c7889` · `portal/src/portal/components/coaching/coach/CoachRecorder.tsx:5:539ecce6`
- `voiceAnswer.ts` ← imported by `portal/src/portal/teacher/coaching/ReportPage.tsx:8:04f727f9` · `portal/src/portal/teacher/coaching/useDcReport.ts:3:04f727f9`
- `webmDuration.ts` ← imported by `portal/src/portal/coach/pages/CoachCheckSend.tsx:18:84f2c68b` · `portal/src/portal/newui/coaching/useSendFlow.ts:12:35ead1a3` · `portal/src/portal/pages/LeaderObserveRecord.tsx:19:5bd20715` · `portal/src/portal/pages/PortalCoachingRecord.tsx:21:5bd20715` (+1: `python3 kg/kg.py who-reads webmDuration.ts`)

## Tests (all, generated)
- `appFunnel.ts` ← `portal/src/portal/lib/appFunnel.test.ts`
- `assessmentRoutes.ts` ← `portal/src/portal/pages/PortalAssessment.test.tsx`
- `audioHash.ts` ← `portal/src/portal/lib/coachingSend.saved.test.ts`
- `classKey.ts` ← `portal/src/portal/lib/classKey.test.ts`
- `coachObserve.ts` ← `portal/src/portal/coach/pages/CoachBack.test.tsx` · `portal/src/portal/coach/pages/CoachObserveFlow.test.tsx` · `portal/src/portal/coach/pages/CoachOwnPlan.test.tsx` · `portal/src/portal/lib/coachCopy.neutral.test.ts` · `portal/src/portal/lib/coachObserve.test.ts`
- `coachingSend.ts` ← `portal/src/portal/coach/observe/sender.test.ts` · `portal/src/portal/coach/pages/CoachObserveFlow.test.tsx` · `portal/src/portal/lib/coachingSend.pickedFile.test.ts` · `portal/src/portal/lib/coachingSend.saved.test.ts` · `portal/src/portal/lib/coachingSend.test.ts` · `portal/src/portal/teacher/coaching/CoachingPages.test.tsx` (+7: `python3 kg/kg.py who-reads portal/src/portal/lib/coachingSend.ts`)
- `coachingUpload.ts` ← `portal/src/portal/coach/pages/CoachOwnPlan.test.tsx` · `portal/src/portal/lib/coachingUpload.audio.test.ts` · `portal/src/portal/lib/coachingUpload.sniff.test.ts` · `portal/src/portal/newui/coaching/RecordPage.live.test.tsx` · `portal/src/portal/newui/coaching/RecordPage.test.tsx` · `portal/src/portal/pages/PortalCoaching.flagOff.test.tsx` (+10: `python3 kg/kg.py who-reads portal/src/portal/lib/coachingUpload.ts`)
- `gradeSubjects.ts` ← `portal/src/portal/lib/gradeSubjects.test.ts` · `portal/src/portal/teacher/classes/ClassesPages.test.tsx` · `portal/src/portal/teacher/classes/classes.ur.test.tsx` · `portal/src/portal/teacher/classes/model.test.ts`
- `homeRoute.ts` ← `portal/src/portal/auth/analytics-login.route.test.tsx` · `portal/src/portal/coach/insights/tests/routing.flagOff.test.tsx` · `portal/src/portal/lib/homeRoute.test.ts`
- `keepAwake.ts` ← `portal/src/portal/components/assess/AssessEngineSlot.r7b.test.tsx` · `portal/src/portal/components/assess/AssessEngineSlot.test.tsx` · `portal/src/portal/lib/keepAwake.test.ts` · `portal/src/portal/newui/coaching/RecordPage.test.tsx` · `portal/src/portal/pages/PortalCoachingRecord.session.test.tsx` · `portal/src/portal/pages/PortalCoachingRecord.test.tsx`
- `leaderRole.ts` ← `portal/src/portal/lib/leaderRole.test.ts`
- `lessonHandoff.ts` ← `portal/src/portal/newui/coaching/CoachingMain.test.tsx` · `portal/src/portal/newui/coaching/RecordPage.live.test.tsx` · `portal/src/portal/newui/coaching/RecordPage.test.tsx` · `portal/src/portal/pages/PortalCoaching.flagOff.test.tsx` · `portal/src/portal/pages/PortalCoaching.sendLesson.test.tsx` · `portal/src/portal/pages/PortalCoachingRecord.live.test.tsx` (+1: `python3 kg/kg.py who-reads portal/src/portal/lib/lessonHandoff.ts`)
- `lessonPlanOpen.ts` ← `portal/src/portal/components/LessonPlanViewer.step.test.tsx` · `portal/src/portal/lib/lessonPlanOpen.page.test.tsx` · `portal/src/portal/lib/lessonPlanOpen.test.ts` · `portal/src/portal/pages/PortalCurriculum.viewer.test.tsx`
- `lessonRecorder.ts` ← `portal/src/portal/lib/lessonRecorder.test.ts` · `portal/src/portal/pages/PortalCoachingRecord.session.test.tsx`
- `linkSession.ts` ← `portal/src/portal/services/api.trainingLink.test.ts`
- `pdfjs.ts` ← `portal/src/portal/components/LessonPlanViewer.step.test.tsx` · `portal/src/portal/newui/lessons/NewLessonPlans.test.tsx` · `portal/src/portal/pages/PortalCurriculum.viewer.test.tsx`
- `phone.ts` ← `portal/src/portal/lib/phone.test.ts`
- `planSteps.ts` ← `portal/src/portal/components/LessonPlanViewer.step.test.tsx` · `portal/src/portal/components/stepMark.test.tsx` · `portal/src/portal/lib/planSteps.test.ts`
- `recentLessonPlans.ts` ← `portal/src/portal/fln/tests/readers.test.tsx` · `portal/src/portal/lib/recentLessonPlans.test.ts`
- `recordingBarShown.ts` ← `portal/src/portal/newui/buttons.test.tsx` · `portal/src/portal/newui/coaching/RecordingBar.newUi.test.tsx`
- `recordingSession.tsx` ← `portal/src/portal/components/BackButtonHandler.recording.test.tsx` · `portal/src/portal/components/PortalLayout.newUi.test.tsx` · `portal/src/portal/newui/audioPlayer.recording.test.tsx` · `portal/src/portal/newui/coaching/CoachingMain.test.tsx` · `portal/src/portal/newui/coaching/LogoutWhileRecording.test.tsx` · `portal/src/portal/newui/coaching/RecordPage.live.test.tsx` (+12: `python3 kg/kg.py who-reads portal/src/portal/lib/recordingSession.tsx`)
- `recordingStore.ts` ← `portal/src/portal/coach/observe/sender.test.ts` · `portal/src/portal/lib/recordingStore.test.ts` · `portal/src/portal/newui/coaching/CoachingMain.test.tsx` · `portal/src/portal/newui/coaching/RecordPage.live.test.tsx` · `portal/src/portal/newui/coaching/RecordPage.test.tsx` · `portal/src/portal/pages/LeaderObserveRecord.coachV2.test.tsx` (+8: `python3 kg/kg.py who-reads portal/src/portal/lib/recordingStore.ts`)
- `recordingSupport.ts` ← `portal/src/portal/components/BackButtonHandler.recording.test.tsx` · `portal/src/portal/lib/recordingSupport.test.ts` · `portal/src/portal/newui/audioPlayer.recording.test.tsx` · `portal/src/portal/newui/coaching/CoachingMain.test.tsx` · `portal/src/portal/newui/coaching/LogoutWhileRecording.test.tsx` · `portal/src/portal/newui/coaching/RecordPage.live.test.tsx` (+12: `python3 kg/kg.py who-reads portal/src/portal/lib/recordingSupport.ts`)
- `scoreBands.ts` ← `portal/src/portal/lib/scoreBands.test.ts` · `portal/src/portal/newui/home/HomeList.test.tsx`
- `stableSignedUrl.ts` ← `portal/src/portal/lib/stableSignedUrl.test.ts`
- `trainingLoadError.ts` ← `portal/src/portal/lib/trainingLoadError.test.ts`
- `trainingRoutes.ts` ← `portal/src/portal/newui/training/TrainingCertificates.test.tsx` · `portal/src/portal/newui/training/TrainingCourse.test.tsx` · `portal/src/portal/newui/training/TrainingGrades.test.tsx` · `portal/src/portal/newui/training/TrainingHome.test.tsx` · `portal/src/portal/newui/training/TrainingLevel.test.tsx` · `portal/src/portal/newui/training/TrainingLevelExam.test.tsx` (+11: `python3 kg/kg.py who-reads portal/src/portal/lib/trainingRoutes.ts`)
- `transcript.ts` ← `portal/src/portal/lib/transcript.test.ts`
- `unitLock.ts` ← `portal/src/portal/lib/unitLock.test.ts` · `portal/src/test/trainingFixtures.ts`
- `useBack.tsx` ← `portal/src/portal/lib/useBack.test.tsx`
- `useChildTest.ts` ← `portal/src/portal/coach/home/CoachHome.test.tsx` · `portal/src/portal/coach/profile/CoachMore.test.tsx`
- `useChildTestSa.ts` ← `portal/src/portal/coach/home/CoachHome.test.tsx` · `portal/src/portal/coach/insights/tests/r6b_more.test.tsx` · `portal/src/portal/coach/profile/CoachMore.test.tsx` · `portal/src/portal/coach/training/CoachAppGuard.test.tsx`
- `useNewUi.ts` ← `portal/src/lib/whatsapp.botNumber.test.tsx` · `portal/src/portal/coach/disagreements/api.test.ts` · `portal/src/portal/coach/useCoachV2.test.ts` · `portal/src/portal/components/PortalLayout.loading.test.tsx` · `portal/src/portal/components/PortalLayout.newUi.test.tsx` · `portal/src/portal/components/PortalNavigation.coachLibrary.test.tsx` (+33: `python3 kg/kg.py who-reads portal/src/portal/lib/useNewUi.ts`)
- `voiceAnswer.ts` ← `portal/src/portal/lib/voiceAnswer.test.ts`

## Related (all, generated)
- docs: `dashboard/views/CLAUDE.md`? · `docs/app-funnel-telemetry.md`? · `portal/src/portal/CLAUDE.md`?
