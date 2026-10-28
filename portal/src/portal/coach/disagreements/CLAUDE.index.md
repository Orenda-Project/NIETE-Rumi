# disagreements — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/coach/disagreements -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `CoachingBox.test.tsx` | Pins the Coaching suggestion box: four answers, template then AI version, message/call/visit, flag (bd-tbprit.11) |
| `CoachingBox.tsx` | Coaching suggestion box for a disagreement: listen, four answers, suggested way, wa.me message (bd-tbprit.11) |
| `DisagreementCard.test.tsx` | Pins one teacher's disagreement card: evidence, voice note, where to look, report, Mark as done (bd-tbprit.3) |
| `DisagreementCard.tsx` | Page of one teacher's disagreement: head, banner, reasons, where to look, pattern, coaching box, done bar |
| `DisagreementsPage.test.tsx` | Pins the coach's disagreement list: To do and Done tabs, tags, blue dot, flag-off redirect (bd-tbprit.7) |
| `DisagreementsPage.tsx` | Coach list of teachers who sent a Not accurate disagreement, with To do and Done tabs (bd-tbprit.7) |
| `api.test.ts` | Pins the disagreements API client: clip URL, routes, fail-closed flag, copy, savePlan and suggestion posts |
| `api.ts` | Client for /api/portal/coach/disagreements (dashboard/routes/coach-disagreements.routes.js) and its shapes |
| `appBar.test.tsx` | Pins the navy app bar: back arrow and the EN | اردو pill saving through the one language writer |
| `appBar.tsx` | Navy app bar over disagreement screens with back and a language pill using useLanguageSwitch |
| `cardParts.test.tsx` | Pins grader item and reason block pieces: missing data as dash, one clip open at a time (bd-tbprit.3) |
| `cardParts.tsx` | Card pieces: clip provider, Listen button, grader item row, reason block and full report link |
| `cardTop.test.tsx` | Pins the card head, pink banner and reason pills from the design prototype (bd-tbprit.8) |
| `cardTop.tsx` | Top of a disagreement card: dark head, pink banner with send time in Pakistan time, reason pills |
| `coachingCopy.ts` | Words of the Coaching suggestion box, English and Urdu, partly machine-drafted (bd-tbprit.11) |
| `copy.ts` | English and Urdu words of the disagreement list and card screens (bd-tbprit.3) |
| `doneBar.test.tsx` | Pins the Mark as done footer, Done badge, Move back to To do, and failed-save behaviour (bd-tbprit.12) |
| `doneBar.tsx` | Fixed footer to mark a disagreement done or move it back to To do (bd-tbprit.12) |
| `frame.test.tsx` | Pins that the Reports entry row to disagreements shows only with coach_disagreement_card on |
| `frame.tsx` | Disagreement screens' flag gate (coach_disagreement_card, fail-closed), frame and Reports entry row |
| `nextVisit.test.tsx` | Pins For your next visit list of To-do requests the coach added (bd-tbprit.16) |
| `nextVisit.tsx` | For your next visit section at the top of the disagreements list (bd-tbprit.16) |
| `patternCopy.ts` | Words of the Is this a pattern section, English and Urdu (bd-tbprit.10) |
| `patternSection.test.tsx` | Pins the pattern section: score line chart, recordings per week, missed step, earlier taps (bd-tbprit.10) |
| `patternSection.tsx` | Is this a pattern section: last-lessons chart plus four facts about the teacher (bd-tbprit.10) |
| `planMoves.test.tsx` | Pins PlanMoves: all-done, missing why falls back to quote, unrecorded moves (bd-tbprit.9) |
| `planMoves.tsx` | Lesson Plan Fidelity view of plan moves with counts, Yes/Partial/No bar and most-missed step (bd-tbprit.9) |
| `sections.test.ts` | Pins sums behind Where to look: move marks, steps, totals, indicator counts, lowest section (bd-tbprit.9) |
| `sections.ts` | Pure maths for Where to look: move marks, step totals, most-missed step, step time window (bd-tbprit.9) |
| `suggestion.test.ts` | Pins how the coaching suggestion is chosen from the coach's answer and warning signs (bd-tbprit.11) |
| `suggestion.ts` | Picks the suggested way (message, call, visit), builds the template and the wa.me link (bd-tbprit.11) |
| `whereToLook.test.tsx` | Pins Where to look: problem-part Listen, fidelity moves only, other sections with AI scores (bd-tbprit.9) |
| `whereToLook.tsx` | Where to look section: recording length, one Listen for the problem part, four collapsible sections |

