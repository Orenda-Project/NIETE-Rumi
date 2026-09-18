# `bot/vendor/lp-v9` — what this is, where it came from, and how to re-vendor it

This directory is a **vendored copy** of the grades 6–12 lesson-plan pipeline (`lp_v9`): the
authoring brief, the two `lp_doc` JSON schemas, the deterministic lint that is the gate of
record, the HTML→PDF renderer, its support library, the diagram-as-code engine and the four
embeddable font faces.

It is **not** an npm dependency and **not** a git submodule. It is a copy, taken by hand, and
the copy has **deliberate divergences** from upstream — every one of them is listed in §3. The
rule that keeps this honest: *if you change a vendored file for any reason other than a straight
re-vendor, the change gets an entry in §3 and a `VENDOR DIVERGENCE` comment at the site.*

---

## 1 · Upstream source

The pipeline lives in the operator workspace, inside the `curriculum-baked-lesson-plans` skill,
outside this repo and not in this repo's git history:

```
<workspace>/.claude/skills/curriculum-baked-lesson-plans/scripts/
```

| Vendored here | Upstream path (relative to that `scripts/` dir) |
|---|---|
| `lint_lp.js` | `lp_html/lint_lp.js` |
| `visual_check.js` | `lp_html/visual_check.js` |
| `render_lp.js` | `lp_html/render_lp.js` |
| `lib/*.js`, `lib/clean_figure.py` | `lp_html/lib/` |
| `schema/lp_doc.schema.json` | `lp_html/schema/lp_doc.schema.json` (v3.0 — current) |
| `schema/lp_doc.v2.schema.json` | `lp_html/schema/lp_doc.v2.schema.json` (v2.0 — frozen) |
| `diagrams/index.js`, `diagrams/lib/*.js`, `diagrams/types/*.js`, `diagrams/types_manifest.json`, `diagrams/assets/*` | `lp_html/diagrams/` |
| `brief_author_v3.md` | `lp_author/brief_author_v3.md` |
| `brief_author_v3_flash_{maths,sci,prose}.md` | `lp_author/brief_author_v3_flash_{maths,sci,prose}.md` |
| `fonts/Inter-{Regular,SemiBold,Bold}.ttf` | workspace `06_Logs & Misc/Reports/Active/Tanzania Expansion/02_Coaching_MEWAKA/mewaka-sample-report/` |
| `fonts/NotoNastaliqUrdu.ttf` | workspace `02_Main Rumi Bot/fonts/` |

> **Divergence-local edit 2026-09-13 (bd-mn5tt): `visual_check.js` — `DIAGRAM_TYPES` and `CANON`
> gain the early-years eight.** NOT a re-vendor: nothing was copied from upstream, and
> `lp_author/visual_check.py` upstream does not yet carry these entries, so the "change one, change
> both" parity this table asserts for `visual_check.js` is **temporarily one-sided in the vendored
> copy's favour**. Push the same eight families up when the authoring lane next re-syncs; until
> then the 62-document parity replay will differ on any document carrying a grade 1-5 figure, and
> the vendored copy is the correct half.
>
> **What changed.** `clock`, `compare_size`, `count_frame`, `count_objects`, `match`, `money`,
> `pattern` and `word_blank` — plus their 24 aliases — are now legal to V5, with the matching
> `CANON` alias→family rows every other family already had.
>
> **Why.** The eight landed in `diagrams/types_manifest.json` with the grade 1-5 picture question
> (`0cb5ab39`, the quiz lane) and reached this table never. The manifest's own `$comment` says
> anything consuming the type list checks itself against that file; V5 was the consumer that did
> not. Until this edit the checker **rejected as an unknown type a figure the engine draws
> happily** — a hard fail on a document that is not wrong. `tests/lp612/visual-contract.test.js`
> asserts the two rosters equal in both directions and was red on exactly this.
>
> **What this is NOT.** It is not the 6-12 author roster widening. V5 accepts; it does not
> re-litigate the grade. That is the rule `bot/shared/services/quiz/transcript-quiz-figure.js`
> already states — its `ALLOWED_TYPES` carries all 28 while its author-facing `CORE_TYPES` carries
> the 6-12 twenty — and the four `brief_author_v3*.md` files here stay on the 6-12 twenty
> accordingly (guarded by `tests/lp612/brief-field-coverage.test.js`). A grade 9 chemistry quiz has
> no use for a ten-frame, and eight unreachable shapes in the brief cost tokens on every author
> call.

> **Partial re-vendor 2026-09-06 (bd-mg9c7.49, TQ-R4 lane D): `diagrams/types/fraction_bar.js`
> and `diagrams/types_manifest.json` (the `fraction_bar` entry only).** Fixed upstream first
> (`.claude/skills/curriculum-baked-lesson-plans/scripts/lp_html/diagrams/`), then copied
> byte-for-byte; `diff` against the upstream copy is empty for both files. **No new §3
> divergence.**
>
> **What changed.** `fraction_bar` gains a third mode, `model: "circle"` — n equal sectors of a
> disc, k shaded, same `bars[].parts`/`shaded`/`label`/`value`/`color` tokens the bar modes already
> use (`shadedSet()` is reused verbatim). Sectors start at 12 o'clock and sweep clockwise (`en`) or
> anticlockwise (`ur`); every circle in one spec shares one radius, the bar mode's shared-width rule
> carried into a disc; `parts: 1` draws a whole disc with no radius line; a label and the k/n
> readout sit centred under each circle. Why: a teacher taught proper fractions with a roti — a
> circle cut into four, one part shaded — and the engine only had bars, so the delivered picture was
> a four-part bar with the word "circle" written beside it to paper over the mismatch.
> `types_manifest.json`'s `fraction_bar` entry gains the mode in its `for` line and a `limits` line
> naming all three modes.
>
> Tests: `tests/quiz/transcript-quiz-figure-circle.test.js` (new, root suite), through the quiz
> lane's own `renderFigureSvg` entry point rather than the engine directly, so a red run proves the
> **vendored** copy is what changed. Red confirmed by temporarily restoring the pre-patch vendored
> file and re-running (3 of 7 assertions fail — the circle-specific ones; the other 4 pass
> trivially because an unrecognised `model` falls through to the ordinary bar render, which is
> itself evidence the fallback is silent rather than a hard error). Green after re-applying the
> patch. `checkOverlaps` and `checkDegenerate` are both asserted zero-rows on every circle case.
>
> **Not touched**: `bot/shared/services/quiz/` (another lane's files at the time of this change).

> **Partial re-vendor 2026-09-05 (bd-vnyuw + bd-c3le6): `lint_lp.js`, `render_lp.js` and
> `lib/template.js`.** Fixed upstream first, in both homes, and the SAME patch applied to each
> rather than the file overwritten (`render_lp.js` and `lib/template.js` carry pre-existing
> divergences — see §3 — and `lint_lp.js` still carries upstream's 21-line BUDGET-policy header
> that this copy does not, exactly as the bd-gel97 note below records). **No new §3 divergence:
> the three added regions are byte-identical in both homes.** A fourth file is upstream-only:
> `lp_author/author_lp.py` carried the identical language directive and is fixed there too.
>
> **bd-vnyuw — the Urdu toggle had never once fired.** Measured on the staging ledger: of the
> nine English-medium books ever requested in Urdu, ALL SIX that reached `ready` carry
> `overlay_dropped = true`. Every one. A teacher who chose «اردو» received an English lesson under
> Urdu headings, silently, with no error at any layer.
>
> The cause was two prompts in one call giving opposite orders. The SYSTEM prompt
> (`brief_author_v3.md` §7b, §7c.7) says of an English-medium book *"Then add an `ur_overlay` …
> overlay EVERY instruction string you are allowed to"*. The USER prompt — `languageDirective`
> in `lp612-author.service.js` here, `author_lp.py:827` upstream — said *"the Urdu toggle is built
> by a separate pass over the finished document. Do NOT emit ur_overlay yourself."* **That separate
> pass does not exist in either home.** A repo-wide grep for `ur_overlay` finds only readers:
> `applyOverlay`, `lint`, `visual_check`, and `sanitizeOverlay`, which can only DROP one. So the
> document never had a toggle, the renderer had nothing to apply, and every such render came back
> dropped.
>
> | file | what changed |
> |---|---|
> | `lint_lp.js` | new exported `overlayDefects(doc, lang)` + `overlayDefects.targets(doc)`, and one wiring line at §13b. One blocking code: **`OVERLAY_MISSING`** — an Urdu render of an EN-medium book whose `ur_overlay` covers fewer than half the overlayable instruction strings. `lint()` now reads `opts.lang`, the language THE TEACHER ASKED FOR: the document cannot state it (an EN-medium book authored in English looks identical either way), which is exactly why this was invisible to every gate for the whole life of the lane. |
>
> It is a lint fail, not a render refusal, on purpose: a defect the revision ladder is handed gets
> repaired next round; a refusal throws away a finished lesson, which is the failure this whole
> lane has been unpicking.
>
> **bd-zle0u, hours later — `OVERLAY_MISSING` GAINED A SWITCH, because the fix above was right
> about the diagnosis and wrong about the layer.** Handing the defect to the revision ladder made
> the model re-emit the whole overlay alongside the whole document on EVERY round: measured on the
> 2026-09-05 staging re-run, 18–21k completion tokens for the three Urdu cells against 9–14k for
> the two English ones, roughly **+7,000 output tokens per round**. Five rounds of that does not
> fit the author timeout, and all three cells came back `AUTHOR_TIMEOUT` — a teacher who chose
> «اردو» now waited fourteen minutes and received NOTHING, where the original bug at least gave
> her an English lesson. Strictly worse, and live.
>
> The overlay therefore moves OUT of the ladder and into its own pass over the ACCEPTED document
> — one ~7k call instead of five, which is the "separate pass over the finished document" the
> deleted directive always claimed existed. Same patch in both homes, no new §3 divergence:
>
> | file | what changed |
> |---|---|
> | `lint_lp.js` | `overlayDefects(doc, lang, opts)` takes `opts.expected`; `lint()` reads `opts.overlayExpected` (default **true**, so every existing caller is unchanged) and passes it through. The authoring ladder passes `false` — it is not the caller writing the overlay — and the overlay pass passes `true` to check its own output. The gate is not weakened; it is asked of the caller that can satisfy it in one step. |
>
> **bd-c3le6 — three lessons discarded for 3px, 9px and 11px.** All three had `overflowingSections`
> EMPTY: no `data-sec` element past the page's inner bottom edge, so no lesson content was clipped.
> The only thing over the line was the FOOTER. Two measured causes, both found by rendering the
> three failing documents rather than by reading the code:
>
> | file | what changed |
> |---|---|
> | `lib/template.js` | `.mats` REMOVED from `body.measuring{ margin-top:0 }`. That rule was written on the belief that `.mats` carries `margin-top:auto` the way `.foot` does; it never has — its only margin-top is the `sp-4` spacing class, 16px. Releasing it cancelled a real 16px the live layout charges, so the packer believed the materials strip was 16px shorter than it prints. Measured on d10's t6: **+16 on that one atom, 0 on the other fifteen.** |
> | `render_lp.js` | new exported `absorbPlan(pages, maxPx)` + an in-page `ABSORB` pass between the probe and the print, and `overflow_absorbed` / `overflow_absorb_max_px` on the report. A page whose overflow is **≤ 12px AND has no section over the line** has that many pixels taken out of its own bottom whitespace, and is then RE-PROBED — the re-probe, not the plan, decides. 12 is not a tolerance chosen to fit the failures: it is `.pad`'s 4px bottom padding plus `.foot`'s 8px top padding, the whitespace between the last content pixel and the paper edge, the same number in both languages. `.foot`'s own padding-bottom (1px LTR / 7px RTL) is deliberately not reclaimed — Nastaliq descenders need it. **Clipping still fails at any size.** |
>
> **One half of bd-c3le6 is divergence-local and stays here.** `packAtoms` upstream is still
> GREEDY first-fit; the exact DP packer is §3.7's own divergence and exists only in this copy.
> The DP now takes an `opts.slack` — px a page may be overfilled by, ranked BELOW page count and
> orphans and ABOVE front-loading, so it can only ever REMOVE a page and never buy a fuller one
> — and the renderer passes it the same `OVERFLOW_ABSORB_MAX_PX` the absorber reclaims. The two
> numbers are one constant deliberately: a packer allowed more slack than the absorber can pay
> for would manufacture the very OVERFLOW this exists to stop. **Upstream gets the absorber but
> not the slack**, because there is no DP there to put it in; the absorber alone is the general
> mechanism and the slack is an optimisation inside the divergent packer.
>
> This mattered: fixing `.mats` ALONE pushed d10's teach part from 6 pages to 7, and page 7
> carried the 52px Materials strip and nothing else — a blank page in a teacher's printout,
> because the packer was ELEVEN pixels short while twelve pixels of reclaimable furniture sat
> unused at the bottom of that page. Correct arithmetic that produces a blank page is not a fix.
> With the two composed, d10 renders **6 teach pages with no defect at all** — better than the
> base, which failed it outright.
>
> **Corpus replay — 134 documents** (the 103 bd-gel97 used, plus the 31 lessons the diagram review
> delivered across its two rounds), base vs fixed, same crops, same engine:
> **0 overflows before, 0 after, 0 errors, 0 new OVERFLOW and 0 new PAGE COUNT.** Page count grew
> by one page on **2 of 134** documents — the honest cost of charging the materials margin — and
> neither crossed its cap. Separately, the three documents that actually failed: d15 now renders
> fully clean, d10's 9px is gone (the `.mats` fix alone; teach 6→7 pages, PAGE COUNT only, which
> bd-vjk68 delivers), and d03's 11px is absorbed (`padPx: 4, footPx: 7, unabsorbed: 0`) leaving
> PAGE COUNT only. All three now reach a teacher.

> **Partial re-vendor 2026-09-05 (bd-gel97): `lint_lp.js`, `diagrams/types/graph.js`,
> `diagrams/types_manifest.json`, `brief_author_v3.md` and all three flash briefs.** Fixed
> upstream first, in both upstream homes, and copied byte-for-byte. **No new §3 divergence.**
> `lint_lp.js` is the one exception to "copied": upstream carries a 21-line BUDGET-policy header
> that this copy does not (pre-existing, from the bd-az9t4 re-vendor), so the identical patch was
> applied to each rather than the file being overwritten — `graphDefects` and its wiring are
> byte-identical in both.
>
> **What this closes.** The first gated Physics lesson (`grade_9_physics.c05.p123-124`, board
> figure, `visual_gate_2026-09-04/e2e/page-08.png`) drew a `graph` captioned *"pressure decreases
> as altitude increases"* whose two book values were written `"Mount Everest (8.8 km, 33 kPa)"`
> and `"Boeing 747 (11 km, 23 kPa)"` and **plotted at (33, 8.8) and (23, 11)** — the numbers the
> other way round — on axes carrying **no labels at all**. The visual gate asks *is there a graph*,
> not *is the graph true*: `visual_check.js`'s own docstring says it "cannot tell whether a diagram
> is good, whether its labels are right". Three deterministic gates now cover the mechanical part
> of "is it true", with no LLM call added.
>
> | file | what changed |
> |---|---|
> | `lint_lp.js` | a new `graphDefects(spec, where)` (exported, so a corpus can be replayed against it) and one wiring block after `DIAGRAM_DEGENERATE`. Three codes: **`GRAPH_AXES`** — `xLabel`/`yLabel` are now REQUIRED on every `graph`; **`GRAPH_POINT_ORDER`** — a point label whose stated pair is the plotted pair reversed, or whose number carries the other axis's unit; **`GRAPH_ORIENTATION`** — a point far off the curve's drawn extent whose swap `(y, x)` lands inside it. Not gated on `full`: they read the spec only. The exact thresholds and every silence condition are written down in the roster doc so they are arguable rather than magic. |
> | `diagrams/types/graph.js` | adds an exported `drawnExtent(spec)` — the x/y extent the curves and segments ACTUALLY cover after window clipping, computed with **this file's own sampler and expression sandbox** so the lint measures the same curve the page draws rather than a second implementation of it. Two gallery examples gain the axis labels the rule now requires; the `summary` states the rule. No render-path change. |
> | `diagrams/types_manifest.json` | `xLabel`/`yLabel` moved `optional` → `required`; `minimal_spec` gains them; two `limits` entries state the axis rule and the point-order rule. |
> | `brief_author_v3.md` | §4b.3's two-second test now says a graph is *(x-quantity with unit) → (y-quantity with unit)*; §4b.4's graph entry gains the labels on both copyable specs plus the shipped defect shown as a worked WRONG/right pair. |
> | the three flash briefs | REGENERATED with `build_flash_brief.py`, `--check` re-run green, then copied. |
>
> **The renderer was NOT the bug.** `graph.js` already drew both axis titles when the spec carried
> them (`if (spec.xLabel) …`, `if (spec.yLabel) …` with the rotate transform), and
> `tests/lp612/graph-axes.test.js` now asserts both strings reach the SVG. The lesson shipped
> unlabelled because the spec had no labels and nothing required them.
>
> **Corpus replay, for calibration not celebration.** Over 103 lp_docs on disk (the 62-document
> visual-gate corpus, the 39 card-ceilings documents, the 2 operator/E2E documents): 188 diagrams,
> of which **5** are graphs. All 5 fail `GRAPH_AXES` — the rule did not exist when they were
> authored — and 2 `GRAPH_POINT_ORDER` lines, both the barometer's own points. `GRAPH_ORIENTATION`
> fires nowhere, and there are **no false positives**. 3 documents of 103 gain a blocking defect.

> **Partial re-vendor 2026-09-05 (bd-8lifl): `lint_lp.js`, `lib/template.js`, `brief_author_v3.md`
> and all three flash briefs.** Fixed upstream first and copied byte-for-byte. **No new §3
> divergence.**
>
> Four fixes, from the 2026-09-05 representative diagram batch — 16 lessons, 56 diagrams, and only
> **4 ship-quality before the fixes**. Full evidence in the workspace under
> `FEAT-080 6-12 Lesson Plans/diagram_review_2026-09-05/FIXES.md`:
>
> 1. **§4b.4 stopped contradicting §4b.1** about whether a `textbook_figure` counts toward the ≥2
>    floor. PR #622 changed the checker and §4b.1; §4b.4 still said the opposite, inside the section
>    headed "COPY THESE, do not invent fields". Eight lessons drew something else while the
>    planner's crop sat verified in R2 — one with the Activity heading "LABELLING FIG. 6.9" and four
>    exam marks riding on it.
> 2. **New generated §4b.5** — the complete per-type field list, spliced from
>    `diagrams/types_manifest.json` between `<!-- 4b.5:begin -->` markers by the new upstream
>    `lp_author/build_field_appendix.py`. The hand-written brief named **57 fewer fields than the
>    engine reads**, across 17 of the 20 types; `grid.cellText`, `atom.Z`, `graph.segments`,
>    `dna_helix.rungCount` and `punnett.showRatio` each caused a delivered defect. The drift guard
>    now runs in both directions.
> 3. **New blocking `ATOM_UNKNOWN_ELEMENT`** in `lint_lp.js`. `atom.js`'s table is H–Ca plus
>    Fe/Cu/Zn/Br/I; anything else falls through to Z=1, so a figure titled "WHY THE CHROMIUM ION IS
>    Cr3+" drew a hydrogen atom labelled Cr. The renderer is deliberately unchanged — a throw would
>    turn a repairable defect into a lost lesson.
> 4. **`CROP_MAX_H = 320`** replaces the hard-coded `max-height:200px` on `figure.dg img` in
>    `template.js`. Every SVG already gets a slot computed so its smallest label clears the 13.5 px
>    floor; a raster crop kept a flat clamp on the reasoning that it "has no vector type to crush",
>    which is wrong — its labels are baked pixels and are crushed the same way. Six crops across
>    five lessons were printed too small to read their own labels. Costs paper, not lessons.

