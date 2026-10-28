# components — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/components -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `__testing__/` | Test helper for driving the one-question module quiz → `__testing__/CLAUDE.md` |
| `assess/` | Learning-assessment (child test) page parts: engine frame, preflight, offline prep → `assess/CLAUDE.md` |
| `assessment-edit/` | Editing a made exam paper: question forms, local draft, version list → `assessment-edit/CLAUDE.md` |
| `assessment-jobs/` | Page-level tracking of exam papers being generated → `assessment-jobs/CLAUDE.md` |
| `childTest/` | Coach-app child reading/maths test: stimulus, recorder, 'what Rumi heard' form → `childTest/CLAUDE.md` |
| `coaching/` | Old-UI teacher Coaching pieces: record/send panel, lesson page, library picker → `coaching/CLAUDE.md` |
| `AnalyticsControls.tsx` | Top of both Analytics pages: Observations/Attendance/Principal Remarks tabs plus one From/To window, kept in the URL |
| `AppFunnelTracker.test.tsx` | bd-4r3rei: tracker turns router moves and browser lifecycle events into appFunnel calls and renders nothing |
| `AppFunnelTracker.tsx` | bd-4r3rei: renderless component inside the router that reports page opens/leaves to lib/appFunnel |
| `AppLinkListener.test.tsx` | Pins AppLinkListener: on native it routes appUrlOpen links to the matching portal page, ignores foreign origins |
| `AppLinkListener.tsx` | Android App Links: listens for Capacitor appUrlOpen and navigates the WebView to the tapped portal path |
| `AssessmentGeneratorComingSoon.tsx` | bd-2460: plain "not live yet" state shown on the kept-visible Assessment Generator tab |
| `AssessmentGeneratorPanel.test.tsx` | bd-ix9uhr: AssessmentGeneratorPanel sends several chapters (chapterNumbers) like WhatsApp does |
| `AssessmentGeneratorPanel.tsx` | Old-UI form that asks the bot (POST /assessment/generate) for an exam paper from book, chapters and question mix |
| `AssessmentPapersPanel.empty.test.tsx` | bd-t5tow I2: empty My papers shows a Create paper button when onCreate is given, else "No papers yet." |
| `AssessmentPapersPanel.pastEnd.test.tsx` | Pins AssessmentPapersPanel: a page past the last paper jumps to the last real page instead of "No papers yet." |
| `AssessmentPapersPanel.tsx` | My papers tab: paginated, filterable browse of every exam paper a teacher made, with open/download actions |
| `AssessmentPapersPanel.version.test.tsx` | Pins AssessmentPapersPanel: one row per paper showing "Version N" only when N>1 (versioned editing) |
| `AttendancePanel.fraction.test.tsx` | Pins AttendancePanel: a class's day cell reads present out of the register (e.g. 28/30) |
| `AttendancePanel.labels.test.tsx` | bd-60174: attendance detail labels must say what each number is (unknown-users, teacher 1x19 reports) |
| `AttendancePanel.mine.test.tsx` | Pins AttendancePanel opened by a teacher: same bars scoped to their own classes, no teacher picker |
| `AttendancePanel.test.tsx` | bd-60123: AttendancePanel default merged-grade (G3) bars, day-wise toggle, and Analytics date/teacher filters |
| `AttendancePanel.tsx` | Attendance detail inside the Analytics Attendance tab: merged-grade bars, day-wise view, teacher filter (bd-60123) |
| `AttendanceSection.tsx` | Attendance (P of STEPS): teacher and student presence side by side, never blended; wording varies by audience |
| `AudioPlayer.tsx` | Shared audio player (play/seek/optional download, enhanced mode) for voicenotes and lesson audio |
| `BackButtonHandler.recording.test.tsx` | bd-5rz1v.10: Android Back while a lesson is recording goes to the record page rather than leaving the app |
| `BackButtonHandler.test.tsx` | Pins BackButtonHandler: Back closes a dialog, goes back a page, or minimises the app from a home page |
| `BackButtonHandler.tsx` | Android hardware Back key handler: close dialog, history back, or leave app (rules in lib/back-button.cjs) |
| `BandPicker.tsx` | bd-43487: lets a teacher pick grade bands (POST /training/bands) so the training catalogue appears |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `CapstoneExamForm.test.tsx` | bd-2673/bd-2490: written capstone exam renders inputs, enforces character floor before submit, shows result |
| `CapstoneExamForm.tsx` | bd-2673: written level (capstone) exam taken in the portal, free-text answers with a character floor |
| `CapstoneResultCard.test.tsx` | bd-2489: capstone result card takes its pass mark from API pass_mark_pct, not a hardcoded 70% |
| `CapstoneResultCard.tsx` | bd-2233: read-only capstone attempt card: total vs pass bar, each written answer with 0-5 score and feedback |
| `CertificatesPanel.reload.test.tsx` | bd-60172: a newly issued certificate appears on the shelf without a page reload |
| `CertificatesPanel.test.tsx` | Pins CertificatesPanel: every certificate is downloadable (fetch-or-mint) and native builds use the API origin (bd-2397) |
| `CertificatesPanel.tsx` | Teacher's certificates on the Training page: lazy list, view/download with mint-on-demand PDFs (bd-2397) |
| `CertificatesShelf.test.tsx` | bd-60154: certificates shelf shows earned plus not-yet-earned levels instead of a drawer of earned only |
| `CoachingSessionCard.tsx` | Card summarising one CoachingSession (date, scores, status) in the old-UI coaching list |
| `EmptyState.tsx` | Shared empty-state block: icon, title, description and optional action button or link |
| `ExamAttempts.tsx` | bd-2exhl: lists each submitted module-exam sitting with plain-language status and the teacher's written answers |
| `LegacyAttendanceRedirect.tsx` | Redirects old Attendance URLs to the Analytics Attendance tab, keeping teacherId/from/to query |
| `LessonPlanCard.tsx` | Card for one lesson plan (title, date, link) in the old-UI lesson list |
| `LessonPlanPage.test.tsx` | bd-v0toag.60: PdfPage draws on canvas, reports its ratio, fails upward and carries the step outline |
| `LessonPlanPage.tsx` | One lesson-plan page drawn by pdf.js on a canvas only when near the screen, with step outline overlay (bd-v0toag.60) |
| `LessonPlanViewer.step.test.tsx` | bd-v0toag.8: viewer outlines the heading of the highlighted step and jumps to it on highlight.jump |
| `LessonPlanViewer.tsx` | bd-5rz1v.10: in-portal lesson-plan PDF reader (pdf.js pages, step highlight, open-outside fallback) |
| `LevelCertificateRow.exams.test.tsx` | I-SAPS certificate card: module exams are the only gate, no chaining (supersedes bd-60163 composite) |
| `LevelCertificateRow.scores.test.tsx` | bd-vej4h: collapsible "Your scores" list on the certificate card, per module exam split |
| `LevelCertificateRow.tsx` | bd-60152: "Receive Certificate" row for per-module-assessed (I-SAPS) levels, with scores and download |
| `LevelExamCard.test.tsx` | bd-2489/bd-2475: exam card states the vendor's real pass mark and shows cooldown only when one exists |
| `LevelExamCard.tsx` | Level (grand-quiz) exam surface on Training page; fetches GET /training/level/:id/grand-quiz and shows the gate state |
| `LoadingState.tsx` | Shared skeleton loader (card/list/table/full variants) for portal pages |
| `ModuleExamPanel.attempts.test.tsx` | bd-2exhl: module exam page shows each sitting's status (being graded/not passed/passed) and her answers |
| `ModuleExamPanel.gatecopy.test.tsx` | bd-60166: module exam row reflects the server gate (passed is not "Locked") instead of a hardcoded padlock |
| `ModuleExamPanel.tsx` | bd-60149: end-of-module summative exam panel on Training page (gate, take exam, attempts) |
| `ModuleQuizPanel.perQuestion.test.tsx` | bd-klecr.6: module quiz one question per page with Check verdict, POST answer, last-question result |
| `ModuleQuizPanel.test.tsx` | bd-2489/bd-zgme6: quiz result does not call every pass "perfect"; completion copy is truthful |
| `ModuleQuizPanel.tsx` | bd-klecr.6: quiz-taking UI inside a training module card, one question per page with per-answer verdict |
| `ModuleReadings.test.tsx` | Pins ModuleReadings: collapsible I-SAPS reading list, items with no free copy are named in a nested list |
| `ModuleReadings.tsx` | Collapsible per-module required-reading list for the I-SAPS partner (bd-klecr.9 shorter list) |
| `ObservationsSection.cards.test.tsx` | Pins ObservationsSection: each observation kind is explained inside its own count card |
| `ObservationsSection.tsx` | Observations (S, T, E of STEPS) section on both Analytics pages: plain labels, no numeric ratings |
| `PortalLayout.lessonsLink.test.tsx` | Pins PortalLayout for a lesson-plans-scoped link session: lesson plans only, other pages go to /portal/curriculum |
| `PortalLayout.loading.test.tsx` | bd-fxk3t8: PortalLayout never swaps the page for a full-screen spinner; menu stays on screen |
| `PortalLayout.navFlash.test.tsx` | bd-5rz1v.6.6: a coach never sees the teacher bottom nav flash (single /dashboard fetch for nav) |
| `PortalLayout.newUi.test.tsx` | bd-5rz1v.12: with portal_new_ui on, page and recording bar clear the taller indigo nav; flag off unchanged |
| `PortalLayout.notices.test.tsx` | bd-fmf24g.15: shell shows the notices strip only to a teacher on app v2, never a coach or link session |
| `PortalLayout.trainingLink.test.tsx` | Pins PortalLayout for a training-scoped link session: training only, expired session returns to /t |
| `PortalLayout.tsx` | Shell for every portal page: top/bottom navigation, session-scope redirects, notices strip, recording bar room |
| `PortalNavigation.account.test.tsx` | bd-3wb0s: My account is the single nav entry for privacy policy and account deletion (Google Play) |
| `PortalNavigation.childTest.test.tsx` | bd-s1oo0.7: Child test / Learning assessment nav items appear for leaders only when portal_child_test is on |
| `PortalNavigation.coachLibrary.test.tsx` | bd-s42dye.2/bd-4joiqz: coach on app v2 sees only Training Library, Lesson Plans and More |
| `PortalNavigation.coachV2.flagOff.test.tsx` | bd-o15qnr: with portal_coach_v2 off or non-coach, nav matches the pre-flag snapshot exactly |
| `PortalNavigation.coachV2.test.tsx` | bd-o15qnr/bd-4404s7.2: coach with portal_coach_v2 gets Home/Schedule/Observe/Schools/More menu |
| `PortalNavigation.flagOff.test.tsx` | bd-5rz1v.12: with portal_new_ui off every state renders the pre-flag navigation snapshot |
| `PortalNavigation.lessons.test.tsx` | bd-4joiqz: leader menu gains Lesson Plans (also in phone bottom bar); teacher menu unchanged golden |
| `PortalNavigation.newUi.test.tsx` | bd-5rz1v.12: portal_new_ui nav: teacher indigo bottom bar, avatar pull-up menu, desktop top bar |
| `PortalNavigation.nowrap.test.tsx` | bd-t5tow: desktop nav links keep their label on one line below 1366px |
| `PortalNavigation.principal.test.tsx` | bd-60117: a principal gets an Analytics nav tab; other leader roles do not |
| `PortalNavigation.reachability.test.tsx` | bd-60174: a principal can reach every one of their six leader routes from the nav |
| `PortalNavigation.teacherV2.flagOff.test.tsx` | bd-fmf24g.1: with portal_teacher_v2 off, or on for a leader, nav matches the pre-flag snapshots |
| `PortalNavigation.teacherV2.test.tsx` | bd-fmf24g.1: teacher with portal_teacher_v2 gets Home/Lesson Plans/Coaching/Training/More bottom menu |
| `PortalNavigation.test.tsx` | bd-2434/bd-4n7p4/bd-2563: PortalNavigation role gating (leader vs teacher nav), Assessment link, mobile overflow tab |
| `PortalNavigation.training.test.tsx` | bd-60160: leader family (coaches, principals) can reach Training from the nav |
| `PortalNavigation.tsx` | Role- and flag-aware portal menu: teacher, leader, coach v2, teacher v2 and new-UI indigo bars; used by PortalLayout |
| `QuestionCard.test.tsx` | bd-60168: QuestionCard shows question number distinct from statement, same across vendors/trainings |
| `QuestionCard.tsx` | bd-60168: one quiz question rendered identically for module quiz and exam (MCQ, sentence completion) |
| `QuestionPager.test.tsx` | bd-60168: shouldPaginate against real vendor shapes and QuestionPager next/previous behaviour |
| `QuestionPager.tsx` | bd-60168: one-question-per-page pager with next/previous, used only when paginating helps (shouldPaginate) |
| `RecentLessonPlans.tsx` | bd-k23p38: teacher's last 10 lesson plans (any grade 1-12), bottom of the old-UI Lesson Plans page |
| `RecordingBar.tsx` | bd-5rz1v.10: bar that follows the teacher through the portal while a lesson records, plus "Recording continues" chip |
| `RemarksSection.tsx` | Principal Remarks (last S of STEPS) on Analytics: only submitted forms, received remarks section |
| `ScoreBreakdown.tsx` | Coaching score breakdown by the framework (FICO) actually assessed, in bands, replacing six OECD goal bars |
| `ScoreIndicator.bands.test.tsx` | Pins ScoreIndicator and ScoreBreakdown showing a performance band instead of a percentage number |
| `ScoreIndicator.tsx` | Shared score badge: renders a band for a percentage, used on dashboard, session list/report and Analytics |
| `Skeleton.tsx` | bd-fxk3t8: shimmer placeholder blocks (line/chip/tile) matching index.html app-shell, shown instead of spinners |
| `StatCard.tsx` | Shared stat tile: title, value, icon and optional trend, used on old-UI dashboards |
| `UrduAware.tsx` | Renders text per field as RTL Urdu when it contains Urdu script (isUrdu), else normal; coaching transcripts |
| `VideoCard.tsx` | Card for one VideoRequest with pending/processing/done status chip in the old-UI video list |
| `loadingStates.test.tsx` | bd-fxk3t8: every shared loading state and the teacher v2 lists show Skeleton placeholders, no spinner |
| `stepMark.test.tsx` | bd-v0toag.8: useStepMark/jumpToMark/useStepJump find, outline and jump to the step heading in a plan |
| `stepMark.tsx` | bd-v0toag.8: finds a coaching step's heading in the PDF text, outlines it, and jumps to it on tap |

