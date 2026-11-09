# Make my own, grades 1–5: product review (decision memo)

**Reviewer:** product / UX (primary teachers) · **Date:** 2026-11-09 · **Bead:** bd-snkn32.4
**Inputs:** `portal/src/portal/teacher/lessons/own/` (rules.ts, copy.ts, OwnPage.tsx); design draft artifact
KbsvCwJgs6QWy1DQmGjfzi (read); a real G1 plan JSON (`bot/tests/fixtures/lp-v9/GK_g1_seg2.ur.lp.json`); sandbox `lesson_plans`.
**Evidence, and its limits:** in sandbox, 892 `lesson_plans` rows since 2026-08-01. 296 have a grade, and 289 of those are
grades 1–5 (G1 187, G3 47, G4 34, G5 21, G2 5); grades 6–12 have 2. That is test traffic, not field use, so it shows only
that the primary path is where plans are asked for. I have no field data on class size or resources for primary.
Those decisions rest on the design draft plus judgement, and I mark them that way.

## 1. The five questions: keep all five, same screens, same order

| Question | Decision | Reason |
|---|---|---|
| Pages → **Day** | Changes for G1–5 only (see §2) | Primary plans are day-by-day. A primary teacher thinks "Day 3", not "pages 12–13". |
| Children in class | **Keep** the 4 bands | Large primary classes are the norm in ICT's double-shift schools, and the bands drive pairs vs groups in the rewrite. |
| What you have | **Keep** the 5 options and the hint "Stones, sticks, bottle caps" | The hint fits primary better than it fits 6–12. Objects are the CPA trigger. |
| Your class and the book | **Keep** Behind / On track / Ahead / Mixed | The words are plain enough for G1–5. "Mixed" is the most common real answer and already routes to TaRL. |
| Teaching way | **Keep** the suggestion with reasons (see §3) | Same screen. Only the rule inputs differ by grade, and they already handle it. |

No option is added or dropped. The 200-character note stays.

## 2. Step 1 for grades 1–5: "Which day?"

- **Screen title:** "Which day?" / "کون سا دن؟". On the check screen the row label is "Day" / "دن", not "Book pages".
- **Rows:** one per lesson day, in chapter order: **"Day 3 · <the day's topic>"**, with the book page as a small second line
  ("Page 12", from `provenance.printed_pages`). Reuse `LESSONS_COPY.day(n)` and the chapter page's own row title, so a
  day reads the same here as on the ready-plans list.
- **Leave out** worksheet and revision rows, because there is no day plan to rewrite. Keep part rows as they read today
  ("Day 4 · part 1").
- **No default selection** (same as 6–12). A day whose source plan is missing does not appear. A greyed row would be a
  dead end.
- **Viewer and Recent:** the made plan's name is "Day 3 · Mine" / "دن 3 · میرا". It is the same day, and the tag says
  she made it.

## 3. Teaching ways for primary: no rule change

`suggestWay` and `waysFor` are right for G1–5 as written:
- Behind or mixed → TaRL first. This is correct for primary and matches NIETE's FLN training.
- Maths with objects → CPA. Primary is where CPA matters most.
- Urdu or English in G1–3 → phonics. G4–5 correctly lose phonics.
- ≤50 children, on track or ahead → games. Otherwise → story and talk, a safe default for small children.

One **output** rule (not a picker change): when TaRL is chosen for Urdu or English in G1–3, the rewrite groups children by
sound, letter, word and sentence level. That is how TaRL works for early literacy, and it keeps phonics inside TaRL instead
of adding a sixth way.

**Engineer check (not a design change):** subjects are matched by name. Confirm that the G1–5 catalogue keys pass the
regexes: maths must match `^math`. "GK-English", "Social Studies Urdu", Islamiat and واقفیتِ عامہ must **not** match
`^(urdu|english)\b`. Add one rules.test case per primary subject.

## 4. The rewritten primary plan

**MUST keep (fixed by the source day; her answers never change these):**
- The day itself: SLO (verbatim), topic, book page(s), "Day N of M", and the previous/next lines.
- The section spine, in the same order and with the same titles: Opening (hook/warm-up + key words) → Explanation
  (I do) → We Do · You Do (with stuck/early support) → Check (exit ticket) → Homework. Also keep the
  common-mistakes and homework-key parts the source has.
- One period: section minutes add up to the source's `period_minutes` (40).
- No placeholder text. The G1 fixture holds "یہ حصہ ابھی تیار نہیں ہوا" ("not ready yet") in some parts. A rewrite
  drops an empty part rather than printing that line.