## Who reads this (all, generated)
- `CoachingBox.tsx` ← imported by `portal/src/portal/coach/disagreements/DisagreementCard.tsx:15:d78b85e6`
- `DisagreementCard.tsx` ← imported by `portal/src/App.tsx:117:7555f975`
- `DisagreementsPage.tsx` ← imported by `portal/src/App.tsx:116:5c5f0ba8`
- `api.ts` ← imported by `portal/src/portal/coach/disagreements/CoachingBox.tsx:5:45720fde` · `portal/src/portal/coach/disagreements/DisagreementCard.tsx:7:8a044fee` · `portal/src/portal/coach/disagreements/DisagreementsPage.tsx:8:2010d03d` · `portal/src/portal/coach/disagreements/cardParts.tsx:8:66b0b255` (+9: `python3 kg/kg.py who-reads api.ts`)
- `appBar.tsx` ← imported by `portal/src/portal/coach/disagreements/frame.tsx:11:e834b2b3`
- `cardParts.tsx` ← imported by `portal/src/portal/coach/disagreements/CoachingBox.tsx:8:b6332db5` · `portal/src/portal/coach/disagreements/DisagreementCard.tsx:10:f0540196` · `portal/src/portal/coach/disagreements/planMoves.tsx:7:f0128159` · `portal/src/portal/coach/disagreements/whereToLook.tsx:8:2885d373`
- `cardTop.tsx` ← imported by `portal/src/portal/coach/disagreements/DisagreementCard.tsx:12:14207986`
- `coachingCopy.ts` ← imported by `portal/src/portal/coach/disagreements/CoachingBox.tsx:6:443880d8` · `portal/src/portal/coach/disagreements/suggestion.ts:2:fa474394`
- `copy.ts` ← imported by `portal/src/portal/coach/disagreements/CoachingBox.tsx:7:8edf7546` · `portal/src/portal/coach/disagreements/DisagreementCard.tsx:8:8edf7546` · `portal/src/portal/coach/disagreements/DisagreementsPage.tsx:9:8edf7546` · `portal/src/portal/coach/disagreements/appBar.tsx:7:8edf7546` (+7: `python3 kg/kg.py who-reads copy.ts`)
- `doneBar.tsx` ← imported by `portal/src/portal/coach/disagreements/DisagreementCard.tsx:13:c9e7e124`
- `frame.tsx` ← imported by `portal/src/portal/coach/pages/CoachReports.tsx:17:5858c261` · `portal/src/portal/coach/disagreements/DisagreementCard.tsx:9:3805e962` · `portal/src/portal/coach/disagreements/DisagreementsPage.tsx:10:3805e962`
- `nextVisit.tsx` ← imported by `portal/src/portal/coach/disagreements/DisagreementsPage.tsx:11:7ee5a69c`
- `patternCopy.ts` ← imported by `portal/src/portal/coach/disagreements/patternSection.tsx:4:c2393caf`
- `patternSection.tsx` ← imported by `portal/src/portal/coach/disagreements/DisagreementCard.tsx:14:2841462c`
- `planMoves.tsx` ← imported by `portal/src/portal/coach/disagreements/whereToLook.tsx:9:260717c4`
- `sections.ts` ← imported by `portal/src/portal/coach/disagreements/CoachingBox.tsx:9:8dfd1b49` · `portal/src/portal/coach/disagreements/cardParts.tsx:10:38d89998` · `portal/src/portal/coach/disagreements/planMoves.tsx:8:0be83e46` · `portal/src/portal/coach/disagreements/whereToLook.tsx:10:3e1f2771`
- `suggestion.ts` ← imported by `portal/src/portal/coach/disagreements/CoachingBox.tsx:10:4257b3c0`
- `whereToLook.tsx` ← imported by `portal/src/portal/coach/disagreements/DisagreementCard.tsx:11:11a2376a`

