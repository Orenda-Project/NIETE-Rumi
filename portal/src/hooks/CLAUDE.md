# hooks — Small shared React hooks: toasts, mobile breakpoint, marketing funnel tracking

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/hooks kg=65e18ec3e413 gen=6a466fecb09e overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `use-toast.ts` — toast store behind components/ui/toaster.tsx
- `useFunnelTracking.ts` — page-visit hook used by the marketing pages
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `use-toast.ts` | shadcn toast store (reducer, toast(), useToast) behind the Toaster and portal toasts |
| `CLAUDE.md` | (unmapped) |
| `use-mobile.tsx` | useIsMobile hook (matchMedia under 768px); only importer is the unused shadcn sidebar |
| `useFunnelTracking.ts` | useTrackPageVisit hook: records a funnel page visit on mount via lib/funnelTracking; used by the marketing pages |

## Who reads this (generated)
- `use-toast.ts` ← imported by `portal/src/components/ui/toaster.tsx:1:687d908e` · `portal/src/portal/components/AssessmentGeneratorPanel.tsx:62:bf8ab455` (+36)
- `use-mobile.tsx` ← imported by `portal/src/portal/analytics/SchoolsAnalytics.tsx:4:fc48607c` · `portal/src/components/ui/sidebar.tsx:6:0a197eed`
- `useFunnelTracking.ts` ← imported by `portal/src/pages/Index.tsx:10:05abea4b`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/pages/ClassicAssessment.tabs.test.tsx` (use-toast.ts)

## Related (generated)
- docs: `portal/src/CLAUDE.index.md`? · `portal/src/CLAUDE.md`? · `portal/src/hooks/CLAUDE.md`? · `portal/src/portal/pages/CLAUDE.index.md`?
