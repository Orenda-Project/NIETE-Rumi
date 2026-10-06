Feature: Teacher quiz report in the class report PDF and the "All my classes" tab
  The post-completion class report PDF (and its caption) shows who on the class list
  has not played yet and links to the teacher's live web report (teacher-report.feature)
  and its "Remind the class" share; the reteach guidance it prints is stored for that page.
  Everything here is for a teacher on app_settings.teacher_report_teachers;
  any other teacher gets exactly today's report.

  Background:
    Given a teacher on the teacher report list with one class list "3-B" of 15 children
    And a quiz on "Parts of a plant" for class 3 that 6 children of 3-B finished

  @T350
  Scenario: The class report PDF lists who has not played yet, greyed, with their list no.
    When the scheduled class report is sent
    Then the PDF has a "Not played yet" section with the 9 children still to play, first names with their list no., in list order
    And the PDF carries NO report link (it is forwarded to class groups) — it says "send /quiz, then tap “My quiz reports”"
    And neither does its caption (a forwarded document carries its caption): the live report link and the "/r/<token>/remind" reminder follow as a separate text

  @T358
  Scenario: The caption counts the class and carries no link; the links follow as their own text
    When the scheduled class report is sent
    Then the caption reads "6 of 15 in 3-B played · 9 still to play" and contains no link
    And it no longer says how many sessions finished
    And right after the PDF a text carries "Remind the class" with "/r/<token>/remind" and the live report "/r/<token>", naming no child
    And for an Urdu-speaking teacher both are Urdu, the numbers and the class name isolated
    And when everyone on the list has played the caption reads "15 of 15 in 3-B played" and the text carries the live report only
    And with no class list the caption keeps "<finished> of <started> finished"
    And a teacher not on the teacher report list gets today's caption and no links text

  @T351
  Scenario: A child who started but did not finish is listed once
    Given one child of 3-B started the quiz and did not finish
    When the scheduled class report is sent
    Then that child appears under "Not played yet" and nowhere else in the PDF

  @T352
  Scenario: A teacher with no class list still gets the live report links
    Given the teacher keeps no class list
    When the scheduled class report is sent
    Then the PDF has no "Not played yet" section
    And it still points to the live report in /quiz, without a link

  @T353
  Scenario: A teacher not on the teacher report list gets today's report
    Given the teacher is not on app_settings.teacher_report_teachers
    When the scheduled class report is sent
    Then the PDF and its caption carry no "/r/" link and no "Not played yet" section

  @T354
  Scenario: An Urdu quiz's PDF section is Urdu; the caption follows the teacher
    Given the quiz language is Urdu and the teacher's language is English
    When the scheduled class report is sent
    Then the section reads "ابھی نہیں کھیلا" and points to «میری کوئز رپورٹس» in /quiz
    And the caption's live report line is in English

  @T355
  Scenario: The reteach guidance in the PDF is the guidance the web report shows
    When the scheduled class report is sent with reteach guidance
    Then quizzes.meta.report_guidance holds exactly the guidance printed in the PDF
    And it was written in the same update that marked the quiz reported
    And a class-card send afterwards does not erase it

  @T356
  Scenario: The pre-send PDF does not change
    When the hand-off PDF is rendered for a quiz in English and in Urdu
    Then it is byte-identical to the base template's output

  @T357
  Scenario: "All my classes" shows the teacher's quizzes by class, by week and quiz by quiz
    Given the teacher sent 4 quizzes to classes 3 and 5 in the last 60 days
    When the teacher opens "All my classes" on the report page at 360 px
    Then there is one card per class and subject with its average and how many played
    And an 8-week bar trend of children who played, with each week's average on top
    And each quiz row opens that quiz's own report "/r/<token>"
    And in Urdu every number and date reads in order inside the Urdu text
