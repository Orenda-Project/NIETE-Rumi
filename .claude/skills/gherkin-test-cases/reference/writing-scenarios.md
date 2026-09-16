# Writing the scenarios — the craft rules

Sections 5-9, moved out of SKILL.md 2026-08-23 (bd-p7q5x) to keep the entry file under the
500-line compaction cap. You are past deciding WHAT to cover and are now writing the Gherkin.

# 5. Gherkin / BDD Rules

Use standard BDD semantics.

### Given

Establishes the relevant context or precondition.

### When

Represents the meaningful action or event being tested.

### Then

Verifies the observable outcome.

### And

Continues the previous Given, When, or Then logically.

---

## Scenario Rules

Every scenario must:

* Test one clear behavior
* Have a meaningful scenario name
* Be independently understandable
* Have a clear expected outcome
* Represent meaningful regression coverage
* Avoid unnecessary setup
* Avoid implementation details

Prefer:

```gherkin
Scenario: User successfully submits a completed registration form
  Given the user is on the registration form
  And all required information has been provided
  When the user submits the form
  Then the registration is completed successfully
  And the user sees the registration confirmation
```

Avoid:

```gherkin
Scenario: Test registration
  Given the browser is open
  And the website is loaded
  And the user clicks the registration button
  When the POST endpoint is called
  Then the database contains a registration record
```

The second example focuses on implementation rather than behavior.

---

# 6. Behavior Over Implementation

Do not include:

* API endpoints
* HTTP methods
* Database queries
* Database tables
* DOM selectors
* Element IDs
* CSS classes
* Internal function names
* Internal service names
* Implementation-specific details

unless the requirement explicitly asks for technical-level testing.

Test what the user/system **does and observes**, not how the application happens to implement it.

---

# 7. Avoid Shallow Scenarios

Do not produce scenarios that merely restate the action.

Weak:

```gherkin
Scenario: User logs in
  Given the user is on the login page
  When the user logs in
  Then the user is logged in
```

Prefer:

```gherkin
Scenario: User successfully logs in with valid credentials
  Given the user has a registered account
  And the user is on the login page
  When the user submits valid credentials
  Then the user is authenticated successfully
  And the user is redirected to the dashboard
```

The expected outcome should provide meaningful confidence.

---

# 8. Avoid Duplicate Coverage

Before adding a scenario, compare it mentally with the scenarios already generated.

Do not create multiple scenarios that prove the same behavior with different wording.

For example, these are usually duplicates:

```gherkin
Scenario: User submits the form
Scenario: User clicks submit
Scenario: User completes the submission
```

if they all verify the same successful submission.

Create separate scenarios only when there is a meaningful difference in:

* Business rule
* Expected outcome
* User role
* State
* Input category
* Permission
* Risk
* Failure behavior

## Avoid redundant flows

Duplicate coverage is two scenarios proving the SAME behavior. Redundant flows are two
scenarios proving DIFFERENT behaviors that both re-walk the same setup and trigger. Both
are waste, but the second is easier to miss — each scenario looks justified on its own.

**If multiple related behaviors can be verified within the same user flow, combine them
into one scenario instead of repeating the same setup/trigger in separate test cases.**

Before creating a new scenario, ask:

> **"Can this be verified naturally in an existing flow?"**

If yes, add the assertion to that scenario. Create a separate test only when it requires a
meaningfully different **flow, state, trigger, or business rule**.

Redundant — same actor, same trigger, same state, split only by which part of the response
each one looks at:

```gherkin
Scenario: /menu shows exactly the 4 feature rows
  When I send "/menu"
  And I open the "View Features" list
  Then the feature list shows exactly these rows: ...

Scenario: /menu header + opener use the expected copy
  When I send "/menu"
  Then the message header is "Here's what I can do!"
  And the list opener button is labelled "View Features"
```

Combined — one flow, both behaviors, assertions ordered as the teacher meets them:

```gherkin
Scenario: /menu renders the card and exactly the 4 feature rows
  When I send "/menu"
  Then the message header is "Here's what I can do!"
  And the list opener button is labelled "View Features"
  When I open the "View Features" list
  Then the feature list shows exactly these rows: ...
```

Two caveats when you merge:

* **Mixed brittleness.** If some assertions are exact-string checks and others are
  structural, the merged scenario inherits the brittle ones. Say so in a comment so a
  reader knows to check WHICH step failed before filing a bug — the structural step is the
  contract, the exact string is not.
* **Don't merge across a state change.** `/register` when unregistered and `/register` when
  already registered share a trigger but not a state — those stay separate. The shared
  trigger is not the test; the shared *state* is.

---

# 9. Scenario Outline

Use `Scenario Outline` only when the **same behavior** is being verified across multiple meaningful data variations.

Example:

```gherkin
Scenario Outline: User can select a supported language
  Given the user is on the language selection screen
  When the user selects "<language>"
  Then the application displays the interface in "<language>"

  Examples:
    | language |
    | English  |
    | Urdu     |
```

Do not use Scenario Outline merely to reduce the number of lines.

If different inputs result in different business behavior, use separate scenarios.

---
