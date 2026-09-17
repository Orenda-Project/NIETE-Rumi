# Slice 1 — Format

**Parent:** [00-program.md](00-program.md) · **Builds last, locks last, argued first.**

The governing sentence, from the operator:

> *"LPs shouldn't be teacher-led artifacts, it should help facilitate student
> engagement and collaboration."*

Everything below is downstream of that. A move that only the teacher performs
has to earn its place; a move that puts children in pairs, at the board, or on
a routine does not.

---

## The problem being solved

The current Grade 1–5 plan is four pages, teachers are groaning, and the plans
do not fit in forty minutes. The instruction is *not* to make it shorter — it is
to keep the four pages and make them readable:

> *"currently the primary LPs sit at 4 pages and teachers are groaning, if we
> keep the same 4 pages cap but increase the readability and keep only relevant
> info, say what?"*

So: **same cap, less text, more structure, more picture.** The page budget is
not the enemy; undifferentiated prose is.

---

## The shape of one plan

Same content structure as Grades 6–12, because a teacher who moves between
sections should not relearn the artefact:

| Section | Pages | What it carries |
|---|---|---|
| **Header** | ¼ | Grade · subject · chapter · day · SLO · the visual chapter progress strip |
| **Warm-up + Opening** | ¼ | Focus, then provocation. Activates prior knowledge, scaffolds the new concept |
| **Teach — I Do / We Do / You Do** | **2** | The lesson. Colour-and-text-coded moves |
| **You Do differentiation** | ½ | Support / core / stretch, on the same task |
| **Exit check** | ¼ | **One** exit ticket |
| **Coach corner** | ¼ | What a coach would look for; what usually goes wrong here |
| **Resources** | ¼ | Materials · **video as its own column** · textbook page references |

**Total: 4 pages, 2 of them Teach.** Over cap FAILS the render; it never trims.

### Warm-up: what changed

- **Partner recall is removed.** It became a ritual that recalled nothing.
- Warm-up now does two jobs in sequence: **focus** (get thirty children looking
  at one thing) then **provocation** (an opening that activates prior knowledge
  and scaffolds toward today's concept).
- **Pre-reading must be relevant to this text**, not a generic prediction
  routine bolted onto every reading day.

---

## Moves: 10–15, colour-coded *and* text-formatted

The extraction spec sets move-level granularity at **~10–15 per lesson**
(`curriculum-baked-lesson-plans/reference/fidelity-extraction.md:28`) — moves at
the level a teacher can paraphrase and a coach can still recognise, not atomic
utterances. That is the range the plan is authored to, and the range fidelity is
scored against.

**Colour alone is not enough.** The instruction is explicit: *"make sure the
moves that are colour coded are text formatted too."* A colour that survives a
cheap phone screen, a photocopy or a colour-blind reader is not a colour — it is
a colour **plus** a label plus a weight. Every move therefore carries three
redundant signals:

| Move type | Colour | Text marker | Weight |
|---|---|---|---|
| Teacher models | teal | `I DO` | bold label, regular body |
| Guided together | amber | `WE DO` | bold label, regular body |
| Children work | violet | `YOU DO` | bold label, regular body |
| Check for understanding | grey rule | `CHECK` | small caps |
| Visual Thinking Routine | outlined box | `SEE · THINK · WONDER` (or the named routine) | boxed |

Palette is taken from the DC work so the two artefacts agree.

### Visual Thinking Routines

Plenty of them, named on the page, not implied. A VTR is the cheapest
collaboration device we have in a class of fifty with no materials: it needs a
picture, a question and two minutes. Where a day has a diagram, the default is
that the diagram carries a routine rather than sitting there as decoration.

---

## Answers, questions and the exit ticket

- **Every question gets its answer.** No exceptions, in any section. The
  textbook already contains ample practice — use it, cite the page, and add more
  only where the book is thin.
- **One exit ticket, not three.** The prior format offered three options for the
  teacher to choose from, which is why the page showed three; the fidelity
  extractor already collapses that to a single `choose_one` move
  (`fidelity-extraction.md:36`). The page now shows what the extractor always
  counted: **one**.

---

## The chapter progress strip

The current Grade 1–5 header carries the count of lesson plans in the chapter,
coloured to show where the teacher is and what is coming. That behaviour is
right and stays — but rendered the way Grades 6–12 render it, **as a visual
rather than as a sentence**:

```
Chapter 4 · Day 3 of 7
  ▓▓▓░░░░      ← done · today · upcoming
```

Same information, one line instead of three, and legible at arm's length on a
phone.

---

## Diagrams

- **SVG**, not raster. They scale on a phone, they print, and they are
  diffable when a defect is filed against one.
- A diagram is on the page because it teaches something the text cannot.
  Decorative diagrams cost page budget that the Teach section needs.
- **Maths diagram integrity is not negotiable.** The defect report that started
  this work — *"All images of place values are different. Like different shapes
  all over the LP. Numbers shown are also obviously wrong"* — is a place-value
  representation that changed shape three times inside one plan and showed wrong
  digits. One representation per concept per chapter, and the arithmetic is
  re-derived by script, not authored by hand.

---

## Mobile-first, because that is where it is read

MCP data puts peak use at 9am–1pm — she reads it before class, on the phone.

- **QR code plus title is rejected.** She is reading the plan on the phone she
  would have to scan with. Links go in the Resources column as tappable text.
- Type, spacing and colour are set for a phone screen first and a printout
  second.
- Less text per screen; more headings that say what to do with what follows.
  The instruction was *"more explanations of what the heading and where to pull
  it or why"* — headings carry provenance, not just labels.

---

## Forty minutes

The plans do not currently fit the period. This is a **hard constraint on
authoring**, not a note in the margin:

- Each move carries a minute budget; the sum of the move budgets must land
  inside 40 minutes with slack for a real class starting late.
- The independent-work move carries the time-on-task sample point
  (`fidelity-extraction.md:37`).
- A plan whose budget exceeds 40 minutes is a plan that failed, in the same way
  a plan over 4 pages failed.

---

## Review, in the sheet

Both reviews are columns in the workbook, as they were in the original:

- **Pedagogy review** — does the day teach the SLO it claims, with methods that
  work in a large low-resource class?
- **Design review** — does it render inside the cap, at readable size, with the
  colour *and* text coding intact?

Trace columns follow the previous sheet's English tab, **AE–AN**: one column per
pipeline stage (A, B, C, C-gate, D0, D, E, J-ped, J-des, F), so any row can be
read back to the stage that produced it.

---

## Gate O1 — sample before locking

The page budget above is a proposal until it is measured. The operator's words:
*"i dont know how much 1 page can hold, we would need to sample it first."*

**O1 renders four real days** — one Maths, one Urdu, one English, one Science —
each at 10 moves and at 15 moves, with the progress strip, diagrams and answers
in place. It reports, per render: pages used, Teach pages used, minutes
budgeted, and what had to come off to fit.

Until O1 returns numbers, this file describes an intent. After O1, the numbers
in it are either confirmed or corrected — and if 15 moves does not fit in 4
pages, the honest outcome is to say so and take the question back, not to shrink
the type.
