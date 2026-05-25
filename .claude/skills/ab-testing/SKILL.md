---
name: ab-testing
description: A/B testing via a Thompson-sampling multi-armed bandit. DB-driven tests (ab_tests / ab_test_variants / ab_test_events) that learn the best-performing variant online. Use when adding or measuring a message/content experiment.
---

# A/B Testing Skill

> **Up:** [.claude/CLAUDE.md](../../CLAUDE.md) (config & skills router)

A/B testing here is a **multi-armed bandit** using Thompson sampling, not a fixed percentage split. Instead
of hard-assigning 50/50, the bandit *learns*: it samples each variant in proportion to how well it's
converting, so traffic shifts toward the winner over time while still exploring the others.

## Core pieces

- **Service**: [bot/shared/services/bandit.service.js](../../../bot/shared/services/bandit.service.js) — `BanditService`.
- **Tables**: `ab_tests` (one row per test), `ab_test_variants` (the arms, each with `successes`/`failures` counts), `ab_test_events` (impressions/conversions log). Schema: [infrastructure/supabase/00_complete-schema.sql](../../../infrastructure/supabase/00_complete-schema.sql).

## How it works

1. Each **arm** is a variant (e.g. message phrasing A / B / C), tracked by a Beta(α, β) where α = successes + 1, β = failures + 1.
2. `selectVariant(testName, language)` samples from each arm's Beta distribution and returns the highest sample — so better-converting arms are chosen more often, but every arm keeps a chance.
3. You record the outcome: `recordImpression(...)` when shown, then `recordConversion(...)` or `recordNonConversion(...)`. These update the arm's `successes`/`failures`.
4. `getTestStats(testName)` returns per-arm counts + a Wilson-score confidence interval for reporting.

```js
const BanditService = require('../services/bandit.service');

// pick a variant for this user
const choice = await BanditService.selectVariant('feature_suggestion_copy', user.preferred_language);
if (choice) {
  await BanditService.recordImpression(choice.testId, choice.variantName, user.id, phone);
  await sendMessage(phone, BanditService.getLocalizedMessage(choice.content, user.preferred_language));
  // later, when the user acts (or doesn't):
  // await BanditService.recordConversion(choice.testId, choice.variantName, user.id, phone);
}
```

`selectVariant` returns `null` when there's no **active** test of that name — always handle that (fall back
to your default copy).

## Creating a test

Insert one `ab_tests` row (`test_name`, `status='active'`) and one `ab_test_variants` row per arm
(`variant_name`, `variant_content` — a JSON object, optionally keyed by language). The bandit starts at
α=β=1 for each arm (uniform) and adapts as events arrive. Set `status` to something other than `active` to
stop a test (the bot then falls back to the default).

```sql
SELECT v.variant_name, v.successes, v.failures
FROM ab_test_variants v JOIN ab_tests t ON v.test_id = t.id
WHERE t.test_name = 'feature_suggestion_copy';
```

## Measuring

Read `ab_test_events` (or `getTestStats`) for impressions and conversions per arm. Because the bandit
shifts traffic toward the leader, don't expect equal sample sizes across arms — judge by **conversion
rate** and the Wilson interval, not raw counts. Deterministic variant tests that just need an impression
counter (e.g. an LP variant) can use the `increment_variant_impressions(test_id, variant_name)` RPC instead
of the full bandit.
