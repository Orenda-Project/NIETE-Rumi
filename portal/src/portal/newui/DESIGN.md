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
| **Red** | Errors and destructive actions. **One exception: recording** (bd-5rz1v.26). A lesson being recorded is red: the "Recording" chip and its dot, the Record live lecture icon and the recording bar's tile. It is the same red, named `RECORDING`, so a screen says `recording` and never borrows `error` for it. | `STATUS.error`, `BUTTON.destructive`, `RECORDING` |
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
| `List`, `Row` | Lists of things | `to` makes a link with ›, `onClick` a button with ›, neither an information row (no ›). `icon` or `lead` ("3", "D1") in a 42px tile (`tile`: neutral, quiet, done, or `recording`, the recording red). `chips`, `value`, `progress`, `end` (an icon in place of ›). `state`: `off` (dimmed, not tappable) or `selected` (indigo tint). |
| `SectionLabel`, `ProgressBar` | A heading over a list; a green bar | |
| `Chip` | Information on a row or band | `tone`: `done`, `waiting`, `error`, `info` (default), `selected`, or `recording` (red, led by a dot that pulses under `motion-safe:`). `surface="band"` on indigo. Never tappable. |
| `FilterChips` | One choice among a few filters | A radio group. The picked chip is indigo and the others are outlined. |
| `ToggleChips` | Any number of choices among a few (question types) | Checkboxes that look like `FilterChips`. An on chip is indigo with a check. |
| `BottomButton` | The action | `tone`: `primary` (default), `outline`, `warn`, `danger`, or `dangerOutline` (the outline button with red words: a destructive second choice under a green one, such as Delete under Continue). Also `disabled`, `icon` (`iconFlips` for ›), and `to` for a link. |
| `BottomActions` | Holding the action(s) | Fixed above the menu bar on a phone, inline on a desktop; it reserves its own space. While a lesson records, it stands on top of the recording bar's strip, 144px + the safe area up (`PortalLayout` says when the bar shows, `lib/recordingBarShown.ts`). |
| `MetricTile`, `MetricGrid` | Home's counts | `feature` (its icon in the feature's hue on a grey tile), `value` (`null` shows "—"), `label`, `to`/`onClick`, `wide` + `chips`. The grid is two columns on a phone, four on a desktop. |
| `Sheet` | A choice that rises from the bottom | `open`, `title`, `onClose`. Android Back, Escape, the 56px close and a tap on the dim all close it. Focus stays inside. |
| `DateRangeButton`, `DateRangeSheet` | Picking a period | This week, This month (default), Last 3 months, This year, All time, Pick dates. A preset applies at once. Pick dates opens From, To and Done. `range.ts` has `rangeQuery()` for the API. |
| `NumberGrid` | Picking a number (Grade 1–12) | Four across, 58px tiles, the picked one indigo; `required` dashes a border; `disabled` numbers are shown flat grey, cannot be picked, and the arrow keys skip them. |
| `Stepper` | A count, never typed ("− 15 +") | Two 56px squares and a 34px/800 number. `min`/`max` are the caller's (the server's); a button at its bound is disabled. |
| `ToggleList` | Big options with a tick box | `mode="single"` (radio) or `"multi"` (checkbox). On = indigo. `compact` = 56px rows. `disabled` dims every option and ignores taps (My grades inside the server's 48h window). |
| `Panel`, `Fold` | A section of content (a report's feedback, a transcript) | `icon` + a short `title` (one heading, 1–3 words) over the content. `Panel` is the list card with a 42px neutral tile; `Fold` is the same card whose heading is a 60px button with ⌄ (`aria-expanded`), closed by default (`defaultOpen`). The words inside are data, shown as they are. |
| `Hero` | A status screen | `ring` ({value 0–1, text}) or `icon` + `tone` (`done`, `waiting`, `neutral`), `spinning`, `chips`, `live`. |
| `AudioPlayer` | Listening to a recording (bd-5rz1v.26.4) | Never the browser's `<audio controls>` (Firefox draws a dark bar). A white card row: a 56px round button (a green ring with ▶; **green filled** with ❚❚ while it plays), the track (`bg-nu-progress` on `bg-nu-progress-track`, a tap or a drag seeks), then elapsed / total in tabular numbers, left to right even in Urdu. No volume. `src`, `label` (names the seek bar: "Digital Coach"), `durationHint` (seconds, shown before the file says, or when it never does: a recorder's webm reports Infinity), `preload` (`none` by default: nothing is fetched before she taps, her data), `bare` (inside a `Panel`, which is already the card). RTL mirrors the track and the seek; Space plays and pauses, the arrows seek 5s in the reading direction, Home/End jump; a spinner (motion-safe) while it loads; a red "Can't play" chip when the file fails. One kit player sounds at a time, and it touches no other media, no microphone and no recording session (`audioPlayer.recording.test.tsx`). **Training:** the part page's video and audio (bd-5rz1v.25) can swap `<audio controls>` for `<AudioPlayer src={d.audio_url} label={…} />`. |
| `AnswerChoices`, `QuestionDots` | One question per screen (bd-5rz1v.25) | Big answers: a 32px letter tile then the answer, 58px+, 16px corners, 2px edge; the picked one indigo (edge, tint, letter). `mode="multi"` = checkboxes ("Pick all"); `images` for picture answers; `value` is 0-based positions. `QuestionDots`: a bar per question, indigo up to the current one, a progressbar, never a button. |
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
| **copy** (`copy.test.ts`) | A string in `copy.ts` has more than 4 words, or ends in `.` `?` `!` `۔` or `؟` (what each function returns is checked too). New-UI source has JSX text or a string-literal child. A literal `title`, `label`, `aria-label`, `alt`, `placeholder` or `crumb` breaks the same rule. The allowlist (`COPY_ALLOWLIST` in `rules.ts`) holds one entry, "Stop recording?" (the operator's title for Logout while recording), and every entry needs a reason. |
| **tap** (`tap.test.tsx`) | Any button, link, input, radio, checkbox or slider (AudioPlayer's track) that a kit component renders lacks a phone-size height of 56px or more (`min-h-[56px]`, `h-14`, `h-[58px]` and so on). An icon with no text also needs that width. jsdom has no layout, so this checks the class contract. `md:` classes do not count. An input with the `hidden` attribute (a file picker a row opens) is not on screen and is skipped. |
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
| Pull-up grab | `rgba(255,255,255,.4)` | `nu-pullup-grab` | the pull-up menu's grab marks (bd-5rz1v.18) |
| Pull-up tile | `rgba(255,255,255,.08)` | `nu-pullup-tile` | a tile's fill on the indigo panel, the line above the menu row |
| Pull-up icon | `#dfe1ea` | `nu-pullup-icon` | a tile's icon |
| Pull-up out | `#ffb4a8` | `nu-pullup-out` | Logout, light red on indigo |

### Recording

| Token | Hex | Tailwind | Use |
|---|---|---|---|
| Recording | `#c8331f` on `#fde6e2` | `text-nu-record` on `bg-nu-record-bg`, `bg-nu-record` (the dot) | the Recording chip, the Record live lecture tile, the recording bar's tile |

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

`shadow-nu-nav` is the menu bar's upward shadow. `shadow-nu-float` is something floating over the page (nothing today: the recording bar docks on a desktop since bd-5rz1v.26.4). `shadow-nu-pullup` is the pull-up menu rising from the bar (bd-5rz1v.18).

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
  pill (50px on the five-item teacher bar); 10.5px labels on the teacher bar. The teacher's bar carries
  the pull-up menu's grab handle (bd-5rz1v.18), so it is 16px 6px 8px: the mockup's 16px strip on top,
  and the bottom gives the 6px back. Its height is 80px plus the safe area either way, and with the flag
  on the layout pads the page by 96px.
- **Pull-up menu** (bd-5rz1v.18): a 38×4 grab mark 6px from the bar's top; the panel has 24px top
  corners, a 38×4 grab mark (10px above, 4px below), the who row 8px 18px 12px (a 40px avatar, an
  18px/800 name, 12px/600 school · role), then three columns 10px apart with 0 14px 14px around them;
  tiles at least 84px, 16px corners, a 24px icon and a 13px/700 label.

## The menu (built)

`NewUiNavigation.tsx`, rendered by `PortalNavigation` while the flag is on. This is the teacher menu the
operator decided on 2026-10-03, with the pull-up menu (bd-5rz1v.18, `PullUpMenu.tsx`) as the one place for
everything else.

- **Teacher, phone:** the indigo bottom bar has five items: **Home, Lessons, Assessment, Training,
  Coaching**. There is no More. **Assessment** opens `/portal/assessment` (bd-5rz1v.13); an old link to
  the Curriculum page's `?tab=assessment` still lights it.
- **Teacher, pull-up menu** (bd-5rz1v.18; deep-screens.html "Menu bar · pull up"): a grab handle on top
  of the bottom bar. The bar's own empty space is the handle's button (`Open menu`, behind the five
  items); a tap there, or a swipe up anywhere on the bar, opens an indigo panel rising from the bar over a
  dimmed page: a grab mark, the who row (her initials, her name, school · Teacher), then a 3-column grid
  of tiles: **My Classes, Certificates** (the new Training certificates page), **My grades** (the band
  picker, kept reachable), **Language, My account, Analytics** (the old page, until Home replaces it),
  and **Logout** in light red across the last row (the guarded logout: "Stop recording?" while a lesson
  records). The menu row stays at the bottom, above the dim. It is `role="dialog"` with
  `data-state="open"`, so Android Back closes it (Back sends Escape); so do a tap on the dim, a swipe
  down, the handle again, and going to a tile. Leaders do not get it.
- **Teacher, avatar:** her initials in a 40px circle inside a 56px target open the **same pull-up menu**
  (the separate account sheet is gone). On a phone the avatar sits in a slim indigo strip at the top of
  pages that have no heading band yet. A page that draws its own heading passes `ownHeading` to
  `PortalLayout`: the strip goes and the band carries the avatar (`AccountAvatar`, which opens the panel
  through `accountSheet.ts`). Home does this. On a desktop the avatar ends the top bar, and the panel is
  a card under it.
- **Language tile:** the portal's one language setting, `GET/PUT /api/portal/me/language` (the PUT goes
  through the bot's `setUserLanguage`, the one writer; read the `language-protocol` skill). The tile names
  the language it switches to (اردو / English). A tap writes first and only then turns the page (i18n
  sets `lang` and `dir`); a failed write leaves the page and shows "Not saved". When the panel reads a
  **locked** choice (she chose it) that the page is not showing, the page follows it, with no write; an
  unlocked value changes nothing. The new UI's words are English until bd-5rz1v.20, so today a switch
  turns the direction (RTL) and the words stay English.
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
  and only as a band word. Without the flag, these addresses go back to the dashboard.
- `/portal/dashboard/training`, `/assessments` and `/attendance` (bd-5rz1v.17.2), the same pages for the
  other three tiles. **Training**: a done tile, the module's title, the provider (`providerShort`) and the
  day; a tap opens the part (`/portal/training/unit/:id`). **Assessments**: the subject's icon, "Science ·
  Ch 2", Grade and the day, a download icon; a tap opens My assessments' paper sheet (Download, Answer key
  when it has one). It is not My assessments itself: that list is one entry per paper family with no
  dates. **Attendance**: a row per day, its classes as chips and "n registers"; a tap opens that day on
  Analytics' Attendance tab (`?from=&to=#attendance`). Empty is a `Hero` with the list's icon and "Nothing
  yet".

## Lesson Plans (built, bd-5rz1v.14)

`newui/lessons/`. With the flag on, a teacher's `/portal/curriculum` is `NewLessonPlans`;
`?tab=assessment` (the old Assessment tab, where `/portal/assessment` goes with the flag off) and a leader's visit keep the old page, and flag off renders
the old page byte for byte (`PortalCurriculum.flagOff.test.tsx`). One flow for every grade, 1 to 12:

- **Main:** `MainHeading` "Lesson Plans" with the band chip "Last: Day 2 · Plants" (`GET
  /lesson-plans/recent?limit=1`). Four `Row`s, Grade · Subject · Chapter · Lesson, each showing what she
  chose and `off` until the step before is chosen. A grey `BottomButton` Open until a lesson is picked.
- **Grade:** a `Sheet` with a `NumberGrid` 1–12; grades with no lesson plans are `disabled`. Picking
  one opens **Subject**: a `Sheet` of rows (subject icon, name, lesson count).
- **Chapter, Lessons, Ready:** inner pages (`InnerBar`, breadcrumb "Lesson Plans · …"). Lessons show
  D1… (a 6–12 lesson its number), pages, ✓✓ Sent, and Worksheet / Revision rows. Ready has Day / pages /
  grade / subject chips, the title, Open, and Answer key for grades 1–5.
- **Open:** a plan that exists opens in the portal's viewer (`LessonPlanViewer chrome="none"` under an
  `InnerBar`; "Open in another app" is the bar's small action, gone while recording). One not written
  yet is started, and **Preparing** shows a `Hero` (a ring counting down 2:00, "~2 min", "Opens by
  itself", outline "Other lessons"); it polls with the old back-off and opens the viewer by itself.
  A failed write shows a red "Failed" chip and Try again.
- **Data:** `lessonPlansApi.ts` is the one client: it merges `/curriculum/*` (1–5) and `/lp612/*` (6–12)
  into one model, so the screens never branch on grade. Where she is lives in the address
  (`?view=chapters|lessons|lesson|preparing&grade=…`); her four picks are kept for the session, so Back
  to the main page finds them still made.

## Assessment (built, bd-5rz1v.13)

`newui/assessment/`, routes in `lib/assessmentRoutes.ts`, picked by `pages/PortalAssessment.tsx`. With the
flag off (or for a leader) every `/portal/assessment*` address goes to the Curriculum page's Assessment
tab, which is unchanged. The endpoints are the old panels' (`/assessment/options`, `/chapters`,
`/generate`, `/status/:id`, `/paper/:id/download`, `/papers`); the screens hold no assessment rule.

- `/portal/assessment`: `MainHeading` with "n made" and "Last: 3 Oct"; `Row`s Class, Subject and Chapter,
  each opening a `Sheet` (`NumberGrid`, `ToggleList`, chapter rows); the Questions `Stepper` inside the
  server's maximum, starting on its default; a More row (`ToggleChips` for question types, `FilterChips`
  for where questions come from, Answer lines); a My assessments row; the Make assessment button.
  `features.assessmentGenerator` off: a Coming soon `Hero` and nothing else.
- `/portal/assessment/request/:id`: an `InnerBar` page. Writing is a `Hero` ring with the time so far;
  it asks for the status every 4s and stops after 5 minutes ("Still writing"). Ready is a tick, "15 Q",
  "30 marks", then Download, Answer key and Make another. Not made shows the server's code as a short
  red chip (`ASSESSMENT_COPY.failures`), then Try again and Change choices.
- `/portal/assessment/mine`: `FilterChips` for the class, then its subjects; a row per paper (its subject's
  icon in neutral grey, "Science · Ch 2", "15 Q", "3 Oct", a download icon); a tap offers Download and
  Answer key in a sheet; a More row pages.
- Files open the way certificates do (`openFile`): a new tab on the web; in the Android app no `_blank`,
  so the WebView hands the file to Android and the portal stays on its page.

## Coaching (built, bd-5rz1v.26)

`newui/coaching/`, picked by `pages/PortalCoaching.tsx` through `lib/coachingUi.ts`: the new screens need
`portal_new_ui` **and** `portal_self_observation` (every endpoint of the flow is behind the second), and a
teacher. Otherwise every coaching page renders what it did (`PortalCoaching.flagOff.test.tsx`, recorded on the
old code). The mockup has no Coaching section; these screens follow Home's and Assessment's patterns.

- `/portal/coaching` (`CoachingMain`): `MainHeading` "Coaching" with the mic tile, "8 lessons" and "1 analysing"
  on the band. Above the list, what waits for her: **Answer your question** ("2 waiting", to the oldest) and
  **Continue** for a recording left on the phone ("Not sent", "31 min", "2 Oct"), whose sheet holds Continue and a
  red-outline Delete. Her subjects as `FilterChips` (two or more). The lessons newest first under a month label:
  the day in the tile, the topic (data), the subject, then the band as a word (Good and above green, below amber),
  or where a lesson is (Analysing, Your answer, On WhatsApp: amber). Ten, then a More row. No search box: typing
  is the hardest thing on the screen. One green **Send a lesson**.
- **Send a lesson** (`SendSheet`): Record live lecture (the mic on the recording red, only where the phone can
  record: `canRecordHere`), Upload recording (the picker opens from this tap; a file that is not a recording
  shows "Not a recording" here), Cancel. The record page is told the choice in the route state
  (`{ start: record | file | resume }`), as before.
- Desktop: what waits for her and the button on the left, her lessons on the right.
- `/portal/coaching/new` (`RecordPage`, behaviour in `useSendFlow`, today's page's): inner pages under
  Coaching. **Record live lecture**: the Recording chip (red dot) or Paused (amber), a 64px clock, the sound
  bars (`LevelBars`, recording red), "Keep app open", a Lesson plans row with "Recording continues"; Finish
  (green, a sheet asks first: "38 min", "Short lesson" under 10 minutes, Yes, finish / Keep recording) and Pause
  or Continue (outline). The microphone refused: "Microphone blocked", where to allow it as a path ("Lock ›
  Microphone › Allow"), Try again, Upload recording. **Check and send**: her recording (minutes, Just now /
  the day / the size, Listen, Record again or Change file); Optional: Lesson plan (a sheet: Recent lesson plans
  from `GET /lesson-plans/recent`, From the library, Take a photo, Choose a file) and Board photos (n/3, each
  removable); Send to Digital Coach. The library is one step a page (`LibraryStep`: Grade on a `NumberGrid`,
  then Subject, Chapter, Lesson rows; the crumb says what she chose, Back steps up). **Sending**: a ring and the
  percentage, no menu. Then Sent (Open lesson replaces the page), No internet (Saved on phone, Try again),
  Lesson plan not used (Change lesson plan), Not accepted, Another lesson analysing (Open that lesson).
- `/portal/coaching/session/:id` (`LessonView`): an inner page under Coaching, the topic its title. On its
  way: the three steps as rows (done green, the current one turning with "~10 min", the rest dimmed); her
  question, a box and Send; or "Answer on WhatsApp". The report: subject, day, minutes and band chips, then one
  short heading per section — Digital Coach (her debrief), Try next time, Went well, Rubric (each part's band),
  Your recording — and the long ones `Fold`: Your reflection, All tips, What was said (six lines, Show all);
  Report picture opens as a file. A coach's observation, once sent: Coach visit, who, when, Sent, then the
  picture, caption and text as WhatsApp delivered them. A Next question row leads to the oldest other lesson
  waiting for her answer.
- **The recording bar** on the new menu (`RecordingBar.tsx`, `NEW_BAR_STYLE`): a white kit card — the
  recording-red mic tile (amber pause tile when paused), Recording, the clock (amber if the screen went off), ›.
  On a phone an opaque strip from the top of the menu (8px, then the 56px bar) ends 144px up, where a page's
  `BottomActions` stands: they never overlap (bd-5rz1v.24). On a desktop (bd-5rz1v.26.4) it docks the same way
  on the bottom edge: an opaque strip the full width (a 1px line, 12px, the 360px bar at the end, 12px: 81px,
  `DESK_BAR_STRIP_PX`), and the page pads 96px, so the page ends above it. (Floating in the corner, it sat over
  the end of Coaching's lesson rows at 1280 until she scrolled to the bottom.) The old menu's bar is unchanged.
- **Listening** (bd-5rz1v.26.4): the report's Digital Coach and Your recording play through `AudioPlayer`
  (`bare`, inside their `Panel`); Your recording shows its length before anything loads (`durationHint`, the
  lesson's minutes). Check and send's Listen is a row that plays and pauses, as before.
- **Logout while recording** (bd-5rz1v.10's question, in the kit since bd-5rz1v.26.4,
  `coaching/LogoutWhileRecording.tsx`): a `Sheet` "Stop recording?" with the Recording chip (Paused, amber,
  when paused) and the running time; **Keep recording** (green) changes nothing, **Stop & log out**
  (`dangerOutline`) finishes the lesson, keeps it on the phone (Coaching offers it under Continue after she signs
  in) and logs out. Close, Escape, Back and the dim are Keep recording. The session asks it
  (`askBeforeLogout`), in the kit while `portal_new_ui` is on for her and the old sheet otherwise. **Any Logout
  anywhere** — the account sheet, the menu's pull-up panel (bd-5rz1v.18) — calls `useGuardedLogout()`
  (`newui/useGuardedLogout.ts`) or `useLogoutGuard(logout)`; close your own sheet first.

## Training (built, bd-5rz1v.25)

`newui/training/`, routes in `lib/trainingRoutes.ts` (`TRAINING_ROUTES`), picked by
`pages/PortalTrainingPage.tsx`. With the flag off, for a leader, or while the flag loads, every
training address renders `PortalTrainingV2` byte for byte (`PortalTrainingV2.flagOff.test.tsx`), and
an address only the new UI has (`/grades`, `/level/:id/exam`, `/unit/:id/quiz`) goes to the old page it
stands for. The endpoints are the old page's; the screens hold no training rule. Teachers see "Part"; the code's word is "module".

- `/portal/training`: `MainHeading` with "NIETE 24%" (the provider she is continuing) and her
  certificate count on the band; a `Row` per provider (initials in a neutral tile, a green bar, the %,
  a check when done; NIETE, I-SAPS, Beacon House, Oxbridge); a Certificates row; **Continue
  <provider>**. Continue (`continue.ts`): the only timestamps are each part's `completed_at`, so among
  the started levels (not locked and not finished; a certified level with parts left counts) it reads the courses she is part-way through (two API calls in the usual case),
  takes the course with her latest completion, and opens its next part (not done, not locked); a
  finished course opens the level's next unfinished course, a finished level its page (the exam). A
  failed read opens the level page. Nothing assigned: "No training yet" and a My grades row.
- `/provider/:key`: an `InnerBar` (crumb Training) and a row per level. A ladder (NIETE): Certified
  chip, or number + "2/5" + bar, or lock + "Pass 2" with the row off; Continue Level n. Subjects
  (Beacon House) are unnumbered and never locked. A one-level provider (I-SAPS, Oxbridge) replaces
  itself with its level page, and the main page links straight there.
- `/provider/:key/level/:id`: the level exam as a row on top, from the grand-quiz gate ("3 more
  courses" as information; Ready, Wait 18h or Passed open `/exam`); "Courses 2/5" and a row each
  (Done, or "3/7" with a bar). I-SAPS: no exam row; the level certificate as a row (exams passed and a
  bar; Receive asks the server; then Download) and My scores in a sheet. Beacon House: the written
  quiz result as a row; a tap shows her answers and the feedback.
- `/provider/:key/level/:id/course/:id`: "Parts 3/7"; done = green check tile, duration and best score
  chips; next = play icon and "Next"; locked = off. I-SAPS: the module exam row (the gate's own word as
  a chip) and Recommended reading (a sheet). Continue opens the next part.
- `/unit/:id` (a part): "Part 4/7", its length and Done as chips; the video and audio players; Handout
  (PDF, a new tab as before) and Quick check ("5 Q", her best score) rows — no "Practice" chip: since
  bd-2450 only a pass completes the part and opens the next; the part's text; Up next once done. Start quick check, or with no quiz Mark done
  (the old page's POST `/complete`), then Continue.
- `/unit/:id/quiz` (new address; flag off goes to the part): ONE question per screen, `QuestionDots`, the
  question, `AnswerChoices`, "1/5" at the bar's end. Next once answered; Back returns to the previous
  question with its answer kept; Submit on the last posts ModuleQuizPanel's exact answer set. The result:
  a green `Hero` ring with the score, Passed or Not passed, the %, an Up next row (the parts are read
  again: a pass may open the next one), Continue and Try again (outline).
- `/provider/:key/level/:id/exam` (new address; flag off goes to the level): LevelExamCard and
  CapstoneExamForm as a page. Ready: a neutral trophy `Hero` with the gate's rules as chips ("20 Q",
  "80% to pass", amber "24h wait if failed"; a number the gate does not send is not shown, bd-2489) and
  Start exam. Courses left: Locked, "3 more courses". Cooldown: an amber Wait. Passed: the certificate as
  a card (level, code, date; a tap downloads). The exam is one question per screen; the written exam
  (Beacon House capstone) one answer per screen with the server's character floor as a chip. Pass and
  fail are `Hero` states; a fail shows the wait as an amber chip.
- `/exam/:courseId` (I-SAPS module exam): one question per screen with the written answer as a text box;
  the attempt resumes and the draft is restored; each answer saves on its own 800ms after the last change
  (`PUT /exam/draft`), shown as a chip (Saving…, Saved, Not saved). Her latest sitting is the `Hero`
  (Being graded, Not passed with "MCQ 1/2" and "Need 2", Passed), her answers are in a sheet, and earlier
  sittings are rows. Try again only after a failed sitting. A closed gate shows Locked and the gate's own
  short word; its sentence is not shown.
- `/certificates`: `FilterChips` (All 4, NIETE 1, Beacon 2…), a row per certificate (neutral award,
  "NIETE · Aspiring", the date, a download icon). Web: a tap opens a sheet with the code, View (in place,
  `?view=1`) and Download (a new tab). The app: a tap downloads in place, with no View and no `_blank`
  (`certificateFile.ts` keeps CertificatesPanel's rules).
- `/grades` (My grades, from the account sheet; from Training only when nothing is assigned): a multi
  `ToggleList` (Primary 1–5, Middle 6–8, High 9–10, split from the server's titles), an amber lock chip
  ("Locked 48h after save", or "Locked · 31h" inside the window), and Save. A 429 becomes that chip. The
  server's notice sentences are not shown.

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