## Tests (all, generated)
- `CoachingBox.tsx` ← `portal/src/portal/coach/disagreements/CoachingBox.test.tsx`
- `DisagreementCard.tsx` ← `portal/src/portal/coach/disagreements/DisagreementCard.test.tsx`
- `DisagreementsPage.tsx` ← `portal/src/portal/coach/disagreements/DisagreementsPage.test.tsx`
- `api.ts` ← `portal/src/portal/coach/disagreements/CoachingBox.test.tsx` · `portal/src/portal/coach/disagreements/DisagreementCard.test.tsx` · `portal/src/portal/coach/disagreements/DisagreementsPage.test.tsx` · `portal/src/portal/coach/disagreements/api.test.ts` · `portal/src/portal/coach/disagreements/cardTop.test.tsx` · `portal/src/portal/coach/disagreements/doneBar.test.tsx` (+6: `python3 kg/kg.py who-reads portal/src/portal/coach/disagreements/api.ts`)
- `appBar.tsx` ← `portal/src/portal/coach/disagreements/appBar.test.tsx`
- `cardParts.tsx` ← `portal/src/portal/coach/disagreements/CoachingBox.test.tsx` · `portal/src/portal/coach/disagreements/cardParts.test.tsx` · `portal/src/portal/coach/disagreements/whereToLook.test.tsx`
- `cardTop.tsx` ← `portal/src/portal/coach/disagreements/cardTop.test.tsx`
- `coachingCopy.ts` ← `portal/src/portal/coach/disagreements/api.test.ts` · `portal/src/portal/coach/disagreements/suggestion.test.ts`
- `copy.ts` ← `portal/src/portal/coach/disagreements/api.test.ts`
- `doneBar.tsx` ← `portal/src/portal/coach/disagreements/doneBar.test.tsx`
- `frame.tsx` ← `portal/src/portal/coach/disagreements/frame.test.tsx`
- `nextVisit.tsx` ← `portal/src/portal/coach/disagreements/nextVisit.test.tsx`
- `patternSection.tsx` ← `portal/src/portal/coach/disagreements/patternSection.test.tsx`
- `planMoves.tsx` ← `portal/src/portal/coach/disagreements/planMoves.test.tsx`
- `sections.ts` ← `portal/src/portal/coach/disagreements/sections.test.ts`
- `suggestion.ts` ← `portal/src/portal/coach/disagreements/suggestion.test.ts`
- `whereToLook.tsx` ← `portal/src/portal/coach/disagreements/whereToLook.test.tsx`

## Related (all, generated)
- docs: `portal/src/lib/CLAUDE.index.md`? · `portal/src/portal/coach/CLAUDE.index.md`? · `portal/src/portal/coach/CLAUDE.md`? · `portal/src/portal/coach/disagreements/CLAUDE.index.md`? · `portal/src/portal/coach/disagreements/CLAUDE.md`? · `portal/src/portal/lib/CLAUDE.index.md`? · `portal/src/portal/services/CLAUDE.index.md`? · `portal/src/portal/services/CLAUDE.md`? · `portal/src/portal/teacher/CLAUDE.index.md`? · `portal/src/portal/teacher/CLAUDE.md`? · `portal/src/portal/teacher/analytics/CLAUDE.index.md`? · `portal/src/portal/teacher/analytics/CLAUDE.md`?
