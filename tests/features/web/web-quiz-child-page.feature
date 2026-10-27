Feature: Web child quiz page on the portal
  A child opens the quiz link the teacher forwarded and plays it on a web page,
  in WhatsApp's in-app browser or the phone's own browser.

  Background:
    Given a quiz share code "AB12CD" that is active

  @WQ01
  Scenario: The link opens the quiz page with a link preview
    When the link "/q/AB12CD" is opened
    Then the page carries the quiz as boot data
    And the page has og:title, og:description and og:image tags
    And the page is marked noindex and no-cache

  @WQ02
  Scenario: A new child plays to the class league table
    Given a phone that has never played
    When the child taps "Play", then "I'm new", and types a first name
    And answers all 5 questions, one of them wrong
    And fixes the tricky one with Jugnu
    Then the child sees "You got 4 out of 5" with 4 stars
    And the scorecard shows the first name, the topic, 4/5 and 4 stars
    And the class league table highlights the child's own row as "YOU"

  @WQ03
  Scenario: A returning child is remembered on this phone
    Given a child finished a quiz on this phone before
    When the link of a new quiz is opened
    Then the landing offers "Play as <first name>" in one tap

  @WQ04
  Scenario: A reload mid-quiz resumes
    Given a child answered 3 of 5 questions
    When the page is reloaded
    Then the landing offers "Continue 4/5" and the saved answers are kept

  @WQ005
  Scenario: A typed name that matches a class name asks "Is this you?"
    When a child types a first name that is already on the class list
    Then the page asks "Are you <name>?" before starting

  @WQ05
  Scenario: A closed quiz explains itself in the quiz language
    Given the share code has expired
    When the link is opened
    Then a friendly "This quiz has closed" page shows in the quiz language with status 410

  @WQ007
  Scenario: Sharing works when the browser has no share menu
    Given the browser has no navigator.share
    When the child taps "Share to class group"
    Then the page offers "Open WhatsApp with the message" and "Copy the message"

  @WQ008
  Scenario: A recorded clip that cannot play falls back to the phone's voice
    Given a question whose recorded clip fails to load
    When the question is shown
    Then the question is read by the phone's own voice
    And an "audio_fallback" event is logged with the reason

  @WQ009
  Scenario: The landing names the teacher and the class as the teacher's own texts do
    Given the teacher's stored name is "Example Teacher" and finished children typed class "3"
    When the link is opened
    Then the landing says "From Teacher Example Teacher · Class 3"
    And the class page link preview names "Class 3"
    But before anyone has finished, the landing shows no class

  @WQ010
  Scenario: A quick tap never brings back the old line
    Given a question whose recorded clip has not started yet
    When the child taps an answer at once
    Then the feedback is read and the old question is not read again
    And no "audio_fallback" event is logged for the stopped clip

  @WQ011
  Scenario: A child remembered on this phone is listed once
    Given a child played the teacher's earlier quiz on this phone
    When the child plays the teacher's next quiz with "Play as <first name>"
    Then "Whose turn?" lists the child's name once

  @WQ012
  Scenario: The teacher's report counts the first finish of a web quiz
    Given a child played the quiz on the web page
    And finished it once and then again on another phone
    When the teacher's report is written
    Then the report shows the first finished score, as the league table does

  @WQ013
  Scenario: The answer buttons come in the same order as the WhatsApp quiz and the teacher's answer key
    Given a question whose options were shuffled when the quiz was made
    When the question is shown on the page
    Then the buttons are in that same shuffled order
    And tapping the right answer is marked right, and each wrong answer gets its own feedback

  @WQ014
  Scenario: A figure question shows the drawing, not the WhatsApp card
    Given a question whose WhatsApp card paints the stem and options into a picture
    And the question carries a fraction bar figure
    When the quiz is opened on the web page
    Then the question shows the fraction bar drawn as a picture with no question text inside it
    And the stem and the options are shown once, as text
    And the read-aloud says "Look at the bars." before the question

  @WQ015
  Scenario: A question with long options shows no picture at all
    Given a question that WhatsApp sends as a card only because its options are long
    When the quiz is opened on the web page
    Then the question shows no picture
    And the stem and the options are shown as text

  @WQ016
  Scenario: Picture options are drawings, never emoji
    Given a picture question whose options are an apple, a cat and a bus
    When the quiz is opened on the web page
    Then each option shows its drawing with its word under it

  @WQ017
  Scenario: A "whose sound is this?" question plays its own sound on the page
    Given a question that asks which sound the child hears, with its recorded sound
    When the quiz is opened on the web page
    Then the question has a "Play the sound" button that plays that recorded sound
    And a question whose words already ask it never plays a clip that says the answer before the child answers
    But if the sound cannot be fetched, the question is read aloud by the phone's own voice

  @WQ018
  Scenario: Picture answers are named by what they show
    Given a picture question whose answers were stored as "1. Table", "2. House" and "3. Chair"
    When the question is shown on the page
    Then each picture has its word "Table", "House" or "Chair" under it and the voice says that word
    But a picture answer that was only ever stored as "Picture 1" shows the picture alone and is never read as "Picture 1"

  @WQ019
  Scenario: A match picture names its rows P, Q, R, never the answer letters
    Given a matching question whose picture labels its rows A, B and C
    And its answers read "A-2, B-1, C-3"
    When the question is shown on the page
    Then the picture labels the rows P, Q and R
    And the question, the answers and the explanation say P, Q and R too
    And the answer buttons keep their own A, B and C

  @WQ020
  Scenario: Letter answers are set as large page text so their marks are never cut off
    Given an Urdu question whose answers are the letters بّ, بِ and بْ
    When the question is shown on the page
    Then each answer is a large letter tile drawn in the page's own Urdu font
    And the shadda, zer and jazm marks are fully visible

  @WQ021
  Scenario: A question that points at a picture it does not have is not served
    Given a quiz with four questions
    And one stem says "Look at the pictures. Which one is a leaf?" with no picture, no figure and no picture options
    When the child opens the quiz
    Then the quiz has three questions
    And the score at the end is out of three

  @WQ022
  Scenario: A question that points at its own picture is served with it
    Given a stem "Look at the picture. Which part takes in water?" whose row has its own picture
    When the question is shown
    Then the picture is on screen above the options

  @WQ023
  Scenario: The recorded voice says the words written for the voice, never maths code
    Given a quiz whose question is "What is $\frac{3}{4}$ of 8?" and whose web item reads it as "What is three quarters of eight?"
    When the read-aloud clips are published
    Then the question clip says "What is three quarters of eight?"
    And no clip says "dollar", "backslash" or "frac"
    And a question with no web item is read from its own text with the maths turned into words
    And a question whose words changed gets a new clip on the next publish

  @WQ024
  Scenario: A wrong answer is voiced as "not yet", never as praise
    Given a question whose correct-answer feedback is only "Well done!" and whose explanation gives the reason
    When the quiz is published, the recorded "why" says the reason, never the praise
    And a child taps a wrong answer
    Then the voice says "Not yet. The answer is" and then the right answer by name
    And then the feedback for the option the child picked, or the reason
    And no praise is spoken, in English or in Urdu
    But a right answer is praised and then given the reason

  @WQ025
  Scenario: Closing the page or leaving it silences every sound
    Given the voice is reading a question aloud and the lesson video may be playing
    When the page is hidden, frozen or closed (the in-app browser is closed, the child switches app or locks the phone)
    Then the recorded clip, the phone's voice, the sound effects and any playing video stop at once
    And when the child comes back nothing starts again until the child taps

  @WQ026
  Scenario: The sound button silences every sound, and a missing clip never means silence without words
    Given a phone that has never changed the sound setting
    Then the voice and the tap tones are on
    When the child taps the sound button while a line is playing
    Then everything stops at once, the button shows sound off, and this phone remembers it
    And with sound off no answer plays a clip or the phone's voice
    But when a line has no recorded clip, the page logs "audio_missing" with the question and the part
    And on a phone with no voice for the quiz language, the question's words are shown big
    And the not-yet line never ends with a doubled full stop
  # Who is playing, by roll number (app_settings web_quiz_roster_id; off = the name chips above, unchanged)
  @WQ027
  Scenario: A teacher with a class list: the child gives a roll number, not a name from a list
    Given the roster switch is on and the teacher keeps a class list with roll numbers
    When the quiz link is opened
    Then the page carries no classmates' names
    When the child taps "Play"
    Then the page asks "What is your roll number?" with a big number pad

  @WQ028
  Scenario: A roll number is confirmed with the child's first name and animal
    Given the roster switch is on and roll number 12 in the class list is "Danish Testwala"
    When the child types 1, 2 and taps "Go"
    Then the page asks "Are you Danish?" with Danish's animal and nothing else about the child
    When the child taps "Yes, it's me"
    Then the quiz starts as the class-list child, and the teacher's report shows the class list's name and class

  @WQ029
  Scenario: A wrong or unknown roll number never starts a quiz as someone else
    Given the roster switch is on
    When the child types a roll number nobody in the class has
    Then the pad stays and says no one in this class has that number
    When the child types a number and answers "No, try again" to "Are you <name>?"
    Then the pad is empty again

  @WQ030
  Scenario: A quiz plays against ONE class list
    Given the teacher keeps class lists "3-B" and "5-A" and the quiz is for grade 3
    When the child types a roll number or a name that only "5-A" has
    Then no child of "5-A" is offered: an unknown roll number says "Try again!" and a typed name plays as a new child

  @WQ031
  Scenario: The quiz's grade does not pick a class list, so the child picks the class first
    Given the teacher keeps class lists "3-B" and "5-A" and the quiz is for grade 2
    When the child taps "Play"
    Then the page asks "Which class are you in?" with "3-B", "5-A" and "My class is not here"
    When the child taps "5-A" and types a roll number
    Then only "5-A" is searched
    When another child taps "My class is not here" and types a name
    Then that child plays as a new child, not on any list

  @WQ032
  Scenario: Never two green "Yes" buttons on one screen
    Given a typed name is near two children of the class
    Then the page asks about ONE child at a time with "Yes, it's me" and "No, I'm someone else"
    And "No" on the last one plays as a new child

  @WQ033
  Scenario: Two children of the class share a first name
    Given the class list has two children named "Ayesha", roll numbers 1 and 7
    When a child types "Ayesha"
    Then each "Are you Ayesha?" card shows its roll number, one card at a time

  @WQ034
  Scenario: A child who does not know their roll number types a name, and a near name is found
    Given the roster switch is on and the class list has "Ayesha Testwala"
    When the child taps "I don't know my number" and types "Aysha"
    Then the page asks "Are you Ayesha?" before starting

  # Who is playing, name first (app_settings web_quiz_identity = "v2"; off = the roll-number screens above, unchanged)
  @WQ035 @T360
  Scenario: Name first: the child types the name they are called by and confirms ONE card
    Given identity v2 is on and the quiz's class "4-A" has one child called "Hina Testwala"
    When the child taps "Play"
    Then the page asks "What is your name?" («آپ کا نام کیا ہے؟») and no number pad is shown
    When the child types "Hina" and taps "Start"
    Then the page asks "Are you Hina?" with Hina's animal on ONE card and nothing else about the child
    When the child taps "Yes, it's me"
    Then the quiz starts as the class-list child

  @WQ036 @T361
  Scenario: Two children share the typed name: the page asks, it never shows them
    Given identity v2 is on and class "4-A" has "Ali Testwala" and "Ali Raza Testwala"
    When the child types "Ali"
    Then the page asks "There is more than one Ali in 4-A. What is your full name?" with "Ali" already typed
    And no classmate's name, surname, father's name or number is on the screen
    When the child types the full name
    Then exactly one "Are you Ali?" card is shown

  @WQ037 @T362
  Scenario: A child who does not know the answers still plays, as a new child of this class
    Given identity v2 is on and two children of the class share the typed name and a father's name
    When the child taps "I don't know" for the father's name and for the class-list number
    Then the page says "There are 2 children called <name> in 4-A." and "Tap Yes to play. Your teacher will check which one you are."
    And it never says "I can't find" for a name the class list has
    When the child taps "Yes"
    Then the quiz starts as a new child the teacher can add to the class later

  @WQ038 @T490
  Scenario: "Not <first>?" on a phone holding one child's open quiz never continues it as another child
    Given identity v2 is on and a phone remembers "Tooba" and "Yusra" of class "4-A"
    And Tooba's quiz is open on this phone with 2 questions answered
    When Yusra taps "Not Tooba?", types "Yusra" and taps "Yes" on "Are you Yusra?"
    Then a new quiz starts for Yusra at question 1
    And Tooba's quiz stays open with Tooba's 2 answers, and none of Yusra's answers are saved on it
    When Tooba later taps their own card on this phone
    Then Tooba's quiz continues from question 3

  @WQ039 @T363
  Scenario: A link from the child's quiz hub plays as that child with no picking
    Given identity v2 is on and the hub opens "/q/<code>?k=<chip>" for a child of this class
    When the page opens
    Then the quiz starts as that child
    But when the server does not know that chip, the phone forgets it and asks "What is your name?"

  @WQ040 @T564
  Scenario: A link that already names the child never asks "Who is playing?" while the quiz opens
    Given identity v2 is on and this phone remembers the child
    When the child opens "/q/<code>?k=<chip>" from their hub, a play-again row or the video library
    Then the page shows the quiz with "Opening your quiz…" and nothing to tap until question 1
    And "Who is playing?" never appears before question 1
    But when the session cannot start, the page shows "Who is playing?" and waits for the child to tap

  @WQ041 @T493
  Scenario: Replaying under the same typed name on the same phone is the same child, not a new one
    Given identity v2 is on and a child typed "Usman Testwala", which the class list does not have, and confirmed "Yes"
    When the same phone plays this quiz again and confirms "Usman Testwala" again
    Then it plays as the same child, as practice, and the school league gets no new points
    But a different phone, or a different name on this phone, is a different child

  @WQ042 @T364
  Scenario: An invited friend only types a name
    Given identity v2 is on and a friend opens a challenge link from a child of class "4-A"
    When the friend taps "Play"
    Then the page asks only "What is your name?": no class question, no class names, no number pad
    And the friend plays as a new child who never counts in the class report

  @WQ043 @T365
  Scenario: The class is asked only when the hand-out could not tell
    Given identity v2 is on and the teacher has classes "4-A" and "4-B" and did not say which one the quiz is for
    When the child taps "Play"
    Then the page asks "Which class are you in?" with "4-A", "4-B" and "My class is not here"
    When the child taps "4-B" and types their name
    Then only "4-B" is searched, and the "Are you …?" card shows "4-B"
    But when the hand-out has one class, the page goes straight to "What is your name?"

  @WQ044 @T366
  Scenario: Remembered children are big cards on this phone, with "Someone else"
    Given identity v2 is on and this phone remembers "Hina Testwala" and "Omar Testwala"
    When the quiz link is opened
    Then the landing shows Hina and Omar as cards with their animals and a "Someone else" («کوئی اور») button
    When the child taps "Omar"
    Then the quiz starts as Omar with no typing

  @WQ045 @T367
  Scenario: A phone passed around a class puts "Someone else" first and lets a wrong card be undone
    Given identity v2 is on and this phone remembers 4 children
    When the quiz link is opened
    Then "Someone else" comes before the children's cards, and the cards are smaller
    When a child taps "Hina" and the first question opens
    Then a "Not Hina?" button floats over the question for a few seconds
    When the child taps it
    Then the page asks "What is your name?" and logs the wrong card with how long it took

  @WQ046 @T492
  Scenario: Siblings on one phone can undo a wrong card on the first question
    Given identity v2 is on and this phone remembers 2 children, "Tooba" and "Yusra"
    When Yusra taps "Tooba" by mistake and the first question opens
    Then a "Not Tooba?" button floats over the question for a few seconds
    When Yusra taps it
    Then the page asks "What is your name?" and Yusra's answers never go on Tooba's quiz

  @WQ047
  Scenario: The first finish of a class-list child counts once, on any phone
    Given a class-list child finished the quiz on one phone
    When the same child confirms their roll number on another phone and plays again
    Then the second play is practice and the teacher's report keeps the first finish

  @WQ048
  Scenario: The Urdu page shows the roll-number pad in Urdu digits
    Given an Urdu quiz and the roster switch is on
    When the child opens "Whose turn is it?"
    Then the keys and the "no one has number" line use Urdu digits

  @WQ049
  Scenario: The teacher fixes a child who typed a name instead of a roll number
    Given the teacher opens their own preview link of a quiz with a class list
    When the teacher taps "Who played?"
    Then children not on the class list come first, each with a small "Set roll" link on its one-line row
    When the teacher sets roll number 12 and confirms "Is this Danish?"
    Then the list reloads with Danish at "Roll 12"

  @WQ050
  Scenario: The teacher's own link is a page for the teacher
    Given the teacher opens their own preview link
    Then the header says "FOR TEACHERS", no mascot greets them like a child, and "Who played?" is the main button

  @WQ051
  Scenario: "Who played?" opens with what the teacher needs first
    Given 12 children of a 30-child class list finished the quiz
    When the teacher taps "Who played?"
    Then the top line says "12 of 30 played", the average score, and which question most children missed
    And a "Not played yet" list shows the other 18 children by first name and roll number only
    And each child who played is one compact line: name, roll or "Not on your class list", score

  @WQ052
  Scenario: A practice round's card says so
    Given a child already finished the quiz
    When the child plays it again and finishes
    Then the card says "Practice round" with the first score, and sharing it shares the first score


  @WQ053
  Scenario: Feedback is spoken by recorded voices that every quiz shares
    Given the feedback lines are recorded once per language (right, not yet, fixed on a second try, quiz complete, encouragement)
    When a child answers right, answers wrong, fixes a tricky one, passes halfway or finishes the quiz
    Then the page plays one of that set's recorded lines, picked at random and never the same one twice in a row
    And the screen shows exactly the words the voice says
    And a wrong answer whose right option is only a picture says "Not yet. Look, this one is right." with no empty quotes
    And Urdu lines speak to the child only with imperatives or noun phrases, and no not-yet line praises
    And every Urdu line fits the results bubble beside the big mascot at 360 px without lines touching

  @WQ054
  Scenario: A quiz gets its own read-aloud clips the first time its page is opened
    Given a quiz with no read-aloud clips, or with clips of an older voice version
    When its page is opened (the teacher's preview or the first child)
    Then its question, option, why and wrong-option feedback clips are recorded in the background, once
    And the page is never kept waiting for them; until they exist the phone's own voice reads

  @WQ055
  Scenario: A wrong pick on a video-bank question shows only the mix-up and the reason
    Given a question whose stored WhatsApp feedback for the picked option reads "C) Good try! You mixed up X. The correct answer is B) Y, because Z. Keep going!"
    When a child picks that option on the page
    Then the page says "Not yet. The answer is" with the right option, then "You mixed up X. Z."
    And no option letter, no "the correct answer is", no praise or cheering is shown or spoken, in English or in Urdu
    And an Urdu sentence that addresses the child with a gendered verb is left out
    And a short cheer after the reason ("Try the next one!", «آگے بڑھو!») is left out, while a short sentence with content stays

  @WQ056
  Scenario: A wrong true/false answer says which the sentence is
    Given a true/false question whose sentence is true
    When a child taps "False"
    Then the voice plays a recorded "Not yet. This sentence is true." («ابھی نہیں۔ یہ بات درست ہے۔») and the screen shows the same words
    And the landing invites the child to play the quiz, and a short quiz says "about 1 minute"

  @WQ057
  Scenario: Numbers a child could misread are written out
    Given a child left the quiz after answering the first question
    When the child opens the link again
    Then the resume button says "Go on: question 2 of 5" («جاری رکھیں: سوال 2 از 5»), never a score-shaped "2/5"
    And "Your scores" shows each day as "6 Oct" («6 اکتوبر»), never "2026-10-06"

  @WQ058 @T247
  Scenario: A child remembered on this phone whom the quiz's class list does not know is asked again, never shown an error
    Given this phone remembers a child who played a quiz of another class (or whom the teacher removed from the list)
    When the child taps "Play as" that child on a quiz of this class
    Then the phone forgets that child and shows "who is playing?" (the roll-number pad when the class has a list)
    And no "Something went wrong" message is shown

  @WQ059 @T248
  Scenario: A friend who plays a challenge learns who won
    Given a child finished the class quiz with 3 of 4 and sent a friend their challenge link
    When the friend opens the link, plays and finishes with 4 of 4
    Then the friend's scorecard says "You beat the challenge!" («آپ نے چیلنج جیت لیا!») with "You 4/4 · <challenger> 3/4"
    And a friend with the same share of right answers sees "It's a tie!" («مقابلہ برابر رہا!»), a lower one "So close! Play again?"
    And when the challenger opens "My scores", the friend's row says "beat you!" («آپ سے آگے!»), or "you won" when the challenger did better

  @WQ060 @T249
  Scenario: A challenge link carries no child's name
    Given a child finished a quiz
    When the child taps "Challenge a friend"
    Then the shared link is the child's challenge code alone ("/q/<code>"), with no name in it
    And the friend's landing still names the challenger, read from the code on the server
  @WQ061 @T290
  Scenario: Jugnu gives a hint on a tap, never the answer
    Given a question whose web item carries a hint written from the lesson ("Think about what you can pour into a glass.")
    When the child taps the small thinking Jugnu ("Need a hint?" / «اشارہ چاہیے؟») under the options
    Then the hint shows beside a thinking Jugnu and is spoken in the quiz's one voice from its own recorded clip
    And the hint never says any option, the number that is the answer, the thing a picture option shows, or the word a missing-letter picture spells
    And using the hint does not change the child's score

  @WQ062 @T291
  Scenario: A child who sits stuck is nudged once
    Given a question with a hint that the child has not asked for
    When twenty seconds pass after the voice has finished reading the question
    Then Jugnu wiggles once and says "Stuck? Tap me for a hint." («مشکل لگ رہا ہے؟ اشارے کے لیے مجھے دبائیں۔»)
    And a question with no hint offers "Shall we listen again?" as before

  @WQ063 @T292
  Scenario: A hint that would give the answer away is thrown out and the question still plays
    Given the author writes a hint that names the right option (or a wrong one, or says "the answer is")
    When the quiz is made
    Then that question keeps its web item with no hint, and on the page Jugnu offers no hint for it
    And the quiz's log line counts the hints kept and the hints dropped by reason
  @WQ064 @T250
  Scenario: The school league ranks every school that played this week by points that reward taking part
    Given children of several schools finished quizzes this week (Monday to now, Pakistan time)
    When a child opens "School league" from the card, the class table or "today"
    Then each school that played shows its place, its points and how many children played
    And a school earns 10 points for each child's first finish of a quiz plus up to 10 for that score
    And a practice re-attempt, a teacher's own test and a test teacher's quiz add nothing
    And a school marked as a test school appears only on its own children's league, never on anyone else's
    And no teacher, class or child is named on the league

  @WQ065 @T251
  Scenario: A child's own school is always in view, with its move since yesterday and what this finish added
    Given the child's quiz was sent by a teacher of a school that has points this week
    When the child opens the school league after finishing
    Then a card on top says "<school> is #<place> this week", the move since yesterday, and "+<n> points for <school>!"
    And the school's row in the list is highlighted and stays pinned to the top or bottom of the screen when scrolled away

  @WQ066 @T252
  Scenario: A school with no points yet is invited, never ranked last
    Given no child of the child's school has finished a quiz this week
    When the child opens the school league
    Then the card on top says "No one from <school> has played yet this week. Be the first!" with no place number
    And the share button says "Invite my school to play"
    And the other schools still to start are one folded line "N schools still to start" that opens to their names, without numbers

  @WQ067 @T253
  Scenario: Caps keep the league fair
    Given a child finishes seven quizzes in one Pakistan day, and seven friends take one child's challenge on one quiz
    When the league is counted
    Then only the child's first five quizzes that day add points, and only the first five friends of that challenge add points
    And the sixth quiz and the sixth friend still play and see their score
    And one phone adds points for at most three children it created that day on one quiz (names typed that are not on the class list); a fourth still plays and is never told it added points

  @WQ068 @T254
  Scenario: The school league has its own link, in English and in Urdu
    Given a child shares the school league to the class group
    When someone opens /q/<CODE>/schools
    Then the page opens straight on the league with the preview title "School league this week" («اس ہفتے اسکولوں کی لیگ»)
    And "My sector" filters the list to the child's sector and "All" brings every school back
    And someone who has never played this quiz on that phone is offered "Play and add points for <school>", which opens the quiz
  @WQ069 @T422
  Scenario: A word picture that hides a letter the question does not ask about is not shown
    Given a sent quiz has a question whose picture hides a letter of a word, but the question asks something else (how many syllables the word has)
    When a child opens the quiz on the page
    Then a question that makes sense without the picture plays as text, with no picture
    And a question that needs the picture is left out, and the quiz still has at least three questions
    And a question that asks which letter fills the gap keeps its picture
  @WQ070 @T280
  Scenario: Every line a child hears in a quiz is in one voice per language
    Given a teacher's quiz in English (or in Urdu) whose clips were recorded after this change
    When a child answers a question wrongly
    Then the recorded "Not yet. The answer is" line, the right option's clip and the reason are all in the same voice (Soniox Grace in English, Soniox Ishita in Urdu)
    And the shared feedback library names that same voice for its language

  @WQ071 @T281
  Scenario: A clip the voice could not record is never recorded in another voice
    Given the quiz voice is unavailable while a quiz's clips are being recorded
    When the recording job runs
    Then no clip is recorded by another voice provider
    And the quiz is left unstamped so the job tries again later, and the page shows the words big meanwhile

  @WQ072 @T282
  Scenario: A slow clip is waited for, not swapped for the phone's voice
    Given a child on a slow connection opens a question whose clip takes more than 2 seconds to start
    Then the words are shown big while the clip keeps loading, and the phone's own voice does not speak
    And a clip that has not started after 8 seconds is let go quietly and logged as stalled
    And a clip the browser refuses to start before a tap makes the speaker button pulse, and a tap plays it

  @WQ073 @T283
  Scenario: Quiz audio is stored in the configured bucket under a name that says what it is
    Given WEB_QUIZ_AUDIO_BUCKET names a bucket on the bot and the worker
    When a new quiz's clips are recorded
    Then each clip is stored in that bucket as quiz-audio/<env>/<quiz>/<lang>/<question>/<part>-<voice>-<hash>.ogg
    And the quiz remembers the bucket, so its clips keep playing after the variable changes
    And a quiz recorded before this change keeps playing from the bucket it was recorded in

  @WQ074 @T284
  Scenario: Recording quiz audio can be switched off and is capped per day
    Given app_settings web_quiz_audio_enabled is false, or today's recorded quizzes have reached web_quiz_audio_daily_cap
    When a quiz's page is opened
    Then no clip is recorded and the job does not retry, and the page reads with the words big
    And reaching the cap is logged as web_quiz_audio.capped

  @WQ075 @T370
  Scenario: A child who loses the internet at the end still sees their score
    Given a child answered every question and the phone then lost its connection
    When the quiz ends
    Then the results screen shows the score the phone worked out ("You got 3 out of 5") with its stars
    And it says "Your results will reach your teacher when you are back online." («انٹرنیٹ واپس آتے ہی آپ کا نتیجہ استاد تک پہنچ جائے گا۔»)
    And no "No internet right now" error screen is shown
    And Jugnu is on that screen celebrating, though the phone is offline (the picture was fetched while question 1 was on screen)

  @WQ076 @T371
  Scenario: The result is sent by itself when the connection comes back
    Given a child finished the quiz offline and the results screen says the result will reach the teacher
    When the phone is back online (or the child taps "Send now", or a minute passes)
    Then the result is sent without the child doing anything else
    And the screen changes to the real results with "See my card" and "See my class"

  @WQ077 @T372
  Scenario: A tab closed before the result was sent sends it on the next open
    Given a child finished the quiz offline and closed WhatsApp before the connection came back
    When the child opens the same quiz link again with internet
    Then the page sends the result and opens the results, never "Go on: question 5 of 5"

  @WQ078 @T373
  Scenario: A flapping or very slow connection loses no answer and records none twice
    Given the connection drops and returns every few seconds, or each request takes over a second
    When a child plays the whole quiz
    Then every answer is recorded exactly once and the results arrive
    And a result sent up to a week later is still accepted

  @WQ079 @T374
  Scenario: The next questions' pictures and voice are fetched ahead of time
    Given a child is on question 1 of a quiz with pictures and recorded voice
    When the question has been on screen for a moment
    Then the pictures and recorded clips of questions 2 and 3 are already being fetched
    And question 1's own voice is never kept waiting for them

  @WQ080 @T445
  Scenario: A practice round that beats the child's best says so
    Given a child finished a quiz with 3 of 5 and later practised it with 4 of 5
    When the child practises again and gets 5 of 5
    Then the scorecard still says the first score 3/5 is the one that counts
    And it adds "New best! 5/5 · was 4/5 ⭐" («نیا ریکارڈ! 5/5 · پہلے 4/5 ⭐»)
    And a practice round equal to or below the best adds nothing

  @WQ081 @T265
  Scenario: A classmate's right answer shows as one quiet line while a child plays
    Given two children of a grade-3 class are playing the same class link
    When one child, Sara, answers question 4 right
    Then the other child's page shows "Sara got Q4 right ✓" («سارہ نے سوال 4 ٹھیک کیا ✓») under the progress bar for 2.5 seconds
    And the line never covers an option or the listen button, never takes a tap, moves nothing on the screen and makes no sound
    And it never shows in the first 3 seconds of a question, and at most once every 20 seconds

  @WQ082 @T266
  Scenario: Only right answers, only first names, and a friend stays nameless
    Given a class-link child, an invited friend and the teacher's own preview are playing the same quiz
    When each of them answers questions right and wrong
    Then a wrong answer never shows on anyone's page, and a child never sees their own answers
    And the invited friend shows as "A friend got Q2 right ✓" («ایک دوست نے سوال 2 ٹھیک کیا ✓»), never by name
    And the teacher's preview answers never show, and no surname ever shows

  @WQ083 @T267
  Scenario: A child thinking on one question still sees classmates play
    Given a child has had question 3 on screen for more than 15 seconds without answering, with the page in front
    When a classmate answers a question right
    Then the line appears within about 15 seconds
    And the page asks at most 8 times for that question, and stops asking once the child answers or leaves the page

  @WQ084 @T268
  Scenario: No peer line for grades 1 and 2, in the teacher's preview or on a quiet page
    Given a grade-1 quiz, or the teacher's own preview link, or a page with sounds turned off (🔕)
    When a classmate answers right
    Then no peer line shows and the page never asks for one
    And a quiz with no grade shows the line as for grade 3

  @WQ085 @T269
  Scenario: The peer line costs no extra database reads
    Given 30 children of one class are playing at the same time
    When they answer questions
    Then their classmates' lines come back inside the answers they already send
    And a child's idle check is answered from the bot's memory, with no database read for the session

  @WQ086 @T440
  Scenario: The landing says when classmates are playing right now
    Given at least two children of this class got a question right in the last 2 minutes
    When a child opens the class link
    Then the landing says "3 classmates are playing right now — join them!" («ابھی 3 ہم جماعت کھیل میں شامل ہیں — آپ بھی آئیں!»), a number and never a name
    And with one or none it says nothing, and a friend's challenge link never shows it

  @WQ087 @T441
  Scenario: The card says how many children of the class finished today, never the child's place
    Given two classmates finished this quiz earlier today
    When a child finishes it for the first time
    Then the card says "3 children in your class finished this quiz today." («آج آپ کی کلاس میں ۳ بچوں نے یہ کوئز مکمل کیا۔»), and the first says "You finished this quiz today!" («آج آپ نے یہ کوئز مکمل کر لیا۔») — a count, never the child's place
    And a practice round, an invited friend and the teacher's preview get no such line
  @WQ088 @T420
  Scenario: A picture question whose picture cannot be drawn for one option plays as words
    Given a picture question where one option's picture does not exist
    When a child opens the question on a phone, in English or in Urdu
    Then the options show as a list of words, each word shown once
    And no word is painted over another

  @WQ089 @T421
  Scenario: Every item shape the quiz engine can write renders on a phone
    Given every question shape the engine can write (every picture kind, every question type, two to four options, long questions and options, maths, glyph and picture tiles, a picture that cannot be drawn), in English and in Urdu
    When each is opened on a 360 by 740 phone screen and then answered
    Then nothing scrolls sideways or runs off the screen, no text is cut off or covers other text, and every option shows a word or a picture
    And maths shows as typeset maths, never as "$" or a backslash command
    And Urdu text is set in the Nastaliq face, and every picture is drawn or left out as documented

  @WQ090 @T293
  Scenario: Maths from real questions is typeset, never spelled out
    Given a question whose stem, options or reason carry "$60\ \Omega$", "$67, 62, 57, \dots$", "$9 \div 3 \neq 3 \div 9$", "$A \rightleftharpoons B$", "$14 \xrightarrow{\div 2} 7$" or "$\text{Rs } 40$"
    When a child opens it, in English or in Urdu
    Then the child sees "60 Ω", "67, 62, 57, …", "9 ÷ 3 ≠ 3 ÷ 9", "A ⇌ B", an arrow with "÷ 2" over it and "Rs 40"
    And never the words "Omega", "dots", "neq" or "rightleftharpoons"
    And a long maths line scrolls inside its own box, starting at its beginning, instead of running off the screen

  @WQ091 @T294
  Scenario: A column sum option is shown as a column sum
    Given an option written as a column subtraction of 460 from 712 with a rule under it
    When a child opens the question
    Then the option shows 712 above "- 460" and a line under them, right-aligned

  @WQ092 @T295
  Scenario: A picture file that does not arrive never shows a broken picture
    Given a question whose picture file does not arrive
    When a child opens it
    Then the picture box disappears and the question plays on its words, with no broken-picture icon or picture caption

  @WQ093 @T296
  Scenario: A label question whose answer rings fall outside its picture offers its parts as words
    Given a label question one of whose answer rings lies outside its drawing, or that has no rings
    When a child opens it
    Then the parts are offered as ordinary answer buttons and no ring is drawn off the picture

  @WQ094 @T297
  Scenario: The render check sees both answers and every real kind of maths
    Given the render check over every question shape the engine can emit, in English and Urdu
    When it plays each one on a 360 by 740 phone
    Then it checks the screen after a wrong pick and after the right pick, and fails on a maths command spelled out in letters

  # ── Jugnu's Challenge (/c/<hub token>): "Which is bigger?" and "Read aloud" ──
  @WQ095 @T385
  Scenario: The Challenge menu shows only the exercises that are built
    Given app setting "web_quiz_challenge" is on and a grade 3 child opens the Challenge from the hub
    Then the page is titled "Jugnu's Challenge" («جگنو کا چیلنج») and shows two tiles: "Which is bigger?" and "Read aloud"
    And no "coming soon" tile, and never the words EGRA, EGMA, test or assessment
    And a finished exercise shows its last result on its tile ("✓ 7 / 10", "✓ 42 words a minute")

  @WQ096 @T386
  Scenario: A child outside grades 2 to 5 is not offered the Challenge
    Given the child's class list is grade 7
    When the Challenge link is opened
    Then the page says "This challenge is for classes 2 to 5." and no exercise starts

  @WQ097 @T563
  Scenario: The hub shows the Challenge tile only to a child the Challenge accepts
    Given app setting "web_quiz_challenge" is on
    And a child with no class list, no class of their own and no enrolment, whose quizzes were all for a band of grades such as "3-5"
    When the child opens their hub
    Then there is no Challenge tile, so no tap ends on a refusal
    And the video library and the recommended videos still show
    And a child enrolled in a grade 3 class sees the tile and the Challenge opens

  @WQ098 @T387
  Scenario: "Which is bigger?" is scored again on the server with the 4-in-a-row stop
    Given a child plays the 2 practice pairs (with "Yes! 8 is bigger." feedback) and then the 10 pairs of the grade form
    When the child misses 4 pairs in a row (a wrong tap, or no tap within 10 seconds)
    Then the phone shows no more pairs and sends its taps
    And the server re-applies the stop rule, ignores any tap after it, and answers the score
    And the result says "You got 2 out of 10!" («۱۰ میں سے ۲ صحیح!») with "More challenges" and "Try again"

  @WQ099 @T388
  Scenario: Read aloud records 60 seconds and shows words per minute
    Given the phone's browser allows the microphone
    When the child taps "I'm ready", hears "Ready? Begin." and reads the story shown large
    Then a 60-second countdown runs with a "Done" button that stays on screen
    And the recording goes straight to storage by a presigned upload, never through the portal
    And the result says "You read 42 words in a minute!" («آپ نے ایک منٹ میں ۴۲ لفظ پڑھے!»)

  @WQ100 @T389
  Scenario: Words per minute count only the time used when the child finishes the story early
    Given a child reads all 60 words in 30 seconds
    Then words per minute = 60 / (60 − 30) × 60 = 120
    And a child who taps "Done" before the end of the story is counted over the full minute (EGRA)

  @WQ101 @T390
  Scenario: A child with nothing right in line 1 is stopped and encouraged, never shown 0
    Given the scorer finds no word of the story's first line read correctly
    Then the run is stored with 0 words per minute and "stopped"
    And the page says "Good try! Reading gets easier every day you practise." with no number

  @WQ102 @T391
  Scenario: WhatsApp's browser cannot give the microphone
    Given the microphone is refused, or the browser has no getUserMedia or MediaRecorder
    When the child taps "I'm ready"
    Then the page says "Your WhatsApp browser can't use the microphone." («آپ کا واٹس ایپ براؤزر مائیک استعمال نہیں کر سکتا۔»)
    And offers "Open in Chrome" (Android) and "Skip this one", and logs web_quiz.ch_mic with ok false and the error name

  @WQ103 @T392
  Scenario: A child's recording is scored and forgotten; slow scoring is polled
    Given scoring a reading takes more than 5 seconds
    Then the result call answers "pending" and the page asks again every 3 seconds, up to 60 seconds
    And the recording is deleted from storage after scoring, and only the numbers are kept

  @WQ104 @T531
  Scenario: A reading where nothing was heard is never praised
    Given the scorer hears no word of the story attempted
    Then the run is stored as failed "unheard", with no words-per-minute and no tick on the Read aloud tile
    And the page says "We couldn't hear that clearly. Try again?" («آواز صاف سنائی نہیں دی۔ دوبارہ کوشش کریں؟») with "Try again"

  # ── The record rule and the read guard (app settings web_quiz_challenge_record / _read_guard / _items, each off by default) ──
  @WQ105 @T703
  Scenario: Under the record rule the first scored attempt is the child's record and the menu shows no number
    Given app setting "web_quiz_challenge_record" is on and a child has played "Which is bigger?" twice
    Then the second run is stored as attempt 2 and not counted, and the result carries no "last time"
    And the Challenge menu ticks the tile ("✓ Done" / «✓ ہو گیا») from the first run and shows no score on any tile
    And the class results name the first scored run per child and exercise, never a later one or an early-stopped reading
    And the bigger number sits second on exactly half of the form's pairs, the same for every child

  @WQ106 @T704
  Scenario: Under the read guard the microphone is checked on the phone before the minute
    Given app settings "web_quiz_challenge_record" and "web_quiz_challenge_read_guard" are on and the phone allows the microphone
    When the child taps "I'm ready"
    Then Jugnu says "Say "Jugnu!" so I can hear you." («"جگنو!" کہیں تاکہ میں آپ کو سن سکوں۔») and listens for 3 seconds on the phone itself
    And nothing is recorded or uploaded during the check
    And a voice starts the reading; silence says "Jugnu can't hear you yet." («جگنو کو ابھی آپ کی آواز نہیں آ رہی۔») with "Try again" and "Skip this one"

  @WQ107 @T705
  Scenario: Under the read guard the minute has no Done and no countdown, and "too hard" opens after the first line's window
    Given the microphone check passed
    Then the story appears only when the recording starts, with no countdown and no "Done" button
    And "The rest is too hard" («آگے بہت مشکل ہے») is absent for the first 20 seconds, then offered
    And tapping it ends the reading as "stuck", and Home during the minute first asks "Stop reading?" («پڑھنا روکیں؟»)

  @WQ108 @T706
  Scenario: A reading the child ended early is stored as incomplete, never as words per minute
    Given the child stopped after 43 seconds with the story unfinished
    Then the run is stored as failed "incomplete" with the seconds read and the words read, and no words-per-minute
    And the page says "You read 35 words. Read for the whole minute to get your number!" («آپ نے ۳۵ لفظ پڑھے۔ اپنا نمبر پانے کے لیے پورا منٹ پڑھیں!») with "Try again"
    And a stop inside the first 15 seconds is stored as "abandoned": an exposure, not an attempt
    And a full minute says "You read for the whole minute!" («آپ نے پورا منٹ پڑھا!») with the words per minute

  @WQ109 @T707
  Scenario: Silence after a passed microphone check is a stopped reading, not "unheard"
    Given the microphone check passed and no word is heard for 10 seconds
    Then the reading ends itself as "silent" and is stored as stopped with 0 words per minute
    And the page says "Good try! Reading gets easier every day you practise." with no "Try again"

  @WQ110 @T764
  Scenario: A reading's length is its own audio, never the last reading's
    Given a child's first reading ended after 10 seconds and the child taps "Try again" in the same page
    When the child reads for 40 seconds
    Then the page reports 40 seconds for the second reading, not 10
    And the server measures a recording that has no duration header by decoding it, and scores the whole 40 seconds
    And the run keeps the page's number beside the measured one, and logs when the two differ

  @WQ111 @T708
  Scenario: With items on, the row keeps per-item verdicts and timings, numbers only
    Given app settings "web_quiz_challenge_record" and "web_quiz_challenge_items" are on
    When a child plays "Which is bigger?"
    Then the row keeps, per pair, which side held the bigger number, the verdict and the tap's milliseconds
    And a run with three or more fast wrong taps is marked rapid, a stop made of untouched pairs abandoned, and a submit faster than its own taps too fast
    And a reading's row keeps the scorer's per-word verdicts and its doubt, never a word heard
    And every row says where the child's grade came from and whether the child is a test child
    And Jugnu does not celebrate, and the teacher's class results do not list it
    But a reading with words heard and none right says "Good try! Reading gets easier every day you practise." with no number

  @WQ112 @T751
  Scenario: With keep on, a reading is kept private under one dated prefix and its row says where
    Given app setting "web_quiz_challenge_keep_audio" is on
    When a child reads aloud
    Then the recording goes to the private child-voice bucket under child-voice/<env>/kept/<upload day>/<run>/, never a public link
    And scoring keeps it, whether the reading scored, failed or was unheard, and the run row keeps its key and nothing about the child
    And nothing under the kept prefix is deleted by scoring, a refused upload or the hourly orphan sweep: only the purge removes it
    But with the setting off a reading is scored and deleted, as before

  @WQ113 @T752
  Scenario: Kept readings leave by one purge command, dry run first
    Given kept readings from 8 and 9 October
    When the purge runs for this deployment's env with no --apply
    Then it prints how many readings it would delete per day and deletes nothing
    And with --from/--to it counts only those days, and with --apply it deletes exactly those and each run row stops naming its reading
    And it refuses without --env or with another deployment's env, and prints no key, run id, name or phone

  @WQ114 @T720
  Scenario: The trail and Missing number stay off without the record rule
    Given app settings "web_quiz_challenge_trail" and "web_quiz_challenge_missing" are on and "web_quiz_challenge_record" is off
    When a child opens Jugnu's Challenge
    Then the menu and every exercise are exactly today's, with no trail and no "Missing number"
    And opening "Missing number" directly answers that it is off

  @WQ115 @T721
  Scenario: The trail shows each stop with a finish badge for its first play, whatever the score
    Given app settings "web_quiz_challenge_record" and "web_quiz_challenge_trail" are on
    And a child's first "Which is bigger?" run was stopped by four misses in a row
    When the child opens Jugnu's Challenge
    Then the page says "Jugnu's Trail" and "1 of 4 stops done. Pick any stop!"
    And "Which is bigger?" is gold with "Done", the next unplayed stop says "Next", and "Read aloud" says it uses the microphone
    And no score, words a minute, streak, rank or countdown is on the map

  @WQ116 @T722
  Scenario: Missing number is typed on a keypad and scored two ways on the server
    Given app settings "web_quiz_challenge_record" and "web_quiz_challenge_missing" are on
    When a Grade 3 child plays "Missing number": two practice rows with feedback, then ten rows with none
    Then each row is four numbers left to right with one gap, typed on a keypad no longer than the answer
    And "Skip" appears only after 5 seconds and counts as a miss
    And four misses in a row end the run, on the phone and again on the server, whatever the phone sent after
    And the row stores the count right at any time and the count right with the first key inside 5 seconds
    And each item's time runs from the moment its row is painted

  @WQ117 @T723
  Scenario: A stop played again is a practice round
    Given the trail is on and a child has already played "Missing number" once
    When the child plays it again
    Then every screen of that run says "Practice round. Play as much as you like!"
    And the run earns no new badge and its row is not counted

  @WQ118 @T724
  Scenario: A phone without a microphone sees those stops waiting, never failed
    Given the trail is on and the phone has no microphone, or the browser says it is denied
    When the child opens Jugnu's Trail
    Then "Read aloud" is grey with "needs a microphone"
    And tapping it says "This stop needs a microphone. It will wait for you!" with "Go to another stop", and never offers Chrome
    And the trail is finished when every stop the phone can play is done
    But a dismissed or timed-out microphone prompt is not remembered, and "Try the microphone again" asks again

  @WQ119 @T725
  Scenario: "On your own, or with help?" is asked once per sitting
    Given the trail is on
    When a child opens their first stop of the sitting
    Then the page asks "On your own, or with help?" with neither answer chosen
    And the answer is kept on each run of the sitting, and the badge comes either way

  @WQ120 @T726
  Scenario: Numbers on the trail are Western digits in Urdu too
    Given the trail is on and the child plays in Urdu
    Then every number the page writes is a Western digit set left to right, like the keypad

  @WQ122 @T727
  Scenario: With the Urdu polish on, the old challenge menu writes Western digits too
    Given app setting "web_quiz_ur_polish" is on and the trail is off
    When a child opens Jugnu's Challenge in Urdu
    Then the minutes, the counters and the scores are Western digits set left to right
    But with the polish off the page keeps today's Urdu digits, and English never changes

  @WQ121 @T753
  Scenario: Listen and answer reads each answer option aloud, with a play button that never answers
    Given app setting "web_quiz_challenge_option_audio" is on and a child is on a Listen question
    Then each option has its own 🔊 button beside it ("Hear this answer" / «یہ جواب سنیں»), separate from the option itself
    And after the question is read, the options are read in turn in the quiz voice, the option being read lit up
    And tapping 🔊 plays that option and answers nothing
    And tapping an option answers at once and stops the reading
    And an option whose clip is not recorded yet shows no 🔊 and is skipped in the reading
    But with the setting off the options are printed only, as before

  @WQ123 @T532
  Scenario: Today's read-aloud cap leaves "Which is bigger?" only
    Given app_settings web_quiz_challenge_daily_reads is 500 (or absent) and 500 read-alouds have been scored since Pakistan midnight
    Then the Challenge menu shows only "Which is bigger?"
    And a reading already open is answered "enough for today", and its uploaded recording is deleted
    And web_quiz.ch_read_capped is logged once that day

  @WQ124 @T580
  Scenario: Read aloud live: the words light up as the child reads and the words-a-minute bar moves
    Given app_settings web_quiz_challenge_realtime is true and the microphone is allowed
    When the child taps "I'm ready" and starts to read
    Then the page streams the microphone to speech-to-text with a one-run key the bot minted, sent in the stream's first message and never in a URL
    And each word read turns green as it is heard, and a word passed over is marked "not caught" in soft amber, never red
    And a bar at the top shows the words a minute («ایک منٹ میں لفظ») as the child reads, with last time's mark when there is one
    And no word on the page is "test", "exam" or "assessment"

  @WQ125 @T581
  Scenario: Read aloud live: the result shows the moment the reading ends, and the checked count follows
    Given a child reading live reaches the last word, or the minute ends, or taps "Done"
    Then "You read N words in a minute!" shows at once, with the coloured story and its key
    And the recording still goes up by presigned upload and is scored the usual way, with the live numbers kept beside the score
    And when the checked count differs by 3 or more the line becomes "Jugnu listened again: M words a minute!" («جگنو نے دوبارہ سنا: ایک منٹ میں M لفظ!»)
    And "more words than last time" and the bar's "last time" compare checked counts of readings in the same language only
    But a checked "nothing heard" replaces the praise with "We couldn't hear that clearly. Try again?"

  @WQ126 @T582
  Scenario: Read aloud live falls back to today's reading whenever the live stream cannot run
    Given the live switch is on
    When the key cannot be minted, the stream is refused (for example the stream limit), or it drops during the reading
    Then the child keeps reading without a break and the result comes from the upload, as before the live switch
    And web_quiz.ch_live is logged with ok false and the reason

  @WQ127 @T583
  Scenario: A live key is one per run and counts toward today's readings
    Given a child has read aloud 10 times in the last 24 hours, or today's read-aloud cap is reached
    Then no live key is minted ("enough for today")
    And a second key for the same run is refused, and the run's one result is accepted once
    And with app_settings web_quiz_challenge_realtime absent or not true, the page asks for no key at all

  @WQ128 @T584
  Scenario: Questions after Read aloud, only about the part the child read
    Given app_settings web_quiz_challenge_questions is true and a child's reading was praised
    When the child taps "Answer questions about the story" («کہانی کے بارے میں سوال»)
    Then up to 3 of the story's own questions are asked, only those about lines the child reached
    And each question is read aloud by the mascot and has 3 options: the story's accepted answer and two of its listed wrong answers, in the story's language
    And a child stopped by the first-line rule, or a reading not heard, is offered no questions

  @WQ129 @T585
  Scenario: Each tap is checked by the server and the total is shown
    Given a child is answering the questions after Read aloud
    When the child taps an option
    Then the page asks the server, which never sends the answers in advance
    And a right tap shows "Yes!" («جی ہاں!») and a wrong one shows "The answer was: …" («جواب تھا: …») with the right option marked
    And after the last question the page says "You got 2 of 3 right!" («آپ نے ۳ میں سے ۲ کے صحیح جواب دیے!»)
    And only the numbers asked and correct are kept with the reading; a question counts once

  @WQ130 @T626
  Scenario: Every tap is kept even when the checked score lands between two taps
    Given a child is answering the questions after Read aloud while the reading's checked score is still being worked out
    When the checked score is stored between two of the child's taps, on any server
    Then the stored reading keeps every answer the child gave and the number asked equals the taps shown on the page
    And a tap stored while the checked score is written never removes the score's own details (the live count, the cost)
    And the checked score itself is always stored, even when the reading keeps changing under it

  @WQ131 @T586
  Scenario: Questions are off unless switched on
    Given app_settings web_quiz_challenge_questions is absent or not true
    Then the Read aloud result offers no questions, and the question calls answer "questions_off"

  @WQ132 @T587
  Scenario: Listen and answer plays the story twice and never shows its text
    Given app_settings web_quiz_challenge_listen is true and the listening story's clip is recorded
    When the child opens "Listen and answer" («سنیں اور جواب دیں») and taps "Listen" («سنیں»)
    Then the story is played twice in the quiz voice, and its text is never sent to the page
    And then up to 3 of its own questions are asked as taps, each checked by the server
    And the total says "You got 2 of 3 right!" and the run is stored as listen with its numbers only

  @WQ133 @T588
  Scenario: Listen and answer is offered only when the story can be heard
    Given app_settings web_quiz_challenge_listen is absent or not true, or the story's clip is not recorded yet
    Then the Challenge menu has no "Listen and answer" tile, and a missing clip starts recording for the next time
    And a story that will not play says "The story won't play right now. Try another challenge." with More challenges

  @WQ134 @T589
  Scenario: Only listening questions a person has reviewed as taps are asked
    Given the listening questions in the item bank
    Then a question whose accepted answer is circular, or whose wrong answers the story also supports, is never asked
    And for "What did Ayesha clean?" («عائشہ نے کیا صاف کیا؟») the whole class («کلاس») is never a wrong option
  @WQ135 @T491
  Scenario: A shared phone reopened on a finished child's card lets the next child play
    Given a phone where "Tooba" finished this quiz and the page reopens on Tooba's card
    Then the card offers "Someone else's turn" («کسی اور کی باری»)
    When the next child taps it
    Then the page shows "Who is playing?" with the remembered cards and "Someone else"
    And Tooba's finished result is unchanged on the server
    But while answers are still waiting to be sent the card does not offer it
  @WQ136 @T442
  Scenario: An invited friend never sees the class through the peer line
    Given a friend plays through a child's challenge link while the class is playing
    When classmates answer questions right
    Then the friend's page shows no classmate's name, its idle check returns nothing, and its landing has no "classmates playing now" line
    And the class still sees the friend's right answers as "A friend got Q2 right ✓"

  @WQ137 @T443
  Scenario: No peer line in the early years
    Given a quiz graded NURSERY, KG, PG, 1, 2 or a band starting with 1 or 2
    When a classmate answers right
    Then no peer line shows and the page never asks for one
    And a quiz graded 3 or above, or with no grade at all, shows it
  @WQ138 @T447
  Scenario: A friend opening a challenge sees the challenger, never the challenger's class
    Given a child of "Class 3" sent a friend their challenge link
    When the friend opens it on their own phone
    Then the page names only the challenger and their score
    And it shows no teacher name, no class label, no class names to pick from and no "N in your class played today"

  @WQ139 @T255
  Scenario: A child's shared card arrives in the group as a picture, even from WhatsApp's own browser
    Given a child finished a quiz on the page inside WhatsApp (no share sheet)
    When the child taps "Share to class group" and sends the WhatsApp message
    Then the message carries the class link with the card's picture id ("/q/<CODE>?a=…")
    And the group's link preview shows the child's card (name, animal, score, stars, topic) at 1200×630
    And the link still opens the class quiz, so a classmate who taps it counts in the teacher's report
    And the share screen shows the same picture and offers "Save the picture"

  @WQ140 @T256
  Scenario: A browser that can share files sends the picture with the message
    Given a phone browser that supports sharing an image file
    When the child taps "Share to class group", "Challenge a friend" or "Share the class table"
    Then the square picture (card, invite or class) is attached to the message with the link
    And when the picture is not ready yet the text and link go at once, never a wait

  @WQ141 @T257
  Scenario: A challenge link previews as the invite
    Given a child scored 7/8 and sent "Challenge a friend"
    When the friend's WhatsApp shows the link preview
    Then the preview reads "Can you beat <first name>'s 7/8?" with the topic and the mascot, in the quiz's language
    And no other child's name and no list number is on the picture

  @WQ142 @T258
  Scenario: The class picture never names a classmate
    Given a class where several children have finished
    When a child shares the class table
    Then the picture shows places, animals and scores, how many children played and the class average
    And only the sharing child's own row carries a name, marked "(me)"
    And the picture is in Urdu, right to left with numbers left to right, when the quiz is Urdu

  @WQ143 @T259
  Scenario: A video quiz ends on the scorecard with "Watch more" first
    Given a child finishes the quiz of a video (a teacher's video quiz or one picked from "Watch another video")
    When the scorecard opens
    Then it says "Video quiz" («ویڈیو کوئز») above the child's name
    And "Watch another video" comes first, then "Share to class group", "Challenge a friend" and the class
    And a quiz with no video keeps its scorecard as before

  @WQ144 @T260
  Scenario: The next video of the chapter waits on the scorecard
    Given the bot names the next unfinished video of this chapter when the child finishes
    When the scorecard opens
    Then that video shows between the score and the share buttons under "Next in this chapter"
    And tapping it opens that video and its quiz, the child still remembered
    And nothing is shown when the chapter and the subject have nothing left

  @WQ145 @T261
  Scenario: The school league share arrives as this hour's board
    Given a child's school is on the school league this week
    When the child shares the school league
    Then the group's preview shows the school among its neighbours, highlighted, with points, children and moves, and no child or teacher named
    And the link carries the hour, so a group that shared it earlier sees the board as it is now
    And the child's card says how many points this play added to the school ("+17 points for <School>")

  @WQ146 @T262
  Scenario: A link a teacher forwards to remind the class previews as the class filling up
    Given a teacher sends "/q/<CODE>?v=<number played>" to the class group
    Then the group's preview shows the live class picture (places, animals, scores, no names)
    And the plain "/q/<CODE>" link keeps the quiz's own picture
    And a league table shared from the page carries "?v=<number finished>" for the same reason

  @WQ147 @T263
  Scenario: The invited friend's page shows the picture their link previewed as
    Given a friend opens a challenge link whose preview read "Can you beat Amal's 7/8?"
    When the page opens
    Then the same picture sits above the challenge line, its alt text the same words
    And if the picture cannot load it is removed, never shown broken


  @WQ148 @T300
  Scenario: A child typing /quiz on WhatsApp gets one Open button to their hub when the hub is on
    Given app_settings web_quiz_hub is on and a phone with one registered child who has played a quiz
    When the child sends /quiz
    Then exactly one WhatsApp message arrives: "Your quizzes, videos and challenges are here." with one "Open" button («کھولیں»)
    And the button opens <portal>/h/<token>, a link that names only this phone's own children and lasts 7 days
    And with web_quiz_hub off the same /quiz gets today's Flow or two buttons, unchanged

  @WQ149 @T301
  Scenario: A phone with siblings asks "Who is playing?" with only its own children
    Given a phone with two registered children
    When the hub link is opened
    Then the first screen is "Who is playing?" («کس کی باری ہے؟», gender-neutral) with the two children's first names and animals
    And no classmate or other child is ever offered
    And tapping a name opens that child's hub, with "Switch player" to go back

  @WQ150 @T562
  Scenario: Siblings who play in different languages each get their hub in their own language
    Given a phone with two registered children, one who played in English and one who played in Urdu
    And the hub link opens in the other child's language
    When "Who is playing?" is answered with one child's name
    Then that child's hub is in that child's language: the greeting, the cards, "Switch player" and the challenge tile
    And the page direction follows it (right to left for Urdu, left to right for English)
    And the library and challenge open in that child's language
    And before a name is picked, "Who is playing?" stays in the language the link opened in

  @WQ151 @T302
  Scenario: The hub shows the newest quiz from the child's teacher, or a warm empty state
    Given a child whose teacher sent a quiz for their grade in the last 7 days that they have not finished
    When the child opens their hub
    Then the top card says "From your teacher" with the topic, the subject and when it was sent, and a Play button
    And Play opens that quiz already as this child, with no "Whose turn?"
    And with no such quiz the card says "No new quiz from your teacher right now. Watch a video and try its quiz!" with the video library button
    And a quiz with no grade, or another grade, is never shown as the teacher's

  @WQ152 @T540
  Scenario: The hub's teacher card puts the quiz handed to the child's own class first
    Given a teacher handed a grade 3-5 quiz to class 3-A and later sent another grade 3-5 quiz to no class in particular
    When a child enrolled in 3-A opens their hub
    Then "From your teacher" shows the quiz handed to 3-A, even though the other one is newer
    And a child of 3-B never sees the quiz handed to 3-A
    And the same lesson the child already finished in the other language is never shown as new
    And of two quizzes for the class, the one in the child's language comes first

  @WQ153 @T303
  Scenario: Play again shows the child's best score and keeps the first score for the teacher
    Given a child who finished a quiz twice, scoring 4/10 and then 8/10
    When the child opens their hub
    Then "Play again" lists that quiz with "Best 8/10 · 2 tries", newest quizzes first, at most 6, closed quizzes left out
    And a note says the first score is the one the teacher sees
    And tapping it opens the quiz on its start screen as a fresh attempt for this child, never the old scorecard
    And answers still waiting to be sent from an earlier attempt are never cleared

  @WQ154 @T304
  Scenario: Three recommended video quizzes follow the child's last topic
    Given a child whose last finished quiz was a grade 3 Maths video in the chapter "Fractions"
    When the child opens their hub
    Then "Try these next" shows 3 video quizzes the child has not finished: the same chapter first, then the next chapters in the video menu's order, then the rest of Maths
    And when Maths runs out, the list is filled from grade 3's other subjects in the menu's order
    And a child with no finished quiz sees the first video of each subject of their grade
    And each card shows the video's poster (or the subject's tile), title, subject and chapter

  @WQ155 @T305
  Scenario: An expired or tampered hub link shows a closed page that tells the child what to do
    Given a hub link older than 7 days, or one whose signature does not match
    When it is opened
    Then the page says "This link has expired" and "Send /quiz on WhatsApp to get a new one." in the child's language
    And no child's name or quiz is shown

  @WQ156 @T530
  Scenario: A forwarded hub link shows no child's name on another phone
    Given a family's phone opened its /quiz hub link first and saw its children
    When the same link is opened on a second phone that has never played as one of them
    Then the page says "This link was sent to another player" and "Ask the child this link was sent to to open it." («جس بچے کو یہ لنک بھیجا گیا تھا، اُس سے کہیں کہ اسے کھولے۔»)
    And no child's name, animal, teacher quiz, past quiz or recommendation is shown, and nothing can be played as them
    And "Someone else / new player" («کوئی اور / نیا کھلاڑی») says to ask the teacher for a quiz link or send /quiz on WhatsApp from the family's phone
    And the family's own phone, and any phone a child of that family has already played on, still sees the hub unchanged
    And the hub's Challenge link (/c/<link>?kid=…) opened on that second phone shows the same neutral note, with no past result and nothing to play as the child
  @WQ157 @T446
  Scenario: A challenger who scored nothing is not a score to beat
    Given a child finished a quiz with 0 right answers and sent a friend their challenge link
    When the friend opens the link
    Then the landing says "<challenger> challenged you. Can you beat their score?" («… نے آپ کو چیلنج کیا ہے۔ اب آپ کی باری!»)
    And it never says "0/5 stars. Can you beat it?"
    And the friend's landing never says how many of the class played today (the friend is not in that class)
  @WQ158 @T449
  Scenario: A friend who played a challenge never reaches the challenger's class table
    Given a friend finished a quiz through a classmate's challenge link
    Then the friend's scorecard offers "Challenge a friend" and "School league" but not "See my class" or "Share to class group"
    And the "Quiz complete" screen offers no "See my class"
    And the class table of a challenge code answers "not found", both as /q/<challenge code>/class and through the page's API
  @WQ159 @T445b
  Scenario: The invite picture and its link title never guess the friend's gender, and never dare a zero
    Given a child sent a challenge link
    When the link previews in Urdu
    Then it reads «<name> کے 4/6 سے آگے نکلیں!» (an imperative), never «کیا آپ … سکتے ہیں؟»
    And when the challenger scored 0 the picture and the title say "<name> challenged you!" («<name> نے آپ کو چیلنج کیا ہے!») with no score



  @WQ160 @T395
  Scenario: An English quiz that quotes an Urdu word keeps one voice
    Given an English quiz whose questions quote the teacher's Urdu glosses (for example «سرکل»)
    When a child answers a question and when the quiz ends
    Then the feedback lines ("Yes! That's right!", "Quiz complete!") are English, in the same voice as the question clips
    And an Urdu quiz keeps its Urdu feedback lines even when its page is opened from an English class


  @WQ161 @T375
  Scenario: "Watch another video" opens the quiz's own subject as chapters, at once
    Given the video library is on and a child is looking at their result or scorecard
    When the child taps "Watch another video"
    Then the chapters of the quiz's own subject and grade are shown at once, in the WhatsApp Flow's order
    And each lesson shows its poster (or the subject's picture until it loads), its title, minutes and MB, and "Done ✓" when finished

  @WQ162 @T376
  Scenario: Subjects with pictures and a grade strip
    Given the library is showing a subject's chapters
    When the child taps "Subjects"
    Then the subjects of the child's grade are shown as picture tiles, two to a row, each with its number of videos
    And a strip of grades with pictures sits above them, the child's grade selected and in view
    When the child taps another grade
    Then that grade's subjects are shown

  @WQ163 @T377
  Scenario: A lesson the class already has opens without waiting
    Given the class already has a code for a lesson in the library
    When the child taps that lesson
    Then the lesson's page opens straight away and starts as the same child, with no name to pick

  @WQ164 @T378
  Scenario: A class's first play of a lesson still gets its own code
    Given no child of the class has played a lesson yet
    When a child taps it in the library
    Then one code is made for that class and lesson, and the lesson's page opens as the same child

  @WQ165 @T379
  Scenario: A child downloads a lesson's video
    Given the library is on
    When a child taps "⬇ Download (12.4 MB)" on the video screen, or "⬇ Download" on a lesson in the library
    Then the phone saves the video under a clean file name
    And in WhatsApp's browser the child is also offered "Open in Chrome" in case the download does not start

  @WQ166 @T380
  Scenario: The library is off
    Given the video library is off
    When a child taps "Watch another video"
    Then today's list of up to 8 lessons is shown, exactly as before, and no Download button appears

  @WQ167 @T381
  Scenario: The library in Urdu
    Given an Urdu quiz
    When the child opens the library
    Then subject and grade names, counts, "Done" and "Download" are in Urdu, and sizes read left to right

  @WQ168 @T382
  Scenario: The library from the kid's hub
    Given a child opened their hub from WhatsApp and the video library is on
    When the child taps the Library tile
    Then the subjects of the child's grade are shown, with no names of other children anywhere
    When the child taps a lesson the class already has a code for
    Then that lesson's page opens and starts as the same child, with no picking
    And a lesson the class has never played gets its code first, from the newest quiz the child played from their teacher
    And a child who has not played any quiz from their teacher yet is told to play one first, and stays in the library

  @WQ169 @T383
  Scenario: The scorecard of a video quiz names the next lesson
    Given the video library is on and a child finishes a video quiz
    Then the result names the next lesson of the same grade and subject in the WhatsApp Flow's order that the child has not finished
    And the rest of the same chapter comes first, then the next chapters
    And nothing is named when every lesson of that subject and grade is finished, or for a lesson quiz
  @WQ170 @T520
  Scenario: A child's link on the platform's default domain opens on the quiz's own address, so the phone still remembers the child
    Given the web quiz's address is set for this deployment
    And a child once opened a quiz link on that address and picked their own name
    When the same child opens an older link that points at the platform's default domain
    Then the page moves to the same quiz, hub, challenge or library page on the quiz's own address, keeping everything after the path
    And the child is recognised without picking their name again
    And the teacher's report link and the quiz's data calls are never moved

  @WQ171 @T561
  Scenario: A library link from the hub opened on another phone says whose link it is
    Given a child's hub link is bound to the child's phone
    When the hub's library link (/lib/<token>) is opened on another phone
    Then no subjects, lessons or name are shown
    And it reads "This link was sent to another player" and "Ask the child this link was sent to to open it." (in Urdu «یہ لنک کسی اور کھلاڑی کو بھیجا گیا تھا»)
    And it adds "Is this your link? Send /quiz on WhatsApp again for a new one." so a family locked out on its own phone can get a new link
    And there is no "Try again", only "Back" to the hub
  @WQ172 @T545
  Scenario: A hub quiz link plays as the child on the family phone even for a teacher with many players
    Given a teacher whose quizzes more than 40 children have played since this child last played
    And the family phone opened the child's /quiz hub link
    When the child taps "Play again" or the teacher's quiz on the hub
    Then the quiz starts as that child, with no "Which class are you in?" and no name to pick
    And the same quiz link opened on another phone names nobody and asks who is playing

  @WQ173 @T546
  Scenario: A shared phone that one sibling played on sees only that sibling from the family's hub link
    Given a family's /quiz hub link for two siblings was opened first on the family's phone
    And one of the siblings once played a quiz on a class phone
    When the family's link is opened on that class phone
    Then it lists only the sibling who played there, never the other one
    And the other sibling's hub, library and challenge do not open on that phone

  @WQ177 @T565
  Scenario: The results card opens the child's own quizzes, videos and challenges
    Given the hub door is switched on and a child of the class finished the teacher's quiz on their phone
    When the child taps "My quizzes, videos and challenges" on their card
    Then their own hub opens on that phone, with the video library and the challenge
    And the same link opened on another phone shows no child's name and starts nothing
    But a friend who played from a challenge link sees no such button

  @WQ174 @T590
  Scenario: A shared card or challenge link shows its picture in the WhatsApp message before the child taps send
    Given a child finished a quiz in WhatsApp's own browser and the scorecard is open
    When the child taps "Share to class group" or "Challenge a friend" and then "Send on WhatsApp"
    Then within about a second the WhatsApp composer shows the link preview with the card picture (or the invite picture for a challenge)
    And the message arrives in the chat with that picture, its title and the link, in English and in Urdu

  @WQ175 @T591
  Scenario: A link-preview fetch is answered fast and a child's browser still gets the live quiz
    Given a quiz link the edge has served or warmed in the last hour
    When WhatsApp's link-preview fetcher (a HEAD, or the user agent "WhatsApp/2.x A") asks for it
    Then the edge answers with the page head and its og tags without asking the bot for the quiz
    And the share picture is answered from the edge once the scorecard has warmed it
    And a child opening the same link in any browser gets the full live quiz page
  @WQ176 @T570
  Scenario: The first child to open a quiz whose voice is still being recorded hears the recorded voice as soon as it exists
    Given a quiz whose read-aloud clips have never been recorded (a library quiz, or a quiz nobody has opened yet)
    When the first child opens it and the recording starts in the background
    Then the page asks again for the quiz a few times over the next two minutes
    And every question the child reaches after the clips land is read in the quiz's recorded voice, in Urdu as in English
    And a quiz whose clips are already recorded never asks again

    And the hub link carries the card's language (lang=en or ur), and with web_quiz_challenge_v2 on the hub, its challenge and library links open in it
  @WQ178 @T592
  Scenario: Every portal worker answers a link preview fast, whichever one the phone reaches
    Given the portal runs several worker processes and only one of them served the child's quiz page
    When WhatsApp's link-preview fetch for the child's card or challenge link reaches any other worker
    Then that worker answers the page head from the bot's remembered link facts, never a whole quiz load
    And the share picture is answered from the bot's memory once the scorecard has fetched it

  @WQ180 @T593
  Scenario: A child who taps Share the moment the scorecard appears still sends the picture
    Given a child has just finished a quiz on a slow connection
    When the scorecard appears and the child taps "Share to class group" or "Challenge a friend" straight away
    Then the card and invite pictures were already drawn when the quiz finished, so the link preview shows the picture
    And the finish itself is never slower for it, and a picture that cannot be drawn never stops the scorecard

  @WQ179 @T595
  Scenario: The hub door is on the first screen of the card, and a forwarded door link says how to get your own
    Given the hub door is switched on and a class child has just finished a quiz on a 360x740 phone
    Then "My quizzes, videos and challenges" is the second action, right under "Share to class group", with no scrolling, in English and in Urdu
    And the stars of a 7-question score stay on one row
    When the same hub link is opened on another phone
    Then the lock screen says to finish your own quiz and tap "My quizzes, videos and challenges", and also how to get a new link with /quiz

  @WQ181 @T571
  Scenario: A teacher whose stored name already carries a title is named once, without the title
    Given a teacher stored as "Mr Kamran" (or «استانی رفعت», or «کامران صاحب»)
    When a child opens the teacher's quiz page or reads the forwarded quiz message
    Then the teacher is named "Teacher Kamran" («استاد رفعت», «استاد کامران»), never "Teacher Mr Kamran"
    And a name that only begins with the same letters, like "Mrinal", is left as it is

  @WQ182 @T594
  Scenario: With the hub door, a class child's card opens on the score, the name notice, "Share to class group" and the door
    Given the hub door is switched on and a class child finishes a teacher's quiz on a 360x740 phone, in English or Urdu
    Then the first screen shows the score card, "Only your first name goes on the card", "Share to class group", then "My quizzes, videos and challenges"
    And the practice note and the place-in-class note come right after the door, and a long topic shows on one line on the card
    But a video quiz card keeps "Next in this chapter" and "Watch another video" first, and with the door switched off the card is unchanged

  @WQ183 @T596
  Scenario: The card picture is drawn straight after the finish answers, without slowing the finish
    Given a class child answers the last question of a quiz, in English or Urdu
    When the quiz finishes
    Then the scorecard's answer comes first, never waiting on the picture, and the card picture is drawn straight after it without looking in storage first
    And a WhatsApp link preview of "Share to class group" a few seconds after the finish gets the picture without waiting for a draw
    And the picture is a 1200x630 JPEG of about 30 KB, and the page head names its type (image/jpeg), its https address and its alt text

  @WQ184 @T597
  Scenario: Every share picture a phone fetches leaves a trace in the logs
    Given a child shares the card, a challenge, the class table or the school league
    When the WhatsApp composer (Android or iOS) or a browser fetches the picture
    Then the portal logs web_quiz.art_edge with the picture kind, whether the portal already held it, the time taken and which kind of fetcher asked
    And the log carries no quiz code, picture id or child name
  @WQ185 @T621
  Scenario: A library question plays the bank's own recorded voice, and each option has its own tap-to-hear
    Given a library question whose bank recording has a clip for the question and one for every option
    When a child opens it on a 360x740 phone, in English or Urdu
    Then the question is read in its recorded clip, and every option shows its own speaker that plays that option's clip only
    And the clip heard is always the one for the option tapped, whatever order the options are shown in
    And tapping an option's speaker never answers the question
  @WQ186 @T622
  Scenario: A listen-and-identify item never plays its options before the child answers
    Given a library item "Listen and tap." whose sound to identify is played before the answer
    When the question appears
    Then the instruction and the sound are read, the options are not read as a block
    And the child can still hear each option on its own speaker
  @WQ187 @T623
  Scenario: Only what the bank does not already voice is recorded, and a voice never misreads a letter or a blank
    Given a library quiz with recorded clips for some questions and options
    When its read-aloud clips are recorded
    Then no clip is recorded for a question or option the bank already voices, and options are all recorded or all generated within a question
    And a lone letter is read by its name ("letter s", «عین»), and a fill-in blank is a pause, never "underscore" or "dash"
  @WQ191 @T624
  Scenario: A question or option with a word too long for the phone wraps inside the screen
    Given a question whose stem holds a long run with no spaces, like "quantity,quality,shape,color,size", or options with long words and their own speaker
    When a child opens it on a 360x740 phone, in English or Urdu
    Then the words break inside the card, the page never scrolls sideways, and the question's speaker stays on the screen

  @WQ188 @T625
  Scenario: The class table's shared link previews with its picture already drawn
    Given a child who has finished opens the class table, in English or Urdu
    When the child taps "Share the table" and sends the link from WhatsApp
    Then the link preview's class picture (places, animals, scores, nobody named) was drawn when the table opened
    And WhatsApp's fetch of that picture is answered without waiting for a draw, while the child's own "(me)" picture is still the one shared as a file
  @WQ194 @T632
  Scenario: The bank's "answer" clip plays before the answer only when the question is about that sound
    Given a library question that holds a clip in the bank's stimulus slot
    When its stem is a listen item ("Listen and tap.", "the word with the following sound:", "sounds like:", «یہ کس حرف کی آواز ہے؟», «یہ لفظ کیسے لکھتے ہیں؟»)
    Then "Play the sound" plays that clip before the child answers
    But for an ordinary question that only says "following" or talks about sound ("Which of the following is a noun?", "Musical sounds are:") no clip plays before the answer
  @WQ189 @T636
  Scenario: The class table's preview picture is drawn when a child finishes, before anyone opens the table
    Given a child in a class finishes the quiz, in English or Urdu, and has not opened the class table
    When someone shares that class's table link and WhatsApp fetches its preview picture
    Then the class picture (nobody named) is already drawn and WhatsApp's fetch does not wait for a draw
    And a friend who finished a challenge link draws no class picture
  @WQ190 @T637
  Scenario: Opening the quiz page logs which app's browser opened it
    Given a child opens a quiz link in WhatsApp's own browser, another app's in-app browser, Samsung Internet or an ordinary browser
    When the page logs that it opened
    Then the log names the app as whatsapp, webview, samsung or browser from the browser's own user agent
    And the in-app-browser flag is on only for WhatsApp's own browser, including the one whose user agent says "WA4A"
  @WQ192 @T630
  Scenario: A sound item shows sound tiles: the tile plays the sound, "This one" answers
    Given a listen-and-identify library item whose options each have their own recorded sound, or an audio-only item ("Sound 1", "Sound 2")
    When a child opens it on a 360x740 phone, in English or Urdu
    Then each option is a big tile that plays that option's own sound and never answers
    And a separate "This one" button under each tile is the answer
    But an item with an option that has no sound keeps its ordinary option buttons
  @WQ193 @T631
  Scenario: A library question can reopen its lesson video without losing the question
    Given a library quiz that starts with its lesson video, and a child on one of its questions
    When the child taps "Watch the lesson again"
    Then the lesson plays over the question, and Close returns to the same question with nothing answered
    But a quiz with no video shows no such button
  @WQ195 @T633
  Scenario: A library lesson's page speaks the lesson's language, not the class's
    Given a child of an English class opens the video library from their quiz or their hub
    When they tap an Urdu lesson
    Then the lesson's quiz page opens in Urdu, right to left
    And it still counts for the same class and the same child, with no name to pick
    And an English lesson tapped from an Urdu class opens in English, left to right

  @WQ196 @T634
  Scenario: Playing a lesson in another language does not change the child's own language
    Given a child of an English class has just finished an Urdu lesson from the library
    When the child opens their hub or sends /quiz again
    Then the hub and the /quiz reply stay in English

  @WQ201 @T642
  Scenario: A figure's "look at" line is spoken from the shared recorded voices
    Given the ten figure pointer lines ("Look at the bars.", «گھڑی کو دیکھیں۔» …) are recorded once per language in the quiz voice
    When a child hears a figure question whose stem does not already point at the picture
    Then the page plays that line's recorded clip, matched by its exact words, before the question
    And a question's own wording for its figure, which has no recorded clip, is read by the phone's voice as before

  @WQ202 @T643
  Scenario: A library question recorded end to end gives its reason in the same recorded voice
    Given a library question whose question and every option play the bank's recorded clips
    And its recorded explanation was transcribed and says that question's explanation, with no option letter and no "the answer is"
    When the child answers it
    Then the reason after the answer is the recorded explanation, not a generated clip
    But a question whose explanation clip failed that check, or changed since, keeps the generated reason
    And an explanation clip that was not checked is never played, even before the generated reason is recorded: the written reason is read aloud instead

  @WQ203 @T644
  Scenario: A sum that ends in "= ?" or a blank is read with a word in the gap
    Given a question such as "Use long division: 720 ÷ 6 = ?" or "۵۰ − ۳۰ = ___"
    When its read-aloud clip is recorded
    Then the voice is given "… = what?" in English and «… = کتنے؟» in Urdu
    And the clip ends on that word, never on made-up words after "equals"
    But an "=" with its value, a blank before the "=", an option that names the "=" sign, or a gap with words after it ("12 − 10 = ? hours") is read as written

  @WQ204 @T650
  Scenario: An answer's right or wrong reaches the log
    Given a child answers a question on the web quiz page
    When the page sends the answer event with right as 1 or wrong as 0
    Then the logged answer says right or wrong
    And the logged feedback view says it too

  @WQ205 @T651
  Scenario: With page-session telemetry on, a page load can be replayed in order without a name
    Given the app setting web_quiz_rich_telemetry is on
    When a child opens a quiz page, moves through the screens, puts the phone down, comes back and closes the page
    Then every event of that page load carries the same random page-session id and a sequence number with no gaps
    And each screen logs when it was entered and, on leaving, how long it was on and how much of that was visible
    And hiding and showing the page are logged with how long the other state lasted
    And while the page is visible and nothing else was sent for 30 seconds, one heartbeat is logged, at most 20 per page
    And closing the page logs its total and visible time once
    And the log holds the quiz session's id and a hash of the phone's device ref, never the session token, the device ref or a name
    But with the setting off the page sends none of these and the server drops any that arrive

  @WQ206 @T696
  Scenario: A Home button is always at the top of the child's own quiz, and leaving through it loses nothing
    Given the app settings web_quiz_hub and web_quiz_home_button are on and a child is playing their own class quiz
    Then every screen of that quiz — the video, each question, the results card — shows a Home button at the top right (top left in Urdu), at least 48 px each way
    When the child taps Home during a question
    Then the page asks "Go to your home page?" and waits for a tap, saying the answers are saved only when none is waiting to be sent
    When the child taps "Go home"
    Then any unsent answer is sent first and the child's home page (the kid hub) opens, counted as opened from Home
    But a friend's challenge run, the teacher's own test run and a screen before the child is chosen show no Home button
    And with the setting off the page is today's

  @WQ207 @T697
  Scenario: The video library and the Challenge opened from the home page have the same Home button
    Given web_quiz_home_button is on
    When the child opens the video library or the Challenge from their home page
    Then a Home button at the top goes back to that home page

  @WQ208 @T698
  Scenario: Back on a question shows the previous question as it was answered, and the first answer still counts
    Given the app setting web_quiz_back_nav is on and a child is on question 3
    When the child taps "Back"
    Then question 2 is shown exactly as it was answered — the child's pick, the right answer marked, the reason they already saw — with the options locked
    And a note says "You are looking at question 2 again. Your first answer is the one that counts."
    And "Back to question 3" returns to the question waiting for an answer
    And no answer is sent or changed, so the score is the first tries, as before
    And on question 1 "Back" goes to the lesson video when the quiz has one, and is not shown when it has none

  @WQ209 @T699
  Scenario: The phone's Back button steps back through the quiz instead of closing it
    Given web_quiz_back_nav is on and a child is on question 3
    When the child presses the phone's Back button twice
    Then the page shows question 2, then question 1, as answered, and stays open
    When the child presses Back on the first screen of the quiz or on the results card
    Then the page offers "Go to your home page?" instead of closing (when a home page exists for this run)
    And with the setting off the phone's Back is today's: on a question the first press warns, the second leaves

  @WQ210 @T700
  Scenario: The challenge is asked as "Who can beat your score?" right under the class-group share
    Given the app setting web_quiz_invite_ask is "on" and a child of the class finished with 7 of 9
    When the score card opens
    Then right under "Share to class group" a panel asks "🏆 Who can beat your 7/9?" with three tiles: "Someone at home", "A cousin", "A friend in my street"
    And in Urdu it asks "🏆 7/9 سے آگے نکلنے کا چیلنج کسے دیں؟" with "گھر میں کوئی", "کزن", "محلے کا دوست", the score on its own left-to-right run
    And the panel replaces "Challenge a friend", and the hub door comes after it
    When the child taps a tile
    Then the share sends the child's challenge link with the words "<first name> here! I got 7/9 stars on <topic>. Can you beat me? 🏆 Tap the link to play:"
    And only the first name is in the words, and nothing says which tile was tapped
    But a friend's own challenge run keeps today's "Challenge a friend" button, and with the setting off the card is today's

  @WQ211 @T701
  Scenario: A low score asks to play with someone at home, with no score to beat
    Given web_quiz_invite_ask is "on" and a child finished with 2 of 9
    When the score card opens
    Then the panel says "🏠 Play it with someone at home" ("🏠 گھر میں کسی کے ساتھ کھیلیں") and shows no score
    And a tile shares "<first name> here! I played <topic>. Your turn! Tap the link to play:" with no score in it

  @WQ212 @T702
  Scenario: Split mode gives each phone one arm, so the panel can be compared with today's button
    Given web_quiz_invite_ask is "split"
    When children finish on different phones
    Then each phone always sees the same card: the panel, or today's "Challenge a friend" button (a phone with no saved key gets today's button)
    And the score card and every share tap say which of the two the child saw

  @WQ213 @T760
  Scenario: The polished Urdu look is one switch and one class on the page root
    Given the app setting web_quiz_ur_polish is "on"
    When an Urdu quiz, hub, library or challenge page is opened
    Then the page root is <html lang="ur" dir="rtl" class="wq-ur2"> and it preloads the second Urdu face (Noto Nastaliq Urdu Regular, self-hosted, ~105 KB, OFL)
    And every Urdu run draws in that one face at one weight — no synthetic bold, no size-adjust, no extra word spacing
    And a line that wraps keeps a 2.2 line height, a one-line control a 2.0 line height with room above and below the Nastaliq stacks, so no letter is cut by its box
    And the mascot's bubble and the feedback box take the full width under the mascot when they have more than a line
    And a long option keeps its label on its own row at 320 px, and an English word inside Urdu never breaks mid-word
    But an English page gets no class and no Urdu font, and renders exactly as before
    And with the setting off every page renders exactly as before, with today's face

  @WQ214 @T761
  Scenario: On the hub the polish class follows the child's language, not the boot
    Given web_quiz_ur_polish is "on" and the hub booted in Urdu with the class
    When a sibling whose hub is English is picked
    Then <html> loses the class with the language, and gets it back when an Urdu child is picked

  @WQ215 @T762
  Scenario: Under the polished Urdu look the copy is a child's — shorter, Western digits, the name first
    Given web_quiz_ur_polish is "on" and an Urdu page carries the class
    When the landing, a question, the feedback, the results card, the hub or the library renders
    Then the landing says "السلام علیکم! کوئز کھیلیں؟", "5 سوال، 3 منٹ" with each number on its own left-to-right run, and the teacher line and the class on two lines
    And the question counter reads "5 میں سے سوال 1", never "از"
    And an option whose label is over 40 code points takes its own row a step smaller
    And the feedback's "comes back at the end" line is seven words, "ٹیپ کریں" is "دبائیں" everywhere, "مکمل" is the one word for done, and no adult word ("تقریباً", "جشن", "ہم جماعت") remains
    And the hub greets "<name>، السلام علیکم! آج کیا کھیلیں؟" with the name first and isolated
    And the share line to WhatsApp keeps the approved sentence shape with Western digits inside isolates
    But with the class absent every string is today's, word for word, and English never changes

  @WQ216 @T763
  Scenario: Under the polished Urdu look the share pictures read at WhatsApp's preview size
    Given web_quiz_ur_polish is "on"
    When an Urdu score card, invite, class or school picture is drawn
    Then the quiz name is the headline (44 px on the 1200 px canvas), the kicker 32, the call-to-action pill 40, the points pill 28, a Nastaliq name at line-height 1.9
    And the school sits on its own line under the points, and the class picture's average on its own line — no middots inside an Urdu sentence
    And the picture's cache key carries the switch only when it is on, so every picture already cached is served as before when it is off
    But an English picture is byte-identical with or without the switch

  @WQ217 @T765
  Scenario: Under web_quiz_identity_canon a merged loose child folds to the child it was merged into, one hop only
    Given web_quiz_hub and web_quiz_identity_canon are "on"
    And a loose child record was merged into a class-list child, and another loose record was merged into a record that was itself merged
    When the server looks up the one id each child is known by
    Then a second import of a class-list child folds to the first, as today
    And the merged loose record maps to the class-list child it was merged into
    And the record merged into a merged record maps to that record and is not followed further
    But with web_quiz_identity_canon off, or web_quiz_hub off, the ids map exactly as before

  @WQ218 @T766
  Scenario: Under web_quiz_identity_canon the hub shows a merged loose child as the class-list child, once
    Given web_quiz_hub and web_quiz_identity_canon are "on" and a hub link names three children, one of them a merged loose record
    When the hub opens on the phone the link was sent to
    Then the merged loose child's chip is the class-list child's chip, and a link naming both records shows one chip
    And the link itself still carries the ids it was made with
    And with one chip picked, the teacher card, Play again, the last quiz and the videos are that child's only
    But with web_quiz_identity_canon off the hub's answer is byte-identical to today's for a three-child link

  @WQ219 @T767
  Scenario: Under web_quiz_identity_canon a typed new name on one phone is one child across a teacher's codes
    Given web_quiz_hub and web_quiz_identity_canon are "on" and identity v2 is on
    And a child typed a name that is not on the class list on one phone and played a teacher's code
    When the same phone types the same name on another code of the same teacher
    Then the quiz is played as the same child record, and no second record is made
    And on another phone, for another teacher's code, or when two such records match, a new record is made as today
    But with web_quiz_identity_canon off a new record is made with exactly today's fields
  @WQ220 @T768
  Scenario: The "Keep your place on WhatsApp" card shows once per view on a chosen child's hub, never on a practice hub
    Given web_quiz_phone_bind is "on" under web_quiz_identity_canon and a hub link opened on the family's phone with one child chosen
    When the hub renders
    Then the card shows its title, the /quiz line with /quiz as a left-to-right chip, "Keep my place" and "Not now"
    And on the child's first open of the hub (no device cookie yet, the server render locked) the card still appears once the hub unlocks, without a reload
    And bind_offered is sent once for this page view with surface "hub" and w "p"
    And "Not now" hides the card on this device for 7 days
    But with web_quiz_phone_bind "off" the hub page has no wq-bind script or style and the hub JSON has no bind key, byte-identical to before

  @WQ221 @T769
  Scenario: The confirm sheet names the child, says what is kept and how to remove it, with nothing preselected
    Given the card is shown for Zara in Urdu at 360 px
    When "Keep my place" is tapped
    Then the sheet asks "Zara, is this you?" with the name isolated, the notice says the phone number is kept with Zara's name until 31 March and that a grown-up can remove it by sending STOP, with no claim about readings, at 20 px or more
    And neither "Yes, it's me" nor "No, it's not me" is preselected, and the STOP sentence and both buttons are fully visible
    When "Yes, it's me" is tapped
    Then a JUGNU- code is minted for that child, kept for this session only, and "Send on WhatsApp" opens wa.me with the code last in the message
    And a teacher's device or a child already on 3 phones gets the page message instead, and no code is minted

  @WQ222 @T770
  Scenario: Back from WhatsApp the page says Saved and offers Undo
    Given a code minted this session was sent from the family's phone
    When the page comes back into view
    Then it shows "Saved ✓", "Not your family's phone?" and "Undo"
    When "Undo" is tapped
    Then that one binding is erased, the door forgets the phone, bind_undo is logged with via "page" and n 1, no WhatsApp message is sent, and the card stays hidden for 7 days
    And a pending code shows nothing, an expired code asks to tap Keep my place again

  @WQ223 @T771
  Scenario: A deep link to a scored route on a phone with two children and no tap asks "Whose turn?" first
    Given web_quiz_identity_canon is "on" and a hub link naming two children opened on their phone
    When the challenge menu or an exercise is opened without a child chip
    Then the answer is the "Whose turn?" ask with each child's chip and first name, and no run is started or stored
    And with one child the exercise is served as today
    But with the switch "off" the route answers "pick_kid" as today

  @WQ224 @T772
  Scenario: Two chips with the same first name are told apart, or both picks are written low
    Given a list holds two children whose first names fold to the same name and a third with a unique name
    When the list is rendered on the teacher's link, the class link to a new device, or "Who is playing?"
    Then the father's first name is the second line where it exists (never to a new device), and "Played on this phone before" marks a child this device played as
    And both colliding rows carry homonym_in_list true; if their chips are still identical both picks are low, otherwise high
    And the unique child's pick is high with homonym_in_list false

  @WQ225 @T773
  Scenario: Three remembered children on one phone: results for the tapped child only
    Given a hub link names three children and the phone is trusted for all three
    When "Who is playing?" is shown and one child is tapped
    Then the hub, its quizzes and the challenge are that child's only, and the pick record is kept for the quiz start with id_src "hub_chip" and id_confidence "high"
    And id_pick is logged with w "s" and no session id, device or code
    And a play opened from the hub keeps the pick for that child on this phone for 24 hours: "hub_chip" from a WhatsApp /quiz link, "remembered" otherwise
    But a child already kept on three phones sees "This child's place is already saved on three phones." and the card stays hidden for the session

  @WQ226 @T800
  Scenario: A class child's own scorecard offers Jugnu's challenge first, and the page counts that it was seen
    Given web_quiz_hub, web_quiz_challenge and web_quiz_challenge_card are "on" and the child is in grade 2 to 5
    When the child finishes their own run of a teacher's quiz
    Then Jugnu's card ("Jugnu's Challenge · Short games for reading and numbers") is first under the score, above "Share to class group"
    And with web_quiz_events_v2 "on" the page sends door_shown {door: card, surface: scorecard, slot: 1} once when the card is half in view, even when Back draws the card again
    But a friend's challenge run, a teacher's test run, grade 1 and grade 6 see no Jugnu card

  @WQ227 @T801
  Scenario: Tapping Jugnu's card asks whose turn it is before any run
    Given the scorecard shows Jugnu's card for Zara
    When the child taps the card
    Then one screen asks "Zara's turn" with a big Play button and "Not my turn? Go back"
    And Play asks the server for this child's challenge link, bound to this phone and naming nobody, and opens it with via=quiz_card
    And before it leaves, the page keeps this phone's device ref in the wq_dv cookie, so a child who never opened the hub meets the Trail, not the other-phone note
    And the run it opens is recorded via quiz_card, from the card's signed link, never from a ?via= the page adds
    And "Not my turn? Go back" returns to the scorecard without asking the server

  @WQ228 @T802
  Scenario: With the Jugnu card switched off the scorecard is today's
    Given web_quiz_challenge_card is "off"
    When a child finishes a teacher's quiz
    Then finish() sends no jugnu_card and the scorecard's HTML is today's, string for string, in English and Urdu
    And the quiz page loads no new script
  @WQ229 @T808
  Scenario: A teacher's quiz link opened again by the child who finished it lands on that child's hub
    Given web_quiz_hub and web_quiz_link_home are "on"
    And a phone that remembers one child, who finished the quiz behind the teacher's /q/<code> link on that phone
    When the same link is opened again on that phone
    Then the page asks the server once and opens that child's own hub at /h/<token>?from=link
    And that link carries the page's language (lang=en or ur), which the hub honours only with web_quiz_challenge_v2 on
    And the hub token names that child only and is bound to that phone, so a copy opened on another phone names nobody
    And the server writes door_shown with door "link_home" and surface "hub"
    But a reply that is not a hub link, an error, or no reply in 3 seconds shows today's screen

  @WQ230 @T809
  Scenario: The old link keeps today's quiz page whenever it is not one finished, remembered child
    Given the teacher's /q/<code> link is opened
    When web_quiz_link_home is "off", or web_quiz_hub is "off"
    Then the quiz payload and the page are exactly today's and nothing is asked
    When the phone remembers two or more children, or none, or played this code as a teacher, or the run is not finished, or answers wait to be sent
    Then no hub opens and the landing, "Whose turn?", the quiz or the results card runs as today
    And a friend's challenge code and the teacher's preview never ask
  @WQ231 @T803
  Scenario: The Jugnu card comes first on the hub once the last quiz is finished
    Given web_quiz_hub, web_quiz_challenge and web_quiz_hub_challenge_first are "on" and the child's last quiz is finished
    When the hub opens
    Then the Jugnu card is the first card, above the last quiz, and its tile is not shown twice
    But while the last quiz is still open, Continue stays first
    And with web_quiz_hub_challenge_first "off" the hub's order and HTML are today's, byte for byte

  @WQ232 @T804
  Scenario: The lantern names the one next thing the server chose, never a count or a future title
    Given web_quiz_challenge_v2 is "on"
    When the Trail has stops waiting this month
    Then the lantern says a game is waiting on the Trail, with no number
    And with web_quiz_challenge_story "on" and nothing waiting, it names the newest live story the child has not met, or "Tomorrow: a new story", or Monday's line only when a release is buffered
    But a story whose release is still ahead is never named, and with no buffered release only "Numbers with Jugnu" shows

  @WQ233 @T805
  Scenario: The Story Time shelf tags NEW only a story the child has never met
    Given web_quiz_challenge_story is "on"
    When the hub shows the shelf under "Jugnu today"
    Then a story with no run row of any kind for the child, on it or its twin, carries "NEW"
    And the numbers warm-up and a reserve story are never tagged new, and a reserve story is never on the shelf
    And on the child's first open (no device cookie yet, the server render locked) the shelf still draws once the hub unlocks, without a reload

  @WQ234 @T806
  Scenario: The hub's doors are counted once per view, only with the new events on
    Given web_quiz_events_v2 is "on"
    When the hub renders the Jugnu card, the lantern and the shelf
    Then door_shown hub_first is sent once with the card's position, door_shown next or tomorrow once, and door_shown shelf once per tile half in view
    And a tap sends door_tap for that door
    But with web_quiz_events_v2 "off" no door event is sent

  @WQ235 @T807
  Scenario: The hub can be added to the home screen without an install card
    Given web_quiz_install_prompt is "on"
    When the hub page loads
    Then it links the web manifest, the browser's own prompt is counted as door_shown install and an accepted install as door_tap install
    But no install card is drawn until its copy exists, and with the switch "off" there is no manifest link
  @WQ236 @T775
  Scenario: Jugnu's Book lamps come only from the child's rung rows
    Given web_quiz_challenge_book and its parents are "on"
    And a child has a counted read that would meet a reading rung but no rung row
    When the child opens Jugnu's Book from the hub
    Then no lamp is lit and each ladder shows exactly one unlabelled dashed outline
    And a ladder lit to its fifth lamp shows no outline, and a grade 1 child sees no outline at all

  @WQ237 @T776
  Scenario: The class lights stay hidden until five children of the class have lit one this term
    Given web_quiz_class_wall is "on" under the Book
    When three children of the class have lights this term
    Then the line reads "Your class is playing too" with no number
    And with twelve children and 41 lights, 7 of them this week from 4 children, it reads the term total and "+7 this week"
    But 6 lights this week from 2 children shows the term total only
    And when no other child of the class has a light yet (nobody, or only this child) there is no lights line at all

  @WQ238 @T777
  Scenario: Days this week are lit dots only and a new week starts empty
    Given the child finished a stop on Monday and Wednesday this week and one last week
    When the Book opens
    Then 7 dots show with Monday and Wednesday lit and no digit or streak word
    And a served or abandoned run lights no dot, no sticker and no class light

  @WQ239 @T778
  Scenario: A new lamp is shown once, only when the server says one was lit this period
    Given the server returns a reading lamp lit this period that opened longer stories
    When the Book opens
    Then "A new lamp is lit!" and "New for you: longer stories" show with "Let's go" opening Story Time
    And the next time the Book opens on this phone it is not shown again

  @WQ240 @T779
  Scenario: A 0-word first read still earns the read stop's Trail sticker
    Given a child's first counted read this month scored 0 words
    When the Book opens
    Then the read stop's Trail sticker is there and no reading lamp beyond what the rung rows say

  @WQ241 @T780
  Scenario: With the Book off the hub is today's, byte for byte
    Given web_quiz_challenge_book is "off" (or its parent web_quiz_challenge_v2 is "off")
    When a child opens the hub
    Then the hub payload deep-equals today's and the hub page has no Book tile, script or stylesheet
  @WQ242 @T785
  Scenario: With the Trail v2 switch off the Challenge page and its payloads are today's
    Given web_quiz_challenge_v2 is "off"
    When the Challenge menu, a stop and its end card are served and drawn
    Then the menu and exercise payloads deep-equal today's and the page HTML is string-equal to today's
    And the page shell does not load the Trail v2 script

  @WQ243 @T786
  Scenario: The mic notice shows once per child per phone, before the microphone is asked for, with one control
    Given web_quiz_challenge_v2, web_quiz_challenge_audio_consent and web_quiz_challenge_keep_audio are "on"
    And this child has not seen the notice's current wording on this phone
    When the child opens Read aloud and taps Ready
    Then before the phone asks for the microphone one card says the reading is kept to see how the child is learning, that one checker may listen and that STOP on WhatsApp removes the phone link, with one "Got it" and nothing to choose
    And "Got it" goes on to the microphone, every reading is kept, and that run's upload and result say notice_shown, which the run row and the ch_audio_consent event carry
    And the same child on the same phone does not see it again, while a brother or sister on that phone sees it once, and everyone sees it again when its wording changes
    But a legacy "kept_no" from an old page is still not kept, and with the switch off no notice shows and no consent is written

  @WQ244 @T787
  Scenario: The help question is asked once per sitting before the first scored stop
    Given web_quiz_challenge_v2 is "on"
    When the child opens the first scored stop of the sitting
    Then "Is someone helping you today?" shows with nothing selected and the answer is sent as self or helped on every result
    But a practice round never asks it

  @WQ245 @T788
  Scenario: The serve decides a stop opened by URL
    Given web_quiz_challenge_v2 is "on" and a stop is opened by its URL
    When the serve answers whose_turn, a practice round, or on_its_way
    Then the page shows "Whose turn?" with one chip per child and picks nobody, the practice banner, or "A new story is on its way." with no microphone and no upload

  @WQ246 @T789
  Scenario: Trail v2 end cards say what was done, never a number about the child
    Given web_quiz_challenge_v2 is "on"
    When a reading ends with 0 words or with 90 words
    Then the end card has no digit, no words-a-minute line, and the same sticker line for both
    And the warm-up's stop_after 0 never stops it early
  @WQ247 @T810
  Scenario: A grade-1 child counts the dots and taps the number, and never sees a score
    Given the challenge serves the exercise "numbers" with ten items, each a count of dots and three numeral tiles
    When the child opens it, taps "Start" and taps one tile on each item
    Then each item shows a ten-frame with that many dots, "How many?" and three tiles at least 64 px tall, with no timer and no count
    And the tiles lock after one tap and are never coloured right or wrong
    And after the last item the taps go once to the result endpoint as i, pick and ms each, and the end card shows no number
    And on an Urdu page the copy is Urdu and the tiles are Urdu digits
    But a challenge without the exercise "numbers" renders and requests exactly as before

  @WQ248 @T811
  Scenario: Story Time plays the story its link names, as a practice run with nothing counted
    Given web_quiz_challenge_v2 and web_quiz_challenge_story are "on" and the Challenge page is opened with room=story and a story id
    When the page asks for the read, or the listen when the link says ex=listen
    Then that one request carries room=story and the story id, and no other request does
    And a read first asks "Hear it from me first, or read it yourself." with "Read along with Jugnu" and "I'm ready" as two equal buttons, neither selected
    And "Read along with Jugnu" plays the story clip with its line lit, then the normal read
    And no story screen shows a clock, a score, words a minute or "N of M", and the end card says "Read this story again any time." with the sticker line
    But a refused story id (any 400), a 404 or no network shows "A new story is on its way." and never an error page
    And with the story switch off, or no room on the link, the page and its requests are today's

  @WQ249 @T830
  Scenario: A standing class link opens on the teacher's name, never on the class list
    Given web_quiz_class_link, web_quiz_challenge_v2 and web_quiz_challenge are "on" and a teacher has a class link for an enrolled class
    And a phone that has never played in this class opens /j/<code>
    Then the page asks "Tap your teacher's name" with two or three teachers of the school and no child's name anywhere in it
    When a wrong teacher is tapped
    Then the same question comes back and still no child is shown
    When the right teacher and then a first letter are tapped
    Then "Is your name here?" shows only the first names under that letter, never a surname, an initial or a father's name
    And two children with the same first name are both shown and either pick is written as a low-confidence pick among homonyms
    And the pick opens that child's hub, and the run is written with the link's class and via class_link

  @WQ250 @T831
  Scenario: A phone that played in the class gets "Whose turn?" with only its own children
    Given web_quiz_class_link is "on" and a phone has played as a child enrolled in the link's class
    When that phone opens /j/<code>
    Then the page asks "Whose turn?" with only the children this phone played as in this class
    And a classmate or a child of another class is never shown

  @WQ251 @T832
  Scenario: The class link's preview and every closed state say nothing about the class
    Given a /j/<code> link is shared on WhatsApp
    Then its preview reads "Jugnu's Challenge" and "Stories and number games. Tap to play." in the class's language, with no class, school, teacher or child name and no digit
    And with the switch or a parent off, or a revoked, expired, unknown or malformed code, /j/<code> is exactly the page an unknown /q/ code shows
    And every /q/<code> page is byte-identical with the class link on or off

  @WQ252 @T833
  Scenario: The teacher forwards the class link from the report, and their own visit is practice
    Given web_quiz_class_link is "on" and a teacher opens the class tab of their report
    Then "Your class's Jugnu link" shows the link as selectable text and a Forward button, with no script on the page
    When Forward is tapped
    Then WhatsApp opens with the link alone as the text: no count and no name
    When the teacher opens the link from the card with "Open" and picks a child
    Then the visit is not counted as the link being opened, and the run is practice and is never counted
    When "Make a new link" is tapped
    Then the class tab comes back with a new link, and the old link opens only the page an unknown code gets
    And another teacher cannot make a new link for this class, and no message is sent
    But with the switch off the class tab is byte-identical to today's and "Make a new link" changes nothing
  @WQ253 @T834
  Scenario: The teacher whose class was drawn this term sees the class round card and starts the round
    Given app_settings "web_quiz_class_round", "web_quiz_challenge_v2" and "web_quiz_challenge" are true
    And the teacher's class has an open class round draw this term
    When the teacher opens "All my classes" from their report link
    Then the first card says "This term's class round", "Your class was drawn this term. About a minute per child, one at a time, on your phone. You can continue another day." and "Nothing about this class is ever reported by name.", with "Start the round"
    When the teacher taps "Start the round"
    Then the server fixes a random order of the class's children once, and the round page lists each child by first name
    And only the teacher's screen says "4 of 30 done, 1 absent"

  @WQ254 @T835
  Scenario: Absent is marked, never skipped, and the next child needs a long press
    Given the teacher has started the class round
    When the teacher taps "Mark absent" beside a child
    Then that child stays on the list, struck through
    When the teacher taps "Hold to call the next child" without holding
    Then no child is called
    When the teacher holds it for more than half a second
    Then the next child still to play is called and the phone shows "<name>'s turn"

  @WQ255 @T836
  Scenario: The child's screens never lead back to the teacher's and remember nothing
    Given a child's turn is open on the teacher's phone
    When the child presses Back, or the teacher's screen is asked for
    Then the child's screen stays, with no count and no other child's name (the list and the "Done ✓" ticks are on the teacher's screen only)
    And under "<name>'s turn" it says "Two games, just tapping. If you'd rather not, that's fine."
    And after the games it says only "Thanks for playing! Hand the phone to your teacher."
    And only holding "Give the phone back" returns to the teacher's screen
    And no round screen writes local storage, session storage or a cookie, or offers to keep a place

  @WQ256 @T837
  Scenario: With the class round off nothing changes
    Given app_settings "web_quiz_class_round" (or "web_quiz_challenge_v2") is false or absent
    When the teacher opens the report, or any "/r/<token>/round" address
    Then the report is byte-identical to today's and has no round card
    And every round address answers the report's own "not found" page

  @WQ257 @T838
  Scenario: The class round follows the term's draw: ten counted turns, a child's "not today", pause, and "Not this term"
    Given my class is in this term's draw and today is inside its round window
    When I mark a child "not today" on my screen
    Then the child stays in place on my screen only, is never called or asked again, and no child's screen shows it
    When I pause for today and come back another day inside the window
    Then the order and every mark are as I left them
    And the first ten turns in the order count and later children play the same games as practice, with nothing on screen showing the difference
    And the round closes only when I hold "next" with nobody left, or at the window's end, never by itself
    But a claim outside the window, after the round closed, or a second round run for the same child in the term stores nothing
    And from the draw until the window's end, before starting, "Not this term" on the card closes the round for the term with one tap and sends no message
    And before the window opens the card offers "Not this term" but not "Start the round"; after the window's end it offers neither
    And when the round closes my screen says "Your class took part. Thank you!" with no count
    And the draw row then holds the counted positions, the present ones among them and, per position bin only, how many played, scored none or were rapid
    # every control renders only while its string exists in the page's copy (jg.round.t_declined, t_pause, t_resume, t_not_this_term)

  # ── the class preview that plays (app_settings web_quiz_practice_play; the voices as mp3: web_quiz_story_mp3) ──
  # A teacher's "Try it as a student" link is a hub token that names no child, only a grade. Off, the preview is
  # look-only and its content routes refuse it; on, they answer it read-only for its grade and nothing is written.
  @WQ258
  Scenario: With practice play on, the teacher's class preview opens the grade's storybooks, games and videos and writes nothing
    Given app_settings "web_quiz_practice_play" is true
    And a teacher's class preview link for Grade 3, naming no child
    When the preview's doors and the Stories shelf are asked for
    Then the hub says it plays, the shelf lists the Grade 3 books and a book comes with its pages
    And the Games door lists the number games, and a number game opens and is scored
    And the Videos door shows the Grade 3 library, and a video starts with no quiz offered after it
    And no child row, quiz session, run, story event or binding is written

  @WQ259
  Scenario: With practice play off, the class preview stays look-only and its content routes refuse it
    Given app_settings "web_quiz_practice_play" is absent
    When the preview's content is asked for: the shelf, a book, the doors, the library, a video and the games page
    Then each answer is a refusal and the hub does not say it plays
    And each refusal is logged with practice 1, so a grown-up meeting the preview wall can be counted

  @WQ260
  Scenario: The preview's games never ask for the microphone
    Given app_settings "web_quiz_practice_play" is true
    When the preview asks for the counted read aloud, a recording upload or a live speech key
    Then the read aloud is not served and the upload and the speech key are refused
    And a read-along story is served with Jugnu's voice and no live reading

  @WQ261
  Scenario: A phone that cannot play Ogg Opus hears the storybook voices as mp3
    Given app_settings "web_quiz_story_mp3" is true
    And a phone whose browser cannot play Ogg Opus (Safari or WhatsApp on iOS before 18.4)
    When a storybook page voice is asked for as .mp3
    Then the portal serves it as audio/mpeg, made from the stored .ogg
    But with the switch off the .mp3 storage does not hold is not found, as before