## Who reads this (all, generated)
- `AnalyticsControls.tsx` ← imported by `portal/src/portal/analytics/Filters.tsx:4:e3e86d8b` · `portal/src/portal/pages/PortalCoachingAnalytics.tsx:8:e3e86d8b` · `portal/src/portal/pages/SchoolAnalytics.tsx:8:e3e86d8b`
- `AppFunnelTracker.tsx` ← imported by `portal/src/App.tsx:22:5d32a1a1`
- `AppLinkListener.tsx` ← imported by `portal/src/App.tsx:19:914ea212`
- `AssessmentGeneratorComingSoon.tsx` ← imported by `portal/src/portal/pages/ClassicAssessment.tsx:24:602aa397`
- `AssessmentGeneratorPanel.tsx` ← imported by `portal/src/portal/pages/ClassicAssessment.tsx:23:b256e97c`
- `AssessmentPapersPanel.tsx` ← imported by `portal/src/portal/pages/ClassicAssessment.tsx:25:751c4d45`
- `AttendancePanel.tsx` ← imported by `portal/src/portal/pages/PortalCoachingAnalytics.tsx:6:75a4c977` · `portal/src/portal/pages/SchoolAnalytics.tsx:7:75a4c977`
- `AttendanceSection.tsx` ← imported by `portal/src/portal/pages/PortalCoachingAnalytics.tsx:5:23863f86` · `portal/src/portal/pages/SchoolAnalytics.tsx:6:23863f86`
- `AudioPlayer.tsx` ← imported by `portal/src/portal/pages/PortalCoachingDetail.tsx:5:a4f26654` · `portal/src/portal/pages/PortalReadingAssessmentDetail.tsx:9:a4f26654`
- `BackButtonHandler.tsx` ← imported by `portal/src/App.tsx:20:16bba95a`
- `BandPicker.tsx` ← imported by `portal/src/portal/pages/PortalTraining.tsx:39:749925e2` · `portal/src/portal/pages/PortalTrainingV2.tsx:68:749925e2`
- `CapstoneExamForm.tsx` ← imported by `portal/src/portal/components/LevelExamCard.tsx:51:0638cdf7`
- `CapstoneResultCard.tsx` ← imported by `portal/src/portal/pages/PortalTraining.tsx:37:d0c79d3f` · `portal/src/portal/pages/PortalTrainingV2.tsx:66:d0c79d3f`
- `CertificatesPanel.tsx` ← imported by `portal/src/portal/newui/training/certificateFile.ts:4:e045d249` · `portal/src/portal/pages/PortalTraining.tsx:38:297a3c22` · `portal/src/portal/pages/PortalTrainingV2.tsx:67:297a3c22`
- `CoachingSessionCard.tsx` ← imported by `portal/src/portal/pages/PortalCoaching.tsx:7:6118e1b9`
- `EmptyState.tsx` ← imported by `portal/src/portal/pages/LeaderTeacherDetail.tsx:8:98ffa1d1` · `portal/src/portal/pages/LeaderTeachers.tsx:9:98ffa1d1` · `portal/src/portal/pages/PortalClasses.tsx:5:c5fb14c1` · `portal/src/portal/pages/PortalCoaching.tsx:9:c5fb14c1` (+4: `python3 kg/kg.py who-reads EmptyState.tsx`)
- `ExamAttempts.tsx` ← imported by `portal/src/portal/components/ModuleExamPanel.tsx:44:7b8634ac`
- `LegacyAttendanceRedirect.tsx` ← imported by `portal/src/App.tsx:18:d1f8bde0`
- `LessonPlanCard.tsx` ← imported by `portal/src/portal/pages/PortalLessonPlans.tsx:5:b9f7ce02`
- `LessonPlanPage.tsx` ← imported by `portal/src/portal/components/LessonPlanViewer.tsx:7:8a3e9d33`
- `LessonPlanViewer.tsx` ← imported by `portal/src/portal/newui/lessons/LessonPlanPages.tsx:7:c476811a` · `portal/src/portal/pages/PortalCurriculum.tsx:45:2ac3c53d` · `portal/src/portal/teacher/assessment/RequestPage.tsx:5:c476811a` · `portal/src/portal/teacher/lessons/ViewerPage.tsx:6:c476811a`
- `LevelCertificateRow.tsx` ← imported by `portal/src/portal/pages/PortalTrainingV2.tsx:65:57468839`
- `LevelExamCard.tsx` ← imported by `portal/src/portal/pages/PortalTraining.tsx:36:3595ebbf` · `portal/src/portal/pages/PortalTrainingV2.tsx:64:3595ebbf`
- `LoadingState.tsx` ← imported by `portal/src/portal/pages/LeaderHome.tsx:8:5cc42ac4` · `portal/src/portal/pages/LeaderObservation.tsx:5:63cbbcf9` · `portal/src/portal/pages/LeaderObservations.tsx:10:5cc42ac4` · `portal/src/portal/pages/LeaderObserveDraft.tsx:5:63cbbcf9` (+22: `python3 kg/kg.py who-reads LoadingState.tsx`)
- `ModuleExamPanel.tsx` ← imported by `portal/src/portal/pages/PortalTraining.tsx:35:c15c555b` · `portal/src/portal/pages/PortalTrainingV2.tsx:71:c15c555b`
- `ModuleQuizPanel.tsx` ← imported by `portal/src/portal/pages/PortalTraining.tsx:33:e531d422` · `portal/src/portal/pages/PortalTrainingV2.tsx:62:e531d422`
- `ModuleReadings.tsx` ← imported by `portal/src/portal/pages/PortalTrainingV2.tsx:72:99940d7a`
- `ObservationsSection.tsx` ← imported by `portal/src/portal/pages/PortalCoachingAnalytics.tsx:4:fb833e32` · `portal/src/portal/pages/SchoolAnalytics.tsx:5:fb833e32`
- `PortalLayout.tsx` ← imported by `portal/src/portal/coach/insights/components/Frame.tsx:2:ff188793` · `portal/src/portal/coach/ui.tsx:4:ac211a43` · `portal/src/portal/newui/assessment/AssessmentHome.tsx:4:a3b8b877` · `portal/src/portal/newui/assessment/AssessmentRequest.tsx:4:a3b8b877` (+44: `python3 kg/kg.py who-reads PortalLayout.tsx`)
- `PortalNavigation.tsx` ← imported by `portal/src/portal/components/PortalLayout.tsx:11:6bdd7e4c`
- `QuestionCard.tsx` ← imported by `portal/src/portal/components/QuestionPager.tsx:29:0768c026`
- `QuestionPager.tsx` ← imported by `portal/src/portal/components/ModuleExamPanel.tsx:41:1bb655dd`
- `RecentLessonPlans.tsx` ← imported by `portal/src/portal/pages/PortalCurriculum.tsx:44:2b1c36dc`
- `RecordingBar.tsx` ← imported by `portal/src/portal/pages/PortalCoachingRecord.tsx:12:17cdc0a5` · `portal/src/portal/components/LessonPlanViewer.tsx:5:8b9e81eb` · `portal/src/portal/components/PortalLayout.tsx:12:d51f6eb7`
- `RemarksSection.tsx` ← imported by `portal/src/portal/pages/PortalCoachingAnalytics.tsx:7:db857156` · `portal/src/portal/pages/SchoolAnalytics.tsx:10:87ca9ab4`
- `ScoreBreakdown.tsx` ← imported by `portal/src/portal/pages/PortalCoachingDetail.tsx:6:0a83fdf7`
- `ScoreIndicator.tsx` ← imported by `portal/src/portal/pages/LeaderObservations.tsx:9:1255d77f` · `portal/src/portal/pages/LeaderTeacherDetail.tsx:9:1255d77f` · `portal/src/portal/pages/LeaderTeachers.tsx:10:1255d77f` · `portal/src/portal/pages/PortalCoaching.tsx:2:6bc5406c` (+6: `python3 kg/kg.py who-reads ScoreIndicator.tsx`)
- `Skeleton.tsx` ← imported by `portal/src/App.tsx:30:2648ae31` · `portal/src/portal/auth/AnalyticsLogin.tsx:8:e21a4d15` · `portal/src/portal/coach/card/CoachLanding.tsx:1:c2987858` · `portal/src/portal/coach/card/frame.tsx:4:c2987858` (+26: `python3 kg/kg.py who-reads Skeleton.tsx`)
- `StatCard.tsx` ← imported by `portal/src/portal/pages/LeaderHome.tsx:7:273f3985` · `portal/src/portal/pages/LeaderTeacherDetail.tsx:6:273f3985` · `portal/src/portal/pages/PortalDashboard.tsx:16:a854d5cb`
- `UrduAware.tsx` ← imported by `portal/src/portal/pages/PortalCoachingDetail.tsx:7:023eb6ee` · `portal/src/portal/components/ScoreBreakdown.tsx:20:8be957ab`
- `stepMark.tsx` ← imported by `portal/src/portal/components/LessonPlanPage.tsx:2:37cb3e3d` · `portal/src/portal/components/LessonPlanViewer.tsx:6:bcbb0e1b`