> **Partial re-vendor 2026-09-04 (bd-q2jr1): a NEW FILE — `visual_check.js` — plus `lint_lp.js`,
> `brief_author_v3.md` and all three flash briefs.** Fixed upstream first, in both upstream homes,
> and copied byte-for-byte. **No new §3 divergence.**
>
> **What this closes.** `brief_author_v3.md` has told the model, in its system prompt on every
> call since v2, that *"`visual_check.py` runs on the emitted document … and **FAILS** any lesson
> that misses its subject's minimum."* `visual_check.py` was **never vendored here and no runtime
> code referenced it** — `git grep -i visual_check` on `origin/develop` returned 8 hits, all of
> them that sentence inside the four briefs. What actually ran was `lint_lp.js`'s
> `if (full && visuals === 0)`, counting a `latex` or `chem` block as a visual: one typeset
> formula and no picture satisfied it. `author_lp.py:1437–1448` calls that exact rule its
> `except ImportError` fallback and says of it, in the source, *"exactly how they shipped 'bereft'
> of diagrams."* **The serving lane ran the fallback, permanently, for two days and 62 lessons.**
>
> | file | what changed |
> |---|---|
> | `visual_check.js` | **new.** A transliteration of `lp_author/visual_check.py` — same rules V0–V14, same codes, same message strings, asserted string-for-string against the Python over all 62 real documents (0 divergences, before AND after the rule change below). It lives in `lp_html/` upstream, not `lp_author/`, because `lint_lp.js` is what requires it and the two must vendor together. Adds `meetsSubjectMinimum()`, which the Python does not have — it is the REWARD side the author service's acceptance needs, and it is additive. |
> | `lint_lp.js` | one hunk, §14c: on a **v3** document the contract runs and its findings are emitted as `VISUAL: <line>`; the old `visuals === 0` rule still governs the **2.0** corpus, so exactly one authority speaks about visuals per document and 200 migrated documents do not turn red overnight. |
> | `brief_author_v3.md` | §4b.2 rewritten (see below); §4b.4 gains `dna_helix` and `graph`'s `shade`; the `textbook_figure` block's `ref` contract corrected; ten copyable specs de-poisoned. |
> | the three flash briefs | REGENERATED with `build_flash_brief.py` before copying, per the re-vendor obligation two paragraphs down, and `--check` re-run green afterwards. |
>
> **The §4b.2 rule change, and why it is not a straight port.** Porting the Python as-is fixes
> Chemistry, Physics, Maths, English and Pak Studies and does **nothing** for Biology, General
> Science or Computer Science:
> * the Biology row was the single permissive union `{cell, flow, labelled_figure, mindmap,
>   punnett}` — one `flow` satisfies it — which is why Biology posted **zero** V6 failures across
>   the delivered corpus while carrying **zero** labelled structures in 13 diagrams. It is now two
>   groups (a real biological figure AND a process/relations map), which is what the row's own
>   prose always said.
> * **General Science is no longer an alias of Biology.** The 6–8 book is biology and chemistry
>   and physics in one cover, and only 70% of its segments carry a labelled structure in their
>   page-truth; demanding a `cell` of a push-and-pull lesson forces an invented figure.
> * **Computer Science had no row at all**, so V0 fired and `check()` RETURNED — V6–V14 never ran
>   on a CS lesson. Its row is derived from the CS page-truth (702 screenshots, 414 tables, 400
>   charts, 364 labelled devices, **54** flowcharts), not from instinct. Agricultural Education
>   had the same hole and gets the same treatment.
>
> Both rule tables were changed **identically**, and the parity replay was re-run afterwards: 0
> divergences over 62 documents. If they ever drift, the authoring lane and the serving lane are
> gating different documents while quoting the same section number.
>
> Measured on those 62 pre-change documents: 48 → **54** fail, V6 45 → **59**, V0 5 → **1**. That
> number going UP is the expected direction and is **not** a regression — the corpus was authored
> with no gate running, so a stricter rule can only find more in it. The fail count can fall only
> on documents authored WITH the gate on.

> **Upstream cap mirror, 2026-09-04 (bd-09m6a).** The bd-vjk68 raise above was applied to the
> VENDORED tree first. The skill copy has now been brought level in the same change: `MAX_PAGES`,
> `WARN_PAGES`, `MAX_PAGES_UR`, `WARN_PAGES_UR` and their reasoning comments, §8 of
> `brief_author_v3.md`, all four regenerated flash briefs (`build_flash_brief.py --check` clean),
> and the six cap assertions in upstream's `test/run_tests.js` (149/149 green after). The stale
> normative statements in the skill's own docs went with them — the README capacity table and its
> "5+4 is what the code enforces today" lines, `reference/lp_v9_render_pipeline.md`'s two "do not
> state a new cap" notes, and `SKILL.md`'s summary line. **The soft-page-count ladder was NOT
> touched: it lives in `lp612-author.service.js`, not in `lp_html`.** `render_lp.js` is not
> re-copied here — its §3.2/3.3/3.4/3.7 divergences stand and the vendored caps were already right.
>
> **Partial re-vendor 2026-09-04 (bd-09m6a): five `diagrams/types/*.js`, plus the NEW
> `diagrams/types_manifest.json` and `diagrams/assets/`.** Fixed upstream first and copied
> byte-for-byte; the §6 pre-copy diff showed **exactly** these five files and nothing else, so
> `lint_lp.js`, both schemas, `diagrams/index.js` and all of `diagrams/lib/` remain byte-identical
> to upstream and §3 is unchanged — **no new divergence**. Upstream's own suites were run there:
> `test/diagram_roster.js` 137/137 (new), `test/diagram_ports.js` 25/25, `test/run_tests.js`
> 149/149, `test/packing.js` 4/4, and `diagrams/test.js` now **PASSES** at 65 examples / 20 types
> (it had been red on two `labelled_figure` examples for months). `diagram_overlap_gate`'s corpus
> sweep fails on exactly the one already-rejected candidate it failed on before the change.
>
> What changed, and why each one mattered **here** rather than only upstream — three of the five
> are Urdu defects, and NIETE is the deployment that serves Urdu:
>
> * **`circuit.js`** — `linesFor()` hardcoded `ur:false` on the component VALUE line while
>   `svg.text()` sends any Arabic-script string down the tall `foreignObject` path regardless of
>   the caller's `lang`. Layout arithmetic and render path disagreed, so an Urdu value got a
>   Latin-sized slot and landed on its own label. Separately, the 30-unit Urdu advance is shorter
>   than a Nastaliq box (34.45 units), so **any** two stacked Urdu lines overlapped by ~4. Both are
>   `DIAGRAM_OVERLAP`, which is a **hard lint fail** — one Urdu switch value cost the whole lesson.
> * **`molecule.js`** — the canvas already reserved 2.9× height for a Nastaliq name, but the
>   baseline offset was a flat 1.05× and a `foreignObject` box grows UPWARD from it, into the
>   formula's subscript. Same hard fail, same cause class.
> * **`free_body.js`** — the body chip is one string handed to an RTL `foreignObject`, so bidi
>   reordered the trailing Latin run and **`"ڈبہ 5 kg"` printed as `"kg 5 ڈبہ"`** on the page. No
>   gate could see it: the SVG string is correct and the reversal happens in the browser's text
>   layout. Fixed with the LRI…PDI isolate this vendor tree already uses for the resources-line URL
>   (§3.6) and the coaching-corner phone number.
> * **`atom.js`** — `render()` selected the bonding picture on `mode === "dot_cross"` only, so
>   `{"type":"dot_and_cross", …}` reached the module through its OWN registered alias and then
>   silently drew a **Bohr diagram of the first element**. Mode now resolves explicit `mode` → the
>   alias used → default, the order `dna_helix` already uses for its `kind`.
> * **`labelled_figure.js`** — its two gallery examples resolved their image seven levels up, out
>   of the skill and into an operator investigation folder **that does not exist in this repo**, so
>   the vendored copy could only ever render an "image not found" card. The crop is now vendored at
>   `diagrams/assets/fig_1_11_leaf.jpg` and the module resolves it from `__dirname`.
>
> **`diagrams/types_manifest.json` is new and is now part of the vendor contract.** It is the
> machine-readable roster of all 20 kinds — aliases, required and optional fields, a minimal
> renderable spec, known limits — so the `lp_doc` schema enum, the lint and the author brief can
> each be checked against what the renderer actually supports. `tests/lp612/diagram-roster.test.js`
> (31 assertions, red-first against `origin/develop`'s vendored tree) asserts it against the
> **serving** copy: every kind present, every alias resolving through `renderDiagram`, every
> minimal spec rendering, plus a pin on each of the five fixes above. **This partly closes §5's
> first coverage gap** — upstream's suites still do not run here, but the diagram engine now has
> assertions on this side of the copy rather than none.
>
> Prose rendering of the roster, with a render of every type in both languages:
> the skill's `reference/diagram_roster.md`.

> **Partial re-vendor 2026-09-03 (third, night — bd-u6za9): the three FAMILY FLASH BRIEFS,
> byte-for-byte.** `brief_author_v3_flash_{maths,sci,prose}.md` copied from `lp_author/`
> unmodified, verified by SHA-256 against the skill copies at the moment of vendoring:
>
> | file | bytes | sha256 (first 12) |
> |---|---|---|
> | `brief_author_v3_flash_maths.md` | 102,471 | `bb444a1f8ead` |
> | `brief_author_v3_flash_sci.md`   | 102,144 | `9a6b0f862194` |
> | `brief_author_v3_flash_prose.md` | 102,542 | `3c0e3070dd8e` |
>
> Upstream's `build_flash_brief.py --check` reported all four generated briefs up to date against
> `brief_author_v3.md` immediately before the copy, so the flash briefs and the vendored v3 describe
> the same canon. **No `§3` divergence** — these are additions, and nothing already vendored moved.
>
> The GENERIC flash brief (`brief_author_v3_flash.md`) is deliberately NOT vendored: the serving
> lane always resolves a family from `book_stem` (NOT NULL in `niete_lp612_segments`), so the
> family-less variant is unreachable here and vendoring it would be ~100 KB that nothing can load.
>
> **Re-vendor obligation:** these are GENERATED files. When `brief_author_v3.md` changes upstream,
> the flash briefs must be REGENERATED there (`build_flash_brief.py`) before being re-copied —
> copying a stale flash brief beside a fresh v3 silently turns a model comparison into a harness
> comparison, which is the exact drift `--check` exists to catch (§6b of BAKEOFF_ROUND3).

> **Partial re-vendor 2026-09-03 (second, evening): `lib/template.js`, `lib/rich.js`,
> `brief_author_v3.md` byte-for-byte; `render_lp.js` by hunk.** Fixed upstream first (upstream's
> own suites run there: `test/run_tests.js` 149/0 with a new mixed-script bidi section, and the
> other runners green except `diagram_overlap_gate`, red before AND after on the same unrelated
> rejected-sample artefact). What changed, in both homes identically — **no new §3 divergence**:
>
> * **The mixed-script bidi pass** (the 2026-09 staging audit): numeric ranges in RTL prose get
>   LRI…PDI isolates (`lib/rich.js` `setRtlProse`, driven by `buildHtml`); chrome isolates
>   `printed_pages` and the outcome box's Latin citation atoms; sequence/answer arrows flip to
>   `&larr;` under RTL; prose blocks carry `unicode-bidi:plaintext` (RTL stylesheet only — the
>   English render is byte-identical, asserted upstream and in `tests/lp612/bidi-caps.test.js`).
> * **Per-language page caps** (`render_lp.js`): `pageCapsFor(lang)` — English **7/6** (warn 6/5);
>   Urdu **9/7** (warn 8/6) *(since 2026-09-06, bd-oak77.12 — see the v9.2 type-scale note below;
>   they were EN 6/4 · UR 7/6 for two days)*. *(Raised one sheet per language on 2026-09-04, bd-vjk68: EN teach
>   5→6, UR support 5→6, aimed at where the 9 live overflows actually were — 6 EN teach, 3 UR
>   support. Was EN 5/4 warn 4/3, UR 7/5 warn 6/4. That raise landed HERE FIRST and left the skill
>   behind for a few hours; it was **mirrored upstream on 2026-09-04 under bd-09m6a** — the four
>   constants, §8 of the brief, the regenerated flash briefs and upstream's own cap assertions —
>   so the two homes agree again and this is NOT a divergence.)* Word budgets in
>   `lint_lp.js` are deliberately untouched: identical content volume, more paper. The caps
>   hunks were applied to the vendored file BY HAND around the §3.2/3.3/3.4 divergences — never
>   blind-copied.
> * **`brief_author_v3.md`**: new §7c (writing Urdu and English on the same page) + the Urdu
>   page-cap note in §8, and the previously-pending skill→vendor delta (the `DUPLICATE_DIAGRAM`
>   section, "20 types") rides along — the two copies are byte-identical again.
>
> `lint_lp.js` and both schemas remain byte-identical to upstream.

> **Partial re-vendor 2026-09-03 (bd-x4xxm): `lib/template.js` only.** Fixed upstream first and
> copied byte-for-byte; upstream's own suites were run there (`test/packing.js` added, 13
> assertions; 7 of 8 files green, `diagram_overlap_gate` red before and after on an unrelated
> rejected-sample artefact). **No new divergence** — §3 is unchanged, and the pre-copy diff
> showed exactly the four hunks of that change and nothing else. `render_lp.js` was NOT touched,
> so its §3.2/§3.3/§3.4 divergences are intact; `lint_lp.js` remains byte-identical.
>
> What changed: three repeated structures used to be emitted as ONE indivisible atom each — the
> page-2 `homework_key` and `model_answers` card grids and the teach part's homework list — so
> the packer had nowhere legal to break inside them and pushed each whole block to a fresh page.
> They now emit one atom per grid ROW / per item, which is the cut already shipped for practice
> items and MCQs. It is visually lossless: the grid gap and the list gap the split removes are
> exactly the `sp-2`/`sp-1` atom margins that replace them, and `.blk` has no box of its own.
> Measured on the n=24 study's own documents: 27 of 46 parts within cap → 28, and the packer's
> page counts are unchanged everywhere else.

**Vendored on 2026-09-02**, from the working tree of that skill (the skill is not versioned in
this repo, so there is no upstream commit SHA to quote — the newest source mtimes at the time of
copy were `lint_lp.js`, `render_lp.js` and `lib/` from 2026-09-01/02 and
`brief_author_v3.md` from 2026-09-02). **A future re-vendor should record the SHA if the skill
has by then landed in a repository of its own.**

The prose contract for the pipeline — the twelve blocking gates, the page caps, the type floors,
the word budgets, the two schema versions and the one layout path — is the skill's
`reference/lp_v9_render_pipeline.md`. Read it before changing anything here. Its own order of
authority applies inside this directory too: **quote a number from `render_lp.js` /
`lint_lp.js` / the schema, never from a doc, including this one.**

### What was deliberately NOT vendored

| Upstream | Why not |
|---|---|
| `lp_author/author_lp.py` | Its **control flow** was ported to `bot/shared/services/lp612-author.service.js` (see §4). The Python itself has no place in a Node worker. |
| `lp_author/retrieve.py` | Same: ported to `bot/shared/services/lp612-pagetruth.service.js`. |
| `lp_author/visual_check.py` | Transliterated to `lp_html/visual_check.js` upstream and vendored from there (2026-09-04). The Python stays as the AUTHORING lane's gate; the two tables are kept identical by hand and asserted equal by a 62-document parity replay. **Change one, change both.** |
| `lp_html/phone_gate.py` | A human-review tool (rasterise → 390px phone sims → **look at them**). It belongs to the authoring workflow, not to the serving path. |
| `lp_html/test/`, `lp_author/test_lp_author.py` | Upstream's own suites. This repo tests its own services in `tests/lp612/`; running upstream's suites here would need their fixtures, their runner and a browser. **This is a real coverage gap — see §5.** |
| `lp_html/samples/`, `lp_author/samples/` | Fixtures and corpus. Large, and not needed to serve. |
| `lp_html/diagrams/figure_locator.py`, `.venv`, `out/` | Authoring-time tooling and build output. |
| `lp_author/brief_author_v{1,2}.md` | Superseded by v3. |
| `lp_html/package.json`, `package-lock.json` | The three runtime deps (`ajv`, `katex`, `openchemlib`) are declared in `bot/package.json` instead. |

---

## 2 · Runtime requirements

**npm** (declared in `bot/package.json`): `ajv`, `katex`, `openchemlib`, plus `playwright-core`
(already present) for the render pass.

**Optional, degrade gracefully — neither is installed on Railway and neither needs to be:**

* `python3` + Pillow — `lib/template.js` shells out to `lib/clean_figure.py` to tone-correct a
  faint textbook scan. On failure it warns and uses the raw crop.
* `python3` + schemdraw in `diagrams/.venv` — `diagrams/types/circuit.js` uses it for circuit
  SVGs. The `.venv` was not vendored, so this path returns `null` and the engine falls back to
  its own drawing. **Circuit diagrams will therefore look different here than in the upstream
  authoring runs.**

**Writes to disk:** `lib/template.js` caches cleaned raster figures under
`bot/vendor/lp-v9/.figcache/`. Only raster `textbook_figure` blocks reach that path; typed
`diagram` blocks are pure JS.

---

## 3 · Divergences from upstream — the complete list

Every one is marked with a `VENDOR DIVERGENCE` comment at the site.

### 3.1 `lib/fonts.js` — font resolution re-anchored

* `REPO_ROOT` was six levels up from `lib/`, i.e. the operator **workspace** root. It is now
  four levels up, i.e. **this repo's** root (`bot/vendor/lp-v9/lib` → repo root). It is only used
  to relativise report paths and to resolve a doc-relative figure `src`, so this is a
  correction of meaning, not a workaround.
* The workspace font fallbacks (`06_Logs & Misc/…/mewaka-sample-report/…`,
  `02_Main Rumi Bot/fonts/…`) are **removed**. The four faces are vendored into `./fonts` and
  that is the only candidate. `tests/lp612/vendor-integrity.test.js` asserts `fontCss().missing`
  is empty, so a dropped face fails loudly instead of rendering tofu against a system font.

### 3.2 `render_lp.js` — chromium channel (**the Linux/Railway fix**)

Upstream: `pw.chromium.launch({ channel: "chrome" })`. `channel: "chrome"` means *the Google
Chrome installed on this machine*. Railway's container has no Google Chrome — it has the
chromium that `playwright-core`'s postinstall downloads — so upstream's launch would throw there
on every render.

Now: `chromeChannel()` returns `process.env.LP612_CHROME_CHANNEL` if set (`"bundled"` maps to
*no channel*, i.e. playwright's own chromium); otherwise `"chrome"` on **darwin** (a dev laptop
has Chrome, and it is what the golden renders were eyeballed against) and **undefined
everywhere else**, which is the bundled chromium. `launch()` is called with `{}` when the channel
is undefined, never with `{channel: undefined}`.

The same reasoning applies to the no-playwright CLI fallback: the hardcoded macOS
`/Applications/Google Chrome.app/...` path became `CHROME_CLI_BIN`, overridable with
`LP612_CHROME_BIN` and defaulting to `google-chrome` off darwin.

> **NOT VERIFIED ON LINUX.** This change is reasoned from playwright's launch contract, not
> measured on a Railway container. The first real Railway render is the test.

### 3.3 `render_lp.js` — a programmatic entry point

Upstream had only a CLI `main()` that ended in `process.exit()`. A long-lived worker cannot call
that, and shelling out to `node render_lp.js` would put a subprocess and a stdout parse between
the caller and its errors.

`main()` was therefore split in two, with **no change to any render logic**:

* `renderDoc(opts)` — does the work and **returns** `{report, reportPath, problems, warnings,
  htmlPath, pdfPath, pagesByPart, probe, pdfPages}`. Schema and overlay failures, which upstream
  reported by `console.error` + `exit(1)`, now `throw` an `Error` with `.code` of
  `SCHEMA_INVALID` / `OVERLAY_INVALID` and an `.errors[]` array.
* `main()` — the thin CLI shell: parse argv, call `renderDoc`, print, choose an exit code.

`renderDoc` and `chromeChannel` are added to `module.exports`; nothing was removed from it.

### 3.4 `render_lp.js` — playwright resolution

Upstream tried a machine-local path into another repo's `node_modules` before the bare
`require("playwright-core")`. Here `playwright-core` is a real `bot/package.json` dependency, so
the bare require is the only candidate. This also makes the root Jest suite's
`moduleNameMapper` stub the seam that stops a unit test launching a browser.

### 3.5 The judge is not ported at all

Upstream `author_lp.py` calls a Haiku "rubric v3 judge" before and inside the revision ladder.
**It is out of scope for this lane and no part of it is here**: no `judge()`, no judge score in
the author service's result, no judge input to the revision prompt.

That is a *deliberate scope cut*, and it is the safe direction: upstream's own §0 rule 2 is
"THE LLM JUDGE IS ADVISORY. IT IS NEVER THE GATE OF RECORD" — it scored 100 on a plan a subject
expert tore apart. Dropping it removes an advisory signal and a per-round LLM call; it removes
no gate. The consequence to know: upstream's ladder can reject a round for a judge-score drop as
well as for a defect-count rise, and **the ported ladder can only see the defect count.**

### 3.6 The video link — MOVED to a resources line at the top of page 1 (2026-09-03)

Two edits, in order, and the second is the one that stands.

**First**, a video line was added to the coaching corner and then **removed**, because the lane
already had a video path nobody had grepped for: `lp612-author.service.js` does
`parseYt(segment.yt)` then `applyVideo(doc, video)`, which sets the development section's `video`,
and `lib/template.js` had rendered that as a labelled anchor since v8. The coaching-corner copy was
a SECOND copy of the same link on the same document, on the support page -- the page that hits the
4-page cap.

