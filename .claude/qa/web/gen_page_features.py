# Generates the per-area web drivers (.claude/qa/web/features/<f>.cjs) and their specs (tests/features/web/<f>.feature)
# from ONE table, so a driver and its spec cannot disagree. Edit the table here and re-run:
#   python3 .claude/qa/web/gen_page_features.py .
import os, sys, json
root = sys.argv[1]
T = '/portal/teacher'

# feature -> (title, intro comment, [scenario]); scenario = (id, title, role, mode, [(path, heading_regex, settle_or_None, gherkin_then)])
F = {
 'teacher-home': ('Teacher home, analytics, more and profile', 'portal/src/portal/teacher/TeacherPage.tsx + pages/, PortalDashboard.tsx', [
   ('TH01', 'Teacher app v2: her home greets her by name', 'teacher', 'teacherV2',
     [(T, r'^Salaam, Ayesha', None, 'her home greets her: "Salaam, Ayesha …"')]),
   ('TH02', 'Teacher app v2: More, My profile and Analytics open', 'teacher', 'teacherV2',
     [(T + '/more', r'^More$', None, 'More opens'),
      (T + '/profile', r'^My profile$', None, 'My profile opens'),
      (T + '/analytics', r'^Analytics$', None, 'Analytics opens')]),
   ('TH03', 'Classic portal: her dashboard greets her by name', 'teacher', 'classic',
     [('/portal/dashboard', r'^Salaam, Ayesha', None, 'her dashboard greets her: "Salaam, Ayesha"')]),
 ]),
 'teacher-lessons': ('Teacher lesson plans', 'portal/src/portal/teacher/lessons/**, PortalCurriculum.tsx, PortalLessonPlans.tsx', [
   ('TL01', 'Teacher app v2: Lesson Plans lists her recent lesson plans', 'teacher', 'teacherV2',
     [(T + '/lessons', r'^Recent Lesson Plans\s+[1-9]', None, 'Lesson Plans shows "Recent Lesson Plans" with at least one')]),
   ('TL02', 'Classic portal: the curriculum opens, and the old /portal/lesson-plans link lands there', 'teacher', 'classic',
     [('/portal/curriculum', r'^Lesson Plans$', None, 'the curriculum page "Lesson Plans" opens'),
      ('/portal/lesson-plans', r'^Lesson Plans$', '/portal/curriculum', '/portal/lesson-plans settles on /portal/curriculum')]),
 ]),
 'teacher-coaching': ('Teacher digital coaching and coach visits', 'portal/src/portal/teacher/coaching/**, teacher/observations/**, PortalCoaching*.tsx', [
   # bd-bmc9a0.4 (ICT IAB row 30, 2026-10-28): Recent DC Observations moved from the main page into Summary.
   ('TC01', 'Teacher app v2: Digital Coaching lists her recent observations', 'teacher', 'teacherV2',
     [(T + '/coaching', r'^Digital Coaching$', None, 'Digital Coaching opens on Start DC observation and Summary'),
      (T + '/coaching/all', r'^Recent DC Observations', None, 'Summary shows "Recent DC Observations"')]),
   ('TC02', 'Teacher app v2: coach visits (Observations) open', 'teacher', 'teacherV2',
     [(T + '/observations', r'^Observations$', None, 'Observations opens')]),
   ('TC03', 'Classic portal: Coaching opens', 'teacher', 'classic',
     [('/portal/coaching', r'^Coaching$', None, 'Coaching opens')]),
   # bd-fgj73x.1 — Start DC observation's one screen: Grade and subject, then the recording, plan, photos, Submit.
   ('TC04', 'Teacher app v2: Start DC observation opens its one screen', 'teacher', 'teacherV2',
     [(T + '/coaching/new', r'^Start DC observation$', None, 'the one screen opens on "Start DC observation"')]),
   # bd-c5reix — the landing of the WhatsApp link for a kept classroom recording: the one screen, which reads her
   # waiting recordings (GET /coaching-upload/pending) on the way in. Healthy = no 5xx from that read either.
   ('TC05', 'Teacher app v2: the link for a recording kept from WhatsApp opens the one screen', 'teacher', 'teacherV2',
     [(T + '/coaching/new?recording=whatsapp', r'^Start DC observation$', None, 'the one screen opens on "Start DC observation"')]),
 ]),
 'teacher-training': ('Teacher training', 'portal/src/portal/teacher/training/**, PortalTraining*.tsx, PortalVideo*.tsx', [
   ('TT01', 'Teacher app v2: Training lists her courses', 'teacher', 'teacherV2',
     [(T + '/training', r'^Courses\s+[1-9]', None, 'Training shows "Courses" with at least one')]),
   ('TT02', 'Classic portal: Training opens', 'teacher', 'classic',
     [('/portal/training', r'^Training$', None, 'Training opens')]),
 ]),
 'teacher-classes': ('Teacher classes and attendance', 'portal/src/portal/teacher/classes/**, teacher/attendance/**, PortalClasses.tsx', [
   ('TK01', 'Teacher app v2: My Classes lists her class, and Attendance opens', 'teacher', 'teacherV2',
     [(T + '/classes', r'^Classes\s+[1-9]', None, 'My Classes shows "Classes" with at least one'),
      (T + '/attendance', r'^Attendance$', None, 'Attendance opens')]),
   ('TK02', 'Classic portal: My classes opens, and /portal/attendance lands on her analytics', 'teacher', 'classic',
     [('/portal/classes', r'^My classes$', None, 'My classes opens'),
      ('/portal/attendance', r'^Attendance', '/portal/coaching/analytics', '/portal/attendance settles on /portal/coaching/analytics, with Attendance')]),
 ]),
 'teacher-assessment': ('Teacher assessment', 'portal/src/portal/teacher/assessment/**, PortalAssessment.tsx, ClassicAssessment.tsx, newui/assessment/**', [
   ('TA01', 'Teacher app v2: Assessment opens', 'teacher', 'teacherV2',
     [(T + '/assessment', r'^Assessment$', None, 'Assessment opens')]),
   ('TA02', 'Classic portal: Assessment opens', 'teacher', 'classic',
     [('/portal/assessment', r'^Assessment$', None, 'Assessment opens')]),
 ]),
 'coach-portal': ('Coach app', 'portal/src/portal/coach/**', [
   # bd-s42dye.2 (PR #2780): a coach on the coach app v2 sees only the Training Library and her account; every other
   # coach page sends her to /portal/coach/training before it mounts (portal/src/portal/coach/training/appReady.ts,
   # COACH_APP_READY = ["training"]). When a feature is added back to COACH_APP_READY, its row here goes back to "opens".
   ('CP01', 'Coach app v2: her home sends her to the Training Library', 'coach', 'coachV2',
     [('/portal/coach', r'^Training Library', '/portal/coach/training', '/portal/coach settles on /portal/coach/training, with "Training Library"')]),
   ('CP02', 'Coach app v2: Schools & teachers, My schedule and Team schedule send her to the Training Library', 'coach', 'coachV2',
     [('/portal/coach/people', r'^Training Library', '/portal/coach/training', '/portal/coach/people settles on /portal/coach/training'),
      ('/portal/coach/schedule', r'^Training Library', '/portal/coach/training', '/portal/coach/schedule settles on /portal/coach/training'),
      ('/portal/coach/team', r'^Training Library', '/portal/coach/training', '/portal/coach/team settles on /portal/coach/training')]),
   ('CP03', 'Coach app v2: Reports and Analytics send her to the Training Library', 'coach', 'coachV2',
     [('/portal/coach/reports', r'^Training Library', '/portal/coach/training', '/portal/coach/reports settles on /portal/coach/training'),
      ('/portal/coach/analytics', r'^Training Library', '/portal/coach/training', '/portal/coach/analytics settles on /portal/coach/training')]),
   ('CP04', 'Coach app v2: Observe sends her to the Training Library; More and My profile open', 'coach', 'coachV2',
     [('/portal/coach/observe', r'^Training Library', '/portal/coach/training', '/portal/coach/observe settles on /portal/coach/training'),
      ('/portal/coach/more', r'^More$', None, 'More opens'),
      ('/portal/coach/profile', r'^My profile$', None, 'My profile opens')]),
 ]),
 'leader-portal': ('School leader (principal) portal', 'pages/Leader*.tsx, SchoolAnalytics.tsx, SchoolLessons.tsx', [
   ('LP01', 'Classic portal: the principal\'s home greets him by name', 'principal', 'classic',
     [('/portal/leader', r'^Assalam-o-alaikum, Demo Principal', None, 'his home greets him: "Assalam-o-alaikum, Demo Principal …"')]),
   ('LP02', 'Classic portal: Teachers and Observations open', 'principal', 'classic',
     [('/portal/leader/teachers', r'^Teachers$', None, 'Teachers opens'),
      ('/portal/leader/observations', r'^Observations$', None, 'Observations opens')]),
   ('LP03', 'Classic portal: School Analytics and Observed lessons open; /portal/leader/attendance lands on School Analytics', 'principal', 'classic',
     [('/portal/leader/school-analytics', r'^School Analytics$', None, 'School Analytics opens'),
      ('/portal/leader/lessons', r'^Observed lessons$', None, 'Observed lessons opens'),
      ('/portal/leader/attendance', r'^School Analytics$', '/portal/leader/school-analytics', '/portal/leader/attendance settles on School Analytics')]),
   ('LP04', 'Classic portal: the child test page opens (Urdu heading)', 'principal', 'classic',
     [('/portal/leader/child-test', r'بچوں کا ٹیسٹ', None, 'the child test page opens: "بچوں کا ٹیسٹ"')]),
 ]),
 'portal-account': ('Account and the public legal pages', 'PortalAccount.tsx, PortalPrivacy.tsx, PortalDeleteAccount.tsx', [
   ('PA01', 'Classic portal: My account opens', 'teacher', 'classic',
     [('/portal/account', r'^My account$', None, 'My account opens')]),
   ('PA02', 'Signed out: the privacy policy and the delete-account page open (Google Play needs both)', None, None,
     [('/portal/privacy', r'^NIETE Privacy Policy$', None, 'the privacy policy opens'),
      ('/portal/delete-account', r'^Delete your NIETE account$', None, 'the delete-account page opens')]),
 ]),
}

