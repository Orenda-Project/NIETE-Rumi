# coachip-ui: the COACHIP design system in code (R6, bd-sex15q.42)

The design system from `design/r6/DESIGN_SYSTEM.md` as one module. ux-coach and ux-rm build their pages from these
pieces; nothing here knows about a payload except `Count` (the G10 number pattern).

## Rules

- **Scope.** Every token is a CSS variable under `.cp` (`tokens.css`). `Shell`, `NavBar` and `Rail` carry the class, so a
  COACHIP page has it and nothing else in the portal does. Outside a `.cp` ancestor, `cp-*` classes resolve to nothing.
- **Colours** are Tailwind classes through the variables: `text-cp-ink`, `text-cp-ink-2`, `text-cp-ink-3`, `text-cp-navy`,
  `text-cp-green-ink`, `bg-cp-ground`, `bg-cp-surface`, `bg-cp-green`, `bg-cp-green-tint`, `bg-cp-navy-tint` (the one tint; `grey-fill` is
  withdrawn, FIX_R6 A8), `border-cp-hairline`, `bg-cp-track`. No new hex in `insights/` or `rm/` (design-qa look.1).
  Opacity modifiers (`bg-cp-green/50`) do not work on variable colours; use the token that exists.
- **Type**: Plus Jakarta Sans on `.cp` (already preloaded, no new request), then "Plus Jakarta Sans Fallback" (R6 A11: local Arial/Roboto scaled to its metrics in `tokens.css`, so the first-visit swap moves nothing); Urdu stays Nastaliq through index.css. Sizes as
  arbitrary values from DESIGN_SYSTEM §2 (`text-[17px] font-semibold` for a lead, `text-[13px] text-cp-ink-3` for meta).
  Small caps labels carry `cp-label` (Urdu: no caps, no tracking, 13 px, in tokens.css).
- **One raised surface per screen** (`Surface`); everything else is flat on the ground, divided by hairlines.
- **One primary per screen** (`Button` default): 52 px, green, navy label.
- **Rings only on lessons or schools**, never on a teacher or a coach row.
- **Laptop** is `lg:` (≥ 1024). The Rail takes 240 px; the page is a 720 px column plus an optional 320 px `aside`, or the
  full width with `wide`.
- **Motion**: `cp-enter` (page), `cp-sheet` (a bottom sheet), `cp-press` (buttons), the ring's arc draw. All off under
  `prefers-reduced-motion`.

## Frames (use these, not the components directly, on a page)