## Tests (all, generated)
- `AppFunnelTracker.tsx` ← `portal/src/portal/components/AppFunnelTracker.test.tsx`
- `AppLinkListener.tsx` ← `portal/src/portal/components/AppLinkListener.test.tsx`
- `AssessmentGeneratorPanel.tsx` ← `portal/src/portal/components/AssessmentGeneratorPanel.test.tsx`
- `AssessmentPapersPanel.tsx` ← `portal/src/portal/components/AssessmentPapersPanel.empty.test.tsx` · `portal/src/portal/components/AssessmentPapersPanel.pastEnd.test.tsx` · `portal/src/portal/components/AssessmentPapersPanel.version.test.tsx`
- `AttendancePanel.tsx` ← `portal/src/portal/components/AttendancePanel.fraction.test.tsx` · `portal/src/portal/components/AttendancePanel.labels.test.tsx` · `portal/src/portal/components/AttendancePanel.mine.test.tsx` · `portal/src/portal/components/AttendancePanel.test.tsx`
- `BackButtonHandler.tsx` ← `portal/src/portal/components/BackButtonHandler.recording.test.tsx` · `portal/src/portal/components/BackButtonHandler.test.tsx`
- `CapstoneExamForm.tsx` ← `portal/src/portal/components/CapstoneExamForm.test.tsx`
- `CapstoneResultCard.tsx` ← `portal/src/portal/components/CapstoneResultCard.test.tsx`
- `CertificatesPanel.tsx` ← `portal/src/portal/components/CertificatesPanel.reload.test.tsx` · `portal/src/portal/components/CertificatesPanel.test.tsx` · `portal/src/portal/components/CertificatesShelf.test.tsx`
- `LegacyAttendanceRedirect.tsx` ← `portal/src/portal/pages/steps-removed.test.tsx`
- `LessonPlanPage.tsx` ← `portal/src/portal/components/LessonPlanPage.test.tsx`
- `LessonPlanViewer.tsx` ← `portal/src/portal/components/LessonPlanViewer.step.test.tsx`
- `LevelCertificateRow.tsx` ← `portal/src/portal/components/LevelCertificateRow.exams.test.tsx` · `portal/src/portal/components/LevelCertificateRow.scores.test.tsx`
- `LevelExamCard.tsx` ← `portal/src/portal/components/LevelExamCard.test.tsx`
- `LoadingState.tsx` ← `portal/src/portal/components/loadingStates.test.tsx`
- `ModuleExamPanel.tsx` ← `portal/src/portal/components/ModuleExamPanel.attempts.test.tsx` · `portal/src/portal/components/ModuleExamPanel.gatecopy.test.tsx`
- `ModuleQuizPanel.tsx` ← `portal/src/portal/components/ModuleQuizPanel.perQuestion.test.tsx` · `portal/src/portal/components/ModuleQuizPanel.test.tsx`
- `ModuleReadings.tsx` ← `portal/src/portal/components/ModuleReadings.test.tsx`
- `ObservationsSection.tsx` ← `portal/src/portal/components/ObservationsSection.cards.test.tsx`
- `PortalLayout.tsx` ← `portal/src/portal/components/PortalLayout.lessonsLink.test.tsx` · `portal/src/portal/components/PortalLayout.loading.test.tsx` · `portal/src/portal/components/PortalLayout.navFlash.test.tsx` · `portal/src/portal/components/PortalLayout.newUi.test.tsx` · `portal/src/portal/components/PortalLayout.notices.test.tsx` · `portal/src/portal/components/PortalLayout.trainingLink.test.tsx` (+2: `python3 kg/kg.py who-reads portal/src/portal/components/PortalLayout.tsx`)
- `PortalNavigation.tsx` ← `portal/src/portal/coach/insights/tests/routing.flagOff.test.tsx` · `portal/src/portal/components/PortalNavigation.account.test.tsx` · `portal/src/portal/components/PortalNavigation.childTest.test.tsx` · `portal/src/portal/components/PortalNavigation.coachLibrary.test.tsx` · `portal/src/portal/components/PortalNavigation.coachV2.flagOff.test.tsx` · `portal/src/portal/components/PortalNavigation.coachV2.test.tsx` (+14: `python3 kg/kg.py who-reads portal/src/portal/components/PortalNavigation.tsx`)
- `QuestionCard.tsx` ← `portal/src/portal/components/QuestionCard.test.tsx`
- `QuestionPager.tsx` ← `portal/src/portal/components/QuestionPager.test.tsx`
- `RecordingBar.tsx` ← `portal/src/portal/components/PortalLayout.newUi.test.tsx` · `portal/src/portal/newui/coaching/RecordingBar.newUi.test.tsx` · `portal/src/portal/pages/PortalCoaching.flagOff.test.tsx`
- `ScoreBreakdown.tsx` ← `portal/src/portal/components/ScoreIndicator.bands.test.tsx`
- `ScoreIndicator.tsx` ← `portal/src/portal/components/ScoreIndicator.bands.test.tsx`
- `Skeleton.tsx` ← `portal/src/portal/auth/auth.skeleton.test.tsx` · `portal/src/portal/components/loadingStates.test.tsx`
- `stepMark.tsx` ← `portal/src/portal/components/stepMark.test.tsx`

