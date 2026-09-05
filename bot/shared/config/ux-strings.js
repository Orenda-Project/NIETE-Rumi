/**
 * Teacher-facing fixed copy, and the one language clamp.
 *
 * Two things live here because they are the same problem seen from two sides:
 * the clamp answers "which language may this surface render in", and the catalog
 * answers "what does it say in that language".
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT config/system-messages.js
 *
 * That file looks like this one and is deliberately NOT reused. It is the open
 * platform's CUSTOMIZATION SEAM — docs/agent-customization.md points an adopter
 * at it as "the file you translate to add a language", it carries nine languages
 * on purpose, and tests/setup/orphan-modules.allowlist.json registers it as an
 * intentional orphan. Folding this deployment's en/ur copy into it would break
 * that contract for every downstream cloner and drag seven languages ICT does
 * not serve back into a live read path.
 *
 * This module is the opposite: narrow, deployment-specific, and wired in.
 * ---------------------------------------------------------------------------
 */

const { LANGUAGE_OFFER, getLanguage } = require('./languages');

/**
 * The emergency floor. English by resolved decision, and the same floor as
 * language-cache's DEFAULT_LANGUAGE — the "fallbacks disagree" defect was two
 * modules each picking their own, so this one does not get an opinion.
 */
const FLOOR = 'en';

/**
 * Collapse any language code to one this deployment can actually render.
 *
 * Replaces 23 inline copies of `lang === 'ur' ? 'ur' : 'en'`. Every one of those
 * was correct; the problem was structural — nothing stopped the 24th from being
 * written differently, and several were already drifting (some clamped a
 * `preferred_language`, some a detected language, some a Flow field).
 *
 * Total by construction: junk, null and non-strings return the floor rather than
 * throwing, because this sits on render paths that must not fail closed.
 *
 * @param {*} lang
 * @param {string[]} [offered] narrow the offer further; cannot widen it
 * @returns {string} an offered language code
 */
function clampLanguage(lang, offered = LANGUAGE_OFFER) {
  if (typeof lang !== 'string') return FLOOR;
  const code = lang.trim();
  if (!code) return FLOOR;
  // Intersected with the deployment offer so a caller passing a wider list
  // cannot re-introduce a language we do not serve.
  return offered.includes(code) && LANGUAGE_OFFER.includes(code) ? code : FLOOR;
}

/**
 * The copy. One entry per key, one string per offered language.
 *
 * Urdu here is not newly invented — it follows the phrasing already used
 * elsewhere in this codebase (`سیٹنگز` as in the /settings entry points,
 * `محفوظ ہو گئی` as in the attendance and observation confirmations) so the
 * teacher hears one consistent voice rather than a second translator's.
 */
