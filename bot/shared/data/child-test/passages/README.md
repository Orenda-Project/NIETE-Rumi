# Challenge passages: one file per passage id

Every passage the Challenge can serve (check pool) or show in Story Time (practice pool) lives in this directory as
`<passage_id>.json`. The loader (`bot/shared/services/child-test/item-bank.js`, section "battery v4 (content registry)")
reads every `*.json` here once at start-up, sorted by file name, and deep-freezes it.

## Rules

- **One file per id, named after it.** `ur.read.1.sparrow` lives in `ur.read.1.sparrow.json`. A file whose
  `passage_id` does not match its name, or an id that appears twice, stops the loader at start-up.
- **Immutable per id.** Once a passage id has been served, its text, lines, questions and options never change. A fix
  is a NEW id (and the old id is retired in the registry table `challenge_passages`).
- **Id shape:** `<lang>.<kind>.<band>.<slug>`: `lang` en or ur, `kind` read or listen, `band` 1 to 3, an ASCII slug that
  follows the title. Never a child's name in an id.
- **Pools never mix.** A practice id never moves to the check pool and a check id never moves to practice.
- The text lives here; status, release time, review and sign-off live in the registry table. A deploy adds a file;
  a registry row change releases it.
- Child-facing fields (`title_en`, `title_ur`, `text`, questions and options) are gender-neutral, carry no test words
  and no digits, and Urdu is written without diacritics. An Urdu field is never filled with an English placeholder:
  leave it `null` until the Urdu text is written and read by a native reviewer.

## Schema: an authored passage

```json
{
  "passage_id": "ur.read.1.sparrow",
  "lang": "ur",
  "kind": "read",
  "band": 1,
  "pool": "check",
  "status_at_authoring": "draft",
  "is_reference": false,
  "tokens": 36,
  "sentences": 6,
  "mean_sent_len": 6.0,
  "max_word_len": 6,
  "readability": 0.92,
  "readability_list": "fed-cum-g2-2026",
  "source_ref": "...",
  "licence": "generated",
  "title_en": null,
  "title_ur": "...",
  "text": "...",
  "lines": [[0, 6], [7, 13]],
  "questions": [
    {
      "id": "q1",
      "prompt": "...",
      "type": "literal",
      "needs_line": 1,
      "tap_ok": true,
      "right": "...",
      "wrong": ["...", "..."],
      "accept": ["..."],
      "reject": ["..."]
    }
  ],
  "params": { "reserve": false },
  "twin_of": null,
  "bank_version": "child-test-items-v4",
  "reviewer": "...",
  "reviewed_at": "..."
}
```

- `status_at_authoring`: `draft` or `reviewed`. The live status is the registry row's, never this field.
- `licence`: `textbook`, `cc_by`, `cc_by_sa` or `generated`; `source_ref` names the textbook pages, the CC title and
  URL, or the generation brief version.
- `type`: `literal` or `inferential`. `needs_line` is the last line a child must have read to answer; questions are
  served in `needs_line` order. `tap_ok` defaults to `false` when left out.
- `params.reserve` (optional, practice only): the band-1 reserve story.
- `twin_of`: the read passage a listening passage shares its text with, else `null`.
- `reviewer`, `reviewed_at`: optional here; the registry row holds the sign-off.

## Schema: a Set A pointer

Set A's text already lives in `item-bank.v3.json` and stays byte-identical there. Its passage file points at it:

```json
{
  "passage_id": "ur.read.2.setA",
  "lang": "ur",
  "kind": "read",
  "band": 2,
  "pool": "check",
  "is_reference": true,
  "v3_ref": { "lang": "ur", "kind": "story" },
  "questions_extra": [],
  "bank_version": "child-test-items-v3"
}
```

- `v3_ref.kind`: `story` (read) or `listening` (listen).
- The loader fills `text`, `tokens` and `lines` from the v3 task's `story`, `direction` from the v3 task, and
  `questions` = the v3 questions followed by `questions_extra` (new questions continue the ids, e.g. `ur.story.q7`).
