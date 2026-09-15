# Lesson-plan format

Renderer is LP-HTML v8.1 (`curriculum-baked-lesson-plans/scripts/lp_html/`).
`lp_doc` JSON is the artefact of record; the PDF is a cache. Over the page cap
**FAILS** and is never silently trimmed.

---

## 1. The governing principle, made operational

> A lesson plan is not a script for the teacher. It is the instrument that puts
> students to work.

### 1.1 Move grammar

Every move names the student action first. The teacher action is the enabling
clause, not the subject.

```
[WE DO]  7 · 4 min
  Students: in pairs, blend ta-ma-tar aloud three times, then swap roles.
  Teacher: circulate, listen to four pairs, note who cannot segment.
```

**Lint:** a move with no `Students:` line fails. The one exception is `I DO`
modelling, where the student action is explicitly *watch and track*, and that must
still be written.

### 1.2 Time budget, printed

Teacher-talk-primary time **≤10 of 40 minutes** (I Do 8 + part of the warm-up).
The remaining 30 minutes are student-active. The split prints in the header so it
is visible to the teacher and checkable by a coach.

### 1.3 Required student-side elements

Each of these answers a specific RDF failure:

| Element | Required | Answers |
|---|---|---|
| Collaboration structure, named | 1 per LP, rotating | C9 Collaborative Learning 2.08/4 |
| Student-choice point | 1 per LP | C5 Student Agency 2.14/4 |
| Self or peer check inside the exit ticket | 1 per LP | C11 Self & Peer Assessment 1.53/4 |
| Taleemabad video mapped to the day's SLO | 1 per LP | C10 Tech Integration **1.02/4** |
| You Do in 3 named tiers | every LP | B6 Differentiation 1.65/4, 24% of all coaching |
| Every question printed with its answer, tagged to Bloom's level | every question | C1 Quality Questioning 2.01/4, 61% of all coaching |

Collaboration rotation: think-pair-share · turn-and-talk · pair-and-compare ·
numbered heads · peer check · gallery walk · jigsaw (G4–5 only). No structure
repeats on consecutive days within a chapter; the rotation is tracked on-sheet.

## 2. Structure

Same content structure as Grades 6–12:

```
SLO  ·  Warm-up + Opening  ·  I Do  ·  We Do  ·  You Do (3 tiers)
     ·  Exit check  ·  Coach corner
```

Warm-up is **focus then provocation**: settle attention, then a provocation that
activates prior knowledge and scaffolds the new concept. No partner recall.

## 3. Surface budget

| Surface | Pages | Contents |
|---|---:|---|
| Teach | 2 | The lesson: moves, minutes, questions with answers, the 3 You Do tiers |
| Support | 2 | Coach corner, full answer key, resources, video |

Total cap 4, unchanged from production. Pages 3–4 carry a banner: **not needed
during class.**

*Page-1 sufficiency was proposed and withdrawn.* We do not know what one page holds
at 12–15 moves with the progress strip, and asserting a number would force content
to be trimmed to it. Capacity is **open item O1**, resolved by rendering one real
day and measuring.

Measured word budgets on the existing G7 sample at teach 2 + support 2 give ~1,155
words total, of which 511 sit on the support page. Urdu runs ~⅔ of that (~750
words) because Nastaliq needs unitless `line-height ≥ 2.0`.

## 4. Reading strategies

A named strategy per LP, rotating, drawn from the science-of-reading progression.

**Pre-reading:** picture walk · cover-and-title prediction · 3–5 word vocabulary
preview · schema-activating question · setting a purpose for reading.

**During:** echo reading · choral reading · partner reading · teacher think-aloud ·
stop-and-ask (max 3 stops) · text marking.

**After:** retell with a frame · five-finger summary · question-answer relationship ·
draw-and-label · sequence sort.

G1–2 weight decoding (blend, segment, word chaining, decodable text). G3–5 weight
comprehension.

Two lint rules make this real rather than decorative:

1. **Relevance.** The pre-reading move must name the exact printed page *and* at
   least one word or image that actually appears on that day's pages. Page truth
   makes this machine-checkable, and it is what kills the generic "discuss the
   picture."
2. **Rotation.** No during-reading strategy repeats on consecutive days within a
   chapter. Tracked on-sheet.

## 5. Colour and text together

Moves are colour-coded **and** text-tagged, so the coding survives greyscale
photocopy, phone dark mode and colour blindness:

```
[WARM-UP]  [I DO]  [WE DO]  [YOU DO]  [EXIT]
```

The tag vocabulary must be the fidelity phase enum — not a third invention. Two
vocabularies currently exist in prod and disagree; that is `bd-z1cc6` and is fixed
before generation runs against it.

## 6. Chapter progress strip

The current G1–5 header carries the chapter's total LP count, coloured to the
current position with upcoming lessons alongside. **This stays, and stays visual.**
The Grades 6–12 text treatment is added on top of it, not in place of it.

## 7. Resources and video

Resources list only what a move actually calls for. The Grade 2 Maths defect —
resources named but never used, then claimed in a later lesson as having been used
— is a lint failure: a resource not referenced by any move fails.

Video is a **separate column in the Resources section**: title · link · SLO match ·
why it maps here. No QR code — the teacher reads the plan on the phone she would
have to scan with. Instead: a PDF link annotation with the video title as anchor
text, plus a short typeable numeric code (`VID 4127`) as fallback.

## 8. Answers and exit ticket

- **Every question carries its answer.** The textbook has ample practice questions;
  use them and add more where needed.
- **One exit ticket**, not three, and it contains the self/peer check.

## 9. Mobile

The plan is read on a phone. Usage data (59,601 plans, Jun–Sep 2026, Asia/Karachi):

| Block (PKT) | Plans | Share |
|---|---:|---:|
| 00:00–05:59 | 1,496 | 2.5% |
| 06:00–08:59 | 9,246 | 15.5% |
| **09:00–12:59** | **23,997** | **40.3%** |
| 13:00–16:59 | 9,525 | 16.0% |
| 17:00–23:59 | 15,337 | 25.7% |

Two reading modes, and the larger one is mid-school-day: the teacher pulls the plan
between periods, on her phone. The 390-px phone gate (`phone_gate.py`) is a hard
gate, not an advisory.

## 10. Diagrams

SVG only, sized by `requiredBox(svg, {minPx: 13.5, colPx})` — 727 px full width,
~360 px half-section. Illegible at full width is a lint **FAIL**, never a silent
shrink.

Visual Thinking Routines throughout: See–Think–Wonder, Zoom In, Claim–Support–
Question, Think–Puzzle–Explore. These are student-side by construction, which is
why they carry weight here.

## 11. No internal identifiers on a teacher-facing page

`lesson_id`, `book_stem` and `schema_version` live in the HTML `<head>`, the PDF
Info dictionary (`lib/pdfmeta.js`) and `<stem>.render.json`. Never on a page a
teacher reads.

## 12. Delivery

No WhatsApp delivery message for primary. The voice note carries that job — spec
and heart unchanged, see the main design §6.
