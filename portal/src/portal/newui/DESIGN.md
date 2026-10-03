# Portal new UI — design rules (DRAFT)

> **Draft.** Expanded screen by screen as each screen moves to the new UI. Built so far: the flag, the
> tokens and the menu bar. The colour rule, the spacing and the landing-page heading are recorded here for
> the screens that come next. Bead: bd-5rz1v.12 (parent bd-5rz1v). Reference mockup:
> `versions/v6_deep-screens/deep-screens.html` in the NIETE Portal Coaching report folder.

The chosen direction is **Direction B, option 2 ("indigo menu bar")**: light screens, big rows, one action
button at the bottom, and indigo framing the screen at the top and bottom.

## Who it is for

Most teachers are not comfortable with technology. Every rule below follows from that.

## The four rules

1. **Icons + 1–2 words.** A label is a word or two next to an icon ("Home", "My Classes"). Never a sentence.
2. **No sentences.** No instructions, explanations or helper text on screen. If a screen needs a sentence to
   be understood, the screen is wrong.
3. **Every tap target is at least 56px** tall and wide (`TAP_MIN_PX`; class `min-h-[56px] min-w-[56px]`).
4. **Information never looks tappable.** Only something you can tap gets a button shape, a chevron (›) or a
   tappable row. A number, a status or a label is flat text, with no border, shadow, chevron or button colour.

## The colour rule

From the operator, 2026-10-03, after "still too much colour". It replaces the earlier
one-colour-per-feature notes.

| Colour | Where it goes | Token |
|---|---|---|
| **Indigo** `#333748` | The frame (the heading band and the menu bar). Anything **selected**: a picked number, a quiz answer, a toggle, a selected filter chip, the current row. | `FRAME`, `SELECTION` |
| **Green** | Every **primary button**, every **progress bar**, and **done** (check icons; Done, Sent and Ready chips). | `BUTTON.primary`, `PROGRESS`, `DONE`, `STATUS.done` |
| **Amber** | Waiting or warning ("3 min", "Writing", "24h wait"). | `STATUS.warning`, `BUTTON.warning` |
| **Red** | Errors and destructive actions. | `STATUS.error`, `BUTTON.destructive` |
| **Feature colour** | **Only** the small icon in the page heading, in a light tint on a soft white tile (`rgba(255,255,255,.12)`). | `FEATURE_ICON` |
| **Neutral grey** | **Everything else:** row icons, subject icons, provider badges, trophies, scores and values. | `NEUTRAL`, `STATUS.info` |

Values in rows are dark text (`nu-surface-text`). Buttons look the same in every feature: a feature colour
never changes a primary button. "Tests" and "Assessment Generator" are now called **Assessment**.

## Behind the flag

Everything new renders only while `portal_new_ui` is on for the signed-in user:

- the row: `app_settings.key = 'portal_new_ui'`. `true` means everyone, `["<users.id>", …]` means a pilot, and
  absent means off (`dashboard/lib/feature-flags.js`, `isFlagEnabledForUser`);
- the API: `GET /api/portal/config` → `features.newUi`;
- the browser: `useNewUi(userKey, ready)` (`src/portal/lib/useNewUi.ts`) returns `null` while loading, then
  `true` or `false`. It remembers the last answer per user, so pages do not flash the old menu, and callers
  share one `/config` read.

With the flag off, loading, or unreadable, a screen renders exactly what it rendered before. Pin that with a
snapshot recorded on the old code, as `PortalNavigation.flagOff.test.tsx` does.

## Tokens

All colours live in `tokens.ts`. `tailwind.config.ts` builds the `nu-*` classes from it, so do not write a
raw hex in a component.

### Base

