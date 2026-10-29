# newui — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/newui -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `assessment/` | New-UI Assessment screens: make a paper, writing/ready/failed, My assessments → `assessment/CLAUDE.md` |
| `checks/` | Design-rule tests that fail the build when the new UI breaks DESIGN.md → `checks/CLAUDE.md` |
| `coaching/` | New-UI teacher Coaching: record page, lesson view, live moves, send flow → `coaching/CLAUDE.md` |
| `home/` | New-UI teacher Home: date-range 'what you did' tiles and their lists → `home/CLAUDE.md` |
| `lessons/` | New-UI Lesson Plans, grades 1-12, behind one client over two services → `lessons/CLAUDE.md` |
| `training/` | New-UI Training screens: providers, levels, parts, quizzes, exams, certificates → `training/CLAUDE.md` |
| `Answers.tsx` | bd-5rz1v.25: new-UI answer buttons (AnswerChoices) and progress dots for one-question-per-screen quizzes |
| `AudioPlayer.tsx` | bd-5rz1v.26.4: new-UI audio player (play, seek, time) replacing the browser's own audio controls |
| `BottomButton.tsx` | bd-5rz1v.19: new-UI bottom action button, primary/outline/warn/danger tones with pressed-edge look |
| `Chip.tsx` | bd-5rz1v.19: new-UI Chip, flat non-tappable info pill whose colour (done/waiting/error/...) is its meaning |
| `DESIGN.md` | Design rules, tokens and kit contract for every screen behind the portal_new_ui flag; current reference doc |
| `DateRange.tsx` | bd-5rz1v.19: date-range button and bottom sheet used on Home and its lists |
| `FeatureIcon.tsx` | bd-5rz1v.19: per-feature icon and heading tile; the only place a feature colour is drawn |
| `Hero.tsx` | bd-5rz1v.19: status-screen centrepiece (progress ring or big icon, one-two words, chips) |
| `InnerBar.tsx` | bd-5rz1v.19: light heading bar for a page inside a flow: back arrow, feature crumb and title |
| `List.tsx` | bd-5rz1v.19: List and Row kit; rows that go somewhere are links with a chevron, info rows never look tappable |
| `MainHeading.tsx` | bd-5rz1v.19: flat indigo band heading for a feature's main page (Home, Lessons, Assessment, Training, Coaching) |
| `MetricTile.tsx` | bd-5rz1v.19: tappable big-number metric tile and MetricGrid for Home |
| `NewUiNavigation.tsx` | New-UI indigo bottom bar, desktop top bar, avatar and account sheet; rendered by PortalNavigation when flag on |
| `NumberGrid.tsx` | bd-5rz1v.19: four-across big-tile number picker (grade 1-12, class) as an arrow-key radio group |
| `Panel.tsx` | bd-5rz1v.26: content Panel and Fold (collapsible) for feedback, transcripts and coach notes, one short heading |
| `PullUpMenu.tsx` | bd-5rz1v.18: the avatar pull-up menu (name, school, pages, logout) of the new UI |
| `Sheet.tsx` | bd-5rz1v.19: kit bottom sheet over a dimmed page with grab handle and close; centred card on desktop |
| `Stepper.tsx` | bd-5rz1v.13: "- 15 +" two-button number stepper, no typing (Assessment question count) |
| `ToggleList.tsx` | bd-5rz1v.19: big option rows with tick box, single or multi select, indigo when on |
| `accountSheet.ts` | bd-5rz1v.17: tiny shared store for whether the account sheet is open (open/close/isOpen) |
| `answers.test.tsx` | bd-5rz1v.25: AnswerChoices (single, pick-all, pictures) and QuestionDots in the kit |
| `audioPlayer.recording.test.tsx` | bd-5rz1v.26.4: playing a report's audio never touches a lesson that is being recorded |
| `audioPlayer.test.tsx` | bd-5rz1v.26.4: kit AudioPlayer look, play/pause, seeking by tap and drag |
| `buttons.test.tsx` | bd-5rz1v.19: BottomButton tones, BottomActions and MetricTile behaviour; every primary is the same green pill |
| `copy.ts` | bd-5rz1v.19: every word the new UI shows in one object (labels not sentences), also the Urdu translation source |
| `daterange.test.tsx` | bd-5rz1v.19: Home date range presets and the range kept in the address (keys GET /api/portal/progress takes) |
| `headings.test.tsx` | bd-5rz1v.19: MainHeading indigo band and InnerBar light heading per DESIGN.md |
| `index.ts` | bd-5rz1v.19: barrel export of the new UI kit (MainHeading, InnerBar, List, Sheet, ...) |
| `list.test.tsx` | bd-5rz1v.19: List/Row/Chip rule, info rows are not buttons, rows that go somewhere show a chevron |
| `panel.test.tsx` | bd-5rz1v.26: Panel and Fold sections for report content, one short heading, long ones fold |
| `pickers.test.tsx` | bd-5rz1v.19: NumberGrid, ToggleList and Hero; picked is indigo, finished is green |
| `pullup.test.tsx` | bd-5rz1v.18: pull-up menu handle on the bar and its panel contents |
| `pullup.ts` | bd-5rz1v.18: shared by PullUpMenu and NewUiNavigation: initials() and useSwipe up/down |
| `range.ts` | bd-5rz1v.19: date-range preset/custom values and keys sent to GET /api/portal/progress (Pakistan-time server side) |
| `recording.test.tsx` | bd-5rz1v.26: RECORDING error-red token and Chip tone=recording |
| `sheet.test.tsx` | bd-5rz1v.19: kit Sheet is role=dialog data-state=open so Android Back closes it before leaving the page |
| `stepper.test.tsx` | bd-5rz1v.13: Stepper (- 15 +) bounds and ToggleChips for the Assessment page |
| `styles.ts` | bd-5rz1v.19: shared class strings (FOCUS ring, TAP 56px min height) used by every kit component |
| `toggleList.disabled.test.tsx` | bd-5rz1v.25: disabled ToggleList (My grades inside the 48-hour window) dims options and ignores taps |
| `tokens.test.ts` | bd-5rz1v.12: new-UI colours live only in tokens.ts and the Tailwind theme is built from them |
| `tokens.ts` | bd-5rz1v.12: new-UI design tokens (Direction B indigo menu bar), the single source of its colours |
| `useGuardedLogout.ts` | bd-5rz1v.26.4: useGuardedLogout hook logs out at once, or asks Stop recording? first while a lesson records |

