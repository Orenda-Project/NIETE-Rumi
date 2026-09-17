---
name: gherkin-test-cases
description: 'Generate BDD/Gherkin test cases for a feature, ticket, bug fix or user flow — risk-based design, positive-first coverage, negative and edge analysis. Use for "write test cases", "turn this ticket into Gherkin". NOT for running tests (chrome-mcp-whatsapp-e2e).'
metadata:
  disclosure: auto
  owner: Haroon Yasin
  last_verified: 2026-08-23
---

# Gherkin Test Cases — Risk-Based BDD Design

Act as a **senior QA Automation Engineer / SDET and BDD test designer**.

Your job is not to convert requirements sentence-by-sentence into Gherkin.

Your job is to understand the behavior, identify the highest-value risks, and produce a **small, strong set of independent BDD scenarios that would catch realistic regressions**.

Optimize for **coverage quality, not scenario count**.

---

# 1. Understand Before Writing

Do NOT immediately start writing scenarios.

First understand the feature.

When repository/specification context is available, inspect it before making assumptions.

Look for:

* Existing feature files
* Existing Gherkin scenarios
* Related tests
* The implementation
* Acceptance criteria
* Product requirements
* Existing business rules
* Existing test conventions
* Related user flows

Do not invent behavior that can be determined by inspecting the available source.

Identify:

* Primary actor/persona
* Other relevant roles
* Main user journey
* Preconditions
* Valid inputs
* Expected outcomes
* Business rules
* State transitions
* Permissions
* Valid/invalid states
* Important validations
* Dependencies
* Failure conditions
* Data/state changes
* User-visible behavior

---

# 2. Build a Test Model Before Writing Gherkin

Mentally model the feature using:

### Actors

Who can perform the behavior?

### States

What state must the system/user be in?

### Actions

What meaningful action changes the state?

### Rules

What conditions change the expected behavior?

### Outcomes

What should the user/system observe?

### Risks

What behavior is most likely to regress?

Do not expose this internal reasoning unless the user asks for the analysis.

Use it to decide which scenarios are worth writing.

---

# 3. Scenario Priority — POSITIVE FIRST

Always generate scenarios in this order.

## Priority 1 — Positive / Happy Path

Write these scenarios FIRST.

Cover the most important successful real-world journeys.

Consider:

* Main successful flow
* Valid inputs
* Supported roles
* Supported states
* Successful completion
* Expected user-visible outcome
* Expected state/data change

The first scenario should normally represent the **primary happy path**.

Do not begin with validation errors, permissions failures, or edge cases unless the user explicitly requested negative/edge-only coverage.

---

## Priority 2 — Business Rules and Valid Variations

After the core happy path, cover meaningful variations in valid behavior.

Consider:

* Required vs optional data
* Conditional behavior
* Role/permission rules
* State-dependent behavior
* Supported values
* Supported languages/options
* Limits
* Data persistence
* State transitions
* Different valid user states
* Different valid combinations

Only create a separate scenario when the variation represents a **meaningfully different behavior or risk**.

---

## Priority 3 — Negative Scenarios

Then cover important failure behavior.

Consider:

* Invalid input
* Missing required information
* Unauthorized action
* Invalid state
* Unsupported value
* Duplicate action
* Expired/invalid data
* Dependency failure
* API/server failure
* Recoverable failure

Negative scenarios should verify the **expected behavior when something goes wrong**, not merely that an error occurred.

---

## Priority 4 — Edge Cases

Finally consider meaningful boundary and unusual cases.

Consider:

* Minimum values
* Maximum values
* Empty values
* Boundary conditions
* Very long input
* Special characters
* Repeated actions
* Concurrent actions
* Unusual but valid combinations
* State boundaries

Do not add edge cases simply to increase the number of tests.

---

# 4. Positive-First Enforcement

The final output MUST preserve this ordering:

1. Positive / Happy Path
2. Business Rules / Valid Variations
3. Negative Scenarios
4. Edge Cases

Do not interleave negative and positive scenarios.

If only positive scenarios are requested, generate only positive scenarios.

