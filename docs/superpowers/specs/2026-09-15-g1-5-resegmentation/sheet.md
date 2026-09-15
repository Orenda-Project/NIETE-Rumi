# Sheet architecture

Target: **`14-ndk94fkTbqKn0MW4QPhMgLGTesswVj-_GTwe4GYio`** — "Reworked Grades 1-5
ICT Curriculum Matrix", owner amena.ahmed@taleemabad.com, parent Shared Drive
`0AATO-ScbRAmEUk9PVA`.

A new sheet, deliberately. The production matrix `1zpRop18…` is live and is not
edited by this build.

**Everything is on this one sheet, including the video mapping.**

---

## 1. Tabs

| Tab | Contents |
|---|---|
| **How to use this sheet** | First tab. Navigation, column meanings, row grammar, marker legend — as the previous sheet had |
| English G1–5 | one tab |
| Urdu G1–5 | one tab |
| Maths G1–5 | one tab |
| Science G4–5 | one tab |
| Video library | the Taleemabad library, with its SLO mapping |
| FDE diff | the `In syllabus` / `Omitted by FDE` / `Deviation` topic diff |
| Calendar | slots to 2026-12-24, holidays removed, Jan–Mar revision and board prep |

## 2. Content columns

Per teaching-day row:

```
Day #  ·  Topic  ·  Skill Type  ·  [CPA Phase]  ·  Pages  ·  SLO Codes
       ·  SLO Descriptions  ·  Bloom's  ·  Duration (minutes, move-derived)
```

Then this build's additions:

| Column | Contents |
|---|---|
| FDE marker | `In syllabus` · `Omitted by FDE` · `Deviation` (+ reason) |
| Reading strategy | the day's named pre/during/after strategies |
| Collaboration structure | the day's named structure, from the rotation |
| Video | title · link · SLO match · why it maps here |
| Prerequisite SLOs | the codes this day depends on, for the ordering check |
| Teacher-primary minutes | of 40 — the student-active split |

## 3. Trace columns

Modelled on the production sheet's English tab, columns AE–AN. Cell text is short
(`pg 2`, `open`, `v8`); the artefact URL is a **cell hyperlink**, not a
`=HYPERLINK()` formula.

| Stage | Column | Artefact |
|---|---|---|
| A | Page truth | `…/ict-k5/page-truth/<hash>/<book>/pg_NNN.json` |
| B | Segmentation | `…/segmentation/<hash>/<book>_full_segments…` |
| C | Enrichment | `…/enrichment/<hash>/<book>/…` |
| C-gate | Enrich gate | `…/enrichment/<hash>/…` |
| D0 | Slide script | `…/renders/<hash>/v8/<lesson>/_slide…` |
| D | Render meta | `…/renders/<hash>/v8/…/_render…` |
| E | Voicenote script | `…/renders/<hash>/v8/…/_voicenote.txt` |
| **J** | **Pedagogy review** | `…/_pedagogy_full.json` |
| **J** | **Design review** | `…/_design…` |
| F | LP (latest PDF) | `…/renders/<hash>/v8/<lesson>.pdf` |

### Reading the hyperlinks back

Hyperlinks are cell-level, so a FORMULA render returns plain text. Extract with:

```python
spreadsheets().get(
    includeGridData=True,
    fields="sheets.data.rowData.values(formattedValue,hyperlink,note,textFormatRuns)")
```

## 4. Review columns

Both reinstated from the original sheet, per Amena.

| Column | Contents |
|---|---|
| **J · Pedagogy review** | verdict badge + score; full `_pedagogy_full.json` as the cell hyperlink |
| **J · Design review** | verdict badge; `_design.json` as the cell hyperlink |
| **Human reviewer** | name — a person can overrule the machine verdict |
| **Review status** | and the overrule is visible, not buried |

A machine verdict that nobody can overturn is not a review.

## 5. Writing to the sheet

Drive MCP has no Sheets API and cannot edit cells. The write path is CSV import:

1. Build the CSV in Python. **Assert the column count** against the target before
   writing — a mismatched CSV silently shifts every column right of the error.
2. Save to `~/Desktop/`.
3. Import: File → Import → Upload → **Insert new sheet(s)**, then move rows from
   the staging tab.

Never paste pipe-delimited text; Sheets puts it all in one cell.

Service accounts **cannot create Drive files** (storageQuota 0). The sheet is
created by a human and shared; scripts only `batchUpdate` an existing file, and
must pass `supportsAllDrives=True` because the parent is a Shared Drive.

## 6. Row grammar on the sheet

Identical to [`segmentation.md`](segmentation.md) §2 — banners are matched by
label, never by row number, because humans edit this sheet and row indices move.
