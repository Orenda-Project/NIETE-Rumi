# Portal new UI — design rules (DRAFT)

> **Draft.** Expanded screen by screen as each screen moves to the new UI. Built so far: the flag, the
> tokens and the menu bar. The colour rule, the spacing and the two page headings are recorded here for the
> screens that come next. The headings will be built with those screens. Bead: bd-5rz1v.12 (parent bd-5rz1v). Reference mockup:
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
| **Indigo** `#333748` | The frame (a main page's flat heading band and the menu bar). Anything **selected**: a picked number, a quiz answer, a toggle, a selected filter chip, the current row. | `FRAME`, `SELECTION` |
| **Green** | Every **primary button**, every **progress bar**, and **done** (check icons; Done, Sent and Ready chips). | `BUTTON.primary`, `PROGRESS`, `DONE`, `STATUS.done` |
| **Amber** | Waiting or warning ("3 min", "Writing", "24h wait"). | `STATUS.warning`, `BUTTON.warning` |
| **Red** | Errors and destructive actions. | `STATUS.error`, `BUTTON.destructive` |
| **Feature colour** | **Only** the feature's own icon: in its light tint on the soft white tile of a main page's band, or in its hue at the start of an inner page's breadcrumb. | `FEATURE_ICON` |
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
| Frame translucent | `rgba(255,255,255,.14)` | `nu-frame-translucent` | the active menu pill, chips on the band |
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

### Feature colour: the feature's own icon only

| Feature | On the indigo band (tile icon) | In a light bar's breadcrumb | Tailwind |
|---|---|---|---|
| Lesson Plans | `#7fd6a6` | `#2e7d57` | `text-nu-f-lesson-plans`, `text-nu-f-lesson-plans-crumb` |
| Training | `#8bb8f7` | `#1d6fd8` | `text-nu-f-training`, `-crumb` |
| Assessment | `#b8a8f8` | `#6e52e0` | `text-nu-f-assessment`, `-crumb` |
| The tile behind it (band) | `rgba(255,255,255,.12)` | n/a | `bg-nu-f-tile` |

The Dashboard's band shows the NIETE mark rather than a feature icon. My Classes, Results and Certificates
have no icon colours yet. Their hues (orange `#d9530b`, teal `#0b8a7c`, amber `#b54708`) are kept in
`FEATURE_HUE` for when their screens move over.

### Light bar (pages inside a flow)

| Token | Hex | Tailwind |
|---|---|---|
| Bar | `#ffffff` | `bg-nu-inner` |
| 1px bottom line | `#e3e5ec` | `border-nu-inner-border` |
| Back button (circle) | `#f3f3f7`, icon `#333748` | `bg-nu-inner-back`, `text-nu-inner-back-icon` |
| Breadcrumb text | `#666b80` | `text-nu-inner-crumb` |

## Spacing

### Bottom menu bar (built)

- Padding 10px 6px 14px, plus `env(safe-area-inset-bottom)` at the bottom. The corners are **square**.
- The items share the width (`flex-1`), with 4px between the icon and the label.
- The icon is 23px; the label is 11.5px, weight 700. On the five-item teacher bar the label is 10.5px and
  the pill is 50px wide.
- The active item's icon sits in a 56×32 pill (radius 16) on `rgba(255,255,255,.14)`. The icon is logo
  green and the label is white. Inactive labels are `#b9bccb`.
- Its height is 80px plus the safe area. With the flag on, the layout pads the page by 96px and docks the
  recording bar 88px up (plus the safe area). The old values (80px and 72px) are kept for flag-off.

### Heading band (feature main pages)

- The band is flat, with **square** corners, and sits 14px above the content.
- The status row has 10px 20px 0 padding.
- The title row has 10px 16px 14px padding, 12px gaps and a minimum height of 64px.
- The context-chip row has 0 16px 16px padding.
- The tile is 44px; the title is 24px, weight 800.

### Bottom action button

- It sits above the menu bar with 2px 14px 14px padding, and 10px between stacked buttons.

## The menu (built)

`NewUiNavigation.tsx`, rendered by `PortalNavigation` while the flag is on. This is the teacher menu the
operator decided on 2026-10-03 (reference: the Home section of `versions/v6_deep-screens/deep-screens.html`).

- **Teacher, phone:** the indigo bottom bar has five items: **Home, Lessons, Assessment, Training, Coaching**.
  There is no More. Five long labels make the bar *tight*: labels are 10.5px and the pill is 50px wide.
  **Assessment** opens `/portal/curriculum?tab=assessment` (the page opens on its Assessment tab) until
  Assessment becomes a page of its own. Lessons and Assessment are lit by that parameter. A tab switched
  inside the page does not change the URL, so after that the menu still lights Lessons.
- **Teacher, avatar:** what used to sit under More now sits behind an avatar, a 40px circle with her
  initials inside a 56px target. On a phone it lives in a slim indigo strip at the top of the page, next to
  the NIETE mark. When the page heading band (below) is built, the band carries the avatar and the strip
  goes. On a desktop the avatar ends the top bar. It opens the **account sheet**, titled with her name:
  My Classes, Analytics, Certificates and My account, each a 56px row with a neutral icon. Below them sits
  a red outline Logout button. On a desktop the sheet is a card under the avatar.
  - *Analytics* will move into Home. Until then the sheet links to the existing page, so nothing becomes
    unreachable.
  - *Language* is in the mockup but not built. There is no page to send it to, and a language picker is a
    language change (`language-protocol`).
- **Teacher, desktop:** an indigo top bar with the NIETE mark, then **Home, Lesson Plans, Assessment,
  Training, Coaching**, then the avatar.
- **Leader roles:** the same colours, with their own items unchanged: the bar (today just Training) plus
  More, whose sheet holds the rest, My account and Logout. On desktop, their name links to My account,
  followed by Logout.
- The item you are on is white, with its icon logo green in a translucent pill. The current page's row in
  a sheet is selected indigo. Every sheet has its own 56px close at the end of the title row, and the
  shared 16px one is hidden.

## Page headings (decided, not built yet)

The operator found the old headings "bland" and rejected a feature-coloured band ("blue heading + green page
looks bad"). Indigo frames the screen, the content stays light, and every primary button is green. The
headings will be built with their screens; this bead only builds the flag, the tokens and the menu.

1. **Feature main pages** (Dashboard, Lesson Plans, Assessment, Training, Coaching) use a **flat indigo band**
   (`bg-nu-ink`) with square corners, and the status-bar area sits on indigo too. Inside it are:
   - a 44px soft-white tile (`bg-nu-f-tile`) holding the feature's icon in its light tint
     (`text-nu-f-<feature>`). The Dashboard shows the NIETE mark instead;
   - a 24px/800 white title;
   - a row of context chips below (e.g. "Last: Day 2 · Plants"), translucent white
     (`bg-nu-frame-translucent`). They are information and never look tappable.
2. **Pages inside a flow** use a **light bar**: white (`bg-nu-inner`) with a 1px bottom border
   (`border-nu-inner-border`). Inside it are:
   - a circular back button with a soft indigo tint (`bg-nu-inner-back text-nu-inner-back-icon`). It is a
     56px target, and its arrow flips in RTL;
   - a small breadcrumb line, 12px and muted (`text-nu-inner-crumb`), led by the feature's icon in its hue
     (`text-nu-f-<feature>-crumb`), e.g. "Training · NIETE · Level 2";
   - a 20px/800 title (`nu-surface-text`).
3. **Bottom menu bar:** square, as built.
4. **Desktop:** the indigo top nav, then the flat indigo band on main pages, or the light bar on inner pages.

Build each heading as one shared component when the first screen moves over, not per page.

## Urdu and RTL

- Only logical spacing: `ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`/`text-start`/`inset-x-`. Never `ml-`,
  `pr-`, `left-` or `text-left` on the new UI's own markup. A test checks the menu bar for this.
- Anything with a direction (›, ←, the logout arrow) flips with `rtl:rotate-180` or `rtl:-scale-x-100`.
- **Labels:** the portal's navigation has no string catalog. Its labels are English literals, and in Urdu the
  page turns RTL around them (`src/i18n/config.ts` sets `dir`/`lang`; only the public marketing page uses `t()`).
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
