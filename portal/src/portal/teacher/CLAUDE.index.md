# teacher — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/teacher -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `analytics/` | Teacher Analytics page (More > Analytics) and the principal's My school view → `analytics/CLAUDE.md` |
| `assessment/` | Teacher Assessment: New paper steps, My papers, paper page, editor, FDE board pattern → `assessment/CLAUDE.md` |
| `attendance/` | Teacher Attendance: class selector, roll call, month view, register download → `attendance/CLAUDE.md` |
| `classes/` | Teacher My Classes: list, class detail with roster, Add a class → `classes/CLAUDE.md` |
| `coaching/` | Teacher Digital Coaching: hub, one-screen observation, report, All DC observations → `coaching/CLAUDE.md` |
| `home/` | Teacher Home card, score chips, Quizzes tile and Home data hook → `home/CLAUDE.md` |
| `icons/` | Teacher feature art, menu glyphs, shared icon motion, NIETE lattice → `icons/CLAUDE.md` |
| `lessons/` | Teacher Lesson Plans: new plan steps, chapters, lists, viewer, All lesson plans → `lessons/CLAUDE.md` |
| `notices/` | Shell notices: Being made strip, ready banner, Home Ready for you, evening reminder card → `notices/CLAUDE.md` |
| `observations/` | Teacher Observations: next coach visit, visits in progress, visit reports → `observations/CLAUDE.md` |
| `pages/` | Teacher frame pages: Home, More and My profile → `pages/CLAUDE.md` |
| `remind/` | Words for the Evening reminder card → `remind/CLAUDE.md` |
| `share/` | Client for sharing a paper or plan to WhatsApp from the teacher app → `share/CLAUDE.md` |
| `training/` | Teacher Training v2: hub, providers, levels, courses, parts, quizzes, exams, certificates → `training/CLAUDE.md` |
| `ui/` | Teacher UI kit: shared components, styles, bidi and copy defaults (see README.md) → `ui/CLAUDE.md` |
| `LanguageTabs.tsx` | English | اردو toggle for the teacher app; saves via useLanguageSwitch, drawn on Home top and More's Language row |
| `TeacherGate.language.test.tsx` | Pins that TeacherGate reads GET /me/language for v2 teachers and turns the page to it, writing nothing (bd-fmf24g.13) |
| `TeacherGate.test.tsx` | Pins TeacherGate: flagged teacher sees the v2 page; no flag or a coach goes to today's Home (bd-fmf24g.1) |
| `TeacherGate.tsx` | Route guard wrapping every /portal/teacher page: only portal_teacher_v2 teachers pass, others redirect to today's Home |
| `TeacherNavigation.coach.test.tsx` | Pins the role-aware bottom menu: teacher items vs coach items, icons stay still (bd-4404s7.1) |
| `TeacherNavigation.test.tsx` | Pins TeacherNavigation under the portal_teacher_home_look flag: OFF is byte-identical, ON gives the green pill item |
| `TeacherNavigation.tsx` | Teacher v2 menu: white bottom bar on phone, top bar on desktop; teacher or coach items from menu.ts |
| `TeacherPage.dock.test.tsx` | Pins that a page's bottom dock offset adds --notice-h so it clears the notices strip (bd-fmf24g.15) |
| `TeacherPage.test.tsx` | Pins TeacherPage header: optional feature tile, wrapping titles, inner-page back target (bd-fmf24g.1) |
| `TeacherPage.tsx` | Shared page frame for every teacher v2 page: title/chips or back+crumb header, PortalLayout shell and bottom menu |
| `copy.ts` | English+Urdu words for the teacher v2 frame, menu, Home, More and My profile (TEACHER_COPY, COPY_ENTRY) |
| `copyRegistry.guard.test.ts` | Guard: every teacher v2 feature copy.ts exports COPY_ENTRY and registers, so none escape the Urdu checks (bd-fmf24g.13) |
| `copyRegistry.test.ts` | Asserts every registered copy module has complete Urdu and each Urdu value is a short label (language-protocol 6.3) |
| `copyRegistry.ts` | Registry of every bilingual copy module (teacher globbed, coach and auth listed by name) feeding Urdu checks and review |
| `format.test.ts` | Tests shortDayLabel from format.ts: English short date, Urdu day/month words with Western digits, Pakistan-zone day |
| `format.ts` | Display helpers for teacher v2: fullName, initials, formatPhone, cleanSchool, todayLabel, shortDayLabel, dayLabel |
| `frame.ur.test.tsx` | Renders menu, page frame, Home and More in Urdu and asserts no English frame word is left (bd-fmf24g.13) |
| `i18n.test.tsx` | Tests the teacher v2 language layer in i18n.ts: bilingual(), untranslated(), copyIn and allowed-same words |
| `i18n.ts` | Teacher v2 language layer (flat en/ur): bilingual() with a shape-typed Urdu, langOf, copyIn, untranslated() checker |
| `menu.ts` | Defines the teacher menu (five items) and the coach menu (Home, Schedule, Observe, Schools, More), current-item rules |
| `paths.ts` | Teacher v2 feature path map: v2 main path and legacy page per feature, featurePath/legacyPath/resolveTeacherPath |
| `routes.test.ts` | Tests the teacher routes registry: all paths under /portal/teacher, no duplicates, unregistered features link to legacy |
| `routes.tsx` | Teacher route registry: import.meta.glob gathers ./*/routes.tsx into TEACHER_ROUTES, which App.tsx wraps in TeacherGate |
| `urdu-review.export.test.ts` | Opt-in test (URDU_REVIEW_OUT) writing the Urdu review file, one row per word from the copy registry |
| `useLanguageSwitch.ts` | Hook behind More's Language row: PUT /me/language through the one writer, then flips the page language |
| `useTeacherV2.test.ts` | Tests useTeacherV2: null while /config loads, true only for a real teacherV2:true, fail-closed on error |
| `useTeacherV2.ts` | Hook reading /config for portal_teacher_v2; null while loading, fail-closed false on error; used by TeacherGate |
| `vocabulary.guard.test.ts` | Guard walking every registered copy module in both languages for words the ICT ontology bans (bd-fmf24g.17) |

## Who reads this (all, generated)
- `LanguageTabs.tsx` ← imported by `portal/src/portal/teacher/pages/Home.tsx:14:d9a32dd8` · `portal/src/portal/teacher/pages/More.tsx:9:77f00fbb`
- `TeacherGate.tsx` ← imported by `portal/src/App.tsx:17:6f895c61`
- `TeacherNavigation.tsx` ← imported by `portal/src/portal/components/PortalNavigation.tsx:18:a52c7cf1` · `portal/scripts/urdu-fit/harness.tsx:19:84fc24ea`
- `TeacherPage.tsx` ← imported by `portal/src/portal/coach/card/FeatureGridPage.tsx:2:e8f36f5c` · `portal/src/portal/coach/card/SchoolCardPage.tsx:4:e8f36f5c` · `portal/src/portal/coach/card/SessionReportPage.tsx:3:e8f36f5c` · `portal/src/portal/coach/card/SlimHome.tsx:3:a56a2cc9` (+46: `python3 kg/kg.py who-reads TeacherPage.tsx`)
- `copy.ts` ← imported by `portal/src/portal/coach/card/SchoolCardPage.tsx:5:480b64df` · `portal/src/portal/coach/card/SlimHome.tsx:6:480b64df` · `portal/src/portal/coach/insights/InsightsNav.tsx:3:480b64df` · `portal/src/portal/coach/insights/components/MoreCoachip.tsx:4:f2959319` (+17: `python3 kg/kg.py who-reads copy.ts`)
- `copyRegistry.ts` ← imported by `portal/src/portal/auth/copy.ts:14:8ca14af0` · `portal/src/portal/coach/card/copy.ts:15:9dac0e94` · `portal/src/portal/coach/home/copy.ts:9:9dac0e94` · `portal/src/portal/coach/people/copy.ts:12:f5a4f97b` (+16: `python3 kg/kg.py who-reads copyRegistry.ts`)
- `format.ts` ← imported by `portal/src/portal/coach/card/SlimHome.tsx:8:ced768ec` · `portal/src/portal/coach/insights/components/MoreCoachip.tsx:6:32d5f42f` · `portal/src/portal/coach/pages/CoachHome.tsx:9:ced768ec` · `portal/src/portal/coach/profile/CoachMore.tsx:9:d90e624a` (+11: `python3 kg/kg.py who-reads format.ts`)
- `i18n.ts` ← imported by `portal/src/portal/analytics/SchoolsAnalytics.tsx:8:0f66c8aa` · `portal/src/portal/auth/AnalyticsLogin.tsx:9:b07c182e` · `portal/src/portal/auth/AuthFrame.tsx:9:1fbf8dd8` · `portal/src/portal/auth/RegisterOnWhatsApp.tsx:4:b07c182e` (+239: `python3 kg/kg.py who-reads i18n.ts`)
- `menu.ts` ← imported by `portal/src/portal/coach/insights/components/MoreCoachip.tsx:10:7065fb46` · `portal/src/portal/teacher/TeacherNavigation.tsx:12:26f86604`
- `paths.ts` ← imported by `portal/src/portal/teacher/analytics/paths.ts:1:db647feb` · `portal/src/portal/teacher/assessment/paths.ts:1:db647feb` · `portal/src/portal/teacher/attendance/AttendanceHub.tsx:6:5d8ee5f4` · `portal/src/portal/teacher/attendance/paths.ts:1:db647feb` (+9: `python3 kg/kg.py who-reads paths.ts`)
- `routes.tsx` ← imported by `portal/src/App.tsx:16:a9c609d6` · `portal/src/portal/pages/LeaderHome.tsx:12:e4d9854a` · `portal/src/portal/pages/PortalDashboard.tsx:13:58f50aef` · `portal/src/portal/teacher/TeacherNavigation.tsx:7:3a445105` (+30: `python3 kg/kg.py who-reads routes.tsx`)
- `useLanguageSwitch.ts` ← imported by `portal/src/portal/coach/disagreements/appBar.tsx:4:87f3b69e` · `portal/src/portal/coachip-ui/LangToggle.tsx:2:148dc2ab` · `portal/src/portal/teacher/LanguageTabs.tsx:4:87e17e1a` · `portal/src/portal/teacher/home/look/HomeBand.tsx:10:f6376933` (+2: `python3 kg/kg.py who-reads useLanguageSwitch.ts`)
- `useTeacherV2.ts` ← imported by `portal/src/portal/components/PortalLayout.tsx:10:6de5c830` · `portal/src/portal/components/PortalNavigation.tsx:17:6de5c830` · `portal/src/portal/pages/LeaderHome.tsx:11:4ab9fbdc` · `portal/src/portal/pages/PortalDashboard.tsx:12:6de5c830` (+2: `python3 kg/kg.py who-reads useTeacherV2.ts`)

## Tests (all, generated)
- `TeacherGate.tsx` ← `portal/src/portal/fln/hooks.test.tsx` · `portal/src/portal/teacher/TeacherGate.language.test.tsx` · `portal/src/portal/teacher/TeacherGate.test.tsx`
- `TeacherNavigation.tsx` ← `portal/src/portal/coach/people/schoolsReady.test.tsx` · `portal/src/portal/coach/training/nav.test.tsx` · `portal/src/portal/teacher/TeacherNavigation.coach.test.tsx` · `portal/src/portal/teacher/TeacherNavigation.test.tsx` · `portal/src/portal/teacher/frame.ur.test.tsx`
- `TeacherPage.tsx` ← `portal/src/lib/urduLatin.test.tsx` · `portal/src/portal/teacher/TeacherNavigation.coach.test.tsx` · `portal/src/portal/teacher/TeacherPage.dock.test.tsx` · `portal/src/portal/teacher/TeacherPage.test.tsx` · `portal/src/portal/teacher/coaching/backFlow.test.tsx` · `portal/src/portal/teacher/frame.ur.test.tsx`
- `copy.ts` ← `portal/src/portal/coach/insights/tests/r6b_more.test.tsx` · `portal/src/portal/coach/people/schoolsReady.test.tsx` · `portal/src/portal/coach/training/nav.test.tsx` · `portal/src/portal/teacher/TeacherNavigation.coach.test.tsx` · `portal/src/portal/teacher/frame.ur.test.tsx` · `portal/src/portal/teacher/home/look/FeatureRows.test.tsx` (+1: `python3 kg/kg.py who-reads portal/src/portal/teacher/copy.ts`)
- `copyRegistry.ts` ← `portal/src/portal/auth/auth.source.test.ts` · `portal/src/portal/coach/card/copy.test.ts` · `portal/src/portal/teacher/copyRegistry.test.ts` · `portal/src/portal/teacher/home/copy.test.ts` · `portal/src/portal/teacher/ui/copy.ur.test.tsx` · `portal/src/portal/teacher/urdu-review.export.test.ts` (+1: `python3 kg/kg.py who-reads portal/src/portal/teacher/copyRegistry.ts`)
- `format.ts` ← `portal/src/portal/teacher/format.test.ts` · `portal/src/portal/teacher/frame.ur.test.tsx`
- `i18n.ts` ← `portal/src/portal/auth/auth.source.test.ts` · `portal/src/portal/coach/card/copy.test.ts` · `portal/src/portal/coach/disagreements/api.test.ts` · `portal/src/portal/coach/disagreements/suggestion.test.ts` · `portal/src/portal/coach/insights/tests/harness.tsx` · `portal/src/portal/coach/observe/copy.test.ts` (+11: `python3 kg/kg.py who-reads portal/src/portal/teacher/i18n.ts`)
- `menu.ts` ← `portal/src/portal/coach/training/appReady.schoolCard.test.ts` · `portal/src/portal/teacher/TeacherNavigation.coach.test.tsx`
- `paths.ts` ← `portal/src/portal/teacher/home/QuizTile.test.tsx` · `portal/src/portal/teacher/home/look/LookHome.test.tsx` · `portal/src/portal/teacher/lessons/LessonPages.test.tsx` · `portal/src/portal/teacher/pages/Home.on.test.tsx`
- `routes.tsx` ← `portal/src/portal/components/PortalNavigation.teacherV2.test.tsx` · `portal/src/portal/fln/tests/golden.flagOff.test.tsx` · `portal/src/portal/fln/tests/hiddenBand.page.test.tsx` · `portal/src/portal/pages/LeaderHome.coachV2.test.tsx` · `portal/src/portal/teacher/analytics/AnalyticsPage.test.tsx` · `portal/src/portal/teacher/analytics/SchoolView.test.tsx` (+30: `python3 kg/kg.py who-reads portal/src/portal/teacher/routes.tsx`)
- `useLanguageSwitch.ts` ← `portal/src/portal/teacher/home/look/LanguagePill.test.tsx`
- `useTeacherV2.ts` ← `portal/src/portal/components/PortalLayout.loading.test.tsx` · `portal/src/portal/components/PortalLayout.notices.test.tsx` · `portal/src/portal/components/PortalNavigation.teacherV2.flagOff.test.tsx` · `portal/src/portal/components/PortalNavigation.teacherV2.test.tsx` · `portal/src/portal/fln/hooks.test.tsx` · `portal/src/portal/hooks/firstPage.test.tsx` (+8: `python3 kg/kg.py who-reads portal/src/portal/teacher/useTeacherV2.ts`)

## Related (all, generated)
- docs: `portal/src/portal/CLAUDE.md`? · `portal/src/portal/teacher/pages/CLAUDE.md`? · `portal/src/portal/teacher/ui/README.md`?
