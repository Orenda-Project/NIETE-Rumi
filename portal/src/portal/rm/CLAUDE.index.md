# rm — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/rm -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `components/` | RM page pieces: cards, rows, follow-up picker and frame → `components/CLAUDE.md` |
| `pages/` | RM page components: Sector, Coaches, one coach, Circle, Stats → `pages/CLAUDE.md` |
| `tests/` | Goldens and rules tests for the RM screens → `tests/CLAUDE.md` |
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `RmGate.tsx` | Gate for /portal/rm pages: one GET /coachip/me per mount, renders only when rm is set |
| `RmNav.tsx` | RM menu: Sector, Coaches, Circle, Stats, with phone bar and laptop rail |
| `api.ts` | Client for /api/portal/coachip/rm/* (R17-R21) and /coachip/me |
| `compose.ts` | Preview of the three follow-up note lines in both languages; the server composes the real ones |
| `paths.ts` | Every RM address under /portal/rm; path ids are coach users.id only |
| `rm.copy.ts` | Generated RM strings, English and Urdu, from contracts COPY.md; never hand-edited |
| `routes.tsx` | Route table of RM pages mounted at /portal/rm/* behind RmGate |
| `text.tsx` | How RM COPY strings reach screens: rt() and rtx() with the count contract |
| `types.ts` | Wire shapes of RM payloads (R17-R21); imports coach fragments and holds no teacher data |
| `useRmLoad.ts` | Re-export of the coach insights useLoad hook for RM pages |

## Who reads this (all, generated)
- `RmGate.tsx` ← imported by `portal/src/portal/rm/RmNav.tsx:10:394056ad` · `portal/src/portal/rm/pages/RmCircle.tsx:10:61676df7` · `portal/src/portal/rm/pages/RmCoach.tsx:9:61676df7` · `portal/src/portal/rm/pages/RmCoaches.tsx:6:61676df7` (+3: `python3 kg/kg.py who-reads RmGate.tsx`)
- `RmNav.tsx` ← imported by `portal/src/portal/rm/components/RmFrame.tsx:12:b89ab818`
- `api.ts` ← imported by `portal/src/portal/rm/RmGate.tsx:5:363724b9` · `portal/src/portal/rm/components/CircleRow.tsx:8:dbdfd669` · `portal/src/portal/rm/components/FollowUpPicker.tsx:9:dbdfd669` · `portal/src/portal/rm/pages/RmCircle.tsx:8:dbdfd669` (+4: `python3 kg/kg.py who-reads api.ts`)
- `compose.ts` ← imported by `portal/src/portal/rm/components/FollowUpPicker.tsx:10:2fea7af6` · `portal/src/portal/rm/pages/RmCircle.tsx:11:9a72f63a`
- `paths.ts` ← imported by `portal/src/portal/coach/insights/components/MoreCoachip.tsx:9:86f47e88` · `portal/src/portal/coach/profile/CoachMore.tsx:16:da52aa9a` · `portal/src/portal/coach/training/appReady.ts:2:d431971c` · `portal/src/portal/rm/RmNav.tsx:9:5db3d2b3` (+3: `python3 kg/kg.py who-reads paths.ts`)
- `rm.copy.ts` ← imported by `portal/src/portal/rm/components/ClusterCard.tsx:6:5046e3a9` · `portal/src/portal/rm/components/OpeningCard.tsx:8:5046e3a9` · `portal/src/portal/rm/compose.ts:9:c3c78f33` · `portal/src/portal/rm/pages/RmCircle.tsx:13:c8367a2c` (+1: `python3 kg/kg.py who-reads rm.copy.ts`)
- `routes.tsx` ← imported by `portal/src/App.tsx:65:e1f28c2a`
- `text.tsx` ← imported by `portal/src/portal/rm/RmGate.tsx:6:acd18cca` · `portal/src/portal/rm/RmNav.tsx:11:acd18cca` · `portal/src/portal/rm/components/CircleRow.tsx:10:72d40e22` · `portal/src/portal/rm/components/ClusterCard.tsx:7:59144736` (+12: `python3 kg/kg.py who-reads text.tsx`)
- `types.ts` ← imported by `portal/src/portal/rm/api.ts:9:e90fdcfa` · `portal/src/portal/rm/components/CircleRow.tsx:9:6bc27568` · `portal/src/portal/rm/components/ClusterCard.tsx:5:f1477c41` · `portal/src/portal/rm/components/CoachGroups.tsx:6:47732acd` (+7: `python3 kg/kg.py who-reads types.ts`)
- `useRmLoad.ts` ← imported by `portal/src/portal/rm/pages/RmCircle.tsx:9:055de272` · `portal/src/portal/rm/pages/RmCoach.tsx:8:055de272` · `portal/src/portal/rm/pages/RmCoaches.tsx:5:055de272` · `portal/src/portal/rm/pages/RmHome.tsx:10:055de272` (+1: `python3 kg/kg.py who-reads useRmLoad.ts`)

## Tests (all, generated)
- `api.ts` ← `portal/src/portal/rm/tests/rmMomentAsRm.test.ts`
- `compose.ts` ← `portal/src/portal/rm/tests/FollowUpPicker.test.tsx`
- `paths.ts` ← `portal/src/portal/coach/training/CoachAppGuard.dual.test.tsx` · `portal/src/portal/coach/training/CoachAppGuard.rm.test.tsx`
- `rm.copy.ts` ← `portal/src/portal/rm/tests/RmCircle.test.tsx` · `portal/src/portal/rm/tests/b10_words.test.tsx` · `portal/src/portal/rm/tests/copy.test.ts` · `portal/src/portal/rm/tests/layout_s2.test.tsx` · `portal/src/portal/rm/tests/r6_rm_deck.test.tsx` · `portal/src/portal/rm/tests/s3_qa_rm.test.tsx` (+1: `python3 kg/kg.py who-reads portal/src/portal/rm/rm.copy.ts`)
- `routes.tsx` ← `portal/src/portal/rm/tests/harness.tsx`

## Related (all, generated)
- docs: `portal/src/portal/CLAUDE.md`? · `portal/src/portal/coach/training/CLAUDE.index.md`? · `portal/src/portal/rm/CLAUDE.index.md`? · `portal/src/portal/rm/CLAUDE.md`? · `portal/src/portal/rm/components/CLAUDE.index.md`? · `portal/src/portal/rm/components/CLAUDE.md`? · `portal/src/portal/rm/pages/CLAUDE.md`? · `portal/src/portal/rm/tests/CLAUDE.index.md`? · `portal/src/portal/rm/tests/CLAUDE.md`?