const UX_STRINGS = {
  // ─── post-coaching survey ─────────────────────────────────────────────────
  // Sent once a coaching session has settled — report delivered, voice debrief
  // attempted. The negative path is the point of the whole survey: an
  // unexplained thumbs-down tells us nothing, so it asks one plain question.
  // The two button titles are capped by WhatsApp at 20 CODE POINTS and an
  // emoji costs two, so they are deliberately short in both languages.
  coachingSurveyAsk: {
    en: 'Was this coaching report useful to you?',
    ur: 'کیا یہ کوچنگ رپورٹ آپ کے لیے مفید رہی؟',
  },
  coachingSurveyYesButton: {
    en: '👍 Yes, useful',
    ur: '👍 جی ہاں',
  },
  coachingSurveyNoButton: {
    en: '👎 Not really',
    ur: '👎 نہیں',
  },
  coachingSurveyThanks: {
    en: 'Thanks — glad it was useful.',
    ur: 'شکریہ — خوشی ہے کہ یہ کام آئی۔',
  },
  coachingSurveyAskReason: {
    en: 'Thanks for telling us. What could we do better? (one line is enough)',
    ur: 'بتانے کا شکریہ۔ ہم اسے بہتر کیسے بنا سکتے ہیں؟ (ایک سطر کافی ہے)',
  },
  coachingSurveyReasonThanks: {
    en: 'Got it, thank you — this makes the next report better.',
    ur: 'سمجھ گئی، شکریہ — اس سے اگلی رپورٹ بہتر ہوگی۔',
  },

  // ─── commitment-card buttons ──────────────────────────────────────────────
  // The one-line acknowledgement after a tap on "Will you commit to trying this
  // in your next class?". Gender-neutral by construction: the Urdu is Rumi's
  // own first-person plural or an impersonal statement, never a second-person
  // verb stem that would have to pick the teacher's gender.
  coachingCardAckYes: {
    en: 'Noted — we will look for it in your next lesson. Good luck!',
    ur: 'نوٹ کر لیا — اگلے سبق میں ہم اسے دیکھیں گے۔ بہت خوب!',
  },
  coachingCardAckLater: {
    en: 'No problem — it will be here whenever you are ready.',
    ur: 'کوئی بات نہیں — یہ یہیں موجود رہے گا، جب بھی وقت ہو۔',
  },
  coachingCardAckNo: {
    en: 'Thanks for telling us — we will suggest something different next time.',
    ur: 'بتانے کا شکریہ — اگلی بار ہم کچھ مختلف تجویز کریں گے۔',
  },

  // ─── feedback-uptake loop: the hero report's "last time we asked" line ────
  // {count} is the tally in words (unit names stay English by the code-switch
  // rule; the connecting words are the report's language); {target} is the
  // indicator's name. Never a score, never a percentage.
  uptakeLineAchieved: {
    en: '{count}. The bar was met.',
    ur: '{count}۔ ہدف پورا ہوا۔',
  },
  uptakeLinePartial: {
    en: '{count}. One more push reaches the bar.',
    ur: '{count}۔ ایک اور کوشش سے ہدف پورا ہو جائے گا۔',
  },
  uptakeLineNotSeen: {
    en: '{count}. Next class, a different way in.',
    ur: '{count}۔ اگلی کلاس میں ایک نیا انداز۔',
  },
  uptakeLineNotApplicable: {
    en: 'We will come back to {target} in a lesson where it applies.',
    ur: '{target} پر ہم ایسے سبق میں لوٹیں گے جہاں یہ لاگو ہو۔',
  },
  uptakeLineUnknown: {
    en: 'We could not count it this time — we will look again next lesson.',
    ur: 'اس بار ہم اسے گن نہیں سکے — اگلے سبق میں دوبارہ دیکھیں گے۔',
  },
  uptakeLineHandOver: {
    en: 'Your coach will pick this up with you in person.',
    ur: 'آپ کے کوچ اسے آپ کے ساتھ بالمشافہ آگے بڑھائیں گے۔',
  },

  // Shown on the Settings SUCCESS screen. Previously English-only, so a teacher
  // who had just switched to Urdu was congratulated in English.
  settingsSaved: {
    en: 'Your settings have been saved.',
    ur: 'آپ کی سیٹنگز محفوظ ہو گئی ہیں۔',
  },

  settingsDetails: {
    en: 'Language: {language} | Observation: {framework}',
    ur: 'زبان: {language} | مشاہدہ: {framework}',
  },

  // ─── live calls (bd-1hae7) ────────────────────────────────────────────────
  // Sent right after we decline a call, so a teacher who rings and gets nothing
  // is not left wondering. Message bodies, not buttons or footers, so no
  // code-point cap applies — but they stay short because they arrive unbidden.
  // Feminine first person throughout (Rumi's own voice) and the آپ register.

  // Every line is in use. She rang; the phone did not ring back.
  callBusyOverflow: {
    en: "Sorry — I'm on another call right now. Send me a message here and I'll help you straight away.",
    ur: 'معذرت، میں اس وقت ایک اور کال پر ہوں۔ آپ یہاں پیغام لکھ دیں، میں فوراً مدد کروں گی۔',
  },

  // The weekly calling budget is spent. Messaging is unaffected, so say so.
  callBudgetOverflow: {
    en: "Sorry — calling isn't available just now. Message me here and I'll help you the same way.",
    ur: 'معذرت، کال اس وقت دستیاب نہیں۔ آپ یہاں پیغام لکھ دیں، میں اسی طرح مدد کروں گی۔',
  },

  // She has used her calls for today. Not a telling-off — an invitation.
  // NOTE the Urdu: addressed to the TEACHER, so the verb is a gender-neutral
  // imperative (لکھ دیں), never a gendered second person (لکھ سکتی/سکتے ہیں).
  // Cohorts are mixed-gender. Rumi's OWN voice stays feminine (موجود ہوں).
  callDailyLimitOverflow: {
    en: "That's all our calls for today. Message me here any time — I'm always available.",
    ur: 'آج کی کالیں مکمل ہو گئیں۔ آپ یہاں کسی بھی وقت پیغام لکھ دیں، میں ہمیشہ موجود ہوں۔',
  },

  /**
   * The language picker's footer. Bilingual — see languagePickerHeader below —
   * but on a HARD 60-CHARACTER BUDGET, which is why it is terse to the point of
   * being telegraphic rather than a full sentence in each language.
   *
   * The first bilingual version of this was 87 characters and Meta rejected the
   * whole message (#131009, "Footer text length invalid. Min length: 0, Max
   * length: 60"), so /language sent nothing at all. The command name appears once
   * instead of twice, and each language gets a phrase rather than a sentence.
   * tests/config/ux-strings-whatsapp-limits.test.js enforces the budget with
   * headroom, so the next edit here cannot repeat it.
   */
  languagePickerFooter: {
    en: '/language — change anytime · کسی بھی وقت تبدیل کریں',
    ur: '/language — کسی بھی وقت تبدیل کریں · change anytime',
  },

  /**
   * The picker's own chrome stays BILINGUAL in both slots, which looks like the
   * stapled-language bug this workstream removes but is the one place it is
   * correct: this is the screen a teacher uses when the current language is
   * wrong for her. Rendering it only in the language she is trying to leave is
   * how a picker becomes unusable. Kept here rather than inline so the choice is
   * visible and reviewable instead of buried in a request body.
   */
  languagePickerHeader: {
    en: 'Select Language / زبان منتخب کریں',
    ur: 'زبان منتخب کریں / Select Language',
  },

  languagePickerBody: {
    en: 'Choose your preferred language. I will respond in this language for all conversations.\n\nاپنی پسندیدہ زبان منتخب کریں۔ میں اسی زبان میں جواب دوں گی۔',
    ur: 'اپنی پسندیدہ زبان منتخب کریں۔ میں اسی زبان میں جواب دوں گی۔\n\nChoose your preferred language. I will respond in this language.',
  },

  /**
   * LP v8 delivery (FEAT-059, staging feedback round 1). The ack
   * exists because presign + Meta's document fetch take several seconds AFTER
   * the Flow has already closed — that silence read as a failed request on the
   * operator's device test. Urdu is gender-neutral by construction: passive
   * voice throughout, no verb stem agreeing with the addressee.
   */
  lpV8Preparing: {
    en: '📄 Preparing your lesson plan — it will be with you in a moment…',
    ur: '📄 آپ کا سبق کا منصوبہ تیار کیا جا رہا ہے — بس ایک لمحہ…',
  },

  lpV8StillPreparing: {
    en: 'That lesson plan is still being prepared — try again shortly.',
    ur: 'یہ سبق کا منصوبہ ابھی تیاری میں ہے — تھوڑی دیر بعد دوبارہ کوشش کریں۔',
  },

  // ── 6-12 lesson plans, written at the moment she asks ────────────────────
  //
  // A 6-12 lesson is authored on the first request, not looked up: the wait is
  // real, and every one of these strings exists so that no part of it is silent.
  //
  // HOW LONG, measured rather than guessed (bd-2ym0h): a first hit on the
  // post-optimisation lane runs a median of 313 seconds, spread roughly four to
  // eleven minutes. These strings used to say "about 2 minutes", which is the
  // number the lane hit before the authoring ladder grew, and being told two
  // while waiting five is how a working feature earns a bug report. They say
  // five to six now. If the lane's timings move again, this comment and the two
  // strings below move with them — a stale promise is a defect, not a detail.
  //
  // A SECOND request for the same lesson is served from R2 in about a second and
  // sends no interstitial at all (lp612-serving.service.js answers a cache hit
  // by delivering the file directly). Nobody reads these strings on a fast path,
  // so they can quote the slow number plainly — and saying "brand-new" is what
  // stops five minutes reading as the price of every lesson.
  //
  // The Urdu is deliberately gender-agnostic in the second person — imperatives
  // and impersonal constructions, never `رہی ہوں گی` / `رہے ہوں گے` — because
  // the cohort is mixed and the bot cannot know.

  lp612Preparing: {
    en: '📄 Writing your lesson plan now — a brand-new lesson usually takes about 5–6 minutes. I will send it here as soon as it is ready.',
    ur: '📄 آپ کا سبق کا منصوبہ ابھی تیار کیا جا رہا ہے — نئے سبق میں عام طور پر پانچ سے چھ منٹ لگتے ہیں۔ تیار ہوتے ہی یہیں بھیج دیا جائے گا۔',
  },

  lp612StillWorking: {
    en: 'Still working on that lesson plan — a few more minutes. It will arrive here.',
    ur: 'سبق کا منصوبہ ابھی تیار ہو رہا ہے — کچھ اور منٹ لگیں گے۔ یہیں موصول ہو جائے گا۔',
  },

  lp612AlreadyPreparing: {
    en: 'That lesson plan is already being written — I will send it here as soon as it is ready.',
    ur: 'یہ سبق کا منصوبہ پہلے ہی تیار ہو رہا ہے — تیار ہوتے ہی یہیں بھیج دیا جائے گا۔',
  },

  // A run that was killed mid-flight — almost always a deploy restarting the worker — gets its
  // OWN sentence. It is deliberately not lp612AlreadyPreparing: saying "already being written"
  // about a run that is never coming back is precisely what made this failure invisible on
  // staging, and it is what rule 24(d) is about. She does not need to know what a worker is;
  // she needs to know it stopped, it has restarted, and she does not have to do anything.
  lp612Restarted: {
    en: '📄 That lesson stopped partway through, so I have started it again. It usually takes about 5–6 minutes and will arrive here.',
    ur: '📄 وہ سبق درمیان میں رک گیا تھا، اس لیے دوبارہ شروع کر دیا گیا ہے۔ عام طور پر پانچ سے چھ منٹ لگتے ہیں اور یہیں موصول ہو جائے گا۔',
  },

  // A lesson whose page range is over the cap will fail identically on every retry, so it must
  // NOT get lp612Failed's "tap it again in a few minutes" — that invites her to wait and tap for
  // ever on something that can never succeed. Rule 24(d): the copy names the actual state, and
  // points at the thing that WILL work (the shorter rows in the same chapter).
  lp612TooLong: {
    en: 'That lesson covers too many pages for me to plan in one go. Open the chapter and pick one of the shorter lessons — those I can write for you now.',
    ur: 'یہ سبق اتنے زیادہ صفحات پر پھیلا ہوا ہے کہ ایک ساتھ منصوبہ نہیں بن سکتا۔ باب کھول کر کوئی چھوٹا سبق منتخب کریں — وہ ابھی تیار کر دیا جائے گا۔',
  },

  // Never a silent failure. She is told it failed, and told exactly what to do.
  lp612Failed: {
    en: 'I could not finish that lesson plan this time. Please tap it again in a few minutes and I will try once more.',
    ur: 'اس بار سبق کا منصوبہ مکمل نہیں ہو سکا۔ چند منٹ بعد دوبارہ اسی سبق پر ٹیپ کریں، دوبارہ کوشش کی جائے گی۔',
  },

  // The operator's hold on religious content. Phrased as "not yet", because
  // that is what it is — a review is pending, not a refusal.
  lp612Held: {
    en: 'Lesson plans for this subject are still being reviewed, so I cannot share them yet. Everything else is ready to use.',
    ur: 'اس مضمون کے سبق کے منصوبے ابھی نظرثانی کے مرحلے میں ہیں، اس لیے فی الحال دستیاب نہیں۔ باقی تمام مضامین حاضر ہیں۔',
  },

  lp612NotFound: {
    en: 'I could not find that lesson. Open the lesson plan menu and choose it again.',
    ur: 'یہ سبق نہیں مل سکا۔ سبق کے منصوبے کا مینو کھول کر دوبارہ منتخب کریں۔',
  },

  // ── the edit lane's honest refusals ──────────────────────────────────────
  //
  // The 12-cell spike (bd-6pxpk) measured why these have to exist. Asked to "write me an exam
  // paper for this whole chapter", the revision ladder could not produce one — lp_doc has
  // nowhere to put an exam paper — so it added a single question to the existing exam bank and
  // said nothing. Every gate passed. She would have received her lesson back, subtly different,
  // with no idea her request had not been understood.
  //
  // The schema stops the harm; only copy can stop the confusion. Both strings therefore do the
  // same three things: name what CAN be changed, state plainly that her lesson is unchanged, and
  // leave her a next move. Neither apologises for a limit it can do nothing about.
  //
  // Voice: Rumi speaks of herself in the feminine («سکتی ہوں»), but never conjugates the TEACHER
  // — «بتائیں» and «پوچھ لیں» are imperatives, so a mixed-gender cohort is addressed correctly.
  lp612EditOutOfScope: {
    en: 'I can change parts of a lesson I have already sent you — shorten a section, add an '
      + 'activity, swap an example. What you asked for is a different thing, so your lesson is '
      + 'unchanged. Tell me which part to change and I will do it.',
    ur: 'میں بھیجے گئے سبق کے حصے بدل سکتی ہوں — کوئی حصہ مختصر کرنا، سرگرمی شامل کرنا، مثال بدلنا۔ '
      + 'آپ نے جو مانگا وہ اس سے الگ کام ہے، اس لیے آپ کا سبق ویسا ہی ہے۔ بتائیں کون سا حصہ بدلنا ہے۔',
  },

  // The flag-off branch. It is NOT lp612EditOutOfScope: she asked for something this feature will
  // do, and telling her it is out of scope would be a lie she would reasonably repeat. It is also
  // not lp612Failed — nothing failed. Rule 24(d): distinct state, distinct sentence.
  lp612EditNotYet: {
    en: 'I cannot change a lesson yet — that is being built. Your lesson is unchanged. Ask me '
      + 'anything about it in the meantime and I will help.',
    ur: 'سبق میں تبدیلی کی سہولت ابھی دستیاب نہیں — اس پر کام ہو رہا ہے۔ آپ کا سبق ویسا ہی ہے۔ '
      + 'اس دوران سبق کے بارے میں کچھ بھی پوچھ لیں، میں مدد کروں گی۔',
  },

  // The last thing the Flow itself says, on the terminal SUCCESS screen, before
  // she closes it and goes back to the chat.
  //
  // It used to be a hardcoded English sentence in the endpoint ending "check
  // this chat in a moment" — the same two-minute optimism as the ack, in the one
  // place she reads FIRST, and English regardless of her preference. It points
  // at the chat now and deliberately quotes no duration: the screen's own static
  // body still reads "the PDF arrives in a few seconds" (true for the K-5 lane
  // it is shared with, and only changeable by republishing the Flow), so a
  // number here would argue with the line directly beneath it. The estimate
  // belongs in the chat ack, where nothing contradicts it.
  lp612FlowAck: {
    en: 'Your lesson plan is being written now — I will send it to this chat as soon as it is ready.',
    ur: 'آپ کا سبق کا منصوبہ ابھی تیار کیا جا رہا ہے — تیار ہوتے ہی اسی چیٹ میں بھیج دیا جائے گا۔',
  },

  // Sent with the PDF. {topic} is the book's own subtopic wording.
  //
  // The Urdu line wraps {subject} and {pages} in LRI…PDI (U+2066/U+2069)
  // ISOLATES, in the catalog string itself. Without them a page RANGE after an
  // Urdu word paints reversed — «صفحات 7-8» renders «8-7» — because UAX#9 W2
  // reclassifies digits after an Arabic-class letter, W4 only re-joins
  // EUROPEAN numbers across a hyphen, and N1 then orders the two halves RTL.
  // The placeholder is isolated rather than the value because the value's bidi
  // class is unknowable at authoring time (language-protocol §9 rule 8).
  lp612Caption: {
    en: '{topic}\nGrade {grade} · {subject} · pages {pages}',
    ur: '{topic}\nجماعت {grade} · ⁦{subject}⁩ · صفحات ⁦{pages}⁩',
  },

  // Appended to the Urdu caption when the document is an English-medium book
  // whose ur_overlay did not survive sanitizeOverlay: what she receives is an
  // essentially-English document in RTL chrome, and saying so beats a silent
  // fallback (rule 24(c)/(d)). English variant exists so the catalog is never
  // a partial map (language-protocol §6.3); the line itself is only ever
  // APPENDED on Urdu deliveries.
  lp612OverlayDropped: {
    en: 'This lesson is from the English textbook — instructions partly in Urdu.',
    ur: 'یہ سبق انگریزی کتاب سے ہے — ہدایات جزوی اردو میں',
  },

  // ── the 6-12 post-delivery survey (bd-86ivw) ─────────────────────────────
  //
  // The only signal the lane cannot generate for itself. Every gate in it — schema, canon lint,
  // the render page caps — measures the DOCUMENT; none of them can tell us a teacher would
  // actually teach from it. Sent once, a short while after the PDF lands, as two buttons.
  //
  // Caps, in CODE POINTS: button 20, body 1024. An emoji is one code point and roughly two
  // columns on her screen, so the button titles stay short in both languages. An over-cap title
  // is not truncated by Meta — the whole message is REJECTED (#131009) and the survey silently
  // never appears. tests/lp612/honest-eta.test.js pins all six.
  //
  // Urdu voice: Rumi speaks of herself in the feminine («سمجھ گئی»), and every verb aimed at the
  // teacher agrees with a NOUN rather than with her — «منصوبہ … رہا», «چیز … آئی» — so a
  // mixed-gender cohort is addressed correctly without stilted phrasing.
  lp612FeedbackAsk: {
    en: 'Was that lesson plan useful for your class?',
    ur: 'کیا یہ سبق کا منصوبہ آپ کی کلاس کے لیے مفید رہا؟',
  },
  lp612FeedbackYes: {
    en: '👍 Yes, useful',
    ur: '👍 جی ہاں',
  },
  lp612FeedbackNo: {
    en: '👎 Not really',
    ur: '👎 نہیں',
  },
  lp612FeedbackThanks: {
    en: 'Thanks — glad it helped.',
    ur: 'شکریہ — خوشی ہے کہ یہ مفید رہا۔',
  },
  // Only ever sent on a 👎. A thumbs-down with no reason tells us a lesson is bad and nothing
  // about which part, which is the least actionable datum the survey could collect.
  lp612FeedbackAskReason: {
    en: 'Thanks for telling us. Which part did not work? (one line is enough)',
    ur: 'بتانے کا شکریہ۔ کون سا حصہ کام نہیں آیا؟ (ایک سطر کافی ہے)',
  },
  lp612FeedbackReasonThanks: {
    en: 'Got it, thank you — this makes the next lesson better.',
    ur: 'سمجھ گئی، شکریہ — اس سے اگلا سبق بہتر ہوگا۔',
  },

  lpV8SendFailed: {
    en: "I couldn't send that lesson plan just now — please try again in a minute.",
    ur: 'ابھی یہ سبق کا منصوبہ نہیں بھیجا جا سکا — براہِ کرم ایک منٹ بعد دوبارہ کوشش کریں۔',
  },

  /**
   * Reading assessment — the welcome, and the passage-language picker's chrome.
   *
   * The welcome used to be generated by gpt-4o-mini at temperature 0.3, per
   * teacher, per session, from a prompt asking it to "write a friendly message in
   * language code X". Interface text that is non-deterministic, unreviewable and
   * billed per teacher. Now it is copy.
   *
   * The picker chrome below lands in a WhatsApp interactive list, so it is on the
   * same hard caps as the /language picker (header 60, body 1024, footer 60) and
   * is covered by tests/config/ux-strings-whatsapp-limits.test.js.
   */
  readingWelcome: {
    en: "Let's check a student's reading. It takes about 3–5 minutes. First, choose the language for the passage.",
    ur: 'آئیے ایک طالب علم کی قرائت جانچیں۔ اس میں تقریباً 3 سے 5 منٹ لگیں گے۔ پہلے اقتباس کی زبان منتخب کریں۔',
  },

  // Concurrent sessions: the teacher is assessing more than one student, so the
  // message names which one. The old prompt merely ASKED the model to mention it.
  readingWelcomeNamed: {
    en: "Let's check {student}'s reading. It takes about 3–5 minutes. First, choose the language for the passage.",
    ur: '{student} کی قرائت جانچتے ہیں۔ اس میں تقریباً 3 سے 5 منٹ لگیں گے۔ پہلے اقتباس کی زبان منتخب کریں۔',
  },

  /**
   * bd-hgwfo — the one door into the lesson-plan catalogue Flow. Every entry
   * point (bare "lp", the lesson_plan intent in text and voice, /menu, the
   * Oxbridge fallback tap) renders these three, via lp-browse-entry.service.
   * Header 60 / button 20 in CODE POINTS — this is where the copy is capped,
   * once, rather than in each caller's inline map (the bd-72dth drift).
   */
  lpBrowseHeader: {
    en: '📘 Lesson Plans',
    ur: '📘 سبق کے منصوبے',
  },

  lpBrowseBody: {
    en: "Pick your class, subject and chapter, then the day's lesson — the plan lands in your chat.",
    ur: 'اپنی جماعت، مضمون اور باب چنیں، پھر اُس دن کا سبق — منصوبہ آپ کی چیٹ میں آ جائے گا۔',
  },

  lpBrowseButton: {
    en: 'Pick Class',
    ur: 'جماعت چنیں',
  },

  readingPickerHeader: {
    en: 'Select Language',
    ur: 'زبان منتخب کریں',
  },

  readingPickerBody: {
    en: 'What language should the reading passage be in?',
    ur: 'قرائت کا اقتباس کس زبان میں ہونا چاہیے؟',
  },

  // Was English-only, like the /language footer before it was fixed.
  readingPickerFooter: {
    en: 'Reading assessment · قرائت کا جائزہ',
    ur: 'قرائت کا جائزہ · Reading assessment',
  },

  // Returned when the writer rejects a language, i.e. a stale client replayed a
  // row for a language this deployment no longer offers.
  languageNotAvailable: {
    en: 'That language is not available. Please choose from the list.',
    ur: 'یہ زبان دستیاب نہیں ہے۔ براہ کرم فہرست میں سے منتخب کریں۔',
  },

  /**
   * Picking a task back up.
   *
   * Every feature's previous answer to "she stopped halfway" was to tell her to
   * start over — the same instruction repeated across the menu, reading, training,
   * quizzes and exam marking. This is the copy that replaces it: we say what she
   * left, and offer to carry on.
   *
   * `{task}` is a teacher-facing task name, never an internal flow id — a teacher
   * should read "lesson plan", not "lesson_plan".
   */
  resumeOfferBody: {
    en: 'Earlier you started a {task} but we did not finish. Shall we pick up where you left off?',
    ur: 'آپ نے پہلے {task} شروع کیا تھا مگر ہم مکمل نہیں کر سکے۔ کیا وہیں سے جاری رکھیں؟',
  },

  /**
   * Button labels. HARD 20-CHARACTER CAP, counted in code points — Urdu counts
   * differently than `.length` suggests, and the sender silently truncates rather
   * than failing, so an over-long label ships as a mangled word instead of an
   * error. Guarded in tests/conversation-state/resume-offer.test.js.
   */
  resumeYesLabel: {
    en: 'Pick up',
    ur: 'جاری رکھیں',
  },

  resumeNoLabel: {
    en: 'Start fresh',
    ur: 'نیا شروع کریں',
  },

  /**
   * Restoring the step is not enough on its own. Caught in review: this used to say
   * only "carrying on with your reading assessment", which leaves her holding a
   * restored state and no idea what to send — and for a step that wants a voice note
   * rather than text, guessing wrong means nothing matches and she is stuck again.
   *
   * So the confirmation carries the ask. `{next}` is the per-step instruction, which
   * makes the message useful rather than merely polite.
   */
  resumeRestored: {
    en: 'Good — carrying on with your {task}. {next}',
    ur: 'بہت خوب — آپ کا {task} جاری ہے۔ {next}',
  },

  resumeDiscarded: {
    en: 'No problem, that one is closed. Send /menu whenever you want something else.',
    ur: 'کوئی مسئلہ نہیں، وہ بند کر دیا۔ کچھ اور چاہیں تو /menu بھیجیں۔',
  },

  // The offer arrived, she tapped, but the task had already been cleared in the
  // meantime. Says so plainly rather than pretending to resume nothing.
  resumeGone: {
    en: 'That one has already been closed. Send /menu to start something new.',
    ur: 'وہ پہلے ہی بند ہو چکا ہے۔ نیا کام شروع کرنے کے لیے /menu بھیجیں۔',
  },

  /**
   * bd-2712 — the /remark Supervisor Remark FLOW (docs/flows/remark-flow.json).
   *
   * These live here rather than beside the rubric because they are Flow CHROME,
   * not rubric content: the indicator names and the four anchor descriptions stay
   * in remark-rubric.js, which is the published contract STEPS reads. Splitting it
   * that way means a rubric revision never touches button copy and vice versa.
   *
   * The old remark-screens.js strings could not be reused: they are chat-shaped
   * ("Reply with 1, 2, 3 or 4", "Reply *submit* to confirm") and instruct the
   * principal to type at a form she taps.
   *
   * Length budgets that apply here (measured in CODE POINTS, not .length):
   *   remarkLevelLabel / remarkPickerLabel — Dropdown labels, kept ≤ 20
   *   remarkContinue / remarkSubmit        — Footer labels, kept short
   * The indicator TextBody lines are body text (1024) and are safe.
   */
  remarkPickHeading: {
    en: 'Which teacher?',
    ur: 'کون سی استاد؟',
  },

  remarkPickHint: {
    en: '{count} still to evaluate this quarter.',
    ur: 'اس سہ ماہی میں {count} باقی ہیں۔',
  },

  remarkPickerLabel: {
    en: 'Teacher',
    ur: 'استاد',
  },

  // The roster hint replaces remarkPickHint: she is reading a full list now, so
  // "how far am I?" is the useful sentence, not "how many are left".
  remarkRosterHint: {
    en: '{done} of {total} evaluated this quarter.',
    ur: 'اس سہ ماہی میں {total} میں سے {done} مکمل۔',
  },

  remarkStateDone: {
    en: 'Evaluated',
    ur: 'مکمل',
  },

  remarkStateInProgress: {
    en: 'In progress',
    ur: 'جاری',
  },

  remarkStateNotStarted: {
    en: 'Not started',
    ur: 'باقی',
  },

  remarkNoTeachers: {
    en: 'No teachers are listed at your school yet.',
    ur: 'آپ کے سکول میں ابھی کوئی استاد درج نہیں۔',
  },

  remarkSummaryOverall: {
    en: 'Overall: {pct}',
    ur: 'مجموعی: {pct}',
  },

  remarkSummaryDone: {
    en: 'Done',
    ur: 'مکمل',
  },

  remarkContinue: {
    en: 'Continue',
    ur: 'آگے بڑھیں',
  },

  remarkRubricHeading: {
    en: 'Rate all five',
    ur: 'پانچوں شعبے',
  },

  remarkLevelLabel: {
    en: 'Level',
    ur: 'درجہ',
  },

  /**
   * TextArea LABEL — cap 20 code points, and labels clip silently rather than
   * erroring.
   *
   * Says NOTHING about being optional: Meta appends its own "(Optional)" to any
   * field with `required: false`, so "Comment (optional)" renders to the
   * principal as "Comment (optional) (Optional)". Exactly the defect recorded
   * against the old attendance flow ("Section (optional) (Optional)", bd-2532).
   * The Flow JSON is the single source of the optionality signal; the label is
   * just the noun.
   */
  remarkCommentLabel: {
    en: 'Comment',
    ur: 'رائے',
  },

  remarkSubmit: {
    en: 'Submit',
    ur: 'جمع کریں',
  },

  // Shown on the Flow's terminal screen. Deliberately does NOT quote a score:
  // the principal keeps the numbers, the teacher gets a narrative with none, and
  // this screen is the handover point between the two.
  remarkFlowSuccess: {
    en: 'Saved. {teacher} will get her coaching note shortly.',
    ur: '{teacher} کو ان کا کوچنگ نوٹ جلد مل جائے گا۔ محفوظ ہو گیا۔',
  },

  // The chat message after the Flow closes (whatsapp-flows rule 11 — never bounce
  // her to "Type /menu"). {left} is the remaining-teachers nudge.
  remarkAckSubmitted: {
    en: 'Saved — {teacher} is done. {left}',
    ur: 'محفوظ ہو گیا — {teacher} مکمل۔ {left}',
  },

  // The post-submit follow-up. ONE button, not two: the principal is done unless
  // she says otherwise, so "move on" must not require a tap. Anything that is not
  // this button — a reply, another command, silence — simply falls through to
  // normal chat. Button title cap is 20 CODE POINTS, the tightest field there is.
  remarkAnotherPrompt: {
    en: 'Grade another teacher?',
    ur: 'کسی اور استاد کا جائزہ لیں؟',
  },

  remarkAnotherButton: {
    en: 'Grade another',
    ur: 'اگلی استاد',
  },

  remarkAckAllDone: {
    en: 'That is every teacher in your school for this quarter.',
    ur: 'اس سہ ماہی کے لیے آپ کے اسکول کی تمام اساتذہ مکمل ہو گئیں۔',
  },

  // The chat message that CARRIES the Flow CTA. Header 60 / button 20 code
  // points — the button is the tightest field in WhatsApp and 20 is 3–4 Urdu
  // words, so it stays a verb phrase, not a sentence.
  remarkFlowHeader: {
    en: 'Teacher Evaluation',
    ur: 'اساتذہ کا جائزہ',
  },

  remarkFlowBody: {
    en: '{cycle} is open. Rate each teacher on the five STEPS indicators — it takes a couple of minutes each.',
    ur: '{cycle} جاری ہے۔ ہر استاد کو پانچ STEPS شعبوں پر پرکھیں — ہر ایک میں دو منٹ لگتے ہیں۔',
  },

  remarkFlowButton: {
    en: 'Start',
    ur: 'شروع کریں',
  },

  // A \u200F (RIGHT-TO-LEFT MARK) opens any Urdu string whose first strong
  // character could be Latin — an English topic placeholder, a name, an
  // emoji-then-English opener. WhatsApp lays a message out from its first
  // strong character, so without the mark such a message renders left-to-
  // right and reads scrambled. Enforced by tests/quiz/transcript-quiz-strings.
  // ─── transcript quiz (teacher side) ──────────────────────────────────────
  // The post-coaching quiz offer, the hand-off, /quiz. Every string here is
  // gender-neutral in Urdu by construction (imperatives, impersonal
  // constructions, passives) because the teacher's gender is unknown and the
  // cohort is mixed. English technical terms (quiz, link, PDF, WhatsApp,
  // forward, group) stay in English inside Urdu, as teachers write them.
  tqOffer: {
    en: 'From today’s lesson on *{topic}* ({date}) I can make a short 8-question quiz your students take on WhatsApp — it checks what they learnt, and you get a report on what to reteach.\n\nWant it?\n\nYou can make one for any lesson anytime by sending /quiz.',
    ur: 'آج کے سبق *{topic}* ({date}) سے طلبہ کے لیے 8 سوالوں کا مختصر quiz تیار ہو سکتا ہے — طلبہ اسے WhatsApp پر حل کریں، اور آپ کو رپورٹ ملے کہ کیا سمجھ آیا اور کیا دوبارہ پڑھانا ہے۔\n\nبنا دیں؟\n\nکسی بھی سبق کا quiz کبھی بھی /quiz بھیج کر بنایا جا سکتا ہے۔',
  },
  tqOfferYes: { en: 'Yes, make it', ur: 'جی، بنائیں' },
  tqOfferNo: { en: 'Not now', ur: 'ابھی نہیں' },
  tqDeclined: {
    en: 'No problem. You can make a quiz for any of your lessons anytime — just send /quiz.',
    ur: 'کوئی بات نہیں۔ کسی بھی سبق کا quiz کبھی بھی بنایا جا سکتا ہے — بس /quiz بھیجیں۔',
  },
  tqOfferExpired: {
    en: 'That offer is no longer available — send /quiz to make a quiz for any lesson.',
    ur: 'وہ پیشکش اب دستیاب نہیں — کسی بھی سبق کا quiz بنانے کے لیے /quiz بھیجیں۔',
  },
  tqMaking: {
    en: 'Making it now — about a minute. The quiz will arrive here with the message to forward.',
    ur: 'آپ کا quiz تیار ہو رہا ہے — تقریباً ایک منٹ۔ پھر یہیں quiz اور آگے بھیجنے والا پیغام آئے گا۔',
  },
  tqAlreadyMaking: {
    en: 'Already on it — the quiz is coming.',
    ur: 'پہلے ہی تیار ہو رہا ہے — بس آ رہا ہے۔',
  },
  tqAlreadySent: {
    en: 'That quiz has already been sent — send /quiz to resend its link or get the report.',
    ur: 'وہ quiz پہلے ہی بھیجا جا چکا ہے — link دوبارہ لینے یا رپورٹ کے لیے /quiz بھیجیں۔',
  },
  tqStillMaking: {
    en: 'That quiz is still being made — it will arrive here shortly.',
    ur: 'وہ quiz ابھی تیار ہو رہا ہے — تھوڑی دیر میں یہیں آئے گا۔',
  },
  tqCouldNotMake: {
    en: 'I couldn’t make a good quiz from this lesson’s recording — the transcript didn’t carry enough of what was taught clearly. Try /quiz after your next lesson.',
    ur: 'اس سبق کی ریکارڈنگ سے اچھا quiz نہیں بن سکا — transcript میں پڑھایا ہوا مواد کافی واضح نہیں تھا۔ اگلے سبق کے بعد /quiz آزمائیں۔',
  },
  tqCouldNotSend: {
    en: 'The quiz is ready but the class link could not be created just now. Send /quiz in a moment to get it.',
    ur: 'آپ کا quiz تیار ہے لیکن کلاس کا link ابھی نہیں بن سکا۔ تھوڑی دیر بعد /quiz بھیج کر حاصل کریں۔',
  },
  tqHandoffIntro: {
    en: '📝 Your quiz on *{topic}* — {n} questions.\n\nThis PDF is for you: each question, why it is asked, what each wrong answer reveals, and what students are told.\n\nThe NEXT message is for your students — forward it to the class group.',
    ur: '\u200F📝 آپ کا quiz — *{topic}* — {n} سوالات۔\n\nیہ PDF آپ کے لیے ہے: ہر سوال، اس کی وجہ، ہر غلط جواب کیا ظاہر کرتا ہے، اور طلبہ کو کیا بتایا جائے گا۔\n\nاگلا پیغام طلبہ کے لیے ہے — اسے class group میں forward کریں۔',
  },
  tqForwardThis: {
    en: 'Forward THIS message to your students:',
    ur: 'یہ پیغام طلبہ کو forward کریں:',
  },
  // Read by CHILDREN, in the quiz language. Names the teacher, the topic and
  // the date of the lesson, and carries the link. Never a phone number.
  tqStudentMessage: {
    en: '📚 *Quiz time!*\n\n{teacher} has sent you a quiz on *{topic}* — what we studied on {date}.\n\nTap here to start:\n{link}\n\nIt takes about 5 minutes. You will be asked your name and class first.',
    ur: '\u200F📚 *Quiz کا وقت!*\n\n{teacher} نے آپ کو *{topic}* پر quiz بھیجا ہے — جو ہم نے {date} کو پڑھا۔\n\nشروع کرنے کے لیے یہاں tap کریں:\n{link}\n\nتقریباً 5 منٹ لگیں گے۔ پہلے آپ کا نام اور جماعت پوچھی جائے گی۔',
  },
  tqReportPromise: {
    en: 'You will get a report on how the class did about 12 hours after the first student starts — or sooner if everyone finishes. Send /quiz anytime to see your quizzes or fetch a report.',
    ur: 'پہلے طالب علم کے شروع کرنے کے تقریباً 12 گھنٹے بعد — یا سب کے مکمل کرتے ہی — رپورٹ آئے گی۔ اپنے quizzes دیکھنے یا رپورٹ منگوانے کے لیے کبھی بھی /quiz بھیجیں۔',
  },
  tqListBody: {
    en: 'Your recent lessons. Pick one to make a quiz, resend its link, or get its report.',
    ur: 'آپ کے حالیہ اسباق۔ کوئی ایک چنیں — quiz بنانے، link دوبارہ بھیجنے یا رپورٹ لینے کے لیے۔',
  },
  tqListButton: { en: 'Choose lesson', ur: 'سبق چنیں' },
  tqListSection: { en: 'Recent lessons', ur: 'حالیہ اسباق' },
  tqListEmpty: {
    en: 'No lessons yet. Record a lesson for coaching first — then /quiz can turn it into a quiz for your students.',
    ur: 'ابھی کوئی سبق نہیں۔ پہلے coaching کے لیے سبق ریکارڈ کریں — پھر /quiz اسے طلبہ کے لیے quiz بنا دے گا۔',
  },
  tqRowNoQuiz: { en: 'No quiz yet — tap to make one', ur: 'ابھی quiz نہیں — بنانے کے لیے tap کریں' },
  tqRowOffered: { en: 'Offered — tap to make it', ur: 'پیشکش کی گئی — بنانے کے لیے tap کریں' },
  tqRowMaking: { en: 'Being made…', ur: 'تیار ہو رہا ہے…' },
  tqRowSent: { en: 'Sent · {started} started · {finished} finished', ur: 'بھیجا گیا · {started} نے شروع کیا · {finished} مکمل' },
  tqRowReportSent: { en: 'Report sent · {finished} finished', ur: 'رپورٹ بھیج دی گئی · {finished} مکمل' },
  tqRowFailed: { en: 'Could not be made — tap to retry', ur: 'نہیں بن سکا — دوبارہ کوشش کے لیے tap کریں' },
  tqQuizStatus: {
    en: '*{topic}*\n{started} started · {finished} finished.\n\nResend the link, or get the report now?',
    ur: '\u200F*{topic}*\n{started} نے شروع کیا · {finished} مکمل۔\n\nlink دوبارہ بھیجیں، یا ابھی رپورٹ لیں؟',
  },
  tqLinkButton: { en: 'Resend link', ur: 'دوبارہ link بھیجیں' },
  tqReportButton: { en: 'Report now', ur: 'رپورٹ ابھی' },
  tqNoReportYet: {
    en: 'No one has finished this quiz yet, so there is nothing to report. Resend the link?',
    ur: 'ابھی کسی نے یہ quiz مکمل نہیں کیا، اس لیے رپورٹ کے لیے کچھ نہیں۔ link دوبارہ بھیجیں؟',
  },
  tqReportComing: { en: 'Preparing the report now…', ur: 'رپورٹ تیار ہو رہی ہے…' },
  tqNotYours: {
    en: 'I couldn’t find that lesson. Send /quiz to see your lessons.',
    ur: 'وہ سبق نہیں ملا۔ اپنے اسباق دیکھنے کے لیے /quiz بھیجیں۔',
  },
  tqYourTeacher: { en: 'Your teacher', ur: 'آپ کے استاد' },
  tqTeacherNamed: { en: 'Teacher {name}', ur: 'استاد {name}' },
  tqTodaysLesson: { en: 'today’s lesson', ur: 'آج کا سبق' },
  tqLessonWord: { en: 'Lesson', ur: 'سبق' },
  tqNudge: {
    en: '{started} student(s) have started your quiz on *{topic}* so far. Worth forwarding the link to the class group again?',
    ur: '\u200F*{topic}* پر آپ کے quiz کو اب تک {started} طلبہ نے شروع کیا ہے۔ link دوبارہ class group میں forward کر دیں؟',
  },

  // ─── quiz chrome read by CHILDREN, in the quiz language ─────────────────
  // The share-link chain was English-only; a child taking an Urdu quiz now
  // reads Urdu around the questions too. A child is "آپ" with respectful
  // plural verbs — never a gendered guess.
  vqGreeting: {
    en: '👋 Assalam o Alaikum!\n\n*{teacher}* has sent you a quiz on *{topic}*.',
    ur: '\u200F👋 السلام علیکم!\n\n*{teacher}* نے آپ کو *{topic}* پر quiz بھیجا ہے۔',
  },
  vqWelcomeBack: {
    en: 'Good to see you again, {name} — let’s begin!',
    ur: '\u200F{name}، آپ کو دوبارہ دیکھ کر خوشی ہوئی — چلیں شروع کریں!',
  },
  vqWhoIsTaking: {
    en: 'Who is taking it today?\n\n{names}\n{n}. Someone else\n\nReply with the number.',
    ur: 'آج کون quiz دے رہا ہے؟\n\n{names}\n{n}. کوئی اور\n\nنمبر لکھ کر جواب دیں۔',
  },
  vqReplyNumber: {
    en: 'Please reply with just the number — 1 to {n}.',
    ur: 'براہِ کرم صرف نمبر لکھیں — 1 سے {n} تک۔',
  },
  vqAskName: { en: 'First — what is your name?', ur: 'پہلے — آپ کا نام کیا ہے؟' },
  vqAskNameAgain: { en: 'No problem — what is your name?', ur: 'کوئی بات نہیں — آپ کا نام کیا ہے؟' },
  vqAskNameMissed: {
    en: 'I didn’t catch your name — what should I call you?',
    ur: 'نام سمجھ نہیں آیا — آپ کو کیا کہہ کر پکاریں؟',
  },
  vqAskClass: {
    en: 'Thanks {name}! And which class are you in? (for example: Grade 4)',
    ur: 'شکریہ {name}! آپ کس جماعت میں ہیں؟ (مثلاً: جماعت 4)',
  },
  vqLetsBegin: { en: 'Great — {who}. Let’s begin!', ur: 'بہت خوب — {who}۔ چلیں شروع کریں!' },
  vqLetsBeginName: { en: 'Let’s begin, {name}!', ur: '\u200F{name}، چلیں شروع کریں!' },
  vqExpired: {
    en: 'That quiz link has expired. Ask your teacher for a new one!',
    ur: 'یہ quiz link ختم ہو چکا ہے۔ اپنے استاد سے نیا link لیں!',
  },
  vqHereWeGo: { en: 'Here we go — {n} questions. Take your time!', ur: 'چلیں — {n} سوال ہیں۔ آرام سے کریں!' },
  vqQuestionOf: { en: '*Question {i} of {n}*', ur: '*سوال {i} از {n}*' },
  vqChooseAnswer: { en: 'Choose answer', ur: 'جواب چنیں' },
  vqOptions: { en: 'Options', ur: 'جوابات' },
  vqDoneFallback: {
    en: '🎉 All done!\n\nYou got *{correct} out of {total}* right ({pct}%).\n\n{tier}',
    ur: '🎉 مکمل!\n\nآپ نے *{total} میں سے {correct}* صحیح کیے ({pct}%)۔\n\n{tier}',
  },
  vqScoreCaption: {
    en: '🎉 All done!\n\nYou got *{correct} out of {total}* right ({pct}%). You’ve earned {stars} {starWord}!\n\n{tier}',
    ur: '🎉 مکمل!\n\nآپ نے *{total} میں سے {correct}* صحیح کیے ({pct}%)۔ آپ کو {stars} {starWord} ملے!\n\n{tier}',
  },
  vqTierMastered: { en: 'Brilliant work!', ur: 'زبردست!' },
  vqTierDeveloping: {
    en: 'Nicely done — a little more practice and you’ll have it.',
    ur: 'بہت اچھا — تھوڑی اور مشق سے یہ پکا ہو جائے گا۔',
  },
  vqTierNeedsPractice: {
    en: 'Good effort — this one is worth another go.',
    ur: 'اچھی کوشش — یہ دوبارہ کرنے کے قابل ہے۔',
  },
  vqTrouble: {
    en: 'We’re having trouble sending more questions right now — here’s how you did on the ones you got!',
    ur: 'ابھی مزید سوال بھیجنے میں مسئلہ ہو رہا ہے — جو سوال ملے، ان کا نتیجہ یہ رہا!',
  },
  vqNoQuestions: {
    en: 'Sorry — I couldn’t load that quiz just now. Please try again later.',
    ur: 'معذرت — ابھی یہ quiz لوڈ نہیں ہو سکا۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔',
  },
  vqInviteAsk: {
    en: 'Want to send this quiz to a friend?\n\nI’ll tell you how they did once they finish.',
    ur: 'یہ quiz کسی دوست کو بھیجیں؟\n\nجب وہ مکمل کر لیں تو آپ کو بتایا جائے گا کہ انہوں نے کیسا کیا۔',
  },
  vqInviteYes: { en: 'Invite a friend', ur: 'دوست کو بھیجیں' },
  vqInviteNo: { en: 'No thanks', ur: 'نہیں، شکریہ' },
};