## Related (all, generated)
- docs: `docs/CLAUDE.index.md`? · `docs/app-funnel-telemetry.md`? · `docs/reports/bug131-phase2-portal-quiz-ui.md`? · `docs/reports/bug131-phase3-grand-quiz.md`? · `portal/src/lib/CLAUDE.index.md`? · `portal/src/portal/CLAUDE.md`? · `portal/src/portal/auth/CLAUDE.index.md`? · `portal/src/portal/auth/CLAUDE.md`? · `portal/src/portal/coach/insights/tests/CLAUDE.index.md`? · `portal/src/portal/components/CLAUDE.index.md`? · `portal/src/portal/components/CLAUDE.md`? · `portal/src/portal/components/__testing__/CLAUDE.md`? · `portal/src/portal/components/assess/CLAUDE.index.md`? · `portal/src/portal/components/assess/CLAUDE.md`? · `portal/src/portal/components/assessment-edit/CLAUDE.index.md`? · `portal/src/portal/components/assessment-edit/CLAUDE.md`? · `portal/src/portal/components/assessment-jobs/CLAUDE.md`? · `portal/src/portal/components/childTest/CLAUDE.md`? · `portal/src/portal/components/coaching/CLAUDE.index.md`? · `portal/src/portal/components/coaching/CLAUDE.md`? · `portal/src/portal/hooks/CLAUDE.index.md`? · `portal/src/portal/hooks/CLAUDE.md`? · `portal/src/portal/lib/CLAUDE.index.md`? · `portal/src/portal/newui/CLAUDE.index.md`? · `portal/src/portal/newui/coaching/CLAUDE.index.md`? · `portal/src/portal/newui/coaching/CLAUDE.md`? · `portal/src/portal/pages/CLAUDE.index.md`? · `portal/src/portal/teacher/CLAUDE.index.md`? · `portal/src/portal/teacher/assessment/CLAUDE.index.md`? · `portal/src/portal/teacher/assessment/CLAUDE.md`? · `portal/src/portal/teacher/attendance/CLAUDE.index.md`? · `portal/src/portal/teacher/attendance/CLAUDE.md`? · `portal/src/portal/teacher/classes/CLAUDE.index.md`? · `portal/src/portal/teacher/classes/CLAUDE.md`? · `portal/src/portal/teacher/lessons/CLAUDE.index.md`? · `portal/src/portal/teacher/lessons/CLAUDE.md`? · `portal/src/portal/teacher/notices/CLAUDE.index.md`? · `portal/src/portal/teacher/notices/CLAUDE.md`? · `portal/src/portal/teacher/training/CLAUDE.index.md`? · `portal/src/portal/teacher/training/CLAUDE.md`?
