Feature: Teacher assessment
  # Web lane (bd-hnhlgn.8): `npm run e2e:web -- teacher-assessment`. Covers: portal/src/portal/teacher/assessment/**, PortalAssessment.tsx, ClassicAssessment.tsx, newui/assessment/**.
  # Runs on the local stack with the demo school network (password Demo2026). Each page must be HEALTHY: it settles
  # where expected (not bounced to /portal/login), throws no page error, gets no 5xx from the API, shows no error
  # screen, and renders its own heading/content.

  @TA01
  Scenario: Teacher app v2: Assessment opens
    Given the teacher app v2 is on and the coach app v2 is off
    And demo teacher 03000000911 is signed in
    When she opens /portal/teacher/assessment
    Then Assessment opens

  @TA02
  Scenario: Classic portal: Assessment opens
    Given the teacher app v2 and the coach app v2 are off
    And demo teacher 03000000911 is signed in
    When she opens /portal/assessment
    Then Assessment opens

  # FDE board pattern (Grade 5). Shown only while /assessment/options carries `patternGrades` / `patterns` (the bot's
  # app_settings flag assessment_fde_pattern_enabled); with the flag off every screen above is unchanged. Test ids:
  # fde-door, fde-door-again, fde-held-note, fde-side-door, fde-row-{style,class,syllabus,inside,youadd},
  # fde-{style,syllabus,inside}-tray, fde-style-next, step-hint, step-next, fde-ready-{paper,scheme}, fde-if-no-download.

  @TA03 @fde
  Scenario: FDE door: Class, then one Check screen
    Given the board-pattern flag is on
    And a Grade 5 teacher is signed in to the teacher app v2
    When the teacher taps "FDE pattern papers" on Assessment
    Then the Class step says "Step 1 of 2"
    And its picker offers only Grade 5's subjects, with no grade to choose
    When the teacher picks Grade 5 Maths
    Then Check and make opens at "Step 2 of 2" with the rows Paper style, Class, Syllabus and Inside
    And the hint over Make my paper reads "Ready in about 3 min"

  @TA04 @fde
  Scenario: FDE Check: the three trays
    Given Check and make is open for a Grade 5 Science FDE paper
    Then the amber line says what the teacher adds before photocopying
    When the teacher opens Inside
    Then the tray lists each section, "Paper + marking scheme · two PDFs" and "Practice paper · not an official FDE paper"
    When the teacher opens Syllabus and unticks one unit
    Then the Syllabus row says "customised" and Inside offers "Use FDE syllabus"
    When the units kept are 1, 2, 3, 4, 6, 7 and 8
    Then the Syllabus row reads "Units 1–4, 6–8 · customised" (Urdu: «یونٹ 1–4، 6–8 · حسبِ ضرورت»)
    When the teacher opens Paper style, picks "My own paper" and taps Next
    Then today's Questions step opens at "Step 3 of 4" with the FDE units ticked

  @TA05 @fde
  Scenario: FDE Make: the request and the wait
    Given Check and make is open for a Grade 5 Maths FDE paper on the FDE syllabus
    When the teacher taps Make my paper
    Then the request carries pattern "fde_g5_2027" and scope "fde", and no totalMarks
    And the wait screen shows "~3 min", "This page checks by itself." and only My papers in the dock
    And Make my paper is off with "A paper for this class is being made" for the same class until it is ready

  @TA06 @fde
  Scenario: FDE Ready: two named files
    Given an FDE paper is ready
    Then Ready shows "Question paper · 4 pages · for the class" and "Marking scheme · 4 pages · for the teacher", each its own download
    And there is no "With marking scheme" chip, and at 360×740 the Open and Make another tiles clear the dock
    And the dock is Send on WhatsApp and Open in another app
    And inside WhatsApp's browser on Android, tapping Marking scheme hands the marking scheme's own file to the phone's browser, and Question paper its own (the same on the paper page)
    And outside WhatsApp's browser, and in WhatsApp on iPhone, each row downloads as today
    And inside WhatsApp's browser the line "If Download does nothing here, use Open in another app" is shown
    And the paper page labels the key "Marking scheme" and offers no Edit

  @TA07 @fde
  Scenario: FDE refusals in the teacher's language
    Given Check and make is open for a Grade 5 FDE paper
    When the server answers PATTERN_OFF, ALREADY_GENERATING or RATE_LIMITED
    Then the error line above the rows says it in the page's language (English or Urdu)

  @TA08 @fde
  Scenario: Nothing new without the pattern
    Given the board-pattern flag is off, or the class is Grade 3 Science, or Grade 5 Islamiat
    When the teacher opens the Chapters step
    Then there is no FDE card and the screen is pixel-identical to today's
    And on the FDE door's Class step Islamiat shows "FDE pattern for Islamiat: after review" and its row is off from the first paint, before any read answers

  @TA09 @fde
  Scenario: Editing an FDE paper keeps its shape
    Given an FDE Maths paper is open in Edit paper
    Then the top line says "Changes the paper and the marking scheme"
    And the questions are grouped as Section A, Section B and Section C
    And under each of Q2's questions the line says "Q2 will then say: any eight of eleven"
    When the teacher removes one of Q2's questions
    Then the others say "any eight of ten", the removed one says "any eight of twelve", and the marks chip stays the same
    And Add question is off with "Board-pattern papers keep their shape", also when the server answers PATTERN_NO_ADD

  @TA10 @fde
  Scenario: Versions of an FDE paper
    Given an FDE paper has two ready versions
    When the teacher opens Versions
    Then the page shows the FDE pattern chip and a "Marking scheme" row under each ready version that opens its key file
    And a plain paper's Versions and Edit paper screens are pixel-identical to today's
    And when the My papers read fails, Versions shows "Could not load" with Try again and no Edit until it is read

  @TA11 @fde
  Scenario: The marks of an FDE paper's questions are the board's
    Given an FDE Maths paper is open in Edit paper
    When the teacher opens one of its questions
    Then there is no Marks box; the question and its answer can still be changed
    And when the server answers PATTERN_FIXED_MARKS the line says "Board-pattern papers fix each question's marks." in the page's language
    And a plain paper's question still shows its Marks box

  # A plain New paper is four steps (Class, Chapters or pages, Questions, Check and make). Questions is one screen: the
  # seen count, only the unseen types she chose with a count each, Add a type for the rest, and an optional total marks;
  # the paper is what they add up to. Test ids: count-seen, type-count-<type>, add-type, types-tray, total-marks,
  # questions-total, step-next, button-reason.

  @TA13
  Scenario: A plain paper is chosen on one Questions screen and checked in four steps
    Given a Grade 4 Science teacher is signed in to the teacher app v2
    And she has picked Chapter 1 on a plain New paper
    When Questions opens for the first time
    Then it says "Step 3 of 4" and "Please select the number of questions"
    And Seen questions shows 5 and Unseen questions shows only MCQs 4, True/False 3 and Fill in the Blanks 3
    And the line above Next reads "15 questions · 5 seen · 10 unseen"
    When she taps Add a type, ticks Brief Answers and taps Done
    Then Brief Answers appears under Unseen questions at 1 and the line reads "16 questions"
    When she types 2 in the True/False box, then taps its minus once and its bin
    Then True/False is no longer on the page
    When she taps Next
    Then Check and make shows one Questions row "13 questions" with "5 seen · 8 unseen" and its types, a Total marks row and an Answer lines switch, and no File row
    When she turns Answer lines off and taps Make my paper
    Then the request carries questionCount 13, contentSource "both", seenCount 5, the three types with their counts and answerLines false

  @TA14
  Scenario: Questions holds Next, and says why, until the paper can be made
    Given Questions is open for a Grade 4 Science paper with 5 seen and MCQs 4
    When she empties the Seen box and removes MCQs
    Then Next is off with "Add at least 1 question"
    When the seen and unseen boxes add up to more than 50
    Then Next is off with "Questions: 1 to 50" and the boxes that count are red
    When the paper has 12 questions and she types 5 in Total marks
    Then Next is off with "At least 12 marks for 12 questions"
    When she types 24 in Total marks
    Then Next goes on to Check and make, and the line above it ends "24 marks"

  @TA15
  Scenario: The old Question types and Marks and lines links land on Questions
    Given a plain New paper is under way for a Grade 4 Science class
    When she opens /portal/teacher/assessment/new/types, or /portal/teacher/assessment/new/extras
    Then she is on Questions, with her choices kept

  # Paper ready for a plain paper (bd-7tgiyc): the paper itself in the portal's PDF viewer (the lesson plan one, read through
  # GET /api/portal/assessment/paper/:id/file), Edit and Answer key above it, Send on WhatsApp and Download PDF docked.
  # Test ids: lesson-plan-viewer.

  @TA16
  Scenario: A plain paper that is ready opens in the app, with no Make another and no Word
    Given a Grade 4 Science teacher's plain paper of 15 questions and 30 marks has just been made
    When Paper ready opens
    Then it shows the chips Ready, "15 questions" and "30 marks"
    And the paper's pages are drawn in the app under them, with zoom buttons, and nothing opens in another app
    And Edit (when editing is on) and Answer key sit above the paper
    And the dock holds Send on WhatsApp and Download PDF
    And there is no Make another and no Word anywhere on the page

  @TA17
  Scenario: Answer key shows the key in the same viewer, and Back to paper shows the paper again
    Given Paper ready is open for a plain paper that has an answer key
    When she taps Answer key
    Then the viewer shows the answer key and the button reads "Back to paper"
    When she taps Back to paper
    Then the viewer shows the paper again
    Given Paper ready is open for a paper made before answer keys were kept
    When she taps Answer key
    Then the app says "No answer key" and the viewer shows the paper

  # Topics (Task 8, bd-6clakk): after Chapters, when exactly one chapter is picked and it has topics, a Topics step asks
  # Whole chapter or Select topics. English and Urdu topics sit under their skill headings, in teacher words, never SLO
  # codes. A strict subset of the topics is sent as topicIds and starts at 10 marks; every topic ticked is the whole
  # chapter, sent as today. Write-only here: the driver mocks /assessment/topics and catches /assessment/generate.

  @TA18
  Scenario: Teacher makes a grammar-only paper on topics taught
    Given a Grade 1 English teacher is signed in to the teacher app v2
    And she has picked Chapter 1 on a plain New paper, and the chapter has Reading, Vocabulary & grammar and Writing topics
    When she taps Next on Chapters
    Then Topics opens at "Step 3 of 5" with Whole chapter and Select topics, and no list yet
    When she taps Select topics
    Then the topics show under the headings Reading, Vocabulary & grammar and Writing, nothing ticked, and no SLO code
    And Next is off with "Tick at least one topic"
    When she taps Tick all under Vocabulary & grammar and taps Next
    Then Questions opens at "Step 4 of 5" with 10 marks, no seen questions, and grammar question types
    When she taps Next and Make my paper
    Then Check and make shows a Topics row "2 selected"
    And the request carries topicIds for the two grammar topics only, and no seen questions

  # The soft paper limit (dashboard flag assessment_rate_limit_enabled) counts plain papers too. Run on sandbox by the QA
  # agent with a teacher's ten requests of the last hour seeded and the flag on for the run only.
  @sandbox
  Scenario: A plain paper refused for the hour's limit says so above the rows
    Given the soft paper limit is on
    And the teacher has asked for 10 papers in the last hour
    When the teacher taps Make my paper on a plain Check and make
    Then the screen says "Paper limit reached · try again at" with the time, above the rows, in the teacher's language
