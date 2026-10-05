Feature: Web quiz item types on the child page
  The child page draws each question by its type: picture grids, order, match, label, listen,
  figures and maths. A question with no type renders exactly as a plain choice did before.

  # Item types (web-native questions). A question with no "type" renders exactly as before.
  Scenario Outline: Every web item type renders with large tap targets in both languages
    Given a quiz in "<lang>" with one question of type "<type>"
    When the child reaches that question
    Then every control a child can tap is at least 48 by 48 pixels
    And the page direction is "<dir>"
    And the browser shows no console errors
    Examples:
      | type    | lang | dir |
      | single  | en   | ltr |
      | picture | ur   | rtl |
      | multi   | en   | ltr |
      | order   | ur   | rtl |
      | match   | en   | ltr |
      | label   | ur   | rtl |
      | listen  | en   | ltr |

  Scenario: Order the steps by tapping, no dragging
    Given an "order" question with four steps
    When the child taps the steps one by one
    Then each step fills the next numbered place
    And tapping a filled place takes that step back
    And "Check" sends the steps in the order the child chose

  Scenario: Match pairs by tapping a left item and then its partner
    Given a "match" question with three pairs
    When the child taps each partner in turn
    Then each pair shows in its own colour
    And "Check" sends the partner chosen for each left item in order

  Scenario: Label the diagram
    Given a "label" question with a figure and numbered hotspots
    When the child taps a hotspot
    Then that hotspot is the answer
    And the voice reads only the instruction, not the names of the parts

  Scenario: Maths is typeset, not printed as code
    Given a question whose text or why contains "$\frac{3}{4}$"
    Then the page shows a stacked fraction
    And the voice says "3 over 4" in English and "4 میں سے 3" in Urdu

  Scenario: A figure can be made bigger
    Given a question with a figure
    When the child taps the figure or "Make the picture bigger"
    Then the figure opens full screen and a tap closes it

  Scenario: Picture options say their names
    Given a "picture" or "listen" question
    When the question is read aloud
    Then the voice says the stem and then each picture's name

  Scenario: Pictures on slow data
    Given a question with picture options or a figure file
    When its pictures have not arrived yet
    Then each one shows a soft loading pulse instead of an empty tile
    And while the child answers, the next question's pictures are fetched

  Scenario: A picture option with no word
    Given a picture option that has no stored name
    Then its button is labelled with its shape's name for screen readers
    And the voice does not say that name
