Feature: FDE board-pattern paper for Grade 5
  # Web lane: `npm run e2e:web -- fde-board-pattern` runs the @FBnn scenarios (driver .claude/qa/web/features/fde-board-pattern.cjs).
  # Covers: portal/src/portal/teacher/assessment/**, dashboard/routes/portal.routes.js (/assessment/*),
  # dashboard/services/assessment.service.js, dashboard/lib/assessment-rate-limit.js, bot/shared/routes/internal-api.routes.js
  # (/assessment/options, /assessment/create), bot/shared/services/assessment/**.
  # Scenarios tagged @sandbox need a real model call and a real paper: the local stack cannot make one, so they are run on
  # the sandbox tier by .claude/qa/agents/niete-fde-board-pattern-agent.md (headless Android WebView, EN + UR).
  # Switches: assessment_fde_pattern_enabled (the pattern) and assessment_rate_limit_enabled (the soft limit), both in
  # app_settings, both off when absent.

  # ── Positive / happy path ─────────────────────────────────────────────────────────────────────────────────────────

  @sandbox @real-paper
  Scenario: A Grade 5 Maths teacher gets a board-pattern paper and a marking scheme in one tap after the subject
    Given the board-pattern switch is on
    And a registered teacher is on the Assessment hub
    When they open FDE pattern papers, tap Maths, and tap Make my paper on Check and make
    Then the paper has sections A, B and C with FDE's time and marks lines, Q2 says "Attempt any eight questions. All questions carry equal marks." with "(8×5=40)", and Total Marks is 100
    And a marking scheme PDF opens with "Teacher: before the exam", lists every question's marks and part marks, and ends with a 40-row class record on its own page
    And the ready screen names "Question paper" and "Marking scheme" with their page counts

  @sandbox @real-paper
  Scenario: The ready screen says what the teacher adds and the page it goes on
    Given the board-pattern switch is on
    When a Grade 5 Social Studies teacher makes a board-pattern paper
    Then under "Question paper" and "Marking scheme" the ready screen says "You add · the map of Pakistan · p." with the question paper's page

  @FB01
  Scenario: The hub offers FDE pattern papers when the switch is on
    Given the board-pattern switch is on
    And a registered teacher is signed in
    When they open the Assessment hub
    Then the hub shows the FDE pattern papers card
    And the options for Grade 5 Maths name the FDE board pattern

  @FB02
  Scenario: Check and make says what is inside before the paper is made
    Given the board-pattern switch is on
    When a Grade 5 Science teacher reaches Check and make and opens Inside
    Then the tray shows 3 sections, 100 marks, 3 hrs, the choice line and "You add · the diagram to label"
    And the screen has at most 40 words above Make my paper

  # ── Business rules / valid variations ─────────────────────────────────────────────────────────────────────────────

  @FB09
  Scenario: The New paper dock stays clear of the ready banner
    Given the board-pattern switch is on
    And a paper the teacher asked for earlier has just become ready
    When a Grade 5 Science teacher reaches Check and make on a phone 360 or 390 wide while the "Paper ready" banner shows
    Then Make my paper sits wholly above the banner, not one pixel under it
    And Make my paper can be tapped without closing the banner first

  @FB03
  Scenario: A teacher on plain New paper takes the side door
    Given the board-pattern switch is on
    When a Grade 5 English teacher picks the FDE board pattern card on Chapters or pages and taps Next
    Then they land on Check and make at "Step 2 of 2" with the FDE syllabus chosen

  @sandbox @real-paper
  Scenario: A chapter-scoped FDE paper keeps the board shape and says what it covers
    Given the board-pattern switch is on
    When a Grade 5 English teacher customises the syllabus to units 3 and 4 and makes the paper
    Then Inside says "Covers Units 3–4; every section set from these units"
    And the paper has the same sections and marks as the full-syllabus paper

  @sandbox @real-paper @urdu
  Scenario: An Urdu board-pattern paper is right-to-left with Urdu digits and no item from lessons 1 to 3
    Given the board-pattern switch is on
    When a Grade 5 Urdu teacher makes a board-pattern paper
    Then the paper reads right to left, its numbers are Urdu digits, its sections are حصہ الف, حصہ ب and حصہ ج, and no item is set on lessons 1, 2 or 3

  @sandbox @real-paper
  Scenario: Removing a question from a choice group keeps the choice honest
    Given a ready board-pattern Maths paper
    When the teacher removes one Q2 question and makes version 2
    Then the editor said "Q2 will then say: any eight of eleven" and version 2 prints "Attempt any eight of the following eleven questions" with "(8×5=40)" and Total Marks 100
    And version 2 comes as two files, "Grade5_Maths_FDE_v2.pdf" and its marking scheme, and the scheme's box names the version 2 paper and its page count

  @sandbox @real-paper
  Scenario: Removing more questions than the choice allows lowers the attempt count and the total
    Given a ready board-pattern Maths paper
    When the teacher removes five Q2 questions and makes version 2
    Then version 2 prints "(7×5=35)" for Q2, Section B is worth 35 marks and Total Marks is 95

  # ── Negative ──────────────────────────────────────────────────────────────────────────────────────────────────────

  @FB04
  Scenario: With the switch off, nothing new appears and a stale request is refused clearly
    Given the board-pattern switch is off
    When a Grade 5 teacher opens the Assessment hub
    Then there is no FDE pattern papers card and no card on Chapters or pages
    And a request that still carries the pattern is refused with "Board-pattern papers are off right now"

  @FB05
  Scenario: A Grade 4 request cannot carry the pattern
    Given the board-pattern switch is on
    When a request for Grade 4 Maths carries the pattern
    Then it is refused and no paper is queued

  @sandbox
  Scenario: A second paper for the same class is not made while the first is being made
    Given a Grade 5 Maths board-pattern paper is being made for this teacher
    When they reach Check and make for Grade 5 Maths again
    Then Make my paper is disabled with "A paper for this class is being made"
    And a stale request is refused with "A paper for this class is being made"

  @FB06
  Scenario: A teacher who has made 10 papers this hour is told when the next one can be made
    Given the soft paper limit is on
    And the teacher has asked for 10 papers in the last hour
    When they ask for another paper
    Then it is refused with "You have made 10 papers this hour" and the time the next one can be made
    And no paper is queued

  @sandbox @real-paper
  Scenario: Adding a question to a board-pattern paper is refused with a reason
    Given a ready board-pattern paper
    When the teacher tries to add a question
    Then the editor says "Board-pattern papers keep their shape" and no new version is made

  @sandbox @real-paper @no-mock-driver
  # No mock driver: the refusal is decided on a real paper's slot-tagged items, which only a sandbox paper carries.
  Scenario: Changing a board-pattern question's marks is refused, and sending the same marks back is not an edit
    Given a ready board-pattern paper
    When the teacher saves a question with its marks changed
    Then the editor says "Board-pattern papers fix each question's marks." and no new version is made
    When the teacher saves an Urdu item worth 1.25 marks with its text changed and the marks left as they were
    Then a new version is made and the item is still worth 1.25 marks

  @sandbox
  # No mock driver: three creates must reach the bot at the same instant, which the web driver cannot do through one page.
  Scenario: Three requests for the same class at the same moment make one paper
    Given the board-pattern switch is on
    When three requests for a Grade 5 Maths board-pattern paper arrive for one teacher at the same moment
    Then one paper is queued and the other two are told "A paper for this class is being made" with that paper's request

  @sandbox
  Scenario: A reopened wait page still knows it is a board-pattern paper
    Given a Grade 5 Maths board-pattern paper is being made for this teacher
    When they close the app and open the paper's link again
    Then the wait screen shows the board-pattern chip and how long ago the paper was started
    And the portal's status answer for that request carries the pattern and when it was asked for
    And a paper made without the pattern gets a status answer with neither

  @sandbox
  Scenario: A Maths paper whose first draw set aside two MCQs is still made whole
    Given the board-pattern switch is on
    When a Grade 5 Maths board-pattern paper's first reply has two MCQs with two options of equal value
    Then that section is asked once more and the paper is ready with all 20 MCQs in Q1(a)
    And 18 of them are the first reply's

  @sandbox
  Scenario: A paper that still fails keeps what was written
    Given the board-pattern switch is on
    When a Grade 5 Maths board-pattern paper comes back short twice
    Then the paper fails "PATTERN_SHORT_SLOT" and its row keeps the paper as written and the model's name

  # ── Edge cases ────────────────────────────────────────────────────────────────────────────────────────────────────

  @FB07
  Scenario: With the soft limit off, a teacher past 10 papers this hour is not refused
    Given the soft paper limit is off
    And the teacher has asked for 10 papers in the last hour
    When they ask for another paper without the pattern
    Then the request is not refused for the limit

  @FB08
  Scenario: A board-pattern choice switched off mid-way goes back to today's Chapters step
    Given the board-pattern switch is on
    And a Grade 5 English teacher has picked the FDE board pattern card on Chapters or pages
    When the switch is turned off and the page is reloaded
    Then Chapters or pages shows the Chapters tab and no FDE board pattern card
    And Next is off with "Select at least one chapter"
    And a teacher who entered by the FDE door and reloads Class after the switch went off sees today's Class: no "FDE pattern papers" eyebrow, every grade on offer

  @sandbox
  Scenario: A failed read on the FDE door keeps the teacher on Class with Try again
    Given the board-pattern switch is on
    When the teacher taps Maths on the FDE door and the connection drops before the options come back
    Then Class says "Could not load" with Try again instead of moving to Chapters or pages
    And Try again, once the connection is back, goes on to Check and make

  @sandbox @real-paper
  Scenario: A paper for any other grade is unchanged
    Given the board-pattern switch is on
    When a Grade 3 Urdu teacher makes a paper with Auto mix
    Then the screens, the request, the prompt and the printed paper are identical to those made with the switch off
