# Portal new UI — design rules

The rules, the tokens and the kit for every screen built behind the `portal_new_ui` flag. Beads:
bd-5rz1v.12 (flag, tokens, menu) and bd-5rz1v.19 (kit, checks). Reference mockup:
`versions/v6_deep-screens/deep-screens.html` in the NIETE Portal Coaching report folder. Its
"bar spacing" and "final components" CSS blocks are the source of every size below.

The direction is **B, option 2 ("indigo menu bar")**: light screens, big rows, one action button at
the bottom, and indigo framing the screen at the top and bottom.

**Build a screen from the kit** (`index.ts`). **Run the checks** before you push:
`cd portal && npx vitest run src/portal/newui`. CI runs the same command (job `portal-newui`).

## Who it is for

Most teachers are not comfortable with technology. Every rule below follows from that.

## The rules

1. **Icons plus 1–3 words.** A label names something an icon already shows ("Home", "Lesson plans
   used"). Four words is the most the check allows.
2. **No sentences anywhere.** No instructions, explanations, helper text or questions. If a screen needs
   a sentence to be understood, the screen is wrong.
3. **Every tap target is at least 56px** (`TAP_MIN_PX`). When the mockup draws something smaller, such
   as the 40px back circle or the 36px date pill, the visible shape sits inside a 56px target.
4. **Information never looks tappable, and anything tappable does.** Tappable things are a row with ›,
   a tile, a button, or an outlined filter chip. A number, a status or a label is flat: no border, no
   shadow, no chevron, no button colour.
5. **Colour has meaning** (the table below). A feature's colour is only ever its own icon.
6. **Two headings.** A feature's main page gets the flat indigo band. A page inside a flow gets the light
   bar with a back button and a breadcrumb.
7. **One bottom action button.** A green pill above the menu bar. A second choice is an outline button.
   Disabled is grey with no edge.
8. **Urdu mirrors.** Use start/end spacing only, and turn directional icons round in RTL.
9. **Motion only when allowed.** Anything that moves is wrapped in `motion-safe:`.

## The colour rule

From the operator, 2026-10-03, after "still too much colour".

| Colour | Where it goes | Token |
|---|---|---|
| **Indigo** `#333748` | The frame: a main page's flat heading band and the menu bar. Anything **selected**: a picked number, a quiz answer, a toggle that is on, a picked filter chip, the current row. | `FRAME`, `SELECTION` |
| **Green** `#2e7d57` (edge `#1e5c3f`) | **Every** primary button, every progress bar, and "done" (check tiles; Done, Sent and Ready chips). | `BUTTON.primary`, `PROGRESS`, `DONE`, `STATUS.done` |
| **Amber** | Waiting or warning ("~2 min", "Writing", "24h wait"). | `STATUS.warning`, `BUTTON.warning` |
| **Red** | Errors and destructive actions. | `STATUS.error`, `BUTTON.destructive` |
| **Feature colour** | **Only** the feature's own icon: the heading tile on its band (light tint), its tiles on Home and the start of a breadcrumb (its hue). Drawn by `FeatureIcon` and nothing else. | `FEATURE_ICON` |
| **Neutral grey** | **Everything else:** row icons, subject icons, badges, trophies, scores and values. | `NEUTRAL`, `STATUS.info` |

Values in rows are dark text. Buttons look the same in every feature. "Tests" and "Assessment
Generator" are now called **Assessment**.

## Behind the flag

Everything new renders only while `portal_new_ui` is on for the signed-in user:

- the row: `app_settings.key = 'portal_new_ui'`. `true` means everyone, `["<users.id>", …]` means a
  pilot, and absent means off (`dashboard/lib/feature-flags.js`, `isFlagEnabledForUser`);
- the API: `GET /api/portal/config` → `features.newUi`;
- the browser: `useNewUi(userKey, ready)` (`src/portal/lib/useNewUi.ts`) returns `null` while loading,
  then `true` or `false`. It remembers the last answer per user, so pages do not flash the old menu.

With the flag off, loading, or unreadable, a screen renders exactly what it rendered before. Pin that
with a snapshot recorded on the old code, as `PortalNavigation.flagOff.test.tsx` does.

## Words: `copy.ts`

Every word the new UI shows lives in `copy.ts`: `KIT_COPY` (the kit's defaults), `NAV_COPY` (the menu)
and one object per screen. The kit takes every word through props, with English defaults from there.

- This is what makes rule 2 checkable: the copy check lints every string in `copy.ts`, and refuses words
  written straight into new-UI source.
- It is also what the Urdu work (bd-5rz1v.20) translates. Read the `language-protocol` skill before
  adding a language.
- **Data is not copy.** A lesson's title, her name and a school name come from the API as they are.

## The kit

Import from `src/portal/newui` (the barrel `index.ts`). All components are typed, take their words as
props, use only `nu-*` tokens and logical spacing, and keep every target at 56px or more.

| Component | Use it for | Notes |
|---|---|---|
| `MainHeading` | A feature's main page | `feature`, `title`, `right` (the avatar on Home), `context` (chips, the date range). Flat indigo band, 44px tile, 24px/800 title. Home shows the NIETE mark. |
| `InnerBar` | A page inside a flow | `feature`, `crumb` ("Training · NIETE · Level 2"), `title`, `backTo`. Back goes to the previous page. With nothing behind it, Back goes to `backTo`. |
| `List`, `Row` | Lists of things | `to` makes a link with ›, `onClick` a button with ›, neither an information row (no ›). `icon` or `lead` ("3", "D1") in a 42px tile (`tile`: neutral, quiet, done). `chips`, `value`, `progress`, `end` (an icon in place of ›). `state`: `off` (dimmed, not tappable) or `selected` (indigo tint). |
| `SectionLabel`, `ProgressBar` | A heading over a list; a green bar | |
| `Chip` | Information on a row or band | `tone`: `done`, `waiting`, `error`, `info` (default) or `selected`. `surface="band"` on indigo. Never tappable. |
| `FilterChips` | One choice among a few filters | A radio group. The picked chip is indigo and the others are outlined. |
| `BottomButton` | The action | `tone`: `primary` (default), `outline`, `warn` or `danger`. Also `disabled`, `icon` (`iconFlips` for ›), and `to` for a link. |
| `BottomActions` | Holding the action(s) | Fixed above the menu bar on a phone, inline on a desktop; it reserves its own space. |
| `MetricTile`, `MetricGrid` | Home's counts | `feature` (its icon in the feature's hue on a grey tile), `value` (`null` shows "—"), `label`, `to`/`onClick`, `wide` + `chips`. The grid is two columns on a phone, four on a desktop. |
| `Sheet` | A choice that rises from the bottom | `open`, `title`, `onClose`. Android Back, Escape, the 56px close and a tap on the dim all close it. Focus stays inside. |
| `DateRangeButton`, `DateRangeSheet` | Picking a period | This week, This month (default), Last 3 months, This year, All time, Pick dates. A preset applies at once. Pick dates opens From, To and Done. `range.ts` has `rangeQuery()` for the API. |
| `NumberGrid` | Picking a number (Grade 1–12) | Four across, 58px tiles, the picked one indigo; `required` dashes a border. |
| `ToggleList` | Big options with a tick box | `mode="single"` (radio) or `"multi"` (checkbox). On = indigo. `compact` = 56px rows. |
| `Hero` | A status screen | `ring` ({value 0–1, text}) or `icon` + `tone` (`done`, `waiting`, `neutral`), `spinning`, `chips`, `live`. |
| `FeatureIcon`, `HeadingTile` | A feature's icon | The only place a feature colour is drawn. |

Shared class strings: `FOCUS` (the amber focus ring), `TAP`, `TAP_SQUARE`, `PRESS` and `GRID` in `styles.ts`.

**Two classes that lie here.** The old theme redefines them, so the style check refuses them in
new-UI code:
- `grid`: `src/index.css` forces every `.grid` to `direction: ltr` under `[dir="rtl"]`, so a grid's
  first item stays on the left in Urdu. Use `GRID` (`[display:grid]`), which mirrors.
- `rounded-lg`, `rounded-md` and `rounded-sm` are `var(--radius)` (1rem) in `tailwind.config.ts`, so a
  28px "rounded-lg" box comes out a circle. Write the pixels (`rounded-[8px]`), or use `rounded-xl`,
  `rounded-2xl` or `rounded-full`.

`Chip` sets `dir="auto"`, so "2 Visits" still reads that way inside an Urdu page.

### Do and don't

| Do | Don't |
|---|---|
| Put the word in `copy.ts` and pass it in | Write text in JSX, or a sentence in a prop |
| An icon plus "Lesson plans used" | "Open the lesson plans you used this month" |
| A row with › when it goes somewhere | A chevron or border on information |
| `<BottomButton>` for the action, green, every feature | Colour a button with its feature's colour |
| `FeatureIcon` for a feature's colour | `text-nu-f-…` in any other file |
| `ms-`, `pe-`, `start-`, `text-start`, `rtl:rotate-180` | `ml-`, `pr-`, `left-`, `text-left` |
| `motion-safe:animate-spin` | A bare `animate-spin` or `transition` |
| Show "—" when a number did not load | A blank, a spinner forever, or a 0 that is not true |
| A 56px target around a smaller shape | A 40px button |

## The checks

`src/portal/newui/checks/`. They read every `.ts`/`.tsx` under `newui/` except tests and `tokens.ts`,
so a screen built there is checked from its first commit. Each check proves itself on planted
violations.

| Check | Fails when |
|---|---|
| **copy** (`copy.test.ts`) | A string in `copy.ts` has more than 4 words, or ends in `.` `?` `!` `۔` or `؟` (what each function returns is checked too). New-UI source has JSX text or a string-literal child. A literal `title`, `label`, `aria-label`, `alt`, `placeholder` or `crumb` breaks the same rule. The allowlist (`COPY_ALLOWLIST` in `rules.ts`) is empty, and every entry needs a reason. |
| **tap** (`tap.test.tsx`) | Any button, link, input, radio or checkbox that a kit component renders lacks a phone-size height of 56px or more (`min-h-[56px]`, `h-14`, `h-[58px]` and so on). An icon with no text also needs that width. jsdom has no layout, so this checks the class contract. `md:` classes do not count. |
| **style** (`style.test.tsx`) | A primary `BottomButton` is not `bg-nu-button` on `shadow-nu-button`, or any tone wears a feature colour, the leaf or the frame indigo. A `nu-f-*` class appears outside `FeatureIcon.tsx`. Source has a raw hex, rgb or hsl colour (use tokens; `theme(…)` is fine). A left/right class appears (`ml-`, `pr-`, `left-`, `rounded-l`, `border-r`, `text-left`, `space-x`). `animate-*`, `transition` or `transition-transform` appears without `motion-safe:`. A bare `grid` or `rounded-lg`/`md`/`sm` appears (see "Two classes that lie here"). |

Only code is read. A comment may mention a hex or a margin.

## Tokens

All colours live in `tokens.ts`. `tailwind.config.ts` builds the `nu-*` classes and `shadow-nu-*` from
it, so do not write a raw hex in a component (the style check fails).

### Base

| Token | Hex | Tailwind | Use |
|---|---|---|---|
| Logo indigo | `#333748` | `nu-ink` | the frame, selection |
| Indigo 2 | `#454a60` | `nu-ink-2` | a lighter indigo |
| Indigo light | `#e8e9f0` | `nu-ink-light` | the selection tint, the progress track |
| Indigo extra-light | `#f3f3f7` | `nu-ink-xlight` | a pressed row |
| Indigo edge | `#1d2030` | `nu-ink-edge` | the shadow under an indigo button |
| Frame translucent | `rgba(255,255,255,.14)` | `nu-frame-translucent` | the active menu pill, chips on the band |
| Band chip text | `#e9eaf2` | `nu-frame-chip` | a context chip's words on the band |
| Band control | `rgba(255,255,255,.12)`, border `rgba(255,255,255,.3)` | `nu-frame-control`, `nu-frame-control-border` | the date range on the band |
| Logo green | `#48b078` | `nu-leaf` | the active menu icon |
| Logo green light | `#e2f3e9` | `nu-leaf-light` | the background of a "done" chip or icon |
| Focus | `#fdb022` | `nu-focus` | keyboard focus ring |
| Menu label | `#b9bccb` | `nu-nav-label` | menu items you are not on |
| Page | `#f4f5f8` | `nu-surface` | screen background, sheets |
| Card | `#ffffff` | `nu-surface-card` | lists, tiles |
| Text | `#141826` | `nu-surface-text` | body text and every value |
| Muted | `#666b80` | `nu-surface-muted` | secondary text |
| Line | `#e3e5ec` | `nu-surface-line` | row dividers, card borders |
| Chevron | `#a0a4b4` | `nu-surface-chevron` | the › at a row's end |
| Handle | `#c9ccd6` | `nu-surface-handle` | a sheet's grab handle |
| Box | `#c7cad6` | `nu-surface-box` | an unticked toggle's box |
| Scrim | `rgba(20,24,38,.5)` | `nu-surface-scrim` | the dimmed page behind a sheet |

### Selection and neutral

| Token | Hex | Tailwind |
|---|---|---|
| Selected (border, fill, number tile) | `#333748` | `nu-select` |
| Selected tint (row or answer behind) | `#e8e9f0` | `nu-select-tint` |
| Selected filter chip | white on `#333748` | `text-nu-chip-selected`, `bg-nu-chip-selected-bg` |
| Neutral icon tile | `#333748` on `#f3f3f7` | `text-nu-neutral-icon`, `bg-nu-neutral-tile` |
| Quiet tile | `#666b80` on `#f1f2f5` | `text-nu-neutral-quiet-icon`, `bg-nu-neutral-quiet` |

### Buttons

| Button | Fill | Edge / border | Text | Tailwind |
|---|---|---|---|---|
| Primary | `#2e7d57` | edge `#1e5c3f` | white | `bg-nu-button`, `shadow-nu-button` (pressed `shadow-nu-button-pressed`) |
| Secondary (outline) | `#ffffff` | border `#e3e5ec` | `#141826` | `bg-nu-button-secondary`, `border-nu-button-secondary-border` |
| Warning | `#b54708` | edge `#7a2e04` | white | `bg-nu-button-warning`, `shadow-nu-warning` |
| Destructive | `#c8331f` | edge `#8a1f12` | white | `bg-nu-button-destructive`, `shadow-nu-destructive` |
| Disabled | `#d7d9e0` | none | `#8c90a0` | `bg-nu-button-disabled`, `text-nu-button-disabled-text` |

`shadow-nu-nav` is the menu bar's upward shadow.

### Progress, done and status chips

| Meaning | Colour | Background | Tailwind |
|---|---|---|---|
| Progress bar | `#48b078` | track `#e8e9f0` | `bg-nu-progress` on `bg-nu-progress-track` |
| Done icon (a check) | `#2e7d57` | `#e2f3e9` | `text-nu-done`, `bg-nu-done-bg` |
| Done, Sent or Ready chip | `#1e5c3f` | `#e2f3e9` | `text-nu-chip-done`, `bg-nu-chip-done-bg` |
| Waiting or warning chip | `#b54708` | `#fef0c7` | `text-nu-chip-warning`, `bg-nu-chip-warning-bg` |
| Error chip | `#c8331f` | `#fde6e2` | `text-nu-chip-error`, `bg-nu-chip-error-bg` |
| Information chip | `#333748` | `#e8e9f0` | `text-nu-chip-info`, `bg-nu-chip-info-bg` |

### Feature colour: the feature's own icon only

| Feature | On the indigo band (tile icon) | On light (breadcrumb, Home tile) | Tailwind |
|---|---|---|---|
| Lesson Plans | `#7fd6a6` | `#2e7d57` | `text-nu-f-lesson-plans`, `text-nu-f-lesson-plans-crumb` |
| Training | `#8bb8f7` | `#1d6fd8` | `text-nu-f-training`, `-crumb` |
| Assessment | `#b8a8f8` | `#6e52e0` | `text-nu-f-assessment`, `-crumb` |
| Attendance (My Classes) | n/a | `#d9530b` | `text-nu-f-my-classes-crumb` |
| Coaching | n/a | `#333748` | `text-nu-f-coaching-crumb` |
| Home | the NIETE mark | `#333748` | `text-nu-f-home-crumb` |
| The tile behind it (band) | `rgba(255,255,255,.12)` | n/a | `bg-nu-f-tile` |

Results and Certificates have no icon colours yet. Their hues (teal `#0b8a7c`, amber `#b54708`) are
kept in `FEATURE_HUE` for when their screens move over.

### Light bar (pages inside a flow)

| Token | Hex | Tailwind |
|---|---|---|
| Bar | `#ffffff` | `bg-nu-inner` |
| 1px bottom line | `#e3e5ec` | `border-nu-inner-border` |
| Back button (circle) | `#f3f3f7`, icon `#333748` | `bg-nu-inner-back`, `text-nu-inner-back-icon` |
| Breadcrumb text | `#666b80` | `text-nu-inner-crumb` |

## Spacing

From the mockup's "bar spacing" and "final components" blocks. The kit already applies these; they are
listed so a reviewer can check a screenshot against them.

- **Heading band** (`MainHeading`): flat, square corners, 14px above the content. Title row 10px 16px
  14px, 12px gaps, at least 64px with the 44px tile. Title 24px/800. Context row 10px under the title and
  16px above the band's edge. Desktop: 20px 40px 22px, centred at 1120px, a 52px tile, a 28px title,
  the context row under the title.
- **Light bar** (`InnerBar`): 6px 14px 12px, 12px gaps, 12px above the content; a 40px back circle; a
  12px breadcrumb with a 14px icon; a 20px/800 title. Desktop: 12px 40px and a 24px title.
- **Content** under a band: 0 14px 14px, 12px between blocks.
- **Lists**: 16px corners, 1.5px borders. Rows are at least 60px, 10px 12px, 12px gaps, with a 42px tile.
- **Chips**: 11.5px/800, 1px 8px; on the band 12px, 3px 10px.
- **Metric tiles**: two columns 10px apart, at least 104px, 14px padding, 18px corners, a 40px icon tile,
  a 28px number, a 13px label. A wide tile spans the row and is at least 72px.
- **Bottom action button**: 58px pill (outline 56px), 17.5px/800, 23px icon; above the menu bar with 2px
  14px 14px padding and 10px between stacked buttons.
- **Sheet**: the page colour, 22px top corners, 10px 12px 16px, 10px gaps, a 40×4 handle, a 20px/800 title.
- **Toggles**: 64px rows (56px compact), 16px corners, 2px borders, a 28px box. **Numbers**: four across,
  8px apart, 58px tiles, 22px/800.
- **Bottom menu bar** (built): 10px 6px 14px plus the safe area, square corners; a 23px icon in a 56×32
  pill (50px on the five-item teacher bar); 10.5px labels on the teacher bar. Its height is 80px plus
  the safe area, and with the flag on the layout pads the page by 96px.

## The menu (built)

`NewUiNavigation.tsx`, rendered by `PortalNavigation` while the flag is on. This is the teacher menu the
operator decided on 2026-10-03.

- **Teacher, phone:** the indigo bottom bar has five items: **Home, Lessons, Assessment, Training,
  Coaching**. There is no More. **Assessment** opens `/portal/curriculum?tab=assessment` until it becomes
  a page of its own.
- **Teacher, avatar:** her initials in a 40px circle inside a 56px target open the **account sheet**:
  My Classes, Analytics, Certificates and My account, then a red outline Logout. On a phone the avatar
  sits in a slim indigo strip at the top of pages that have no heading band yet. A page that draws its
  own heading passes `ownHeading` to `PortalLayout`: the strip goes and the band carries the avatar
  (`AccountAvatar`, which opens the same sheet through `accountSheet.ts`). Home does this. On a desktop
  the avatar ends the top bar.
- **Teacher, desktop:** an indigo top bar with the NIETE mark, then **Home, Lesson Plans, Assessment,
  Training, Coaching**, then the avatar.
- **Leader roles:** the same colours, with their own items: the bar plus More, whose sheet holds the rest,
  My account and Logout.
- The item you are on is white with its icon logo green in a translucent pill.

## Home (built, bd-5rz1v.17)

`newui/home/`. With the flag on, a teacher's `/portal/dashboard` is `NewHome`; a leader still goes to
My Patch, and flag off renders the old dashboard byte for byte (`PortalDashboard.flagOff.test.tsx`).

- `MainHeading` with the NIETE mark, "Salaam, <first name>", her avatar (phone only; the desktop bar has
  one) and the `DateRangeButton`, This month by default.
- Five `MetricTile`s from `GET /api/portal/progress`: Lesson plans used, Training modules done,
  Assessments made, Attendance marked, and the wide Coaching & observations with "n Digital Coach" and
  "n Visits". No rating. While loading, or if the API fails, every tile shows "—".
- The range lives in the address (`?range=…&from=&to=`, `range.ts`). The lists open on the same range
  and Back keeps it.
- `/portal/dashboard/lesson-plans` and `/portal/dashboard/coaching` (`HomeList`): an `InnerBar` with
  the breadcrumb Home, the range on a light button, and the items from
  `GET /api/portal/progress/:metric`. A plan opens in the portal's viewer (a 6–12 plan is asked for in
  its language first). A session opens its page. The coaching list is the only place a rating shows,
  and only as a band word. The other three tiles go to their existing pages for now. Without the flag,
  these addresses go back to the dashboard.

## Urdu and RTL

- Use logical spacing only: `ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start` and `inset-x-`.
  The style check fails on `ml-`, `pr-`, `left-` and `text-left`.
- Anything with a direction (›, the back chevron, the logout arrow) turns with `rtl:rotate-180` or
  `rtl:-scale-x-100`.
- Nastaliq needs a taller line height. The kit sets `rtl:leading-[1.8]`–`[2]` on its labels. Allow for it
  in anything you add, and check it in a screenshot.

## Adding the next screen

1. Put it under `src/portal/newui/` and behind `useNewUi()`, with the old screen as the fallback.
2. Record a snapshot of the old screen before changing anything. Then assert that flag-off renders it
   byte for byte.
3. Build it from the kit. Add its words to `copy.ts`. If a colour is missing, add it to `tokens.ts` and to
   the tables above.
4. Run `npx vitest run src/portal/newui`. The checks cover the new screen automatically.
5. Take screenshots at 390px in English and Urdu, and at 1280px on desktop, with the flag on and off.
   Compare them side by side with the mockup.