ANY = r'\S'
F['portal-smoke'] = ('Portal-wide smoke — every main page, every role', 'the web lane\'s SAFE subset: selected for shared plumbing (App.tsx, api.ts, the UI kit) and any portal file no area claims', [
  ('PS01', 'Teacher app v2: every main page opens healthy', 'teacher', 'teacherV2',
    [(T + s, ANY, None, None) for s in ['', '/lessons', '/coaching', '/observations', '/training', '/assessment', '/attendance', '/classes', '/analytics', '/more', '/profile']]),
  ('PS02', 'Classic portal (teacher): every main page opens healthy', 'teacher', 'classic',
    [(p, ANY, st, None) for p, st in [('/portal/dashboard', None), ('/portal/curriculum', None), ('/portal/coaching', None), ('/portal/training', None),
                                       ('/portal/classes', None), ('/portal/assessment', None), ('/portal/account', None)]]),
  # bd-s42dye.2 (PR #2780): the coach app v2 shows only the Training Library and her account; the other coach pages
  # settle on /portal/coach/training (appReady.ts COACH_APP_READY). Each still has to land healthy.
  ('PS03', 'Coach app v2: the Training Library and her account open healthy, every other coach page lands on the Training Library', 'coach', 'coachV2',
    [('/portal/coach/training', ANY, None, None)]
    + [('/portal/coach' + s, ANY, '/portal/coach/training', None) for s in ['', '/people', '/schedule', '/team', '/reports', '/analytics', '/observe']]
    + [('/portal/coach' + s, ANY, None, None) for s in ['/more', '/profile']]),
  ('PS04', 'Leader portal: every main page opens healthy', 'principal', 'classic',
    [('/portal/leader' + s, ANY, None, None) for s in ['', '/teachers', '/observations', '/school-analytics', '/lessons', '/child-test']]),
  ('PS05', 'Signed out: login, password reset, privacy and delete-account open healthy', None, None,
    [(p, ANY, None, None) for p in ['/portal/login', '/portal/reset-password', '/portal/privacy', '/portal/delete-account']]),
])

