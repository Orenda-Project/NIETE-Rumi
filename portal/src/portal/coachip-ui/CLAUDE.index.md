# coachip-ui — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/coachip-ui -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `docs/` | → (no door; 1 files) |
| `tests/` | → (no door; 19 tests) |
| `AppBar.tsx` | Slim inner-screen app bar for the coach/RM kit: back circle, eyebrow, title, window line (bd-sex15q.42) |
| `Band.tsx` | Phone home band (navy gradient, lattice, lockup, title) that becomes the laptop page head; also Eyebrow (bd-sex15q.42) |
| `Button.tsx` | Kit button: primary/secondary/quiet, lg/md, renders as button, router Link or anchor (bd-sex15q.42) |
| `Count.tsx` | Count display (RingCount/RowCount): big n plus small "of d" from nOfD; keeps data-num/den/win attrs (bd-sex15q.42) |
| `Dots.tsx` | Three 14px dots showing the recordings after a step: done, partial or none; decorative (bd-sex15q.42) |
| `FractionBar.tsx` | 4px fraction bar under a row's number, fills from the inline start (right in Urdu); decorative (bd-sex15q.42) |
| `LangToggle.tsx` | EN | اردو pill pair writing via useLanguageSwitch (PUT /me/language); changes page after server accepts (bd-sex15q.42) |
| `NavBar.tsx` | Phone bottom nav bar shared by coach and RM; hidden on laptop where Rail takes over (bd-sex15q.42) |
| `Pill.tsx` | Kit pill/chip with green, tint, grey, navy-tint and on-navy tones (bd-sex15q.42) |
| `Rail.tsx` | Laptop left rail (240px): wordmark, menu, language toggle and trust line (bd-sex15q.42) |
| `Ring.tsx` | Progress ring n of d from 12 o'clock; zero draws track only; colours via CSS vars (bd-sex15q.42) |
| `Row.tsx` | Hairline list row: title, meta, lead node, chevron (flips in Urdu), 44px min height (bd-sex15q.42) |
| `Section.tsx` | Kit hairline section: small-caps label or h2 title, optional hint, then rows (bd-sex15q.42) |
| `Shell.tsx` | Frame of every COACHIP screen: .cp token root, Band/AppBar header, gutter, trust line, laptop Rail and aside |
| `Skeleton.tsx` | First-paint skeleton with final layout and no words (CLS under 0.1); optional navy band (bd-sex15q.42) |
| `StepStrip.tsx` | Five-segment lesson strip: done green, current outlined, todo grey, LTR even in Urdu (bd-sex15q.42) |
| `Surface.tsx` | The one elevated white card per screen (radius 20, one shadow); overlap rides it 24px over the band (bd-sex15q.42) |
| `tokens.css` | COACHIP design tokens as CSS variables, all scoped under .cp, plus Urdu refinements and cp-overlap rule (bd-sex15q.42) |
| `tokens.ts` | COACHIP colours/ring constants mirroring tokens.css, for inline SVG, Tailwind cp colours and tests (bd-sex15q.42) |
| `useLaptop.ts` | Hook: true when viewport matches the laptop (>=1024) media query; safe when matchMedia is missing |

