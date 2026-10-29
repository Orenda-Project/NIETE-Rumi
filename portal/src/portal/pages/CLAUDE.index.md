# pages — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/pages -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `__snapshots__/` | → (not mapped: excluded; 4 files) |
| `Analytics.tabs.test.tsx` | Pins SchoolAnalytics's Observations/Attendance/Remarks tabs and the From/To window read from the address |
| `App.routes.test.tsx` | bd-60160: pins which training page each URL serves through the real router (/portal/training new, /v1 old) |
| `ClassicAssessment.tabs.test.tsx` | bd-t5tow: pins ClassicAssessment's Create paper / My papers tabs, ?tab=papers and a paper being made in both |
| `ClassicAssessment.test.tsx` | bd-4n7p4: pins ClassicAssessment as its own page: heading, tabs, generator form, papers panel gets editing from /config |
| `ClassicAssessment.tsx` | bd-4n7p4: old-UI Assessment Generator (formerly a Curriculum tab), served at /portal/assessment via PortalAssessment |
| `LeaderAssess.cwpm.test.tsx` | Round 7b sa_cwpm: pins CWPM labelling and formula across the dashboard, results row and review page |
| `LeaderAssess.r7b.test.tsx` | Round 7b sa_end_test_restart: pins Restart test for an ended child (new phone id, restart:true); OFF shows Stopped |
| `LeaderAssess.r8offline.test.tsx` | Round 8 switches on LeaderAssess (fast start, offline-first, offline prep): slow Present, queued Present, offline resume |
| `LeaderAssess.test.tsx` | Pins LeaderAssess end to end: flag gate, school picker, server list, absent/present handover, engine frame, queue |
| `LeaderAssess.tsx` | Coach's Learning assessment at /portal/leader/assess (portal_child_test_sa): pick school, mark five children, run engine |
| `LeaderAssessDashboard.filters.test.tsx` | Round 7b sa_dash_filters: pins mode, date and coach filters and the Skips and stops view on the live dashboard |
| `LeaderAssessDashboard.practice.test.tsx` | Round 8 sa_r8_hide_practice: pins practice-school sessions hidden by default with an Include toggle |
| `LeaderAssessDashboard.test.tsx` | Pins the example results dashboard: off/unreadable switch shows not available; banner, drill-down, filters, cards |
| `LeaderAssessDashboard.tsx` | Results dashboard at /portal/leader/assess/dashboard: example (sandbox) or live sessions, filters, masked small cells |
| `LeaderAssessResults.test.tsx` | Pins LeaderAssessResults: session-id-only path, one card per task, spoken-task wording, Urdu digits, 404 not available |
| `LeaderAssessResults.tsx` | Read-only results of one assessment session at /portal/leader/assess/results/:sessionId (sa_results_view) |
| `LeaderAssessReview.test.tsx` | Pins LeaderAssessReview (sa_review_page): switch off, per-child list by short id, task review, reviewer marks saved |
| `LeaderAssessReview.tsx` | Visit review at /portal/leader/assess/review[/:sessionId] (sa_review_page): per-child list, recordings and marks |
| `LeaderChildTest.test.tsx` | bd-s1oo0.7: pins LeaderChildTest: flag gate, list of five, present opens first block card, absent, check form |
| `LeaderChildTest.tsx` | bd-s1oo0.7: coach child test at /portal/leader/child-test: five children, Urdu/English/maths blocks, 60s timed cards |
| `LeaderHome.coachV2.test.tsx` | bd-o15qnr: pins a v2-pilot coach redirected to the v2 Home while everyone else keeps My Patch |
| `LeaderHome.test.tsx` | bd-2434: pins LeaderHome greets the leader by first name and renders KPIs and the leader nav |
| `LeaderHome.tsx` | bd-2434: leader "My Patch" home at /portal/leader; shows KPIs and a focus list from GET /leader/overview |
| `LeaderObservation.test.tsx` | bd-5rz1v.6: pins LeaderObservation's step tracker (analysed, draft, talk, feedback, report) and its buttons |
| `LeaderObservation.tsx` | bd-5rz1v.6: one coach observation at /portal/leader/observe/:id, step by step like WhatsApp /observe, polls status |
| `LeaderObservations.coachObserve.test.tsx` | bd-5rz1v.6: pins LeaderObservations' goal button and sent lessons only in the portal_coach_observation pilot |
| `LeaderObservations.identity.test.tsx` | bd-2670: pins LeaderObservations naming the teacher, school and EMIS on waiting debriefs instead of Unassigned |
| `LeaderObservations.schedule.test.tsx` | bd-2676: pins scheduling a visit from LeaderObservations: the coach's own teachers listed, slots, submit |
| `LeaderObservations.test.tsx` | bd-2455/bd-2676: pins LeaderObservations' three sections and a neutral label for unbound legacy observations |
| `LeaderObservations.tsx` | bd-2455: leader Observations at /portal/leader/observations: schedule, waiting debriefs and completed record |
| `LeaderObserve.v2names.test.tsx` | bd-o15qnr.19: pins Draft and Talk titles ("Feedback Form") when reached from coach v2 versus today's titles |
| `LeaderObserveDraft.test.tsx` | bd-5rz1v.6: pins LeaderObserveDraft's initialValues/countChanges and that the submitted keys match the WhatsApp form |
| `LeaderObserveDraft.tsx` | bd-5rz1v.6: "Check the draft report" at /portal/leader/observe/:id/draft; WhatsApp review form as a portal page |
| `LeaderObserveRecord.coachV2.test.tsx` | bd-o15qnr: pins LeaderObserveRecord reused by coach v2: prefilled visit, way=record skips the sheet |
| `LeaderObserveRecord.test.tsx` | bd-5rz1v.6: pins LeaderObserveRecord: teacher pick, two-way sheet, back-camera photo input, dark when flag off |
| `LeaderObserveRecord.tsx` | bd-5rz1v.6: coach picks a teacher and records or uploads a lesson at /portal/leader/observe/new |
| `LeaderObserveTalk.test.tsx` | bd-5rz1v.6: pins LeaderObserveTalk: guide's three parts and closing question, uploaded talk goes to R2 and attaches |
| `LeaderObserveTalk.tsx` | bd-5rz1v.6: "Talk with the teacher" debrief at /portal/leader/observe/:id/talk: guide, recording, Digital Coach feedback |
| `LeaderTeacherDetail.feedback.test.tsx` | bd-60174: pins LeaderTeacherDetail showing written feedback (summary and per-visit notes) instead of scores |
| `LeaderTeacherDetail.test.tsx` | bd-2434: pins LeaderTeacherDetail fetches by route id and renders the teacher's identity, stats and sessions |
| `LeaderTeacherDetail.trend.test.tsx` | bd-60174: pins that LeaderTeacherDetail draws no score trend chart and shows no percentage, whatever the payload |
| `LeaderTeacherDetail.tsx` | bd-2434: one teacher's detail for a leader at /portal/leader/teacher/:id (GET /leader/teacher/:id, patch-guarded) |
| `LeaderTeachers.identity.test.tsx` | bd-2671/bd-2672: pins LeaderTeachers showing school, EMIS, observation counts and a named focus area |
| `LeaderTeachers.principal-route.test.tsx` | bd-60119: pins a principal's teacher row leading to filtered Analytics while a coach stays on the detail page |
| `LeaderTeachers.test.tsx` | bd-2434: pins LeaderTeachers renders every patch teacher (on-Rumi or not) and the patch summary |
| `LeaderTeachers.tsx` | bd-2434: leader teachers roster at /portal/leader/teachers from GET /leader/teachers, with Rumi activity |
| `PortalAccount.test.tsx` | bd-3wb0s: pins /portal/account for signed-in users only, titled My account, with privacy and delete links |
| `PortalAccount.tsx` | bd-3wb0s: My account page at /portal/account holding the in-app privacy policy and delete-account links for Play |
| `PortalAssessment.test.tsx` | bd-5rz1v.13: pins ASSESSMENT_ROUTES and PortalAssessment choosing new UI or ClassicAssessment by flag and role |
| `PortalAssessment.tsx` | bd-5rz1v.13: /portal/assessment router choosing the new UI's Assessment views or ClassicAssessment by flag and role |
| `PortalClasses.test.tsx` | Pins PortalClasses: class list with sessions and subjects, empty state not an error, add-class form behaviour |
| `PortalClasses.tsx` | Teacher's own classes list and add-class form at /portal/classes (teacher-owned classes only) |
| `PortalCoaching.flagOff.test.tsx` | bd-5rz1v.26: pins every coaching page unchanged when portal_new_ui is off, or /config fails |
| `PortalCoaching.home.test.tsx` | bd-5rz1v: pins the redesigned Coaching home for portal_self_observation teachers; others keep today's page |
| `PortalCoaching.observation.test.tsx` | bd-5rz1v.6.4: pins a coach's sent observation in the teacher's Coaching list (who observed) and lesson page |
| `PortalCoaching.selfObservation.test.tsx` | bd-3bvfj: pins the Send a lesson entry hidden unless /config says self-observation is on |
| `PortalCoaching.sendLesson.test.tsx` | bd-5rz1v.7: pins the single Send a lesson button and the sheet with its two ways (record or choose a file) |
| `PortalCoaching.tsx` | Classic Coaching page at /portal/coaching for teachers without portal_self_observation; lists sessions |
| `PortalCoachingAnalytics.mine.test.tsx` | Pins PortalCoachingAnalytics as My Analytics, with lesson-plan and exam counts hidden for now |
| `PortalCoachingAnalytics.tsx` | "My Analytics" teacher page at /portal/coaching/analytics: the same view a principal sees for them |
| `PortalCoachingDetail.lesson.test.tsx` | bd-5rz1v: pins PortalCoachingDetail's lesson page (flag-gated), including the while-analysing state |
| `PortalCoachingDetail.tsx` | Classic coaching report page at /portal/coaching/session/:sessionId for teachers without portal_self_observation |
| `PortalCoachingRecord.chunks.test.tsx` | bd-5rz1v.10: pins that the real LessonRecorder keeps saving chunks after the record page unmounts |
| `PortalCoachingRecord.live.test.tsx` | bd-v0toag.31.1: pins live moves on the older record screen: plan picked before recording, ticks, tap records |
| `PortalCoachingRecord.session.test.tsx` | bd-5rz1v.10: pins a lesson recording continuing across other pages with one recorder and one microphone |
| `PortalCoachingRecord.test.tsx` | bd-5rz1v: pins PortalCoachingRecord: dark until the feature is on, no choice screen, record/choose, send flow |
| `PortalCoachingRecord.tsx` | bd-5rz1v: record or choose a lesson and send it to Digital Coach at /portal/coaching/new; uses legacyLive plan hold |
| `PortalCurriculum.flagOff.test.tsx` | bd-5rz1v.14: pins PortalCurriculum unchanged (recorded snapshots) in every flag-off state |
| `PortalCurriculum.newUi.test.tsx` | bd-5rz1v.14: pins /portal/curriculum showing the new Lesson Plans with portal_new_ui; ?tab=assessment redirects |
| `PortalCurriculum.recent.test.tsx` | bd-k23p38: pins the Recent lesson plans panel (last 10, any grade, how last had) on the old-look Curriculum page |
| `PortalCurriculum.tab.test.tsx` | bd-4n7p4: pins that PortalCurriculum has no Assessment tab and ?tab=assessment redirects to /portal/assessment |
| `PortalCurriculum.tsx` | Lesson-plan catalogue at /portal/curriculum (grade, subject, chapter, lesson, open PDF), same as the WhatsApp bot's |
| `PortalCurriculum.viewer.test.tsx` | bd-5rz1v.10: pins lesson plans opening inside the portal's PDF viewer (grades 1-5 and 6-12), LTR canvases |
| `PortalDashboard.flagOff.test.tsx` | bd-5rz1v.17: pins PortalDashboard unchanged with portal_new_ui off, and Open WhatsApp from /config |
| `PortalDashboard.greeting.test.tsx` | bd-2567: pins the dashboard greeting using the teacher's full name, falling back to first name |
| `PortalDashboard.leader-redirect.test.tsx` | bd-2434: pins a leader-family role on PortalDashboard being redirected to /portal/leader |
| `PortalDashboard.loading.test.tsx` | bd-fxk3t8: pins a placeholder frame (not the old dashboard) while the teacher v2 flag is read on a v2 device |
| `PortalDashboard.newUi.test.tsx` | bd-5rz1v.17: pins /portal/dashboard serving the new Home with portal_new_ui and the old dashboard without |
| `PortalDashboard.teacherV2.test.tsx` | bd-fmf24g.1: pins PortalDashboard sending a portal_teacher_v2 teacher to the v2 Home |
| `PortalDashboard.tsx` | Classic teacher dashboard at /portal/dashboard; redirects leaders to their home, lazy-loads the chart library |
| `PortalDeleteAccount.test.tsx` | bd-3wb0s: pins the public delete-account page: no login form, no session lookup, mailto request path |
| `PortalDeleteAccount.tsx` | bd-3wb0s: public "Delete your NIETE account" page at /portal/delete-account that Play's Data safety form links to |
| `PortalHomeList.tsx` | bd-5rz1v.17: /portal/dashboard/:metric lists behind Home's tiles; new UI only, else redirects to the dashboard |
| `PortalLessonPlans.tsx` | Old Lesson Plans Library list with paging/filters (portal.getLessonPlans); no importer, /portal/lesson-plans redirects |
| `PortalLogin.intl.test.tsx` | Pins portal_login_intl_numbers: with the switch on a +254 number is sent; off it is held as Check the number |
| `PortalLogin.legal.test.tsx` | bd-3wb0s: pins the login footer links to the in-app privacy policy and delete-account pages |
| `PortalLogin.session.test.tsx` | bd-2569: pins PortalLogin forwarding an already-signed-in teacher or leader instead of showing the form |
| `PortalLogin.tsx` | bd-fmf24g.64: portal login at /portal/login in the teacher-app look, with per-field bilingual errors |
| `PortalPasswordReset.tsx` | bd-fmf24g.64: forgot-password request page at /portal/reset-password; sends the WhatsApp code request |
| `PortalPasswordResetVerify.tsx` | bd-fmf24g.64: enter WhatsApp code and new password at /portal/reset-password/verify on one page |
| `PortalPrivacy.test.tsx` | bd-nvnf2: pins the public privacy policy page: signed-out render, no session lookup, publisher naming |
| `PortalPrivacy.tsx` | bd-nvnf2: public NIETE privacy policy at /portal/privacy, the URL registered in Play Console |
| `PortalReadingAssessmentDetail.tsx` | One reading assessment's detail via portal.getReadingAssessment; no importer in src (not routed in App.tsx) |
| `PortalReadingAssessments.tsx` | Paged list of reading assessments via portal.getReadingAssessments; no importer in src (not routed in App.tsx) |
| `PortalRoot.loading.test.tsx` | bd-fxk3t8: pins PortalRoot's frame while the session is checked (app frame or sign-in outline by hint) |
| `PortalRoot.test.tsx` | bd-2394/bd-2434: pins "/" sending authenticated teachers to the dashboard and leaders to My Patch |
| `PortalRoot.tsx` | bd-2394: what "/" renders for the portal audience, deciding between login and the signed-in home on app cold boot |
| `PortalSetup.tsx` | bd-x7aprz.3: old /portal/setup/:token link; a live token signs the user in, a dead one shows Link expired |
| `PortalTraining.certificates.test.tsx` | Pins the My certificates button on PortalTraining and that certificates load only on click |
| `PortalTraining.editbands.test.tsx` | Pins PortalTraining letting a teacher with existing training edit their level band (not the empty state) |
| `PortalTraining.nobands.test.tsx` | bd-43487: pins PortalTraining's no-training-assigned explanation and band picker |
| `PortalTraining.tsx` | Classic 3-step training picker (level, course, module) at /portal/training/v1 |
| `PortalTrainingPage.test.tsx` | bd-5rz1v.25: pins TRAINING_ROUTES under both bases and the new-UI screens PortalTrainingPage serves |
| `PortalTrainingPage.tsx` | bd-5rz1v.25: routing wrapper for every /portal/training address; picks new screens, V2 or classic by flag |
| `PortalTrainingV2.deeplink.test.tsx` | bd-60152: pins prev/next arrows on a training unit opened by URL (neighbours resolved) |
| `PortalTrainingV2.flagOff.test.tsx` | bd-5rz1v.25: pins every training address unchanged with portal_new_ui off |
| `PortalTrainingV2.moduleCards.test.tsx` | bd-klecr.5: pins the course page's modules as numbered cards with the assessment inside its module's card |
| `PortalTrainingV2.numericIds.test.tsx` | bd-66wui: pins the classic unit page with production-shaped numeric module ids (position, arrows, Completed) |
| `PortalTrainingV2.pages.test.tsx` | bd-klecr: pins one page per training step (Training, Provider, Level, Course, Unit) and Certificates |
| `PortalTrainingV2.quizTick.test.tsx` | bd-zgme6: pins the Completed tick following the server's pass verdict, not a failed quiz attempt |
| `PortalTrainingV2.route.test.tsx` | bd-60148/bd-60160: pins the v2 training page render and that the v1 page stays reachable and unchanged |
| `PortalTrainingV2.tsx` | bd-60148/bd-60160: redesigned training page served at /portal/training and /portal/training/v2 |
| `PortalTrainingV2.vendorgate.test.tsx` | bd-60148: pins the level rail showing no levels until a provider is chosen, then only that provider's |
| `PortalVideoDetail.tsx` | One video's detail via portal.getVideo; no importer in src (not routed in App.tsx) |
| `PortalVideos.tsx` | My Videos list with search and filters via portal.getVideos; no importer in src (not routed in App.tsx) |
| `SchoolAnalytics.axes.test.tsx` | bd-60174: pins SchoolAnalytics score-trend axis titles (x: one observed lesson, y: the quantity) |
| `SchoolAnalytics.exams.test.tsx` | Pins SchoolAnalytics showing the school's exams generated beside its lesson plans |
| `SchoolAnalytics.history.test.tsx` | bd-60119: pins SchoolAnalytics coaching history: newest day first, Human Observation shows a band never marks |
| `SchoolAnalytics.scope.test.tsx` | bd-60122: pins SchoolAnalytics' KPI row stating one scope (whole school, or one selected teacher) |
| `SchoolAnalytics.sections.test.tsx` | Pins SchoolAnalytics' plain page and section names and the Observations/Attendance/Principal Remarks tabs |
| `SchoolAnalytics.steps.test.tsx` | bd-60118: pins SchoolAnalytics' separate teacher and student presence figures, remarks breakdown and teacher filter |
| `SchoolAnalytics.test.tsx` | bd-60117: pins SchoolAnalytics naming the school and showing school-level (not the principal's own) numbers |
| `SchoolAnalytics.tsx` | bd-60117: principal's school Analytics at /portal/leader/school-analytics (the school, not the user) |
| `SchoolAnalytics.ux.test.tsx` | bd-60119: pins SchoolAnalytics refetch feedback: spinner while a teacher loads, filter stays usable |
| `SchoolLessons.kinds.test.tsx` | Pins SchoolLessons listing Human and Digital Coach observations, each labelled; only Human carries a rating |
| `SchoolLessons.test.tsx` | bd-60121: pins SchoolLessons listing every observed lesson, uncapped, newest first |
| `SchoolLessons.tsx` | bd-60121: every observed lesson of a school on its own page at /portal/leader/lessons |
| `leader-journey.test.tsx` | Pins bands (never numbers) on LeaderTeacherDetail and LeaderTeachers after score numbers were removed |
| `legacyLive.test.ts` | bd-v0toag.31.1: pins legacyLive's library plan to flow-plan mapping and that file or no plan gives nothing |
| `legacyLive.ts` | bd-v0toag.31.1: holds the lesson plan picked before Record on the old record screen so live moves can use it |
| `observation-bands.pages.test.tsx` | Pins observation scores shown as bands, not numbers or percentages, across Coaching, My Analytics and school pages |
| `password-visibility.test.tsx` | bd-2668: pins the password show/hide eye toggle on PortalLogin and PortalSetup-era screens, masked by default |
| `steps-removed.test.tsx` | Pins My Patch reverted to the patch overview with no STEPS grid, row or journey anywhere (operator, 2026-09-30) |

## Who reads this (all, generated)
- `ClassicAssessment.tsx` ← imported by `portal/src/portal/pages/PortalAssessment.tsx:7:bd26bb61`
- `LeaderAssess.tsx` ← imported by `portal/src/App.tsx:92:23c84704`
- `LeaderAssessDashboard.tsx` ← imported by `portal/src/App.tsx:94:dbd5d54a`
- `LeaderAssessResults.tsx` ← imported by `portal/src/App.tsx:93:5b6f3ee3`
- `LeaderAssessReview.tsx` ← imported by `portal/src/App.tsx:95:1422c4ca`
- `LeaderChildTest.tsx` ← imported by `portal/src/App.tsx:91:0517e004`
- `LeaderHome.tsx` ← imported by `portal/src/App.tsx:87:07886ea2`
- `LeaderObservation.tsx` ← imported by `portal/src/App.tsx:97:bc776d34`
- `LeaderObservations.tsx` ← imported by `portal/src/App.tsx:90:ec4b2b91`
- `LeaderObserveDraft.tsx` ← imported by `portal/src/App.tsx:98:e124e82e`
- `LeaderObserveRecord.tsx` ← imported by `portal/src/App.tsx:96:e90a19b6`
- `LeaderObserveTalk.tsx` ← imported by `portal/src/App.tsx:99:54b7b869`
- `LeaderTeacherDetail.tsx` ← imported by `portal/src/App.tsx:89:ecf43d19`
- `LeaderTeachers.tsx` ← imported by `portal/src/App.tsx:88:d43a171a`
- `PortalAccount.tsx` ← imported by `portal/src/App.tsx:76:1abc3174`
- `PortalAssessment.tsx` ← imported by `portal/src/App.tsx:78:a6bf02cc`
- `PortalClasses.tsx` ← imported by `portal/src/App.tsx:79:dbd5fbeb`
- `PortalCoaching.tsx` ← imported by `portal/src/App.tsx:83:16c23b96`
- `PortalCoachingAnalytics.tsx` ← imported by `portal/src/App.tsx:84:7390aaea`
- `PortalCoachingDetail.tsx` ← imported by `portal/src/App.tsx:85:1777ec86`
- `PortalCoachingRecord.tsx` ← imported by `portal/src/App.tsx:86:f933d470`
- `PortalCurriculum.tsx` ← imported by `portal/src/App.tsx:80:5b2debb3`
- `PortalDashboard.tsx` ← imported by `portal/src/App.tsx:50:3b33cfa2`
- `PortalDeleteAccount.tsx` ← imported by `portal/src/App.tsx:74:05d06f81`
- `PortalHomeList.tsx` ← imported by `portal/src/App.tsx:77:7fa7ef96`
- `PortalLogin.tsx` ← imported by `portal/src/App.tsx:10:66a7a677` · `portal/src/portal/pages/PortalRoot.tsx:5:1b16e767`
- `PortalPasswordReset.tsx` ← imported by `portal/src/App.tsx:72:8af74aa6`
- `PortalPasswordResetVerify.tsx` ← imported by `portal/src/App.tsx:73:0a2e7a2c`
- `PortalPrivacy.tsx` ← imported by `portal/src/App.tsx:75:1b5d7bc6`
- `PortalRoot.tsx` ← imported by `portal/src/App.tsx:11:722bd32f`
- `PortalSetup.tsx` ← imported by `portal/src/App.tsx:71:7b9739d1`
- `PortalTraining.tsx` ← imported by `portal/src/App.tsx:81:8b507f06`
- `PortalTrainingPage.tsx` ← imported by `portal/src/App.tsx:82:d7e20fa2`
- `PortalTrainingV2.tsx` ← imported by `portal/src/portal/pages/PortalTrainingPage.tsx:8:b09c7a87`
- `SchoolAnalytics.tsx` ← imported by `portal/src/App.tsx:154:380aa3eb`
- `SchoolLessons.tsx` ← imported by `portal/src/App.tsx:156:3a991917`
- `legacyLive.ts` ← imported by `portal/src/portal/pages/PortalCoachingRecord.tsx:31:8621d378`
- env `PROD` read at `portal/src/portal/pages/PortalReadingAssessments.tsx:66:a940a13e`

## Tests (all, generated)
- `ClassicAssessment.tsx` ← `portal/src/portal/pages/ClassicAssessment.tabs.test.tsx` · `portal/src/portal/pages/ClassicAssessment.test.tsx`
- `LeaderAssess.tsx` ← `portal/src/portal/pages/LeaderAssess.r7b.test.tsx` · `portal/src/portal/pages/LeaderAssess.r8offline.test.tsx` · `portal/src/portal/pages/LeaderAssess.test.tsx`
- `LeaderAssessDashboard.tsx` ← `portal/src/portal/pages/LeaderAssess.cwpm.test.tsx` · `portal/src/portal/pages/LeaderAssessDashboard.filters.test.tsx` · `portal/src/portal/pages/LeaderAssessDashboard.practice.test.tsx` · `portal/src/portal/pages/LeaderAssessDashboard.test.tsx`
- `LeaderAssessResults.tsx` ← `portal/src/portal/pages/LeaderAssess.cwpm.test.tsx` · `portal/src/portal/pages/LeaderAssessResults.test.tsx`
- `LeaderAssessReview.tsx` ← `portal/src/portal/pages/LeaderAssess.cwpm.test.tsx` · `portal/src/portal/pages/LeaderAssessReview.test.tsx`
- `LeaderChildTest.tsx` ← `portal/src/portal/pages/LeaderChildTest.test.tsx`
- `LeaderHome.tsx` ← `portal/src/portal/fln/hooks.test.tsx` · `portal/src/portal/pages/LeaderHome.coachV2.test.tsx` · `portal/src/portal/pages/LeaderHome.test.tsx` · `portal/src/portal/pages/steps-removed.test.tsx`
- `LeaderObservation.tsx` ← `portal/src/portal/pages/LeaderObservation.test.tsx` · `portal/src/portal/pages/LeaderObserve.v2names.test.tsx`
- `LeaderObservations.tsx` ← `portal/src/portal/pages/LeaderObservations.coachObserve.test.tsx` · `portal/src/portal/pages/LeaderObservations.identity.test.tsx` · `portal/src/portal/pages/LeaderObservations.schedule.test.tsx` · `portal/src/portal/pages/LeaderObservations.test.tsx` · `portal/src/portal/pages/leader-journey.test.tsx`
- `LeaderObserveDraft.tsx` ← `portal/src/portal/pages/LeaderObserve.v2names.test.tsx` · `portal/src/portal/pages/LeaderObserveDraft.test.tsx`
- `LeaderObserveRecord.tsx` ← `portal/src/portal/pages/LeaderObserveRecord.coachV2.test.tsx` · `portal/src/portal/pages/LeaderObserveRecord.test.tsx`
- `LeaderObserveTalk.tsx` ← `portal/src/portal/pages/LeaderObserve.v2names.test.tsx` · `portal/src/portal/pages/LeaderObserveTalk.test.tsx`
- `LeaderTeacherDetail.tsx` ← `portal/src/portal/pages/LeaderTeacherDetail.feedback.test.tsx` · `portal/src/portal/pages/LeaderTeacherDetail.test.tsx` · `portal/src/portal/pages/LeaderTeacherDetail.trend.test.tsx` · `portal/src/portal/pages/leader-journey.test.tsx` · `portal/src/portal/pages/steps-removed.test.tsx`
- `LeaderTeachers.tsx` ← `portal/src/portal/pages/LeaderTeachers.identity.test.tsx` · `portal/src/portal/pages/LeaderTeachers.principal-route.test.tsx` · `portal/src/portal/pages/LeaderTeachers.test.tsx` · `portal/src/portal/pages/leader-journey.test.tsx` · `portal/src/portal/pages/steps-removed.test.tsx`
- `PortalAccount.tsx` ← `portal/src/portal/pages/PortalAccount.test.tsx`?
- `PortalAssessment.tsx` ← `portal/src/portal/components/loadingStates.test.tsx` · `portal/src/portal/pages/PortalAssessment.test.tsx`
- `PortalClasses.tsx` ← `portal/src/portal/pages/PortalClasses.test.tsx`
- `PortalCoaching.tsx` ← `portal/src/portal/newui/coaching/CoachingMain.test.tsx` · `portal/src/portal/pages/PortalCoaching.flagOff.test.tsx` · `portal/src/portal/pages/PortalCoaching.home.test.tsx` · `portal/src/portal/pages/PortalCoaching.observation.test.tsx` · `portal/src/portal/pages/PortalCoaching.selfObservation.test.tsx` · `portal/src/portal/pages/PortalCoaching.sendLesson.test.tsx` (+1: `python3 kg/kg.py who-reads portal/src/portal/pages/PortalCoaching.tsx`)
- `PortalCoachingAnalytics.tsx` ← `portal/src/portal/pages/Analytics.tabs.test.tsx` · `portal/src/portal/pages/PortalCoachingAnalytics.mine.test.tsx` · `portal/src/portal/pages/observation-bands.pages.test.tsx` · `portal/src/portal/pages/steps-removed.test.tsx`
- `PortalCoachingDetail.tsx` ← `portal/src/portal/newui/coaching/LessonView.test.tsx` · `portal/src/portal/pages/PortalCoaching.flagOff.test.tsx` · `portal/src/portal/pages/PortalCoaching.observation.test.tsx` · `portal/src/portal/pages/PortalCoachingDetail.lesson.test.tsx` · `portal/src/portal/pages/observation-bands.pages.test.tsx`
- `PortalCoachingRecord.tsx` ← `portal/src/portal/newui/coaching/RecordPage.live.test.tsx` · `portal/src/portal/newui/coaching/RecordPage.test.tsx` · `portal/src/portal/pages/PortalCoaching.flagOff.test.tsx` · `portal/src/portal/pages/PortalCoachingRecord.chunks.test.tsx` · `portal/src/portal/pages/PortalCoachingRecord.live.test.tsx` · `portal/src/portal/pages/PortalCoachingRecord.session.test.tsx` (+1: `python3 kg/kg.py who-reads portal/src/portal/pages/PortalCoachingRecord.tsx`)
- `PortalCurriculum.tsx` ← `portal/src/portal/pages/PortalCurriculum.flagOff.test.tsx` · `portal/src/portal/pages/PortalCurriculum.newUi.test.tsx` · `portal/src/portal/pages/PortalCurriculum.recent.test.tsx` · `portal/src/portal/pages/PortalCurriculum.tab.test.tsx` · `portal/src/portal/pages/PortalCurriculum.viewer.test.tsx`
- `PortalDashboard.tsx` ← `portal/src/portal/hooks/firstPage.test.tsx` · `portal/src/portal/pages/PortalDashboard.flagOff.test.tsx` · `portal/src/portal/pages/PortalDashboard.greeting.test.tsx` · `portal/src/portal/pages/PortalDashboard.leader-redirect.test.tsx` · `portal/src/portal/pages/PortalDashboard.loading.test.tsx` · `portal/src/portal/pages/PortalDashboard.newUi.test.tsx` (+2: `python3 kg/kg.py who-reads portal/src/portal/pages/PortalDashboard.tsx`)
- `PortalDeleteAccount.tsx` ← `portal/src/portal/pages/PortalDeleteAccount.test.tsx`?
- `PortalHomeList.tsx` ← `portal/src/portal/components/loadingStates.test.tsx` · `portal/src/portal/pages/PortalDashboard.newUi.test.tsx`
- `PortalLogin.tsx` ← `portal/src/portal/analytics/entry.test.tsx` · `portal/src/portal/auth/admin-login.test.tsx` · `portal/src/portal/auth/auth.pages.test.tsx` · `portal/src/portal/auth/password-sign-in.test.tsx` · `portal/src/portal/fln/hooks.test.tsx` · `portal/src/portal/hooks/firstPage.test.tsx` (+4: `python3 kg/kg.py who-reads portal/src/portal/pages/PortalLogin.tsx`)
- `PortalPasswordReset.tsx` ← `portal/src/portal/auth/admin-login.test.tsx` · `portal/src/portal/auth/auth.pages.test.tsx` · `portal/src/portal/auth/password-sign-in.test.tsx` · `portal/src/portal/auth/setup-link.test.tsx`
- `PortalPasswordResetVerify.tsx` ← `portal/src/portal/analytics/entry.test.tsx` · `portal/src/portal/auth/auth.pages.test.tsx`
- `PortalPrivacy.tsx` ← `portal/src/portal/pages/PortalPrivacy.test.tsx`?
- `PortalRoot.tsx` ← `portal/src/portal/analytics/entry.test.tsx` · `portal/src/portal/pages/PortalRoot.loading.test.tsx` · `portal/src/portal/pages/PortalRoot.test.tsx`
- `PortalSetup.tsx` ← `portal/src/lib/whatsapp.botNumber.test.tsx` · `portal/src/portal/auth/auth.pages.test.tsx` · `portal/src/portal/auth/setup-link.test.tsx` · `portal/src/portal/pages/password-visibility.test.tsx`
- `PortalTraining.tsx` ← `portal/src/portal/pages/App.routes.test.tsx` · `portal/src/portal/pages/PortalTraining.certificates.test.tsx` · `portal/src/portal/pages/PortalTraining.editbands.test.tsx` · `portal/src/portal/pages/PortalTraining.nobands.test.tsx` · `portal/src/portal/pages/PortalTrainingV2.route.test.tsx`
- `PortalTrainingPage.tsx` ← `portal/src/portal/newui/training/TrainingCertificates.test.tsx` · `portal/src/portal/newui/training/TrainingCourse.test.tsx` · `portal/src/portal/newui/training/TrainingGrades.test.tsx` · `portal/src/portal/newui/training/TrainingHome.test.tsx` · `portal/src/portal/newui/training/TrainingLevel.test.tsx` · `portal/src/portal/newui/training/TrainingLevelExam.test.tsx` (+6: `python3 kg/kg.py who-reads portal/src/portal/pages/PortalTrainingPage.tsx`)
- `PortalTrainingV2.tsx` ← `portal/src/portal/pages/App.routes.test.tsx` · `portal/src/portal/pages/PortalTrainingV2.deeplink.test.tsx` · `portal/src/portal/pages/PortalTrainingV2.moduleCards.test.tsx` · `portal/src/portal/pages/PortalTrainingV2.numericIds.test.tsx` · `portal/src/portal/pages/PortalTrainingV2.pages.test.tsx` · `portal/src/portal/pages/PortalTrainingV2.quizTick.test.tsx` (+2: `python3 kg/kg.py who-reads portal/src/portal/pages/PortalTrainingV2.tsx`)
- `SchoolAnalytics.tsx` ← `portal/src/portal/pages/Analytics.tabs.test.tsx` · `portal/src/portal/pages/SchoolAnalytics.axes.test.tsx` · `portal/src/portal/pages/SchoolAnalytics.exams.test.tsx` · `portal/src/portal/pages/SchoolAnalytics.history.test.tsx` · `portal/src/portal/pages/SchoolAnalytics.scope.test.tsx` · `portal/src/portal/pages/SchoolAnalytics.sections.test.tsx` (+5: `python3 kg/kg.py who-reads portal/src/portal/pages/SchoolAnalytics.tsx`)
- `SchoolLessons.tsx` ← `portal/src/portal/pages/SchoolLessons.kinds.test.tsx` · `portal/src/portal/pages/SchoolLessons.test.tsx` · `portal/src/portal/pages/observation-bands.pages.test.tsx` · `portal/src/portal/pages/steps-removed.test.tsx`
- `legacyLive.ts` ← `portal/src/portal/pages/legacyLive.test.ts`

## Related (all, generated)
- docs: `docs/reports/bug131-phase2-portal-quiz-ui.md`? · `docs/reports/bug131-phase3-grand-quiz.md`? · `docs/reports/bug131-phase4-media-complete.md`? · `portal/src/components/ui/CLAUDE.md`? · `portal/src/hooks/CLAUDE.md`? · `portal/src/portal/CLAUDE.md`? · `portal/src/portal/components/__testing__/CLAUDE.md`? · `portal/src/portal/components/assessment-jobs/CLAUDE.md`?
