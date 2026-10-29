Feature: School leader (principal) portal
  # Web lane (bd-hnhlgn.8): `npm run e2e:web -- leader-portal`. Covers: pages/Leader*.tsx, SchoolAnalytics.tsx, SchoolLessons.tsx.
  # Runs on the local stack with the demo school network (password Demo2026). Each page must be HEALTHY: it settles
  # where expected (not bounced to /portal/login), throws no page error, gets no 5xx from the API, shows no error
  # screen, and renders its own heading/content.

  @LP01
  Scenario: Classic portal: the principal's home greets him by name
    Given the teacher app v2 and the coach app v2 are off
    And demo principal 03000000902 is signed in
    When she opens /portal/leader
    Then his home greets him: "Assalam-o-alaikum, Demo Principal …"

  @LP02
  Scenario: Classic portal: Teachers and Observations open
    Given the teacher app v2 and the coach app v2 are off
    And demo principal 03000000902 is signed in
    When she opens /portal/leader/teachers
    Then Teachers opens
    When she opens /portal/leader/observations
    Then Observations opens

  @LP03
  Scenario: Classic portal: School Analytics and Observed lessons open; /portal/leader/attendance lands on School Analytics
    Given the teacher app v2 and the coach app v2 are off
    And demo principal 03000000902 is signed in
    When she opens /portal/leader/school-analytics
    Then School Analytics opens
    When she opens /portal/leader/lessons
    Then Observed lessons opens
    When she opens /portal/leader/attendance
    Then /portal/leader/attendance settles on School Analytics

  @LP04
  Scenario: Classic portal: the child test page opens (Urdu heading)
    Given the teacher app v2 and the coach app v2 are off
    And demo principal 03000000902 is signed in
    When she opens /portal/leader/child-test
    Then the child test page opens: "بچوں کا ٹیسٹ"

  @LP05
  Scenario: Learning assessment: the school search matches a school's EMIS and sector, and each row shows them
    Given the coach app v2 is on and Learning assessment is on for the signed-in coach, with every grade on
    When they open /portal/leader/assess
    Then each school row shows its sector and EMIS under the name, when the school has them
    When they type an EMIS number into "Find a school"
    Then only that school stays in the list and the count reads "1 of <total>"

  @LP06
  Scenario: Learning assessment: End test is a tap and a question, and an ended child shows Restart test (sa_end_test_restart)
    Given the coach app v2 is on and sa_end_test_restart is on for the signed-in coach
    When a child's test is running and the coach taps "End test (coach)", then "End test"
    Then the child's row reads "Stopped" with a "Restart test" button and a note says to tap it to begin again
    And in RDF manual with sa_end_section on, an "End this section" button sits beside it

  # ── Round 7b · C · the results dashboard: mode, date and coach filters; every skip and stop by type and coach ──

  @LP06 @config-gated
  Scenario: Results dashboard: a coach-led / auto filter applies across the whole dashboard (sa_dash_filters)
    Given the live results dashboard is on and sa_dash_filters is on for the signed-in user
    When they open /portal/leader/assess/dashboard
    Then filters read "Coach-led and auto", "Coach-led (RDF manual)" and "Auto (RDF auto)"
    When they pick "Coach-led (RDF manual)"
    Then the totals, the sub-region table, the task cards and the skips-and-stops view count only RDF manual sessions
    And a line reads "Showing <n> of <total> sessions"

  @LP07 @config-gated
  Scenario: Results dashboard: filter by date (Pakistan days) and by coach, combined with the mode
    Given the live results dashboard is on and sa_dash_filters is on, and the user is a results admin
    When they set "From" and "To" dates
    Then only sessions started on those days in Pakistan time are counted
    When they pick a coach under "Coach"
    Then only that coach's sessions are counted, and the mode filter still applies on top
    And a plain coach sees no coach picker, only their own sessions

  @LP08 @config-gated
  Scenario: Results dashboard: every skip and stop by type and by coach
    Given the live results dashboard is on and sa_dash_filters is on
    Then "Skips and stops" shows a count for Back, End section, End test, Restart, Silence repeat and "Moved on: part not finished"
    And an earlier "Under 20% move-on" event is still listed, marked as the earlier rule, and not counted
    And a table lists each coach with their sessions, each type, the total and the number per session, the most first
    And each skip or stop is listed newest first with its time, school, grade, mode, type and subtask (with its language, when it has one), never a child's name
    And in Urdu the school and coach names stay whole and in place inside the line
    And a test ended before its first task still counts in the stops view, not in the results
    And every filter above applies to this view too

  @LP10 @config-gated
  Scenario: Every words-per-minute number is correct words per minute, labelled CWPM (sa_cwpm)
    Given sa_cwpm is on for the signed-in user
    When they open the results dashboard, a session's Results, or its review
    Then every words-per-minute number reads "CWPM": the dashboard tile and column, the passage card and its rule, the familiar-words and passage rows on Results, and a words task's app score on the review
    And the rule and Results' "How scoring works" give the formula: correct words × 60 ÷ the seconds the child read (60 at most)
    And letters and maths keep "per minute"
    And with sa_cwpm off every label is as before

  @LP11 @config-gated
  Scenario: Results dashboard: children from the random draw against children added by the coach
    Given the live results dashboard is on and sa_dash_filters is on
    Then "Children: from the random draw or added" shows how many tested children came from the draw and how many were added with "Add a child", with the share added
    And a table lists each coach with draw, added and % added, the coach who added the most first
    And the mode, date and coach filters apply to it

  @LP09 @config-gated @negative
  Scenario: Results dashboard without sa_dash_filters is unchanged
    Given sa_dash_filters is off
    Then the dashboard shows no mode, date or coach filter and no "Skips and stops"
    And the sessions read answers exactly as before (no mode, coach or stops fields)


  # ── Round 8 · the test starts fast and runs without internet (sa_r8_fast_start, sa_r8_offline_first, sa_r8_offline_prep) ──

  @LP20 @config-gated
  Scenario: Learning assessment: Start opens the test within 1.5 s even when the server is slow (sa_r8_fast_start)
    Given sa_r8_fast_start is on for the signed-in coach and the server takes longer than 1.5 s to answer Present
    When the coach taps "Start" for a present child
    Then the child's test opens within about 1.5 s
    And when the server answers later its session id is kept on the phone; when the network failed, Present waits in the phone's queue and is sent later
    And with the switch off, Start waits for the server's answer as before

  @LP21 @config-gated
  Scenario: Learning assessment: the child's whole test is on the phone before it starts (sa_r8_offline_first)
    Given sa_r8_offline_first is on for the signed-in coach
    When the coach opens a school's list
    Then the list's battery (items, pictures and every clip, in the page's language) starts downloading in the background
    When the coach taps "Start" before it has finished
    Then "Getting Jugnu ready on this phone" shows with "Downloading… <done> of <total>" until it is all on the phone, then the test opens
    And once the test has started it needs no network: "The voice is not ready yet" can no longer appear in the middle of a test

  @LP21 @negative @config-gated
  Scenario: Learning assessment: no internet and the test is not on the phone yet (sa_r8_offline_first)
    Given sa_r8_offline_first is on and the phone has no internet and has never downloaded this grade's test
    When the coach taps "Start"
    Then "Jugnu's voice is not on this phone yet. Connect to the internet, then tap Try again." shows with "Try again" and "Back"
    And the test does not open and Present is not sent

  @LP22 @config-gated
  Scenario: Learning assessment: Get ready for offline before the school (sa_r8_offline_prep)
    Given sa_r8_offline_prep is on for the signed-in coach and the phone is online
    When they open /portal/leader/assess
    Then a "Get ready for offline" card lists their schools with today's visits ticked
    When they tap "Get ready"
    Then each ticked school's list is read and kept on the phone, and both languages' tests for those grades download with progress
    And the card reads "Ready for offline ✓ <n> schools · <MB> MB · <time>"
    And a card made on an earlier day says to get ready again today

  @LP23 @config-gated
  Scenario: Learning assessment: at a school with no signal after getting ready (sa_r8_offline_prep)
    Given the coach got ready for offline today and the phone now has no internet
    When they open the Learning assessment
    Then "No internet: these are the schools saved on this phone." shows above the saved schools
    When they open a prepared school
    Then the saved list shows with the no-internet note, and a child can be marked present and started

  @LP24 @config-gated
  Scenario: Learning assessment: the page opens again after a reload at a school with no signal (sa_r8_offline_prep)
    Given the coach got ready for offline today (the page's own offline copy was kept) and the phone now has no internet
    When the phone reloads the Learning assessment tab
    Then the page opens signed in, from what the phone kept, with the saved schools
    And a prepared school's list opens and a child can be started
    And with sa_r8_offline_prep off, the page's offline copy is removed from the phone the next time the page reads its switches online

  @LP25 @config-gated
  Scenario: Learning assessment: Get ready for offline with every grade on (sa_r8_offline_prep, sa_all_grades)
    Given sa_r8_offline_prep and sa_all_grades are on for the signed-in coach
    When they tick a school on the "Get ready for offline" card
    Then grade buttons 1 to 5 show under it, the school's observed grade already ticked
    When they tap "Get ready" with no grade ticked for a ticked school
    Then "<school>: tick the grades you will test there." shows and nothing downloads
    When they tick grades 2 and 4 and tap "Get ready"
    Then the grade 2 and grade 4 lists for that school are kept, and only those grades' tests (Urdu and English) download

  @LP26 @config-gated
  Scenario: Learning assessment: Start does not wait when the child's part is already on the phone (sa_r8_offline_first)
    Given sa_r8_offline_first is on and the child's part is already on the phone (Get ready, or an earlier child)
    When the coach taps "Start"
    Then the test opens with nothing downloaded first
    And when the part is not there yet, the list's background download pauses until the part is on the phone

  @LP27 @config-gated
  Scenario: Learning assessment: after Get ready, a child starts at a school with no signal (sa_r8_offline_first, sa_r8_offline_prep)
    Given the coach got ready for offline (school, grade ticked) and the phone now has no internet
    When they open the school, pick the grade, mark a child present and tap "Start" (with or without reloading the page first)
    Then the test opens with nothing downloaded, and Jugnu speaks from the phone
    And "The voice is not ready yet" never shows

  @LP28 @config-gated
  Scenario: Learning assessment: Start is never slower than without the switch (sa_r8_offline_first)
    Given sa_r8_offline_first is on, the phone is online and the child's part is not on the phone yet
    When the coach taps "Start"
    Then the test opens as it does without the switch, and the part downloads behind it (the next child starts from the phone)
    And with no signal and the part not on the phone, the coach sees "Jugnu's voice is not on this phone yet…" before the test
