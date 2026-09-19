# Slice 7 — LP production (Grades 1–5, HTML profile)

**Parent:** [00-program.md](00-program.md) · **Sibling:** [01-format.md](01-format.md)

The operator's instruction:

> *"we need to reduce the script within the LP, we need to write a spec for LP
> production so that the agents can wholescale produce these"*

This file is that spec. It exists so an agent can author a primary lesson
without asking anyone what "good" looks like: a fixed section order, a measured
word budget per surface, and one conformance check that fails loudly.

Everything below is measured on the 38-lesson Grade 4 Chapter 9 corpus
(English, Maths, Urdu, Science), not estimated.

---

## 1. The finding that reshapes the ask

"Reduce the script" reads as a renderer problem. It is not. Three render-time
levers were measured and all three fail:

| Lever | Measured result |
|---|---|
| Parse the script into turns (`d0_script.py`) | Reduces SCAN cost, not height. Its own docblock: *"Reduction is SCAN cost, not word count."* |
| Replace prose with diagrams | **Makes page count worse.** A diagram costs **10.6 px/word**; prose costs **6.35**. The three diagrams on G4 English Day 6 re-homed 206 words into 2,187px where prose would have cost ~1,300px — **+887px, about half a phone page.** |
| Tighten the CSS | Recovers ~103px phone / 65px A4 per lesson — **under 1%.** |

And the call-and-response script — the surface the phrase "the script" most
naturally points at — is **10 rows, 944px phone / 618px A4: 6% of the lesson.**
Deleting all of it would not save one page.

**Under "no word may be deleted", the only lever is authoring fewer words
before they exist.** So the budget is an *authoring-brief* number enforced at
Stage C, not a renderer rule. The renderer's job stays what it already is:
over cap fails, it never trims.

---

## 2. Where the words actually are

Median lesson: **1,519 words** across nine surfaces (p75 1,680 · p90 1,998 ·
max 2,253).

| Surface | median | p90 | max | share |
|---|---:|---:|---:|---:|
| `practice` | 301 | 673 | **915** | 21% |
| `faded_example` (We Do) | 290 | 352 | 472 | 20% |
| `worked_example` (I Do) | 238 | 346 | 472 | 17% |
| **`key_points`** | **219** | **342** | **382** | **15%** |
| `ask` | 113 | 165 | 171 | 8% |
| `board` | 78 | 119 | 181 | 5% |
| `exit_ticket` | 78 | 120 | 153 | 5% |
| `keywords` | 69 | 110 | 128 | 5% |
| `warmup` | 52 | 91 | 143 | 4% |

Two facts govern the budget:

**(a) 85% of the lesson is teaching script and pupil task.** Only `key_points`
— prose *about* the lesson rather than words the teacher says or the child does
— is packaging, and it is 15%.

**(b) `practice` carries the variance.** Its p90 is **3× its median**. Every
other surface sits within ~1.5×. A budget that does nothing else but cap
`practice`'s tail removes most of the spread between a 5-page lesson and a
10-page one.

`key_points` concentrates in one place: **5,710 of its 8,762 corpus words are in
`activity`** (n=38, median 148/block, max 273), against 1,699 in `homework` and
1,353 in `introduction`. The activity section is where the text dump lives.

---

## 3. The page arithmetic, stated honestly

Measured on the G4 English Day 6 render: **216 source-words per phone page**,
**133 per A4 page** (1,725 words → 8 phone / 13 A4 teach pages).

| Cap | Words allowed | Lessons passing |
|---|---:|---:|
| **4 phone pages** (the standing ask) | 862 | **0 / 38** |
| 5 phone pages | 1,078 | 0 / 38 |
| 6 phone pages | 1,293 | 7 / 38 |
| 7 phone pages | 1,509 | 18 / 38 |

**The 4-page cap is not reachable at 21px with no words deleted.** The median
lesson needs 7 phone / 11 A4 pages. Reaching 4 would mean deleting 43% of every
lesson — which is not tightening, it is cutting teaching.

This is why the primary cap already stands at 9 (raised 4 → 9 by the operator).
The spec does not re-open that; it aims at the band the evidence favours.

---

## 4. The budget

Three candidates were costed against the corpus. Each caps a surface; a lesson
over a cap is returned to its author, never auto-trimmed.

