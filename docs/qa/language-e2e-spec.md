# Language E2E — assertion spec (NIETE ICT)

**For:** QA, who own end-to-end testing for the language-unification work.
**From:** the audit of every language decision in the codebase.
**Status:** spec only. No harness is prescribed — the assertions are the deliverable.

NIETE ICT serves **exactly two languages: English and Urdu.** Anything else
appearing anywhere is a defect, not a variation.

---

## Why this spec exists

A language E2E suite written from the feature list will test the happy path and
pass while the real defect is untouched. The defects in this system are not
"a screen is untranslated" — they are:

- a teacher is answered in a language she never chose
- she changes it and the change is silently reverted or takes a day to apply
- one surface obeys her and the next does not, mid-journey
- a document renders in the wrong *script* even though the language is right

So the assertions below are organised by **the language of what she receives**,
per persona, and they include the switch and the surfaces that historically
disagreed. Measured production baseline: 14.4% of teachers we could measure had
already been answered in a language that was not their stored preference.

---

## Personas

Set up on staging (`+92 322 2482222`). Both must be **registered** users with a
completed profile, because unregistered paths have different copy rules.

| Persona | `preferred_language` | `language_locked` | Represents |
|---|---|---|---|
| **ICT-EN** | `en` | `true` | explicitly chose English |
| **ICT-UR** | `ur` | `true` | explicitly chose Urdu |
| **ICT-DEFAULT** | `en` | `false` | never chose — 99.6% of the real population |
| **NEGATIVE CONTROL** | `en` | `true` | asserted *wrongly* on purpose |

The negative control is not optional. Assert one thing about it that is
deliberately false (e.g. expect Urdu from the English persona). If the suite
passes with the control in place, the suite is not actually checking anything.

**Script note for assertions:** English and Urdu do not share a script, so
"which language is this?" is decidable without a language model. Urdu text
contains Arabic-block codepoints; English is Latin. Distinguishing Urdu from
Arabic (if it ever appears) needs Urdu-only codepoints: `ے ں ہ ٹ ڈ ڑ گ چ پ ک ی ۓ`.

---

## A · The choice and the switch

| # | Assertion | Notes |
|---|---|---|
| A1 | `/settings` language dropdown offers **exactly two** options: English and اردو | Nothing else. Previously offered 5, including Kiswahili, Arabic, Spanish |
| A2 | `/language` list offers **exactly the same two** options | Previously offered 10 |
| A3 | Neither picker offers an "Auto-detect" option | It disabled the lock that protects her choice |
| A4 | Switching via `/settings` → the **next** message is in the new language | Not "eventually". Previously stale for up to 24h |
| A5 | Switching via `/language` → same | The two switchers must behave identically |
| A6 | The confirmation *after* a switch is in the **new** language | An Urdu switch confirmed in English is the defect |
| A7 | Switch en→ur→en round-trips cleanly | Both directions, repeatedly |
| A8 | Saving `/settings` **without touching language** leaves language unchanged | A framework-only save previously reset it to English |
| A9 | After any switch, `language_locked` is `true` | Verifiable in the DB if QA has read access |

## B · Chat and conversational surfaces

| # | Assertion |
|---|---|
| B1 | Text reply is in the persona's language |
| B2 | Voice-note reply is in the persona's language |
| B3 | Menus, buttons and list chrome are in the persona's language — including the footer |
| B4 | Error messages are in the persona's language, and are **not** English+Urdu stapled together |
| B5 | Progress / "please wait" messages are in the persona's language |
| B6 | Sending an unsupported message type (sticker, location, contact) errors in her language |
| B7 | An ICT-UR teacher who sends one English message is **still** answered in Urdu | Input language is not a preference change |

## C · Coaching

Historically the worst offender: the report, the voice debrief and the
commitment card could each pick a different language from the same session.

| # | Assertion |
|---|---|
| C1 | Coaching report PDF is in the persona's language |
| C2 | Voice debrief is in the persona's language |
| C3 | Commitment card is in the persona's language |
| C4 | **C1, C2 and C3 agree with each other** for one session |
| C5 | An Urdu-medium recording from ICT-EN does **not** change her stored language |
| C6 | An English-medium recording from ICT-UR does **not** change her stored language |
| C7 | Same as C5/C6 for ICT-DEFAULT (unlocked) — audio must never write a preference |