# Hand-written flows a page row cannot express, joined onto a generated feature: the driver requires the module, the
# spec carries its Gherkin. Modules live in flows/, not features/, because web-runner loads every features/<name>.cjs.
EXTRA = {
  # bd-yef5iq.6 + bd-gbf8ix: an I-SAPS module page carries the partner's required reading, matched on the vendor KEY
  # (the vendor's display name was renamed and every page lost its list). Reads /training/modules as the demo teacher;
  # BLOCKED when the run's database has no I-SAPS course she can open.
  'teacher-training': ('../flows/teacher-training-readings.cjs', [
    "  # TT04 (bd-yef5iq.6 + bd-gbf8ix, 26 Oct 2026): I-SAPS module pages lost their reading list when the vendor was",
    "  # renamed (it was matched by name); it is now matched on the vendor key, and Level 2 has its own list.",
    "  @TT04",
    "  Scenario: An I-SAPS module page shows the partner's required reading, under the renamed programme",
    "    Given the teacher app v2 is on and the coach app v2 is off",
    "    And demo teacher 03000000911 is signed in and can open an I-SAPS Module 1 course",
    "    When she opens that course's module page",
    "    Then it lists the partner's required reading, each with a link",
    "",
  ]),
  # The Home's new look (portal_teacher_home_look, only ever on with portal_teacher_home_card): portal/src/portal/teacher/
  # home/look/** and pages/Home.tsx. Today's Home answer is fixed per scenario; the switches are real (see the flow).
  'teacher-home': ('../flows/teacher-home-look.cjs', [
    "  @TH04",
    "  Scenario: Teacher app v2, new Home look: on a card day the band, the lesson card, the progress strip and All features come in order",
    "    Given the teacher app v2 is on and the coach app v2 is off",
    "    And the Home card is on, and the new Home look is on for demo teacher 03000000911 only",
    "    And the demo teacher is named \"Ayesha Testwala\"",
    "    And today's Home answer is a lesson card on \"Fractions\" and a coach score of 29/38",
    "    And demo teacher 03000000911 is signed in on a 412 px phone",
    "    When the teacher opens /portal/teacher",
    "    Then the navy band greets \"Salaam, Ayesha Testwala!\" on its own row under the date and school (the two-row band)",
    "    And the band's language pill reads \"اردو\"",
    "    And the lesson card shows \"Quiz from your last lesson:\" with the topic \"Fractions\" on its own line",
    "    And the card has one primary button \"Quiz this\" and \"Open the plan\" under it",
    "    And the progress strip shows \"Your progress\" and the chip \"Coach 29/38\"",
    "    And \"All features\" labels the 8 feature tiles, and \"What would you like to do today?\" is not shown",
    "    And the band, the card, the strip, \"All features\" and the tiles come in that order down the page",
    "    And no page error or 5xx happened",
    "",
    "  @TH05",
    "  Scenario: Teacher app v2, new Home look: on a no-card day the two score chips come first, then the question and the features",
    "    Given the teacher app v2 is on and the coach app v2 is off",
    "    And the Home card is on, and the new Home look is on for demo teacher 03000000911 only",
    "    And today's Home answer has no card, a coach score of 29/38 and an observation score of 31/40",
    "    And demo teacher 03000000911 is signed in",
    "    When the teacher opens /portal/teacher",
    "    Then no card is drawn and \"All features\" is not shown",
    "    And the progress strip shows both chips, \"29/38\" and \"31/40\", without the \"Your progress\" label",
    "    And the heading \"What would you like to do today?\" comes after the strip and before the 8 feature tiles",
    "    And no page error or 5xx happened",
    "",
    "  @TH06",
    "  Scenario: Teacher app v2, new Home look: the language pill switches the Home to Urdu and the \"!\" stays inside the name",
    "    Given the teacher app v2 is on and the coach app v2 is off",
    "    And the Home card is on, and the new Home look is on for demo teacher 03000000911 only",
    "    And the demo teacher is named \"Ayesha Testwala\"",
    "    And today's Home answer has no card",
    "    And demo teacher 03000000911 is signed in with English as their language",
    "    When the teacher opens /portal/teacher and taps the \"اردو\" pill in the band",
    "    Then the band greets \"السلام علیکم، Ayesha Testwala!\" with the \"!\" inside the name's isolate, right after \"Testwala\"",
    "    And the pill now reads \"English\"",
    "    And the heading reads \"آج کیا کریں؟\"",
    "    And the teacher's saved language is Urdu",
    "    When the teacher taps the \"English\" pill",
    "    Then the band greets \"Salaam, …\" again",
    "    And no page error or 5xx happened",
    "",
    "  @TH07",
    "  Scenario: Teacher app v2, new Home look: on a 320 px phone the band is one row and drops the date line",
    "    Given the teacher app v2 is on and the coach app v2 is off",
    "    And the Home card is on, and the new Home look is on for demo teacher 03000000911 only",
    "    And the demo teacher is named \"Ayesha Testwala\"",
    "    And today's Home answer is a lesson card on \"Fractions\"",
    "    And demo teacher 03000000911 is signed in on a 320 px phone",
    "    When the teacher opens /portal/teacher",
    "    Then the band is the one-row band: the mark, \"Salaam, Ayesha Testwala!\" and the language pill on one row",
    "    And the date and school line is not drawn",
    "    And the page does not scroll sideways, and the lesson card is still shown",
    "    And no page error or 5xx happened",
    "",
    "  @TH08",
    "  Scenario: Teacher app v2: with the new Home look off, or on without the Home card, the Home is the one before",
    "    Given the teacher app v2 is on and the coach app v2 is off",
    "    And the Home card is on and the new Home look is off",
    "    And the demo teacher is named \"Ayesha Testwala\"",
    "    And demo teacher 03000000911 is signed in",
    "    When the teacher opens /portal/teacher",
    "    Then the Home greets \"Salaam, Ayesha Testwala!\" in today's greeting band, with no new band",
    "    And the 8 feature tiles are shown",
    "    Given the Home card is off and the new Home look is on for demo teacher 03000000911 only",
    "    When the teacher signs in again and opens /portal/teacher",
    "    Then there is no new band, because the look only rides with the Home card",
    "    And the 8 feature tiles are shown",
    "    And no page error or 5xx happened",
    ""]),
  # Remove class on Class detail (portal/src/portal/teacher/classes/ClassDetailPage.tsx): the class removed is one the
  # scenario adds for her first, so the seeded classes the page scenarios need are never touched (see the flow).
  'teacher-classes': ('../flows/teacher-classes-remove.cjs', [
    "  @TK03",
    "  Scenario: Teacher app v2: Remove class asks first; Keep leaves it, Remove takes it off My Classes",
    "    Given the teacher app v2 is on and the coach app v2 is off",
    "    And demo teacher 03000000911 is signed in",
    "    And she has added a class she was not already on",
    "    When she opens that class and taps \"Remove class\"",
    "    Then a tray asks first, with \"Keep\" and \"Remove\"",
    "    When she taps \"Keep\"",
    "    Then the tray closes and the class is still on her list",
    "    When she taps \"Remove class\" again and then \"Remove\"",
    "    Then she is back on My Classes with one class fewer, and that class is not listed",
    "    And no page error or 5xx happened",
    ""]),
  'coach-portal': ('../flows/coach-disagreement.cjs', [
    "  @CP05",
    "  Scenario: Coach app v2: a teacher's disagreement opens as the card, and The teacher was right flags the report",
    "    Given the teacher app v2 is off and the coach app v2 is on",
    "    And the coach disagreement card is on",
    "    And demo teacher 03000000911 disagrees with her latest DC report because of her score",
    "    And demo coach 03000000901 is signed in",
    "    When she opens /portal/coach/disagreements",
    "    Then the teacher's request is on the To do list",
    "    When she opens it",
    "    Then the score reason is one line ending \"Details in B.\"",
    "    And the card shows \"Is this a pattern?\" and the coaching suggestion",
    "    When she taps \"The teacher was right\"",
    "    Then it says the report was sent to the DC team for review",
    "    And the request is flagged for the DC team",
    "    And no page error or 5xx happened",
    "",
    "  @CP06",
    "  Scenario: Coach app v2: a disagreement added to her next visit shows at the top of her disagreements list and opens its card",
    "    Given the teacher app v2 is off and the coach app v2 is on",
    "    And the coach disagreement card is on",
    "    And demo teacher 03000000911 disagrees with her latest DC report because of her score",
    "    And the coach added it to her next visit",
    "    And demo coach 03000000901 is signed in",
    "    When she opens /portal/coach/disagreements",
    "    Then For your next visit lists the teacher's request",
    "    When she opens it",
    "    Then the teacher's card opens",
    "    And no page error or 5xx happened",
    ""]),
}