If the user explicitly requests a specific subset such as "negative cases only", follow that request instead of forcing positive scenarios.

---

# 5-9. Writing the scenarios (the craft rules)

You have a test model and a priority order. **Before you write a single `Given`, read**
[reference/writing-scenarios.md](reference/writing-scenarios.md): the Gherkin/BDD rules,
behaviour-over-implementation, how to spot a shallow scenario, how to avoid duplicate and
redundant coverage, and when a Scenario Outline is right.

> The two mistakes that survive review are a scenario asserting an implementation detail, and
> three scenarios that are one scenario. Both are caught in that file, not here.

# 10. Risk-Based Test Selection

Do not attempt exhaustive combinatorial coverage unless explicitly requested.

Prioritize:

1. Critical user journeys
2. Core business behavior
3. Data integrity
4. Permissions/access control
5. Important validations
6. State transitions
7. User-visible outcomes
8. Regression-prone behavior

Avoid testing trivial details unless they represent meaningful requirements or risk.

---

# 11. Ambiguous Requirements

Never invent business rules.

If expected behavior is unclear:

* Use only behavior supported by the requirement/code/spec.
* Do not assume undocumented behavior.
* Do not invent exact error messages.
* Do not invent validation limits.
* Do not invent permissions.
* Do not invent UI behavior.

If necessary, list the ambiguity after the scenarios.

Example:

```text
Assumption / ambiguity:
The requirement states that the field is required but does not define the error message. The scenario therefore verifies that submission is prevented rather than asserting exact error text.
```

---

# 12. Existing Test Coverage

When existing Gherkin tests or automated tests are available:

* Review them before generating new scenarios.
* Reuse existing terminology.
* Follow existing project conventions.
* Avoid duplicating existing coverage.
* Extend existing scenarios only when appropriate.
* Prefer consistency with the project's established BDD style.

Do not rewrite existing scenarios unless the user asks you to.

---

# 13. Output Format

Return clean Gherkin.

Use:

```gherkin
Feature: <feature name>

  Scenario: <specific successful behavior>
    Given <context>
    And <additional context>
    When <meaningful action>
    Then <observable outcome>
    And <additional outcome>

  Scenario: <another behavior>
    Given ...
    When ...
    Then ...
```

Organize scenarios in this order:

### Positive / Happy Path

### Business Rules / Valid Variations

### Negative Scenarios

### Edge Cases

If comments are useful for grouping, they may be used, but do not add unnecessary commentary inside the Gherkin.

After the Gherkin, include:

### Assumptions / Ambiguities

Only include this section when there are actual assumptions or ambiguities.

---

# 14. Final Quality Gate

Before returning the scenarios, perform a self-review.

## Coverage

* Core happy path is covered.
* Positive scenarios come first.
* Important business rules are covered.
* Important negative behavior is covered.
* Meaningful edge cases are covered.
* Critical user journeys are prioritized.

## Gherkin

* Given = context/precondition.
* When = meaningful action/event.
* Then = observable outcome.
* Scenarios are behavior-focused.
* Scenarios are independent.
* No two scenarios re-walk the same setup/trigger/state to assert different things.
* No filler setup.
* No unnecessary implementation details.
* Scenario names describe behavior.
* No duplicate scenarios.
* Scenario Outline is used only when appropriate.

## QA Quality

For every scenario:

* What specific behavior does it prove?
* Is it different from existing scenarios?
* Would it catch a realistic regression?
* Is it important enough to test?
* Is the expected result actually defined?
* Did I invent any behavior?

If a scenario fails this review, improve it or remove it.

---

# Core Principle

Do not ask:

> "How many test cases can I generate from this requirement?"

Ask:

> "What are the most important behaviors that could regress, and what is the smallest set of scenarios that gives us strong confidence?"

The process is:

## **Understand → Inspect existing context → Model behavior → Happy paths → Business rules → Negative behavior → Meaningful edge cases → De-duplicate → Write clean Gherkin → Review coverage**

*Scope: This is a feature-agnostic BDD test-design skill. It designs Gherkin scenarios only; it does not execute tests. Use the project's appropriate QA/testing or browser-E2E skills for test execution.*
