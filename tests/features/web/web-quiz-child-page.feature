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
