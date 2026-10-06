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
