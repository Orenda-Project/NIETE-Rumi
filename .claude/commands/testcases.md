# /testcases — Generate BDD/Gherkin test cases for a feature

Generate high-quality, **risk-based** Gherkin test cases for whatever is named in `$ARGUMENTS`, using the [`gherkin-test-cases`](../skills/gherkin-test-cases/SKILL.md) skill.

**Argument (`$ARGUMENTS`)** — the feature, requirement, user story, bug fix, flow, spec file, or ticket to cover. Examples:
- `/testcases password reset flow`
- `/testcases bd-x1y2z.3 exam-checker fix`
- `/testcases tests/features/whatsapp/niete/language.feature`
- `/testcases` + a pasted user story

## What to do

1. **Invoke the `gherkin-test-cases` skill and follow it exactly** — do not free-hand test cases.
2. **Understand the target first.** If `$ARGUMENTS` points at code, a `.feature`/spec file, or a ticket, **read it** — never guess behavior. If `$ARGUMENTS` is empty, ask which feature/requirement to cover before writing anything.
3. Produce scenarios in the skill's order — **Positive / Happy-path FIRST**, then Business rules, then Negative, then meaningful Edge cases — as clean, behavior-focused Gherkin with no shallow or duplicate scenarios. List any assumptions/ambiguities separately (never invent unspecified behavior).
4. Output a ready-to-use `Feature:` block. If the user named an existing `.feature` file, offer to fold the new scenarios into it (tagged to match that suite's conventions) rather than overwriting.

Return the scenarios, not a description of them.
