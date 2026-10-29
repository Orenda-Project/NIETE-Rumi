# lib — FLN path and sign-in return helpers

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/fln/lib kg=bbfdac408970 gen=1dd40adcaa1d overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `safeNext.ts` — validates next= after sign-in
- `flnPath.ts` — the /portal/fln/p/<id> deep-link
- `safeNext.test.ts` — vitest: `cd portal && npx vitest run src/portal/fln/lib`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `flnPath.ts` | flnPlanPath(id): the /portal/fln/p/<id> deep-link every reopen list and sent link uses |
| `safeNext.ts` | safeNext(raw) validates sign-in next= (only /portal/fln, teacher, coach disagreements paths); goAfterSignIn |
| `safeNext.test.ts` | Vitest: safeNext allows only same-origin paths under allowed prefixes; refuses other origins, schemes, .. |

## Who reads this (generated)
- `flnPath.ts` ← imported by `portal/src/portal/lib/recentLessonPlans.ts:29:0327dcc8` · `portal/src/portal/newui/home/HomeList.tsx:9:1c9a4fe6` (+2)
- `safeNext.ts` ← imported by `portal/src/portal/fln/login/FlnLoginBanner.tsx:9:a2331154` · `portal/src/portal/fln/login/index.ts:3:59455074`

## Never (human)
- safeNext keeps only same-origin paths under allowed prefixes; anything else is null (safeNext.ts:4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/fln/lib/safeNext.test.ts` (safeNext.ts)
- `portal/src/portal/fln/tests/readers.test.tsx` (flnPath.ts)

## Related (generated)
- docs: `portal/src/portal/fln/CLAUDE.md`?
