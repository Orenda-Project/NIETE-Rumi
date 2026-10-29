# coachip-ui — COACHIP design kit: chrome and primitives for the coach and RM pages
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coachip-ui kg=f9747458bbde gen=ed170d368f4a overflow=43 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `docs/coachip-ui.md` — rules: .cp scoping, G10 Count, who may import it
- `Shell.tsx` — frame every COACHIP screen stands in
- `tests/` — vitest: `cd portal && npx vitest run src/portal/coachip-ui`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `docs/` | → (no door; 1 files) |
| `tests/` | → (no door; 19 tests) |
| `Section.tsx` | Kit hairline section: small-caps label or h2 title, optional hint, then rows (bd-sex15q.42) |
| `Button.tsx` | Kit button: primary/secondary/quiet, lg/md, renders as button, router Link or anchor (bd-sex15q.42) |
| `Count.tsx` | Count display (RingCount/RowCount): big n plus small "of d" from nOfD; keeps data-num/den/win attrs (bd-sex15q.42) |
| `tokens.ts` | COACHIP colours/ring constants mirroring tokens.css, for inline SVG, Tailwind cp colours and tests (bd-sex15q.42) |
| … | 16 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `Section.tsx` ← imported by `portal/src/portal/coach/insights/components/NotYetTile.tsx:3:27694826` · `portal/src/portal/coach/insights/components/PhonicsTile.tsx:6:27694826` (+11)
- `Button.tsx` ← imported by `portal/src/portal/coach/insights/components/StepCard.tsx:11:fb2e1bbb` · `portal/src/portal/coach/insights/components/WCard.tsx:12:fb2e1bbb` (+7)
- `Count.tsx` ← imported by `portal/src/portal/coach/insights/components/StatsRow.tsx:4:f8c25612` · `portal/src/portal/coach/insights/components/WCard.tsx:11:8a9e71d7` (+6)
- … 15 more → `CLAUDE.index.md`

## Never (human)
- Scope every token under .cp: no element selector, :root or html rule (tokens.css:4-5, B7 goldens)
- Never put a Ring on a teacher or coach row (coachip-ui/Ring.tsx:8)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coachip-ui/tests/chrome.test.tsx` (AppBar.tsx, Band.tsx, LangToggle.tsx, NavBar.tsx, Rail.tsx, Shell.tsx)
- `portal/src/portal/coach/insights/tests/r6b_fix.test.tsx` (FractionBar.tsx, Ring.tsx, tokens.ts)
- … 16 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/CLAUDE.md`?