| Token | Hex | Tailwind | Use |
|---|---|---|---|
| Logo indigo | `#333748` | `nu-ink` | the frame, selection |
| Indigo 2 | `#454a60` | `nu-ink-2` | a lighter indigo |
| Indigo light | `#e8e9f0` | `nu-ink-light` | the selection tint, the progress track |
| Indigo extra-light | `#f3f3f7` | `nu-ink-xlight` | a pressed row |
| Indigo edge | `#1d2030` | `nu-ink-edge` | the shadow under an indigo button |
| Frame translucent | `rgba(255,255,255,.14)` | `nu-frame-translucent` | the active menu pill, the back button, chips on the band |
| Logo green | `#48b078` | `nu-leaf` | the active menu icon |
| Logo green light | `#e2f3e9` | `nu-leaf-light` | the background of a "done" chip or icon |
| Focus | `#fdb022` | `nu-focus` | keyboard focus ring |
| Menu label | `#b9bccb` | `nu-nav-label` | menu items you are not on |
| Page | `#f4f5f8` | `nu-surface` | screen background |
| Card | `#ffffff` | `nu-surface-card` | lists of rows |
| Text | `#141826` | `nu-surface-text` | body text and every value |
| Muted | `#666b80` | `nu-surface-muted` | secondary text |
| Line | `#e3e5ec` | `nu-surface-line` | row dividers, card borders |
| Chevron | `#a0a4b4` | `nu-surface-chevron` | the › at a row's end |
| Handle | `#c9ccd6` | `nu-surface-handle` | a sheet's grab handle |

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
| Primary | `#2e7d57` | edge `#1e5c3f` | white | `bg-nu-button`, `nu-button-edge` |
| Secondary | `#ffffff` | border `#e3e5ec` | `#141826` | `bg-nu-button-secondary`, `border-nu-button-secondary-border` |
| Warning | `#b54708` | edge `#7a2e04` | white | `bg-nu-button-warning`, `nu-button-warning-edge` |
| Destructive | `#c8331f` | edge `#8a1f12` | white | `bg-nu-button-destructive`, `nu-button-destructive-edge` |
| Disabled | `#d7d9e0` | none | `#8c90a0` | `bg-nu-button-disabled`, `text-nu-button-disabled-text` |

### Progress, done and status chips

| Meaning | Colour | Background | Tailwind |
|---|---|---|---|
| Progress bar | `#48b078` | track `#e8e9f0` | `bg-nu-progress` on `bg-nu-progress-track` |
| Done icon (a check) | `#2e7d57` | `#e2f3e9` | `text-nu-done`, `bg-nu-done-bg` |
| Done, Sent or Ready chip | `#1e5c3f` | `#e2f3e9` | `text-nu-chip-done`, `bg-nu-chip-done-bg` |
| Waiting or warning chip | `#b54708` | `#fef0c7` | `text-nu-chip-warning`, `bg-nu-chip-warning-bg` |
| Error chip | `#c8331f` | `#fde6e2` | `text-nu-chip-error`, `bg-nu-chip-error-bg` |
| Information chip | `#333748` | `#e8e9f0` | `text-nu-chip-info`, `bg-nu-chip-info-bg` |

### Feature colour: the page-heading icon only

| Feature | Icon tint (on indigo) | Tailwind |
|---|---|---|
| Lesson Plans | `#7fd6a6` | `text-nu-f-lesson-plans` |
| Training | `#8bb8f7` | `text-nu-f-training` |
| Assessment | `#b8a8f8` | `text-nu-f-assessment` |
| The tile behind it | `rgba(255,255,255,.12)` | `bg-nu-f-tile` |

My Classes, Results and Certificates have no heading tint yet. Pick one when their screens move over. Each
feature's original hue (Lessons green, Training blue `#1d6fd8`, My Classes orange `#d9530b`, Assessment
purple `#6e52e0`, Results teal `#0b8a7c`, Certificates amber `#b54708`) is kept in `FEATURE_HUE` as the
source for that tint. It is never drawn on screen, so it is not a Tailwind class.

## Spacing

### Bottom menu bar (built)

- Padding 10px 6px 14px, plus `env(safe-area-inset-bottom)` at the bottom. The corners are **square**.
- The items share the width (`flex-1`), with 4px between the icon and the label.
- The icon is 23px; the label is 11.5px, weight 700.
- The active item's icon sits in a 56×32 pill (radius 16) on `rgba(255,255,255,.14)`. The icon is logo
  green and the label is white. Inactive labels are `#b9bccb`.