## D · Documents — language *and* script

The language can be right and the document still wrong. Urdu must render in
**Nastaliq**, right-to-left, fully joined. Failure modes to reject:

- **tofu** — empty boxes where glyphs should be (no Urdu font applied)
- **mojibake** — Latin-1 garbage such as `d†Ìcl jö''`
- **unjoined letters** — Urdu rendered as isolated forms instead of a cursive join
- **Naskh instead of Nastaliq** — legible but the wrong script style for Urdu readers
- **LTR alignment** — Urdu text left-aligned instead of right

| # | Assertion |
|---|---|
| D1 | Coaching report PDF: Urdu renders in Nastaliq, RTL, correctly joined |
| D2 | Reading-assessment report: same |
| D3 | Training certificate: same — **and the teacher's name** renders correctly |
| D4 | Every document for ICT-EN is in English with no stray Urdu |
| D5 | No document contains both languages unless the design calls for it |

D3 matters most: a certificate is the most permanent artifact the bot produces.

## E · Classroom-facing content

| # | Assertion |
|---|---|
| E1 | Lesson plan is generated in the persona's language |
| E2 | Lesson-plan headings and section titles are in that language too — not English headings over Urdu body |
| E3 | Quiz content for the teacher is in her language |
| E4 | Student-video / video-quiz messages sent onward carry the **teacher's** language |
| E5 | Switching language *while* a lesson plan is generating does not change the language of the artifact she asked for |

## F · Flows and templates

| # | Assertion | Notes |
|---|---|---|
| F1 | Settings Flow screens render in the persona's language | On a real device — Flow rendering is client-side |
| F2 | Registration Flow shows the language question with both options | |
| F3 | Multi-select quiz (MSQ) Flow screens render in her language | |
| F4 | A template send succeeds in her language | **See the blocker below** |

### Blocker on F4 — read before planning template tests

An audit of the staging WABA (`2019470752271014`, read-only, via Graph API)
found **exactly one template: `hello_world`, approved in `en_US` only.** There
are no real templates on staging, so **template sends cannot be exercised there
at all** — every template-dependent path will hard-fail.

Two consequences for QA:

1. F4 must either run against production (with approval) or wait until the
   needed templates are created and approved on the staging WABA.
2. **Meta's language codes are not our language codes.** The one template is
   `en_US`, not `en`. A send that passes `'en'` will **not** match an
   `en_US`-approved template, and Meta does not fall back — it hard-fails. So
   assert the *exact* Meta code, not the internal one.

Re-run the audit any time to get the current matrix:

```bash
node bot/scripts/audit/template-language-matrix.js
```

## G · Fallbacks and edge cases

| # | Assertion |
|---|---|
| G1 | When language detection fails, the reply is **English** — never Urdu |
| G2 | A user with an unrecognised stored language gets an offered language, never a third one |
| G3 | Reading assessment keeps its **per-session** passage-language picker | Correct by design — language is what's being measured. Assert it still works |
| G4 | The reading-assessment welcome copy is in her interface language |
| G5 | No surface ever emits Kiswahili, Arabic, Spanish, Punjabi, Sindhi, Pashto, Balochi or Tamil |

G5 is the catch-all. Production `output_language` currently contains 19 Punjabi
and 2 Arabic rows for teachers whose stored preference is only ever en or ur —
so this is a real regression class, not a hypothetical.

---

## What QA does not need to cover

These are asserted by unit and conformance tests in the repo, so E2E should not
duplicate them:

- the language offer is exactly `['ur','en']`
- both pickers derive from the same source
- `clampLanguage`, `canonicalizeLanguageCode`, catalog key resolution
- the writer rejects an out-of-offer language; the lock reader round-trips
- prompt-builder output for each (format × language) combination
- TTS provider selection per language
- job language is frozen against a mid-render switch
- no language list or inline clamp exists outside the registry

---

## Reporting a failure

Language defects are easy to describe ambiguously. Please include:

1. **Persona** and the language stored on her at the time
2. **Surface** (which of A–G above)
3. **Expected** language vs **actual** — and for documents, the *script* problem
   from the D list by name (tofu / mojibake / unjoined / Naskh / LTR)
4. A **screenshot** for anything rendered, and the **file itself** for a PDF
5. Roughly when it happened, so the language telemetry can be correlated —
   every outbound message now records the language served and the rule that
   chose it
