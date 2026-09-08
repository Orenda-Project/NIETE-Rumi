@whatsapp @ict @profile:niete @feature:language @persona:teacher
Feature: NIETE (ICT) — Language: selection, the one-writer guarantee, and propagation across every flow
  # The language feature for the NIETE (ICT / Islamabad) WhatsApp bot, driven from a linked
  # WhatsApp Web session via Chrome MCP against the NIETE bot. ICT serves exactly TWO
  # languages: Urdu and English (Urdu is the offered default — ICT teaching is Urdu-medium;
  # English is the emergency floor).
  #
  # ─────────────────────────── GROUNDED ON `develop` (OPS-118) ───────────────────────────
  # This spec is code-grounded on the NIETE-Rumi `develop` branch @ 98bd9b2 — the Language
  # Unification workstream (OPS-118, promoted develop→main, live in prod 2026-08-10 14:54 UTC).
  # It SUPERSEDES the pre-unification language scenarios (the old /language picker offered 10
  # hardcoded languages incl. an "Auto-detect" row — finding F3 — both now REMOVED on develop).
  # These scenarios are NOT yet driven live on develop; drive them on the staging target
  # (923222482222) per the suite rule, then drop @wip/@draft and add a `Verified live` note.
  #
  # ─────────────────────────── The five design decisions (OPS-118) ──────────────────────
  #  D1 ONE WRITER   — setUserLanguage() (language-cache.js:127) is the ONLY path that may
  #                    change a stored language. It validates against the offer (isOffered
  #                    guard :142), sets the lock, busts both Redis keys. A voice note can no
  #                    longer overwrite a teacher's choice. (This is the headline — section B.)
  #  D2 ONE REGISTRY — the OFFER (what she may be shown) is exactly {ur,en} (languages.js
  #                    LANGUAGE_OFFER); RECOGNITION (what we can detect/transcribe) stays
  #                    broader on purpose so telemetry can record an off-market leak.
  #  D3 TWO TERRITORIES — content bound for her CLASSROOM (a lesson plan) freezes its language
  #                    at job-enqueue time; text addressed to HER (notification, caption,
  #                    prompt) reads the CURRENT preference at send time.
  #  D4 TWO FLOORS   — offerDefaultLanguage()='ur' (what a new teacher is offered first);
  #                    DEFAULT_LANGUAGE='en' (emergency floor when nothing is determinable).
  #  D5 ONE CLAMP    — clampLanguage(lang,offered) is the single funnel; it LOGS the original
  #                    alongside the clamped value so an off-market code stays visible.
  #
  # ─────────────────────────── Handling non-determinism (READ FIRST) ────────────────────
  # See ../../../.claude/qa/shared/non-determinism-contract.md. FIXED strings (@copy) are
  # pinned exactly; the language a surface renders IN is asserted by SHAPE ("renders in Urdu /
  # RTL Perso-Arabic script"), never by pinning a full sentence copywriters may reword. Where a
  # scenario proves persistence, read state back from the DB (users.preferred_language /
  # users.language_locked), not just the reply. AI-reply language is model-driven → assert the
  # script/language, not the wording.
  #
  # Tags: @acceptance = a step of the OPS-118 15-minute acceptance plan · @copy = exact wording
  # · @edge · @negative · @known-issue = documents a real i18n gap (should PASS once fixed) ·
  # @config-gated · @defensive · @content-driven (answer resolved live) · @first-use · @coverage (static grep guard, not a live drive) ·
  # @slow · @wip @draft (code-grounded, not yet driven live on develop). @persona:* overrides
  # the feature default. @P1/@P2/@P3 = priority. @wip/@draft/@slow excluded from the safe run.

  # ══════════════════════════ A. SELECTION & PERSISTENCE (/language) ═════════════════════

  @e2e @acceptance @language @copy @P1
  Scenario: /language opens a bilingual picker offering EXACTLY Urdu and English (no Auto-detect)
    Given the NIETE bot chat is open
    When I send "/language"
    Then the picker actually sends (it is not silently dropped by Meta)
    And the picker header reads "Select Language / زبان منتخب کریں"
    And the list opener button is labelled "Languages"
    And the picker footer reads "/language — change anytime · کسی بھی وقت تبدیل کریں"
    When I open the "Languages" list
    Then the list shows exactly these rows:
      | اردو    |
      | English |
    And the list does NOT contain an "Auto-detect" row
    And the list does NOT contain any of: پنجابی, سنڌي, پښتو, بلوچی, தமிழ், العربية, Español
    # MERGED 2026-08-19: was two scenarios ("/language opens a picker offering EXACTLY..."
    # + "The picker chrome is bilingual and the send fits WhatsApp's field caps") repeating
    # the same /language trigger and state. Consolidated per the anti-redundancy rule.
    # OPS-118 acceptance step 1 ("get a menu offering اردو and English"). Rows built from the
    # registry: getOfferedLanguages().map(...) (whatsapp.service.js:1447) over LANGUAGE_OFFER
    # ['ur','en'] (languages.js:35), id lang_ur/lang_en, title languageTitle (اردو / English).
    # The old 10-row hardcoded list + Auto-detect row are REMOVED (whatsapp.service.js:1441-1451
    # comment; whatsapp-bot.js:1647 "no 'auto' branch any more"). This resolves finding F3.
    # Chrome via resolveUx: header languagePickerHeader (whatsapp.service.js:1428 / ux-strings.js:102),
    # footer languagePickerFooter (:1434 / ux-strings.js:89), button "Languages" (:1437). Chrome is
    # deliberately BILINGUAL — this is the screen a teacher reaches when her CURRENT language is the
    # wrong one. REGRESSION GUARD: the first bilingual footer was 87 chars → Meta #131009 ("Max
    # length: 60") → /language sent NOTHING for hours while every unit test passed. Footer/header
    # are on a 60-CODE-POINT cap (measured in code points, not UTF-16); tests/config/
    # ux-strings-whatsapp-limits.test.js enforces it. "The picker actually sends" is asserted
    # FIRST and deliberately: a picker that fails to arrive is a FAIL, not a copy nit.

  @e2e @acceptance @language @copy @P1
  Scenario: Selecting English confirms in English and persists the choice, locked
    Given the NIETE bot chat is open
    When I send "/language", open the "Languages" list, and select "English"
    Then the bot replies "✅ Language set to English. I will now respond in English."
    And the stored preference is English and locked (preferred_language='en', language_locked=true)
    And when I then send "hello" the reply is in English
    # OPS-118 acceptance step 2. Routing whatsapp-bot.js:1657 setUserLanguage(user.id,'en',true);
    # confirm :1669. Persistence language-cache.js:153-160 (writes BOTH fields) + Redis bust.

  @e2e @acceptance @language @copy @P1
  Scenario: Selecting Urdu confirms IN Urdu and persists the choice, locked
    Given the NIETE bot chat is open
    When I send "/language", open the "Languages" list, and select "اردو"
    Then the bot confirmation renders in Urdu (RTL Perso-Arabic script)
    And the stored preference is Urdu and locked (preferred_language='ur', language_locked=true)
    And when I then send "hello" the reply is in Urdu
    # OPS-118 acceptance step 3. Confirm whatsapp-bot.js:1668
    # "✅ زبان اردو میں تبدیل ہو گئی۔ اب میں اردو میں جواب دوں گی۔" — rendered IN the chosen language
    # ("the first message after a switch contradicting the switch is its own bug", :1665). Restore
    # to the pre-test language at scenario end.

  @e2e @language @edge @P3
  Scenario: /language is case-insensitive
    Given the NIETE bot chat is open
    When I send "/LANGUAGE"
    Then the "Languages" picker is shown
    # text-message.handler.js:1715 matches messageBody.toLowerCase() === '/language'.

  @e2e @language @negative @defensive @P2
  Scenario: A stale client replaying an off-offer row is rejected by the writer, not stored
    Given the NIETE bot chat is open
    And a stale client somehow replays an old row id (e.g. "lang_pa-PK")
    When that selection reaches the bot
    Then the bot replies "Sorry, there was an error updating your language preference. Please try again."
    And no off-offer language is written to my account (preferred_language unchanged)
    # D1+D2. setUserLanguage rejects anything not isOffered (language-cache.js:142 → returns false),
    # routing sends the error and returns (whatsapp-bot.js:1659-1663). The offer no longer surfaces
    # these rows, so this is only reachable via a stale/replayed client — @defensive, but it proves
    # the writer is the enforcement point, not the picker. Also the path a coaching recording used
    # to take to persist pa-PK/ar onto an ICT teacher (now blocked).

  # ══════════════════ B. THE ONE-WRITER GUARANTEE (D1 — the headline) ════════════════════

  @e2e @language @wip @draft @P2
  Scenario: The coaching transcription path cannot re-language a locked account
    Given the NIETE bot chat is open
    And my language is locked to Urdu
    When a coaching recording is transcribed as English
    Then my preferred_language remains 'ur' and locked
    # Same guarantee from the coaching side. transcription-processor.service.js resolves language
    # for the SESSION but any persist still routes through setUserLanguage → isOffered + the lock.
    # @content-driven / @slow: needs a full coaching upload. Complements the voice-note scenario.

  @e2e @language @coverage @P3
  Scenario: No dead language-lock reader export exists (removed 2026-08-11, bd-2485)
    Given the language subsystem source
    Then language-cache.js exports no isUserLanguageLocked (nor any lock reader) unless it has >= 1 caller in bot/
    # CODE-HYGIENE GUARD (static grep, not a live drive). isUserLanguageLocked was a tested-but-uncalled
    # export ("the missing reader") — now REMOVED (language-cache.js tombstone; mock export + its
    # test suite dropped) because the one-writer guarantee is delivered by the audio-never-writes flag
    # (transcription-processor.service.js:127,146-156), so nothing needs to READ the lock. This guard
    # FAILS if a lock reader is reintroduced with zero callers — a dead export that looks like a guard
    # is worse than none. bd-2485.

  # ══════════════════════════════ C. REGISTRATION FLOW ══════════════════════════════════

  @e2e @language @known-issue @P3
  Scenario: The registration launch bubble is English regardless of any prior language
    Given the NIETE bot chat is open
    When I send "/register"
    Then the launch bubble ("Welcome" / "Quick setup…" / "Get started") renders English (BUG)
    # text-message.handler.js:1659-1662 hardcoded English, no language read (same on the auto-onboard
    # path feature-registration.service.js:156-161). Minor: pre-language a new user has no stored
    # pref anyway, but a returning user re-registering in Urdu still gets the English bubble.

  # ══════════════════════════════ D. /settings FLOW ═════════════════════════════════════

  # ═══════════════ E. PROPAGATION — does the choice reach each flow's surface? ═══════════
  # An Urdu account walks each feature; assert whether the surface renders in Urdu. Localized
  # flows are positive @e2e; flows that still hardcode English are @known-issue (flip to positive
  # once localized). Precondition for every scenario in this section: preferred_language='ur', locked.

  # ── E1. Localized correctly (positive) ──

  @e2e @language @content-driven @P2
  Scenario: Ask Anything answers an Urdu account in Urdu, and drift is logged
    Given the NIETE bot chat is open
    And my language is set to Urdu
    When I ask a teaching question in Urdu
    Then the AI reply renders in Urdu (RTL Perso-Arabic script)
    # The general-conversation path is language-aware end to end: responseLanguage flows into
    # handleGeneralConversation (text-message.handler.js:2280) → the LLM system prompt
    # (openai.service.js buildLanguagePrompt). A drift guard verifyOutputLanguage
    # (text-message.handler.js:2566) logs a `language_drift` event if the model answers in the
    # wrong language (advisory — the reply is still sent). @content-driven: model output varies.

  # Verified live on PROD 2026-08-11 (923206281951) with a SEEDED throwaway school+teacher,
  # driven end-to-end then torn down. Driver is role=principal (a LEADER_ROLE → /observe unlocked,
  # no flip needed). TWO-LAYER language result:
  #   - Localized (Urdu) ✅: the /observe entry + "Plan my visit" CTA, AND the Support-brief CONTENT
  #     (observeLang → preferred_language, observe-strings.js:378; leader-source areaLabel en/ur,
  #     leader-source.js:37-52). This is the positive — observe is NOT a menu/status-style leak.
  #   - NOT localized (English) ✗: the native WhatsApp Flow chrome — screens "Observe / Schedule new
  #     observation / Pick a school / Pick a teacher / Support brief / Date & time / Save schedule /
  #     Scheduled". Same Flow-JSON localization gap as the LP Pick-Class + Training inner flows.
  @e2e @persona:coach @language @config-gated @seeded @P2
  Scenario: /observe — the whole visit flow renders bot CONTENT in Urdu, but the Flow chrome stays English
    Given a leader/field officer whose language is Urdu
    And a seeded school "QA Test School" with one teacher on the leader's roster
      # Seed: INSERT leader_schools + leader_teachers keyed by leader_user_id (source='niete_ict');
      # set teacher_phone_e164 = the driver's OWN number so a later capture binds to the existing
      # user (no fake teacher user created). Teardown: DELETE those rows + the observation_schedules
      # row afterwards. Reversible; isolated to the throwaway leader — real teachers are untouched.
    When I send "/observe"
    Then the entry message and the "Plan my visit" CTA render in Urdu
    When I open the Flow, pick the school, then the teacher
    Then the Flow chrome (headings and buttons) renders in English
    And the Support brief CONTENT (what's going well / growth area / visit tips) renders in Urdu
    When I pick a date and time and save the schedule
    Then the visit is persisted to observation_schedules and the confirmation names the teacher and school
    # Audio-capture caveat: a raw lesson-audio upload from the composer routes to the GENERAL voice
    # assistant (short voice reply), NOT the observe debrief pipeline. The capture needs the in-flow
    # "start recording" state (observe-audio-router). The debrief/report language was therefore not
    # driven live here; per code it follows observeLang (Urdu), same as the brief content above.

  @e2e @language @P2
  Scenario: Lesson Plans via the natural-language path answers in the chosen language
    Given the NIETE bot chat is open
    And my language is set to Urdu
    When I ask for a lesson plan in free text (the NL/Gamma path)
    Then the "preparing" ack and result copy render in Urdu
    # handleLessonPlanRequest localizes via inline en/ur/ar/es maps keyed on responseLanguage
    # (text-message.handler.js:2301-2346). (Distinct from the Pick-Class Flow path — see E2.)

  @e2e @language @wip @draft @P3
  Scenario: Teacher Training ENTRY launcher is localized (entry only)
    Given the NIETE bot chat is open
    And my language is set to Urdu
    When I send "/training"
    Then the training launch card body/button render in Urdu
    # Only the entry launcher localizes: training-entry.service.js:59-60 COPY.body[language]||en (real
    # Urdu at :23,:27). Everything INSIDE the Flow is English — see E2 (F-TRAIN-i18n).

  # ── E2. Still leaks English on an Urdu account (@known-issue) ──

  @e2e @language @known-issue @P1
  Scenario: /menu renders English on an Urdu account
    Given the NIETE bot chat is open
    And my language is set to Urdu
    When I send "/menu"
    Then the "View Features" list (header, body, button, rows) renders English (BUG)
    # The interactive list is built by sendFeatureMenuCarousel(to)/sendFeatureMenuListFallback(to) —
    # NO language param; menu.service.js:45 drops `language`. Copy hardcoded English
    # (whatsapp.service.js:1892 header, :1895 body, :1901 button, :1904-1932 rows). A localized
    # text-menu fallback exists (menu.service.js:185-195) but only fires if the list send FAILS.

  @e2e @language @P1
  Scenario: /status answers in Urdu on an Urdu account
    Given the NIETE bot chat is open
    And my language is set to Urdu
    When I send "/status"
    Then the reply is in Urdu — with nothing running, "اس وقت کچھ نہیں چل رہا۔ کچھ شروع کرنے کے لیے /menu بھیجیں۔"
    # WAS @known-issue "renders English": /status read no language at all. Fixed by the
    # probe-before-send rework (2026-09-08): the idle answer comes from the bilingual string
    # catalog and resolves per preferred_language. DRIVEN LIVE 2026-09-08 (staging, Urdu driver):
    # the reply above, in Urdu — the leak is gone. The "something running" surface is per
    # environment (Flow card on staging) and is asserted in status.feature.

  @e2e @language @known-issue @P2
  Scenario: Lesson Plans via the Pick-Class Flow renders English on an Urdu account
    Given the NIETE bot chat is open
    And my language is set to Urdu
    When I open Lesson Plans from /menu and drive the Pick-Class Flow
    Then the launch bubble, the Flow screens, and the "Sending…" pre-gen ack render English (BUG)
    # F-LP-i18n. Launch bubble only partially inline-localized (header hardcoded English,
    # text-message.handler.js:979). Pick-Class Flow screens all hardcoded English
    # (pakistan-lp-endpoint.js:34,144,186,236,280…). Pre-gen ack hardcoded English
    # (sendPreDeliveryAck :339-342) — it reads preferred_language only to pick the PDF R2 key, not to
    # localize the ack. Only the NL path (E1) and feedback survey localize.

  @e2e @language @content-driven @P2
  Scenario: A Grade 1-5 Pick-Class lesson plan is served in Urdu only if an Urdu PDF exists (else English)
    Given the NIETE bot chat is open
    And my language is set to Urdu
    When I complete the Pick-Class Flow for a Grade 1-5 chapter
    Then the delivered PDF is row.pdf_r2_key_ur if present, otherwise it falls back to row.pdf_r2_key_en
    And today that fallback ALWAYS fires — pre_generated_lps.pdf_r2_key_ur is 0/304 (no Urdu corpus)
    # CONTENT language (distinct from the chrome leak above). Delivery is language-KEYED and correct
    # (pakistan-lp-endpoint.js:362-365 — language==='ur' && row.pdf_r2_key_ur ? ur : en||ur), but the
    # corpus has no Urdu files: verified 2026-08-11 via Supabase REST — 304 pakistan rows, pdf_r2_key_en
    # 304/304, pdf_r2_key_ur 0/304 (grades 1-5). So Urdu teachers ALWAYS get the English PDF — a
    # CONTENT-COVERAGE gap, NOT a language-logic bug: populate pdf_r2_key_ur and Urdu is served with no
    # code change. (Grade 6-10 Oxbridge is passed clampLanguage(preferred_language), :306-312.)

  # Verified live on PROD 2026-08-11 (923206281951). PREREQUISITE: coaching only fires for a TEACHER —
  # a leader's audio routes to /observe first and "must NEVER fall into teacher coaching"
  # (voice-message.handler.js:65). Driver flipped principal→teacher (reversible) for the run, restored
  # after; the created coaching_sessions row was deleted. Threshold confirmed: the 16-min fixture
  # (≥900s) triggered detection; a 3.5-min clip did NOT. Observed EN chrome: "I detected a 16-minute
  # audio recording… Yes, Analyze / No", "Step 1/5: Transcribing…" → "Step 4/5: Generating your
  # comprehensive observation report…", "Great job, Mah!…". Observed UR interstitials: photo prompt
  # "کیا آپ اپنی کلاس روم کی تصویر شیئر کرنا چاہیں گے؟" and LP prompt "کیا آپ کے پاس اس کلاس کا سبق کا
  # منصوبہ ہے؟". Reflective step (Step 3/5) is delivered as VOICE notes.
  @e2e @language @known-issue @slow @persona:teacher @P1
  Scenario: Coaching progress steps render English on an Urdu account, but the interstitials render Urdu
    Given the NIETE bot chat is open as a TEACHER whose language is Urdu
    When I upload a classroom recording (≥ 15 min) and drive the coaching pipeline
    Then the detection/confirm prompt and the Step 1–5/5 progress lines render English (BUG)
    But the photo prompt and the lesson-plan interstitial render Urdu (correct)
    And the reflective step (Step 3/5) is delivered as a voice note
    # bd-2479, precisely: the progress steps ARE routed through a catalog (getCoachingMessage,
    # coaching-messages.js:111) keyed on preferred_language, but every non-en value is the
    # __TODO_TRANSLATE__ sentinel (:50-52) → EN fallback (:117). Keys step1_transcribing:73 …
    # step5_voiceDebrief:81. Meanwhile the interstitials are inline-localized and DO render Urdu:
    # photo-prompt.service.js:17-28, lp-selection-list.service.js:34-79. "Yes, Analyze" /
    # "Long Lesson Detected" / report-delivery chrome are English. @slow: full pipeline is 10+ min.

  # ═══════════════ F. DESIGN-DECISION CONTRACTS (guard-style, from OPS-118) ══════════════

  @e2e @language @P2
  Scenario: A new teacher is offered Urdu first; English is only the emergency floor (D4)
    Given a brand-new teacher whose language is not yet known
    When the sign-up language choice is presented
    Then Urdu is the pre-selected / first-offered option (offerDefaultLanguage='ur')
    And English is used ONLY when no language can be determined at all (DEFAULT_LANGUAGE='en')
    # D4 — two floors, deliberately separate functions (languages.js offerDefaultLanguage :91 =
    # 'ur'; language-cache DEFAULT_LANGUAGE = 'en'). An early fix swapped a hardcoded 'ur' for
    # offerDefaultLanguage() (also 'ur') and shipped a no-op — so assert the OFFER default is Urdu,
    # not merely "a default exists". @first-use.

  @e2e @language @wip @draft @P2
  Scenario: A lesson plan keeps the language it was enqueued with, even if I switch mid-generation (D3)
    Given the NIETE bot chat is open
    And I request a lesson plan while my language is Urdu
    When I switch my language to English before the plan finishes generating
    Then the delivered lesson-plan CONTENT is still Urdu (frozen at enqueue)
    But any message addressed to ME after the switch (caption/notification) is English (read fresh at send)
    # D3 — two territories. Classroom content freezes its language into the job payload at enqueue;
    # teacher-addressed text reads the current preference at send time. Guarded by
    # tests/queue/job-language-territories.test.js. @slow: spans a generation job.

  @e2e @language @defensive @wip @draft @P3
  Scenario: An off-market language arriving from outside the offer is narrowed AND logged (D5)
    Given an inbound language value outside the offer reaches a render path
    When it passes through clampLanguage
    Then it is narrowed to an offered language (English floor) rather than throwing
    And the original value is logged alongside the clamped one (the leak stays visible)
    # D5 — one clamp. clampLanguage (ux-strings.js:47) is the single funnel; junk/null/non-strings
    # return the floor rather than failing closed on a render path. Telemetry visibility is the point:
    # collapsing offer and recognition would blind the instruments (D2). @defensive — unit-level, kept
    # here to document the contract.

  # ═══════════════════════════════ G. NEGATIVE ══════════════════════════════════════════

  @e2e @language @negative @edge @P3
  Scenario: A bare "language" (no slash) does not open the picker
    Given the NIETE bot chat is open
    When I send "language"
    Then the bot does NOT show the "Languages" picker (it replies conversationally / via the AI handler)
    # Only "/language" (case-insensitive) matches text-message.handler.js:1715. Bare "language"
    # falls through to the general/AI handler. Counterpart to menu.feature's bare-"menu" negative.