/**
 * Class-manager Flow copy.
 *
 * Every teacher-facing string in that Flow is supplied by the endpoint as screen
 * DATA (`${data.heading}` and friends) rather than hardcoded into the Flow JSON.
 * The existing Flows in this repo hardcode English, which is fine for a
 * single-language deployment and wrong for this one — a Flow asset is per-WABA and
 * cannot be re-rendered per teacher, so the only way an Urdu-preferring teacher
 * sees Urdu is if the endpoint sends it.
 *
 * Caps that apply here: a Flow Footer label is 35 code points, a screen heading is
 * generous, and a TextBody is 1024. The tightest of these is the footer, so all
 * button-ish keys below stay well inside it.
 */
const CLASS_FLOW_STRINGS = {
  classesHeading: {
    en: 'Your classes',
    ur: 'آپ کی جماعتیں',
  },
  classesEmpty: {
    en: 'You have not added a class yet.',
    ur: 'آپ نے ابھی کوئی جماعت شامل نہیں کی۔',
  },
  classesAdd: {
    en: 'Add a class',
    ur: 'نئی جماعت شامل کریں',
  },
  classAddHeading: {
    en: 'Which class is this?',
    ur: 'یہ کون سی جماعت ہے؟',
  },
  classGradeLabel: {
    en: 'Class',
    ur: 'جماعت',
  },
  classSectionLabel: {
    en: 'Section',
    ur: 'سیکشن',
  },
  classSectionHelper: {
    en: 'Only if your school splits this class',
    ur: 'صرف اگر آپ کے اسکول میں سیکشن ہیں',
  },
  classNext: {
    en: 'Next',
    ur: 'آگے',
  },
  classShiftLabel: {
    en: 'Shift',
    ur: 'شفٹ',
  },
  // Sections are a closed set (A-E). The helper text is where a teacher learns
  // what to do when hers is not listed, so it names the route rather than leaving
  // her to guess.
  classSectionHelperClosed: {
    en: 'Not listed? Ask NIETE support to add it.',
    ur: 'آپ کا سیکشن موجود نہیں؟ نیٹ سپورٹ سے شامل کروائیں۔',
  },
  // Said on the SAVED screen when the class was saved but a claim was declined.
  // Both are additive: the class IS saved, so the copy must not read as a failure.
  classSavedRoleTaken: {
    en: 'Saved. Someone else is already the class teacher for this class.',
    ur: 'محفوظ ہو گیا۔ اس جماعت کے کلاس ٹیچر پہلے سے کوئی اور ہیں۔',
  },
  classSavedSubjectsTaken: {
    en: 'Saved. Another teacher already teaches {subjects} to this class.',
    ur: 'محفوظ ہو گیا۔ {subjects} اس جماعت کو پہلے سے کوئی اور پڑھاتے ہیں۔',
  },
  classSubjectsHeading: {
    en: 'What do you teach in {class}?',
    ur: '{class} میں آپ کیا پڑھاتے ہیں؟',
  },
  classSubjectsLabel: {
    en: 'Subjects',
    ur: 'مضامین',
  },
  classTeacherOptIn: {
    en: 'I am the class teacher',
    ur: 'میں اس جماعت کا انچارج ہوں',
  },
  classSave: {
    en: 'Save',
    ur: 'محفوظ کریں',
  },
  classSavedHeading: {
    en: 'Class saved',
    ur: 'جماعت محفوظ ہو گئی',
  },
  classSavedDetail: {
    en: '{class}, {session}.',
    ur: '{class}، {session}۔',
  },
  classDone: {
    en: 'Done',
    ur: 'مکمل',
  },
  // The chat message that carries the Flow. Caps here are the tight ones:
  // header 60, body 1024, and the button 20 — the button is 3–4 Urdu words.
  // The class chooser on the entry screen, and the roster screens behind it.
  classChooseLabel: {
    en: 'Which class?',
    ur: 'کون سی جماعت؟',
  },
  classAddNewOption: {
    en: 'Add a new class',
    ur: 'نئی جماعت شامل کریں',
  },
  classEditHint: {
    en: 'Tick anyone leaving, and paste any new names below. '
      + 'Every teacher on this class stops seeing a removed student; their attendance record is kept.',
    ur: 'جو طلبہ جماعت چھوڑ رہے ہیں انہیں منتخب کریں، اور نئے نام نیچے لکھیں۔ '
      + 'نکالے گئے طالب علم اس جماعت کے تمام اساتذہ کو نظر آنا بند ہو جائیں گے؛ حاضری کا ریکارڈ محفوظ رہے گا۔',
  },
  classEditHintCapped: {
    en: 'Showing the first {shown} to remove, and paste any new names below. '
      + 'Every teacher on this class stops seeing a removed student; their attendance record is kept.',
    ur: 'نکالنے کے لیے پہلے {shown} دکھائے جا رہے ہیں، اور نئے نام نیچے لکھیں۔ '
      + 'نکالے گئے طالب علم اس جماعت کے تمام اساتذہ کو نظر آنا بند ہو جائیں گے؛ حاضری کا ریکارڈ محفوظ رہے گا۔',
  },
  classRemoveField: {
    en: 'Remove from this class',
    ur: 'اس جماعت سے نکالیں',
  },
  classAddField: {
    en: 'Add students',
    ur: 'طلبہ شامل کریں',
  },
  classSaveChanges: {
    en: 'Save changes',
    ur: 'تبدیلیاں محفوظ کریں',
  },
  classNoChanges: {
    en: 'Nothing changed for {class}.',
    ur: '{class} میں کوئی تبدیلی نہیں ہوئی۔',
  },
  classRosterAction: {
    en: 'What would you like to do?',
    ur: 'آپ کیا کرنا چاہتے ہیں؟',
  },
  classRosterAddOption: {
    en: 'Add students',
    ur: 'طلبہ شامل کریں',
  },
  classRosterRemoveOption: {
    en: 'Remove students',
    ur: 'طلبہ کو نکالیں',
  },
  classRosterEmpty: {
    en: 'No students yet.',
    ur: 'ابھی کوئی طالب علم نہیں۔',
  },
  classAddStudentsHeading: {
    en: 'Add students to {class}',
    ur: '{class} میں طلبہ شامل کریں',
  },
  classAddStudentsHint: {
    en: 'One name per line. Father\'s name after a comma or "s/o" if you have it. Numbering is fine.',
    ur: 'ہر سطر پر ایک نام۔ والد کا نام کوما یا "s/o" کے بعد لکھیں۔ نمبر لگانا ٹھیک ہے۔',
  },
  classStudentsField: {
    en: 'Student names',
    ur: 'طلبہ کے نام',
  },
  classAddToClass: {
    en: 'Add to class',
    ur: 'جماعت میں شامل کریں',
  },
  classRemoveHeading: {
    en: 'Who has left {class}?',
    ur: '{class} سے کون جا چکے ہیں؟',
  },
  // Said before the removal, not after: the roster is shared, so this affects
  // colleagues, and the attendance record is kept either way.
  classRemoveHint: {
    en: 'Every teacher on this class stops seeing them. Their attendance record is kept.',
    ur: 'اس جماعت کے تمام اساتذہ کو یہ نظر آنا بند ہو جائیں گے۔ ان کی حاضری کا ریکارڈ محفوظ رہے گا۔',
  },
  classRemoveButton: {
    en: 'Remove',
    ur: 'نکالیں',
  },
  classStudentsAdded: {
    en: '{added} added to {class}.',
    ur: '{class} میں {added} شامل ہو گئے۔',
  },
  classStudentsDuplicates: {
    en: '{duplicates} were already on the roster.',
    ur: '{duplicates} پہلے سے فہرست میں تھے۔',
  },
  classStudentsDropped: {
    en: '{dropped} over the limit were not added.',
    ur: 'حد سے زیادہ {dropped} شامل نہیں ہوئے۔',
  },
  classStudentsRemoved: {
    en: '{removed} removed from {class}.',
    ur: '{class} سے {removed} کو نکال دیا گیا۔',
  },
  classFlowHeader: {
    en: 'Your classes',
    ur: 'آپ کی جماعتیں',
  },
  classFlowBody: {
    en: 'See the classes you teach, or add a new one.',
    ur: 'آپ جو جماعتیں پڑھاتے ہیں وہ دیکھیں، یا نئی شامل کریں۔',
  },
  classFlowButton: {
    en: 'Open classes',
    ur: 'جماعتیں کھولیں',
  },
  // Sent in CHAT, never as a Flow screen. A teacher with no school on file cannot
  // have a class created (classes.school_id is NOT NULL), and opening a Flow that
  // cannot succeed is the dead-end pattern that has bitten this deployment before.
  classNoSchool: {
    en: 'I do not know which school you are at yet, so I cannot add a class. Ask your coach to link your school, then try again.',
    ur: 'مجھے ابھی معلوم نہیں کہ آپ کس اسکول میں ہیں، اس لیے میں جماعت شامل نہیں کر سکتا۔ اپنے کوچ سے اسکول منسلک کروائیں، پھر دوبارہ کوشش کریں۔',
  },
};