| Frame | Where | Props that matter |
|---|---|---|
| `InsightsPage` (`coach/insights/components/Frame.tsx`) | every coach page | `title`, `chips` (the band's line or the app bar's window line), `backTo` (→ app bar), `crumb` (the app bar's eyebrow), `hero` (replace the header), `aside` (laptop right column), `wide`, `windows`, `testId`, `trust` |
| `Band` (Frame.tsx) | a coach home's header, passed as `hero` when it needs a body | `title`, `sub`, `date`, `children` = the band body (ring + sentence + pill); test id `insights-band` |
| `RmPage` (`rm/components/RmFrame.tsx`) | every RM page | as before, plus `band` (force band/app bar; default: the Sector tab is the band), `hero` (the band body), `wide` (default on the band page), `aside`. Header id `rm-band`, line id `rm-page-sub`; the phone's EN \| اردو is in the header |
| `RmCard` | RM blocks | `title`, `sub`, `elevated` (→ `Surface`). Flat under a hairline by default |
| `RmNote` | = `NoteCard` | `tone="info"` (stale, navy tint) or `"neutral"` |
| `Card` (Frame.tsx) | coach blocks | flat under a hairline; `elevated` → the raised card |
| `StateBlock` | loading / error | loading is now the `Skeleton` (same `-loading` id, `aria-busy`) |
| `WRow`, `WRowFrame` (`components/WRow.tsx`) | G9 rows | `WRow` as before; `WRowFrame` is the shared row (`kind`, `agenda`, `lead`, `to`) `SectorWRow` is built on |

## Components (`coachip-ui/`)

| Component | Props | One line |
|---|---|---|
| `Shell` | `testId`, `header`, `nav`, `aside`, `wide`, `trust`, `trustInRail`, `padBottom`, `fullHeight`, `bleed`, `dir` | The frames use it; a page never does. `<Shell testId="x" header={<AppBar …/>}>…</Shell>` |
| `Band`, `Eyebrow` | `title`, `date`, `sub`, `trailing`, `foot` (12 px white-72 % last line, phone only: the trust line, A6; test id `<testId>-foot`), `children`, `testId` | `<Band title="This week" date={…}><Eyebrow>Notice · Move 1 of 2</Eyebrow><RingCount size="hero" …/><Pill tone="green">…</Pill></Band>` — the body becomes the hero card on a laptop |
| `AppBar` | `backTo`, `backLabel`, `eyebrow`, `title`, `sub`, `trailing`, `testId`; a line passed as `null` is still coming and draws a placeholder bar in its own line box, `undefined` means no such line (A1) | `<AppBar backTo={paths.thisWeek} eyebrow="Move 1 of 2 · this month" title="Practice never set" sub={<MetaLine …/>} />` |
| `Surface` | `overlap`, `testId`, `as`, `data-*` | `<Surface overlap testId="s1-first">…</Surface>` — the card right under the band rides up 24 px |
| `Section` | `label`, `title`, `hint`, `tone` (`green` for "needs me"), `first`, `action`, `testId` | `<Section label="Open steps" hint="What you set, and the next three recordings">…rows</Section>` |
| `Row` | `title`, `meta`, `lead`, `trail`, `to` or `onClick`, `testId`, `data-*`, children | `<Row title="Phonics check" meta="Starts after 30 hours" to={paths.stats} />` — 44 px, hairline between rows, chevron flips in Urdu |
| `RingCount` | `count`, `lang`, `size` (`hero` 104 / `card` 64 / `row` 56), children (the sentence), `testId` | `<RingCount count={card.count} lang={lang} size="hero"><p>{sentence}</p></RingCount>` — ONE count node, text = `nOfD`, ring at the inline end in Urdu |
| `RowCount` | `count`, `lang` | `<RowCount count={c} lang={lang} />` — 22/800 n + 13/600 "of d", one count node |
| `Ring` | `n`, `d`, `size`, `tone` (`notice` default: navy arc, white-72 % on the band; `strength`: green; rendered as `data-tone`, A5), children, `data-*` | the bare ring; a zero draws the track only. Prefer `RingCount` |
| `FractionBar` | `n`, `d`, `tone` (`notice` navy default / `grey` / `green` a strength, A5); the code lives in `Count.tsx` (one chunk with the rings) | `<FractionBar n={11} d={22} className="w-[120px]" />` — fills from the right in Urdu |
| `Pill` | `tone` (`green` on the band, `tint`, `grey`, `navy-tint`, `on-navy`), `as`, `data-*` | `<Pill tone="green" as="p" data-window={w.id}>…</Pill>` when the pill IS the window element |
| `Button` | `variant` (`primary`/`secondary`/`quiet`), `size` (`lg` 52 / `md` 44), `block`, `to`/`href`/`onClick`, `icon`, `testId` | `<Button to={paths.w(id)} testId="wcard-see"><span>See the move</span></Button>` — keep the label one inline run |
| `StepStrip` | `steps` (`{label, state: done/current/todo}`), `dir` | `<StepStrip steps={…} />` — five segments, LTR in Urdu |
| `Dots` | `states` (`done`/`partial`/`none`) | `<Dots states={["done","none","none"]} />` |
| `Skeleton` | `band`, `overlap` (the first card rides up over a page's own band and holds `--cp-first-card-h`, A1), `testId` | `<Skeleton band />` for the login landing; `StateBlock` already uses the plain one |
| `NavBar`, `Rail` | `items` (`{key,to,label,icon,current,dataNav}`), `ariaLabel`, `testId`; Rail: `logoAlt`, `extra`, `lang`, `trust` | the two menus use them; a page never does |
| `LangToggle` | `prefix` (test ids), `tone` (`light`/`dark`) | EN \| اردو through the one writer |
| `useLaptop()` | — | true at ≥ 1024; only for things that must not mount on a phone |
| `tokens.ts` | `CP_COLOURS`, `RING`, `LAPTOP_QUERY` | the same values as tokens.css, for SVG and tests |

## Tests that touch these

- `coachip-ui/tests/*.test.tsx` (one per component, plus `r6_*` page-level red tests and `coachipUi.flagOff`).
- vitest runs with `css: false`: classes are asserted, never computed styles. The fold, the G10 window position and the
  look are design-qa's rig on real screenshots.
