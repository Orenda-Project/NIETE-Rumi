Feature: Teacher quiz report on the web and in the class report PDF
  A teacher sees who played a class quiz, who has not, and what to reteach —
  on a web page that opens from WhatsApp, and in the post-completion PDF.
  Everything here is for a teacher on app_settings.teacher_report_teachers;
  any other teacher gets exactly today's report.

  # M3c — the post-completion PDF, the stored guidance, the "All my classes" tab
  # (M3b: append the page scenarios above or below this block)

  Background:
    Given a teacher on the teacher report list with one class list "3-B" of 15 children
    And a quiz on "Parts of a plant" for class 3 that 6 children of 3-B finished

  @T350
  Scenario: The class report PDF lists who has not played yet, greyed, with their list no.
    When the scheduled class report is sent
    Then the PDF has a "Not played yet" section with the 9 children still to play, first names with their list no., in list order
    And it has a "Remind the class" link to "/r/<token>/remind" and a "See the live report" link to "/r/<token>"
    And the caption carries the live report link in the teacher's own language

  @T358
  Scenario: The caption counts who has not played and links the reminder
    When the scheduled class report is sent
    Then the caption reads "9 of 15 have not played yet · tap to remind the class: <link>" with the "/r/<token>/remind" link
    And for an Urdu-speaking teacher the same line is Urdu with the numbers isolated
    And with no class list, or when everyone on it has played, the caption has no count line

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
    And it still links to the live report

  @T353
  Scenario: A teacher not on the teacher report list gets today's report
    Given the teacher is not on app_settings.teacher_report_teachers
    When the scheduled class report is sent
    Then the PDF and its caption carry no "/r/" link and no "Not played yet" section

  @T354
  Scenario: An Urdu quiz's PDF section is Urdu; the caption follows the teacher
    Given the quiz language is Urdu and the teacher's language is English
    When the scheduled class report is sent
    Then the section reads "ابھی نہیں کھیلا" with "کلاس کو یاد دلائیں"
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