// Folded into the one catalog so resolveUx() is still the single lookup — the
// block above is kept separate only so this Flow's copy reads as a unit.
Object.assign(UX_STRINGS, CLASS_FLOW_STRINGS);

/**
 * Grade and subject display labels, keyed by the canonical codes in the
 * `grade_levels` and `subjects` reference tables.
 *
 * WHY THESE LIVE HERE AND NOT IN THE DATABASE. The tables hold identity and
 * structure — code, ordinal, band, aliases — and no copy. Two reasons, both
 * learned the hard way:
 *
 *   1. Field caps are an outage class, and the cap audit measures SOURCE. A label
 *      stored in a database column is invisible to it, so nothing would have
 *      caught an over-cap grade name before Meta rejected the message.
 *   2. Choosing `name_ur` over `name_en` at render time is a second clamp
 *      implementation, which is the exact structural defect the catalog exists to
 *      remove.
 *
 * Same pattern as languageLabelFor below: derived copy stays next to the one
 * clamp. A conformance test asserts these key sets equal the seeded codes, so a
 * subject added to the seed and not here fails the build rather than rendering a
 * blank picker row.
 *
 * Urdu grade names use the standard جماعت + ordinal form (اول، دوم، سوم …) rather
 * than transliterated digits, which is how the grades are named in Pakistani
 * classrooms. Every label is inside the 20-code-point button cap, the tightest
 * teacher-facing field, so these are safe in buttons, list rows and dropdowns
 * alike.
 */
