# The video enhancement test — LP612

**For whoever runs the YouTube swarm.** Operator decision, 2026-09-12 (bd-a8veu.12), on item 4 of
the v9.3 PDF review:

> *"videos should have enhancement mateiral for the SLo not just reading the same passage as on the
> textbook or solving the same exercises"*

This replaces the rule that was in force until now — *"every LP, all subjects, best available link,
validated live"* (`schema/lp_doc.schema.json`, 2026-09-01). **Every LP is still considered. Not every
LP gets a link.**

---

## The test

A video ships only if it shows the teacher something **the printed page cannot**:

- a **process animated** — erosion, circulation, a reaction proceeding, a machine working
- a **real instance filmed** — the actual forest, the actual instrument, the actual place
- a **method demonstrated** — someone doing the thing, hands visible, in real time
- a **scale or a timespan made visible** — a timelapse, a cutaway, a zoom from metres to microns

If the best candidate is a **read-through of the same passage**, or a **walk-through of the same
exercises**, it **fails**. Return no pick. An empty slot is the ordinary outcome for a descriptive
topic, and it is **not an error** — nothing in the renderer or the linter treats it as one.

### The one-line check

> If the teacher played this and then read the textbook aloud, would the class have seen anything
> new? If no, it fails.

### Two worked calls

| Segment | Candidate | Verdict |
|---|---|---|
| `grade_6_geography.c04.p063-064` — forest types of Pakistan | "Forest Types of Pakistan — full chapter read aloud" | **fail** — it is the passage, spoken |
| same segment | a timelapse of an alpine forest through four seasons | **pass** — the change over a year is not printable |

---

## What the swarm must write

The corpus format does not change. For **every segment you considered**, write a `yt` slot in
`yt/corpus_filled/<book>_segments.json`:

```jsonc
{ "segment_id": "...", "yt": { "url": "...", "title": "...", "channel": "..." } }  // passed
{ "segment_id": "...", "yt": null }                                               // considered, nothing passed
```

**Both lines matter, and the second one is the new part.** The importer reads *which segment_ids your
file names*, not which of them carry a url:

- **named, with a url** → the pick is stored (and replaces any pick already there)
- **named, with no url** → this is a **withdrawal**. Any pick already in the table is **cleared**, and
  the run reports it (`withdrawn N` in the import summary)
- **not named at all** → untouched. A book you have not reached has no file, and keeps every pick it
  has

So a segment you rejected must still appear in the file. Leaving it out silently keeps whatever is
already stored — which, for the ~4,700 links written under the old rule, means the re-read stays.

Implementation: `bot/scripts/import-lp612-segments.js` (`mergeExistingYt` / `countWithdrawn`),
guarded by `tests/lp612/video-withdrawal.test.js`.

---

## Re-running against what is already stored

The links written under the old every-LP rule were picked to satisfy *"best available"*, not this
test. Re-running a book against the test is expected to **clear** some of them. That is the point of
the change, not a fault — but check the `withdrawn` count in the import summary against what you
meant to withdraw before moving to the next book.

---

## What the empty slot costs — nothing

- `lib/template.js` prints no resources line and no empty label when there is no pick
  (`tests/lp612/video-resources-slot.test.js`, `tests/lp612/video-enhancement.test.js`)
- `lint_lp.js` has **no video gate at all** — an LP with no video lints clean
- the author service is already told *"No video is available for this lesson"* and writes nothing
  (`lp612-author.service.js`); a model-invented url is deleted by `parseYt`
