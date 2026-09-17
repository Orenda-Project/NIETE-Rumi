> ## ⚠️ THIS RESULT IS SUPERSEDED — re-measure before citing it
>
> **Written 2026-09-16, invalidated the same day.** Every number below was measured on a
> render that printed **34% of its text twice** — the SLO four times, the key fact four
> times, the exit ticket three. That was a bug in the D0 transform, not a property of
> primary content, and §6's three options are all framed on it. **Do not act on §6.**
>
> After four fixes in `d0_primary.py` / `d0_blocks.py` — the SLO removed from the
> objectives slot, `look_for` dropped (it was the exit criteria, printed twice in 30 of 38
> lessons), `workedExample` deduped line-by-line against the move scripts, and
> `hookCharacters` deduped line-by-line against `hookStory` — the same 38 lessons measure:
>
> | | this file says | actually | 
> |---|---|---|
> | within page cap | 4/38 | **23/38** |
> | median total pages | 16 | **11** |
> | duplicated text (median) | — | **1%** (was 34%) |
> | lessons printing nothing twice | — | **16/38** |
>
> And the residual is a **packing** problem, not a content problem: across 423 rendered
> pages mean fill is 77%, 23% of the paper is whitespace, and over-cap lessons fill *worse*
> (75%) than within-cap ones. `blockAtoms()` splits only `practice`; `faded_example` /
> `worked_example` / `paragraph` are one atom at any height and 103 of them exceed 900
> chars. Repacked at 95% fill the same words give **34/38**, with only four lessons
> genuinely over. See `bd-uj7br` (re-framed) and `bd-3w7nv` (the packing fix).
>
> The conclusion "80% of teaching text must go" is **wrong** and was never true.

# Gate O1 — result

**Measured 2026-09-16.** Sample: Grade 4, Chapter 9, **all four core subjects at once** —
English "The Dancing Poem" (10 days), Urdu "قدیم تہذیبیں" (8), Maths "Time Travelers'
Challenge" (11), Science "Do It Yourself" (9). **n = 38 lessons**, every one authored fresh
from page truth, transformed to `lp_doc` v3.0, and rendered through the **production v9
renderer** — the same `render_lp.js` that serves G6-12. Not a projection.

`01-format.md` said: *"Until O1 returns numbers, this file describes an intent. After O1, the
numbers in it are either confirmed or corrected — and if 15 moves does not fit in 4 pages, the
honest outcome is to say so and take the question back, not to shrink the type."*

**O1 corrects the intent. The 4-page budget does not survive contact with the corpus.**

---

## 1. The numbers

| subject | n | teach med | teach max | cap | support med | cap | within cap | total med |
|---|---|---|---|---|---|---|---|---|
| English | 10 | 10.5 | 14 | 7 | 6.0 | 6 | 0/10 | 16 |
| Urdu    |  8 | 10.5 | 12 | 9 | 6.0 | 7 | 2/8  | 17 |
| Maths   | 11 | 10.0 | 14 | 7 | 7.0 | 6 | 2/11 | 16 |
| Science |  9 | 10.0 | 14 | 7 | 6.0 | 6 | 0/9  | 16 |

**4 of 38 fit — 11%.** All four sit *exactly at* cap; none is under it. Median total is
**16 pages against a proposed 4**, i.e. **4× over**.

Three things make this a hard result rather than a tuning problem:

- **Every render is already at the 21px body floor.** The type cannot give. The renderer
  shrinks to the floor and then fails; it never trims. There is no slack left to find.
- **The only failure kind is PAGE COUNT — 34 of 38.** The documents are otherwise schema-clean
  and lint-clean against the live v9 schema. Nothing else is wrong with them.
- **The minutes budget holds.** 0 of 38 exceed their period (budgeted median 31 min against
  periods of 25/30/35). The lesson fits the class. It does not fit the paper.

## 2. The amplifier: the corpus supplies 3 moves, not 15

O1 was specified to sample each day **at 10 moves and at 15 moves**. It could not: the Stage-C
enrichment carries **exactly 3 teaching steps in all 38 lessons** — one I-Do, one We-Do, one
You-Do. Min 3, median 3, max 3, no exceptions.

So the 10-page median above is what **three** moves produces. The question the gate was built
to ask — does 15 moves fit in 4 pages — is answered a fortiori: 3 moves already needs 10.

It also means the overflow is **not** coming from move count. It comes from everything around
the moves.

## 3. Where the pages actually go

Measured rate at the 21px floor: **~190 words per teach page, ~147 per support page.**

| teach section | median words | | support (page 2) | median words |
|---|---|---|---|---|
| activity (We Do · You Do) | **902** | | model_answers | **380** |
| development (I Do)        | 414 | | differentiation | 169 |
| conclusion                | 272 | | board_final | 108 |
| introduction              | 253 | | homework_key | 76 |
| homework                  |  44 | | coaching (reflection + look-for) | 92 |
| **teach total**           | **1,923** | | **support total** | **899** |

Against that rate, the spec's budget buys:

- **2 teach pages ≈ 380 words.** The corpus supplies 1,923 — **5.1× over.**
- **2 support pages ≈ 294 words.** The corpus supplies 899 — **3.1× over.**

To reach 2 teach pages, **80% of the teaching text would have to go** (1,543 of 1,923 words).
That is not an edit. That is a different document.

One section dominates: **`activity` alone is 902 words — 2.4× the entire 2-page teach budget.**
That is We-Do plus You-Do plus the partner frames plus the problems plus support/extension.

## 4. What cap the corpus actually needs

| cap (teach/support) | fits |
|---|---|
| 7 / 6 (today's EN cap)  | 2/38 |
| 10 / 7 | 20/38 |
| 12 / 8 | 34/38 |
| **14 / 10** | **38/38** |

Urdu on its own clears at 12/8 (8/8). English needs 14/10 for the full set.

## 5. Two corpus gaps, surfaced not proxied

Per *dark stages stay dark*, both print `design pending` on the page rather than a substitute:

- **`mistakes`** — nothing in primary Stage-C carries misconceptions except
  `subject_elements.misconception_preempt`, present in **13 of 38** segments. The other 25 print
  the gap.
- **`exam_bank`** — primary has no exam surface at all. It stays empty by design; G1-5 has no
  FBISE board.

These are enrichment gaps, not render gaps. Fixing them is a Stage-C change.

## 6. The decision this hands back

The teacher's ask was *"keep the same 4 pages cap but increase the readability and keep only
relevant info"*. O1 says those two halves are in conflict at the current content volume: at
readable type, 4 pages holds ~670 words, and a primary lesson as currently enriched is ~2,800.

The trade is real and it belongs to the operator, not to the renderer:

**(a) Raise the cap to what the content needs** — 14/10, or 12/8 if Urdu-first. Honest to the
corpus, but it hands teachers a longer document than the one they were already groaning at.

**(b) Cut content to the cap** — 80% of teaching text. That means deciding what a primary LP
stops carrying: most likely the partner frames, the problem bank, and model answers. A
pedagogy decision, not a formatting one.

**(c) Split the artefact** — a 4-page teach document the teacher holds in class, with the
model answers, differentiation and coaching notes moving to a separate reference. The 4-page
promise survives; the content survives; there are two files instead of one.

Nothing downstream — the primary renderer profile, the sheet writes — should proceed until
this is settled, because all of it is sized by the answer.
