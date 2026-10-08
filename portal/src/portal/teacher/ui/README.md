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
| subject, title | string | — |
| grade | string \| number; **optional** — absent, empty or a dash placeholder ("–") when it was never settled | — |
| extra | line 2 ("Chap 1", "20 questions") | — |
| chip | `ChipData` | — |
| action | `chevron` (link to `to`) · `download` (56px button → `onAction`) · `none` | `chevron` |
| to | where the row goes | — |
| isNew | the red dot | false |
| first | no divider above | true |
| copy | `{ grade, download, newItem }` | `TEACHER_UI_COPY` |

Lead = the operator's block: "Grade 4" over the subject (`blockSubject()`: full name when it fits, else "Soc. St.",
"Pak. St.", "Geogr." …), both 16px/700. No grade (bd-fmf24g.11: a DC lesson the analysis left open): the subject alone, centred, same
16px/700 — never "Grade –". No grade and no subject: the SubjectTile book icon. A grade with no subject: "Grade 4" alone. The canvas's other leads (icon, stacked, badge, tint) were turned down and are
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

### `Tray`
`open`, `title`, `onClose`, `closeLabel?`, `children`. The canvas's bottom sheet: dim `rgba(17,24,39,.45)` (a tap closes),
`#f3f4f6` sheet, 22px top corners, handle, 22px/600 title, 56px round close; a centred card on a desktop. Behaves as
`newui/Sheet`: Android Back (role=dialog + data-state=open), Escape, focus in/trapped/restored, page scroll locked,
motion-safe rise. Scrolls inside itself, so sticky headings stick.

### `GradeSubjectSelector` (any grade, any subject)
| Prop | Type | Default |
|---|---|---|
| value / defaultValue | `{ grade, subject \| null }` — controlled or on its own | — / null |
| onChange | `({ grade, subject })` on **every** change; `subject` null until picked (a new grade clears a subject it lacks) | — |
| feature | `lessons` · `assessment` — the built-in map in `catalogue.ts` | `lessons` |
| subjectsByGrade | `{ [grade]: string[] }` — the live catalogue, replaces the built-in map | — |
| grades | grades that may be picked | 1–12 |
| copy | `{ grade, gradeField, subjectField, selectGrade, selectSubject, close, selected }` | `TEACHER_UI_COPY` |

Two 68px fields (~146px). Grade → a tray of 12 pills, 4 across, 64px (grades with nothing for the feature flat grey,
not pickable; arrows move the focus, Enter/Space picks). Subject (off until a grade) → that grade's subjects as rows.
Picking closes the tray. Differences from the canvas: `onChange` fires on every change (not only once both are set);
the history variants (`fields`, `stepper`, `chips`, `combos`, `mode="inline"`) and the canvas-only `openTray`,
`sheetMode`, `inlineHeight` are not ported.

### `GradeSubjectPicker` (her grade·subject combinations)
| Prop | Type | Default |
|---|---|---|
| label | trigger words and sheet title (the screen's copy) | — |
| combos | `GET /api/portal/me/grade-subjects` → `combos` as they come (`{ grade, subject, … }`; one pair once; `grade: null` left out) | — |
| value / defaultValue / onChange | `{ grade, subject }` | — |
| allowOther | the "Other classes" section | true |
| recentFirst | keep `combos`' order instead of grade → subject A–Z | false |
| feature / subjectsByGrade | what "Other classes" offers | `lessons` / — |
| to | `(value) => string`: every row is a link (and still calls onChange) | — |
| copy | `{ grade, selected, close, search, yourClasses, otherClasses, noMatch, change }` | `TEACHER_UI_COPY` |

```tsx
<GradeSubjectPicker label={copy.selectLessonPlan} combos={data.combos} value={pair} onChange={setPair} />
<GradeSubjectPicker label={copy.chooseClass} combos={data.combos} allowOther={false} onChange={startLesson} />
```

`catalogue.ts`: `LESSON_SUBJECTS_BY_GRADE`, `ASSESSMENT_SUBJECTS_BY_GRADE` (the bot's lists on 2026-10-08; sources in
the file) and `subjectsByGradeFor(feature, given?)`.

### `DateRangeBar` (top of an All page)
| Prop | Type | Default |
|---|---|---|
| value / defaultValue | the portal's `DateRange` (`newui/range.ts`: `{ key: 'this_week' \| 'this_month' \| 'last_3_months' \| 'this_year' \| 'all' }` or `{ key: 'custom', from, to }`) | — / This month |
| onChange | `(range, info)`: `info` = `{ from, to, prevFrom, prevTo, span, prevSpan, label, compareLabel }` | — |
| today | YYYY-MM-DD the ranges end on | Pakistan's today (`pkToday()`) |
| copy | `{ dateRange, presets, pickDates, pickedDates, from, to, everything, rangeError, showDates, showSpan, compareWith, months, close }` | `TEACHER_UI_COPY` |

A 68px card: calendar tile, the range's name over its dates. Tray: six 64px choices with their dates; a preset applies
and closes; Pick dates = From / To (labelled, max today) and Show, waiting for From ≤ To ("From after To" otherwise).
`rangeQuery(range)` (newui) is the API query, as Home's. The previous period (`resolveRange()` in `range.ts`) is the
same stretch one step back (1–8 Oct vs 1–8 Sep; the n picked days vs the n days before; All time has none), day-clamped.

```tsx
<DateRangeBar value={range} onChange={(r, info) => { setRange(r); setCompare(info.compareLabel); }} />
<KpiTiles items={kpis} compareLabel={compare} />
```

### `KpiTiles`
`items: [{ value, label, delta?, trend?, better? }]` (1–4 shown), `columns?` (2; 3 for three), `compareLabel?`, `copy?`
(`same`, `sameAsBefore`, `upBy`, `downBy`, `noValue`). Number 32px (26px three across), thousands separated, missing =
"—"; change pill ▲ green / ▼ amber / ● Same (`better: 'down'` swaps the colours); sparkline from ≥2 points. Numbers
come from the page's data only.

### `ProgressSteps`
`heading?` (`copy.progress`), `steps: [{ label, sub?, state: 'done' | 'current' | 'later', nowText? }]`, `done?`,
`doneLabel?`, `open?` / `onOpenChange?`, `copy?` (`progress`, `done`, `now`, `stepsCount`). The current step has
`aria-current="step"`. Done collapses to a 56px green "Done · {doneLabel}" toggle.

### `VoiceNote`
`from`, `avatar` (`dc` · `person`), `initials?`, `duration`, `time`, `src?`, `heard?`, `copy?` (`play`, `pause`). With `src`
it plays for real (preload none; one note at a time) and the 28-bar waveform fills as it plays; without, the button only
toggles the drawing. DC only (the ~90 s voice debrief).

### `ReportBody`
`data: ReportData` (`headline, marks, max, teacher, topic, date, eyebrow?, identity?, sections[{ code, label, score, max,
why, na }], moment?, strength?, horizon?, photos?[{ src, cap }], journey?{ points, first, last, note }, lastAsked?{ text,
status, tone, line }, tryNext?, debrief?{ heading, initials, note, commitment, closing }`), `copy?` (`ReportCopy`). The
hero report's sections in the PNG's order; every section without data is left out (that is the DC / coach-visit
difference — the canvas's `kind` prop is not needed). Photos without an image are left out. Footer "Made just for you,
{first name}" — the PNG's words (the copy check's one documented exception).
