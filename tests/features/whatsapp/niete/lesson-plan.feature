# NIETE (ICT) Lesson Plans — WhatsApp E2E, driven via a linked WhatsApp Web session (Chrome-MCP).
# Target: staging 923222482222 (.claude/qa/config/whatsapp-targets.yaml). Values that vary by DB state
# (grades, subjects, chapters, filenames) resolve live from answer-keys.yaml → lesson_plan; assert shape,
# not exact wording. Non-determinism contract: .claude/qa/shared/non-determinism-contract.md.
@whatsapp @ict @profile:niete @feature:lesson-plan @persona:teacher
Feature: NIETE (ICT) WhatsApp bot — Lesson Plans
  # Entry points: the "Lesson Plans" menu row, a keyword (lp | lesson plan | lesson-plan | /lp | لیسن پلان,
  #   exact match), the Meta ice-breaker, a natural-language request, or a voice note.
  # Delivery engines:
  #   (A) the "Pick Class" native Flow (Grade → Subject → Chapter → Topic → PDF), gated on
  #       PAKISTAN_LP_FLOW_ID. Grades 1–5 serve a pre-generated Pakistan PDF; grades 6–12 the Pakistan
  #       6-12 corpus (gated on LP_612_ENABLED, live per bd-mww73), with Oxbridge only as the fallback.
  #   (B) natural language / voice — since bd-2540 these NO LONGER generate a freeform plan; they return
  #       the curriculum fallback ("this isn't in our collection yet — type menu").
  # Flow driving: dropdown pickers (open dropdown → pick option → Next); final submit is "Send Lesson Plan".
  # Flow screens and acks are English-only regardless of language (see the @known-issue scenario).

  # ─────────────────────────── Positive / happy path ───────────────────────────

  @e2e @flow @P1
  Scenario: Completing the Pick Class Flow delivers the lesson-plan PDF
    Given the NIETE bot chat is open
    When I open the LP Flow and complete it for Grade 1 → English → "Ch 1: Hello World" → "Full Chapter Lesson Plan"
    Then the interim ack matches "📘 Sending your lesson plan: <grade> <subject> — <chapter>…"
    And a lesson-plan PDF is delivered to the chat within a few seconds (e.g. "Hello World — English.pdf")
    # Grades 1–5 = pre-generated Pakistan corpus. No feedback survey fires on the Flow path (by design).

  @e2e @flow @P2
  Scenario Outline: A recognised keyword opens the Lesson Plans Flow
    Given the NIETE bot chat is open
    When I send "<keyword>"
    Then the bot sends a "📘 Lesson Plans" card with a launch button
    Examples:
      | keyword     |
      | lp          |
      | lesson plan |
      | lesson-plan |
      | /lp         |
      | لیسن پلان   |
    # The Meta ice-breaker "Plan Lesson - Create PDF lesson plans instantly" opens the same Flow.

  @e2e @flow @content-driven @P2
  Scenario: A secondary grade delivers a Pakistan lesson plan, not an Oxbridge one
    Given the NIETE bot chat is open
    And I have opened the LP Flow
    When I complete it for a grade between 6 and 12
    Then the bot delivers a lesson plan from the Pakistan 6-12 corpus (PDF named "grade_<n>_<subject>_c<NN>_p<NN>_<lang>.pdf")
    And it does not fall back to an Oxbridge lesson plan
    # Grades 6-12 = the Pakistan 6-12 corpus, gated on LP_612_ENABLED (live per bd-mww73; sandbox DB seeded).
    # Oxbridge is only the fallback when the flag is off or a grade's books are not yet segmented — an
    # Oxbridge reply for a secondary grade is now the FAILURE the driver reports (oxbridge:true).

  @e2e @P1
  Scenario: Rating a 6-12 lesson plan useful asks whether I taught it
    Given the NIETE bot chat is open
    And a lesson plan from the Pakistan 6-12 corpus has just been delivered to the chat
    When the feedback survey arrives and I tap 👍
    Then the bot asks whether I got to use it in class
    And it offers exactly three replies — "Taught it today", "Planning to", "Not yet"
    And tapping one of them is acknowledged with a short thank-you that ends the survey
    # bd-b708h. Before this, 👍 ended the survey on a bare thank-you, so lp_feedback.used_in_class
    # was NULL on every 6-12 row — and it is the only signal this lane has that a PDF became a
    # lesson (a render row is a cache miss, not a delivery).

  # ─────────────────────── Business rules / valid variations ───────────────────────

  @e2e @i18n @P2
  Scenario: The use question is asked in my language, not the document's
    Given the NIETE bot chat is open on a teacher whose language is Urdu
    And an English 6-12 lesson plan has just been delivered to the chat
    When I tap 👍 on the feedback survey
    Then both the question and all three replies are in Urdu
    # The document's language and the bot's voice are separate territories: ordering an English
    # plan does not switch an Urdu-preference teacher into being spoken to in English.

  @e2e @content-driven @P1
  Scenario: An Urdu plan that uses ordinary religious vocabulary is delivered, not withheld
    Given the NIETE bot chat is open
    And I have opened the LP Flow
    When I complete it for an Urdu 6-12 segment whose text uses the common word "انبیاء"
    Then a lesson-plan PDF is delivered to the chat
    And the request does not end in silence
    # bd-kpqu6. RELIGIOUS_MARKS is a never-deliver gate: when it fires the teacher gets NOTHING,
    # not a degraded plan. `PROPHET_RE` had no word boundary — Arabic has no working \b — so the
    # bare token "نبی" matched INSIDE the ordinary plural "انبیاء" ("prophets"). Three teachers
    # asked for a lesson on 2026-09-16 between 02:33 and 02:37 and received nothing. The second
    # half of the same fix stops the gate scoring fields no teacher reads (/human_review_reason,
    # /slo/text_verbatim, video titles) — same observable outcome, so it is not a separate
    # scenario: see grade_7_urdu.c11.p062-064.tafheem, which is delivered only because the model's
    # internal routing note is not teacher-facing.

  @e2e @content-driven @P1
  Scenario: A plan naming an ordinary person called محمد is delivered, because a reviewer cleared it
    Given the NIETE bot chat is open
    And I have opened the LP Flow
    When I complete it for the Grade 10 Urdu segment whose body names the poet "سیّد ولی محمد"
    Then a lesson-plan PDF is delivered to the chat
    And the plan is not sent back for a revision round
    # bd-zipoe. `محمد` is one of the commonest given names in Pakistan, and RELIGIOUS_MARKS
    # demanded ﷺ after every one — so grade_10_urdu.p2c05.p135-135.tafheem failed five times on
    # Nazeer Akbarabadi's real name, four of them on teacher-facing paths, and auto-repair answered
    # by attaching the Prophet's salutation to a man who is not the Prophet. What clears it is NOT
    # a rule: gate G5c forbids an automated check clearing religious content. It is the G5c
    # native-speaker review itself — 298 phrases decided by Amena Ahmed on 2026-09-17 — carried
    # into the repo as data (bot/vendor/lp-v9/g5c_cleared_names.json). A name the review did not
    # decide is still withheld, which is the scenario below.

  @e2e @content-driven @P1
  Scenario: An English-medium plan naming the Quaid is delivered, because the same review cleared the Latin spelling
    Given the NIETE bot chat is open
    And the G5c review has decided "Muhammad Ali Jinnah" is an ordinary person, and the bare name "Muhammad" is the Prophet
    And I have opened the LP Flow
    When I complete it for an English 6-12 segment that carries religious content and whose body names
      "Quaid-e-Azam Muhammad Ali Jinnah" with no honorific after it
    Then a lesson-plan PDF is delivered to the chat
    And the plan is not sent back for a revision round
    # bd-5t71f. The scenario above gave the URDU lane its list; the Latin lane had none, so the same
    # man passed as محمد علی جناح and was refused as Muhammad Ali Jinnah — an English-medium Pakistan
    # Studies lesson naming the founder returned nothing at all. Measured on the Grades 6-12 corpus:
    # 436 unhonorified Latin occurrences on 192 pages across 33 books, grade_7_history alone 93.
    # What clears it is not a rule — gate G5c forbids an automated check clearing religious content —
    # but the same native-speaker review, 134 Latin phrases decided by Amena Ahmed on 2026-09-23
    # (119 ordinary people, 15 the Prophet), carried as data in bot/vendor/lp-v9/g5c_cleared_names_en.json.
    # THIS SCENARIO IS THE LONGEST-PHRASE RULE. Matching is on the word sequence, case-folded with
    # edge punctuation and an English possessive trimmed, and the longest decided phrase present
    # rules; on equal length the blocking mark wins. So the three-word "Muhammad Ali Jinnah" clears
    # even though the one-word "Muhammad" sitting inside it is marked as the Prophet — which is the
    # only reason the reviewer could mark that bare token PROPHET to fail safe without re-refusing
    # every ordinary person on her list. The segment must carry religious content or the gate is
    # never reached: RELIGIOUS_MARKS runs only inside a religious-scope document, so an English
    # maths lesson naming nobody religious would pass this proving nothing.

  @e2e @content-driven @P1
  Scenario: A chained Latin name the book saluted at the end of the chain is delivered
    Given the NIETE bot chat is open
    And the G5c review has decided the bare name "Muhammad" is the Prophet
    And I have opened the LP Flow
    When I complete it for an English 6-12 segment that carries religious content and whose body names
      "Hazrat Muhammad Rasulullah" with the Arabic salutation after the LAST word of that chain
    Then a lesson-plan PDF is delivered to the chat
    And the plan is not sent back for a revision round
    # bd-6ld74. A chained name carries ONE salutation and it sits at the END of the chain, but the
    # honorific test looked only immediately after the matched name token — so the gate demanded a
    # second stamp mid-chain and refused a line the book had already saluted correctly. This is the
    # single commonest shape left after bd-5t71f: of the 18 unresolved occurrences measured on the
    # Grades 6-12 corpus, 15 are this one, 14 of them one unit title repeated across three pages in
    # grade_8_english and 1 in grade_9_english. The Urdu lane was given this on the same G5c ruling;
    # the Latin lane never was, so the same sentence passed in Urdu and was refused in English.
    # THIS SCENARIO IS THE "WALK TO THE END OF THE CHAIN" RULE, and nothing more. It moves only
    # WHERE the stamp is looked for, never WHETHER one is required: the words the gate is allowed to
    # walk past are a closed list of romanised chain tokens, it walks at most four of them, and the
    # salutation itself ends the walk. A chain that runs out with no salutation is still withheld —
    # the outline below pins that, and it is the row that fails if this ever becomes a bypass.

  @e2e @content-driven @P1
  Scenario: A Latin honorific the book printed reaches the teacher as the Arabic stamp
    Given the NIETE bot chat is open
    And the G5c review has decided "Hazrat Muhammad PBUH" is the Prophet, correctly saluted
    And I have opened the LP Flow
    When I complete it for an English 6-12 segment that carries religious content and whose body names
      "Hazrat Muhammad" with the Latin honorific "(PBUH)" directly after it
    Then a lesson-plan PDF is delivered to the chat
    And the delivered plan carries the Arabic stamp after that name, not the Latin abbreviation
    # bd-b7txa, the gap the outline below used to declare open. Two occurrences in the whole Grades
    # 6-12 corpus — one "... SAW" in grade_9_mathematics and one "... PBUH" in
    # grade_10_pak_studies_english — where the BOOK saluted the Prophet in Latin and the gate, which
    # reads only the Arabic stamp, called the line unsaluted and withheld the lesson.
    # THE GATE DID NOT MOVE, and that is the whole design. Asked whether a Latin PBUH/SAW should
    # satisfy the gate, the G5c reviewer said it should; but the only way to do that INSIDE the gate
    # is to stop refusing PBUH/SAW on sight, which reverses her own "what the teacher reads must be
    # our stamp". So the fix sits ABOVE the gate: a normalisation pass rewrites the printed
    # abbreviation to the Arabic stamp before the gate runs, and the gate then passes the line on
    # its existing, unchanged rule. Both halves of her ruling survive — the salutation is no longer
    # called absent, and what the teacher receives is the stamp.
    # The second Then is the load-bearing half. If the plan were delivered still reading "(PBUH)",
    # this scenario would be green and the ruling broken.

  @e2e @content-driven @P1
  Scenario: An "Urdu" plan that is really English is refused, and the English lesson is delivered instead
    Given the NIETE bot chat is open on a teacher whose language is Urdu
    And I have opened the LP Flow
    When I complete it for a 6-12 segment from an English-medium book, and the overlay pass answers in
      English with its Urdu only inside the brackets — "Chapter 10 (کیمیائی توازن)"
    Then a lesson-plan PDF is still delivered to the chat — the refusal is not silence
    And what she receives is the English lesson, flagged by the honest caption
    And she is never handed a plan that presents itself as Urdu and reads as English
    # bd-htw51 / bd-y478d / bd-9a2sf. Two fixes to this gate each answered half the question and each
    # re-opened the other half, because ONE number cannot answer both. Measured on real deltas: a
    # genuine Urdu line carrying a bare English term of record — «باب 10 · Chemical Equilibrium» —
    # scores 0.371 Urdu, while an English line with an Urdu gloss — «Chapter 10 (کیمیائی توازن)» —
    # scores 0.439. The impostor scores HIGHER, so no threshold could separate them. What separates
    # them is WHERE the Urdu sits, so the gate now asks two questions: a FLOOR on the merged overlay
    # with all-Latin brackets discounted, and a CATEGORICAL check on THIS call's delta with every
    # bracket stripped — if no Urdu survives outside the brackets, the model answered in English.
    # Refusing is the kind outcome: the worker falls back to the English document it kept intact,
    # the row records overlay_dropped, and lp612.overlay.pass carries outcome=failed. The silent
    # alternative was an English page delivered under an Urdu claim, which is what 8 of the 23
    # attempted 6-12 repair rows were on 2026-09-18.

  @e2e @content-driven @P1
  Scenario: A سیرت lesson already held for review is delivered in Urdu when the overlay keeps the ﷺ
    Given the NIETE bot chat is open on a teacher whose language is Urdu
    And I have opened the LP Flow
    And the segment's English document already carries the G5c native-speaker review hold
    When I complete it for that Grade 9 Islamiyat segment from an English-medium book, and the overlay
      pass returns the topic title as "سیرت کا سبق: نبی کریم ﷺ کی زندگی"
    Then a lesson-plan PDF is delivered to the chat
    And what she receives is the Urdu page, not the English fallback
    # The overlay pass now lints the MERGED page before it is allowed out, and this is the scenario
    # that proves the hold DISCRIMINATES: same سیرت lesson, same Islamiyat chapter, same title — and
    # it is delivered, because the honorific is there and the document was already a review item.
    # The gate refuses the defect, not the subject. It is worth its own line because the failure it
    # guards is invisible: a future widening of RELIGIOUS_MARKS could kill every Urdu Islamiyat
    # overlay and nothing would say so — the fallback to English is silent by design, which is the
    # kind outcome the scenario above describes. The review hold in the Given is load-bearing: an
    # overlay that INTRODUCES religious content onto a document nobody flagged is refused even with
    # the honorific, because then the Urdu page would be the first anyone saw of it.

  @e2e @content-driven @language @P1
  Scenario: An Urdu 6-12 plan keeps the board in English and explains each board block in one Urdu line
    Given the NIETE bot chat is open on a teacher whose language is Urdu
    And I have opened the LP Flow
    When I complete it for a Grade 8 segment from an English-medium book
    Then a lesson-plan PDF is delivered to the chat
    And every board block on it is still in English, the words the class copies into their notebooks
    And under each board block sits one Urdu line, right to left, saying what that block is for
    # bd-oak77.42. A Grade 8 teacher asked for the lesson explained in Urdu, and the Urdu plan still
    # handed her whole English board blocks with no word of Urdu near them. The board stays English
    # because the book and the exam are English; the one Urdu line is for the teacher. Books whose
    # medium is Urdu already write the board in Urdu, so they get no extra line. A reused plan
    # missing the line is still delivered, and the top-up pass adds the line later.

  @e2e @content-driven @P2
  Scenario: Diagram labels on a 6-12 plan stay readable on a phone
    Given the NIETE bot chat is open on a teacher whose language is English
    And I have opened the LP Flow
    When I complete it for a Grade 9 Chemistry segment whose plan carries a labelled diagram
    Then a lesson-plan PDF is delivered to the chat
    And no diagram label on it is smaller than the diagram floor, about 8.7px on the phone page
    And a molecule figure's formula slot holds a formula, never a sentence
    And a long warm-up label sits on its own line instead of squeezing the warm-up text
    # bd-oak77.15 / .24 / .31. The floor is 14px on the A4 page the diagram engine draws, which the
    # phone page scales to about 8.74px. A figure that cannot fit its labels at that size is widened
    # or refused, never shrunk. Prose in the formula slot is moved to the name line and the linter
    # flags it as a blocking FIGURE defect.

  @e2e @content-driven @P2
  Scenario: A worked scenario never guesses the gender of an unnamed character
    Given the NIETE bot chat is open on a teacher whose language is English
    And I have opened the LP Flow
    When I complete it for a 6-12 segment whose worked example has a helper nobody names, such as "the shopkeeper"
    Then a lesson-plan PDF is delivered to the chat
    And that helper is given a name, or called they/them every time
    And each learning objective the plan invents a code for gets its own code, O1, O2, O3, never a repeat
    # bd-oak77.32. A Grade 8 plan called an unnamed lab assistant "she", then "he". The author brief's
    # gender-neutral rule now covers unnamed characters. Separately, subjects with no curriculum SLO
    # code invent O1-style codes, and a repeated one made homework tagged to the third objective read
    # as untaught; the author sanitizer now renumbers a repeat and leaves the first occurrence alone.

  @e2e @content-driven @P2
  Scenario: The last lesson of a chapter names no next lesson
    Given the NIETE bot chat is open on a teacher whose language is English
    And I have opened the LP Flow
    When I complete it for the last 6-12 segment of a chapter
    Then a lesson-plan PDF is delivered to the chat
    And the lesson strip on page 1 shows no "next" lesson
    # bd-oak77.38, the mirror of bd-oak77.33 (a first lesson printed an invented "previous").
    # The corpus marks a last lesson with an empty next_segment_id; the prompt tells the model
    # sequence.next must be null and the author sanitizer drops whatever it wrote anyway.

  @e2e @negative @content-driven @P1
  Scenario: An Urdu overlay that drops the honorific is refused, and the English lesson is delivered instead
    Given the NIETE bot chat is open on a teacher whose language is Urdu
    And I have opened the LP Flow
    When I complete it for a Grade 9 Islamiyat segment from an English-medium book, and the overlay
      pass returns the topic title as "سیرت کا سبق: نبی کریم کی زندگی" — the Prophet named, the ﷺ dropped
    Then a lesson-plan PDF is still delivered to the chat — the refusal is not silence
    And what she receives is the English lesson, flagged by the honest caption
    And she is never handed an Urdu page whose religious content no native speaker has cleared
    # Gate G5c, on the lane that never asked it. The authoring climb refuses a document still
    # carrying a RELIGIOUS_MARKS defect; the overlay pass had only two gates — is it Urdu, and does
    # it cover enough pointers — and the coverage gate's own checker emits exactly one code,
    # OVERLAY_MISSING. There was no religious code on this lane to trip. The strings the overlay
    # translates include the chapter and topic TITLES, which on Islamiyat, Urdu and Pak Studies are
    # exactly where a prophet or a companion gets named, so the model could put the Prophet on the
    # page without the honorific and nothing between its reply and delivery would look.
    # NOT a restatement of either scenario near it. "…is really English…" is the LANGUAGE gate — a
    # different trigger. "…is still withheld" is the AUTHORING climb — a different OUTCOME: there
    # she gets no PDF at all, here she gets the English one, because the worker keeps the English
    # document intact as its fallback and this refusal lands in that same catch.
    # An overlay that INTRODUCES religious content onto an unflagged document is held by the same
    # rule and looks identical to her, so it is not a separate scenario.

  @e2e @content-driven @P2
  Scenario: A natural-language request returns the curriculum fallback, not a generated plan
    Given the NIETE bot chat is open
    When I send a free-text request like "make me a lesson plan for grade 4 science on the water cycle"
    Then the bot does not generate a freeform lesson plan
    And it replies with the curriculum fallback inviting me to type "menu"
    # bd-2540 removed the teacher-triggerable freeform (Gamma) generation.

  @e2e @voice @P2
  Scenario: A voice lesson-plan request is transcribed and answered like the text path
    Given the NIETE bot chat is open
    When I send a voice note asking for a lesson plan
    Then the bot transcribes it and replies (by voice and/or text) without erroring
    And the outcome matches the text path — the curriculum fallback for an out-of-catalog request
    And the spoken reply does not promise a lesson plan it will not deliver

  # ─────────────────────────────── Negative ───────────────────────────────

  @e2e @negative @P2
  Scenario: A thumbs-down asks why, and never asks whether I taught it
    Given the NIETE bot chat is open
    And a lesson plan from the Pakistan 6-12 corpus has just been delivered to the chat
    When the feedback survey arrives and I tap 👎
    Then the bot asks me to say what was wrong, in my own words
    And it does not ask whether I got to use it in class
    # Asking a teacher who has just said the plan was no use whether she taught it reads as not
    # listening — the reason window is the only follow-up on this branch.

  @e2e @negative @content-driven @P1
  Scenario: A plan that names the Prophet without an honorific in teacher-facing text is still withheld
    Given the NIETE bot chat is open
    And I have opened the LP Flow
    When I complete it for a segment whose teacher-facing body names the Prophet with no honorific
    Then no lesson-plan PDF is delivered
    # The boundary fix narrows WHERE the gate looks, never WHETHER it holds. Gate G5c stands:
    # automated checks do not clear religious content, and native-speaker review remains a hard
    # hold before any teacher delivery. A plan that reaches this state is a review item, not a
    # delivery — bd-qzitp is the regression this pins.
    # bd-zipoe does not move this line: the cleared-name list only ever CLEARS, and only the exact
    # phrases the reviewer saw. An unreviewed name — even one shaped exactly like a cleared one —
    # is not cleared. Fail-closed, always.

  @e2e @negative @content-driven @P1
  Scenario Outline: A Latin name the G5c review did not clear still withholds the lesson
    Given the NIETE bot chat is open
    And I have opened the LP Flow
    When I complete it for an English 6-12 segment that carries religious content and whose body names
      "<name>" with no honorific after it
    Then no lesson-plan PDF is delivered
    Examples:
      | name                    | why the review does not clear it                                  |
      | Muhammad                | she ruled the bare token MIXED and marked it the Prophet to fail safe |
      | Muhammad Zubair Farooqi | she never saw this name, and an unreviewed name is not a cleared name |
    # bd-5t71f, the other direction of the scenario above, and the one that matters more. Only a
    # phrase the reviewer marked as an ordinary PERSON clears; a phrase she marked as the Prophet
    # never clears, and a name absent from her list is refused exactly as it was before this change.
    # Fail-closed, always. Row 2 is the protection that a shape is not a clearance: "Muhammad Zubair
    # Farooqi" is built like "Muhammad Ali Jinnah" and is still withheld, because the alternative —
    # deciding by grammar which Muhammad is which — is the automated clearance G5c forbids. If this
    # row ever delivers, the gate has started deciding on the reviewer's behalf.
    # The gap this outline used to declare open is now CLOSED: she marked "Hazrat Muhammad PBUH" /
    # "… SAW" as the Prophet, correctly, and a line the BOOK saluted in Latin no longer stays
    # withheld — it is rewritten to the Arabic stamp before the gate reads it and DELIVERS, which is
    # bd-b7txa and the scenario "A Latin honorific the book printed reaches the teacher as the
    # Arabic stamp" above. The honorific test itself is unchanged and still reads only ﷺ and the
    # Arabic form. Neither row here is touched by that: neither carries a salutation of any kind, in
    # any script, so neither is rewritten and both stay withheld.

  @e2e @negative @content-driven @P1
  Scenario Outline: A Latin salutation the gate cannot reach still withholds the lesson
    Given the NIETE bot chat is open
    And I have opened the LP Flow
    When I complete it for an English 6-12 segment that carries religious content and whose body reads
      "<body>"
    Then no lesson-plan PDF is delivered
    Examples:
      | body                                          | why it is still withheld                                                |
      | Hazrat Muhammad Rasulullah, the final Prophet | the chain runs out with no salutation at its end, so walking to the end finds nothing to read |
      | Hazrat Muhammad Rasulullah (PBUH)             | the Latin honorific is not against the name, so the rewrite never reaches it, and a Latin salutation is not the stamp |
      | Muhammad saw the crescent moon that evening   | a lower-case "saw" is ordinary English, never a salutation, so nothing is rewritten and the name stands unsaluted |
    # The fail-closed half of the two scenarios above, one row per control. Row 1 bounds the walk:
    # it may only find a salutation, never invent one. Row 2 bounds the rewrite: it fires only on an
    # honorific printed directly against the name, so a chain is not laundered by an abbreviation
    # sitting at the far end of it. Row 3 is the one a blind rewrite would get catastrophically
    # wrong — "saw" is also the past tense of "see", so a rewrite that matched it case-insensitively
    # would stamp scripture into an ordinary sentence about the sky. Bare "SAW" is excluded for the
    # same reason; only the enclosed forms and "SAWW" are read as honorifics.
    # If any row here ever delivers, the change has stopped being about WHERE the stamp is looked
    # for and has started clearing religious content on the reviewer's behalf, which G5c forbids.

  @e2e @negative @content-driven @coverage @P1
  Scenario: A cache repair that cannot clear its religious content leaves my lesson exactly as it was
    Given a 6-12 Urdu lesson I have already been served, stored and serving from the cache
    And the overlay repair job tops that stored lesson up with the pointers the current gate offers
    When the handful of strings it asks for come back clean, but the page they merge into still
      names the Prophet without the honorific
    Then nothing is written — the stored document and its PDF are left exactly as they are
    And the renders row is not patched, so every later cache hit serves me the lesson I already had
    And I am never quietly given a page whose religious content no native speaker has cleared
    # The REPAIR lane, not the request lane. The backfill walks the renders table, pulls each stored
    # document, tops its overlay up and writes back over the row's OWN R2 keys — so an uncleared
    # translation here replaces the lesson permanently, for every future hit, with no teacher action
    # to trigger it and nobody watching. Before this the whole chain mentioned religious content
    # nowhere.
    # What makes it its own scenario and not a restatement of the refusal above is WHERE the gate
    # measures: on the MERGED document, never on the delta this call asked for. Judged on the delta
    # alone the strings above are spotless and the repair ships with the defect still on the page.
    # And the assertion here is the ABSENCE OF A WRITE, not the presence of an error — a hold that
    # fires after the upload has already happened protects nobody.
    # @coverage, not a live WhatsApp drive: the trigger is the operator-run backfill script, so no
    # driver on this lane can reach it. Executed instead by the jest e2e over the real chain
    # (tests/lp612/overlay-topup-religious-gate.e2e.test.js), which doubles only supabase, R2, the
    # model and the renderer, and asserts the upload and row-update CALL COUNTS.

  @e2e @flow @negative @P2
  Scenario: A grade with no lesson plans shows a friendly message
    Given the NIETE bot chat is open
    And I have opened the LP Flow
    When I pick a grade that has no lesson plans yet
    Then the bot replies that no lesson plans are available for that grade yet

  @e2e @flow @negative @P3
  Scenario: A subject with no chapters for that grade is refused politely
    Given the NIETE bot chat is open
    And I have opened the LP Flow and picked a grade
    When I pick a subject that has no lesson plans for that grade
    Then the bot replies that no lesson plans exist for that subject and grade yet

  @e2e @edge @negative @P3
  Scenario: "/lesson plan" is not a recognised keyword and falls through to natural language
    Given the NIETE bot chat is open
    When I send "/lesson plan"
    Then the bot does not open the Lesson Plans card
    And it handles the message as a natural-language request
    # Only "/lp" carries the slash; "/lesson plan" (slash + space) misses the keyword match.

  @e2e @negative @known-fail @P2
  Scenario: A photo gets no reply when pic-to-LP is disabled
    Given the NIETE bot chat is open
    And pic-to-LP is not enabled on this deployment
    When I send a photo of a textbook page
    Then the bot should still reply with something (at minimum its "text or voice only" fallback)
    But it currently sends no response at all — a silent dead-end (F-LP-PIC)

  # ─────────────────────────────── Known issue ───────────────────────────────

  @e2e @flow @i18n @known-issue @P3
  Scenario: The Pick Class Flow renders in English for an Urdu-preference teacher
    Given the NIETE bot chat is open on a teacher whose language is Urdu
    When I open the LP Flow
    Then the Flow screens and the "Sending…" ack are shown in English
    # English is the deliberate floor for this asset-poor surface (F-LP-i18n).

  @e2e @lesson-plan @coaching @wip @draft @P2
  Scenario: The first lesson plan of the day is followed by one coaching ask, and only the first
    Given the NIETE bot chat is open on a teacher who has taken no lesson plan today
    When I take a K-5 lesson plan before 14:00 PKT
    Then the PDF arrives exactly as it does today
    And a short while later the bot asks whether I would like that lesson recorded and coached
    And the ask offers "Record my lesson" and "Not today"
    When I take a second lesson plan the same day
    Then no second ask arrives
    # R8 §4.1. The ask is booked from lp-v8-delivery.service.js after the 'sent' download row, for
    # asset_kind='lesson' only (an answer key books nothing), and "first of the day" is not a counter:
    # it is teacher_nudges UNIQUE (user_id, nudge_date, kind), so the second booking collides and
    # inserts nothing. Nothing here costs the teacher her PDF — the hook is wrapped and non-fatal.
    # Gated on LP_COACHING_ASK_ENABLED; with the flag unset no row is written at all.
    # @wip — authored with the change, driven and promoted by the sandbox E2E run.
  # ──────────────── The 15:00 quiz offer on the lessons a teacher planned ───────────────
  # A quiz written from the slide script of the exact lesson version the teacher received —
  # no recording anywhere in it. Gated by LP_QUIZ_OFFER_ENABLED + TEACHER_NUDGES_ENABLED on
  # the worker that owns the `main` queue. On sandbox the send time can be moved
  # (LP_QUIZ_OFFER_SEND_HOUR_PKT / _MINUTE_PKT) so a run does not wait for 15:00.
  # The driver number must have users.role='teacher' and must have written to the bot
  # within 24 hours (the free-form window), or the offer is skipped as window_closed.

  @e2e @quiz @wip @draft @config-gated @P1
  Scenario: At the send hour a teacher who planned one lesson is offered a quiz
    Given the NIETE bot chat is open on a teacher who took one K-5 lesson plan today before 14:00 PKT
    And the teacher has not recorded a lesson or made a quiz today
    When the send hour passes and the teacher-nudge sweep runs
    Then the bot says the teacher planned that lesson's topic today and offers a short quiz on it
    And the message has the buttons "Make the quiz" and "No thanks"
    And the message says "planned", never "taught" or "recorded"

  @e2e @quiz @wip @draft @config-gated @P2
  Scenario: A teacher who planned lessons for two classes gets a list to pick from
    Given the NIETE bot chat is open on a teacher who took lesson plans for Grade 4 Maths and Grade 5 Urdu today
    When the send hour passes and the teacher-nudge sweep runs
    Then the bot sends a list with a "Choose a class" button
    And the list has one row per class titled like "Grade 4 · Mathematics", each showing that class's lesson topics
    And the last row is "Not today"

  @e2e @quiz @wip @draft @config-gated @P2
  Scenario: A teacher's first afternoon offer carries the intro film in their language
    Given LP_QUIZ_OFFER_INTRO_VIDEO_UR and LP_QUIZ_OFFER_INTRO_VIDEO_EN name films in the bucket
    And the NIETE bot chat is open on an English-speaking teacher who took one K-5 lesson plan today before 14:00 PKT
    And the teacher has never been shown the afternoon offer's film
    When the send hour passes and the teacher-nudge sweep runs
    Then the offer arrives with the English film as its video, above the same text and the buttons "Make the quiz" and "No thanks"
    And on the teacher's next afternoon offer there is no film
    # LP_QUIZ_OFFER_INTRO_VIDEO_SHOWS (default 1) showings per teacher, counted in user_feature_first_use under
    # 'lp_quiz_offer' — the coaching offer's film count is separate. A film that fails to send leaves plain buttons.

  @e2e @quiz @wip @draft @config-gated @P2
  Scenario: A list offer sends the intro film first, then the list
    Given the offer films are configured
    And the NIETE bot chat is open on a teacher who planned lessons for two classes today and has never been shown the film
    When the send hour passes and the teacher-nudge sweep runs
    Then the film arrives first as its own video, with a one-line caption
    And the list of classes arrives after it
    # A list message cannot carry a video header.

  @e2e @quiz @language @wip @draft @config-gated @P2
  Scenario: The Urdu afternoon offer writes its numbers in Western digits
    Given the NIETE bot chat is open on an Urdu-speaking teacher who planned lessons for two classes today
    When the send hour passes and the teacher-nudge sweep runs
    Then the offer says "8 سوالوں" and the rows read like "جماعت 4 · ریاضی", with no Urdu digits
    # Same as the coaching offer and the quiz PDF. LP_QUIZ_OFFER_NATIVE_DIGITS=on brings back ۸ / ۴.

  @e2e @quiz @wip @draft @config-gated @negative @P2
  Scenario: A teacher coached today is not offered the afternoon quiz
    Given the NIETE bot chat is open on a teacher who took a lesson plan today
    And the teacher sent a classroom recording for coaching today
    When the send hour passes and the teacher-nudge sweep runs
    Then no afternoon quiz offer arrives
    And the teacher's lp_quiz_offer row for today is skipped with reason coached_today

  @e2e @quiz @wip @draft @config-gated @edge @P2
  Scenario: A lesson planned after 14:00 is offered on the next school day
    Given the NIETE bot chat is open on a teacher who took a lesson plan today at 16:00 PKT and none before 14:00
    When the send hour passes today
    Then no afternoon quiz offer arrives today
    And at the send hour on the next school day the offer names that lesson
    # Friday after 14:00 lands on Monday.

  @e2e @quiz @wip @draft @config-gated @negative @P3
  Scenario: An assessment day is not offered a quiz
    Given the NIETE bot chat is open on a teacher whose only lesson plan today is an assessment segment
    When the send hour passes and the teacher-nudge sweep runs
    Then no afternoon quiz offer arrives
    And the teacher's lp_quiz_offer row for today is skipped with reason no_lesson

  @e2e @quiz @wip @draft @config-gated @slow @P1
  Scenario: Make the quiz produces an lp_v8 quiz with a share link
    Given the NIETE bot chat is open and the afternoon quiz offer has arrived
    When I tap "Make the quiz"
    And I tap "English" if the bot asks which language the quiz should be in
    Then the bot says the quiz is being made
    And a quiz arrives with a link to forward to the class
    And the quizzes row has quiz_source lp_v8, no coaching session, and meta.lessons carrying the served lesson's version
    And tapping "Make the quiz" again says the quiz is already on its way and makes no second quiz

  @e2e @quiz @wip @draft @config-gated @P1
  Scenario: The afternoon offer never makes a second quiz for a lesson already made into a quiz from /quiz
    Given the NIETE bot chat is open and I took one Grade 4 Urdu lesson plan today before 14:00 PKT
    And I already made its quiz from "/quiz"
    When the send hour passes and the teacher-nudge sweep runs
    Then no afternoon quiz offer names that lesson
    And if an offer for it had already arrived, tapping "Make the quiz" says I already have a quiz for this lesson and makes nothing new
    # lp-quiz-offer: the cohort drops lessons an lp_v8 quiz covers; accept() goes through lp-lesson-claim. @wip.

  @e2e @quiz @language @wip @draft @config-gated @P1
  Scenario: Make the quiz on a maths lesson asks which language the quiz is written in
    Given the NIETE bot chat is open and the afternoon quiz offer on a Grade 4 Maths lesson has arrived
    When I tap "Make the quiz"
    Then the bot asks which language the quiz should be in, with the buttons "اردو" and "English"
    And no "being made" message arrives and no quiz is generated before I answer
    And the quizzes row is offered and awaiting the language, with quiz_source lp_v8
    When I tap "English"
    Then the bot says the quiz is being made
    And a quiz arrives written in English, with a link to forward to the class
    And tapping "English" again says the quiz is already on its way and makes no second quiz
    # The same ask, buttons (tq_lang_<code>_<quizId>) and handler as the quiz born from a recording.
    # Every subject but Urdu and Islamiyat is asked; the subject rule's language is the first button.

  @e2e @quiz @language @copy @wip @draft @config-gated @P2
  Scenario: The quiz language question gives examples of English terms that fit the lesson's subject
    Given the NIETE bot chat is open and the afternoon quiz offer on a Grade 5 Science lesson has arrived
    When I tap "Make the quiz"
    Then the bot asks which language the quiz should be in
    And its Urdu line gives science terms as the examples of what stays in English letters, "(photosynthesis, cell)"
    And it never gives "fraction" or "numerator" as the examples
    # transcript-quiz-language languageAskBody: the digest's own English key terms (up to two, short) when the
    # lesson has them — a quiz born from a recording; a subject pair when it has none — a lesson-plan quiz is
    # asked before it is digested (maths: fraction, numerator · science: photosynthesis, cell · English: noun,
    # verb); no examples at all for a subject with no pair. Proven for the offer, /quiz and this offer in
    # tests/quiz/language-ask-examples.test.js and lp-quiz-language-ask.test.js. @wip until driven live.

  @e2e @quiz @language @wip @draft @config-gated @P2
  Scenario: Urdu and Islamiyat lessons are not asked the quiz language
    Given the NIETE bot chat is open and the afternoon quiz offer on a Grade 4 Urdu lesson has arrived
    When I tap "Make the quiz"
    Then the bot says the quiz is being made, with no language question first
    And a quiz arrives written in Urdu
    # Islamiyat follows the same rule, but no K-5 v8 lesson is Islamiyat, so only Urdu can be driven.

  @e2e @quiz @wip @draft @config-gated @P1
  Scenario: The quiz offer names the lesson the way its PDF caption does
    Given the NIETE bot chat is open on a teacher who took the Grade 4 Maths chapter 5 lesson "Comparing & ordering unlike fractions" today before 14:00 PKT
    When the send hour passes and the teacher-nudge sweep runs
    Then the offer names the lesson "Comparing & ordering unlike fractions", exactly as the lesson PDF's caption does
    And the offer does not carry the catalog row's run-on sub-headings such as "Discovery / Skill Sharpener" or a trailing "…"
    # lp-quiz-offer catalogTopic(): the catalog's clean `topic` first, `topic_short` only as a fallback.
    # In a list, each row's description is the clean name clipped to 72 code points.
    # @wip — authored with the change, driven and promoted by the sandbox E2E run.

  @e2e @quiz @wip @draft @config-gated @slow @P1
  Scenario: An Urdu LP-born quiz is called by the lesson's own name, never a clipped sentence
    Given the NIETE bot chat is open on a teacher who took the Grade 3 Urdu lesson "واحد اور جمع" today before 14:00 PKT
    And the afternoon quiz offer has arrived
    When I tap "Make the quiz"
    Then the quiz arrives and the message to forward to the class says the quiz is on "واحد اور جمع"
    And no message names the quiz with a clipped objective such as "طالب علم واحد اور جمع کے فرق کو"
    And the quizzes row's topic is "واحد اور جمع"
    # lp-quiz-digest: topic_as_taught is set from the catalog lesson (meta.lessons[0]) after the model;
    # the model's English topic is kept for an English-language quiz.

  @e2e @quiz @wip @draft @config-gated @slow @P1
  Scenario: The PDF of an LP-born quiz says planned, never taught
    Given the NIETE bot chat is open on a teacher whose language is English
    And the afternoon quiz offer on a Grade 3 Urdu lesson has arrived
    When I tap "Make the quiz"
    Then the quiz PDF arrives with a caption that says "what you planned"
    And the caption never says "what you taught"
    And the lesson summary at the top of the PDF describes what today's lesson plans to teach, never "you taught"
    # An Urdu lesson is never asked the quiz language, so no question comes between the tap and the PDF.
    # In Urdu the caption says «آپ کے سبق کا منصوبہ». A quiz written from a coaching recording keeps
    # "what you taught" — that lesson was taught.

  @e2e @quiz @wip @draft @config-gated @P3
  Scenario: The afternoon offer's WhatsApp message id is kept on its nudge row
    Given the NIETE bot chat is open on a teacher who took one K-5 lesson plan today before 14:00 PKT
    When the send hour passes and the teacher-nudge sweep runs
    Then the afternoon quiz offer arrives
    And the teacher's lp_quiz_offer row for today is sent with the offer's WhatsApp message id in context.message_ids, not an empty list
    # lp-quiz-offer send(): the button and list senders report Meta's id through onMessageId; the sweeper
    # writes it with markSent. The boolean the send returns is still the delivery verdict. @wip.

  @e2e @quiz @wip @draft @config-gated @P2
  Scenario: No thanks is remembered
    Given the NIETE bot chat is open and the afternoon quiz offer has arrived
    When I tap "No thanks"
    Then the bot replies that there is no quiz for today and that /quiz shows the teacher's quizzes
    And the teacher's lp_quiz_offer row records the choice no and no quiz is made

  @e2e @quiz @wip @draft @config-gated @slow @P1
  Scenario: A quiz never keys the lesson's own misconception as correct
    Given the NIETE bot chat is open on a teacher who took the Grade 3 Urdu lesson "واحد اور جمع" today before 14:00 PKT
    And the afternoon quiz offer has arrived
    When I tap "Make the quiz"
    Then the quiz arrives and no question about making the plural of "بہار" is keyed to "اس کی شکل نہیں بدلے گی"
    And every answer the quiz marks correct agrees with what the lesson plan teaches
    And the quizzes row's meta records the key check with how many answers were checked, contradicted, fixed and dropped
    # The lesson says بہار → بہاریں in its vocabulary, its homework answer and the We-Do check that plants
    # the mistake («احمد کہتا ہے کہ 'بہار' کی جمع 'بہار' ہی رہے گی…»). A contradicting item is re-authored once
    # and re-checked, then dropped if it still contradicts; a quiz left under six questions fails as
    # key_conflict and the teacher is told the quiz was held back — it is never sent with a wrong key.
    # The check fails open: if the checker itself errors, the quiz ships and meta.key_check.status is "error".

  # ═══════════ ADDED 2026-09-24 · the afternoon offer keeps the day's other questions and the night (@wip) ═══════════

  @e2e @quiz @wip @draft @config-gated @negative @P1
  Scenario: The afternoon quiz offer is never sent at night
    Given a teacher took a K-5 lesson plan today before 14:00 PKT
    And the teacher-nudge sweep did not run between 15:00 and 21:00 PKT
    When the sweep runs at 21:30 PKT and builds today's cohort
    Then no quiz offer is sent to the teacher tonight
    And the teacher's lp_quiz_offer row for today is skipped with the reason quiet_hours
    # prepare() builds the cohort on any tick from the send hour to midnight and books every row for the
    # send hour, so a late build is due at once. The likely way here is the switch going on in the evening.
    # The window is the shared one (NUDGE_QUIET_HOURS_PKT, default 21:00–07:00).

  @e2e @quiz @wip @draft @config-gated @P2
  Scenario: The afternoon quiz offer waits while a lesson-plan survey question is open
    Given a teacher took a K-5 lesson plan today before 14:00 PKT
    And at 14:58 PKT the teacher tapped "Not really" on another lesson plan's survey and was asked what did not work
    When the sweep reaches the send hour
    Then the quiz offer is not sent while that question is open
    And the quiz offer arrives once the question's ten minutes are over
    # Same rule as the coaching ask: one open question at a time (teacher-nudges.sweeper → nudges/open-question).

  @e2e @quiz @wip @draft @config-gated @P3
  Scenario: With NUDGE_OPEN_QUESTION_DEFER off the afternoon offer no longer waits for a survey question
    Given NUDGE_OPEN_QUESTION_DEFER is "off" on the worker that runs the teacher-nudge sweep
    And a teacher took a K-5 lesson plan today before 14:00 PKT
    And at 14:58 PKT the teacher tapped "Not really" on another lesson plan's survey and was asked what did not work
    When the sweep reaches the send hour
    Then the quiz offer is sent on that sweep, as it was before the hold-back
    # Kill switch for the one-open-question rule (default on). The quiet-hours skip is not switched
    # separately: it stays under LP_QUIZ_OFFER_ENABLED.
