# `bot/vendor/lp-v10` — the rules the GB v10 card is written with, and where they came from

These are the prompt texts and approved examples that `bot/shared/services/lp-v10-card/` (moves.js, author.js)
gives the model when a GB lesson is written on request (bd-rj6w0n.14.16.6). They are the same texts the 838 live GB
cards were written with offline (`GB_WORKER_PROMPT.md`). Copied by hand; not a dependency, not a submodule.

Upstream lives in the operator workspace, outside this repo. `<ws>` = the Rumi workspace root,
`V10` = `<ws>/ICT NIETE/v10-build`, `GB` = `<ws>/06_Logs & Misc/Investigations/workspace/global/lesson-plans/
bd-rj6w0n-gb-curriculum-matrix/versions/31_g3_build/lane/v10`.

## 1 · Straight copies (sha256 prefix matches upstream, 2026-11-07)

| Vendored here | Upstream | sha256 |
|---|---|---|
| `CARD_BRIEF.md` | `V10/workbench/author/BRIEF.md` | `4e5d725ca413` |
| `EXTRACTION_BRIEF.md` | `<ws>/.claude/skills/curriculum-baked-lesson-plans/scripts/fidelity/EXTRACTION_BRIEF.md` | `397ee96726b2` |
| `example_english.card.json` | `V10/cards/g1_ch4/English_seg1.card.json` | `8605dee47a95` |
| `example_maths.card.json` | `V10/cards/g3_ch4/Maths_seg1.card.json` | `b582f0f79576` |

## 2 · Excerpts (only the parts GB_WORKER_PROMPT.md tells the worker to read)

| Vendored here | Upstream | What was kept |
|---|---|---|
| `EXIT_GOAL.md` | `V10/workbench/author/EXIT_GOAL_PROMPT.md` | "What the judge needs" + "How to fix" |
| `HOME_TURN.md` | `V10/workbench/author/HOME_TURN_PROMPT.md` | items 1-4 |
| `URDU_RULES.md` | `V10/workbench/author/URDU_WORKER_PROMPT.md` | its Urdu rules section |
| `GB_RULES.md` | `GB/GB_WORKER_PROMPT.md` | the GB rules that win over the brief; batch and file-handling steps dropped |

## 3 · Divergences

- `CARD_BRIEF.md` is unchanged on disk; `author.js` drops everything from `## Check your own card` on at runtime,
  because the gates run in code and their reasons go back to the model instead.
- `GB_RULES.md`: Science keeps `header.subject` "Science". ICT's rules only know English/Urdu/Maths, so
  `attach.js` (`asEnglish`) checks a Science card under the English rules, as offline `gb_v10.science_as_english` did.

## 4 · Re-vendoring

Copy §1 files over unchanged and re-take the §2 excerpts by hand; update the sha column; run
`npx jest tests/lp-v10-card tests/unit/lp-v10-card` from `bot/`.