## Who reads this (all, generated)
- `Answers.tsx` ← imported by `portal/src/portal/newui/index.ts:22:6f341dc0` · `portal/src/portal/newui/training/TrainingLevelExam.tsx:10:1c84490e` · `portal/src/portal/newui/training/TrainingModuleExam.tsx:10:1c84490e` · `portal/src/portal/newui/training/TrainingQuiz.tsx:9:1c84490e`
- `AudioPlayer.tsx` ← imported by `portal/src/portal/coach/disagreements/DisagreementCard.tsx:5:f321e628` · `portal/src/portal/coach/disagreements/cardParts.tsx:5:f321e628` · `portal/src/portal/coach/insights/player/FullRecordingLink.tsx:3:20cffd47` · `portal/src/portal/coach/insights/player/MomentPlayer.tsx:2:20cffd47` (+6: `python3 kg/kg.py who-reads AudioPlayer.tsx`)
- `BottomButton.tsx` ← imported by `portal/src/portal/newui/DateRange.tsx:10:762e6528` · `portal/src/portal/newui/assessment/AssessmentHome.tsx:11:0f99a93f` · `portal/src/portal/newui/assessment/AssessmentRequest.tsx:9:0f99a93f` · `portal/src/portal/newui/assessment/MyAssessments.tsx:10:59e71aa7` (+22: `python3 kg/kg.py who-reads BottomButton.tsx`)
- `Chip.tsx` ← imported by `portal/src/portal/newui/AudioPlayer.tsx:5:86119bd6` · `portal/src/portal/newui/DateRange.tsx:6:86119bd6` · `portal/src/portal/newui/PullUpMenu.tsx:8:86119bd6` · `portal/src/portal/newui/assessment/AssessmentHome.tsx:10:a162e92f` (+27: `python3 kg/kg.py who-reads Chip.tsx`)
- `DateRange.tsx` ← imported by `portal/src/portal/newui/home/HomeList.tsx:16:0fa9d7e1` · `portal/src/portal/newui/home/NewHome.tsx:9:0fa9d7e1` · `portal/src/portal/newui/index.ts:12:f1463268`
- `FeatureIcon.tsx` ← imported by `portal/src/portal/newui/InnerBar.tsx:5:696d3324` · `portal/src/portal/newui/MainHeading.tsx:3:d3605f90` · `portal/src/portal/newui/MetricTile.tsx:5:696d3324` · `portal/src/portal/newui/index.ts:24:0fb11deb`
- `Hero.tsx` ← imported by `portal/src/portal/newui/assessment/AssessmentHome.tsx:16:99a5414b` · `portal/src/portal/newui/assessment/AssessmentRequest.tsx:10:99a5414b` · `portal/src/portal/newui/assessment/MyAssessments.tsx:12:99a5414b` · `portal/src/portal/newui/coaching/CoachingMain.tsx:20:99a5414b` (+17: `python3 kg/kg.py who-reads Hero.tsx`)
- `InnerBar.tsx` ← imported by `portal/src/portal/newui/assessment/AssessmentRequest.tsx:7:d609d90f` · `portal/src/portal/newui/assessment/MyAssessments.tsx:7:d609d90f` · `portal/src/portal/newui/coaching/LessonView.tsx:16:d609d90f` · `portal/src/portal/newui/coaching/RecordPage.tsx:15:d609d90f` (+4: `python3 kg/kg.py who-reads InnerBar.tsx`)
- `List.tsx` ← imported by `portal/src/portal/newui/DateRange.tsx:7:1933df46` · `portal/src/portal/newui/assessment/AssessmentHome.tsx:9:d09d6f60` · `portal/src/portal/newui/assessment/MyAssessments.tsx:8:2ac4a8bc` · `portal/src/portal/newui/coaching/CoachingMain.tsx:16:d09d6f60` (+21: `python3 kg/kg.py who-reads List.tsx`)
- `MainHeading.tsx` ← imported by `portal/src/portal/newui/assessment/AssessmentHome.tsx:8:019586ec` · `portal/src/portal/newui/coaching/CoachingMain.tsx:15:019586ec` · `portal/src/portal/newui/home/NewHome.tsx:6:019586ec` · `portal/src/portal/newui/index.ts:5:e630e8f8` (+2: `python3 kg/kg.py who-reads MainHeading.tsx`)
- `MetricTile.tsx` ← imported by `portal/src/portal/newui/home/NewHome.tsx:7:b0a2a93a` · `portal/src/portal/newui/index.ts:10:756c1615`
- `NewUiNavigation.tsx` ← imported by `portal/src/portal/components/PortalNavigation.tsx:11:a2273bad` · `portal/src/portal/newui/assessment/AssessmentHome.tsx:17:afb50f0b` · `portal/src/portal/newui/coaching/CoachingMain.tsx:21:afb50f0b` · `portal/src/portal/newui/home/NewHome.tsx:11:afb50f0b` (+2: `python3 kg/kg.py who-reads NewUiNavigation.tsx`)
- `NumberGrid.tsx` ← imported by `portal/src/portal/newui/assessment/AssessmentHome.tsx:13:a68209cc` · `portal/src/portal/newui/coaching/LibraryStep.tsx:8:a68209cc` · `portal/src/portal/newui/index.ts:17:a293b5f0` · `portal/src/portal/newui/lessons/NewLessonPlans.tsx:11:a68209cc`
- `Panel.tsx` ← imported by `portal/src/portal/coach/disagreements/cardParts.tsx:6:49da4d3f` · `portal/src/portal/newui/coaching/LessonView.tsx:21:0391e378` · `portal/src/portal/newui/index.ts:21:a392baf9`
- `PullUpMenu.tsx` ← imported by `portal/src/portal/newui/NewUiNavigation.tsx:12:09ac88cd`
- `Sheet.tsx` ← imported by `portal/src/portal/newui/DateRange.tsx:8:0778e6f1` · `portal/src/portal/newui/assessment/AssessmentHome.tsx:12:91fb57cf` · `portal/src/portal/newui/assessment/MyAssessments.tsx:11:91fb57cf` · `portal/src/portal/newui/coaching/CoachingMain.tsx:19:91fb57cf` (+11: `python3 kg/kg.py who-reads Sheet.tsx`)
- `Stepper.tsx` ← imported by `portal/src/portal/newui/assessment/AssessmentHome.tsx:15:40376082` · `portal/src/portal/newui/index.ts:18:ee8e1d10`
- `ToggleList.tsx` ← imported by `portal/src/portal/newui/DateRange.tsx:9:6b19a953` · `portal/src/portal/newui/assessment/AssessmentHome.tsx:14:e21c1e09` · `portal/src/portal/newui/index.ts:19:d781104a` · `portal/src/portal/newui/training/TrainingGrades.tsx:7:e21c1e09`
- `accountSheet.ts` ← imported by `portal/src/portal/newui/NewUiNavigation.tsx:11:40b79c14`
- `copy.ts` ← imported by `portal/src/portal/teacher/training/copy.ts:14:20bad875` · `portal/src/portal/teacher/ui/copy.ts:15:1956a8ba` · `portal/src/portal/teacher/ui/range.ts:1:1956a8ba` · `portal/src/portal/newui/AudioPlayer.tsx:6:551753cf` (+39: `python3 kg/kg.py who-reads copy.ts`)
- `index.ts` ← imported by `portal/src/portal/analytics/Section.tsx:3:825a7794` · `portal/src/portal/analytics/views/shared.tsx:2:2b81d13f` · `portal/src/portal/auth/AnalyticsLogin.tsx:7:3ff42490` · `portal/src/portal/auth/RegisterOnWhatsApp.tsx:3:3ff42490` (+5: `python3 kg/kg.py who-reads index.ts`)
- `pullup.ts` ← imported by `portal/src/portal/newui/NewUiNavigation.tsx:13:fdd5e998` · `portal/src/portal/newui/PullUpMenu.tsx:11:fdd5e998`
- `range.ts` ← imported by `portal/src/portal/analytics/SchoolsAnalytics.tsx:9:8c76e8b8` · `portal/src/portal/analytics/format.ts:1:8c76e8b8` · `portal/src/portal/analytics/view.ts:2:9172d16e` · `portal/src/portal/coach/reports/CoachReportsAll.tsx:5:e791135d` (+25: `python3 kg/kg.py who-reads range.ts`)
- `styles.ts` ← imported by `portal/src/portal/auth/AuthField.tsx:5:035a7706` · `portal/src/portal/auth/AuthFrame.tsx:10:f2981aaa` · `portal/src/portal/pages/PortalLogin.tsx:11:035a7706` · `portal/src/portal/teacher/ui/styles.ts:10:c6c792d6` (+19: `python3 kg/kg.py who-reads styles.ts`)
- `tokens.ts` ← imported by `portal/tailwind.config.ts:3:82374bb6` · `portal/src/portal/newui/checks/rules.ts:5:7a159af1`

