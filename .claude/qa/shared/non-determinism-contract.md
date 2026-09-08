# Non-determinism contract for the NIETE WhatsApp E2E suite

**Why:** large parts of the bot's output are **non-deterministic** — LLM free-text, model scores,
randomised/seeded question sets, shuffled options, generated PDFs/images, async pipelines, and
state-dependent lists whose contents drift run-to-run. Tests that pin exact content flake. Every
feature spec follows the rules below so a re-run passes on the same *behaviour*, not the same bytes.

## The rules (apply to every feature)

1. **Never assert volatile content.** Not a specific generated sentence, model score, question,
   option letter/index, filename, token, timestamp, exact count, or a specific catalog item (module,
   school, teacher, chapter…) by name.
2. **Assert the contract instead** — structure, template, relationship, or shape:
   - a heading / CTA / button label is present (these are FIXED strings → `@copy`-assertable);
   - a templated message matches its pattern with placeholders (`"…, <name>!"`, `"<got>/<total>"`,
     `"Step <n>/5: …"`, `"<n> questions · <p>% required · …"`);
   - a count matches a **shape/relationship** (`<done>/<total> · <pct>%`, `pct == round(done/total*100)`,
     `served == min(bank, cap)`), never a fixed number;
   - an artifact is **delivered** (a PDF document arrives / an image arrives / a link is present),
     not that it contains specific text;
   - exactly-one-of-a-kind invariants (one "Next up", one active item) hold.
3. **`@content-driven` steps are resolved LIVE.** When a step needs a "correct"/"substantive"
   answer, read the live prompt + options and decide at run time (match option TEXT to the semantic
   answer key by substring — never by position; for a forced-wrong pick any option NOT matching the
   correct key). For free-text AI replies, assert **relevance/shape** (non-empty, on-topic, right
   language per `preferred_language`), not wording.
4. **Identify by role/state, not by name.** "the in-progress level", "the next-up module", "the
   active job", "a grade with no corpus" — then assert transitions against the **observed pre-state**,
   not absolutes.
5. **Async outcomes:** assert the eventual **template/step** or the delivered artifact (or the DB
   terminal state out-of-band), never an inline-timed exact string. Long pipelines may not finish
   in-window — assert progress reached a known step, and mark the final artifact `@slow`/`@wip`.
6. **`@copy` is the deliberate exception** — it pins the exact wording of a **fixed** string
   (headings, button labels, static templated messages). A `@copy` fail = an intended copy change,
   not flakiness. `@copy` scenarios never assert the variable body (AI text, scores, generated docs).

## What varies, per feature (cheat-sheet)

| Feature | Deterministic (assert exact / `@copy`) | Non-deterministic (`@content-driven` / shape only) |
|---|---|---|
| **menu** | the 4 ICT rows, "Here's what I can do!", "View Features", `/portal` URL, `/language` picker options | **Ask Anything** answers · **gibberish** reply · AI reply **language** (per `preferred_language`) |
| **lesson-plan** | menu CTA "Pick Class", picker labels, "Sending your lesson plan…", grade list 1–10 | the **PDF** itself (filename/content) · **NL/AI (Gamma)** generation text · which chapters/topics exist (catalog) |
| **coaching** | menu prompt, "Yes, Analyze", the 5 step **templates** ("Step n/5: …"), interstitial button copy | detected **duration** · **FICO/ICT feedback** text + scores · transcript · final report image (async) |
| **registration** | screen titles, field labels, "You're all set", region/role option lists | the **portal setup token/URL** (random) · any AI echo · (F-REG1 greeting name — a known bug, not RNG) |
| **status** | "Running for you:", "Nothing's running right now.", command copy | **which** in-flight items are listed (depends on what's running) · counts |
| **observe** | onboarding steps, "Plan my visit", scheduling menu rows, brief scaffold lines, deny copy | the **school/teacher roster** · **support-brief** wording · **FICO** scores/report · **coach-feedback** · cert code |
| **attendance** | flow prompts, method options, confirm copy | roster contents · **voice roll-call** transcription · register counts · dates |

## Tagging

- `@content-driven` — the scenario's answer/assertion must be resolved live (rule 3). Add it wherever a
  step says "answer correctly", "a substantive answer", "the right option", etc.
- `@copy` — asserts a fixed string (rule 6).
- Everything else asserts structure/shape by default (rules 1–2, 4–5) — no special tag needed.

Feature specs reference this file from their header rather than restating it.
