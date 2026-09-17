# Sheet architecture

Target: **`14-ndk94fkTbqKn0MW4QPhMgLGTesswVj-_GTwe4GYio`** — "Reworked Grades 1-5
ICT Curriculum Matrix", owner amena.ahmed@taleemabad.com, parent Shared Drive
`0AATO-ScbRAmEUk9PVA`. A new sheet: the production matrix `1zpRop18…` is live and is
not edited by this build.

Everything is on this one sheet, including the video mapping.

**Governing recipe:** `curriculum-baked-lesson-plans/reference/curriculum-matrix-sheet.md`.
This file records only where this build differs from it or fixes it in place.

---

## 1. Tabs

| Tab | Role |
|---|---|
| **Navigation** | First tab (gid 0). Title block, one row per tab with description + jump link, corpus stats, the review ask |
| **Teaching Calendar** | Rows = Grade × Subject, columns = teaching days to 2026-12-24; cells = 2-letter skill-type codes. Days whose `Interaction` is pair/group/mingle are marked |
| **English G1–5** · **Urdu G1–5** · **Maths G1–5** · **Science G4–5** | One row per teaching day. Row grammar §4 |
| **All Segments + SLOs** | Flat filterable dump of every segment × every field |
| **Skill Taxonomy** | Every skill type per subject, defined, so reviewers and LP writers share a vocabulary |
| **Pipeline Stages** | The build recipe as data: stage, input, output, status, key decisions |
| **Communicative Balance** | English and Urdu. Per grade × term: share of periods by `Interaction`, by `Gap`, by `Strand`; recycling shortfall; and periods tagged Speaking/Listening vs periods whose `Interaction` is actually pair/group |
| **Chapter Hearts** | Chapter-level voicenote scripts + audio links + review status, one row per chapter. Superseded versions become hidden tabs |
| **Video library** | The Taleemabad library with its SLO mapping |
| **FDE diff** | The `In syllabus` / `Omitted by FDE` / `Deviation` topic diff |
| **Games — {Subject}** | Per-segment SLO-anchored questions, 2 per day. Added when that workstream starts |

Grade 5 board prep is rows inside the subject tabs (Jan–Mar), not a separate tab.

## 2. Content columns

Per teaching-day row:

```
Day # · Topic · Skill Type · [CPA Phase] · Pages · SLO Codes · SLO Descriptions
      · Bloom's · Duration (minutes, move-derived)
```

**English and Urdu carry five more**, per the recipe — and they are the columns that
make the governing principle auditable:

| Column | Values |
|---|---|
| `Function` | the child-facing can-do, from the curriculum's own functions section, never invented |
| `Interaction` | `individual · teacher↔class · pair · group · mingle` |
| `Gap` | `none · one-way · two-way · reasoning · opinion` |
| `Strand` | `input · output · language-focus · fluency` |
| `Recycles` | earlier functions/words re-met |

Plus `Unit Task` on the chapter-header row: `{outcome, gap, source, protected}`.

`Interaction` and `Gap` stay separate columns. A term of `pair` at `Gap: none` is
choral practice in pairs, and only both columns together reveal it. They are never
collapsed into a high/medium/low scale.

This build's additions, all subjects:

| Column | Contents |
|---|---|
| FDE marker | `In syllabus` · `Omitted by FDE` · `Deviation` (+ reason) |
| Reading strategy | the day's named pre/during/after strategies |
| Collaboration structure | the day's named structure, from the rotation |
| Video | title · link · SLO match · why it maps here |
| Prerequisite SLOs | the codes this day depends on, for the ordering check |
| Teacher-primary minutes | of 40 — the student-active split |

## 3. Trace and review columns

Modelled on the production sheet's English tab, columns AE–AN. Cell text is short
(`pg 2`, `open`, `v8`).

| Stage | Column | Artefact |
|---|---|---|
| A | Page truth | `…/ict-k5/page-truth/<hash>/<book>/pg_NNN.json` |
| B | Segmentation | `…/segmentation/<hash>/<book>_full_segments…` |
| C | Enrichment | `…/enrichment/<hash>/<book>/…` |
| C-gate | Enrich gate | `…/enrichment/<hash>/…` |
| D0 | Slide script | `…/renders/<hash>/v8/<lesson>/_slide…` |
| D | Render meta | `…/renders/<hash>/v8/…/_render…` |
| E | Voicenote script | `…/renders/<hash>/v8/…/_voicenote.txt` |
| J | Pedagogy review | `…/_pedagogy_full.json` |
| J | Design review | `…/_design…` |
| F | LP (latest PDF) | `…/renders/<hash>/v8/<lesson>.pdf` |

Plus **Human reviewer** and **Review status** — a person can overrule a machine
verdict, and the overrule is visible rather than buried.

**Links are rich text, never `=HYPERLINK()`.** Write the label as the cell value and
attach the URL via `updateCells` → `userEnteredFormat.textFormat.link.uri`. Formula
links break when cells are edited and export as formulas. (The recipe's §2 column
list still shows `=HYPERLINK`; §5.6 supersedes it.)

Because links are cell-level, a FORMULA render returns plain text. Read them back with:

```python
spreadsheets().get(
    includeGridData=True,
    fields="sheets.data.rowData.values(formattedValue,hyperlink,note,textFormatRuns)")
```

## 4. Row grammar

Identical to [`segmentation.md`](segmentation.md) §2 — banners matched by label,
never by row number, because humans edit this sheet and row indices move.

## 5. Writing to the sheet

Sheets API v4 via the service account, not CSV import. Stage B creates the subject
and support tabs; every later stage appends or fills columns and **never restructures
rows**.

```python
creds = service_account.Credentials.from_service_account_file(
    os.environ["GOOGLE_SERVICE_ACCOUNT_PATH"],
    scopes=["https://www.googleapis.com/auth/drive",
            "https://www.googleapis.com/auth/spreadsheets"])   # no delegation
```

- The SA authenticates as itself and is a member of the Shared Drive. Every Drive
  call passes `supportsAllDrives=True`.
- It cannot create a file in a My Drive (storageQuota 0) — creation must pass
  `parents=[GOOGLE_SHARED_DRIVE_ID]`. Here the file already exists and is shared, so
  scripts only `batchUpdate`.
- Do not use the Sheets MCP for creation; it 403s on its default parent folder.
- Assert the column count against the target header before any write.

## 6. Formatting — binding, in the same session a tab is created

No tab ships as a raw grid. Full recipe in `curriculum-matrix-sheet.md` §5; the four
gotchas that have already broken a run:

1. **Discover the tab's real extent first.** Fetch the header row and scan for the
   last used column and row; every band, merge, filter and base format spans that
   extent. A tab formatted to an assumed `A:M` while data runs to `T` ships half-raw.
2. **A merged full-width banner and a frozen leading column are mutually exclusive** —
   the API rejects the freeze. Paint banner rows instead of merging them:
   background across the full row, `OVERFLOW_CELL`, long text in the first column past
   the freeze boundary.
3. **A rebuild drops and recreates tabs, never patches in place.** One leftover merge
   makes the freeze fail, so a patching rebuild can never converge.
4. **Sheets coalesces adjacent same-depth dimension groups.** Per-chapter row groups
   over contiguous ranges silently become one group folding the whole grade. On these
   review surfaces use basic filter + frozen identity columns instead.

Verify by reading formats back with a `fields` mask at the last column — "applied" is
not "rendered correctly", and a read-back clipped to the wrong range proves nothing.
