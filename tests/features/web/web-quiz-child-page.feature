Feature: Web child quiz page on the portal
  A child opens the quiz link the teacher forwarded and plays it on a web page,
  in WhatsApp's in-app browser or the phone's own browser.

  Background:
    Given a quiz share code "AB12CD" that is active

  Scenario: The link opens the quiz page with a link preview
    When the link "/q/AB12CD" is opened
    Then the page carries the quiz as boot data
    And the page has og:title, og:description and og:image tags
    And the page is marked noindex and no-cache

  Scenario: A new child plays to the class league table
    Given a phone that has never played
    When the child taps "Play", then "I'm new", and types a first name
    And answers all 5 questions, one of them wrong
    And fixes the tricky one with Jugnu
    Then the child sees "You got 4 out of 5" with 4 stars
    And the scorecard shows the first name, the topic, 4/5 and 4 stars
    And the class league table highlights the child's own row as "YOU"

  Scenario: A returning child is remembered on this phone
    Given a child finished a quiz on this phone before
    When the link of a new quiz is opened
    Then the landing offers "Play as <first name>" in one tap

  Scenario: A reload mid-quiz resumes
    Given a child answered 3 of 5 questions
    When the page is reloaded
    Then the landing offers "Continue 4/5" and the saved answers are kept

  Scenario: A typed name that matches a class name asks "Is this you?"
    When a child types a first name that is already on the class list
    Then the page asks "Are you <name>?" before starting

  Scenario: A closed quiz explains itself in the quiz language
    Given the share code has expired
    When the link is opened
    Then a friendly "This quiz has closed" page shows in the quiz language with status 410

  Scenario: Sharing works when the browser has no share menu
    Given the browser has no navigator.share
    When the child taps "Share to class group"
    Then the page offers "Open WhatsApp with the message" and "Copy the message"

  Scenario: A recorded clip that cannot play falls back to the phone's voice
    Given a question whose recorded clip fails to load
    When the question is shown
    Then the question is read by the phone's own voice
    And an "audio_fallback" event is logged with the reason

  Scenario: The landing names the teacher and the class as the teacher's own texts do
    Given the teacher's stored name is "Example Teacher" and finished children typed class "3"
    When the link is opened
    Then the landing says "From Teacher Example Teacher · Class 3"
    And the class page link preview names "Class 3"
    But before anyone has finished, the landing shows no class

  Scenario: A quick tap never brings back the old line
    Given a question whose recorded clip has not started yet
    When the child taps an answer at once
    Then the feedback is read and the old question is not read again
    And no "audio_fallback" event is logged for the stopped clip

  Scenario: A child remembered on this phone is listed once
    Given a child played the teacher's earlier quiz on this phone
    When the child plays the teacher's next quiz with "Play as <first name>"
    Then "Whose turn?" lists the child's name once

  Scenario: The teacher's report counts the first finish of a web quiz
    Given a child played the quiz on the web page
    And finished it once and then again on another phone
    When the teacher's report is written
    Then the report shows the first finished score, as the league table does

  Scenario: The answer buttons come in the same order as the WhatsApp quiz and the teacher's answer key
    Given a question whose options were shuffled when the quiz was made
    When the question is shown on the page
    Then the buttons are in that same shuffled order
    And tapping the right answer is marked right, and each wrong answer gets its own feedback

  Scenario: A figure question shows the drawing, not the WhatsApp card
    Given a question whose WhatsApp card paints the stem and options into a picture
    And the question carries a fraction bar figure
    When the quiz is opened on the web page
    Then the question shows the fraction bar drawn as a picture with no question text inside it
    And the stem and the options are shown once, as text
    And the read-aloud says "Look at the bars." before the question

  Scenario: A question with long options shows no picture at all
    Given a question that WhatsApp sends as a card only because its options are long
    When the quiz is opened on the web page
    Then the question shows no picture
    And the stem and the options are shown as text

  Scenario: Picture options are drawings, never emoji
    Given a picture question whose options are an apple, a cat and a bus
    When the quiz is opened on the web page
    Then each option shows its drawing with its word under it

  Scenario: A "whose sound is this?" question plays its own sound on the page
    Given a question that asks which sound the child hears, with its recorded sound
    When the quiz is opened on the web page
    Then the question has a "Play the sound" button that plays that recorded sound
    And a question whose words already ask it never plays a clip that says the answer before the child answers
    But if the sound cannot be fetched, the question is read aloud by the phone's own voice

  Scenario: Picture answers are named by what they show
    Given a picture question whose answers were stored as "1. Table", "2. House" and "3. Chair"
    When the question is shown on the page
    Then each picture has its word "Table", "House" or "Chair" under it and the voice says that word
    But a picture answer that was only ever stored as "Picture 1" shows the picture alone and is never read as "Picture 1"

  Scenario: A match picture names its rows P, Q, R, never the answer letters
    Given a matching question whose picture labels its rows A, B and C
    And its answers read "A-2, B-1, C-3"
    When the question is shown on the page
    Then the picture labels the rows P, Q and R
    And the question, the answers and the explanation say P, Q and R too
    And the answer buttons keep their own A, B and C

  Scenario: Letter answers are set as large page text so their marks are never cut off
    Given an Urdu question whose answers are the letters بّ, بِ and بْ
    When the question is shown on the page
    Then each answer is a large letter tile drawn in the page's own Urdu font
    And the shadda, zer and jazm marks are fully visible

  Scenario: A question that points at a picture it does not have is not served
    Given a quiz with four questions
    And one stem says "Look at the pictures. Which one is a leaf?" with no picture, no figure and no picture options
    When the child opens the quiz
    Then the quiz has three questions
    And the score at the end is out of three

  Scenario: A question that points at its own picture is served with it
    Given a stem "Look at the picture. Which part takes in water?" whose row has its own picture
    When the question is shown
    Then the picture is on screen above the options

  Scenario: The recorded voice says the words written for the voice, never maths code
    Given a quiz whose question is "What is $\frac{3}{4}$ of 8?" and whose web item reads it as "What is three quarters of eight?"
    When the read-aloud clips are published
    Then the question clip says "What is three quarters of eight?"
    And no clip says "dollar", "backslash" or "frac"
    And a question with no web item is read from its own text with the maths turned into words
    And a question whose words changed gets a new clip on the next publish

  Scenario: A wrong answer is voiced as "not yet", never as praise
    Given a question whose correct-answer feedback is only "Well done!" and whose explanation gives the reason
    When the quiz is published, the recorded "why" says the reason, never the praise
    And a child taps a wrong answer
    Then the voice says "Not yet. The answer is" and then the right answer by name
    And then the feedback for the option the child picked, or the reason
    And no praise is spoken, in English or in Urdu
    But a right answer is praised and then given the reason

  Scenario: Closing the page or leaving it silences every sound
    Given the voice is reading a question aloud and the lesson video may be playing
    When the page is hidden, frozen or closed (the in-app browser is closed, the child switches app or locks the phone)
    Then the recorded clip, the phone's voice, the sound effects and any playing video stop at once
    And when the child comes back nothing starts again until the child taps

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
  Scenario: A teacher with a class list: the child gives a roll number, not a name from a list
    Given the roster switch is on and the teacher keeps a class list with roll numbers
    When the quiz link is opened
    Then the page carries no classmates' names
    When the child taps "Play"
    Then the page asks "What is your roll number?" with a big number pad

  Scenario: A roll number is confirmed with the child's first name and animal
    Given the roster switch is on and roll number 12 in the class list is "Danish Testwala"
    When the child types 1, 2 and taps "Go"
    Then the page asks "Are you Danish?" with Danish's animal and nothing else about the child
    When the child taps "Yes, it's me"
    Then the quiz starts as the class-list child, and the teacher's report shows the class list's name and class

  Scenario: A wrong or unknown roll number never starts a quiz as someone else
    Given the roster switch is on
    When the child types a roll number nobody in the class has
    Then the pad stays and says no one in this class has that number
    When the child types a number and answers "No, try again" to "Are you <name>?"
    Then the pad is empty again

  Scenario: A quiz plays against ONE class list
    Given the teacher keeps class lists "3-B" and "5-A" and the quiz is for grade 3
    When the child types a roll number or a name that only "5-A" has
    Then no child of "5-A" is offered: an unknown roll number says "Try again!" and a typed name plays as a new child

  Scenario: The quiz's grade does not pick a class list, so the child picks the class first
    Given the teacher keeps class lists "3-B" and "5-A" and the quiz is for grade 2
    When the child taps "Play"
    Then the page asks "Which class are you in?" with "3-B", "5-A" and "My class is not here"
    When the child taps "5-A" and types a roll number
    Then only "5-A" is searched
    When another child taps "My class is not here" and types a name
    Then that child plays as a new child, not on any list

  Scenario: Never two green "Yes" buttons on one screen
    Given a typed name is near two children of the class
    Then the page asks about ONE child at a time with "Yes, it's me" and "No, I'm someone else"
    And "No" on the last one plays as a new child

  Scenario: Two children of the class share a first name
    Given the class list has two children named "Ayesha", roll numbers 1 and 7
    When a child types "Ayesha"
    Then each "Are you Ayesha?" card shows its roll number, one card at a time

  Scenario: A child who does not know their roll number types a name, and a near name is found
    Given the roster switch is on and the class list has "Ayesha Testwala"
    When the child taps "I don't know my number" and types "Aysha"
    Then the page asks "Are you Ayesha?" before starting

  # Who is playing, name first (app_settings web_quiz_identity = "v2"; off = the roll-number screens above, unchanged)
  @T360
  Scenario: Name first: the child types the name they are called by and confirms ONE card
    Given identity v2 is on and the quiz's class "4-A" has one child called "Hina Testwala"
    When the child taps "Play"
    Then the page asks "What is your name?" («آپ کا نام کیا ہے؟») and no number pad is shown
    When the child types "Hina" and taps "Start"
    Then the page asks "Are you Hina?" with Hina's animal on ONE card and nothing else about the child
    When the child taps "Yes, it's me"
    Then the quiz starts as the class-list child

  @T361
  Scenario: Two children share the typed name: the page asks, it never shows them
    Given identity v2 is on and class "4-A" has "Ali Testwala" and "Ali Raza Testwala"
    When the child types "Ali"
    Then the page asks "There is more than one Ali in 4-A. What is your full name?" with "Ali" already typed
    And no classmate's name, surname, father's name or number is on the screen
    When the child types the full name
    Then exactly one "Are you Ali?" card is shown

  @T362
  Scenario: A child who does not know the answers still plays, as a new child of this class
    Given identity v2 is on and two children of the class share the typed name and a father's name
    When the child taps "I don't know" for the father's name and for the class-list number
    Then the page says "There are 2 children called <name> in 4-A." and "Tap Yes to play. Your teacher will check which one you are."
    And it never says "I can't find" for a name the class list has
    When the child taps "Yes"
    Then the quiz starts as a new child the teacher can add to the class later

  @T490
  Scenario: "Not <first>?" on a phone holding one child's open quiz never continues it as another child
    Given identity v2 is on and a phone remembers "Tooba" and "Yusra" of class "4-A"
    And Tooba's quiz is open on this phone with 2 questions answered
    When Yusra taps "Not Tooba?", types "Yusra" and taps "Yes" on "Are you Yusra?"
    Then a new quiz starts for Yusra at question 1
    And Tooba's quiz stays open with Tooba's 2 answers, and none of Yusra's answers are saved on it
    When Tooba later taps their own card on this phone
    Then Tooba's quiz continues from question 3

  @T363
  Scenario: A link from the child's quiz hub plays as that child with no picking
    Given identity v2 is on and the hub opens "/q/<code>?k=<chip>" for a child of this class
    When the page opens
    Then the quiz starts as that child
    But when the server does not know that chip, the phone forgets it and asks "What is your name?"

  @T364
  Scenario: An invited friend only types a name
    Given identity v2 is on and a friend opens a challenge link from a child of class "4-A"
    When the friend taps "Play"
    Then the page asks only "What is your name?": no class question, no class names, no number pad
    And the friend plays as a new child who never counts in the class report

  @T365
  Scenario: The class is asked only when the hand-out could not tell
    Given identity v2 is on and the teacher has classes "4-A" and "4-B" and did not say which one the quiz is for
    When the child taps "Play"
    Then the page asks "Which class are you in?" with "4-A", "4-B" and "My class is not here"
    When the child taps "4-B" and types their name
    Then only "4-B" is searched, and the "Are you …?" card shows "4-B"
    But when the hand-out has one class, the page goes straight to "What is your name?"

  @T366
  Scenario: Remembered children are big cards on this phone, with "Someone else"
    Given identity v2 is on and this phone remembers "Hina Testwala" and "Omar Testwala"
    When the quiz link is opened
    Then the landing shows Hina and Omar as cards with their animals and a "Someone else" («کوئی اور») button
    When the child taps "Omar"
    Then the quiz starts as Omar with no typing

  @T367
  Scenario: A phone passed around a class puts "Someone else" first and lets a wrong card be undone
    Given identity v2 is on and this phone remembers 4 children
    When the quiz link is opened
    Then "Someone else" comes before the children's cards, and the cards are smaller
    When a child taps "Hina" and the first question opens
    Then a "Not Hina?" button floats over the question for a few seconds
    When the child taps it
    Then the page asks "What is your name?" and logs the wrong card with how long it took

  @T492
  Scenario: Siblings on one phone can undo a wrong card on the first question
    Given identity v2 is on and this phone remembers 2 children, "Tooba" and "Yusra"
    When Yusra taps "Tooba" by mistake and the first question opens
    Then a "Not Tooba?" button floats over the question for a few seconds
    When Yusra taps it
    Then the page asks "What is your name?" and Yusra's answers never go on Tooba's quiz

  Scenario: The first finish of a class-list child counts once, on any phone
    Given a class-list child finished the quiz on one phone
    When the same child confirms their roll number on another phone and plays again
    Then the second play is practice and the teacher's report keeps the first finish

  Scenario: The Urdu page shows the roll-number pad in Urdu digits
    Given an Urdu quiz and the roster switch is on
    When the child opens "Whose turn is it?"
    Then the keys and the "no one has number" line use Urdu digits

  Scenario: The teacher fixes a child who typed a name instead of a roll number
    Given the teacher opens their own preview link of a quiz with a class list
    When the teacher taps "Who played?"
    Then children not on the class list come first, each with a small "Set roll" link on its one-line row
    When the teacher sets roll number 12 and confirms "Is this Danish?"
    Then the list reloads with Danish at "Roll 12"

  Scenario: The teacher's own link is a page for the teacher
    Given the teacher opens their own preview link
    Then the header says "FOR TEACHERS", no mascot greets them like a child, and "Who played?" is the main button

  Scenario: "Who played?" opens with what the teacher needs first
    Given 12 children of a 30-child class list finished the quiz
    When the teacher taps "Who played?"
    Then the top line says "12 of 30 played", the average score, and which question most children missed
    And a "Not played yet" list shows the other 18 children by first name and roll number only
    And each child who played is one compact line: name, roll or "Not on your class list", score

  Scenario: A practice round's card says so
    Given a child already finished the quiz
    When the child plays it again and finishes
    Then the card says "Practice round" with the first score, and sharing it shares the first score


  Scenario: Feedback is spoken by recorded voices that every quiz shares
    Given the feedback lines are recorded once per language (right, not yet, fixed on a second try, quiz complete, encouragement)
    When a child answers right, answers wrong, fixes a tricky one, passes halfway or finishes the quiz
    Then the page plays one of that set's recorded lines, picked at random and never the same one twice in a row
    And the screen shows exactly the words the voice says
    And a wrong answer whose right option is only a picture says "Not yet. Look, this one is right." with no empty quotes
    And Urdu lines speak to the child only with imperatives or noun phrases, and no not-yet line praises
    And every Urdu line fits the results bubble beside the big mascot at 360 px without lines touching

  Scenario: A quiz gets its own read-aloud clips the first time its page is opened
    Given a quiz with no read-aloud clips, or with clips of an older voice version
    When its page is opened (the teacher's preview or the first child)
    Then its question, option, why and wrong-option feedback clips are recorded in the background, once
    And the page is never kept waiting for them; until they exist the phone's own voice reads

  Scenario: A wrong pick on a video-bank question shows only the mix-up and the reason
    Given a question whose stored WhatsApp feedback for the picked option reads "C) Good try! You mixed up X. The correct answer is B) Y, because Z. Keep going!"
    When a child picks that option on the page
    Then the page says "Not yet. The answer is" with the right option, then "You mixed up X. Z."
    And no option letter, no "the correct answer is", no praise or cheering is shown or spoken, in English or in Urdu
    And an Urdu sentence that addresses the child with a gendered verb is left out
    And a short cheer after the reason ("Try the next one!", «آگے بڑھو!») is left out, while a short sentence with content stays

  Scenario: A wrong true/false answer says which the sentence is
    Given a true/false question whose sentence is true
    When a child taps "False"
    Then the voice plays a recorded "Not yet. This sentence is true." («ابھی نہیں۔ یہ بات درست ہے۔») and the screen shows the same words
    And the landing invites the child to play the quiz, and a short quiz says "about 1 minute"

  Scenario: Numbers a child could misread are written out
    Given a child left the quiz after answering the first question
    When the child opens the link again
    Then the resume button says "Go on: question 2 of 5" («جاری رکھیں: سوال 2 از 5»), never a score-shaped "2/5"
    And "Your scores" shows each day as "6 Oct" («6 اکتوبر»), never "2026-10-06"

  @T247
  Scenario: A child remembered on this phone whom the quiz's class list does not know is asked again, never shown an error
    Given this phone remembers a child who played a quiz of another class (or whom the teacher removed from the list)
    When the child taps "Play as" that child on a quiz of this class
    Then the phone forgets that child and shows "who is playing?" (the roll-number pad when the class has a list)
    And no "Something went wrong" message is shown

  @T422
  Scenario: A word picture that hides a letter the question does not ask about is not shown
    Given a sent quiz has a question whose picture hides a letter of a word, but the question asks something else (how many syllables the word has)
    When a child opens the quiz on the page
    Then a question that makes sense without the picture plays as text, with no picture
    And a question that needs the picture is left out, and the quiz still has at least three questions
    And a question that asks which letter fills the gap keeps its picture

  @T445
  Scenario: A practice round that beats the child's best says so
    Given a child finished a quiz with 3 of 5 and later practised it with 4 of 5
    When the child practises again and gets 5 of 5
    Then the scorecard still says the first score 3/5 is the one that counts
    And it adds "New best! 5/5 · was 4/5 ⭐" («نیا ریکارڈ! 5/5 · پہلے 4/5 ⭐»)
    And a practice round equal to or below the best adds nothing

  @T265
  Scenario: A classmate's right answer shows as one quiet line while a child plays
    Given two children of a grade-3 class are playing the same class link
    When one child, Sara, answers question 4 right
    Then the other child's page shows "Sara got Q4 right ✓" («سارہ نے سوال 4 ٹھیک کیا ✓») under the progress bar for 2.5 seconds
    And the line never covers an option or the listen button, never takes a tap, moves nothing on the screen and makes no sound
    And it never shows in the first 3 seconds of a question, and at most once every 20 seconds

  @T266
  Scenario: Only right answers, only first names, and a friend stays nameless
    Given a class-link child, an invited friend and the teacher's own preview are playing the same quiz
    When each of them answers questions right and wrong
    Then a wrong answer never shows on anyone's page, and a child never sees their own answers
    And the invited friend shows as "A friend got Q2 right ✓" («ایک دوست نے سوال 2 ٹھیک کیا ✓»), never by name
    And the teacher's preview answers never show, and no surname ever shows

  @T267
  Scenario: A child thinking on one question still sees classmates play
    Given a child has had question 3 on screen for more than 15 seconds without answering, with the page in front
    When a classmate answers a question right
    Then the line appears within about 15 seconds
    And the page asks at most 8 times for that question, and stops asking once the child answers or leaves the page

  @T268
  Scenario: No peer line for grades 1 and 2, in the teacher's preview or on a quiet page
    Given a grade-1 quiz, or the teacher's own preview link, or a page with sounds turned off (🔕)
    When a classmate answers right
    Then no peer line shows and the page never asks for one
    And a quiz with no grade shows the line as for grade 3

  @T269
  Scenario: The peer line costs no extra database reads
    Given 30 children of one class are playing at the same time
    When they answer questions
    Then their classmates' lines come back inside the answers they already send
    And a child's idle check is answered from the bot's memory, with no database read for the session

  @T440
  Scenario: The landing says when classmates are playing right now
    Given at least two children of this class got a question right in the last 2 minutes
    When a child opens the class link
    Then the landing says "3 classmates are playing right now — join them!" («ابھی 3 ہم جماعت کھیل میں شامل ہیں — آپ بھی آئیں!»), a number and never a name
    And with one or none it says nothing, and a friend's challenge link never shows it

  @T441
  Scenario: The card says the child's place among today's class finishers
    Given two classmates finished this quiz earlier today
    When a child finishes it for the first time
    Then the card says "You're the 3rd in your class to finish today" («آج آپ کی کلاس میں مکمل کرنے والوں میں آپ کا نمبر 3 ہے»), and the first says "You're the first in your class to finish today!"
    And a practice round, an invited friend and the teacher's preview get no such line

  @T370
  Scenario: A child who loses the internet at the end still sees their score
    Given a child answered every question and the phone then lost its connection
    When the quiz ends
    Then the results screen shows the score the phone worked out ("You got 3 out of 5") with its stars
    And it says "Your results will reach your teacher when you are back online." («انٹرنیٹ واپس آتے ہی آپ کا نتیجہ استاد تک پہنچ جائے گا۔»)
    And no "No internet right now" error screen is shown
    And Jugnu is on that screen celebrating, though the phone is offline (the picture was fetched while question 1 was on screen)

  @T371
  Scenario: The result is sent by itself when the connection comes back
    Given a child finished the quiz offline and the results screen says the result will reach the teacher
    When the phone is back online (or the child taps "Send now", or a minute passes)
    Then the result is sent without the child doing anything else
    And the screen changes to the real results with "See my card" and "See my class"

  @T372
  Scenario: A tab closed before the result was sent sends it on the next open
    Given a child finished the quiz offline and closed WhatsApp before the connection came back
    When the child opens the same quiz link again with internet
    Then the page sends the result and opens the results, never "Go on: question 5 of 5"

  @T373
  Scenario: A flapping or very slow connection loses no answer and records none twice
    Given the connection drops and returns every few seconds, or each request takes over a second
    When a child plays the whole quiz
    Then every answer is recorded exactly once and the results arrive
    And a result sent up to a week later is still accepted

  @T374
  Scenario: The next questions' pictures and voice are fetched ahead of time
    Given a child is on question 1 of a quiz with pictures and recorded voice
    When the question has been on screen for a moment
    Then the pictures and recorded clips of questions 2 and 3 are already being fetched
    And question 1's own voice is never kept waiting for them
  @T420
  Scenario: A picture question whose picture cannot be drawn for one option plays as words
    Given a picture question where one option's picture does not exist
    When a child opens the question on a phone, in English or in Urdu
    Then the options show as a list of words, each word shown once
    And no word is painted over another

  @T421
  Scenario: Every item shape the quiz engine can write renders on a phone
    Given every question shape the engine can write (every picture kind, every question type, two to four options, long questions and options, maths, glyph and picture tiles, a picture that cannot be drawn), in English and in Urdu
    When each is opened on a 360 by 740 phone screen and then answered
    Then nothing scrolls sideways or runs off the screen, no text is cut off or covers other text, and every option shows a word or a picture
    And maths shows as typeset maths, never as "$" or a backslash command
    And Urdu text is set in the Nastaliq face, and every picture is drawn or left out as documented

  @T293
  Scenario: Maths from real questions is typeset, never spelled out
    Given a question whose stem, options or reason carry "$60\ \Omega$", "$67, 62, 57, \dots$", "$9 \div 3 \neq 3 \div 9$", "$A \rightleftharpoons B$", "$14 \xrightarrow{\div 2} 7$" or "$\text{Rs } 40$"
    When a child opens it, in English or in Urdu
    Then the child sees "60 Ω", "67, 62, 57, …", "9 ÷ 3 ≠ 3 ÷ 9", "A ⇌ B", an arrow with "÷ 2" over it and "Rs 40"
    And never the words "Omega", "dots", "neq" or "rightleftharpoons"
    And a long maths line scrolls inside its own box, starting at its beginning, instead of running off the screen

  @T294
  Scenario: A column sum option is shown as a column sum
    Given an option written as a column subtraction of 460 from 712 with a rule under it
    When a child opens the question
    Then the option shows 712 above "- 460" and a line under them, right-aligned

  @T295
  Scenario: A picture file that does not arrive never shows a broken picture
    Given a question whose picture file does not arrive
    When a child opens it
    Then the picture box disappears and the question plays on its words, with no broken-picture icon or picture caption

  @T296
  Scenario: A label question whose answer rings fall outside its picture offers its parts as words
    Given a label question one of whose answer rings lies outside its drawing, or that has no rings
    When a child opens it
    Then the parts are offered as ordinary answer buttons and no ring is drawn off the picture

  @T297
  Scenario: The render check sees both answers and every real kind of maths
    Given the render check over every question shape the engine can emit, in English and Urdu
    When it plays each one on a 360 by 740 phone
    Then it checks the screen after a wrong pick and after the right pick, and fails on a maths command spelled out in letters

  @T442
  Scenario: An invited friend never sees the class through the peer line
    Given a friend plays through a child's challenge link while the class is playing
    When classmates answer questions right
    Then the friend's page shows no classmate's name, its idle check returns nothing, and its landing has no "classmates playing now" line
    And the class still sees the friend's right answers as "A friend got Q2 right ✓"

  @T443
  Scenario: No peer line in the early years
    Given a quiz graded NURSERY, KG, PG, 1, 2 or a band starting with 1 or 2
    When a classmate answers right
    Then no peer line shows and the page never asks for one
    And a quiz graded 3 or above, or with no grade at all, shows it

  @T491
  Scenario: A shared phone reopened on a finished child's card lets the next child play
    Given a phone where "Tooba" finished this quiz and the page reopens on Tooba's card
    Then the card offers "Someone else's turn" («کسی اور کی باری»)
    When the next child taps it
    Then the page shows "Who is playing?" with the remembered cards and "Someone else"
    And Tooba's finished result is unchanged on the server
    But while answers are still waiting to be sent the card does not offer it

  # ── Jugnu's Challenge (/c/<hub token>): "Which is bigger?" and "Read aloud" ──
  @T385
  Scenario: The Challenge menu shows only the exercises that are built
    Given app setting "web_quiz_challenge" is on and a grade 3 child opens the Challenge from the hub
    Then the page is titled "Jugnu's Challenge" («جگنو کا چیلنج») and shows two tiles: "Which is bigger?" and "Read aloud"
    And no "coming soon" tile, and never the words EGRA, EGMA, test or assessment
    And a finished exercise shows its last result on its tile ("✓ 7 / 10", "✓ 42 words a minute")

  @T386
  Scenario: A child outside grades 2 to 5 is not offered the Challenge
    Given the child's class list is grade 7
    When the Challenge link is opened
    Then the page says "This challenge is for classes 2 to 5." and no exercise starts

  @T387
  Scenario: "Which is bigger?" is scored again on the server with the 4-in-a-row stop
    Given a child plays the 2 practice pairs (with "Yes! 8 is bigger." feedback) and then the 10 pairs of the grade form
    When the child misses 4 pairs in a row (a wrong tap, or no tap within 10 seconds)
    Then the phone shows no more pairs and sends its taps
    And the server re-applies the stop rule, ignores any tap after it, and answers the score
    And the result says "You got 2 out of 10!" («۱۰ میں سے ۲ صحیح!») with "More challenges" and "Try again"

  @T388
  Scenario: Read aloud records 60 seconds and shows words per minute
    Given the phone's browser allows the microphone
    When the child taps "I'm ready", hears "Ready? Begin." and reads the story shown large
    Then a 60-second countdown runs with a "Done" button that stays on screen
    And the recording goes straight to storage by a presigned upload, never through the portal
    And the result says "You read 42 words in a minute!" («آپ نے ایک منٹ میں ۴۲ لفظ پڑھے!»)

  @T389
  Scenario: Words per minute count only the time used when the child finishes the story early
    Given a child reads all 60 words in 30 seconds
    Then words per minute = 60 / (60 − 30) × 60 = 120
    And a child who taps "Done" before the end of the story is counted over the full minute (EGRA)

  @T390
  Scenario: A child with nothing right in line 1 is stopped and encouraged, never shown 0
    Given the scorer finds no word of the story's first line read correctly
    Then the run is stored with 0 words per minute and "stopped"
    And the page says "Good try! Reading gets easier every day you practise." with no number

  @T391
  Scenario: WhatsApp's browser cannot give the microphone
    Given the microphone is refused, or the browser has no getUserMedia or MediaRecorder
    When the child taps "I'm ready"
    Then the page says "Your WhatsApp browser can't use the microphone." («آپ کا واٹس ایپ براؤزر مائیک استعمال نہیں کر سکتا۔»)
    And offers "Open in Chrome" (Android) and "Skip this one", and logs web_quiz.ch_mic with ok false and the error name

  @T392
  Scenario: A child's recording is scored and forgotten; slow scoring is polled
    Given scoring a reading takes more than 5 seconds
    Then the result call answers "pending" and the page asks again every 3 seconds, up to 60 seconds
    And the recording is deleted from storage after scoring, and only the numbers are kept
  @T280
  Scenario: Every line a child hears in a quiz is in one voice per language
    Given a teacher's quiz in English (or in Urdu) whose clips were recorded after this change
    When a child answers a question wrongly
    Then the recorded "Not yet. The answer is" line, the right option's clip and the reason are all in the same voice (Soniox Grace in English, Soniox Ishita in Urdu)
    And the shared feedback library names that same voice for its language

  @T281
  Scenario: A clip the voice could not record is never recorded in another voice
    Given the quiz voice is unavailable while a quiz's clips are being recorded
    When the recording job runs
    Then no clip is recorded by another voice provider
    And the quiz is left unstamped so the job tries again later, and the page shows the words big meanwhile

  @T282
  Scenario: A slow clip is waited for, not swapped for the phone's voice
    Given a child on a slow connection opens a question whose clip takes more than 2 seconds to start
    Then the words are shown big while the clip keeps loading, and the phone's own voice does not speak
    And a clip that has not started after 8 seconds is let go quietly and logged as stalled
    And a clip the browser refuses to start before a tap makes the speaker button pulse, and a tap plays it

  @T283
  Scenario: Quiz audio is stored in the configured bucket under a name that says what it is
    Given WEB_QUIZ_AUDIO_BUCKET names a bucket on the bot and the worker
    When a new quiz's clips are recorded
    Then each clip is stored in that bucket as quiz-audio/<env>/<quiz>/<lang>/<question>/<part>-<voice>-<hash>.ogg
    And the quiz remembers the bucket, so its clips keep playing after the variable changes
    And a quiz recorded before this change keeps playing from the bucket it was recorded in

  @T284
  Scenario: Recording quiz audio can be switched off and is capped per day
    Given app_settings web_quiz_audio_enabled is false, or today's recorded quizzes have reached web_quiz_audio_daily_cap
    When a quiz's page is opened
    Then no clip is recorded and the job does not retry, and the page reads with the words big
    And reaching the cap is logged as web_quiz_audio.capped

  @T250
  Scenario: The school league ranks every school that played this week by points that reward taking part
    Given children of several schools finished quizzes this week (Monday to now, Pakistan time)
    When a child opens "School league" from the card, the class table or "today"
    Then each school that played shows its place, its points and how many children played
    And a school earns 10 points for each child's first finish of a quiz plus up to 10 for that score
    And a practice re-attempt, a teacher's own test and a test teacher's quiz add nothing
    And a school marked as a test school appears only on its own children's league, never on anyone else's
    And no teacher, class or child is named on the league

  @T251
  Scenario: A child's own school is always in view, with its move since yesterday and what this finish added
    Given the child's quiz was sent by a teacher of a school that has points this week
    When the child opens the school league after finishing
    Then a card on top says "<school> is #<place> this week", the move since yesterday, and "+<n> points for <school>!"
    And the school's row in the list is highlighted and stays pinned to the top or bottom of the screen when scrolled away

  @T252
  Scenario: A school with no points yet is invited, never ranked last
    Given no child of the child's school has finished a quiz this week
    When the child opens the school league
    Then the card on top says "No one from <school> has played yet this week. Be the first!" with no place number
    And the share button says "Invite my school to play"
    And the other schools still to start are one folded line "N schools still to start" that opens to their names, without numbers

  @T253
  Scenario: Caps keep the league fair
    Given a child finishes seven quizzes in one Pakistan day, and seven friends take one child's challenge on one quiz
    When the league is counted
    Then only the child's first five quizzes that day add points, and only the first five friends of that challenge add points
    And the sixth quiz and the sixth friend still play and see their score

  @T254
  Scenario: The school league has its own link, in English and in Urdu
    Given a child shares the school league to the class group
    When someone opens /q/<CODE>/schools
    Then the page opens straight on the league with the preview title "School league this week" («اس ہفتے اسکولوں کی لیگ»)
    And "My sector" filters the list to the child's sector and "All" brings every school back

  @T290
  Scenario: Jugnu gives a hint on a tap, never the answer
    Given a question whose web item carries a hint written from the lesson ("Think about what you can pour into a glass.")
    When the child taps the small thinking Jugnu ("Need a hint?" / «اشارہ چاہیے؟») under the options
    Then the hint shows beside a thinking Jugnu and is spoken in the quiz's one voice from its own recorded clip
    And the hint never says any option, the number that is the answer, the thing a picture option shows, or the word a missing-letter picture spells
    And using the hint does not change the child's score

  @T291
  Scenario: A child who sits stuck is nudged once
    Given a question with a hint that the child has not asked for
    When twenty seconds pass after the voice has finished reading the question
    Then Jugnu wiggles once and says "Stuck? Tap me for a hint." («مشکل لگ رہا ہے؟ اشارے کے لیے مجھے دبائیں۔»)
    And a question with no hint offers "Shall we listen again?" as before

  @T292
  Scenario: A hint that would give the answer away is thrown out and the question still plays
    Given the author writes a hint that names the right option (or a wrong one, or says "the answer is")
    When the quiz is made
    Then that question keeps its web item with no hint, and on the page Jugnu offers no hint for it
    And the quiz's log line counts the hints kept and the hints dropped by reason

  @T248
  Scenario: A friend who plays a challenge learns who won
    Given a child finished the class quiz with 3 of 4 and sent a friend their challenge link
    When the friend opens the link, plays and finishes with 4 of 4
    Then the friend's scorecard says "You beat the challenge!" («آپ نے چیلنج جیت لیا!») with "You 4/4 · <challenger> 3/4"
    And a friend with the same share of right answers sees "It's a tie!" («مقابلہ برابر رہا!»), a lower one "So close! Play again?"
    And when the challenger opens "My scores", the friend's row says "beat you!" («آپ سے آگے!»), or "you won" when the challenger did better

  @T249
  Scenario: A challenge link carries no child's name
    Given a child finished a quiz
    When the child taps "Challenge a friend"
    Then the shared link is the child's challenge code alone ("/q/<code>"), with no name in it
    And the friend's landing still names the challenger, read from the code on the server