const GRADE_LABELS = {
  early_years: { en: 'Early Years (KG)', ur: 'ابتدائی سال' },
  grade_1:     { en: 'Grade 1',  ur: 'جماعت اول' },
  grade_2:     { en: 'Grade 2',  ur: 'جماعت دوم' },
  grade_3:     { en: 'Grade 3',  ur: 'جماعت سوم' },
  grade_4:     { en: 'Grade 4',  ur: 'جماعت چہارم' },
  grade_5:     { en: 'Grade 5',  ur: 'جماعت پنجم' },
  grade_6:     { en: 'Grade 6',  ur: 'جماعت ششم' },
  grade_7:     { en: 'Grade 7',  ur: 'جماعت ہفتم' },
  grade_8:     { en: 'Grade 8',  ur: 'جماعت ہشتم' },
  grade_9:     { en: 'Grade 9',  ur: 'جماعت نہم' },
  grade_10:    { en: 'Grade 10', ur: 'جماعت دہم' },
  grade_11:    { en: 'Grade 11', ur: 'جماعت یازدہم' },
  grade_12:    { en: 'Grade 12', ur: 'جماعت دوازدہم' },
};

const SHIFT_LABELS = {
  morning: { en: 'Morning', ur: 'صبح' },
  evening: { en: 'Evening', ur: 'شام' },
};