**What each answer changes:**
- **Size.** Up to 30: small groups and individual checks. 31–50: pairs, and groups by row. 51–70 and over 70:
  whole-class choral answers, fingers or slates for the check, pairs with the next child, and no activity that needs
  each child to come to the board or hand in materials.
- **Resources.** Use only what she ticked, plus the textbook. No board: the board diagram becomes "point to the picture
  on page N". Objects: counting and sorting with named everyday things. Charts: one chart, made once. Phone or speaker:
  one short listen moment at most. Never anything she did not tick.
- **Level.** Behind: open with the prerequisite, more I-do, smaller steps, and an easier exit ticket aimed at the same
  SLO. Ahead: a stretch task in You Do and a harder last exit question. Mixed: a two-level You Do (same task, two
  entry points), with stuck/early support written for this class.
- **Way.** Shapes the We Do and You Do activities and the hook. Name the way once at the top of the plan, in her words
  ("Games and movement").
- **Note.** Honour it when it fits the SLO and the rules above (for example "half my class can't read yet", or "we have
  sports day"). Ignore any part that breaks a fixed rule. Never quote it back verbatim. A note in Urdu on an English book
  is read for its meaning, and the plan stays English.

**Language. The book decides, not the portal language:**
- Urdu-medium books (Urdu, Islamiat, واقفیتِ عامہ, Social Studies Urdu): **Urdu throughout**, in Nastaliq, with the same
  digit style as the source plan (۲ ۳). No Roman Urdu. No English, apart from words that are printed in the book.
- English-medium books (English, Math, Science, GK-English): English, keeping the Roman-Urdu "say it locally" lines,
  about one per section as in the source. The rewrite adds a local line for any new instruction it writes.
- A teacher using the Urdu interface still gets an English plan for an English book. That is the book she teaches from.

**Length:** no longer than the source day plan (aim for the same, ±10%). She reads it on a phone minutes before class.
Each section opens with its one action line. Activities are numbered steps of one sentence each, not paragraphs. The
PDF is the same width and type size as the bank's primary PDF in the viewer, and a section fits in about one phone
screen.

## 5. Copy changes for primary (English + Urdu)

| Key | Now | Change |
|---|---|---|
| New `day` (step title, G1–5) | — | "Which day?" / "کون سا دن؟". The check-screen label reuses the existing day word, "Day" / "دن". |
| `pages` | "Book pages" / "کتاب کے صفحات" | Keep for 6–12 only. |
| `ways.tarl` (ur) | درست سطح پر پڑھائیں | **ہر بچے کی سطح پر پڑھائیں**, to match the English ("each child's level"). Applies to both bands. |
| `lessonPlanFive` | "Lesson plan · 5 questions" | Keep. It is still five questions. |
| `objectsHint`, `levels`, `sizes`, `resourceNames`, the rest | — | Keep. |

The Urdu stays machine-drafted and pending human review, as copy.ts already notes. The new `day` key joins that review.

## Sign-off criteria for the 360px screenshot

1. G1–5 step 1 shows "Which day?" with rows reading "Day N · topic" and a page line. No worksheet or revision rows.
   No horizontal scroll.
2. The "Make my own" card is first on a G1–5 chapter page and visible without scrolling.
3. The check screen says "Day" (not "Book pages"). The way suggestion shows its reason. The note is optional.
4. The made plan from an Urdu book is Urdu Nastaliq throughout. An English book keeps the Roman-Urdu lines. Both show the
   five sections in order and contain no "not ready" placeholder.

## Verdict on the 360px screenshots (2026-11-09): SIGN-OFF WITH NOTES

1. Card: passes. "Make my own" is first and inside the first screen in EN and UR. With the flag off, the page is unchanged.
2. Step 1: passes. "Which day?" / "کون سا دن؟" with "Day N · topic" rows, and no worksheet or revision rows. Missing: the page line under each row that the memo asked for. Add it if the day carries a page; otherwise drop it from the spec. Not a blocker.
3. Empty grey square (pre-existing, also on 6–12): fill it with the existing `dayBadge` ("D1") so the slot means something. This can be a follow-up bead.
4. Output: the Urdu book prints Urdu Nastaliq with Urdu headings, and the English book prints English with "Teaching way" and "Mine". The Urdu header uses Western digits ("دن 2 از 9") while the body uses ۲. Make the header match the body.
5. Accepting 1.3× length instead of ±10%, since big-class rewrites add lines. Each section still opens with its action line.
6. Not yet seen: a real rewrite. Before closing, check one sandbox rewrite per medium: five sections in order, no "not ready" line, only ticked resources.
7. Accepted as pre-existing: the chapter list says "LP # N" and step 1 says "Day N" (the numbers match); the Urdu UI shows an English topic on an English book.
