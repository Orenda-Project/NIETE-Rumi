---
name: qa-testing
description: How testing works in this repo — the test runner, the domain-organised jest suites, the conformance guards that lock the schema/docs/source contracts, and the route-contract pattern for catching orphan dispatch. Use before adding tests or diagnosing CI.
---

# QA Testing Skill

> **Up:** [.claude/CLAUDE.md](../../CLAUDE.md) (config & skills router) · **See also:** [coaching](../coaching/SKILL.md), [registration](../registration/SKILL.md)

Tests are plain **jest**, organised by domain, run through a small wrapper. CI runs the full suite on a Node
version matrix on every PR. Green suite is the merge gate.

## Running tests

Always go through the wrapper — **not** `npx jest` directly (newer Node needs a `--localstorage-file` flag
that the wrapper supplies; calling jest raw hits a `SecurityError`):

```bash
npm test                 # full suite → node tests/run.js
npm run test:security    # one slice (sprint-0)
npm run test:schema      # schema guards (sprint-2)
npm run test:setup       # setup/onboarding (sprint-3)
npm run test:docs        # doc conformance (sprint-4)
npm test -- --testPathPattern=coaching   # one domain
```

[tests/run.js](../../../tests/run.js) resolves the jest binary and adds the Node-compatibility flags.

## Layout

```
tests/
  setup/            conformance guards (schema, columns, source hygiene, …)
  unit/sprint-N/    sprint-scoped unit tests
  coaching/ quiz/ registration/ reading-assessment/ … one folder per feature domain
  __mocks__/ fixtures/   shared test doubles
```

Tests `require('../../bot/shared/…')` the real bot code. **Important for CI**: the root suite runs *before*
the bot's own `npm ci`, so a test that loads bot code must virtually-mock any bot-only dependency:

```js
jest.doMock('some-bot-only-package', () => ({ /* stub */ }), { virtual: true });
```

## Conformance guards (the contract layer)

The most valuable suites aren't feature tests — they're guards in [tests/setup/](../../../tests/setup/) that
keep the repo clone-safe and self-consistent. They fail the build the moment a contract drifts:

| Guard | Asserts |
|-------|---------|
| `schema-completeness` | every table the bot `.from()`s exists in the schema file |
| `column-completeness` | every column the bot reads/writes exists (top-level insert/select keys) |
| `table-usage-conformance` | every `CREATE TABLE` is actually referenced somewhere (no orphan tables) |
| `source-hygiene` | no internal ticket refs / no leaked internal context in source + agent docs; entry-point files pass `node --check` |
| `schema-production-parity` | the consolidated schema stays consistent |
| `env-template-completeness` / `setup-validator` / `validate-flows` | the clone/setup contract holds |

When you add a table, column, flow, or skill, the matching guard tells you what you forgot — read its
failure message before "fixing the test".

## The route-contract pattern (catch orphan dispatch)

Service-layer unit tests mock the receivers, so they **cannot** catch an interactive ID that nothing
dispatches. The cheap, mock-free fix is a test that greps the entry file and asserts the dispatcher exists:

```js
test('my_feature_start has a button_reply dispatcher', () => {
  const src = fs.readFileSync('bot/whatsapp-bot.js', 'utf8');
  expect(src).toMatch(/buttonId === ['"]my_feature_start['"]/);
});
```

Add one of these for every new button / list / Flow id you emit. The full rationale + the four webhook
shapes is in [pre-merge-checklist](../pre-merge-checklist/SKILL.md).

## When to run what

| Situation | Run |
|-----------|-----|
| Editing a handler/service | `npm test -- --testPathPattern=<domain>` then the full suite before pushing |
| Adding a table/column/flow/skill | the relevant `tests/setup/` guard, then `npm test` |
| Before any push | `npm test` (the whole suite — it's fast) |
| Editing a shared service | full suite + the checks in [cross-agent-safety](../cross-agent-safety/SKILL.md) |

## Optional: generative / persona testing

Beyond deterministic suites, a deployment can add an LLM-driven layer — "persona" agents that walk
multi-feature journeys via simulated webhooks, and a judge model that scores the replies — to surface
unknown-unknowns before release. That's an advanced add-on, not part of the base suite; build it as its own
opt-in test path (gated behind an env flag so it doesn't run in normal CI).

## Related Skills

- [coaching](../coaching/SKILL.md) · [registration](../registration/SKILL.md) — domains with rich test suites to model new tests on.
- [pre-merge-checklist](../pre-merge-checklist/SKILL.md) — the bug classes the guards and route-contracts defend against.