/**
 * Sections render as their own code — "A" is "A" in both languages, so a label map
 * would be two identical strings and a drift risk for no gain. Deliberate absence,
 * not an omission.
 */

const SUBJECT_LABELS = {
  urdu:              { en: 'Urdu',              ur: 'اردو' },
  english:           { en: 'English',           ur: 'انگریزی' },
  maths:             { en: 'Mathematics',       ur: 'ریاضی' },
  science:           { en: 'General Science',   ur: 'سائنس' },
  social_studies:    { en: 'Social Studies',    ur: 'معاشرتی علوم' },
  general_knowledge: { en: 'General Knowledge', ur: 'عمومی معلومات' },
};

/**
 * Look up a label from one of the maps above.
 *
 * @param {object} map
 * @param {string} code canonical reference-table code
 * @param {object|string} [who] a users row, or a bare language code
 * @returns {string|null} null for an unknown code — a caller that can skip the
 *          row is better than a picker rendering an empty one.
 */
function labelFrom(map, code, who) {
  const variants = map[code];
  if (!variants) return null;
  const lang = clampLanguage(typeof who === 'string' ? who : who?.preferred_language);
  return variants[lang] ?? variants[FLOOR];
}

/** @see labelFrom */
function gradeLabelFor(code, who) {
  return labelFrom(GRADE_LABELS, code, who);
}