## Tests (all, generated)
- `Answers.tsx` ← `portal/src/portal/newui/answers.test.tsx` · `portal/src/portal/newui/checks/tap.test.tsx`
- `AudioPlayer.tsx` ← `portal/src/portal/newui/audioPlayer.recording.test.tsx` · `portal/src/portal/newui/audioPlayer.test.tsx` · `portal/src/portal/newui/checks/tap.test.tsx`
- `BottomButton.tsx` ← `portal/src/portal/components/PortalLayout.newUi.test.tsx` · `portal/src/portal/newui/buttons.test.tsx` · `portal/src/portal/newui/checks/style.test.tsx` · `portal/src/portal/newui/checks/tap.test.tsx` · `portal/src/portal/newui/coaching/RecordingBar.newUi.test.tsx` · `portal/src/portal/newui/recording.test.tsx`
- `Chip.tsx` ← `portal/src/portal/newui/buttons.test.tsx` · `portal/src/portal/newui/checks/tap.test.tsx` · `portal/src/portal/newui/list.test.tsx` · `portal/src/portal/newui/pickers.test.tsx` · `portal/src/portal/newui/recording.test.tsx` · `portal/src/portal/newui/stepper.test.tsx`
- `DateRange.tsx` ← `portal/src/portal/newui/checks/tap.test.tsx` · `portal/src/portal/newui/daterange.test.tsx`
- `FeatureIcon.tsx` ← `portal/src/portal/newui/headings.test.tsx`
- `Hero.tsx` ← `portal/src/portal/newui/checks/tap.test.tsx` · `portal/src/portal/newui/pickers.test.tsx`
- `InnerBar.tsx` ← `portal/src/lib/urduLatin.test.tsx` · `portal/src/portal/newui/checks/tap.test.tsx` · `portal/src/portal/newui/headings.test.tsx`
- `List.tsx` ← `portal/src/lib/urduLatin.test.tsx` · `portal/src/portal/newui/checks/tap.test.tsx` · `portal/src/portal/newui/list.test.tsx` · `portal/src/portal/newui/recording.test.tsx`
- `MainHeading.tsx` ← `portal/src/portal/newui/checks/tap.test.tsx` · `portal/src/portal/newui/headings.test.tsx`
- `MetricTile.tsx` ← `portal/src/portal/newui/buttons.test.tsx` · `portal/src/portal/newui/checks/tap.test.tsx`
- `NewUiNavigation.tsx` ← `portal/src/portal/newui/home/homeNav.test.tsx` · `portal/src/portal/newui/pullup.test.tsx`
- `NumberGrid.tsx` ← `portal/src/portal/newui/checks/tap.test.tsx` · `portal/src/portal/newui/pickers.test.tsx`
- `Panel.tsx` ← `portal/src/portal/newui/panel.test.tsx`
- `Sheet.tsx` ← `portal/src/portal/newui/checks/tap.test.tsx` · `portal/src/portal/newui/sheet.test.tsx`
- `Stepper.tsx` ← `portal/src/portal/newui/checks/tap.test.tsx` · `portal/src/portal/newui/stepper.test.tsx`
- `ToggleList.tsx` ← `portal/src/portal/newui/checks/tap.test.tsx` · `portal/src/portal/newui/pickers.test.tsx` · `portal/src/portal/newui/toggleList.disabled.test.tsx`
- `accountSheet.ts` ← `portal/src/portal/newui/home/NewHome.test.tsx` · `portal/src/portal/newui/home/homeNav.test.tsx` · `portal/src/portal/newui/pullup.test.tsx`
- `copy.ts` ← `portal/src/portal/newui/assessment/AssessmentRequest.test.tsx` · `portal/src/portal/newui/assessment/assessmentApi.test.ts` · `portal/src/portal/newui/checks/copy.test.ts` · `portal/src/portal/newui/home/HomeList.test.tsx` · `portal/src/portal/teacher/coaching/picker.ur.test.tsx`
- `index.ts` ← `portal/src/portal/auth/auth.skeleton.test.tsx`
- `pullup.ts` ← `portal/src/portal/newui/pullup.test.tsx`?
- `range.ts` ← `portal/src/portal/newui/checks/tap.test.tsx` · `portal/src/portal/newui/daterange.test.tsx` · `portal/src/portal/teacher/ui/DateRangeBar.test.tsx`
- `styles.ts` ← `portal/src/portal/newui/headings.test.tsx`
- `tokens.ts` ← `portal/src/portal/newui/pickers.test.tsx` · `portal/src/portal/newui/recording.test.tsx` · `portal/src/portal/newui/tokens.test.ts` · `portal/src/portal/teacher/home/look/LookCard.test.tsx`
- `useGuardedLogout.ts` ← `portal/src/portal/newui/coaching/LogoutWhileRecording.test.tsx`

## Related (all, generated)
- docs: `dashboard/lib/CLAUDE.md`? · `portal/CLAUDE.md`? · `portal/README.md`? · `portal/src/components/ui/CLAUDE.md`? · `portal/src/portal/CLAUDE.md`? · `portal/src/portal/newui/DESIGN.md`? · `portal/src/portal/newui/coaching/CLAUDE.md`? · `portal/src/portal/newui/lessons/CLAUDE.md`?
