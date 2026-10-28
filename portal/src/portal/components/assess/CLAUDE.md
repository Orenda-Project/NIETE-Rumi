# assess — Learning-assessment (child test) page parts: engine frame, preflight, offline prep
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/components/assess kg=6af227957329 gen=460fe38d4191 overflow=19 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `AssessEngineSlot.tsx` — full-screen iframe running the SA engine's play page for one child
- `offlineReady.ts` — round-8 offline switches and prep records
- Tests: `cd portal && npx vitest run src/portal/components/assess` (vitest.config.ts, jsdom)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.md` | (unmapped) |
| `CLAUDE.index.md` | (unmapped) |
| `offlineReady.ts` | Round 8 offline-first helpers: sa_r8 switches, prep records, list/form URLs and caching for weak-signal testing |
| `AssessActions.tsx` | Learning-assessment fixed action bar and useAboveTabBar hook giving bottom offsets per tab-bar variant |
| … | 10 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `AssessActions.tsx` ← imported by `portal/src/portal/pages/LeaderAssess.tsx:10:12a1ff1f` · `portal/src/portal/components/assess/AssessOtherPhone.tsx:7:5b0826a6` (+1)
- `offlineCopy.ts` ← imported by `portal/src/portal/pages/LeaderAssess.tsx:12:0ac30815` · `portal/src/portal/components/assess/AssessOfflineCard.tsx:6:3ffb4701`
- `offlineReady.ts` ← imported by `portal/src/portal/pages/LeaderAssess.tsx:15:98df4fd3` · `portal/src/portal/components/assess/AssessOfflineCard.tsx:9:28426d80`
- … 6 more → `CLAUDE.index.md`

## Never (human)
- Round-8 switches stay fail-closed: off until read, off on a failed read (offlineReady.ts:30)
- The other-phone link carries a session id and token, never a child's name (AssessOtherPhone.tsx:12)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/components/assess/AssessEngineSlot.r7b.test.tsx` (AssessEngineSlot.tsx)
- `portal/src/portal/components/assess/AssessEngineSlot.test.tsx` (AssessEngineSlot.tsx)
- … 3 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/components/CLAUDE.index.md`? · `portal/src/portal/components/CLAUDE.md`? · `portal/src/portal/components/assess/CLAUDE.index.md`? · `portal/src/portal/components/assess/CLAUDE.md`? · `portal/src/portal/lib/CLAUDE.index.md`? · `portal/src/portal/lib/assess/CLAUDE.index.md`? (+2)