/** @see labelFrom */
function subjectLabelFor(code, who) {
  return labelFrom(SUBJECT_LABELS, code, who);
}

/** @see labelFrom */
function shiftLabelFor(code, who) {
  return labelFrom(SHIFT_LABELS, code, who);
}

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Resolve one catalog key for one teacher.
 *
 * Throws on an unknown key or a missing parameter. That is deliberate: the
 * alternative — the empty string, or the literal `{language}` — reaches a
 * teacher silently and nothing downstream notices. A throw surfaces in test.
 *
 * @param {string} key
 * @param {object} opts
 * @param {object} [opts.user] a users row; preferred_language is read from it
 * @param {string} [opts.language] explicit language, wins over user
 * @param {object} [opts.params] values for {placeholders}
 */
function resolveUx(key, { user, language, params } = {}) {
  const variants = UX_STRINGS[key];
  if (!variants) {
    throw new Error(`resolveUx: unknown string key "${key}"`);
  }

  const lang = clampLanguage(language || user?.preferred_language);
  const template = variants[lang] ?? variants[FLOOR];

  return template.replace(PLACEHOLDER, (_, name) => {
    const value = params?.[name];
    if (value === undefined || value === null) {
      throw new Error(`resolveUx: missing param "${name}" for key "${key}"`);
    }
    return String(value);
  });
}

/**
 * The label for a language, in the reader's own language — for use inside
 * settingsDetails. Derived from the registry so it cannot drift from the picker.
 */
function languageLabelFor(code) {
  const row = getLanguage(clampLanguage(code));
  return row ? row.languageDescription : 'English';
}

module.exports = {
  UX_STRINGS,
  resolveUx,
  clampLanguage,
  languageLabelFor,
  GRADE_LABELS,
  SUBJECT_LABELS,
  SHIFT_LABELS,
  gradeLabelFor,
  subjectLabelFor,
  shiftLabelFor,
  FLOOR,
};
