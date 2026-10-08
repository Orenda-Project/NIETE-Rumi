# Teacher app v2 — the shared kit (`portal/src/portal/teacher/ui`, `…/teacher/icons`)

Bead bd-fmf24g.2 (epic bd-fmf24g). The React port of the v28 canvas components
(https://claude.ai/artifact/P2sPHWhkp27AnGe8x32Ys4) and their spec, `versions/v28_teacher-polish/COMPONENTS.md` in the
NIETE Portal Coaching report folder. Used only by pages behind `portal_teacher_v2`; nothing here renders on its own.

```ts
import { GradeSubjectButton, HistoryList, ListRow, SubjectTile, StatusChip, TEACHER_UI_COPY } from '@/portal/teacher/ui';
import { FeatureArt, FeatureGlyph, FEATURE_HUE, TEACHER_FEATURES } from '@/portal/teacher/icons';
```

## The rules every piece keeps

- **The canvas's coach-v2 look** (`styles.ts`): grey page `#f3f4f6`, white cards with a `#e5e7eb` edge and 16px corners,
  ink `#1d2025`, indigo `#33374a` for selection, muted `#6b7280`. A feature's colour is only ever its icon (`FEATURE_HUE`).
- **56px targets**; rows are 76px. **Urdu mirrors**: start/end spacing only, chevrons `rtl:rotate-180`, a selected row's
  bar sits on the start edge. **Motion** only under `motion-safe:`. Keyboard focus is the new UI's amber ring (`FOCUS`).
- **Words through props.** Every word the kit shows has an English default in `copy.ts` (`TEACHER_UI_COPY`); a
  component's `copy` prop takes any of them (the Urdu work passes a translated object). A feature's own words live in
  its own `copy.ts`. Data (subject names, titles, a day like "Today") is passed as it is.
- `checks.test.tsx` enforces all of this with the new UI's checkers (`newui/checks`): taps, left/right classes, motion,
  the theme's lying `grid`/`rounded-lg`, and words written into a component.
- **Canvas `href` → React `to`** (a react-router `Link`). Canvas `item={…}` → spread the object's fields as props.

## Icons (`../icons`)

| Export | Props | Notes |
|---|---|---|
| `FeatureArt` | `feature`, `size` (48), `label?`, `className?` | The D2-refined spot illustrations (Main.dc.html `r-*`). Decorative unless `label`. Digital Coaching is a phone. |
| `FeatureGlyph` | `name` (a feature, `home`, `more`), `size` (24), `label?`, `className?` | The menu glyphs (`g-*`), `currentColor`. Knocked-out details use CSS `--cut` (white by default; set it to the tint behind). |
| `FEATURE_HUE` | — | `{ fg, bg }` per feature (lessons green, coaching orange, observations red, training violet, assessment blue, attendance indigo, classes teal). |
| `TEACHER_FEATURES` | — | The seven features in Home's order. |

## Components

### `SubjectTile`
`subject`, `size` (48), `tone` (`neutral` · `selected` · `dim`). Rounded-12 square; icon 46% of the size, English/Urdu as
"Aa"/"اب". The subject → icon map is `subjectIcon()` (first match wins: Computer Science = monitor, General Science = flask).

### `StatusChip`
`text`, `tone` (`done` · `waiting` · `info` · `score` · `error`), `tick?`. Information, never tappable: 26px pill, 12px/600.
The chip object other components take is `{ text, tone }` (`ChipData`).

### `GradeSubjectButton`
| Prop | Type | Default |
|---|---|---|
| grade | string \| number \| null ("" = subject alone) | "" |
| section | string ("A" → "Grade 4-A") | "" |
| subject | string | — |
| sub | second line ("32 students") | — |
| chip | `ChipData` | — |
| state | `default` · `selected` · `disabled` | `default` |
| variant | `card` · `row` (flat, inside one list card) | `card` |
| first | row: no divider above | false |
| to | link target; leave out for a button | — |
| onPress | button tap | — |
| copy | `{ grade, selected }` | `TEACHER_UI_COPY` |

76px. Selected: 2px indigo edge on `#f4f5f8`, tinted tile, indigo check (row: tint + 3px start bar). Disabled: 45%, no
chevron, never a link. A button carries `aria-pressed`. `gradeSubjectLabel()` gives the same "Grade 4-A · Subject" text.

### `HistoryRow`
| Prop | Type | Default |
|---|---|---|
| subject, grade, title | string, string \| number, string | — |
| extra | line 2 ("Chap 1", "20 questions") | — |
| chip | `ChipData` | — |
| action | `chevron` (link to `to`) · `download` (56px button → `onAction`) · `none` | `chevron` |
| to | where the row goes | — |
| isNew | the red dot | false |
| first | no divider above | true |
| copy | `{ grade, download, newItem }` | `TEACHER_UI_COPY` |

Lead = the operator's block: "Grade 4" over the subject (`blockSubject()`: full name when it fits, else "Soc. St.",
"Pak. St.", "Geogr." …), both 16px/700. The canvas's other leads (icon, stacked, badge, tint) were turned down and are
not ported.

### `HistoryList`
| Prop | Type | Default |
|---|---|---|
| heading | string ("" = no heading row) | "" |
| groups | `[{ day, items: [HistoryRow props + id?] }]` (days with no items are dropped) | — |
| showMore / onShowMore | Show more at the end | true / — |
| emptyLabel | the empty card's words | `copy.nothingYet` |
| collapsible / defaultOpen / open / onOpenChange | heading becomes a ≥56px toggle; `open` sets it from outside, a tap still toggles until `open` changes | false / true / — / — |
| seeAllTo / onSeeAll | "See all ›" ends the heading row (collapsed and open) and a full-width See all **replaces** Show more | — |
| copy | `{ grade, download, newItem, showMore, seeAll, seeAllNamed, nothingYet }` | `TEACHER_UI_COPY` |

```tsx
<HistoryList heading={copy.recent} groups={byDay} collapsible defaultOpen={false} seeAllTo="/portal/teacher/lessons/all" />
```

### `ListRow`
| Prop | Type | Default |
|---|---|---|
| prefix | over the number, carrying any "#" ("Chap", "LP #", "Part") | — (number alone) |
| number | string \| number (a leading "#" is dropped) | — |
| icon | `worksheet` · `revision` · `file` (replaces the number) | — |
| label, subtitle | title (2 lines), muted second line | — |
| chip | `ChipData` | — |
| state | `default` · `used` (✓ Used) · `locked` (55%, lock, not tappable) · `selected` | `default` |
| variant / first | `card` · `row` / no divider above | `card` / true |
| to / onPress | link, or a button that selects in place | — |
| copy | `{ used, selected, locked }` | `TEACHER_UI_COPY` |

Selected: `aria-current="true"` on a link, `aria-pressed` on a button.