**Then**, on operator feedback (*"YT link didnt appear in my lesson? Isnt it supposed to? Somewhere
at the top perhaps? In resources?"*), the surviving link **moved** out of Development and into a
compact **resources line at the top of page 1**, directly under the outcome box:

    [tv] Video: youtu.be/<id>

Properties worth keeping if this is ever re-cut:

* **It is a MOVE, not an addition.** `resourcesLine` reads the SAME
  `sections[<development>].video`; the old `.blk vid` emission in `after()` is gone. One link, one
  place. Asserted by a test that counts the line's marker across the whole document.
* **The data still never passes through the model.** `applyVideo` writes the url onto the parsed
  document after every LLM reply, so the printed link is curated data and cannot be invented.
* **It costs no page.** Measured before and after on the gate fixture: `teach 4 / support 3`,
  0 problems, both times. Page 1 is the busiest page and the teach part is often at its cap, so
  the line is deliberately the URL ALONE -- not the title, channel, duration and "why" the old
  inline block printed.
* **CLASS NAMES ARE A MINEFIELD HERE.** It is `.vres`. `.res` is already the KaTeX result block and
  `.vid` was the old inline video block; a colliding class silently inherits someone else's box,
  which happened once already during this work.
* **Urdu:** the visible url is wrapped in U+2066 ... U+2069 INSIDE the link text, the same fix the
  coaching corner's phone number carries. The label follows the page's own pack (`L.video`).
* **Only http(s) becomes an anchor**, and no pick renders nothing at all -- no label, no dash, no
  empty box. Most of the corpus has no pick on any given night.

Verified at byte level rather than by eye: the produced file carries a `/Link` annotation with the
watch URL (`qpdf --qdf` then grep `/URI`; `check_links.sh` in the FEAT-080 `staging_render_proof/`
folder). The engine matters -- the headless browser driven through the automation library emits the
annotation, while the no-library CLI fallback produces a byte-valid file with NO annotations at all,
so a link checked on that path proves nothing about the deployed one.

`render_lp.js` carries no video plumbing: the earlier `renderDoc({ video })` option was removed with
the coaching-corner line and was not reinstated, because the document already holds the pick.

### 3.7 `render_lp.js` — container launch flags

Two flags on the browser launch that matter ONLY on a container, and only under load (`bd-v60qf`):

* `--disable-dev-shm-usage` — a container's `/dev/shm` defaults to 64MB. The browser keeps its
  shared memory there, and a 9-page A4 render with four embedded faces and SVG diagrams exhausts
  it. The tab dies mid-render, and it surfaces as "the render failed" with no readable
  out-of-memory anywhere.
* `--no-sandbox` — the sandbox needs kernel privileges the Railway container does not grant;
  without it the browser can fail to start at all.

Both are harmless on a dev box, which is exactly why nothing on a laptop would ever catch their
absence. Upstream does not carry them because upstream renders on a workstation.

Asserted at the launch boundary in `tests/lp612/render.test.js` — there is no way to observe this
from outside the process, so the launch call is the only place the requirement can be recorded.

### 3.9 `render_lp.js` + `lib/template.js` — the page packer is EXACT, not greedy (2026-09-04)

Upstream `packAtoms()` is greedy first-fit: fill until the next atom does not fit, break, then walk
backwards over `glue`. It is kept, renamed `packAtomsGreedy`, exported, and still tested — it is the
baseline every claim below is measured against, and it is what produced every lesson delivered
before this date. `packAtoms` is now an exact O(n²) dynamic program over the same atom model, the
same capacity and the same two legality rules.

**Why a search is needed at all.** Over a UNIFORM page box greedy first-fit is already optimal for
ordered items, so a cleverer search would buy nothing. The box is not uniform: a continuation page
pays the "…continued" strip, and one that opens MID-section also pays that section's repeated bar —
so the box of page k+1 depends on which atom opens it, and greedy picks that opener blindly. That is
the only place a page can be won, and the DP models it exactly by keying its state on "a page starts
at atom i" (page 1 is exactly the page starting at atom 0, so the furniture is fully determined
without carrying a page index).