| | Caps | median | p90 | phone pages (med → p90) | touches script? |
|---|---|---:|---:|---|---|
| A | key_points 150, practice 420 | 1,393 | 1,703 | 6.5 → 7.9 | no |
| **B** | **key_points 120, practice 350** | **1,331** | **1,627** | **6.2 → 7.5** | **no** |
| C | B + worked 300, faded 300 | 1,266 | 1,442 | 5.9 → 6.7 | **yes** |

**DECIDED: B** (operator, 2026-09-18). It lands both the median and the p90
lesson inside the **5–8 page band**, and does so by cutting **zero words of
teaching script** —
120 words off `key_points` (prose about the lesson) and a cap on `practice`'s
tail. C buys 0.3 of a page more by cutting I-Do and We-Do, which is the one
thing the primary field evidence says not to do (§6).

Under B: 38/38 lessons need an edit; the median edit sheds 147 words; the worst
single lesson sheds 651.

**Big Idea is the one surface that ADDS words** (§5). Re-costed with it in:

| | median | p90 |
|---|---|---|
| B alone | 1,331w · 6.2 phone pp | 1,627w · 7.5 pp |
| **B + Big Idea at 80** | **1,411w · 6.5 pp** | **1,707w · 7.9 pp** |
| B + Big Idea at 100 | 1,431w · 6.6 pp | 1,727w · **8.0 pp** — out of band |

So the 80-word cap is load-bearing. The median lesson lands at 6.5 phone /
10.6 A4 pages and the p90 at 7.9 — the whole corpus stays inside 5–8.

### The budget table (the law)

| Surface | Cap | Rule |
|---|---:|---|
| `key_points` | **120** per lesson | Across all sections. It is the one packaging surface; it earns its place or it goes. |
| `practice` | **350** per lesson | The variance carrier. Over cap = split across days, not compressed. |
| **`big_idea`** | **80** | New surface (§5). Three short paragraphs. 80 is not a style choice: at 100 the p90 lesson tips out of the 5–8 page band. |
| `worked_example` | 470 | A ceiling on the outlier, not a target. Median 238 passes untouched. |
| `faded_example` | 470 | As above. |
| `ask` · `warmup` · `board` · `keywords` · `exit_ticket` | uncapped | Each already sits inside 1.5× its median. A cap here would police noise. |

Uncapped is deliberate. A budget that names every surface reads as a
compression target for all of them; these five are already tight, and the
brief should say so.

---

## 5. The section registry

The printed order for the primary HTML profile. One table, read by the builder
and by the conformance test — never two lists that can drift apart. Modelled on
`kieai-prompt-builder.service.js`'s `SECTION_REGISTRY`, which is the same
pattern on the image path.

| # | Surface | Page | Source | Role |
|---|---|---|---|---|
| 1 | Header + day rail | 1 | `provenance`, `sequence` | identity |
| 2 | Journey / Today / Coming up | 1 | `sequence` | orientation |
| 3 | Learning outcome | 1 | `slo`, `objectives.outcome` | objective |
| 4 | To prepare | 1 | `materials` | set-up |
| 5 | Video resource | 1 | media map | set-up |
| 6 | Key words | 1 | `keywords` block | vocabulary |
| 7 | **Write on the board** | 2 (first atom) | `board` block, hoisted | board-work |
| 8 | Opening — warm-up then hook | 2 | `warmup`, `introduction` | settle → activate |
| 9 | Explanation header | 2 | — | section opener |
| 10 | **The Big Idea** | 2 | `big_idea` block | pedagogical heart |
| 11 | **I DO**, closing on its own check | 2+ | `worked_example` + `.cfu` | gradual release |
| 12 | Key fact · Watch for this slip | 2+ | `objectives.outcome`, `misconception_preempt` | teaching aids |
| 13 | **WE DO** | — | `faded_example` | gradual release |
| 14 | Practice — **YOU DO** | — | `practice` | gradual release |
| 15 | **Remember** | close | `key_points` id `remember` | consolidation |
| 16 | Exit ticket (exactly one) | close | `exit_ticket` | assessment |
| 17 | Homework · Coaching corner | close | `homework`, `page2` | close |

Invariants:

- **REMEMBER prints above the exit ticket, not after homework.** The operator's
  sentence listed it last; `after(s)` appends a section's extras AFTER its blocks,
  so a `key_points` block in `conclusion` necessarily precedes `exit_ticket`.
  Printing it later means moving it to its own section, which is hers to call.
- **The worked example carries the check.** `cfuExplain` has ONE home and it is the
  `worked_example.cfu` field (§3.29); it is not also seated as an `ask` block in the
  close, or the teacher meets the same question twice.