## Who reads this (all, generated)
- `AppBar.tsx` ← imported by `portal/src/portal/coach/insights/components/Frame.tsx:11:803ad7c8` · `portal/src/portal/rm/components/RmFrame.tsx:9:802c0272`
- `Band.tsx` ← imported by `portal/src/portal/coach/insights/components/Frame.tsx:10:ecbf2341` · `portal/src/portal/coach/insights/components/StepCard.tsx:10:12a0f425` · `portal/src/portal/coach/insights/components/WCard.tsx:10:12a0f425` · `portal/src/portal/rm/components/RmFrame.tsx:8:7821e8b0`
- `Button.tsx` ← imported by `portal/src/portal/coach/insights/components/StepCard.tsx:11:fb2e1bbb` · `portal/src/portal/coach/insights/components/WCard.tsx:12:fb2e1bbb` · `portal/src/portal/coach/insights/pages/Move.tsx:12:fb2e1bbb` · `portal/src/portal/coach/insights/player/MomentPlayer.tsx:3:fb2e1bbb` (+5: `python3 kg/kg.py who-reads Button.tsx`)
- `Count.tsx` ← imported by `portal/src/portal/coach/insights/components/StatsRow.tsx:4:f8c25612` · `portal/src/portal/coach/insights/components/WCard.tsx:11:8a9e71d7` · `portal/src/portal/coach/insights/components/WRow.tsx:8:f8c25612` · `portal/src/portal/coach/insights/pages/Move.tsx:15:8a9e71d7` (+4: `python3 kg/kg.py who-reads Count.tsx`)
- `FractionBar.tsx` ← imported by `portal/src/portal/coach/insights/components/StatsRow.tsx:5:ac017b43` · `portal/src/portal/coach/insights/components/WRow.tsx:9:ac017b43` · `portal/src/portal/coach/insights/pages/Weakness.tsx:18:ac017b43` · `portal/src/portal/rm/components/SectorWRow.tsx:12:f05a325e`
- `LangToggle.tsx` ← imported by `portal/src/portal/coach/insights/InsightsNav.tsx:7:afe5c846` · `portal/src/portal/coach/insights/components/MoreCoachip.tsx:3:33b6535a` · `portal/src/portal/rm/RmNav.tsx:8:09a15d15` · `portal/src/portal/rm/components/RmFrame.tsx:10:afe5c846`
- `NavBar.tsx` ← imported by `portal/src/portal/coach/insights/InsightsNav.tsx:5:4940b3a5` · `portal/src/portal/rm/RmNav.tsx:6:e96b4cd8` · `portal/src/portal/coachip-ui/Rail.tsx:4:1938e524`
- `Pill.tsx` ← imported by `portal/src/portal/coach/insights/components/ResultCell.tsx:5:2fb02be5` · `portal/src/portal/coach/insights/components/SchoolRow.tsx:5:2fb02be5` · `portal/src/portal/coach/insights/components/StatsRow.tsx:6:2fb02be5` · `portal/src/portal/rm/components/OpeningCard.tsx:6:18be7edd` (+1: `python3 kg/kg.py who-reads Pill.tsx`)
- `Rail.tsx` ← imported by `portal/src/portal/coach/insights/InsightsNav.tsx:6:811cbf9e` · `portal/src/portal/rm/RmNav.tsx:7:bb773e66`
- `Ring.tsx` ← imported by `portal/src/portal/coach/insights/pages/ThisWeek.tsx:22:afd28763` · `portal/src/portal/rm/components/SectorWRow.tsx:11:02073483` · `portal/src/portal/coachip-ui/Count.tsx:6:bc769471`
- `Row.tsx` ← imported by `portal/src/portal/coach/insights/components/MoreCoachip.tsx:13:9cdb18fb`
- `Section.tsx` ← imported by `portal/src/portal/coach/insights/components/NotYetTile.tsx:3:27694826` · `portal/src/portal/coach/insights/components/PhonicsTile.tsx:6:27694826` · `portal/src/portal/coach/insights/pages/Listen.tsx:13:27694826` · `portal/src/portal/coach/insights/pages/Move.tsx:10:6df37a70` (+9: `python3 kg/kg.py who-reads Section.tsx`)
- `Shell.tsx` ← imported by `portal/src/portal/coach/insights/components/Frame.tsx:9:1ae989c3` · `portal/src/portal/rm/components/RmFrame.tsx:7:5e542130`
- `Skeleton.tsx` ← imported by `portal/src/portal/coach/insights/components/StateBlock.tsx:4:7fd8b244`
- `Surface.tsx` ← imported by `portal/src/portal/coach/insights/components/StepCard.tsx:12:d25e29b8` · `portal/src/portal/coach/insights/components/WCard.tsx:13:d25e29b8` · `portal/src/portal/coach/insights/pages/Move.tsx:11:d25e29b8` · `portal/src/portal/rm/components/RmFrame.tsx:11:944cef8e` (+1: `python3 kg/kg.py who-reads Surface.tsx`)
- `tokens.css` ← imported by `portal/src/portal/coach/insights/InsightsNav.tsx:9:c48874d4` · `portal/src/portal/coach/insights/components/MoreCoachip.tsx:16:93f1c618` · `portal/src/portal/coachip-ui/Shell.tsx:2:4874e503`
- `tokens.ts` ← imported by `portal/tailwind.config.ts:5:0bda3344` · `portal/src/portal/coachip-ui/Count.tsx:7:3158355e` · `portal/src/portal/coachip-ui/Ring.tsx:2:4c9d4e69` · `portal/src/portal/coachip-ui/useLaptop.ts:2:e9f44ca1`
- `useLaptop.ts` ← imported by `portal/src/portal/coach/insights/InsightsNav.tsx:8:b736beb7` · `portal/src/portal/coach/insights/pages/ThisWeek.tsx:24:a09404b4` · `portal/src/portal/coach/insights/pages/Weakness.tsx:20:a09404b4`

## Tests (all, generated)
- `AppBar.tsx` ← `portal/src/portal/coachip-ui/tests/chrome.test.tsx`
- `Band.tsx` ← `portal/src/portal/coachip-ui/tests/chrome.test.tsx`
- `Button.tsx` ← `portal/src/portal/coachip-ui/tests/Button.test.tsx`
- `Count.tsx` ← `portal/src/portal/coachip-ui/tests/Count.test.tsx` · `portal/src/portal/coachip-ui/tests/ringDigits.test.tsx`
- `Dots.tsx` ← `portal/src/portal/coachip-ui/tests/Dots.test.tsx`
- `FractionBar.tsx` ← `portal/src/portal/coach/insights/tests/r6b_fix.test.tsx` · `portal/src/portal/coachip-ui/tests/FractionBar.test.tsx`
- `LangToggle.tsx` ← `portal/src/portal/coachip-ui/tests/chrome.test.tsx`
- `NavBar.tsx` ← `portal/src/portal/coachip-ui/tests/chrome.test.tsx`
- `Pill.tsx` ← `portal/src/portal/coachip-ui/tests/Pill.test.tsx`
- `Rail.tsx` ← `portal/src/portal/coachip-ui/tests/chrome.test.tsx`
- `Ring.tsx` ← `portal/src/portal/coach/insights/tests/r6b_fix.test.tsx` · `portal/src/portal/coachip-ui/tests/Ring.test.tsx`
- `Row.tsx` ← `portal/src/portal/coachip-ui/tests/Row.test.tsx`
- `Section.tsx` ← `portal/src/portal/coachip-ui/tests/Section.test.tsx`
- `Shell.tsx` ← `portal/src/portal/coachip-ui/tests/chrome.test.tsx`
- `Skeleton.tsx` ← `portal/src/portal/coachip-ui/tests/Skeleton.test.tsx`
- `StepStrip.tsx` ← `portal/src/portal/coachip-ui/tests/StepStrip.test.tsx`
- `Surface.tsx` ← `portal/src/portal/coachip-ui/tests/Surface.test.tsx`
- `tokens.ts` ← `portal/src/portal/coach/insights/tests/r6b_fix.test.tsx` · `portal/src/portal/coachip-ui/tests/Ring.test.tsx` · `portal/src/portal/coachip-ui/tests/ringDigits.test.tsx`

## Related (all, generated)
- docs: `portal/src/portal/CLAUDE.md`?
