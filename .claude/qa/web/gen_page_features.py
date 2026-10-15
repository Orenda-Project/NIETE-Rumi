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
   ('TC01', 'Teacher app v2: Digital Coaching lists her recent observations', 'teacher', 'teacherV2',
     [(T + '/coaching', r'^Recent DC Observations\s+[1-9]', None, 'Digital Coaching shows "Recent DC Observations" with at least one')]),
   ('TC02', 'Teacher app v2: coach visits (Observations) open', 'teacher', 'teacherV2',
     [(T + '/observations', r'^Observations$', None, 'Observations opens')]),
   ('TC03', 'Classic portal: Coaching opens', 'teacher', 'classic',
     [('/portal/coaching', r'^Coaching$', None, 'Coaching opens')]),
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
   ('CP01', 'Coach app v2: her home greets her and shows today\'s visits', 'coach', 'coachV2',
     [('/portal/coach', r"^Today's visits\s+\d", None, 'her home shows "Today\'s visits"')]),
   ('CP02', 'Coach app v2: Schools & teachers, My schedule and Team schedule open', 'coach', 'coachV2',
     [('/portal/coach/people', r'^Schools & teachers$', None, 'Schools & teachers opens'),
      ('/portal/coach/schedule', r'^My schedule$', None, 'My schedule opens'),
      ('/portal/coach/team', r'^Team schedule$', None, 'Team schedule opens')]),
   ('CP03', 'Coach app v2: Reports open, and Analytics counts her teachers', 'coach', 'coachV2',
     [('/portal/coach/reports', r'^Reports$', None, 'Reports opens'),
      ('/portal/coach/analytics', r'^Teachers\s+[1-9]', None, 'Analytics shows "Teachers" with at least one')]),
   ('CP04', 'Coach app v2: Observe, More and My profile open', 'coach', 'coachV2',
     [('/portal/coach/observe', r'^Observe$', None, 'Observe opens'),
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
  ('PS03', 'Coach app v2: every main page opens healthy', 'coach', 'coachV2',
    [('/portal/coach' + s, ANY, None, None) for s in ['', '/people', '/schedule', '/team', '/reports', '/analytics', '/observe', '/more', '/profile']]),
  ('PS04', 'Leader portal: every main page opens healthy', 'principal', 'classic',
    [('/portal/leader' + s, ANY, None, None) for s in ['', '/teachers', '/observations', '/school-analytics', '/lessons', '/child-test']]),
  ('PS05', 'Signed out: login, password reset, privacy and delete-account open healthy', None, None,
    [(p, ANY, None, None) for p in ['/portal/login', '/portal/reset-password', '/portal/privacy', '/portal/delete-account']]),
])

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
    lines += ["];", "", "module.exports = { feature: %s, spec: 'tests/features/web/%s.feature', scenarios };" % (json.dumps(name), name), ""]
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
    open(os.path.join(root, 'tests/features/web', name + '.feature'), 'w').write("\n".join(g))
    print("wrote", name, len(scen), "scenarios")