# The School card (portal_coach_school_card): a second hand-written coach-portal flow, then the hand-written @draft
# Lesson Plans scenario that has no driver code (kept verbatim). EXTRA may hold one (driver, lines) pair or a list of
# them; a pair whose driver is None adds spec lines only.
EXTRA['coach-portal'] = [EXTRA['coach-portal'], ('../flows/coach-school-card.cjs', [
    "  # The School card, with its switch (portal_coach_school_card) on and off. The driver waits for /config to agree",
    "  # with the switch (the dashboard caches it 30 s) and puts it back OFF after every scenario.",
    "  @CP07",
    "  Scenario: Coach app v2 with the School card on: her home is the slim Coach Home, the menu is Home, Lesson Plans and More, and the hidden pages land on Home",
    "    Given the teacher app v2 is off and the coach app v2 is on",
    "    And the School card is on",
    "    And demo coach 03000000901 is signed in",
    "    When she opens /portal/coach",
    "    Then it is the slim Coach Home with exactly two tiles, Training Library and My schools",
    "    And the menu is Home, Lesson Plans and More",
    "    When she opens Schedule, My schedule, Team schedule, New visit, Observe, Reports, Analytics or Insights",
    "    Then each settles on /portal/coach",
    "    And no page error or 5xx happened",
    "",
    "  @CP08",
    "  Scenario: Coach app v2 with the School card on: a school opens as its School card; This month, a feature's grid and a teacher's page open from it",
    "    Given the teacher app v2 is off and the coach app v2 is on",
    "    And the School card is on",
    "    And demo coach 03000000901 is signed in",
    "    When she opens /portal/coach/school/DEMO-001",
    "    Then it shows the period chips Today, This week and This month, the four feature tiles and the Manage group",
    "    And there is no Share with principal and no Schedule a visit",
    "    When she taps \"This month\"",
    "    Then the Lesson plans tile shows one bar per week, from \"Wk 1\"",
    "    When she taps the Lesson plans tile",
    "    Then \"Lesson plans by teacher\" opens for This month, with a row per teacher and the School row",
    "    When she taps a teacher's row",
    "    Then her Teacher page opens with her tiles",
    "    When she taps \"Her coaching reports\"",
    "    Then Her coaching reports opens",
    "    And no page error or 5xx happened",
    "",
    "  @CP09",
    "  Scenario: Coach app v2 with the School card on: a teacher's DC report opens in the coach's view, with no transcript",
    "    Given the teacher app v2 is off and the coach app v2 is on",
    "    And the School card is on",
    "    And a teacher at one of demo coach 03000000901's schools has a completed DC report",
    "    And demo coach 03000000901 is signed in",
    "    When she opens that report at /portal/coach/session/<its id>",
    "    Then \"Report\" opens with the overall AI score and the \"Coach view\" chip",
    "    And it shows no transcript and no \"Focus here\"",
    "    And no page error or 5xx happened",
    "",
    "  @CP10",
    "  Scenario: Coach app v2 with the School card off: her home is the Training Library, a school opens as before, and the School card's own pages do not open",
    "    Given the teacher app v2 is off and the coach app v2 is on",
    "    And the School card is off",
    "    And demo coach 03000000901 is signed in",
    "    When she opens /portal/coach",
    "    Then /portal/coach settles on /portal/coach/training",
    "    When she opens a School card DC report address, /portal/coach/session/<id>",
    "    Then it settles on /portal/coach/training",
    "    When she opens /portal/coach/school/DEMO-001",
    "    Then it is today's school page, with \"Visits · last 3 months\" and no School card",
    "    And the menu has no Home",
    "    And no page error or 5xx happened",
    "",
]), (None, [
    "  # bd-4joiqz — the coach app's Lesson Plans tab: the teacher Lesson Plans pages, read as a leader. Written by hand; the",
    "  # web driver has no code for it yet (@draft). The full journey is teacher-lessons LDR01.",
    "  @LDR07 @draft",
    "  Scenario: Coach app v2: Lesson Plans is in their menu and opens the Lesson Plans pages; their other pages still land on the Training Library",
    "    Given the teacher app v2 is off and the coach app v2 is on",
    "    And demo coach 03000000901 is signed in",
    "    When they open /portal/coach/training",
    "    Then the menu is Training Library, Lesson Plans and More",
    "    When they open /portal/teacher/lessons/new",
    "    Then it opens healthy and stays on /portal/teacher/lessons/new",
    "    When they open /portal/teacher/coaching",
    "    Then /portal/teacher/coaching settles on /portal/coach/training",
    "    When they open /portal/teacher/lessons/all",
    "    Then /portal/teacher/lessons/all does not open for them",
    "",
])]

