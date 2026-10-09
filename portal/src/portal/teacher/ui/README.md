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
| `FeatureArt` | `feature`, `size` (48), `label?`, `className?`, `motion?` | The D2-refined spot illustrations (Main.dc.html `r-*`). Decorative unless `label`. Digital Coaching is a phone. `motion` opts in to the small movements, only inside a `FeatureMotionProvider` (Home): ONE shared 30–60 s timer plays every opted-in icon together, none under reduced motion, paused while hidden. Menu glyphs never move. |
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
| copy | `{ grade, gradeShort, download, newItem }` | `TEACHER_UI_COPY` |

Lead = the operator's **D6.5 "section, stacked"** (bd-fmf24g.16, 9 Oct: "switch this component everywhere"; it replaced
the 8 Oct grey block — there is no lead prop). Not a chip: a **64px column** built into the row, flush with its START
edge (left in English, right in Urdu), the full row height (76px, taller when the title wraps), 12px from the text.
The card clips it at its rounded corners: `LIST_CARD` is `overflow-hidden`, and a row standing alone must sit in a card
that is too, with no padding between (RequestPage's ready card is the row itself).

- **Top:** "G4" (`copy.gradeShort`) 17px/800, tabular numbers, white on the grade's dark colour.
- **Bottom:** the subject's short form (`subjectShort()` in `subjects.ts`: Eng, Urdu, Math, Comp, Phy, Chem, Bio, Agri,
  GK, Sci, Rel, Pak St, SST, Isl, Geo, Hist; anything else its first word cut to 4 letters) 15px/700, no period, never
  wrapped or cut, in the grade's dark colour on its light tint.
- **Colour is the GRADE's** (operator, 9 Oct), chosen in ONE place, `leadColours()` (HistoryRow.tsx), from the one
  table in `gradeColours.ts` (`GRADE_COLOURS`, `gradeColoursFor(grade)`, exported for other components): grade →
  `{ dark, light }`, Grades 1–5 bright, 6–12 deeper — G4 `#c62828`/`#f8e5e5`, G10 `#00796b`/`#e6f2f0`. The subject
  changes nothing. A tile with no grade is neutral (`NEUTRAL_COLOURS`: `#33374a` on `#f3f4f6`).
- **No grade** (bd-fmf24g.11: absent, empty or a dash): the subject alone, centred on the neutral grey, full height — never
  "G–". **No subject either:** the SubjectTile book icon on grey. **A grade with no subject:** "G4" alone on the dark.
- **Accessibility:** the column is `aria-hidden`; a visually hidden span gives the row's accessible name the full words,
  "Grade 4 General Science" (`copy.grade` + the subject as given).
