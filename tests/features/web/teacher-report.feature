Feature: Teacher's web quiz report on the portal
  A teacher opens their quiz report from WhatsApp (a template button opens the in-app
  browser) at /r/<token>: who played, who has not, each child's score, every question's
  difficulty and what to reteach. The page has no JavaScript; every action is a link or a plain form.
  The PDF is the same page printed.

  Background:
    Given a teacher with a sent quiz "Parts of a plant" for class 5-A of 4 children
    And 2 children of 5-A have finished it

  @T340
  Scenario: The report shows who has not played, greyed, with a one-tap reminder
    When the teacher opens the report link
    Then the page shows "2 of 4 played", the average and the hardest question
    And "Not played yet" lists the other 2 children greyed, each with their list number ("list no.")
    And "Remind the class" and "Copy message" are shown under the list
    And the page carries no script and is never cached or indexed

  @T341
  Scenario: Remind the class opens WhatsApp with a message that names nobody
    When the teacher taps "Remind the class"
    Then WhatsApp opens its share sheet with the reminder in the quiz's language
    And the reminder carries the same children's link the class already has
    And the reminder names no child

  @T342
  Scenario: A teacher with two classes of that grade is asked which one it was for
    Given the teacher has class lists 5-A and 5-B and the quiz is bound to neither
    When the teacher opens the report link
    Then the page asks "Which class was this for?" with one button per class
    And no "Not played yet" list is shown until a class is picked
    When the teacher taps 5-B
    Then the hand-out is bound to 5-B for the children too, and the report shows who in 5-B has not played

  @T343
  Scenario: A teacher with no class list is told how to add one
    Given the teacher has no class list
    When the teacher opens the report link
    Then the page says to send /roster on WhatsApp to see who has not played
    And the children who played are still listed with their scores

  @T344
  Scenario: Export PDF is the same report, printed
    When the teacher taps "Export PDF"
    Then a PDF named "quiz-report-<date>.pdf" downloads
    And it shows the same tiles, lists and questions without any buttons
    And the reminder is printed as text with the children's link

  @T345
  Scenario: The report reads right to left in Urdu
    Given the quiz was made in Urdu
    When the teacher opens the report link
    Then the page is right to left in Nastaliq with numbers, scores and dates left to right
    And the "English" link at the top re-opens the same report in English

  @T346
  Scenario: All my classes lists every recent quiz with its own report link
    When the teacher taps "All my classes"
    Then the page shows each class and subject with quizzes, children played and the average
    And a week-by-week bar chart of children who played
    And each quiz opens its own report

  @T347
  Scenario: A link that cannot open a report says so and shows nothing
    When an expired report link is opened
    Then the page says "This link has expired. Send /quiz on WhatsApp for a fresh one." in English and Urdu with status 410
    When a genuine report link of one teacher is pointed at another teacher's quiz
    Then the page says the report could not be found, with status 404, and shows nothing of that quiz

  @T348
  Scenario: A child who typed a name not on the list is reconciled by the teacher
    Given a child typed the name "Alee", who is not on 5-A's list, and finished the quiz
    When the teacher opens the report link
    Then "Not on your class list" shows "Alee" with their score
    And "Add to 5-A" adds the child to the class list
    And "This is…" lets the teacher pick the child from the names who have not played, moving the score onto that child

  @T349
  Scenario: The training link on the same portal still logs the teacher into training
    When the teacher opens a training link "/t/<token>"
    Then the training page opens as before, untouched by the report pages at "/r/<token>"

  @T765
  Scenario: The Jugnu tab shows the class's month, sorted by first name, behind its switch
    Given the Jugnu tab switch and its parent switches are on
    And class 5-A has 8 children, two of them named "Zara" with different fathers
    When the teacher opens the report link and taps "Jugnu"
    Then the tab shows "5 of 8 have started this month" at the top and nowhere else
    And one row per child of 5-A, sorted by first name only, the two Zaras told apart by their fathers' first names
    And each row shows the four stops done this month, "Stopped early" or "Waiting for a microphone" as words, stickers, lamps by rung name, the week's day dots and "Saved on WhatsApp ✓"
    And a stop only served or abandoned shows nothing, and no surname or phone appears anywhere

  @T766
  Scenario: Forward to the class group carries the week's story and no number or name
    Given the Jugnu tab switch is on, the class has a live class link and a story released this week
    When the teacher taps "Forward to the class group"
    Then WhatsApp opens its share sheet with the story's title, "every Monday" and "open the pinned link"
    And the text carries no digit in any script and no child's name
    And with no class link or no story this week the button is not shown

  @T767
  Scenario: The teacher-confirm queue asks one question per pair and passes the tap on
    Given the Jugnu tab switch is on and the queue's words are in the copy deck
    And a child who typed "Ayesha" may be the listed Ayesha of 5-A
    When the teacher opens the Jugnu tab
    Then the queue asks "Is Ayesha the same as Ayesha?" with the class, first names only
    And "Same child", "Different" and "Not sure" each save with one tap and come back to the tab
    And a pair the teacher said was the same child shows "Undo"

  @T768
  Scenario: With the Jugnu switch off the report is exactly as before
    Given the Jugnu tab switch, or one of its parents, is off
    When the teacher opens the report link, with or without "tab=jugnu"
    Then the quiz tab and the class tab are byte-for-byte today's pages, with no Jugnu link
    And the forward link and the queue answer "not found"