ROLE_TXT = {'teacher': 'demo teacher 03000000911', 'coach': 'demo coach 03000000901', 'principal': 'demo principal 03000000902'}
MODE_TXT = {'classic': 'the teacher app v2 and the coach app v2 are off', 'teacherV2': 'the teacher app v2 is on and the coach app v2 is off',
            'coachV2': 'the teacher app v2 is off and the coach app v2 is on'}

for name, (title, where, scen) in F.items():
    # driver
    lines = ["// %s — web-lane driver for tests/features/web/%s.feature (bd-hnhlgn.8). Generated by .claude/qa/web/gen_page_features.py with the" % (name, name),
             "// spec, so the two name the same scenarios; e2e-web.test.sh W10 enforces it. Covers: %s." % where,
             "// Every page is checked by lib.visit: it settles where expected (not bounced to login), no uncaught page error,",
             "// no 5xx from the API, no error screen, and its own heading/content.",
             "'use strict';", "const { pagesScenario } = require('../lib.cjs');", "", "const scenarios = ["]
    for sid, stitle, role, mode, pages in scen:
        ps = ", ".join("{ path: %s, heading: /%s/%s }" % (json.dumps(p), h.replace('/', '\\/'), (", settle: %s" % json.dumps(st)) if st else '')
                       for p, h, st, _ in pages)
        lines.append("  pagesScenario(%s, %s, %s, %s, [%s])," % (json.dumps(sid), json.dumps(stitle), json.dumps(role), json.dumps(mode), ps))
    lines.append("];")
    extras = EXTRA.get(name)
    extras = extras if isinstance(extras, list) else ([extras] if extras else [])
    for drv, _ in extras:
        if drv: lines.append("scenarios.push(...require(%s));" % json.dumps(drv))
    lines += ["", "module.exports = { feature: %s, spec: 'tests/features/web/%s.feature', scenarios };" % (json.dumps(name), name), ""]
    open(os.path.join(root, '.claude/qa/web/features', name + '.cjs'), 'w').write("\n".join(lines))
    # spec
    g = ["Feature: %s" % title,
         "  # Web lane (bd-hnhlgn.8): `npm run e2e:web -- %s`. Covers: %s." % (name, where),
         "  # Runs on the local stack with the demo school network (password Demo2026). Each page must be HEALTHY: it settles",
         "  # where expected (not bounced to /portal/login), throws no page error, gets no 5xx from the API, shows no error",
         "  # screen, and renders its own heading/content.", ""]
    for sid, stitle, role, mode, pages in scen:
        g.append("  @%s" % sid)
        g.append("  Scenario: %s" % stitle)
        if mode: g.append("    Given %s" % MODE_TXT[mode])
        g.append("    And %s is signed in" % ROLE_TXT[role] if role else "    Given nobody is signed in")
        for p, h, st, then in pages:
            g.append("    When she opens %s" % p)
            g.append("    Then %s" % (then or ("it opens healthy" + (" (settles on %s)" % st if st else ""))))
        g.append("")
    for _, extra_lines in extras: g += extra_lines
    open(os.path.join(root, 'tests/features/web', name + '.feature'), 'w').write("\n".join(g))
    print("wrote", name, len(scen) + sum(1 for d, _ in extras if d), "scenario groups")