- Its height is 80px plus the safe area. With the flag on, the layout pads the page by 96px and docks the
  recording bar 88px up (plus the safe area). The old values (80px and 72px) are kept for flag-off.

### Heading band (landing page)

- The bottom corners are rounded 24px, followed by a 14px gap before the content.
- The status row has 10px 20px 0 padding.
- The title row has 10px 16px 14px padding, 12px gaps and a minimum height of 64px.
- The context-chip row has 0 16px 16px padding.
- The tile is 44px; the title is 24px, weight 800.

### Bottom action button

- It sits above the menu bar with 2px 14px 14px padding, and 10px between stacked buttons.

## The menu bar (built)

`NewUiNavigation.tsx`, rendered by `PortalNavigation` while the flag is on.

- **Phone:** the indigo bottom bar above: Home, Lessons, Training, Coaching and More. More opens the sheet
  with the other places, My account and Logout. Each is a 56px row with a **neutral grey** icon tile, and
  the current page's row is selected indigo. The sheet has its own 56px close button at the end of the
  title row, and hides the shared 16px one.
- **Desktop:** an indigo top bar with the NIETE mark, the same places, the active item on a translucent pill
  with a green icon, then My account (her name) and Logout.
- **Leader roles:** the same colours. Their items stay as they are.
- **Assessment (planned).** Lesson Plans and Assessment are becoming two separate pages. Assessment will go
  under More on a phone and get its own item in the desktop top bar. Today it is a tab inside
  `/portal/curriculum` with no route of its own, so the menu cannot link to it yet. Add the entry in the same
  change that gives Assessment its page. The phone bar stays Home, Lessons, Training, Coaching, More.

## Page heading (not built yet)

The operator found the old headings "bland", and rejected a feature-coloured band ("blue heading + green
page looks bad"). **Indigo frames the screen at the top and the bottom, the content stays light, and every
primary button is green.**

- **Landing page = indigo band:** white text on `bg-nu-ink`, with the status-bar area also on indigo. The
  bottom corners are rounded 24px. There is a 44px tile with the feature's icon in its tint
  (`text-nu-f-<feature>` on `bg-nu-f-tile`), and the title is 24px, weight 800. An optional row of context
  chips (e.g. "Last: Day 2 · Plants") is translucent white on indigo and is information, never tappable.
  Spacing is above.
- **Inner pages = TBD.** The operator is still deciding. Do not build an inner-page heading until it is
  settled.

Build the landing heading as one shared component when the first screen moves over, not per page.

## Urdu and RTL

- Only logical spacing: `ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`/`text-start`/`inset-x-`. Never `ml-`,
  `pr-`, `left-` or `text-left` on the new UI's own markup. A test checks the menu bar for this.
- Anything with a direction (›, ←, the logout arrow) flips with `rtl:rotate-180` or `rtl:-scale-x-100`.
- **Labels:** the portal's navigation has no string catalog. Its labels are English literals, and in Urdu the
  page turns RTL around them (`src/i18n/config.ts` sets `dir`/`lang`; the landing page alone uses `t()`).
  The mockup shows Urdu menu words. Adding them is a language change: read the `language-protocol` skill
  first, and give both languages the same reviewed keys.
- Nastaliq, and the serif fallback it forces on Latin text, needs a taller line height. The menu labels use
  `rtl:leading-[1.8]`. Allow for it in every row and label you add, and check it in a screenshot.

## Adding the next screen

1. Put it behind `useNewUi()`, with the old screen as the fallback.
2. Record a snapshot of the old screen before changing anything, then assert that flag-off renders it
   byte for byte.
3. Use only `nu-*` tokens. If a colour is missing, add it to `tokens.ts` and to the tables above.
4. Test the four rules and the colour rule on the new markup: label length, no sentences, `min-h-[56px]`,
   no button styling on information, and no feature colour outside the heading icon.
5. Take screenshots at 390px in English and Urdu, and at 1280px on desktop, with the flag on and off.