- **One exit ticket**, not three — already held by
  `test_exactly_one_exit_ticket`.
- **The board is one atom and never splits.** It opens page 2 whole. Forcing it
  onto page 1 needs 433px (phone) / 602px (A4) that do not exist; the operator
  costed this and chose to leave it.
- **Three anchored diagram slots** — hook, explanation, practice — and a
  diagram **replaces** the prose it illustrates (`d0_diagram.py`). Given §1,
  diagrams are for comprehension, **not** for page reduction. Do not add one
  expecting to save a page.
- **Dark stages stay dark.** A missing source prints `design pending`.

### The Big Idea surface (decided 2026-09-18)

kie.ai gives `bigIdea` (`role: 'pedagogical-heart'`) ~22% of its page 1. The
HTML profile had no equivalent: **Key fact** carried one line of it and **Watch
for this slip** carried the misconception, so two thirds existed scattered and
the distinction paragraph existed nowhere.

**It gets its own surface, on page 2, opening the EXPLANATION section** — ahead
of I Do, because it is what the teacher needs to understand before modelling.
Three short paragraphs, kie.ai's shape, **80 words total** (§4):

1. **The distinction the textbook does not make explicit** — what pupils confuse.
2. **The common misconception** — what they will get wrong, and why.
3. **The demo move** — one sentence on how to teach the distinction today.

This is the surface that answers the primary field complaint in §6 directly:
*"there used to be an explanation script of exactly what to say and what to
explain."* Paragraph 3 is that script, at its smallest useful size.

**Do not also print it in Key fact.** ONE HOME PER SOURCE FIELD: Key fact stays
the one-line outcome, Watch for this slip stays the in-the-moment error cue, and
the Big Idea is the teaching behind both. If paragraph 2 and Watch for this slip
say the same thing, the block is over budget and one of them is wrong.

---

## 6. The tension this spec does not resolve

The budget number is a pedagogy trade, and the evidence on it is split.

**For primary, the field log says more script, not less:**

> *"there used to be an explanation script of exactly what to say and what to
> explain. Now, basically just the book's content has been written and sent,
> which is already present in the book."*

**For 6–12, the ship data says shorter wins,** monotonically. The 2026-09-13
release cut median pages 14 → 6:

| Length | Satisfaction | n |
|---|---:|---:|
| 15+ pages | 72.4% | 105 |
| 9–14 pages | 83.2% | 202 |
| 5–8 pages (v9.6) | **92.7%** | 137 |

Whether the "more script" finding scopes to grades 1–5 is recorded as **not
resolved**.

**Budget B — the one taken — is written to need that question answered as late
as possible.** It
cuts only packaging and the practice tail, so it moves the lesson into the
5–8 band *without* spending any of the teaching script the primary teachers
asked for. The two findings are only in tension if the budget reaches into
I Do and We Do — which is exactly what candidate C does, and why C is not
recommended.

**Settled 2026-09-18: B.** C stays on the page as the costed alternative, so
that if the 6–12 result is later judged to carry over to primary the next step
is a number change and not a re-measurement.

---

## 7. Conformance

The budget is enforced the way everything else here is: a check that fails.

- One check at Stage C, before D0, reading the same table in §4.
- **Over cap fails; it never trims.** A lesson over budget is returned to its
  author with the surface named and the overage in words.
- The check reports per-surface, not per-lesson-total — "you are 200 words
  over" is not actionable; "practice is 200 over" is.
- It is additive and gated on grade 1–5, read off `provenance.grade`. G6–12 is
  untouched by construction.

---

## 8. What an agent producing a lesson does

1. Author from page truth into the section registry of §5, in that order.
2. Keep every surface inside §4. The caps are named in render surfaces and
   you write body fields — `08-authoring-budget.md` is that table translated,
   and it is measured against the renderer rather than restated. If `practice`
   runs over, **split it across days** — do not compress it.
3. Write the **Big Idea** before I Do, not after — if you cannot name the
   distinction pupils confuse, the lesson is not ready to model. 80 words.
4. `key_points` is the tightest cap and you never write it directly: it is
   fed by `hookStory`, `hookCharacters`, the You-Do steps and `homework`, and
   `remember` has already spent 10 of its 120 words on a placeholder. Write
   those four last, and only for what no other surface already says. It is the
   first thing over budget in 35 of 38 corpus lessons (§08).
5. Do not reach for a diagram to save space (§1).
6. Leave an absent source dark. Never invent a proxy.
