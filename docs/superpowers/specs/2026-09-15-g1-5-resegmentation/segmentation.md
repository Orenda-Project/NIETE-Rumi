# Stage B — Segmentation

One row = one teaching day = one segment = one lesson plan. Nothing else.

---

## 1. Inputs

| Input | Source |
|---|---|
| Page truth | Drive folder `13mODCsN0-hRjJuDgfonKgLwBEZyKvGuP`, one JSON per printed page |
| SLO index | Each chapter's printed *Explorer's Pathway* opener, transcribed verbatim |
| Prior segmentation | `1zpRop18Y1kNLbuYr31BU7B1qk_7DFy_LL9in1zTgtws` (read-only reference) |
| FDE syllabus breakdown | Drive folder `11AE926mNcQ-qbNE3Y1nGFwWuf8pFFN7Q` |
| Teaching calendar | Amena's calendar of activities |
| Video library | `1BVRPpq2-5XDxqRJs_JpIe6BqgZFCAx9OPeRkhDqrti0` |

## 2. Row grammar

Scripts match on the row label, never on a row number. The matrix is edited by
humans and row indices move.

```
^GRADE \d+              grade banner
^Chapter \d+:           chapter banner   (Urdu also has "Chapter 0: قاعدہ (Qaida)")
^Day \d+                teaching day     → segment N
↻ Spiral Review         formative spiral → seg 903+
📋 Ch. Review           chapter review   → seg 990s
```

A row is a teaching day **iff** its day label starts with `Day`. The
`lp_type == "content"` filter must not be used — it silently returned ≤1 segment
for 14 of 17 books.

## 3. Boundary rules

### 3.1 Rebuild (English G1–5, Maths G1–5)

Boundaries are derived from page truth, not inherited. A day boundary may fall
only where **all** hold:

1. **One SLO owned.** The day owns exactly one SLO from the chapter's Explorer's
   Pathway. No inheritance from a neighbour.
2. **No page overlap.** The day's printed page range is disjoint from the days
   either side. Shared pages are an error, not a convenience.
3. **One skill.** The topic string contains no `+`. A stapled topic splits.
4. **Fits 40 minutes.** The enriched move set for the day must sum to ≤40 min at
   the block budget in the main design §5. If it does not, the day splits again.
5. **Prerequisite order holds.** A day may not depend on a concept introduced
   later in the sequence. This is the rule that catches the Grade 2 Maths defect
   where the ordering lesson's warm-up claimed ordering was taught the day before,
   when the day before taught comparing.

Rule 5 is checked mechanically: each SLO carries its prerequisite SLO codes, and a
day whose prerequisites appear at a later day index fails.

### 3.2 Repair only (Urdu G1–5, Science G4–5)

Boundaries are **kept**. Only the day-integrity fields are repaired:

- SLO ownership — an inherited SLO is replaced with the day's own, transcribed
  from the printed opener.
- Page range — corrected to the day's actual pages.
- Topic string — stapled topics are labelled, not split (splitting would move a
  boundary).
- `duration_min` — replaced with a real move-derived budget.

Where repair reveals a boundary that cannot be made sound without moving it, the
day is flagged `needs_human_review` rather than moved.

**Gate:** Urdu Chapter 0 (قاعدہ) gets a read-only decoding-progression check
before this decision is frozen. If the progression is unsound it comes back to
Amena; it is not rebuilt silently.

## 4. Pedagogy constraints on the boundary

Segmentation is not a page-arithmetic exercise. Each subject carries a structure
the boundaries must respect.

### Maths — CPA

Every concept runs **Concrete → Pictorial → Abstract**. The current matrix has
collapsed this: G4 is 91 abstract / 8 pictorial / 0 concrete; G5 has 1 concrete
day in 129.

Rule: a concept that is new in the chapter gets a concrete day before its
pictorial day, and a pictorial day before its abstract day. Where the textbook
provides no concrete page, the concrete day is generated against the textbook's
worked example and labelled as a deviation (see §6). Multiplication in particular
gets the full sequence — grouping, array, then algorithm.

### English and Urdu — science of reading

Decoding progression is the spine for G1–2: phonemic awareness → letter-sound →
blending → decodable text → fluency. Comprehension strands lead in G3–5.

Rule: a decoding SLO may not precede the letter-sounds it requires. Reading
strategies rotate — see [`lp-format.md`](lp-format.md) §4.

### Science — 5E

Engage → Explore → Explain → Elaborate → Evaluate. The existing order is correct
in 18/18 chapters, which is why Science boundaries are kept. Repair must not
disturb the 5E order within a chapter.

## 5. Spiral review and chapter review

Formative, not summative — FDE assessments carry the summative load.

- **Spiral review (`↻`, seg 903+)** revisits SLOs from earlier chapters at a
  widening interval. Placed using the spare-day budget, never by displacing content.
- **Chapter review (`📋`, seg 990s)** closes a chapter against its own SLO set.

Grade 5 additionally receives Grade-9-style board preparation in Jan–Mar, SLO-based,
for the recalled Grade 5 board exams. Board prep sits after content completion and
consumes no December-window days.

## 6. FDE omissions

The FDE syllabus breakdown omits chapters and pages that the textbook contains.

**Omitted content stays omitted — and is labelled.** Every day carries a marker:

| Marker | Meaning |
|---|---|
| `In syllabus` | The day's pages appear in the FDE breakdown |
| `Omitted by FDE` | The day's pages are in the textbook but not the FDE breakdown |
| `Deviation` | We teach it anyway, or we generate content the textbook lacks — with a stated reason |

Nothing is silently deleted. A teacher who follows the FDE breakdown and a teacher
who follows the textbook both need to see which they are doing.

The marker is produced by a topic-level diff of the FDE breakdown against page
truth across all 17 in-scope books.

## 7. Calendar budget

All content lands on or before **2026-12-24**. 144 calendar slots remain in the
window against 523 spare days across the in-scope books, so the budget is not
binding except in Urdu G1 (+2 spare) and Urdu G5 (+4 spare) — neither of which is
being expanded.

Three gazetted holidays inside the window are removed from the slot count:
**1 May, 14 Aug, 25 Aug**.

Jan–Mar carries revision and Grade 5 board prep.

## 8. Output

One CSV per book, imported to the target sheet as a staging tab. Columns are
specified in [`sheet.md`](sheet.md). Column count is asserted before write.

Stage B emits a segmentation artefact per book to R2 and writes its hyperlink into
trace column **B** on the sheet.

## 9. Known parsing gotchas

Recorded because both have already cost a rebuild:

- **Grade is column 0 and is blank on continuation rows.** Subject is always
  column 1; day cells start at column 2. The month banner is row index 2 and day
  numbers are row index 3.
- **The Urdu tab has a different trace-column order** from English, and uses the
  render prefix `v8u` rather than `v8`.
