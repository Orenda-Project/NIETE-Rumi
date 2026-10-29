# checks — Design-rule tests that fail the build when the new UI breaks DESIGN.md
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/newui/checks kg=3550d0cdef43 gen=cabc9825b654 overflow=52 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `rules.ts` — rule functions (max 4-word labels, allowlist) the *.test files call
- `source.ts` — reads newui source for the checks; run: `cd portal && npx vitest run src/portal/newui/checks` (vitest.config.ts, jsdom)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `rules.ts` | bd-5rz1v.19: design-rule functions (max 4-word labels, allowlist) the checks/*.test files call |
| `tap.test.tsx` | bd-5rz1v.19: every interactive kit component keeps the tap-target class contract (at least 56px) |
| `source.ts` | bd-5rz1v.19: test-only reader of newui source (fs plus TypeScript parser) for the design checks |
| `copy.test.ts` | bd-5rz1v.19 CHECK 1: new-UI copy is labels not sentences; all words live in copy.ts |
| `style.test.tsx` | bd-5rz1v.19 CHECK 3: green primaries only, logical spacing for RTL, motion only when allowed |

## Who reads this (generated)
- `rules.ts` ← imported by `portal/src/portal/newui/checks/source.ts:13:c610a2d8`

## Never (human)
- Each COPY_ALLOWLIST entry needs a reason; it is a sentence on a teacher's screen (rules.ts:16-17)
- source.ts is test-only (fs and TS parser); no app code imports it (source.ts:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/auth/auth.source.test.ts` (rules.ts, source.ts)
- `portal/src/portal/coach/people/checks.test.tsx` (rules.ts, source.ts)
- `portal/src/portal/newui/checks/copy.test.ts` (rules.ts, source.ts)
- `portal/src/portal/newui/coaching/RecordingBar.newUi.test.tsx` (rules.ts, source.ts)
- `portal/src/portal/teacher/analytics/checks.test.tsx` (rules.ts, source.ts)
- `portal/src/portal/teacher/assessment/checks.test.tsx` (rules.ts, source.ts)
- `portal/src/portal/teacher/attendance/checks.test.tsx` (rules.ts, source.ts)
- `portal/src/portal/teacher/classes/checks.test.tsx` (rules.ts, source.ts)
- `portal/src/portal/teacher/coaching/checks.test.tsx` (rules.ts, source.ts)
- `portal/src/portal/teacher/lessons/checks.test.tsx` (rules.ts, source.ts)
- `portal/src/portal/teacher/notices/checks.test.tsx` (rules.ts, source.ts)
- … 52 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/newui/CLAUDE.md`?