Objective, lexicographic: **pages**, then **orphans** (a break right after a `glue` atom, allowed
only on a page holding that one atom — greedy's own escape hatch), then **front-loading** (the
fullest page here, which is greedy's rule).

**Measured on 62 real lesson documents** (39 delivered off staging + the 23-cell n=24 study),
re-rendered with both packers on the same machine:

```
pages          582 -> 582   (0 saved)
parts over cap   4 ->   4   (0 rescued)
documents whose pagination changed at all: 0 of 62
```

Greedy was already page-optimal on every part of every document in the corpus, and the DP proves it
rather than assuming it. **This change is therefore not a page saving** — see the packer's own
doc-comment for why the −4.6% / "5 over cap → 0" figure it was commissioned against is a continuous
lower bound (Σ ceil(content px ÷ capacity px)) that ignores atom indivisibility and per-page
furniture, and is not reachable by any packer. What it does buy:

* **optimality is now guaranteed, not incidental** — a future document where greedy leaves a page on
  the table cannot silently cost one;
* **a latent overflow defect is gone.** After its backwards walk over glue, greedy re-accumulates the
  page's atoms *without re-checking the cap*, so the page can paint past its own bottom edge. On 300
  randomised atom shapes greedy beat the DP on page count 58 times and in **all 58** it was because
  greedy had overflowed. The DP never does.

The brief also asked for an even-fill tie-break ("avoid a near-empty final page"). Two variants were
built and run over the whole corpus, and **both were rejected on the measurement**: Σ slack² levels
the document and dropped teach page 1 of `grade_11_physics` from 1064px (full) to 741px for zero
pages saved — the exact "way too much open space" defect the atom packer was built to remove; and
counting pages under 70% full re-broke 33 of 62 documents and, on `c11`, moved the stranded page out
of the end of the support part into a 314px hole in the middle. Front-loading was chosen instead
precisely because it reproduces greedy's breaks wherever greedy was optimal, so no break lands
anywhere the shipped packer would not have put one. The even-fill question is real (43 final pages in
the corpus are under half full) but it is a product decision with its own evidence.

`lib/template.js` gains four `glue` marks, for adjacencies greedy preserved only by ACCIDENT — it
breaks as late as it can, so it separated them only when the second atom genuinely did not fit,
whereas an exact packer chooses freely and would find those breaks:

* `page2` section A — the board diagram is glued to its draw-order card. They are one instruction in
  two atoms; split across a page the teacher gets a finished board on one sheet and the order to draw
  it on another.
* the teach `hero` and the `seq` strip, and the support `p2head` — a break under a masthead prints a
  sheet carrying a title and nothing else.
* `sectionAtoms` now forwards `glue` from `after(s)` exactly as it already did from `before(s)`. No
  atom from `after()` sets it today, so this changes nothing — but the asymmetry silently dropped any
  glue such an atom declared, and a dropped glue is now a split a reader sees.

Tests: `tests/lp612/page-packer.test.js` (18) — the mid-section headline case, glue chains and the
single-atom escape, per-page overhead for a mid-section vs own-bar opener, both top-margin rules, the
front-loading equivalence, and the invariants against greedy.

### 3.10 The v9.2 type scale — NOT a divergence, and applied as identical hunks (2026-09-06)

Operator, for the third time: *"could we please increase the font on the lesson plan even further
to ensure its readability? Currently, it's very small, and it's very hard to read. Please increase
the size by 1 or 2 pt, or figure out what makes it readable if one is holding a phone at an arm's
length distance."*

**Body 18px → 21px, every other size by the same factor** (`TYPE_SCALE = BODY_PX / BODY_PX_V91` in
`lib/template.js`, applied by `scaleTypeCss` to our stylesheet only). Floors derived
(`BODY_FLOOR_PX = scaledPx(18)` = 21, `CHIP_FLOOR_PX = scaledPx(14)` = 16.33). Caps EN 6/4 → **7/6**,
UR 7/6 → **9/7**, and §8 of the brief and its three flash copies carry the new budget. Gutters, the
`--sp-N` ladder and the leading are byte-identical to v9.1 — nothing was clawed back to pay for the
type.

**Why 21 and not 20.67 (a flat +2pt).** `bot/shared/templates/niete-brand.js` already declares
`TYPE_FLOOR = { body: 21, small: 16.5, label: 15.5 }` as the type floor for every teacher-facing
rendered artefact. The vendored engine does **not** `require` that module — reaching into the host
app's brand layer is a divergence upstream could never carry — so the NUMBER is shared and the CODE
is not, and `tests/lp612/type-scale.test.js` asserts the two agree so they cannot drift silently.
(That assertion SKIPS LOUDLY on a base where `niete-brand.js` does not exist, which is the case on
`main` today: the quiz lane that introduced the token has not been promoted.)

**Not a divergence.** The same hunks are in the skill copy, and `test/type_scale.js` upstream pins
the same contract plus a browser-backed pagination snapshot on three corpus documents. Applied as
**surgical hunks in both trees, never a whole-file copy**, because the two had already diverged in
both directions (§3.9's `glue` marks are ours; the caps were stale upstream) and copying either
file over the other would have silently reverted whichever was ahead.

**One thing this DID close.** Measured on 2026-09-06, this workspace's skill copy still carried
`MAX_PAGES {teach:5,support:4}` / `MAX_PAGES_UR {teach:7,support:5}` — the pre-bd-vjk68 numbers —
despite the bd-09m6a mirror note above. Both homes now read 7/6 and 9/7. If the mirror is expected
to have landed and had not, the same is worth re-checking for the rest of that change.

**The measurement, and the honest limit.** An A4 page fit to a 390-px phone is scaled by 0.4912
before anyone reads it, so the v9.1 body arrived at an x-height of 0.80 mm = 6.85 arcmin at 40 cm,
against a ~12-arcmin critical print size for fluent reading — 57%. v9.2 reaches 67%. **No step of
one or two points closes that gap; the ratio needed is ×1.75 and a ×1.75 type costs 2,261 pages
over the 62-document corpus against today's 579.** The route that does reach it is a phone-first
page size, which changes print behaviour and is priced, not shipped, in
`prod_golive_2026-09-06/07_font/OPTIONS.md` §4. The Urdu-specific ×1.15 (`RTL_TYPE_SCALE` in the
brand token) is priced in §5 and also not shipped.

Corpus cost of what DID ship: 579 → 775 pages (+33.8%), median lesson 9 → 12 pages, documents over
cap 1/62 → 3/62 at the new caps.

**Still the smallest type on the page:** the diagram engine's 13.5px label floor
(`diagrams/lib/svg.js`, `requiredBox()`) did NOT move — it sizes labels against the figure's own
column, not the page's body scale, and raising it re-lays every diagram in the corpus behind the
overlap sweep. It is now 43% of the readability floor against the body's 67%. Bead filed.

### 3.11 `lint_lp.js` — render-laws 22-24: WARMTOPIC, REDUNDANT, LABELACT (2026-09-11)

Three new lint checks (`bd-i2udq`): a warm-up item must be about today's lesson, not a
content-free icebreaker (render-law 22); a figure's legend must add content beyond its caption, not
restate it (render-law 23); a board `draw_order` line must open with an imperative, not merely name
what's already there (render-law 24, English + Urdu).

**WARMTOPIC and LABELACT's English half — NOT a divergence, applied as identical hunks in both
trees.** `WARMUP_ICEBREAKERS` (the 8-pattern icebreaker list) and `LABELACT_EN` (the ~39-verb
anchored regex) are byte-identical between this copy and upstream's
`.claude/skills/curriculum-baked-lesson-plans/scripts/lp_html/lint_lp.js` — confirmed by direct
diff, 2026-09-11. Both lists were adopted from upstream wholesale rather than maintaining a
narrower vendored list in parallel (upstream's icebreaker list is a superset of this copy's prior
3 patterns; its verb list drops this copy's prior "arrow"/"connect"/"plot" but adds ~20 verbs, e.g.
"solve").

**Post-adoption fix, same day: "rule" added to `LABELACT_EN`, applied identically in both trees.**
False-positive validation against a real corpus (`PK_G10_PHYS_CH14_REFLECTION.agastya.lp.json`,
schema-3.0) found a genuine board-work imperative — "Rule the mirror line and hatch behind it."
("rule" = draw a straight line with a ruler) — that neither this copy's prior list nor upstream's
adopted list recognised. Added `|rule` to both trees' `LABELACT_EN` alternation (still byte-identical
between them) with red-first TDD: `tests/lp612/labelact.test.js` now carries 10 cases, the 10th
encoding this exact false positive.

**LABELACT's Urdu half — a genuine, permanent divergence, kept deliberately.** Upstream's Urdu
check is a single regex of exact conjugated forms (`لکھیے`/`لکھیں`/… — 13 forms, no fallback). This
copy merges that exact-form list with its own prior loose-stem match —
`LABELACT_UR = { test: (s) => LABELACT_UR_EXACT.test(s) || LABELACT_UR_STEMS.test(s) }` — so an
informal or otherwise-inflected imperative upstream's exact list doesn't spell out (e.g. "لکھو")
still passes here but would false-positive upstream. This is real coverage this deployment's Urdu
teacher traffic needs; upstream does not carry it and is not expected to.

**REDUNDANT — same check logic, independently-worded message; a cosmetic divergence.** The
comparison itself (`norm()` collapsing punctuation/case/whitespace, then
`nc === nl || nc.includes(nl) || nl.includes(nc)`) is functionally identical in both trees. Only the
`fail()` message string and the surrounding comment differ in wording — each tree's copy was
authored independently rather than as one hunk applied twice. Not worth reconciling byte-for-byte;
the check's behaviour is the same either way.

Tests: `tests/lp612/warmtopic.test.js` (8), `tests/lp612/labelact.test.js` (10),
`tests/lp612/redundant.test.js` (7) — all red-first against this branch's unmodified `lint_lp.js`.

### 3.12 `diagrams/index.js` + `diagrams/lib/tex.js` — TeX is converted at the spec boundary (2026-09-14)

`renderDiagram(spec)` now runs a deep, non-mutating TeX → Unicode pass over every string in the
spec before handing it to the type module (`bd-3emr5`). `diagrams/lib/tex.js` is new here: a
verbatim copy of `bot/shared/utils/tex-to-unicode.js` with a header block on top.

**Why it is a copy and not a require.** Nothing under `bot/vendor/lp-v9/` reaches into
`bot/shared/` — the tree is hermetic, which is what lets it be re-vendored, or pushed back up to
`lp_html/diagrams/`, as one unit. A cross-boundary `require` would make `diagrams/` unusable
outside this repo. `tests/lp612/bd-3emr5-diagram-latex.test.js` asserts the vendored file is the
shared file byte-for-byte below its header, so the copy cannot quietly rot.
**Edit the shared file, then re-copy; never edit the vendored one.**

**Why the conversion sits at the spec and not at the egress.** `Svg.prototype.text()` is the single
place every drawn string passes through, but `esc()` there escapes only `& < > " '`, and — more to
the point — `wrap()`/`measure()` run *before* it. A `$…$` span can already be split across two
wrapped lines by the time `text()` sees it, which is exactly how the bug was reported: literal
LaTeX broken over two lines in the Grade 10 determinant lesson's WRONG/CORRECT panel. The spec is
the last point at which a span is still whole. Converting there also covers all 17 types and the
`title`/`caption`/`source`/`note` strips in `svg.js` at once, and Unicode is shorter than its TeX,
so the pre-computed widths over-reserve — the safe direction (`panels.js`: "Under-estimating is the
expensive direction").

**Not a KaTeX port.** The bead was filed against a `_mathText()`/`mathBoxH()`/KaTeX path said to
have been added upstream for `bd-y86qu`. **That code does not exist in this tree** — `grep` for
`hasMath|mathLines|_mathText|mathBoxH` under `bot/vendor/lp-v9/` finds nothing, and `bd-y86qu`
records that its fix was made directly in a shared checkout rather than a worktree. So the leak
here is wider than the bead describes (the strips leak too, not only panel bodies) and the fix
stands on its own. KaTeX would not help regardless: it emits HTML + CSS, and this is SVG.

**Shared-file change that rides along.** `tex-to-unicode.js` gains `\begin{…}`/`\end{…}`
(`bmatrix` → `[ ]`, `pmatrix` → `( )`, …), `\\` → `; ` and a bare `&` → `, ` inside a maths span,
so `adj = $\begin{bmatrix}5 & -4\\ -2 & 6\end{bmatrix}$` reads as `adj = [5, -4; -2, 6]`. Matrices
are the commonest maths in the Grade 10 lessons, and `\\` was the one command whose old fallback
emitted a backslash, against the module's own stated rule. This changes the WhatsApp body path
(`bd-lafr9`) the same way, for the better.

Upstream carries none of this yet. Push `diagrams/index.js` + `diagrams/lib/tex.js` up at the next
re-sync.

### 3.13 `lint_lp.js` — `overlayTargets()`: the lesson's title, and figure labels (2026-09-14)

Two decisions inside `overlayTargets()` left English on an otherwise Urdu page, on the first Urdu
lessons this lane delivered (d04/d05/d06, 2026-09-05). Both are fixed here (`bd-x3dn6`, `bd-8g1u7`),
and both are changes to **which pointers the overlay is allowed to carry** — nothing else moves. The
overlay-writing pass in `lp612-author.service.js` sees only the pointer→English map, so widening the
target set is the whole lever; no prompt, no schema and no renderer change goes with it.

**`bd-x3dn6` — `/provenance` was skipped whole.** `OVERLAY_SKIP_ROOTS` dropped the entire block.
That is right for what most of it holds — publisher, curriculum, edition, the operator's
`source_quality_flags` about the scan — because a translated citation no longer matches the book on
the teacher's desk. It is wrong for `topic`, which is not citation at all: it is the lesson's TITLE,
drawn at four sites in `lib/template.js` from one pointer (the document `<title>` :2474, the hero
:1589, the page-2 head :2184, the running header of every continued page :1512). «Rational and
Irrational Numbers» headed a page that was otherwise 74% Urdu. `chapter` and `chapter_title` join it
for the same reason. The root is now narrowed to `["/video", "/revisions", "/ur_overlay"]` and
`/provenance` is gated per field by `OVERLAY_PROVENANCE_KEYS = {topic, chapter, chapter_title}`.

`subject` is deliberately excluded. `SUBJECT_NAMES_UR` / `subjectNameFor()` in
`bot/shared/config/lp612-subject-order.js` already produce the Urdu subject name the WhatsApp
caption prints (`bd-63dea`); a model translating it a second time is how the caption and the PDF
header end up disagreeing about what the subject is called.

`lib/overlay.js` needed no change — `applyOverlay` never froze `/provenance/topic`, so the linter's
target list was the only thing standing between the pointer and the render.

**`bd-8g1u7` — figure labels were never targets.** Not because a rule excluded them, but because
`isInstructionProse` wants ≥ 8 characters AND two runs of two-or-more Latin letters, and a label is
a short single word by nature: `Nucleus` fails on length, `p_photon` fails on word count, `p_e-`
fails on both. So an Urdu physics lesson kept every English label in its figures — arguable for a
symbol, not for a bio schematic or a flow chart. `walk()` now carries two facts down the tree:
whether it is inside a diagram `spec`, and which display key the current string hangs off
(`DIAGRAM_DISPLAY_KEYS` = label, labels, text, title, caption, note, alt, name). Inside a spec, and
only there, a display string may be a single word.

`isDiagramLabel` is what keeps notation out: a string carrying `_` or `^` is a symbol, and one with
no run of three Latin letters is not a word. The fields a renderer PARSES rather than prints — tex,
smiles, equation, formula — are not display keys at all and stay frozen through `MACHINE_KEYS` and
`frozenReason`. The display-key check also has to bypass the `OVERLAY_SKIP_KEYS` shortcut in the
object walk, because `name` is on that list for a brand and a font and is also what several diagram
types call their label.

Covered by `tests/lp612/overlay-urdu-chrome.test.js` (8 tests), including the negatives: citation
metadata, `subject`, a physics symbol, the machine fields, and a short label outside a spec.

Upstream carries neither fix. Push both hunks up at the next re-sync.

### 3.14 `lib/template.js` + `render_lp.js` — the page format is an argument (2026-09-17)

v9.3 moved the layout from A4 to a 520x2000 phone page and froze it in a constant, with a comment
saying what would have to happen for that to change:

> A printable render changes this by passing a format, once the parameter exists — never by
> changing what v9.3 means.

This is that parameter, added for the Grades 1-5 lane. The operator's page map for primary is
drawn on A4 — three tables side by side across the top of page 1 — while what a teacher receives
is still the one-column phone page. Her decision was to keep both: *"Both — A4 to review, phone to
deliver."* One `lp_doc`, two renders.

**The default did not move.** `buildHtml` with no `format` lays out on `phone`, byte for byte as
before: re-rendering the G4 English segment after this change reproduces the v9.5 baseline exactly
(85 / 67 / 54 / 96 / 83 / 55 / 41 % full, 7 PDF pages, the same PAGE COUNT failure). `--format a4`
is the only way to get the other geometry, and an unknown name is refused rather than defaulted.

**What changed**

1. `PAGE` and the five lengths derived from it (`PAGE_INNER_W`, `FULL_COL`, `DIAGRAM_MIN_PX`,
   `FIG_GROW_MAX`, `PAGE_CONTENT_H`) became `let`, reassigned together by one new function,
   `setPageFormat(name)`. Together is the point: a format change that moved some of them and not
   others would have the layout measuring against a page it is not drawn on, and the only symptom
   would be content overflowing for no visible reason. `FIG_CHROME`, `FULL_COL_A4` and
   `DIAGRAM_MIN_PX_A4` are absolute or A4-referenced and deliberately do NOT move. `pageScaled` is
   an arrow function that already read `PAGE` live and needed no change.
2. `buildHtml` calls `setPageFormat(opts.format || "phone")` as its first act, before `css()` — the
   `@page` rule and every measured atom are downstream of it — and RETURNS the geometry it used as
   `result.page`, so no caller has to assume.
3. The six moving lengths are exported as **getters**, not values. `module.exports = { PAGE }` copies
   the number once at require time; `lint_lp.js` destructures `FULL_COL` and `DIAGRAM_MIN_PX` lazily
   inside a function, and would otherwise have measured diagrams against a page the document was not
   built on.
4. `render_lp.js` takes `--format phone|a4`, threads it through **both** `buildHtml` calls (the
   measure pass and the repaginating rebuild — the rebuild re-enters the template, so omitting it
   there would reset the geometry halfway through a two-pass render), and receives the page box as a
   new `geom` argument to `renderWithPlaywright` for the Chromium viewport and the PDF size.

   The argument is not decoration. `render_lp.js` destructured `PAGE` at require time, so once the
   format became selectable the imported binding froze on whatever the first build used — a viewport
   and a PDF box silently disagreeing with the `@page` rule inside the HTML. A getter does not rescue
   a require-time destructure; passing the value does.

**Why this is safe to hold as a divergence rather than pushed up.** It adds a parameter and changes
no default. Upstream is on a different page geometry question entirely (it still renders A4), so the
merge conflict at the next re-sync is one hunk around the `PAGE` declaration.

`PAGE_FORMATS.a4` was already present in v9.5 as a named reference and its two-column code paths
(`PAGE.oneColumn`, the `.grid2` / `.grid3` templates, the `half`+`half` pairing at `page2`) are live,
not dead — which is why A4 renders correctly rather than needing a layout rebuild. Recomputing for
A4 lands on the module's own kept anchors exactly (`FULL_COL` 729 = `FULL_COL_A4`, `DIAGRAM_MIN_PX`
13.5 = `DIAGRAM_MIN_PX_A4`), which is the strongest available check that nothing was left behind.

Covered by `tests/lp612/page-format.test.js` (12 tests): the default is unchanged, every derived
length moves together on both formats, the `@page` rule and the returned geometry agree, the format
survives a repaginating rebuild, an unknown format throws `BAD_FORMAT` and leaves the geometry
untouched, and `oneColumn` drives the three-up grid. The full `tests/lp612` run is unchanged
suite-for-suite apart from this new one.

### 3.15 `lib/template.js` — the `:root` palette wears the NIETE brand (2026-09-17)

**What changed.** Six token values in the `:root` block, and nothing else. No rule, no selector, no
length, no block moved.

| Token | v9 | NIETE | Where it shows |
|---|---|---|---|
| `--navy` | `#0B2545` | `#303749` | masthead, landmark blocks, **Development band** |
| `--navy2` | `#13315C` | `#2A3550` | `--s-teach-ink` — the label on every teach surface |
| `--leaf` | `#1F7A4D` | `#298157` | **Activity band** |
| `--s-do` | `#EFF7F2` | `#DEF4E7` | the fill under every pupils-work block |
| `--s-do-line` | `#BFE3CD` | `#B5E3C9` | its hairline |
| `--s-quiet` / `-line` | `#F5F7FA` / `#E1E6EE` | `#EDEFF3` / `#E6E9EE` | neutral furniture, rows, metadata |

**Why.** Operator, on the HTML render beside the kie.ai one: *"keep the HTML good parts like the
moves colours, etc, keep the kie.ai NIETE colours thouggh"*. Two instructions that pull on different
things, so they are held apart. The **moves** are a system — seven bands, seven colours, each ≥15 dE
from the other six and ≥4.5:1 under the white name it prints. That system is v9's and it is
untouched. The **brand** is which colours the system is drawn in, and that is now kie.ai's, read off
the rendered G4 English page: ink `#303749`, green `#43A477` with `#298157` for its dark, green tint
`#DEF4E7`, slate tint `#E6E9EE`.

Only the two brand-bearing bands moved. Rose (`--band-w`), teal (`--band-i`), plum (`--band-c`),
amber (`--s-note-ink`) and grey (`--mut`) are move colours with no kie.ai counterpart, so they are
byte-identical to upstream.

**The two floors, re-measured after the swap, not assumed:**

- white-on-band ≥ 4.5:1 — every band clears. The new floor is Activity at **4.80** (was `--leaf`
  at 5.53). Development rises to **11.88**.
- pairwise ≥ 15 dE in CIE L\*a\*b\* — every pair clears. The closest is now
  **19.3** (Development/Homework); it was 21.2 (Introduction/Homework).

`readability-blocks.test.js` computes both from the resolved sheet, so it is the check, not a
restatement of it. Its `BAND_VALUES` table is a snapshot of the token hexes and was rewritten for
the three that moved, with a comment saying which is the property and which is the snapshot.

**What deliberately did NOT change.** `--amber` stays `#F2A20C` for the I-DO tag — operator: *"I DO
Teacher Model tag on the right in the amber colour like the html"*. kie.ai's panel gold `#FFD05E` is
a **separate** colour and was not a token at the time of this entry, because no rule consumed it. It
became `--board-gold` in §3.16, which is the one rule allowed to print it.

**Re-vendoring.** Drop this whole hunk and take upstream's `:root`. Nothing outside it depends on
these values — every consumer reads `var(--…)`.

### 3.16 `lib/template.js` + `lib/overlay.js` + `schema/lp_doc.schema.json` — the board is drawn as a board, and a practice item is two rows (2026-09-17)

> **CORRECTION (bd-xsuwz, 2026-09-18).** This title named `schema/lp_doc.schema.json` for an edit
> that was never made: `board.panels` and `board.title` were absent from the schema until §3.27, so
> the CLI refused every primary document for a day. The renderer half of this entry is accurate.

**The ask.** Operator, on the first primary (G1-5) HTML renders:

> *"the write on the board should be rendered, it cant be in html? heading colour anf formatting
> should be differenyt / its a block of text that should show clearly how it should be ordered rather
> than give a script of what to draw and how / the practice sectionbs are too texty, how can we
> render appropriately on html?"*

**"it cant be in html?" was a bug report, not a capability question.** Stage-C authors
`boardWork.content` AS A BOARD: blank-line groups, each with its own heading, in the order they go up.
It reached the renderer as one string in `board.text`, and **HTML collapses `\n` to a space** — so all
38 authored boards in the G4 Ch9 corpus printed as 38 run-on paragraphs. Nothing was ever missing from
the data. The newlines *were* the layout, and the renderer dropped them.

**Four changes.**

| File | Change |
|---|---|
| `schema/lp_doc.schema.json` | the `board` variant gains optional `title` and `panels` (`panels[].label?`, `panels[].rows[]`, each row exactly `{text}` or `{term,gloss}`). `text` stays required, so every stored document is still valid and `ur_overlay` pointers still resolve. |
| `lib/template.js` | `board` renderer prints `panels` when present, `text` otherwise; `.board` CSS is re-shaped off the surface ladder; `boardPlanAtoms` drops `draw_order` when the flow lays its board out; `practiceItem` splits into a question row and an answer row; `faded_example`'s `prompt` becomes a list. |
| `lib/overlay.js` | `board` label: "On the board" → **"Write on the board"**, `تختۂ سیاہ پر` → `تختۂ سیاہ پر لکھیے` (imperative, matching `خیال رکھیے` in the same table). It is the only place the teacher is told to pick up the chalk. |

**`.board` is deliberately OFF the surface ladder.** The ladder (§ the `readability-blocks` docblock)
says a block picks a ROLE not a colour, and that a re-colour may move **fill, line and case only** —
no padding, no border width, no font size — because the teach part renders at 99-100% of its cap. This
block breaks that, and the exemption is argued rather than assumed: it is the only block in the
document that describes a **physical object in the room**, so it is drawn as one, inverted on both of
the ladder's axes.

- **FILL** — white inside a `2px` navy frame, where every other block is a tint inside a `1px`
  hairline. It is the surface she writes *on*, so it takes the colour of a surface, not of a category.
- **LABEL** — `--board-gold` (`#FFD05E`, new token, kie.ai's panel gold) on a filled `--navy` bar.
  No other `.lbl` in the sheet has a bar, and that is the difference visible from across the room.
  It **has** to be a bar: gold measures **1.45:1 on white** and cannot be legible as bare text;
  on navy it is **8.16:1**. So the contrast constraint and her "formatting should be differenyt" land
  in the same rule.
- **ORDER** — a numbered chip gutter down the start edge. A chip is a panel's place in the build, so
  it counts panels, never rows. The two columns inside a panel align every gloss.

**The draw SCRIPT stops printing.** `page2.board_final.draw_order` ("Draw the five-line cinquain
ladder and the grammar choice arrows") narrates a board. `boardPlanAtoms` hoists it into the teach
part directly under the Introduction's own board — so once that board is *printed in build order*,
the page carries two accounts of one board, one of them prose. `laidOutBoard(doc)` now suppresses the
`draw_order` atom whenever any block in the flow is a `board` carrying non-empty `panels`. The
`diagram` atom is untouched: a picture is not a duplicate of a word list.

This is a **renderer** suppression, not a D0 one, and that is the point. `page2.board_final` is a
**required** property; a grade band that stopped emitting it would be asking the schema to bend for
one band. G1-5's D0 still emits it from `boardWork.instruction`, so it is there for lint and for
Stage C — it simply has nowhere left to print. The rule is not primary-specific either: any document
that lays its board out gets the same drop, and any document that does not keeps its authored order.

**PRACTICE was `q` and `a` on one flowing line** joined by an arrow. Two measurements on the corpus:
306 problems across the 38 lessons, of which **93 open with a citation glued to the front of the
prompt** ("p.104, Pinky's Poem Puzzlers 1: Which dance is matched with…"), which pushed the question
itself onto a second line. The citation now rides in `ref` — structure the schema **already** defined,
so nothing was extended — rendered as a chip floated to the end of the question row. The answer is its
own row: indented `25px`, behind a `2px --s-do-line` rule on the reading edge, under an uppercase
ANSWER label in `--s-do-ink`. `faded_example`'s `prompt` got the same treatment: it is authored as
` · `-separated setup steps, so it prints as a list rather than one line of middots.

`.arow`, not `.ar`: **`.ar` is already the Arabic-script line-height rule** (one bare global selector),
and `nastaliq-ltr-metrics.test.js` asserts a document with no Urdu in it emits no `.ar{` at all. The
new suite re-asserts that, so a future rename cannot quietly squat on it again.

**PAGE COST — measured, not assumed.** All 38 G4 Ch9 lessons, phone format, pre-change docs on the
pre-change template vs. post-change docs on this one:

| | teach pages | support |
|---|---|---|
| before | 259 | 38 |
| after | **268** | 38 |
| delta | **+9 (+3.5%)** | 0 |

Ten lessons grew by one page. One (`English_seg1`, 6 → **5**) *lost* one, because dropping the draw
script bought back more than the taller board cost. **0 of 38 were inside the 4-page teach cap before
this change and 0 are after it** — the worst went 11 → 12. The over-cap wall is the I-Do and You-Do
prose, which this entry does not touch; it is not evidence about this change either way, and it is
stated here so the number above is not read as the cause.

**Tests.** `tests/lp612/board-panels-practice-rows.test.js` (16, new): a `text`-only board is
byte-for-byte what it was and keeps its authored `draw_order`; panels print in authored order behind
panel-counting chips; title and panel headings are not panels; `{term,gloss}` lands in two columns and
`{text}` spans both; `text` still serves as the fallback; the `draw_order` drop is keyed on `panels`
and an empty array does not count; the label is gold-on-navy and never gold-on-white; the heading says
WRITE on the board in both languages; a practice answer is its own labelled row with the rule on the
reading edge in both scripts; the citation is a chip, not the first words of the question.

Two existing suites moved with the labels, and only with the labels:
`readability-blocks.test.js`'s leaf list (`ON THE BOARD` → `WRITE ON THE BOARD`; the leaf/group rule
is unchanged) and nothing else. `nastaliq-ltr-metrics.test.js` is green without modification. Full
`tests/lp612`: **34 failed / 126 passed, suite-for-suite identical to the §3.15 baseline** — no new
failure, and the two this change first reddened are the two fixed above.

**Re-vendoring.** Four hunks to re-apply, all marked `VENDOR DIVERGENCE (SYNC §3.16)` at the site:
the `:root` `--board-gold` line, the `.board` CSS block, the `board` renderer with `laidOutBoard`, and
`practiceItem` with its `.pr` rules. The schema hunk is additive and optional-only. The two label
strings in `overlay.js` are one line each.

### 3.17 `lib/template.js` + `lib/overlay.js` + `schema/lp_doc.schema.json` + `render_lp.js` — the script is turns, one row each (2026-09-17)

> **CORRECTION (bd-xsuwz, 2026-09-18).** As §3.16: this title named the schema for an edit that was
> never made. `worked_example.turns` and `faded_example.turns` were absent until §3.27. The
> renderer half of this entry is accurate.

**The ask.** Operator, on the primary renders from §3.16:

> *"how can we further reduce the text dump? be creative and volley design based questions for lps
> that can be rendered on html"*

Four design questions went back, and her answers are the spec this entry implements:

| Question | Her answer |
|---|---|
| the heavy script (40 strings, 24% of the words) | **two-column call-and-response** |
| practice answers | **always visible, both views** — not a `<details>`, not a separate answer key |
| say vs. narrate | **keep the quote, chip the action** |
| plan shape | **one continuous plan, as today** — and raise the teach cap 4 → 9 for primary |

So the reduction is **SCAN COST, not word count**. Nothing here is hidden, collapsed, moved to the
support sheet or deleted; the 8,095 words of practice stay on the page and the script keeps every
word it had. What changes is that a paragraph becomes rows.

**THE MEASUREMENT CAME BACK AGAINST THE COLUMN, and the column is what she asked for.** Over the
38-lesson G4 Ch9 corpus, a move's script prints as **228 paragraphs of a median 10 sentences**
(max 28). Parsed (`curriculum/g1-5-resegment/d0_script.py`) the same words are **1,203 turns**, of
which **954 reach this renderer** — D0 scripts I-Do and We-Do, while You-Do's steps become
`practice` items where the question already *is* the row, and 68 dialogue frames join that no `say`
string holds. Of those 954, **7 carry an answer the script actually supplies: 0.73%.** (0.67% on the
1,203; the two populations agree.)

A column reserved down the page would therefore narrow **all 954 rows to serve seven**. So the
answer rides **its own row at the reading edge**, under the turn it answers, and the
**TEACHER / CLASS heads print only on a block that has one** — which is her call-and-response,
sized to the corpus instead of to the diagram. An `ask` the script does not answer gets a **ruled
waiting space**, never a guess: the plan does not know what this class will say, and a proxy printed
there is a lie in the one place she is about to check a child against.

**ONLY THE EXCEPTIONS ARE MARKED.** 682 of the 954 (71.5%) are plain speech. Boxing them spends a
border on five rows in seven and leaves the eye nothing to land on — the text dump again, with lines
drawn on it. So a `say` row is bare text and costs no vertical space at all, and the five kinds that
are **not her voice** each carry exactly one mark, fill/line/case only (the v9.4 surface ladder — no
new padding, border width or font size):

| kind | turns | mark |
|---|---|---|
| `say` | 682 | CSS quote marks, `“…”` / `‘…’`, nothing else |
| `frame` | 99 | white card, **dashed** border — the blank is the point |
| `do` | 76 | `▸` caret, `--s-do-ink`, no quotes — a stage direction, not a line to read |
| `ask` | 70 | 2px `--s-teach-line` rule at the reading edge; the row she stops on |
| `calc` | 26 | white card, `tabular-nums` — digits line up or the sum is harder to read than to do |
| `routine` | 1 | one box, one uppercase name, steps inside — CUBES is ONE thing she knows |

**Speech carries its quote marks in CSS, not in the string.** Her ruling was *"keep the quote, chip
the action"*: the marks are what make a row read as her words, but stored in the text they would ride
into Stage E's voicenotes and the WhatsApp body, which want the sentence and not its punctuation
furniture. `::before` / `::after`, flipped to `‘ ’` for Urdu.

**Five changes.**

| File | Change |
|---|---|
| `schema/lp_doc.schema.json` | `worked_example` and `faded_example` gain optional `turns` (`kind` ∈ say/do/ask/frame/calc/routine, plus `text`/`parts`/`expect`/`ref`). `steps` stays required, so every stored document is still valid and `ur_overlay` pointers still resolve. |
| `lib/template.js` | new module-scope `script(b, rich, L)`, called by both example renderers; ~55 lines of CSS for `.scr` / `.tn` and the six `k-` kinds; `.tn .tx, .tn .pl, .tn .rn` added to the RTL `unicode-bidi:plaintext` list. |
| `lib/overlay.js` | `teacher` / `classSays` in both label tables — "Teacher" / "Class says", `استاد` / `جماعت کہتی ہے`. The two column heads, named once per block that has an answer. |
| `render_lp.js` | `pageCapsFor(lang)` → `pageCapsFor(lang, doc)`, with a primary cap table and `isPrimary(doc)`. |

**`k-say`, not `say` — the collision is real and it is why every kind is prefixed.** Three of the six
kind names are **already v9 BLOCK classes**. `.say` is the blue say-aloud box (`border-inline-start:4px
solid --s-teach-line; background:--s-teach; padding:7px 13px`), so an unprefixed `<div class="tn say">`
would have put **every one of the 682 speech rows** inside a 4px-ruled, 13px-padded blue box — and
blown the cap doing it. The namespace is asserted in both directions by the suite: the block rule
still exists with its padding, and no `tn say` is ever emitted.

**G6-12 IS UNTOUCHED BY CONSTRUCTION, not by promise.** `script()`'s first branch is
`if (!turns) return <ol>…steps…</ol>` — byte-for-byte the old body. No G6-12 document emits `turns`,
so every one of them takes that branch, and `v9_gate_base.lp.json` sits in the new suite as the
control that proves it.

**PRIMARY TEACHES FROM A LONGER PLAN, and that is the operator's decision.** The 4-page ceiling was
measured on G6-12, where the plan is a board-exam brief for a subject teacher who already knows the
content. A primary plan is a different document with a different reader: one teacher takes every
subject, the script is what she actually says, and the 2026-09 format survey found primary teachers
asking for **more** script, not less. A cap tuned to the shorter document would have forced exactly
the deletion she ruled out.

| | teach | warn | support |
|---|---|---|---|
| G6-12 en / ur (unchanged) | 4 / 5 | 3 / 4 | 3 / 4 |
| **primary en / ur** | **9 / 12** | 8 / 11 | 3 / 4 |

`isPrimary()` reads `provenance.grade`, never a flag the caller passes: the cap that applies is a
property of the plan, not of the invocation, and a `doc`-less call keeps the conservative G6-12
ceiling so every existing `pageCapsFor('en')` test passes untouched. The Urdu numbers are
`round(9 × 1.33)`, the same Nastaliq premium the G6-12 UR caps already carry. Support stays at 3: her
page map ends the plan at the close (*"coming in can go"*) and primary's page2 surfaces are mostly
dark by design, so raising it would only give content somewhere to hide.

**PAGE COST — measured, not assumed.** All 38 G4 Ch9 lessons, rendered on **this** template twice:
once with `turns` stripped from the documents, once with them. Same template, same documents, so the
delta isolates `turns` alone rather than carrying §3.16's changes with it.

| | teach (phone) | teach (A4) | support |
|---|---|---|---|
| before | 268 | 427 | 38 |
| after | **276** | **451** | 38 |
| delta | **+8 (+3.0%)** | **+24 (+5.6%)** | 0 |

Phone median is 7 pages, and **five lessons crossed her 9 by exactly one page** (`English_seg6`,
`English_seg10`, `Maths_seg11`, `Science_seg2`, `Science_seg9`, all 9 → 10). A sixth, `Maths_seg9`,
was at **12 before this change and 12 after** — it holds the 236-word monologue that is the heaviest
string in the corpus, and it is over cap for reasons this entry does not touch. **Those six renders
fail the cap, and that is the cap working**: over cap fails, it never trims. Five of the six are one
page of packing away from passing, which is `bd-3w7nv`, not a reason to move the number she chose.

**The A4 column above is not a cap finding, and must not be read as one.** `oneColumn:false` shapes
the hero, `.split`, `.secrow`, `.se`, `.p2head` and the page2 grids — it is **not** a page-wide
two-column flow, so sections stack full width in both formats. An A4 content box is **1,109px** tall
against phone's **1,986px**, which makes the same document ~1.8× more pages by geometry alone. 33 of
38 exceed 9 on A4, **before** this change as much as after, and G6-12 exceeds its own 4 there too.
One cap number cannot govern both formats; today's is a phone number. Filed, not patched here.

**Tests.** `tests/lp612/script-turns.test.js` (26, new): a document with no `turns` — and one with
`turns: []` — renders exactly as it did, from the G6-12 fixture as control; the script becomes one
row per turn in authored kind order; the flat `steps` do **not** also print while staying in the JSON;
no word is lost; the `.say` block rule survives with its padding and no `tn say` is emitted; quote
marks are in the CSS in both languages and flip for Urdu; the `do` caret and ink, the `ask` rule
flipping edge by language, the `frame` dash, the `calc` `tabular-nums`; the ladder moves fill, line
and case only and the sheet still emits no `.ar{`; a routine stays one turn; the response is on the
row — heads only where something answers, the pill, the `text-align` flip, the ruled `.wait` for an
unanswered ask, and **no `grid-template-columns` on `.scr`**; a trailing page citation is a chip; both
languages name the two edges. `page-cap-policy.test.js`'s invariant (each WARN exactly one page under
its own cap) holds for all four tables unmodified.

Full `tests/lp612`: **34 failed / 127 passed** suites against the §3.16 baseline of 34 / 126 — the one
added passing suite is this one, and no suite that passed before fails now.

**Re-vendoring.** Four hunks to re-apply, each marked `VENDOR DIVERGENCE (SYNC §3.17)` at the site:
the `.scr` / `.tn` CSS block, the `.tn` entries in the RTL plaintext list, module-scope `script()`
with its two call sites, and `render_lp.js`'s primary cap table with `isPrimary` / `pageCapsFor`. The
schema hunk is additive and optional-only; `overlay.js` is two lines, one per table.

### 3.18 `lib/template.js` — a worked example may break BETWEEN TURNS, and says so when it does (2026-09-17)

**The ask.** Two operator messages, in order:

> *"the pages should not be more than 4 pages on html pls, possible or not?"*

> *"21 px is non negotiable, what can be fixed in the design?"*

The honest answer to the first is **no** — not at 21px, and not without deleting words she has
already ruled out deleting (§3.17). So the second message is the brief this entry implements: type
size is fixed, the words are fixed, and what is left to work on is the part of the page that is
neither — furniture and blank.

**WHERE THE BLANK WAS, and it was not distributed.** Over the 38-lesson G4 Ch9 corpus at 21px a
`.blk` is **86% of all content height** and tops out at **2,500px against a 1,986px page box**. The
two example blocks are the whole story:

| block | median height | over the ~493px a page typically has left at its foot |
|---|---|---|
| `.exq.we` (WE-DO, faded example) | **1,490px** | **30 of 30** |
| `.exq` (I-DO, worked example) | **723px** | **50 of 60** |

Together they are **45.7 pages of the corpus's 256**. As ONE atom a block like that demands a page
of its own and then overflows it — and the section bar glued in front of it cannot join it, so
`glue`'s stand-alone escape hatch strands the bar on a sheet by itself. `English_seg6` p6,
`English_seg10` p5, `Maths_seg11` p5, `Maths_seg9` p7 and `Science_seg2` p6 each printed a
continuation strip, a section bar and a footer over an otherwise empty page, **6% full**. The
never-orphan-a-heading rule was producing the most orphaned heading the document can hold.

**`packAtoms` IS NOT AT FAULT and must not be "fixed".** It is an exact DP and is page-optimal *for
the atoms it is given*; it cannot put half a block into a hole because there was no half block. The
lever is atom GRANULARITY, exactly as `practice` (v8.1) and `homework` (`bd-x4xxm`) already use it.

**WHERE IT MAY BREAK IS A PEDAGOGY DECISION, NOT A LAYOUT ONE** (operator, 2026-09-17): between
TURNS, never between a prompt and the thing that answers it. A turn's `expect` pills live inside
that turn's own `.tn`, so an `ask` can never be separated from its response row — the seam is only
ever the 2px gap `.scr` already draws between two turns. The tag and the setup stay glued to turn 1
so a page can never open on a bare line of speech, and the closing `res` / `answer` travels in the
same atom as the last turn so a result can never be stranded from the work that produced it.
**Four turns is the gate**: three rows or fewer already fit the median 347px tail whole, so
splitting them would buy nothing and cost a seam.

**N PIECES PAINT WHAT ONE CARD PAINTED.** `.blk` is `margin:0` with no box of its own; the box is
`.exq`. The pieces carry `.pc-a` / `.pc-m` / `.pc-z`, which open the border and radius at each seam
and zero the padding there, and they butt at `sp-0`. The only visible difference from an unsplit
card is that 2px `.scr` gap — 2px of amber against amber.

**AND THE CARD SAYS SO WHEN A BREAK LANDS ON A SEAM.** `.foot` is every page's last child, so a
piece sitting second-to-last is the one the break cut; a piece following the continuation strip or
a repeated section bar is the one it resumed on. Those two `.pad`-level rules draw a dashed edge;
`.pc-z` is excluded, so a card that genuinely ended still closes solid.

**The dash is the SURFACE'S OWN INK, and the first cut of it could not be seen.** It was written as
`1px dashed var(--s-note-line)` — #F0DFB4 on `var(--s-note)` #FFF8E8, amber on amber. The rule
fired, the suite passed, and on the rendered page the card simply stopped above the footer. It is
now `2px dashed var(--s-note-ink)` (#8A5F04) for I-DO and `var(--s-do-ink)` (#14603A) for WE-DO,
verified on the render and not only in the sheet. **A signal that cannot be seen is not one.**

**THE SEAM COSTS 5px AND THE PACKER DOES NOT KNOW IT (`bd-sor95`, P2, filed not patched).** Which
piece lands on a page edge is decided *after* the atoms are measured, so whatever these rules add is
spent on a page that is already full. Raising the dash to 2px first clipped `English_seg6` t3 by
1px — it had packed to exactly 1941/1941px. The seam is therefore **capped at 5px total (2px border
+ 3px padding)**, strictly cheaper than the 6px the 1px version spent, so no page can regress. That
is a budget, not a fix: the packer should know the cost, and `bd-sor95` says so rather than
pretending the cap is the answer.

**G6-12 IS UNTOUCHED BY CONSTRUCTION.** `blockAtoms` reaches `exqAtoms` only through
`Array.isArray(b.turns) && b.turns.length >= 4`, and no G6-12 document emits `turns` at all — every
one of them takes the single-atom path and `scriptRows`'s flat-`<ol>` branch, byte-for-byte as
before. `v9_gate_base.lp.json` sits in the new suite as the control that proves it.

**One file.**

| File | Change |
|---|---|
| `lib/template.js` | `scriptRows(b, rich, L)` split out of `script()` — returns `{head, rows}`, or the flat `<ol>` string for a document with no `turns`, which is the G6-12 branch; new `exqAtoms(b)` emitting `pc-a` / `pc-m…` / `pc-z`; `blockAtoms` gains the four-turn gate; ~19 lines of CSS for `.pc` and the four `.pad`-level seam rules. |

**PAGE COST — measured on all 38 lessons, phone, against §3.17's own recorded baseline.**

| | teach (phone) | median | over the 9-page cap |
|---|---|---|---|
| §3.17, before this entry | 276 | 7 | **6** |
| **after the split** | **256** | **6.5** | **1** |
| delta | **−20 (−7.2%)** | −0.5 | −5 |

Five of the six lessons that failed §3.17's cap now pass it — `English_seg6` 10 → 8,
`English_seg10` 10 → 9, `Maths_seg11` 10 → 9, `Science_seg2` 10 → 8, `Science_seg9` 10 → 9 — and
the content-free pages are gone. `Maths_seg9` is 12 → 11 and **still over cap, which is the cap
working**: over cap fails, it never trims. It holds the 236-word monologue that is the heaviest
string in the corpus and it is over for reasons this entry does not touch (`bd-rjt3x`). Mean teach
page fill is **86.1%**, with 80 of 256 pages under 85% — and a part's last page is expected to be.

**Tests.** `tests/lp612/exq-split-atoms.test.js` (20, new): a document with no `turns` — and one
with three — renders as one atom, from the G6-12 fixture as control; a four-turn block becomes
`pc-a` + `pc-m` + `pc-z` in authored order with the tag and setup glued to the first piece and the
result travelling with the last; no turn is split from its own `expect`; the pieces butt at `sp-0`
and open exactly the edges they share; the four `.pad`-level seam rules exist and name
`--s-note-ink` / `--s-do-ink`, not the hairline tokens that could not be seen; `.pc-z` is excluded
from the cut-edge rule so a finished card closes solid. Full `tests/lp612`: **34 failed / 128
passed** suites, 22 failed / 5 skipped / 1,690 passed tests — the added passing suite is this one,
and no suite that passed before fails now.

**Re-vendoring.** Three hunks, each marked `VENDOR DIVERGENCE (SYNC §3.18)` at the site: the
`.exq.pc` CSS block with its four `.pad`-level seam rules, `scriptRows()` split out of `script()`,
and `exqAtoms()` with the four-turn gate in `blockAtoms`.

### 3.19 `lib/template.js` + `curriculum/g1-5-resegment/d0_board.py` — nothing on the board runs off the sheet (2026-09-17)

**The defect.** `bd-59vvo`, P1, found by the visual half of the operator's own instruction
*"go ahead, test its ui/ux first and then render only 1"*. On `English_seg6` p2 the WRITE ON THE
BOARD panel laid itself out **wider than the page** and printed its entire gloss column off the
right edge. This is the one block the teacher copies onto a real board, so a clipped column is a
lost one — she cannot chalk up what the page did not print.

**TWO CAUSES, TWO HOMES, and the CSS half alone was not enough.** The first cut fixed the grid and
the text stopped clipping; the frame brackets still ran off-page, because they were never layout at
all — they were characters in the source data.

| Home | Change |
|---|---|
| `lib/template.js` | `.board .bb{ grid-template-columns:max-content 1fr }` → **`fit-content(50%) minmax(0,1fr)`**, and `.board .bp{ …18px 1fr }` → **`…18px minmax(0,1fr)`**. |
| `d0_board.py` | new `_BOX` + `_unbox()`; `_panel()` lifts an opening framed title to `panel["label"]` and drops a rule that carries nothing. |

**Why the tracks were wrong.** `max-content` sizes the term column to the LONGEST term and refuses
to shrink; a bare `1fr` floors at the gloss's own min-content. So a board whose terms are whole
sentences — *"Jojo \_\_\_\_\_ to eat pizza on Fridays."* — makes two tracks that together exceed the
panel, and the overflow is the second one. `fit-content(50%)` caps the term column and lets it wrap;
`minmax(0,1fr)` lets the gloss shrink into whatever is actually left. **Both tracks together can now
never exceed the panel**, which is the property a board must have.

**The data half: an ASCII frame is a drawing of the box the renderer already draws.** Ten of the 38
corpus boards frame a panel in box-drawing characters — 15 framed panels and 23 rows drawn from
the block, 11 of them bare rules carrying nothing at all. A 60-character run of U+2500 has **no break opportunity in it**, so the frame itself
sets the panel's minimum width and no CSS can save it. It is also not content: the title inside it
is the panel's own label, for which the render already has `.bhd`. So `┌── Apostrophe Alley ──┐`
becomes `panel["label"]` → **APOSTROPHE ALLEY** as a real heading, and `└──────┘` is dropped.

**A FRAME TOUCHES A LINE EDGE — and the first cut of `_unbox` did not know that, and deleted
content.** It took every run in the block, and `──>` is drawn from that same block: the corpus uses
it 15 times to point one thing at another. Rebuilding the 38 documents showed 15 arrows mangled into
a bare `>` and **three whole panels gone** — `[Question] ──> [KEY words/phrase] ──> [Main point]` is
one line, so stripping its runs left nothing and `_panel` returned `None`. A frame is at the START
or the END of its line; an arrow points BETWEEN two things the author wrote, which is exactly why it
never sits at an edge. `_unbox` now strips a run only when a non-arrow run touches a line edge, and
never a run that abuts `>`/`❯`/`»` or `<`/`❮`/`«`. (`→ APPLY THE CLUE →` was safe throughout for a
second reason: U+2192 is not in the block.) Measured over the rebuilt corpus: **127 panels before,
127 after** — the first cut had 124 — **11 rows dropped and every one of them a bare rule**, 15
arrow rows intact, and **not one document loses a word.**

**G6-12 is untouched.** The `d0_board.py` change is upstream of the renderer in the primary-only
Stage-D0 transform, which no G6-12 document passes through. The two CSS lines govern `.board`,
whose panels only exist when a document carries `board.panels` (§3.16, additive and primary-only);
a G6-12 board still renders from `board.text` and neither track applies to it.

**PAGE COST — the board fix COSTS 2 pages, and that is correctness being paid for.** Same 38
lessons, phone, measured on top of §3.18's 256:

| | teach (phone) | median | over cap |
|---|---|---|---|
| §3.18 (split only) | 256 | 6.5 | 1 |
| + the two grid tracks | 258 | 7 | 1 |
| + the D0 frame strip | **257** | **7** | **1** |

The +2 is `Maths_seg3` 5 → 6 and `Science_seg1` 6 → 7: text that used to run off the sheet now wraps
inside it, and wrapped text is taller. Stripping the frames gives one page back (`Maths_seg9` 11 →
10) because 15 framed panels stop forcing their own minimum width. The arrow repair restored three
panels and eight rows **at no page cost at all** — 257 either way.

**Tests.** `tests/lp612/board-panels-practice-rows.test.js` gains one (17 total): neither track may
exceed the panel, `max-content` is asserted absent by name, and `.bp`'s gloss track is pinned —
written red against the old declarations and confirmed red before the fix was restored.
`curriculum/g1-5-resegment/test_d0_board.py` gains `TestATerminalFrameIsNotBoardContent` (6 of its
18): the title in the frame becomes the label, a rule carrying nothing is dropped rather than
printed, no word the author wrote is lost with the frame, an arrow banner is not box art, a frame
with nothing in it leaves no empty panel, and **a dashed arrow is an arrow and not a frame** — that
last one written red first against the corpus regression it names. D0 suite: **141 passed / 1
failed**, the failure a pre-existing `partnerActivity` schema mismatch in `test_d0_contract.py`
confirmed by temporary revert and unrelated to boards. Full `tests/lp612` after both entries:
**34 failed / 128 passed** suites, 22 failed / 5 skipped / **1,691** passed tests — §3.18's 1,690
plus this one.

**Re-vendoring.** One hunk in the vendor tree, marked `VENDOR DIVERGENCE (SYNC §3.19)`: the two
`grid-template-columns` declarations on `.board .bb` and `.board .bp`. `d0_board.py` is not vendored
— it is ours, in `curriculum/g1-5-resegment/`.

### 3.20 `lib/template.js` + `lib/overlay.js` + `schema/lp_doc.schema.json` + `render_lp.js` — page 1 of a primary plan is kie.ai's page 1, and a cap is a budget, not a sheet count (2026-09-17)

**The defect.** `bd-vbs5w`, P1. Shown the first HTML render of a G1-5 plan beside the kie.ai image
it replaces, the operator answered with five lines: *"why cant p1 be like kie.ai? its more visual,
and concise / materials should be indented bullets that go from left to right, no blank spaces /
you didnt create a table for videos after materials / Write on the board sould be concise and
pointed, / the kie.ai rendering should be adopted here with a larger font, possible or not?"*.
Her page map is explicit about what page 1 holds: *"kie.ai has a to Prepare list, it should be be
in one table the video resources in the other table and then the third shold carry the actual key
words of the day - this should all be on page 1"*, with *"the header should be as kie.ai as should
the Journey so far, Today and Coming up columns"*. **The answer to her question is yes** — at
19–23px written, which the v9.2 type scale renders at 22.17px and up, on a 21px body she has ruled
non-negotiable. The fourth line (the board) is not in this entry; it is still open.

| Home | Change |
|---|---|
| `lib/template.js` | `isPrimary(doc)` becomes an **exported predicate** (one copy of the grade test); `class="pri"` on `<html>` for a grade 1-5 document only; the primary page-1 stylesheet block; `const PRIMARY = isPrimary(doc)` in `page1()`; `videoRow(label)` + `kwTable` + the forked `resourcesCard`; the `drail` / `band` atoms, with `.seq` suppressed on primary. |
| `lib/overlay.js` | seven new labels in both tables — `journey`, `journeyNone`, `today`, `comingUp`, `toPrepare`, `videoRes`, `videoPending`. |
| `schema/lp_doc.schema.json` | optional `sequence.day` / `sequence.of` integers (`sequence` is `additionalProperties:false`, so the rail's own numbers had to be declared). |
| `render_lp.js` | `isPrimary` **imported** from `lib/template` rather than defined a second time; `pageCapsFor(lang, doc, format)` takes the sheet it is laying out on. |
| `curriculum/g1-5-resegment/d0_primary.py` | `sequence.day` / `sequence.of` emitted beside the existing `this` sentence. Ours, not vendored. |

**ONE GRADE TEST, ONE HOME.** `render_lp.js` had its own `function isPrimary(doc)` and so did the
template the moment page 1 started reading the same rule. Two copies of one predicate is how a plan
ends up **capped as primary and laid out as secondary**, which no test on either side would catch.
It lives in the template because `render_lp` requires that module and not the reverse.

**THE RAIL GETS NUMBERS, NOT A SENTENCE TO RE-PARSE.** `sequence.this` is `"Day 6 of 10"`, and the
rail draws one pip per day with the current one filled. Re-reading that string in the renderer would
be a second reading of one fact in a second language, so D0 writes `day` and `of` as integers. `this`
stays: it is what prints **instead** of the rail when the chapter is too long to draw pips for, which
is also why both numbers are optional — a document with neither is the document it was before.

**"NO BLANK SPACES" WAS A MEASUREMENT, and it cost fourteen pages before it was found.** The
furniture as first built took the corpus from **257 to 271** teach pages and put **three** lessons
over the 9-page cap instead of one. An A/B that turns off only the page-1 furniture (leaving the
caps intact) and an atom-height probe located it: page 1 grew **+477px** on `English_seg6` and
**+354px of that was the resources card**, because `.rescard .lbl{ flex:0 0 auto }` holds the label
in a **135px left gutter** — right for G6-12, whose row is icon + label + one short value on one
line, and wrong for a 478px phone column asked to carry a table. Every primary row was laying itself
out in 343px: the to-prepare chips stacked one per line, the key-word meanings had 230px to define
*"present simple tense"*, and the pending-video line ran to three rows. That gutter **is** the blank
space in her second line. Under `.pri` the icon and label now take a line of their own and the
content takes the full width beneath — which is the shape kie.ai drew, a heading over a row of boxes.
Measured: rescard **997px → 840px**, chips **1 per line → 3**, `.vres` **129px → 91px**.

**Two things that did not pay, and were not kept.** Narrowing the key-word term track from
`fit-content(45%)` to `38%` measured **net zero** (term 203→171px, meaning 248→279px, table 516px
either way — the term wraps back exactly what the meaning gains), so 45% stays and the scan key stays
short. Stacking every label made the corpus **worse**, 271 → **273**: a short row — Urdu with two
materials — now spends a whole label line it did not before. Variant C (stack only `.kwtab` and
`.pend`) was also 273. Only shortening `videoPending` and setting `.pend` one step down moved it
down, to **270**.

**PAGE COST — the furniture costs 11 pages and that is the honest price of her page map.** Same 38
lessons, phone, on top of §3.19's 257:

| | teach (phone) | median | over cap |
|---|---|---|---|
| §3.19, furniture off | 257 | 7 | 1 (`Maths_seg9` 10) |
| + page-1 furniture, first cut | 271 | 7 | 3 |
| + labels stacked everywhere | 273 | 7 | 3 |
| + the narrowed rule | 270 | 7 | 3 |
| + **three panels, three atoms, shipped** | **268** | **7** | **3** |

+11 is eleven lessons gaining exactly one page each -- `English_seg3`, `English_seg9`, `Maths_seg2`,
`Maths_seg7`, `Maths_seg9`, `Maths_seg11`, `Science_seg3`, `Science_seg7`, `Science_seg8`,
`Science_seg9`, `Urdu_seg2`. A video table, a key-word table and a journey
band are real added content, and nothing was recovered by shrinking type she has ruled out. Three
lessons are now over the cap — `Maths_seg9` 11, `Maths_seg11` 10, `Science_seg9` 10 — and over cap
**fails**; it never trims. That is `bd-rjt3x`, and it is hers to decide: trim those three, or move
the cap.

**AN ATOM NEVER SPLITS, SO THE THREE PANELS CANNOT BE ONE ATOM.** `resourcesCard` was a single
wrapper `<div class="rescard">` holding all three panels, therefore one atom, and the packer moves an
atom whole. On the phone the ~570px card still fit page 1 and nothing looked wrong. On A4 -- inner box
**1063px** -- page 1 ran out at ~505px, so all three panels went to page 2 and half the review sheet
printed blank, against her page map's *"this should all be on page 1"*. Fixed by emitting **one atom
per panel** for primary (`sp: i ? 1 : 2`, which reproduces the `gap:var(--sp-1)` the wrapper drew):
each keeps its own `.rescard` root, so **not one style rule moved**. A4 page 1 now carries TO PREPARE
and VIDEO RESOURCE; KEY WORDS is a 399px table and 376px were left, and that gap is the cost of not
splitting a table across a page turn. **G6-12 stays ONE atom** -- its rows are one-liners that read as
a single card of addresses, and a break between two of them would be a page turn inside a list. The
split also **paid on the phone**, 270 -> 268: two lessons (`English_seg2` 9->8, `Science_seg1` 8->7)
had been carrying the whole card onto a new page to keep it together.

**A CAP IS A CONTENT BUDGET WRITTEN IN SHEETS, AND ONLY ONE SHEET WAS EVER MEASURED.** Every page
cap in `render_lp.js` was tuned on the 520x2000 phone page, because until §3.14 that was the only
page there was. The phone content box is **1986px**; A4's is **1109px**, 56% of it. So `English_seg6`,
green at `teach 8/9` on the phone, reported *"teach needs 14 pages; the cap is 9"* at `--format a4`
with nothing else changed — **not a lesson over budget, a budget quoted in the wrong unit.** She
asked for both renders of every primary plan (*"Both — A4 to review, phone to deliver"*), so a cap
only one sheet can meet makes the review copy unrenderable. `scaleCapsToFormat` converts the primary
caps by what the sheet actually holds (ratio 1.79 → EN teach 9→16, support 3→5; UR 12→21, 4→7), and
recomputes WARN one sheet under rather than scaling it separately. `English_seg6` at A4 is now
**teach 14/16 · support 1/5**, 15 PDF pages, body 21px. Because both caps read the same budget, the
two sheets also **agree about which lessons fail** — the same three, on either.

**PHONE IS UNTOUCHED BY CONSTRUCTION**: at ratio 1 the caps object is returned as it is, so
`bd-rjt3x`'s standing *"do not raise the cap"* still binds the sheet a teacher receives, and so does
every reading that names no format — including the author's own budget card. **PRIMARY ONLY,
deliberately**: the same physics would take the G6-12 teach cap from 4 to 7 on A4, which is a real
question and the operator's, not a side effect of a G1-5 page-1 change.

**G6-12 is untouched, and it is proved with G6-12's own fixture as the control.** Every new rule is
either a brand-new class no other block emits (`.drail`, `.band`, `.kwtab`, `.vres .pend`) or sits
under `.pri`, which only a grade 1-5 document ever wears. `videoRow` keeps its bare `L.video` row
when no label is passed. `day`/`of` are additive and G6-12 emits neither. The caps are forked on
`isPrimary` before any format is read.

**Tests.** `tests/lp612/primary-page1-furniture.test.js` at **36**, four of them written red against
the gutter fix and confirmed red before it was restored: the label is a **direct child** of the panel
(so the key-word table cannot go back inside a `.blk`), the row wraps and the label is its own small
heading, the table takes the whole row beneath it, and — the control — **a G6-12 row keeps its label
in the gutter and never emits `.kwtab`**. Three more, group **7b**, pin the atom split: primary emits
one atom per panel, each is still a `.rescard` so no rule had to move, and — the control — a G6-12
card is **one** atom carrying `.rmat` and `.rpace` together, exactly as before.
`tests/lp612/page-cap-policy.test.js` gains five (17 total),
red first: phone comes back untouched, A4 carries the same budget read off A4's own geometry (derived
from `PAGE_FORMATS`, never restated), an unknown format falls back rather than inventing a cap, WARN
sits one sheet under on every sheet, and G6-12 does not move on either. `test_d0_primary.py` gains two,
also red first — the rail carries the two integers it draws from, and no `day`/`of` means no
`sequence` at all — for **35 passed** across the D0 unit suites. Full `tests/lp612`: **34 failed /
129 passed** suites, 22 failed / 5 skipped / **1,729** passed tests — §3.19's 1,691 plus exactly these
38, and not one new failure.

**`test_d0_contract.py` needs `LP_V9` until this is merged.** It validates against the live clone's
vendor tree, where `sequence` does not yet declare `day`/`of`, so it fails on
`instance['sequence']` — the case its own docstring describes. With `LP_V9` pointed at this worktree:
3 passed.

**Re-vendoring.** Five marked hunks in `lib/template.js` (`VENDOR DIVERGENCE (bd-vbs5w, SYNC §3.20)`):
the exported `isPrimary` predicate, the PRIMARY PAGE 1 stylesheet block, `const PRIMARY` in `page1()`,
`videoRow`'s label parameter with `kwTable` / `resourceRows` + `resourcesCard`, and the rail-and-band
atoms that suppress `.seq`; plus the `class="pri"` gate on `<html>` and the `PRIMARY` fork at the
page-1 resource push site (one atom per row for G1-5, the joined card for G6-12). Two in `render_lp.js`: the `isPrimary`
import in place of the local copy, and `scaleCapsToFormat` + `pageCapsFor`'s third argument (with its
call site in `renderDoc`). One additive block in `schema/lp_doc.schema.json` and seven label keys in
`lib/overlay.js`. `d0_primary.py` is not vendored — it is ours, in `curriculum/g1-5-resegment/`.

### 3.21 `lib/template.js` + `schema/lp_doc.schema.json` + `curriculum/g1-5-resegment/d0_board.py` — a board that closes before another opens is a SECOND board (2026-09-17)

**The defect.** `bd-i44jn`, P2. Under the same five lines as §3.20, the fourth one is
*"Write on the board sould be concise and pointed"*. On page 2 of `English_seg6` the board printed
as a single fifteen-row grey slab. The author had drawn two finished boxes — APOSTROPHE ALLEY, then
an arrow reading `→ APPLY THE CLUE →`, then PRESENT SIMPLE PARTY — and the second box's title
came out as an ordinary row of the first box, with the arrow as another row above it. A teacher
reading it could not tell where one board ended and the next began, which is the whole of what
"pointed" asks for.

**Why it happened.** `board_panels` split a board on BLANK LINES only. That is right for most of the
corpus and wrong for a lesson whose author drew two boxes with no blank line between them —
`English_seg6` is the one such lesson in 38.

**The rule is NARROW ON PURPOSE, and the narrowing was measured, not guessed.** The obvious rule —
"any mid-group framed line opens a panel" — was measured against the corpus first and hits 9 boards.
It would have shattered three of them: `Science_seg2`'s instrument TABLE into five one-row panels,
`Maths_seg9`'s two boxes drawn SIDE BY SIDE into pieces of themselves, and `Maths_seg6`'s diagonals.
The shipped rule is **a box that CLOSES before another OPENS**, and only two characters decide it:
`_OPENS` (┌ ╭ ┏) and `_CLOSES` (└ ╰ ┗). Nothing else in the box-drawing block is read as
structure, because nothing else in it IS structure. Measured across all 38 lessons, this changes
**exactly one board** (`English_seg6`, 1 panel → 2) and **loses no word anywhere**.

**A connector is a row of NEITHER board.** The line the author drew in the gap between two boxes
rides on the panel it leads INTO, as an optional `connector` string. It leads into the second board,
not out of the first, so a first cut that gave the gap to the board it LEFT was wrong and the test
caught it; the parse now carries the gap forward. A trailing gap with no box after it closes the
last board rather than leading into one that was never drawn, so it stays a row of it. The field is
additive in the usual sense: one ordered `panels` list still carries the whole board, and a reader
that ignores the key still prints both panels in order. It renders as `.bcon`, a sibling of `.bp`
inside `.bd` — centred, 800 weight, `--warn`, no new radius token, because it belongs to neither
column. **G6-12 never emits one**, so a G6-12 board is byte-for-byte what it was.

**Page cost: zero.** The full 38-lesson corpus is **268 teach pages before and after**, and not one
lesson moved a page. `English_seg6` itself stays 9 phone pages / 15 A4.

Tests. `curriculum/g1-5-resegment/test_d0_board.py` gains five, red first, over three VERBATIM corpus
fixtures: a close-then-open is a second panel; the line between two boxes joins them and is a row of
neither; a box-drawn TABLE is still one panel; two boxes drawn SIDE BY SIDE are still one panel; and
the corpus-wide no-word-lost check, whose `words_of` helper now reads `connector` — it is a place the
parse puts words, so it is read back like any other. **58 passed** across the D0 unit suites, **61**
with `test_d0_contract.py` under `LP_V9`. `tests/lp612/board-panels-practice-rows.test.js` gains four,
also red first (21 total): the connector prints ONCE and between the two panels, it is not a row and
takes no panel number of its own, a board without one is exactly the board it was, and it is styled
as a joint. Full `tests/lp612`: **1,736** passed, §3.20's count plus exactly these four, no new
failure. The 34 red suites are §3.20's and unrelated — the worktree has no `node_modules`, so
`openai` does not resolve.

**Re-vendoring.** One marked hunk in `lib/template.js` (`VENDOR DIVERGENCE (bd-i44jn, SYNC §3.21)`):
the `joint()` helper and its use in `panel()`, plus the `.board .bcon` rule beside `.board .bp`. One
additive property in `schema/lp_doc.schema.json` — required, because that panel object is
`"additionalProperties": false`. `d0_board.py` is not vendored; it is ours.

### 3.22 `lib/template.js` + `render_lp.js` — the opening is ONE box: settle, then provoke (2026-09-17)

**The ask.** `bd-usirc`, P1. The page map: *"kie.ai has a Warm Up and Opening boxes, thgere should
be 1 opening box that first has a warm up that helps kids settle and prepare for activating prior
knowledge / then the actual hook to engage students with a provocation to help link prior knowledge
to the new concept being introduced"*. The warm-up and the hook are ONE move in a classroom — settle
the room, then provoke it — and printed as two independent blocks with a rhythm margin between them.
In the 38-lesson corpus render they were often not even on the same sheet.

**Two atoms, one frame.** They stay TWO atoms. An atom never splits, and the pair measures ~920px
against A4's 1,063px content box, so merging them would have made an atom that can only ever start a
page. Instead each band gains `opn`, plus `ofirst` / `olast` for the end it is, and the stylesheet
rounds only the ends:

```css
.pri .opn{ border-radius:0; }
.pri .opn.ofirst{ border-radius:var(--r-2) var(--r-2) 0 0; }
.pri .opn.olast{ border-radius:0 0 var(--r-2) var(--r-2); }
.pri .opn.ofirst.olast{ border-radius:var(--r-2); }
```

That is the seam idiom §3.18's split worked example already uses, and it obeys the radius law in
`tests/lp612/surface-ladder.test.js` — three tokens and `0`, nothing else. A band that is BOTH ends
(a day with no hook, or no warm-up) is a whole box again, which is why the fourth rule exists.

The frame paints on `.pri .blk.wu.opn` and not on `.opn`: `.opn` is 0,2,0 and `.hook` is 0,1,0, so a
background on `.opn` would have whited out the hook's navy ground. The hook's own surface is the
other half of the box. The pale half keeps its bottom border — see the seam note below.

**`sp: 0` is the seam.** The hook band takes `sp: 0` when a warm-up precedes it, so the two bands
touch; with no warm-up it keeps the loud `sp: 3` rhythm a hook has always had. `sp-0` has no rule in
the sheet, so margin-top is 0 — the hero's idiom (`atom(hero, { sp: 0, glue: true })`), and safe
because the packer reads `mt` from `getComputedStyle`, never from the JS token table.

**SOFT, not GLUED — the change in `render_lp.js`.** The obvious way to stop the box splitting is
`glue`. Measured on the corpus it costs **+7 pages**: `glue` is nearly hard — a break after a glued
atom is legal only when that atom stands ALONE on its page — so where the pair does not fit, the
whole box moves to the next sheet and the hole stays. Worse, its stand-alone escape hatch splits the
box anyway in four lessons, by putting the warm-up on a page of its own.

So `packAtoms` gains a third term. An atom may declare `soft`; a break that falls after one is
counted in `splits`, ranked **below `pages`** (a seam can never buy paper) and **above `used`** (it
wins every tie that front-loading used to win, which is where the gratuitous splits were):

```js
a.pages !== b.pages ? a.pages < b.pages
  : a.orphans !== b.orphans ? a.orphans < b.orphans
    : a.splits !== b.splits ? a.splits < b.splits
      : a.over !== b.over ? a.over < b.over
        : a.used > b.used;
```

`soft` travels the same route `glue` does — `atom()`, the three forwarding sites in `sectionAtoms`,
and the `atoms` array `buildHtml` returns for `render_lp.js` to merge measured heights into. An atom
that does not declare it scores zero and is packed by exactly the comparison the exact packer has
always used, so **G6-12 is untouched by construction** and its fixture proves it: no atom of
`v9_gate_base.lp.json` carries `soft`, and no `.opn` rule can match a document without `.pri`.

**Measured cost: +1 page over 38 lessons** (teach 268 → 269; only `English_seg5` moves, on the
frame's own border and padding). The A4 render of `English_seg6` went from a warm-up box alone above
500px of blank, with the hook overleaf, to one box on one page. Across the corpus **27 of 38 lessons
now print the box whole**; the other 11 cannot without buying a sheet, and a split still reads
honestly: every band closes all four of its own sides and the shared corners are square, so a
half-box says "continued" rather than "unfinished".

**Tests.** `tests/lp612/primary-opening.test.js` (17) — the G6-12 control, the one box, the box
closing around whatever the day actually has, the radius rules, the `.pri` gate, the closed seam,
and the soft flag reaching the atom list. `tests/lp612/page-packer.test.js` (+3) — the seam moves
off a break that costs nothing, yields to one that would cost a page, and an atom declaring neither
flag packs exactly as before. Full `tests/lp612`: 1,756 passing, with the same 22 failures and the
same 34 suites that cannot LOAD in a worktree with no `node_modules` (`moduleNameMapper` → `openai`).

**Re-vendoring.** Carry `lib/template.js` (the `.pri .opn` / `.pri .blk.wu.opn` block after the
`.kwtab` rules; `intro` / `openWarm` / `openHook` / `openBand` in `page1()`; the warm-up push in
`before()`; the hook branch at the head of `blockAtoms`; `soft` in `atom()`, in the three
`sectionAtoms` forwards and in the returned `atoms` arrays) and `render_lp.js` (the `splits` term in
`packAtoms` and `soft: false` in the greedy baseline's atom list).

### 3.23 `lib/template.js` + `lib/overlay.js` — one hue per gradual-release move, and the shared band splits (2026-09-17)

**The ask.** `bd-f6opy`, P1. *"what about all the moves being of different colours?"* — and, choosing
between the options costed for her: *"I DO amber, WE DO teal, YOU DO green. All three get the same
shape: solid pill inside its own tinted box. Split the shared 'We Do / You Do' green band into two
bands so each move is its own landmark."*

**The premise of the question was the opposite of the truth: the moves were not three colours, they
were navy, green and green.**

| move | pill | box | band above it |
|---|---|---|---|
| I DO | solid amber | amber `.exq` | navy `.s-d` (development) |
| WE DO | solid green | green `.exq.we` | **green `.s-a`** (activity) |
| YOU DO | **pale-green OUTLINE** | **none at all** — `.pr` declared neither border nor background | **the same green `.s-a`**, spanning pages 8–12 |

So the release read navy → green → green; the one move a teacher hunts for was the only one with no
surface of its own; and the band gave her no way to tell the half of the section where the class
practises together from the half where the children are alone.

**WE DO is a BLUE, not the teal she named — deliberately.** `--band-i:#0F6A73` is already teal and is
the Introduction band on pages 1–3, so a teal WE DO band on page 8 would make one hue mean two things
to a teacher flipping the plan. `--band-we:#2E5E90` was chosen by searching the band family's own
character rather than for maximum distance — the family means L\* 39.0 and chroma 32.3, and a first
search that maximised dE returned an electric `#0028E4` belonging to no palette here. This one
measures L\* 38.9, chroma 32.4, hue 271.2°, 6.73:1 against the white name it prints, and 23.6 dE from
its nearest neighbour.

**The name is legible on its own fill, which is not the same as "the name is white".** I DO's amber
carries white at **2.11:1** — 14px bold tracked caps is NORMAL text by WCAG, which asks 4.5 of it —
and has done since v9. WE DO's blue carries white at 6.73:1 and YOU DO's leaf at 4.80:1, so those two
keep the ink they had; only I DO's changes, to the house navy, at 5.63:1. Gated on `.pri`, so a
G6-12 pill is the pill it always was.

**YOU DO's frame is ONE box, not one per question.** Practice is already one atom per item — 24 of
them in the longest corpus lesson — so a frame on the atom would have drawn 24 boxes. The splitter
reuses `.exq`'s `.pc-a` / `.pc-m` / `.pc-z` seam idiom verbatim (§3.18): the pieces open the edge they
share and butt at `sp: 0`, so N pieces paint what one card painted. `.pc-m` / `.pc-z` take
`padding-top:4px`, exactly the `sp-1` rhythm margin the item atoms no longer carry, so the whole list
costs pc-a's 6px top + pc-z's 6px bottom + two hairlines = **14px, the same as one un-split box**.
Padding, borders and radii do not pass through `TYPE_SCALE`, so that is the literal cost.

The frame paints on `.pri .blk.pr`, not on `.pri .pr.pc`: **2 of 38 corpus lessons have a practice of
fewer than three items, which never splits**, and those would have been left unframed. `.pri .pr.pc{
border-radius:0 }` resets it at equal specificity by source order, and the seam classes only ever
OPEN an edge of the frame the block already carries.

**The band splits with no change to `render_lp.js` at all.** The continuation-bar mechanism is keyed
on an ARBITRARY STRING, not on a section id: `contBarHtml(key, …)` looks up `secIndex[key]`,
`render_lp.js` reads `contBar[a.sec]`, and `probeKeys = Object.keys(secIndex)`. So registering a
second key `"activity:you"` works end to end. `sectionAtoms` threads a mutable `sec`, and `bar()` /
`contBarHtml` gain a `fill` override so the second band can take its own hue while keeping the
section's letter — it IS still that section, and a page resuming inside YOU DO must repaint YOU DO's
green and say YOU DO's name, not the WE DO band that opened the section five pages earlier.

`moveSplit(s)` matches the block GRAMMAR, never an index: punctuation is normalised, so `you-do`,
`youdo` and `you-do-task` all match — `you-do-task` is the "set the task going" instruction that
LAUNCHES independent work and belongs under the YOU DO band. Each band carries its own move's minutes
off its own block (5 and 7 in the gate fixture, not a halved 12). `whole()` is deliberately untouched:
it renders only a `layout:"half"` pair, and no primary doc in the corpus sets `layout` at all.

**No word is deleted.** The section title was the concatenation `"We Do · You Do"`; splitting it
prints BOTH halves, each over the half of the section it names. `lib/overlay.js` gains `weDo` /
`youDo` in both label packs — furniture, so translated, unlike a block title, which the author wrote
and which is frozen.

**G6-12 is untouched by construction.** `.s-we` is a brand-new class no other block emits; every
repaint of a shared surface sits under `.pri`, which goes on `<html>` for grade 1–5 alone; the
practice splitter emits the seam classes only when `PRIMARY`. The grade 9 fixture is the control.

**Measured cost: +7 pages over 38 lessons** (teach 269 → 276; support unchanged at 38). **31 of 38
lessons do not move at all**; the seven that gain exactly one sheet are `English_seg1`, `English_seg8`,
`English_seg10`, `Maths_seg5`, `Maths_seg10`, `Science_seg2`, `Urdu_seg7`. The option was costed to her
at "roughly +1 page (a band is 40px)" per lesson; it came in at +0.18. The 11px side padding on the new
YOU DO frame narrows that column by 22px and is the real price, not the band.

**Tests.** `tests/lp612/primary-moves.test.js` (22, new) — the G6-12 control, three hues ≥15 dE apart,
every pill's name against its OWN fill at 4.5:1, YOU DO's frame and that it is one box, the band split
and its own continuation key, and that no word moves. `tests/lp612/readability-blocks.test.js` (+1) —
`.s-we` joins the band table, which now checks EIGHT fills for seven sections, because activity prints
two. The colour arithmetic moved to `tests/lp612/__helpers__/colour.js` so both suites run one copy of
it; `rule()` was tightened there from a token boundary to a RULE boundary, because `.pri .pr .tag`
declared above the base `.pr .tag` it overrides had been answering lookups for it.

**Re-vendoring.** Carry `lib/template.js` (the `--band-we` token in `:root`; `.s-we`; the
`.pri .exq…` / `.pri .blk.pr` / `.pri .pr.pc*` block; the `fill` parameter on `bar()` and
`info.fill` in `contBarHtml`; the `seam()` branch in the practice splitter; `YOU_SUB` + `moveSplit()`
+ the rewritten `sectionAtoms`) and `lib/overlay.js` (`weDo` / `youDo` in `LABELS.en` and `LABELS.ur`).
All marked `VENDOR DIVERGENCE (bd-f6opy, SYNC 3.23)`.

### 3.24 `lib/template.js` — a primary diagram is drawn on a phone-first canvas (2026-09-18)

**The ask.** `bd-u9vji`, P1. *"diagrams get phone-specific fix, labels should be phone-first"* — and,
standing over it, *"21 px is non negotiable"*. A teacher reads the lesson on a phone; a diagram whose
labels land at 8.43px on that phone is a diagram she cannot read.

**The bead named the wrong lever, and measuring said so.** It asked for `spec.width`. But `figureSlot`
already sets `maxHeightPx = box.minHeightPx` and rides it out as `--fig-h`, so a figure is *not* drawn
at full column width — it is scaled **down** until its smallest label sits exactly on `DIAGRAM_MIN_PX`
(8.43 phone, 13.5 A4). Setting `width` alone changes the viewBox and nothing a teacher sees. The floor
has to rise **and** the canvas has to narrow, together: fewer units across the same column means each
unit is more pixels.

`DIAGRAM_MIN_PX` is an **acceptance** gate — its own comment concedes the phone mark sits at 43% of the
reading floor. For G6-12 that is a defensible trade, because the diagram sits *beside* prose that says
the same thing. For G1-5 it is not, because `d0_diagram.py` makes the diagram **replace** the prose it
illustrates, so an unreadable label is a deleted paragraph. The new floor is `PRIMARY_DIAGRAM_MIN_PX
= 15.5` — not a new number: it is `TYPE_FLOOR.label` from `bot/shared/templates/niete-brand.js`, the
same floor the chips already honour.

**Phone-first is arithmetic, not preference.** The canvas is computed against `PHONE_FULL_COL` (455) in
**both** formats, so `col/vbW` is constant and A4 prints exactly what the phone delivers — which is what
makes *"A4 to review, phone to deliver"* literally true. The height budget `PRIMARY_FIG_MAX_H` is taken
from the **A4** page (1109px of content against the phone's 1986), because the shorter page binds.

**Three honest outcomes, never a fourth.** `render_lp.js:1043` treats any `figureProblem` as a lesson
FAILURE, so the shim may never create one:

| outcome | when | what prints |
|---|---|---|
| `FIGURE_NARROWED` | the narrow canvas fits the page | the label clears 15.5px |
| `FIGURE_NARROWED_PARTIAL` | 15.5px would overflow one page | the narrowest canvas that *does* fit, judged against **today's** floor — strictly bigger type than before, and the repair carries `targetFloorPx` so the miss is on the record |
| `FIGURE_NARROW_DECLINED` | the type ignores `width`, or the engine threw | byte-identical output to today, with `reason` |

The back-off walks narrowest-first in thirds and is bounded at three renders. A type that ignores
`spec.width` is detected by **re-measuring the returned viewBox**, not by consulting a list of types
that honour the key.

**Two emission sites, not one.** The `diagram` block renderer *and* `boardPlanAtoms` each draw a figure,
and the second was found by measuring: the shim narrowed the block diagram to 340px and the page still
reported 185, because that was the board plan. A floor that holds at one site and not the other prints
two sizes of the same alphabet on one lesson.

**G6-12 is untouched by construction.** The branch is gated on `ctx.primary` (`isPrimary(doc)`, read off
`provenance.grade`, never a caller flag) **and** on the author having left `spec.width` unset — a width
in the spec is a decision someone already took. `figureSlot` / `figureFit` take the floor as an optional
argument defaulted at CALL time rather than reading a module-level mode flag, so `setPageFormat` still
moves it and the functions stay pure across a multi-document process.

**Re-vendoring.** Carry `PRIMARY_DIAGRAM_MIN_PX` / `PHONE_FULL_COL` / `PRIMARY_FIG_MAX_H`,
`primaryCanvasWidth()`, `primaryRedraw()`, the `minPx` parameter on `figureSlot()` / `figureFit()`, the
gated redraw in `R.diagram` and in `boardPlanAtoms`, `primary: isPrimary(doc)` on `ctx`, and the three
new exports. All marked `VENDOR DIVERGENCE (SYNC 3.24), bd-u9vji`.

**Tests.** `tests/lp612/primary-diagram-floor.test.js` (23). Its first group is a GRADE 9 control that
asserts the unchanged numbers — 185px phone, 296px A4, one engine call, no repair — so a red run there
is the proof that G6-12 moved. Red was confirmed before the change: 10 failed / 9 passed, with all four
control tests already green.

### 3.25 `lib/template.js` — WRITE ON THE BOARD closes page 1 on a primary plan (2026-09-18)

**The ask.** `bd-6s5u7`, P1. *"go ahead with the shim, and move the board to page 1"*, and, in the page
map she wrote for the primary profile: *"kie.ai has a to Prepare list, it should be in one table the
video resources in the other table and then the third shold carry the actual key words of the day -
this should all be on page 1 finally there should be a write on the board section here with all the
relevant things that will go on the board"*.

It was measured on printed page **two**. The board is what a primary teacher sets up *before* the
lesson begins, so it belongs with the other three set-up tables — not four atoms downstream behind the
hook and the warm-up, on a sheet she has to turn to while holding chalk.

**A HOIST, not an edit — the precedent is already in this file.** §3.20 moved the key words the same
way: *"the key words stayed in `introduction.blocks` when they were hoisted into the resources card"*.
The `board` block is still the last thing `d0_primary._intro` appends, `lint_lp.js`, the schema, the
author briefs and every `ur_overlay` pointer still address it exactly where it lives, and only the
RENDERER emits it as page-1 furniture. `sectionAtoms` drops it on the way past, the same one-line
`continue` the key words already had.

**Found by TYPE inside the Introduction, never by id and never by index.** `d0_primary` writes
`id: "board-plan"`, but that is D0's id and not a contract; the selector mirrors `kwHoisted` exactly.
The fixture's `conclusion` also carries a `board` block — a different board, on a different page, left
alone.

**BOTH halves move, together.** The `board` block is the panels she writes; `boardPlanAtoms` draws
`page2.board_final`, the picture of the finished board. Hoisting one and leaving the other would print
one board described twice, a page turn apart — worse than the defect being fixed. So `after()` stops
emitting `boardPlanAtoms` for a primary document, and `page1` emits the pair in the order they already
had: panels first, finished board under them.

**G6-12 is untouched by construction.** `bdHoisted` returns `null` unless `isPrimary(doc)` — grade 1-5
read off `provenance.grade`, never a caller flag — so `sectionAtoms` skips nothing, `after()` still
calls `boardPlanAtoms`, and the `A` array gains no atom. The `glue` and `sp` each hoisted atom carried
inside the section travel with it, so no spacing rule changes for either band.

**Re-vendoring.** Carry `bdHoisted` beside `kwHoisted`, its `continue` in the block loop, the `!PRIMARY`
guard on the `boardPlanAtoms` call in `after()`, and the emission block after the `.rescard` atoms in
`page1`. All marked `VENDOR DIVERGENCE (SYNC 3.25), bd-6s5u7`.

**Tests.** `tests/lp612/primary-board-page1.test.js` (11). The fixture is a GRADE 9 document and its
first group is the control. Note what that group does **not** claim: the gate fixture is short enough
that its board prints on page 1 in *both* profiles, so "is it on page 1" cannot separate them and
asserting it would have been a green that means nothing. What separates them is the ORDER on the page
the packer actually cut — G6-12's board is body copy *below* its section bar, primary's is furniture
*above* it — and `<div class="page" id="tN">` is sliced directly, so source order cannot answer a page
question. Red was confirmed before the change: 4 failed / 7 passed, all three controls already green.

This entry also records a TEST fix the hoist forced. `primary-diagram-floor.test.js` read "the figure"
as the first `<figure class="dg">`; the board's figure is now the first one in the document, so that
helper began reading the wrong figure and reported 340px for a diagram the shim had just declined to
touch. It now cuts the board's figure out by its own label rather than counting past it.

### 3.26 `lib/template.js` + `lib/overlay.js` + `schema/lp_doc.schema.json` — THE BIG IDEA opens EXPLANATION on a primary plan (2026-09-18)

**Operator**, choosing between three costed options for kie.ai's `bigIdea`: *"give it its own
surface on page 2 under EXPLANATION"*.

**What kie.ai had that we did not.** Its `SECTION_REGISTRY` gives `bigIdea` the role
`pedagogical-heart` and about 22% of page 1 — a white card with three fixed paragraphs: the
concept distinction the textbook does not make explicit, the misconception pupils arrive with,
and one sentence of demo move. The HTML profile had no equivalent. One third of it was carried
by **Key fact** (the one-line outcome) and one third by **Watch for this slip** (the in-the-moment
error cue); the distinction — the part a non-specialist primary teacher most needs — was carried
nowhere. That gap is the whole of the field complaint in `spec/07-lp-production.md` §6.

**Why three NAMED fields and not an `items` array.** `key_points` was the obvious model and is the
wrong one. A free list lets an author write three restatements of the outcome, which is exactly
the defect this surface exists to remove. Named fields make an omission *visible*: a missing
distinction prints as a labelled blank rather than shortening the list by one.

**ONE HOME PER SOURCE FIELD still holds.** Key fact stays the one-line outcome, Watch for this
slip stays the error cue, and the Big Idea is the teaching behind both. It is not also printed in
either.

**Cost, and why the 80-word cap in the spec is load-bearing.** Big Idea is the only surface on
the primary profile that ADDS words. Re-costed across all 38 corpus lessons on top of Budget B:
at 80 words the median lesson is 1,411w / 6.5 phone pages and p90 is 1,707w / 7.9 — inside the
5–8 band. At 100 words p90 reaches 8.0 and leaves it. 80 is arithmetic, not taste.

**Surface ladder.** A `teach` role (blue, the ASK/SAY family), not a bespoke colour — it is
teacher-facing explanation, and it reads as the thing to understand before the amber I DO model
printed directly beneath it. No hex inside any `border*`; radius from `--r-2`.

**Untouched for G6-12 by construction**, the `d0_diagram.py` precedent rather than an `isPrimary`
gate: no enrichment record outside the primary profile carries a `big_idea` block, so a G6-12
document renders through the path it always did. `tests/lp612/primary-big-idea.test.js` proves it
with the GRADE 9 fixture as control, byte-for-byte.

**Three touches.** A `big_idea` block variant in the schema (all three paragraphs required,
`additionalProperties: false`); `bigIdea` / `biDistinction` / `biMisconception` / `biDemo` in
**both** the EN and UR `LABELS` tables in `overlay.js`; the `big_idea` renderer beside
`key_points` in `template.js`, plus its `.bigidea` rules beside `.kp`.

### 3.27 `schema/lp_doc.schema.json` — the schema catches up with §3.16 and §3.17, which claimed it already had (bd-xsuwz, 2026-09-18)

**Not an ask. A bug, found by a render that refused to run.**

`node render_lp.js <any primary lp_doc>` exited 1 with `SCHEMA INVALID — refusing to render` and had
done since §3.16 landed on 2026-09-17. **Every primary render produced between those dates went
around the validator** — `build.py`-style scripts that call `buildHtml` directly, and nothing else.

**Why it stayed invisible for a day and 38 lessons.** `buildHtml` does NOT validate; `validateDoc`
runs one layer up, inside `renderDoc`. Every suite in `tests/lp612` calls `buildHtml(doc)` directly,
so **the schema gate was never exercised by any renderer test in this tree.** A document could be
renderable by all 169 suites and still be refused by the CLI and by `lint_lp.js`.

**Five properties were missing, and two SYNC entries said they were not.** §3.16 and §3.17 both name
`schema/lp_doc.schema.json` in their titles and describe the shapes below as landed. They were not
landed: `grep '"panels"\|"turns"' schema/lp_doc.schema.json` returned nothing, in this tree and in
the main clone. **A SYNC entry naming a file is not evidence the file was edited.** The corrections
are noted in §3.16 and §3.17 themselves.

| Missing | Read by | Named in |
|---|---|---|
| `board.panels`, `board.title` | `template.js` `board:` (the panelled board) | §3.16 |
| `worked_example.turns` | `scriptRows(b, rich, L)` | §3.17 |
| `faded_example.turns` | `scriptRows(b, rich, L)` | §3.17 |
| `sequence.day`, `sequence.of` | the primary progress rail | bd-vbs5w |

**Shapes taken from data, not invented.** Both renderer functions were read for every key they
touch, then every key the 38-lesson G4 Ch.9 corpus actually emits was measured: turn keys
`expect/kind/name/parts/ref/text`, kinds `ask/calc/do/frame/routine/say` (cross-checked against
`d0_script.py:166-178`), panel keys `connector/label/rows`, row keys `gloss/term/text`. Two new
`definitions` hold them — `script_turn` and `board_panel`. **The six turn kinds are a closed enum
because each one is a CSS rule** (`.k-say`, `.k-ask`, …); a seventh would print unstyled rather than
loudly wrong, so the schema refuses it.

**Additive, so G6-12 is untouched by construction.** `text` stays required on `board`; `steps` stays
required on both example types; `this` stays required on `sequence`. Every G6-12 document carries
none of the five and takes the branch it always took.

Tests: `tests/lp612/primary-schema-conformance.test.js` (12) — **the only suite in the tree that
asserts against `validateDoc` rather than `buildHtml`, which is its stated purpose.** Proved red at
5 failed / 7 passed before the splice, 12/12 after. Its first describe block is a GRADE 9 document
as control: valid with `errors == []` and carrying none of the five keys. D0 side:
`test_d0_contract.py::test_renders_against_the_live_v9_schema`, which validates the built document
against this very file and was red for the same reason.

**Still broken, deliberately not fixed here: `lib/validate.js` cannot print a schema error.** The
installed ajv is **6.15.0**, which populates `e.dataPath`; `validateDoc` reads `e.instancePath`, gets
`undefined`, and prints `/` for every error. The 25-line dump that opened this bug was 25 lines of
`/`. To diagnose one by hand, compile the schema with `Ajv({allErrors:true, strict:false,
verbose:true})` and read `e.dataPath || e.instancePath`. Unfiled.

**The splice, because the last round-trip of this file cost 251 deleted lines.** Exact-anchor string
replacement, `assert s.count(anchor) == 1` per anchor, `json.loads` before writing: **69 insertions,
0 deletions.** Never round-trip a hand-formatted JSON file through `json.dump`.

### 3.28 `lib/template.js`, `schema/lp_doc.schema.json` — the band names the PHASE, the move rides its right-hand edge (bd-hlk39, 2026-09-18)

**Operator, verbatim:** *"Warm Up and Hook should come underopening header / Explanation header with an
I Do tag on the extreme right to understand the moves"*.

**What was wrong.** The two primary bands were named by two different grammars. `introduction` was named
after its CONTENTS — "Warm-up and hook" — and `development` after the MOVE — "I Do". Read down the page
neither one tells a teacher which part of the lesson she is in, and the first one said twice what the box
already labels once: §3.22 folded the opening into ONE box whose first sub-label is literally WARM-UP.

**The fix, and why it is two fields.** `section.title` now carries the PHASE ("Opening", "Explanation")
and a new optional `section.move` carries the gradual-release step ("I DO"). Two fields rather than a
longer title because she asked for a POSITION — the extreme right — and a single string prints the move
wherever the name happens to end. The position is the renderer's business, so the move has to reach the
renderer as its own fact.

**The three touches in `lib/template.js`:**

| Site | Change |
|---|---|
| the sheet, after `.bar .nm,.bar .mins` | `.bar .mv` — the pill; plus the one sibling rule `.bar .mins + .mv` |
| `bar(id, name, minutes, L, extraCls, fill, move)` | seventh argument, emitted AFTER `.mins` |
| `contBarHtml` | reads `info.move`, so the pill repeats on resume |
| `sectionAtoms` / `whole` | pass `s.move`; `secIndex[id]` carries it for the continuation |

**`.bar .mins + .mv` is load-bearing.** `.mins` already owned the reading-end edge via
`margin-inline-start:auto`, and TWO auto margins in a flex row SPLIT the free space between them — which
would leave the minutes floating in the middle of the band. With a move present the minutes keep the auto
and the pill takes only the gap, so the pill is at the extreme right, the minutes sit immediately inside
it, and a bar with no move is byte-identically the bar it always was. That last clause is a test.

**It looks like the box it introduces, on purpose.** Amber fill, navy ink, pill radius, caps, tracked —
the same badge as `.pri .exq .tag`, the I DO pill on the worked-example box this bar opens, at the same
5.63:1. One badge family read twice at two scales, not a second visual idea.

**The text is the document's.** No label was added to `overlay.js`. `move` is authored at D0 in the
lesson language, so Urdu needs no second translation and an author can name a move we have not thought
of. That is also why the schema types it as free text rather than an enum.

**`section.move` in the schema was NOT optional to add.** `sections.items` is
`additionalProperties: false`, so a field the renderer reads and the schema has never heard of is not a
lax pass — it is `SCHEMA INVALID` and exit 1 on every primary document. That is precisely the bd-xsuwz
failure recorded in §3.27, one entry above this one, and it is why the four schema-conformance tests were
written and proven red before the property was spliced. The splice was 1 insertion / 0 deletions: exact
anchor, `assert s.count(anchor) == 1`, `json.loads` before writing. **Never round-trip a hand-formatted
JSON file through `json.dump`.**

**Additive, so G6-12 is untouched by construction.** No document outside primary carries `move`, so the
grade 9 fixture is the control and must render byte-identically — asserted, along with the fact that its
minutes still own the edge. Same pattern and same proof as `d0_diagram.py`'s
`test_the_slots_are_primary_only_by_construction`; no `isPrimary` gate, because there is nothing to gate.

**D0 half** (`curriculum/g1-5-resegment/`, untracked): `d0_primary.py` titles the two sections and sets
`move` from `d0_blocks.MOVE_TITLE["I-Do"]`; `d0_blocks.i_do_block` drops the `I DO · ` prefix and its box
title is now just "Teacher models" — ONE HOME PER SOURCE FIELD, the move is named on the bar and the box
says what the box is for. **We Do and You Do keep their prefixes**, because `moveSplit` (§3.23) names
their bands after the move itself, so the bar never says it for them.

**Deliberately NOT done:** the `activity` section is untouched. Her page map says *"practice as is"*, and
its two bands are already named WE DO / YOU DO. The consequence is worth stating plainly rather than
fixing quietly: `development` is now named by phase with the move as a tag, while `activity` stays named
by move. That is an inconsistency, and it is hers to resolve.

**Tests:** `tests/lp612/primary-move-tag.test.js` (16, proven red 10F/5P then green — the continuation
bar is reached two ways, `opts.probeCont` for the bar the PACKER MEASURES and `opts.breaks` for the real
one, because `buildHtml` does not paginate); four added to
`tests/lp612/primary-schema-conformance.test.js` (red 2F then green); three added to
`test_d0_primary.py` (red 3F then green). Full tree: `tests/lp612` 170 suites / 2,274 tests green; the D0
suites 124 green with `LP_V9` pointed at this worktree.

### 3.29 `lib/template.js`, `schema/lp_doc.schema.json` — the worked example closes on its own check (bd-txk5u, 2026-09-18)

**Operator, verbatim:** *"worked example should be better formatted ending with a CFU like usual"*.

**What was wrong.** The check FOR the modelling was printed pages away FROM the modelling. Stage C
authors one `cfuExplain` per lesson — the question that proves the explanation landed — and D0 was
seating it as an `ask` block in the CONCLUSION, which is where the lesson ends, not where the modelling
does. A teacher reading the I DO box got to the bottom of it with nothing to ask, worked the class
through the guided turn on faith, and met the check after the practice was already over. By then the
check cannot change what she does next, which is the only thing a check is for.

**The fix.** `worked_example` gains an optional `cfu` string, and it prints as the last row INSIDE the
box, under the label the plain `ask` block already uses. The check now sits with the work it checks.

**Why a FIELD and not a sixteenth turn.** A `kind:"ask"` turn was the cheaper change and the wrong one
twice over. Visually, `.scr` rows are separated by 2px, so a check appended as a turn reads as one more
line of the same speech rather than the moment the modelling stops and the teacher tests it.
Structurally, a primary box ALWAYS splits — 15 turns never fit one column — and a turn rides whichever
split-card piece it falls in, so the check would land in the middle of the modelling about as often as
at the end. A field travels in `pc-z` by construction, which is the last piece, which is the end of
the box.

**The two emission sites, and why both are load-bearing.** `worked_example` is emitted TWICE:
`makeBlockRenderer`'s `worked_example` case prints the whole box, and `exqAtoms` rebuilds it as
`pc-a` / `pc-m` / `pc-z` split-card pieces the moment `turns.length >= 4`. **A field emitted only at
the first site is a field that vanishes for every primary lesson**, all of which split. The shared
helper is therefore module-level — `cfuRow(b, rich, L)`, the same `(b, rich, L)` shape `scriptRows` and
`script` already use — because the two call sites are in scopes that do not enclose one another. Each
site has its own test, and the split case asserts `pc-z` ends on the check and not on the result.

**The label is `L.askPlain`.** No label was added to `overlay.js`. `askPlain` is "Ask this" / *"یہ سوال
پوچھیں"*, which is already the string printed above every plain `ask` block in the same document, so
Urdu is free and the teacher reads one instruction for one action rather than two names for it.

**The CSS is one hairline, in the box's own family.** A full border would make the check a second card;
no rule at all would make it a fourth line of script. `.exq .cfu` takes a 1px top border in the
surface's own line token — `--s-note-line` on a faded box, `--s-do-line` on a worked one,
`--s-teach-line` on primary's I DO — and the label sits on its own line at the `.tag` scale. No hex
inside any `border*` declaration and no off-ladder radius, which is what `surface-ladder.test.js`
enforces and what this entry's own tests re-assert locally.

**`faded_example` deliberately does NOT get it.** The faded example is where the class works with
support already removed; a check printed there checks the practice, which is what the practice is. The
helper is called from both emitters because the emitters are shared, but only `worked_example` carries
`cfu` in the schema, so the faded call can never fire.

**Additive, so G6-12 is untouched by construction.** No document outside primary carries `cfu` — same
argument and same proof as §3.28 and as `d0_diagram.py`. The control is the GRADE 9 fixture, hashed:
`tests/lp612/primary-worked-cfu.test.js` asserts the SHA-256 of its rendered BODY, in both formats, is
what it was before this change. **The BODY, not the file.** The stylesheet is ONE string shared by
every document, so a new rule necessarily changes a grade-9 render's bytes; what is provable — and what
matters — is that the markup is identical and the new rule matches nothing in it. The digests are
runner-bound: `tests/jest.config.js` maps several bot-only modules to stubs, so a digest captured with
raw `node` will NOT match one computed inside jest, and both must be captured under jest. **If that
test ever goes red, the honest response is to explain the diff, not to repaste the hash.**

**D0 half** (`curriculum/g1-5-resegment/`, untracked). `d0_close.py` is new — `_conclusion` and
`_homework` moved out of `d0_primary.py` when it passed the 300-line limit — and carries
`seat_the_check(sections, g)`, which puts `cfuExplain` on the LAST `worked_example` in `development`.
The last, not the first: the check belongs between the modelling and the guided turn, not between two
modelled examples. **It runs AFTER `d0_diagram.apply_slots`, and that ordering is the whole reason it
is a separate pass** — `apply_slots` swaps a block out WHOLE, so a check attached before the diagram
pass would leave the document inside the box it was attached to. A lesson with no worked example at all
keeps the old seat in the conclusion rather than dropping the check on the floor. Both are tests.

**The relocation forced two other changes, and neither is cosmetic.** `sections.items` requires
`blocks` with `minItems: 1`, so taking the CFU out of the conclusion would have emitted a
SCHEMA-INVALID empty section on all 38 corpus lessons. REMEMBER fills it: a `key_points` block titled
"Remember", which is the schema's own documented mechanism for a titled list and needs no renderer
change and no schema change. Because `after(s)` emits a section's extras AFTER its blocks, REMEMBER
prints ABOVE the exit ticket — her sentence listed it after HW, and that is hers to move. Its items are
`design pending`: nothing in the 26 enrichment fields is a remember line, and `keyFact` is the OUTCOME,
which already prints once in the page-1 outcome box. **`homework` still emits an empty `blocks` array
when the record has no homework** — 0 of 38 corpus records hit it, but it is the same latent
schema-invalid document and is not fixed here.

**Tests:** `tests/lp612/primary-worked-cfu.test.js` (10, red first); `test_d0_close.py` (7, new) and
`test_d0_page2.py` (5, new) in the curriculum tree. Full tree: `tests/lp612` 171 suites / 2,284 tests
green; every D0 suite green with `LP_V9` pointed at this worktree. **`test_d0_contract.py` fails with
the DEFAULT `LP_V9`** — it validates against the live clone, which carries none of §3.26-§3.29; that is
the condition its own docblock describes, not a regression.

### 3.30 `lib/template.js` — a grid row is a ROW, and a short group fills the measure (bd-ip4xh, 2026-09-18)

**Operator, verbatim:** *"no blank spaces"* — said of page 1's materials list, and then true again on
A4 p7 and p12-13, which is where this entry starts.

**What was wrong.** The mistakes box and the differentiation cards each printed in a narrow left
column with two thirds of the page blank beside them, three times over. The obvious reading is a CSS
one -- `.grid3` is fixed at three columns, so a row holding one card leaves two empty -- and it is
wrong. Reading the shipped markup showed the three differentiation cards arriving as THREE separate
`<div data-atom class="grid3 sp-2">` wrappers, each holding exactly one `.card`. **The cause is the
atom shape, not the stylesheet:** `groupAtoms` emitted ONE CARD PER ATOM, and every atom wore a
three-column grid it could never fill.

**Why it was ever written that way.** An atom is the packer's unit -- the page break may fall between
two atoms and never inside one. One card per atom is the shape that lets a group of three split across
a page boundary instead of being pushed whole to the next page. That reasoning is sound on the PHONE,
where `PAGE.oneColumn` makes a row a card anyway; on A4 it bought page-break freedom by paying a third
of the measure for every card.

**The fix, and why it is a delegation rather than a rewrite.** `gridRows` already draws exactly the
distinction this needed -- `perRow = PAGE.oneColumn ? 1 : (cls === "grid3" ? 3 : 2)` -- for the support
page, so `groupAtoms` now calls it instead of restating it. That required `gridRows` to move from
inside `page2` to module level (a `function` declaration, so hoisting keeps the call sites in either
order). **The label still rides row 1** -- the YOU-DO precedent in `blockAtoms` -- so a page can never
open on a bare card with no statement of what it is a card of.

**The CSS is the second half, and it is for a genuinely short group.** Three cards now share one row,
but a lesson with ONE mistake still hands the grid one card. `gridRows` tags a group that is a single
short row with `n1` / `n2`, and `.grid2.n1, .grid3.n1{ grid-template-columns:1fr; }` /
`.grid3.n2{ grid-template-columns:1fr 1fr; }` let it fill the measure. **Only when the WHOLE group is
one short row.** A trailing card widened to full width under full rows above it breaks the column
rhythm that is what makes a grid readable at a glance, so a multi-row group keeps the fixed count and
lets its last row run short. There is no `n3`: three cards in a three-column grid is the grid.

**THIS IS NOT ADDITIVE, and the entry says so plainly.** Every previous primary entry could prove
G6-12 untouched by construction, because the field it added existed on no other document. This one
changes a renderer function every grade calls. The honest statement of the blast radius, measured on
the hashed grade-9 control in `tests/lp612/primary-worked-cfu.test.js`:

- **PHONE: byte-identical.** `PAGE.oneColumn` already made a row a card there, so `gridRows` returns
  what `groupAtoms` used to return, atom for atom. The phone digest did not move.
- **A4: the body changed, and the A4 digest moved once, here.** Diffed line by line: the ONLY changes
  are two grid wrappers -- the three mistake cards and the three differentiation cards each collapse
  from three single-card `.grid3` atoms into one full three-card row. No word, no label, no other
  class moved. That is the fix arriving on a grade-9 page, and it is the same improvement: three
  one-third-width boxes become one full row.

The rule in that file -- *"if one of these ever fails, explain the diff, do not repaste the hash"* --
was followed: both bodies were dumped and diffed before the digest was touched, and the explanation is
written into the file above the constant.

**Tests:** `tests/lp612/grid-short-row.test.js` (8, red first). Four assert the A4 shape (three cards
one row; `n1` on a group of one; `n2` on a group of two; a four-card group keeps three fixed columns
with no `n*`), four are controls (the label rides row 1; the phone keeps one atom per card; a lone
phone card gets no `n1`; the sheet defines `n1`/`n2` and no `n3`). **The red run had to be done
twice.** The first was invalid: the test called `setPageFormat("a4")` before `buildHtml`, and
`buildHtml` calls `setPageFormat(opts.format || "phone")` itself at the top, so every "A4" assertion
was really running on a phone sheet. **The format must ride the options object.** The corrected red
was proven by reverting `groupAtoms` alone -- `git stash` is forbidden here and `git checkout --`
would have destroyed unrelated uncommitted work in the same file -- then restoring from a byte-checked
snapshot.

### 3.8 Nothing else

Every other file in `lib/` is **byte-identical to upstream**. `lib/template.js` is not: it carries the
four `glue` marks (§3.9), the page-format parameter (§3.14), the NIETE `:root` (§3.15), the board /
practice re-shaping (§3.16), the script-as-turns renderer (§3.17), the split example with its seam
rules (§3.18), the two board grid tracks (§3.19), primary's page-1 furniture with the exported
`isPrimary` predicate (§3.20), the board connector renderer (§3.21), the one opening box (§3.22) and
the three move surfaces with the split activity band (§3.23), the primary diagram floor
with its phone-first canvas (§3.24), the board hoisted onto page 1 (§3.25), the phase/move split on the
band (§3.28), the check that closes the worked example (§3.29) and the grid row that is a row (§3.30). `lib/overlay.js` carries the
two board labels (§3.16), the two script column heads (§3.17), page 1's seven labels (§3.20) and the
two band names `weDo` / `youDo` (§3.23). `schema/lp_doc.schema.json`
carries two additive hunks — the `board` variant's optional `title` and `panels` (§3.16) and the two
example variants' optional `turns` (§3.17) and `sequence`'s optional `day` / `of` (§3.20) — **all five were actually spliced in on 2026-09-18 by §3.27, not by the entries that named them**, along with the `big_idea` variant (§3.26), `section.move` (§3.28), `worked_example.cfu` (§3.29) and the `script_turn` / `board_panel` definitions; `lp_doc.v2.schema.json` is untouched. The `diagrams/` tree is
byte-identical apart from §3.12 (`index.js`, plus the new `lib/tex.js`). `lint_lp.js` is no longer wholesale byte-identical — see §3.13 for the two `overlayTargets()` fixes, and §3.11 for its three new checks
(render-laws 22-24): two of the three (WARMTOPIC, LABELACT's English half) landed as identical
hunks in both trees, one (LABELACT's Urdu half) is a genuine kept divergence, and one (REDUNDANT's
message text) is a cosmetic one. The renderer's `MAX_PAGES` / `WARN_PAGES` / `BODY_FLOOR_PX` /
`CHIP_FLOOR_PX` moved on 2026-09-06 (§3.10) — **in both homes, to the same values**, so they are
still not a divergence. `MAX_PAGES_PRIMARY` and `pageCapsFor(lang, doc, format)` **are** one (§3.17, §3.20). Verify with §6's diff command.

---

## 4 · What was ported (not vendored) from the Python

`bot/shared/services/lp612-author.service.js` ports the control flow of
`lp_author/author_lp.py::author()`, and `lp612-pagetruth.service.js` ports
`lp_author/retrieve.py`. Ported faithfully:

* the prompt shape (`build_user_prompt` + `compact_pagetruth`), with the brief as the system
  message;
* one author call, **one retry** when the response carries no JSON;
* the same for the revision call — the asymmetry that cost a pilot two of its three rounds;
* the JSON extraction ladder: fence strip → **backslash repair before parsing** (a raw `\frac`
  parses "successfully" into a form feed and silently destroys the formula) → parse →
  balanced-brace scan;
* per round: schema validate **then** the vendored `lint()`, **in process**;
* the revision prompt's preamble verbatim, including *"OVERSHOOT the cut by about 10%"*;
* **a worse candidate is rejected but the ladder CONTINUES** — a bad round costs the round,
  never the climb — and an unparseable or blown-up round costs the same.

**Not ported, on purpose:**

* the judge (§3.5);
* `pick_backend()` — every call goes through `bot/shared/services/llm-client.js` (OpenRouter),
  never a raw HTTP call, never the Anthropic API directly. The model comes from the caller,
  defaulted by `resolveAuthorModel()` from `LP_AUTHOR_MODEL`;
* `_literal_eval_object()` — the repair for a response that comes back as a **single-quoted
  Python dict**. It is `ast.literal_eval` behind a round-trip guard, and Node has no safe
  equivalent (`eval` is not one). A response in that shape therefore costs an attempt and then a
  round, exactly as an unparseable response does. **This is a real, if narrow, capability loss;
  it is the one repair upstream added after it cost a pilot its whole ladder.**
* writing `<stem>.raw.txt` / `.rejected-rN.json` artefacts to disk — the raw text of every
  attempt is logged instead (`logToFile`), because a worker has no per-lesson output directory;
* `--revise-only`, `--fix`, the spend ledger, and the fleet dispatcher.

---

## 5 · Known coverage gaps

* **Upstream's own suites do not run here.** `lp_html/test/` (the renderer/lint contract, the
  v9 gate cases, the truncation and paint-level gates) and `test_lp_author.py` were not
  vendored. `tests/lp612/` covers *these services*, not the pipeline's internals. A re-vendor is
  therefore only as safe as §6's procedure makes it — run upstream's suites **upstream**.
* **The root Jest suite stubs `ajv`, `katex` and `openchemlib`** (`tests/__mocks__/`), because
  CI runs it before `bot/ npm ci`. The ajv stub is a deliberate *subset* validator and can only
  be more permissive than real ajv; the katex stub does not typeset. A green schema/lint result
  in the root suite means "structurally plausible", not "the canon gate passed".
* **Nothing here has been rendered on Linux** (§3.2).

---

## 6 · Re-vendoring procedure

Do this when the skill's pipeline updates — never edit a vendored file to chase a fix that
belongs upstream.

1. **Fix it upstream first**, and run upstream's own suites there:
   `cd <skill>/scripts/lp_html && npm install && npm test`, and
   `cd ../lp_author && python3 -m pytest test_lp_author.py`.
2. **Diff before you copy** — this is the step that catches a divergence someone added here
   without an entry in §3:
   ```
   diff -ru <skill>/scripts/lp_html/lib  bot/vendor/lp-v9/lib
   diff -u  <skill>/scripts/lp_html/lint_lp.js  bot/vendor/lp-v9/lint_lp.js
   diff -u  <skill>/scripts/lp_html/render_lp.js  bot/vendor/lp-v9/render_lp.js
   diff -ru <skill>/scripts/lp_html/diagrams/lib  bot/vendor/lp-v9/diagrams/lib
   diff -ru <skill>/scripts/lp_html/diagrams/types  bot/vendor/lp-v9/diagrams/types
   ```
   Expect **exactly** the §3 divergences and nothing else. Anything else is either an
   undocumented local edit (document it or drop it) or upstream drift you are about to take.
3. **Copy** the §1 table's paths. Do not copy `node_modules/`, `.venv/`, `out/`, `.figcache/`,
   `samples/`, `test/`, or the `package*.json`.
4. **Re-apply the §3 divergences** to the files that carry them — today `lib/fonts.js` and
   `render_lp.js`. Keep the `VENDOR DIVERGENCE` comments; they are how the next person finds
   them.
5. **Reconcile the deps.** If upstream's `lp_html/package.json` or `diagrams/package.json` gained
   a dependency, add it to `bot/package.json` **and** stub it in `tests/__mocks__/` + wire the
   stub in `tests/jest.config.js` in the same change — the root suite runs before `bot/ npm ci`,
   so an unstubbed new dep kills whole suite files.
6. **Check the schema version.** If `schema/lp_doc.schema.json`'s `template_version` or
   `schema_version` const moved, the author brief, the author service's prompt and any stored
   `lp_doc` rows move with it. A schema bump is a migration, not a copy.
7. **Run** `npx jest --config tests/jest.config.js tests/lp612 --forceExit`, then the repo's
   baseline gate (`npm test`).
8. **Update §1's vendoring date** and add anything new to §3.

> **Partial re-vendor, round 5 (early-years figure types).** Eight NEW type modules
> (`diagrams/types/{word_blank,count_objects,count_frame,clock,pattern,match,money,compare_size}.js`),
> one NEW shared library (`diagrams/lib/pictogram.js`), one NEW asset directory
> (`diagrams/assets/pictograms/` — 207 line-art glyphs + `index.json` + `sources.json` +
> `build_pictograms.js` + `LICENSE.txt` + `ATTRIBUTION.md`), and edits to THREE existing files
> (`diagrams/types_manifest.json`, `diagrams/types/atom.js`, `diagrams/types/ray_diagram.js`).
> Fixed upstream first, then copied byte-for-byte; `diff` against the upstream copy is empty for
> every file listed. **No new §3 divergence** — everything here is upstream too.
>
> **Why.** The engine's twenty types are the 6-12 lesson-plan roster: they draw quantity, structure
> and process. A grade 1-2 phonics, spelling, counting, time, money, pattern or matching lesson could
> reach none of them, so a picture question at that age was impossible. The eight new types are that
> stage, drawn from the engine's own primitives over a vendored open-licence pictogram set.
>
> **The pictogram set.** 207 line-art glyphs from **OpenMoji 15.0.0** (the *black* variant), used
> under **CC BY-SA 4.0**. `LICENSE.txt` and `ATTRIBUTION.md` ship beside them, `index.json` records
> every glyph's hexcode, annotation and author, and `lib/pictogram.js` writes the attribution into
> each figure's own `<desc>` so the credit travels with a picture that is delivered as a bare PNG.
> The set was chosen by intersecting the concrete nouns of the K-5 and Punjab 1-5 curriculum
> segmentations with what OpenMoji actually has — never from memory. Rebuild with
> `node diagrams/assets/pictograms/build_pictograms.js`; `_raw/` (the fetch cache and the 2 MB
> upstream metadata) is gitignored, so the build is reproducible but the repo carries only the
> normalised 860 kB. The normalisation steps and the reason for each are documented at the top of
> that script — in particular `data-ov="skip"` on every drawn element, because a glyph's internal
> strokes are art and must not be read by `checkOverlaps` as rules crossing a label.
>
> **The two edits to existing types are a BUG FIX that the lesson-plan lane wants too.** `atom.js`
> and `ray_diagram.js` write a sentence of their own when the author gives no caption, and those
> sentences (plus the ray diagram's `Object` / `Image` labels) were English whatever `lang` said — so
> an Urdu page carried an English sentence under an otherwise Urdu picture. They now follow the
> figure's language; symbols, Z, shells, distances, magnification and the F / 2F handles stay Latin
> and LTR in both, as a Pakistani Urdu-medium textbook prints them. `ray_diagram.js`'s `halo()` also
> stopped computing its own label plate: its Urdu arithmetic did not match `_urduText`'s, so the
> plate was narrower than the label and every Urdu ray diagram reported six collisions the moment its
> labels stopped being English. It now uses `svg.plateText`, which is the engine's own rule — no type
> module may compute a label extent of its own.
>
> Tests: `tests/quiz/transcript-quiz-figure-early-years.test.js` (44),
> `transcript-quiz-figure-language-labels.test.js` (8),
> `transcript-quiz-figure-adaptive-scale.test.js` (25),
> `transcript-quiz-early-years-gating.test.js` (13) — all through the quiz lane's own
> `renderFigureSvg`, so a red run proves the **vendored** copy is what changed. Red was confirmed for
> each by restoring the pre-patch file and re-running.

- **`lint_lp.js` — RELIGIOUS_MARKS no longer demands ﷺ after a `محمد` that opens another person's compound name** (bd-gyrg8, 2026-09-11). Added `isCompoundGivenName()` next to `PROPHET_RE`. Applied upstream in the same change, so a straight re-vendor keeps it.
