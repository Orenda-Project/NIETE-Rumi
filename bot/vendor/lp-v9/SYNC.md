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
| `render_lp.js` | `lp_html/render_lp.js` |
| `lib/*.js`, `lib/clean_figure.py` | `lp_html/lib/` |
| `schema/lp_doc.schema.json` | `lp_html/schema/lp_doc.schema.json` (v3.0 — current) |
| `schema/lp_doc.v2.schema.json` | `lp_html/schema/lp_doc.v2.schema.json` (v2.0 — frozen) |
| `diagrams/index.js`, `diagrams/lib/*.js`, `diagrams/types/*.js` | `lp_html/diagrams/` |
| `brief_author_v3.md` | `lp_author/brief_author_v3.md` |
| `brief_author_v3_flash_{maths,sci,prose}.md` | `lp_author/brief_author_v3_flash_{maths,sci,prose}.md` |
| `fonts/Inter-{Regular,SemiBold,Bold}.ttf` | workspace `06_Logs & Misc/Reports/Active/Tanzania Expansion/02_Coaching_MEWAKA/mewaka-sample-report/` |
| `fonts/NotoNastaliqUrdu.ttf` | workspace `02_Main Rumi Bot/fonts/` |

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
> * **Per-language page caps** (`render_lp.js`): `pageCapsFor(lang)` — English unchanged at
>   5/4 (warn 4/3); Urdu 7/5 (warn 6/4), the measured ~+33% footprint. Word budgets in
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

### 3.8 Nothing else

`lint_lp.js`, both schemas, every other file in `lib/`, and the whole `diagrams/` tree are
**byte-identical to upstream**. In particular the lint's gate list, thresholds, word budgets and
the renderer's `MAX_PAGES` / `WARN_PAGES` / `BODY_FLOOR_PX` / `CHIP_FLOOR_PX` were not touched.
Verify with §6's diff command.

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