- **Urdu** (MACHINE-DRAFTED, in the review file): the numeral alone on top ("4"), and one short Urdu word below at
  13px (سائنس, ریاضی, انگریزی, پاکستان, معاشرتی …; the bot's names, first word of a two-word one), measured to fit the
  64px column in Noto Nastaliq Urdu. A subject with no Urdu form keeps its English 4 letters; digits and Latin go
  through the kit's bidi egress (isolated).

### `HistoryList`
| Prop | Type | Default |
|---|---|---|
| heading | string ("" = no heading row) | "" |
| groups | `[{ day, items: [HistoryRow props + id?] }]` (days with no items are dropped) | — |
| showMore / onShowMore | Show more at the end | true / — |
| emptyLabel | the empty card's words | `copy.nothingYet` |
| collapsible / defaultOpen / open / onOpenChange | heading becomes a ≥56px toggle; `open` sets it from outside, a tap still toggles until `open` changes | false / true / — / — |
| seeAllTo / onSeeAll | "See all ›" ends the heading row (collapsed and open) and a full-width See all **replaces** Show more | — |
| copy | `{ grade, gradeShort, download, newItem, showMore, seeAll, seeAllNamed, nothingYet }` | `TEACHER_UI_COPY` |

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

### `ClassPicker` (her class, or any grade and subject — bd-fmf24g.14)
ONE control wherever a page needs a grade·subject (Lesson Plans, its All page's filter, Digital Coaching, Check and
send, Assessment New paper 1). It replaced `GradeSubjectPicker` (a long class list under a search box) and
`GradeSubjectSelector` (separate Grade / Subject fields). Design: option A of `ClassPickerOptions.dc.html` on the
v28 canvas; spec COMPONENTS.md §11.

| Prop | Type | Default |
|---|---|---|
| label | the trigger's words and the tray's title (the screen's copy) | — |
| combos | `GET /api/portal/me/grade-subjects` → `combos` as they come (`featureKey` / `subjectKey` match a pair however it is spelled; `grade: null` left out; `available: false` shown starred and off) | — |
| allowOther | any grade and subject (true), or her classes only | true |
| value / defaultValue | `{ grade, subject }` | — / null |
| onChange | `(pair, { mine, combo })` — `combo` is her combo (keys and all) when the pick is hers, else null | — |
| to | `(pair, { mine, combo }) => string \| undefined`: a string makes that pair a link (it still reports the pick) | — |
| feature / subjectsByGrade | the built-in map in `catalogue.ts`, or the live catalogue's names | `lessons` / — |
| grades | grades that may be picked (the rest are off) | 1–12 |
| copy | `{ grade, gradeField, selectGrade, gradeSubjects, yourClass, gradeAndSubject, change, close, selected }` | `TEACHER_UI_COPY` |

Trigger: a 76px card — the label, or the subject tile, a small line ("★ Your class" over one of hers, "Grade and
subject" over any other, the label itself with `allowOther` off), the pair, Change. Tray (no search): "Grade" and the
twelve grades, four across, 56px, hers starred and tinted, a grade with nothing on offer grey and off; then that
grade's subjects two across (64px, tile + name), hers first and starred, the rest A–Z. No grade is picked for her
(no last-used memory) unless she teaches one grade or a pair is already chosen. `allowOther` off: only her grades and
subjects; four classes or fewer are plain rows; one grade skips the grade step.

```tsx
<ClassPicker label={copy.selectGradeSubject} feature="lessons" combos={mine} to={toChapters} onChange={openOther} />
<ClassPicker label={copy.selectClass} combos={mine} allowOther={false} value={pair} onChange={(v) => setPair(v)} />
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
and closes; Select dates = From / To (labelled, max today) and Show, waiting for From ≤ To ("From after To" otherwise).
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

### `ReadyTray` (what is being made, on every screen — bd-fmf24g.15)
`items: TrayRow[]` (`{ id, feature: 'lessons' | 'assessment', what, gradeSubject, title, state: 'making' | 'failed', progress 0..1,
left, to }`), `maxRows?` (2), `hideId?`, `onFollow?(id)`, `onOpenList()`, `listOpen?`, `onCloseList?`, `note?`, `copy?` (`NotifyCopy`).
A grey strip with one white card above the bottom menu: a 64px row per item (a 48px progress ring in the feature colour,
"Lesson plan · Grade 7 · Science", "Being made · ~1 min left", a chevron → `to`). Past its time `left` is empty and the row
says "Almost done". A 3rd+ adds one 56px "+N more · See all" row that opens the list (a `Tray` sheet, every item with its title
on its own line, `note` under the title). `failed` rows are red ("Couldn't make it · Try again") and stay until followed
(`onFollow`). `trayHeight(rows, hasMore)` is the strip's height, for the host to give the page. The shell's host
(`teacher/notices/NoticeHost`) is the only caller: pages never draw it.

### `ReadyBanner` ("it is ready" for 10 seconds — bd-fmf24g.15)
`items: BannerRow[]` (`{ id, feature, what, title, line }`), `variant?` (`ready` | `failed`), `reason?` (failed), `durationMs?`
(10 000), `onOpen(id)`, `onClose()`, `onExpire()`, `onRetry?(id)`, `onSeeAll?()`, `copy?`. A white card above the menu: icon + green
tick, "Lesson plan ready", the title, "Grade 7 · Science", a 56px ✕, a full-width 56px indigo Open, and a 6px bar that shrinks from
its end edge to its start (right to left in English, left to right in Urdu). It **pauses while a finger, the mouse or focus is
on it** and carries on; `onExpire` fires once. Two or more are ONE banner, "2 ready" (a row and an Open each, at most two,
then "+N more ready"); a change in the set restarts the 10 seconds. `failed` is the same frame in red with the reason and
Try again, `role="alert"`. It only reports; the host says what Open, ✕ and running out mean.

### `LeaveNote`
`text`. A white card with a bell and the screen's sentence ("You can leave. We'll tell you here."), `role="note"`. The words are
the screen's: a sentence is not a kit label (`teacher/notices/copy.ts`).
