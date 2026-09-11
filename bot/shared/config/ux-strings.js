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
/**
 * THE ONE PLACE THE LESSON-PLAN WAIT IS QUOTED — bd-oak77.10.
 *
 * Measured 2026-09-06 on the configuration production actually runs
 * (`LP612_AUTHOR_ROUNDS=3`, `LP612_TARGETED_REVISION=true`):
 *
 *     p50  160 s  English
 *     p50  207 s  Urdu
 *     p90  ~308 s
 *
 * The band QUOTES THE TAIL, not the median, and that is deliberate. A teacher told the median is
 * told a number she misses half the time, and the half she misses is the half that decides the
 * feature is broken. Five minutes covers p90 with room; three is the floor a real first hit lands
 * near. `tests/lp612/honest-eta.test.js` pins both ends against these numbers, so moving the copy
 * without moving the measurement fails the suite.
 *
 * WHEN THE LANE MOVES, CHANGE IT HERE AND IN THAT TEST'S `MEASURED` — nowhere else. The strings
 * interpolate this; none of them hand-types a number.
 *
 * The Urdu digits are U+06Fx (۳ ۵), the Urdu set — NOT the Arabic-Indic ٣ ٥, which render wrong in
 * a Nastaliq face. The phrase is impersonal, so it carries no gendered verb stem.
 */
const LP612_ETA = Object.freeze({
  minMinutes: 3,
  maxMinutes: 5,
  en: 'about 3–5 minutes',
  ur: 'تقریباً ۳ سے ۵ منٹ',
});

const UX_STRINGS = {
  // ─── classroom-photo "Add another" (bd-pzs9a) ───────────────────────
  // The tap re-opens the photo step, so the copy must say what state the session
  // is now in — one shared "something went wrong" line across three different
  // states is what misdirects every field report (Rule 24d). All three are
  // impersonal or imperative, so neither carries a gendered verb stem.
  // Urdu prose digits are the U+06Fx set; the caller converts, and the
  // placeholders are bidi-isolated (LRI…PDI) because a value's direction is not
  // knowable at authoring time.
  photoAddAnotherNext: {
    en: '\u{1F4F8} Send the next classroom photo — photo {n} of {max}.',
    ur: '\u{1F4F8} اگلی کلاس روم تصویر بھیجیں — تصویر \u2066{n}\u2069 از \u2066{max}\u2069۔',
  },
  photoAddAnotherAtMax: {
    en: '\u{1F4F8} That is the maximum of {max} classroom photos. Moving on to the lesson plan.',
    ur: '\u{1F4F8} زیادہ سے زیادہ \u2066{max}\u2069 کلاس روم تصاویر بھیجی جا سکتی ہیں۔ اب سبق کے منصوبے کی طرف چلتے ہیں۔',
  },
  photoAddAnotherClosed: {
    en: '\u{1F4F8} This coaching session has already moved past the photo step, so another photo cannot be added to it.',
    ur: '\u{1F4F8} یہ کوچنگ سیشن تصویر والے مرحلے سے آگے بڑھ چکا ہے، اس لیے اس میں مزید تصویر شامل نہیں ہو سکتی۔',
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
   * LP v8 delivery (K-5 corpus, staging feedback round 1). The ack
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
  // HOW LONG — ONE CONSTANT, measured rather than guessed. See LP612_ETA above.
  //
  // The estimate was removed for a while because the number in the copy (five to six minutes) had
  // been measured against a slower lane and was wrong for Urdu by about three minutes; a number
  // that is wrong is worse than no number. Targeted revision then landed, the lane got fast enough
  // that an honest band exists, and the operator asked for the estimate back (2026-09-06). It is a
  // constant now, not four hand-typed phrases, so the next move of the lane is a one-line change.
  //
  // A SECOND request for the same lesson is served from R2 in about a second and sends no
  // interstitial at all (lp612-serving.service.js answers a cache hit by delivering the file
  // directly). Nobody reads these strings on a fast path, so they can quote the slow band plainly —
  // and saying "brand-new" is what stops it reading as the price of every lesson.
  //
  // The Urdu is deliberately gender-agnostic in the second person — imperatives
  // and impersonal constructions, never `رہی ہوں گی` / `رہے ہوں گے` — because
  // the cohort is mixed and the bot cannot know.

  lp612Preparing: {
    en: `📄 Writing your lesson plan now — a brand-new lesson takes ${LP612_ETA.en}. I will send it here as soon as it is ready.`,
    ur: `📄 آپ کا سبق کا منصوبہ ابھی تیار کیا جا رہا ہے — نئے سبق میں ${LP612_ETA.ur} لگتے ہیں۔ تیار ہوتے ہی یہیں بھیج دیا جائے گا۔`,
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
    en: `📄 That lesson stopped partway through, so I have started it again. It takes ${LP612_ETA.en} and will arrive here.`,
    ur: `📄 وہ سبق درمیان میں رک گیا تھا، اس لیے دوبارہ شروع کر دیا گیا ہے۔ اس میں ${LP612_ETA.ur} لگتے ہیں اور یہیں موصول ہو جائے گا۔`,
  },

  // A lesson whose page range is over the cap will fail identically on every retry, so it must
  // NOT get lp612Failed's "tap it again in a few minutes" — that invites her to wait and tap for
  // ever on something that can never succeed. Rule 24(d): the copy names the actual state, and
  // points at the thing that WILL work (the shorter rows in the same chapter).
  lp612TooLong: {
    en: 'That lesson covers too many pages for me to plan in one go. Open the chapter and pick one of the shorter lessons — those I can write for you now.',
    ur: 'یہ سبق اتنے زیادہ صفحات پر پھیلا ہوا ہے کہ ایک ساتھ منصوبہ نہیں بن سکتا۔ باب کھول کر کوئی چھوٹا سبق منتخب کریں — وہ ابھی تیار کر دیا جائے گا۔',
  },

  // ── bd-oak77.14: a lesson that ARRIVES imperfect, and one that cannot be drawn ──
  //
  // Rule 24(d), the same lesson `lp612TooLong` and `lp612OverlayDropped` were each written for:
  // one shared sentence across distinct states misdirects the teacher and every field report
  // after her. On 2026-09-06 the first Urdu tap on production died on `FIGURE TOO SMALL` — a
  // diagram label 0.25px under a legibility floor — and she was sent `lp612Failed`, the same
  // sentence an author timeout, a stranded worker and a missing page-truth all produce. The
  // lesson had in fact been finished: 17 complete pages were on disk. She re-typed "Lesson plan"
  // 43 seconds later.
  //
  // APPENDED to `lp612Caption` on a document send, exactly like `lp612OverlayDropped`, so it is
  // charged against body.text (1024) and not the 60-code-point footer. Measured in CODE POINTS.
  //
  // Three things it does and one it must not:
  //   * name the state at the level she can act on — something on the page looks tight;
  //   * say plainly that NOTHING IS MISSING, because nothing is: the never-fail policy delivers
  //     only documents that are WHOLE (a truncated PDF still fails), and copy that hinted at loss
  //     would send her hunting for content that is on the page;
  //   * give her the one action worth taking — a glance before she prints;
  //   * and it must NOT apologise or promise a retry. There is nothing for her to redo; the
  //     lesson is in her hand.
  //
  // ONE sentence for every degraded class rather than one per class, deliberately. The classes
  // (`figure`, `page`) differ in what an ENGINEER should look at — which is why they ride on
  // `lp612.deliver.degraded` — but they do not differ in anything she would do differently, and a
  // second column on the row would be needed to tell them apart on a cache hit.
  //
  // Urdu voice: every verb agrees with a NOUN (حصہ, خاکہ, صفحہ) or is an imperative, never with
  // the teacher, so a mixed-gender cohort is addressed correctly.
  lp612RenderDegraded: {
    en: 'One part of this lesson did not lay out perfectly — a diagram or a page may look tight. '
      + 'Nothing is missing; give it a quick look before you print.',
    ur: '\u0627\u0633 \u0633\u0628\u0642 \u06A9\u0627 \u0627\u06CC\u06A9 \u062D\u0635\u06C1 \u062A\u0631\u062A\u06CC\u0628 \u0645\u06CC\u06BA \u067E\u0648\u0631\u06CC \u0637\u0631\u062D \u0646\u06C1\u06CC\u06BA \u0628\u06CC\u0679\u06BE\u0627 \u2014 \u06A9\u0648\u0626\u06CC \u062E\u0627\u06A9\u06C1 \u06CC\u0627 \u0635\u0641\u062D\u06C1 \u0630\u0631\u0627 \u0628\u06BE\u0631\u0627 \u06C1\u0648\u0627 \u0644\u06AF \u0633\u06A9\u062A\u0627 \u06C1\u06D2\u06D4 \u06A9\u0686\u06BE \u06A9\u0645 \u0646\u06C1\u06CC\u06BA \u06C1\u0648\u0627\u061B \u0686\u06BE\u0627\u067E\u0646\u06D2 \u0633\u06D2 \u067E\u06C1\u0644\u06D2 \u0627\u06CC\u06A9 \u0646\u0638\u0631 \u062F\u06CC\u06A9\u06BE \u0644\u06CC\u06BA\u06D4',
  },

  // The failures the never-fail policy does NOT absorb: the pages could not be laid out at all —
  // a renderer that would not start, a document the schema refused, or a PDF that came out with
  // pages of the lesson MISSING from the file. That last one is the reason this string exists
  // rather than a wider policy: sending her a plan that just ends is worse than sending nothing.
  //
  // It is NOT `lp612Failed`. "I could not finish" is true of a timeout and false here — the
  // lesson was written, and saying so is what stops a field report reading as "the model failed"
  // when the renderer did. It promises a FRESH attempt rather than "I will try once more",
  // because that is what a re-tap does: this row is `failed`, so the next tap re-authors.
  lp612Unrenderable: {
    en: 'That lesson was written, but its pages did not come out right — I will not send you a '
      + 'broken copy. Tap it again and I will lay it out fresh.',
    ur: '\u06CC\u06C1 \u0633\u0628\u0642 \u0644\u06A9\u06BE\u0627 \u062A\u0648 \u06AF\u06CC\u0627\u060C \u0645\u06AF\u0631 \u0627\u0633 \u06A9\u06D2 \u0635\u0641\u062D\u0627\u062A \u062F\u0631\u0633\u062A \u0646\u06C1\u06CC\u06BA \u0628\u0646 \u0633\u06A9\u06D2 \u2014 \u0627\u062F\u06BE\u0648\u0631\u0627 \u0646\u0633\u062E\u06C1 \u0628\u06BE\u06CC\u062C\u0646\u0627 \u0645\u0646\u0627\u0633\u0628 \u0646\u06C1\u06CC\u06BA\u06D4 \u062F\u0648\u0628\u0627\u0631\u06C1 \u0627\u0633\u06CC \u0633\u0628\u0642 \u067E\u0631 \u0679\u06CC\u067E \u06A9\u0631\u06CC\u06BA\u060C \u0646\u06CC\u0627 \u0646\u0633\u062E\u06C1 \u062A\u06CC\u0627\u0631 \u06A9\u06CC\u0627 \u062C\u0627\u0626\u06D2 \u06AF\u0627\u06D4',
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
  // whose ur_overlay did not survive: what she receives is an
  // essentially-English document in RTL chrome, and saying so beats a silent
  // fallback (rule 24(c)/(d)). English variant exists so the catalog is never
  // a partial map (language-protocol §6.3); the line itself is only ever
  // APPENDED on Urdu deliveries.
  //
  // REWRITTEN 2026-09-05 (bd-vnyuw). It used to read "instructions partly in
  // Urdu" — which was never true of a single delivery. Every one of the six
  // overlay-dropped lessons on staging was English END TO END; the only Urdu on
  // the page was the template's own headings. "Partly" told a teacher the
  // translation was thin when it was absent, so the field reports that came back
  // read as a quality complaint rather than as a broken toggle, and rule 24(d)
  // is exactly that: failure copy that does not name the actual state misdirects
  // every report and every engineer who reads them.
  //
  // Three things it must do and one it must not:
  //   • name the state — the Urdu version is MISSING, not thin;
  //   • say the lesson is still whole, because it is: the overlay swaps strings
  //     on a complete document and nothing is lost when it is absent;
  //   • carry no blame and no jargon — "overlay" is our word, not hers.
  //   • promise NO retry SHE MUST PERFORM. The render is cached on (segment,
  //     lang, template_version) and every cache hit re-serves this same file, so
  //     "ask again" is a lie until that row is re-authored. Saying the Urdu is
  //     being prepared is not the same promise: it is a statement about the
  //     lesson, not an instruction she can follow and be let down by.
  //
  // REWRITTEN AGAIN 2026-09-05 (bd-zle0u), because the STATE changed. The first
  // rewrite described a translation that had been attempted and lost — "did not
  // come through". That was accurate for bd-vnyuw. It is not accurate now: the
  // overlay is DEFERRED to a pass that runs after the lesson is accepted, so
  // nothing was attempted and nothing was lost, and "did not come through" would
  // read as a fault where there is none. Rule 24(d) cuts both ways — copy that
  // over-states a failure misdirects a field report exactly as copy that
  // under-states one does. What she needs is the present tense: this copy is
  // English, the Urdu is being prepared.
  //
  // Urdu voice: every verb agrees with a NOUN (ترجمہ, نسخہ) or with US (ہم),
  // never with the teacher, so a mixed-gender cohort is addressed correctly.
  //
  // Caps (language-protocol §3): this line is APPENDED to `lp612Caption` on a
  // document send, so it is charged against body.text (1024), not the 60-code-point
  // footer. Measured in CODE POINTS — en 104, ur 91.
  lp612OverlayDropped: {
    en: 'This copy is in English. The Urdu version of this lesson is still being prepared '
      + '— we are working on it.',
    ur: 'یہ نسخہ انگریزی میں ہے۔ اس سبق کا اردو ترجمہ ابھی تیار ہو رہا ہے — ہم اس پر کام کر رہے ہیں۔',
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
  lp612RouteRedirect: {
    en: 'Lesson plans now come straight from your own textbook. Pick the class, subject and chapter below and I will write that lesson for you.',
    ur: 'اب سبق کے منصوبے آپ کی اپنی درسی کتاب سے بنتے ہیں۔ نیچے جماعت، مضمون اور باب منتخب کریں — وہ سبق تیار کر دیا جائے گا۔',
  },

  /**
   * bd-oak77.13 — the very first thing a teacher ever hears from this number.
   *
   * Sent on Meta's `request_welcome` event (a brand-new chat opened, nothing typed
   * yet). Bilingual in ONE body because at this instant she has no stored language
   * and no text to detect from — see welcome.handler.js. Urdu first, matching the
   * other bilingual first-contact strings (unsupported-message.js).
   *
   * Body field: the cap is 1024 CODE POINTS. It names the two doors the ice-breaker
   * chips below it lead to, and nothing else — a longer greeting on a cold open is
   * a wall of text, and the chips are the actual interface.
   *
   * Urdu is gender-agnostic in the second person: imperatives only
   * («منتخب کریں», «لکھ بھیجیں»), never `رہی ہوں گی` / `رہے ہوں گے`. The cohort is
   * mixed and the bot cannot know.
   */
  welcomeFirstOpen: {
    en:
      'السلام علیکم! میں NIETE ٹیچنگ اسسٹنٹ ہوں۔\n' +
      'آپ کی اپنی درسی کتاب سے سبق کے منصوبے، اور آپ کی کلاس کی ریکارڈنگ پر اے آئی کوچنگ — دونوں یہیں دستیاب ہیں۔\n' +
      'نیچے دیے گئے اختیارات میں سے کوئی ایک منتخب کریں، یا مجھے اپنی بات لکھ بھیجیں۔\n\n' +
      "Assalam-o-Alaikum! I'm the NIETE Teaching Assistant.\n" +
      'Lesson plans straight from your own textbook, and AI coaching on a recording of your class — both live right here.\n' +
      'Tap one of the options below, or just write to me.',
    // Deliberately IDENTICAL to `en`. This is the one string in the catalog
    // where the two variants must not differ: it is sent before any language is
    // known, so the same bilingual body has to satisfy whichever clamp the
    // resolver happens to land on. The catalog-completeness test requires every
    // offered language to be present, and a lazy `variants[FLOOR]` fallback here
    // would be a silent partial translation.
    ur:
      'السلام علیکم! میں NIETE ٹیچنگ اسسٹنٹ ہوں۔\n' +
      'آپ کی اپنی درسی کتاب سے سبق کے منصوبے، اور آپ کی کلاس کی ریکارڈنگ پر اے آئی کوچنگ — دونوں یہیں دستیاب ہیں۔\n' +
      'نیچے دیے گئے اختیارات میں سے کوئی ایک منتخب کریں، یا مجھے اپنی بات لکھ بھیجیں۔\n\n' +
      "Assalam-o-Alaikum! I'm the NIETE Teaching Assistant.\n" +
      'Lesson plans straight from your own textbook, and AI coaching on a recording of your class — both live right here.\n' +
      'Tap one of the options below, or just write to me.',
  },

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

  /**
   * bd-twhcj — the honest refusal when reading assessment cannot run here.
   *
   * NIETE has the reading CODE and the reading TABLES, but no reading Flow was
   * ever published to its WhatsApp account and READING_ASSESSMENT_FLOW_ID is
   * unset, so `/reading test` was calling sendFlow with `flowId: undefined`.
   * 43 teachers, 57 attempts, 57 failures, zero rows, twenty days — and every
   * one of them was told "something went wrong, please try again later", which
   * is an invitation to try again at a door that does not exist.
   *
   * Rule 24(d): the copy names the ACTUAL state. Not available here, not a
   * transient fault, and no "try again" — because trying again cannot work.
   * It ends by naming the two doors that ARE open, so the message closes a
   * dead end and hands something back in its place.
   *
   * Sent as a plain text body, so the cap is 1024 CODE POINTS (pinned in
   * tests/config/ux-strings-whatsapp-limits.test.js).
   *
   * Urdu is gender-agnostic in the second person — no `چاہتے ہیں` /
   * `چاہتی ہیں` verb agreement with the reader at all; the sentences are
   * impersonal statements about what is and is not available. The cohort is
   * mixed and the bot cannot know. Rumi's own first person stays as it is
   * everywhere else in this catalog.
   *
   * `/menu` inside the Urdu sentence is wrapped in U+2066 LRI … U+2069 PDI.
   * It is a machine-Latin atom in RTL prose, and its leading slash is a
   * bidi-neutral character between an Arabic-class letter and a Latin one —
   * exactly the case UAX#9 resolves to the paragraph direction, which puts
   * the slash on the far side of the word for a reader scanning the line.
   * The isolate makes it paint as one contiguous `/menu` token. The English
   * variant needs nothing: its paragraph is already LTR.
   */
  readingNotAvailable: {
    en:
      'Reading assessment is not switched on here yet, so I cannot open it for you — '
      + 'trying again will not help, and that is on us, not on you.\n'
      + 'What is ready right now: lesson plans straight from your own textbook, '
      + 'and coaching on a recording of your class. Type /menu to see both.',
    ur:
      'قرائت کا جائزہ ابھی یہاں دستیاب نہیں ہے، اس لیے میں اسے کھول نہیں سکتی۔ '
      + 'دوبارہ کوشش کرنے کا فائدہ نہیں — یہ کمی ہماری طرف سے ہے۔\n'
      + 'ابھی جو موجود ہے: آپ کی اپنی درسی کتاب سے سبق کے منصوبے، اور کلاس کی '
      + 'ریکارڈنگ پر کوچنگ۔ دونوں دیکھنے کے لیے \u2066/menu\u2069 لکھیں۔',
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
   * /status when the store is empty.
   *
   * This used to be nothing at all. The command sent the Flow CTA
   * unconditionally; the Flow's INIT returned a TERMINAL success screen when
   * there was nothing to list, so it flashed open and shut; and the chat-side
   * completion branch only spoke for `cancelled`. Type /status with a clear
   * store and the teacher got a tap and silence.
   *
   * Points at /menu rather than naming features. The earlier inline copy
   * suggested "/quiz, /reading test, or describe a lesson topic" — and NIETE
   * has no reading assessment on its menu, so a third of that sentence
   * advertised something this deployment does not have.
   */
  statusNothingRunning: {
    en: "Nothing's running right now. Send /menu to start something.",
    ur: 'اس وقت کچھ نہیں چل رہا۔ کچھ شروع کرنے کے لیے /menu بھیجیں۔',
  },

  /**
   * The probe itself failed, which is NOT the same as "nothing is running" and
   * must never be reported as it — that would tell a teacher with a live
   * session that she has none. Only reachable when no Flow is published; with a
   * Flow we open it instead and let its own error screen speak.
   */
  statusCheckFailed: {
    en: "I couldn't check what's running just now. Please send /status again in a moment.",
    ur: 'میں اس وقت یہ نہیں دیکھ سکا کہ کیا چل رہا ہے۔ تھوڑی دیر بعد دوبارہ /status بھیجیں۔',
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

  // ─── the account we could not reach ──────────────────────────────────────
  //
  // Sent when the USER LOOKUP ITSELF FAILED — the database was unreachable, so
  // nothing is known about her account and nothing may be asserted about it.
  //
  // This is not the "you have no account" line and must never read like one. A
  // coach reported the old behaviour: during a Cloudflare 522 a registered
  // teacher typing /video was told she was not registered. She was, she was
  // mid-session, and the message blamed her for an outage on our side. There
  // are two states here and they get two different sentences.
  //
  // Deliberately sent in BOTH languages at once. Her stored preference lives in
  // the row we just failed to read, so at this exact moment we cannot know
  // which language she reads — and guessing English at the one moment she is
  // already confused is the wrong trade.
  //
  // Urdu is gender-neutral by construction: the verbs agree with the account
  // and with "کچھ", never with the person being addressed, and the closing
  // instruction is a plain imperative.
  accountLookupUnavailable: {
    en: 'Something is wrong on our side — I cannot reach your account right now. Nothing is lost. Please try again in a few minutes.',
    ur: '\u06c1\u0645\u0627\u0631\u06d2 \u0633\u0633\u0679\u0645 \u0645\u06cc\u06ba \u06a9\u0686\u06be \u062e\u0631\u0627\u0628\u06cc \u06c1\u06d2 \u2014 \u0627\u0633 \u0648\u0642\u062a \u0622\u067e \u06a9\u0627 \u0627\u06a9\u0627\u0624\u0646\u0679 \u06a9\u06be\u0644 \u0646\u06c1\u06cc\u06ba \u067e\u0627 \u0631\u06c1\u0627\u06d4 \u06a9\u0686\u06be \u0636\u0627\u0626\u0639 \u0646\u06c1\u06cc\u06ba \u06c1\u0648\u0627\u06d4 \u0686\u0646\u062f \u0645\u0646\u0679 \u0628\u0639\u062f \u062f\u0648\u0628\u0627\u0631\u06c1 \u06a9\u0648\u0634\u0634 \u06a9\u0631\u06cc\u06ba\u06d4',
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

  /**
   * bd-43521 — the roster's own copy. These six arrived on `develop` with the
   * v7.0 NavigationList roster and were NOT part of the earlier remark commits
   * that reached `main`, so a port of the endpoint alone leaves resolveUx with
   * no entry and the principal reads a roster with blank status labels. That is
   * the bd-2566 shape exactly: the caller was picked, the thing it calls was not.
   */
  remarkNoTeachers: {
    en: 'No teachers are listed at your school yet.',
    ur: 'آپ کے سکول میں ابھی کوئی استاد درج نہیں۔',
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

  remarkSummaryDone: {
    en: 'Done',
    ur: 'مکمل',
  },

  remarkSummaryOverall: {
    en: 'Overall: {pct}',
    ur: 'مجموعی: {pct}',
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
  // {lesson} is built by transcript-quiz-language.lessonLabel(): the subject in
  // the TEACHER's language, the topic as the class actually heard it (the quiz
  // language), and a teacher-language gloss in brackets when the two differ.
  tqOffer: {
    en: 'Your {lesson}, {date}. I can make a short 8-question quiz your students take on WhatsApp — it checks what they learnt, and you get a report on what to reteach.\n\nWant it?\n\nYou can make one for any lesson anytime by sending /quiz.',
    ur: 'آپ کا {lesson}، {date}۔ طلبہ کے لیے 8 سوالوں کا مختصر quiz تیار ہو سکتا ہے — طلبہ اسے WhatsApp پر حل کریں، اور آپ کو رپورٹ ملے کہ کیا سمجھ آیا اور کیا دوبارہ پڑھانا ہے۔\n\nبنا دیں؟\n\nکسی بھی سبق کا quiz کبھی بھی /quiz بھیج کر بنایا جا سکتا ہے۔',
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
    en: '📝 Your quiz: {lesson} — {n} questions.\n\nThis PDF is for you: what you taught, what the quiz checks, and every question with its correct answer marked.\n\nThe NEXT message is for your students — forward it to the class group.',
    ur: '\u200F📝 آپ کا quiz: {lesson}، {n} سوالات۔\n\nیہ PDF آپ کے لیے ہے: آپ نے کیا پڑھایا، کوئز کیا جانچتا ہے، اور ہر سوال کے ساتھ درست جواب نشان زد۔\n\nاگلا پیغام طلبہ کے لیے ہے — اسے class group میں forward کریں۔',
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
    en: 'Your lessons, newest first. Pick one to make a quiz, resend its link, or get its report.',
    ur: 'آپ کے اسباق، نئے سے پرانے۔ کوئی ایک چنیں — quiz بنانے، link دوبارہ بھیجنے یا رپورٹ لینے کے لیے۔',
  },
  tqListButton: { en: 'Choose lesson', ur: 'سبق چنیں' },
  tqListSection: { en: 'Recent lessons', ur: 'حالیہ اسباق' },
  tqListHeader: { en: 'Lessons {from}–{to}', ur: 'اسباق {from}–{to}' },
  tqListEmpty: {
    en: 'No lessons yet. Record a lesson for coaching first — then /quiz can turn it into a quiz for your students.',
    ur: 'ابھی کوئی سبق نہیں۔ پہلے coaching کے لیے سبق ریکارڈ کریں — پھر /quiz اسے طلبہ کے لیے quiz بنا دے گا۔',
  },
  tqRowNoQuiz: { en: 'No quiz yet', ur: 'ابھی quiz نہیں' },
  tqRowOffered: { en: 'Offered — tap to make', ur: 'پیشکش — بنانے کو tap' },
  tqRowMaking: { en: 'Being made…', ur: 'تیار ہو رہا ہے…' },
  tqRowSent: { en: 'Sent · {started} started · {finished} done', ur: 'بھیجا، {started} نے شروع، {finished} مکمل' },
  tqRowReportSent: { en: 'Report sent · {finished} done', ur: 'رپورٹ بھیجی، {finished} مکمل' },
  tqRowFailed: { en: 'Failed — tap to retry', ur: 'نہیں بنا — دوبارہ tap' },
  tqRowOlder: { en: 'Older lessons…', ur: 'پرانے اسباق…' },
  tqRowOlderDesc: { en: 'The next 9, going back', ur: 'اگلے 9، اور پیچھے' },
  // The date is here because she is choosing between lessons, and two lessons
  // can carry the same topic in one term.
  tqQuizStatus: {
    en: '*{topic}*\n{date} · {started} started · {finished} finished.\n\nResend the link, or regenerate the report?',
    ur: '\u200F*{topic}*\n{date}، {started} نے شروع کیا، {finished} مکمل۔\n\nlink دوبارہ بھیجیں، یا رپورٹ دوبارہ بنائیں؟',
  },
  tqLinkButton: { en: 'Resend link', ur: 'دوبارہ link بھیجیں' },
  // Both ≤ 20 code points in both languages — a WhatsApp button title cap.
  tqReportButton: { en: 'Regenerate report', ur: 'رپورٹ دوبارہ بنائیں' },
  tqBackButton: { en: 'Back to lessons', ur: 'اسباق پر واپس' },
  tqNoReportYet: {
    en: 'No one has finished this quiz yet, so there is nothing to report. Resend the link?',
    ur: 'ابھی کسی نے یہ quiz مکمل نہیں کیا، اس لیے رپورٹ کے لیے کچھ نہیں۔ link دوبارہ بھیجیں؟',
  },
  // Names the refetch: the whole point of the button is that a child who
  // finished since the last report is counted this time.
  tqReportComing: {
    en: 'Recounting now — every student who has finished since the last report is included. One moment…',
    ur: 'ابھی دوبارہ گنا جا رہا ہے — پچھلی رپورٹ کے بعد جس نے بھی مکمل کیا وہ بھی شامل ہے۔ ایک لمحہ…',
  },
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
  tqNudgeMany: {
    en: '{count} of your quizzes have had almost nobody start yet: *{topics}*. Worth forwarding the links to the class group again?',
    ur: '\u200Fآپ کے {count} quiz ابھی تک تقریباً کسی نے شروع نہیں کیے: *{topics}*۔ link دوبارہ class group میں forward کر دیں؟',
  },

  // ─── /quiz as ONE WhatsApp Flow (docs/flows/transcript-quiz-flow.json) ───
  //
  // Every string here is rendered INSIDE a Flow screen, so the caps are Meta's
  // Flow JSON caps, not WhatsApp's message caps, and they are tighter than they
  // look. Measured in CODE POINTS, verified in tests/quiz/transcript-quiz-flow-strings.test.js:
  //
  //   NavigationList item  main-content.title 30 · description 20 · metadata 80
  //   TextHeading 80 · TextBody 4096 · Footer label 35
  //   RadioButtonsGroup option title 30 · description 300
  //   screen title 30
  //   the chat bubble that OPENS the Flow: header 60 · body 1024 · CTA 20
  //
  // The item description is 20 — a quarter of a WhatsApp list row's 72 — which
  // is why the status strings below are their own short keys instead of reusing
  // tqRow*, and why the full topic lives in the 80-code-point metadata.
  // The teacher is "you"; no gendered pronoun in either language.

  // The chat bubble that carries the Flow.
  tqFlowChatHeader: { en: '📝 Your quizzes', ur: '📝 آپ کے quizzes' },
  tqFlowChatBody: {
    en: 'Your lessons, newest first. Open one to see how the class did, get its report, or resend its link — all in here, without leaving this screen.',
    ur: 'آپ کے اسباق، نئے سے پرانے۔ کوئی ایک کھولیں — کلاس کا نتیجہ دیکھیں، رپورٹ لیں یا link دوبارہ بھیجیں، سب اسی سکرین میں۔',
  },
  tqFlowChatCta: { en: 'Open', ur: 'کھولیں' },

  // Screen titles (≤ 30).
  tqFlowLessonsTitle: { en: 'Your lessons', ur: 'آپ کے اسباق' },
  tqFlowLessonTitle: { en: 'This lesson', ur: 'یہ سبق' },
  tqFlowDoneTitle: { en: 'On its way', ur: 'بھیجا جا رہا ہے' },

  // The lesson row's status, in the 20-code-point description slot.
  tqFlowStatusNone: { en: 'No quiz yet', ur: 'ابھی quiz نہیں' },
  tqFlowStatusOffered: { en: 'Not made yet', ur: 'ابھی نہیں بنا' },
  tqFlowStatusMaking: { en: 'Being made…', ur: 'تیار ہو رہا ہے…' },
  tqFlowStatusSent: { en: '{started} started', ur: '\u200F{started} نے شروع' },
  tqFlowStatusReport: { en: 'Report sent · {finished}', ur: 'رپورٹ بھیجی · {finished}' },
  tqFlowStatusFailed: { en: 'Didn’t work', ur: 'نہیں بن سکا' },

  // The paging rows. Tapping one asks the endpoint for the next slice and the
  // endpoint answers with THIS SAME screen — the teacher never leaves the Flow.
  tqFlowOlder: { en: 'Older lessons…', ur: 'پرانے اسباق…' },
  tqFlowNewer: { en: 'Newer lessons…', ur: 'نئے اسباق…' },
  tqFlowPageNum: { en: 'Page {page}', ur: 'صفحہ {page}' },
  tqFlowOlderMeta: { en: 'The next {n}, going further back', ur: 'اگلے {n}، اس سے بھی پیچھے' },

  // The one row a NavigationList must still carry when there is nothing to
  // list: Meta needs at least one item, and an empty screen is a dead end.
  // `/quiz` normally never opens the Flow on an empty list — the dispatch sends
  // the plain "no lessons yet" message instead — so this is the race, not the
  // usual path.
  tqFlowEmptyTitle: { en: 'No lessons yet', ur: 'ابھی کوئی سبق نہیں' },
  tqFlowEmptyDesc: { en: 'Record one first', ur: 'پہلے ریکارڈ کریں' },
  tqFlowEmptyMeta: {
    en: 'Record a lesson for coaching, then /quiz turns it into a quiz.',
    ur: 'پہلے coaching کے لیے سبق ریکارڈ کریں، پھر /quiz اس کا quiz بنا دے گا۔',
  },
  tqFlowNewerMeta: { en: 'Back to the {n} more recent lessons', ur: 'پچھلے {n} حالیہ اسباق پر واپس' },

  // The lesson screen: heading, sub-line, and the live results.
  tqFlowLessonSub: { en: '{date} · {subject} · {status}', ur: '\u200F{date} · {subject} · {status}' },
  tqFlowLessonSubNoSubject: { en: '{date} · {status}', ur: '\u200F{date} · {status}' },
  tqFlowResultsHead: {
    en: '{started} started · {finished} finished · average {avg}%',
    ur: '\u200F{started} نے شروع کیا، {finished} نے مکمل، اوسط \u2066{avg}%\u2069',
  },
  tqFlowResultsStartedOnly: {
    en: '{started} started · nobody has finished yet',
    ur: '\u200F{started} نے شروع کیا، ابھی کسی نے مکمل نہیں کیا',
  },
  tqFlowResultsNobody: {
    en: 'Nobody has opened this quiz yet. Resend the link and it will show up here as students take it.',
    ur: 'ابھی کسی نے یہ quiz نہیں کھولا۔ link دوبارہ بھیجیں — طلبہ کے حل کرتے ہی نتیجہ یہیں نظر آئے گا۔',
  },
  tqFlowResultsNoQuiz: {
    en: 'No quiz has been made from this lesson yet. Making one takes about a minute.',
    ur: 'اس سبق سے ابھی کوئی quiz نہیں بنا۔ بنانے میں تقریباً ایک منٹ لگتا ہے۔',
  },
  tqFlowResultsMaking: {
    en: 'The quiz is being made — about a minute. It will arrive in your chat with the message to forward.',
    ur: '\u200Fquiz تیار ہو رہا ہے — تقریباً ایک منٹ۔ آگے بھیجنے والے پیغام کے ساتھ آپ کی chat میں آ جائے گا۔',
  },
  tqFlowResultsFailed: {
    en: 'The last attempt did not produce a good quiz from this lesson’s recording. You can try again.',
    ur: 'پچھلی کوشش میں اس سبق کی ریکارڈنگ سے اچھا quiz نہیں بن سکا۔ دوبارہ کوشش کی جا سکتی ہے۔',
  },
  tqFlowEachStudent: { en: 'How each student did', ur: 'ہر طالب علم کا نتیجہ' },
  // The score is ONE left-to-right atom (digits, slash, brackets, per-cent), so
  // it arrives already wrapped in LRI…PDI from the endpoint — in an Urdu line
  // an un-isolated `8/8 (100%)` after an Urdu name renders as `(%100) 8/8`.
  tqFlowStudentLine: { en: '• {name}{klass} — {score}', ur: '• {name}{klass} — {score}' },
  tqFlowStillGoing: { en: 'Still going: {names}', ur: 'ابھی حل کر رہے ہیں: {names}' },
  tqFlowMoreStudents: { en: '…and {n} more', ur: '…اور {n} مزید' },
  tqFlowUnnamed: { en: 'Unnamed', ur: 'بےنام' },

  // The actions, as the options of a single radio group under the results.
  tqFlowActionsLabel: { en: 'What next?', ur: 'اب کیا کریں؟' },
  tqFlowActionReport: { en: 'Generate report', ur: 'رپورٹ بنائیں' },
  tqFlowActionReportDesc: {
    en: 'Counted again right now — everyone who has finished since the last report is in it.',
    ur: 'ابھی دوبارہ گنا جائے گا — پچھلی رپورٹ کے بعد جس نے بھی مکمل کیا وہ بھی شامل ہو گا۔',
  },
  tqFlowActionLink: { en: 'Resend link', ur: '\u200Flink دوبارہ بھیجیں' },
  tqFlowActionLinkDesc: {
    en: 'The PDF, then the message to forward — the same link as before, never a new one.',
    ur: '‏PDF، پھر آگے بھیجنے والا پیغام — وہی پرانا link، نیا نہیں۔',
  },
  tqFlowActionMake: { en: 'Make the quiz', ur: '\u200Fquiz بنائیں' },
  tqFlowActionMakeIn: { en: 'Make it in {language}', ur: '\u200F{language} میں بنائیں' },
  tqFlowActionMakeDesc: {
    en: '8 questions from what you taught in this lesson. About a minute.',
    ur: 'اس سبق میں آپ نے جو پڑھایا، اس پر 8 سوالات۔ تقریباً ایک منٹ۔',
  },
  tqFlowContinue: { en: 'Continue', ur: 'آگے بڑھیں' },
  tqFlowClose: { en: 'Close', ur: 'بند کریں' },

  // The terminal screen, one per action.
  tqFlowDoneReportHead: { en: 'Your report is on its way', ur: 'آپ کی رپورٹ آ رہی ہے' },
  tqFlowDoneReportBody: {
    en: 'Recounting now. The report will arrive in your chat in a minute or two — the class summary, how each student did, and what is worth reteaching.',
    ur: 'ابھی دوبارہ گنا جا رہا ہے۔ ایک دو منٹ میں رپورٹ آپ کی chat میں آ جائے گی — کلاس کا خلاصہ، ہر طالب علم کا نتیجہ، اور کیا دوبارہ پڑھانا ہے۔',
  },
  tqFlowDoneLinkHead: { en: 'The link is on its way', ur: '\u200Flink بھیجا جا رہا ہے' },
  tqFlowDoneLinkBody: {
    en: 'The PDF first, then the message to forward to your class group. It carries the same link as before.',
    ur: 'پہلے PDF، پھر وہ پیغام جو class group میں forward کرنا ہے۔ اس میں وہی پرانا link ہے۔',
  },
  tqFlowDoneMakeHead: { en: 'Making the quiz', ur: '\u200Fquiz بن رہا ہے' },
  tqFlowDoneMakeBody: {
    en: 'About a minute. The quiz and the message to forward will arrive in your chat.',
    ur: 'تقریباً ایک منٹ۔ quiz اور آگے بھیجنے والا پیغام آپ کی chat میں آ جائے گا۔',
  },
  tqFlowDoneWaitHead: { en: 'Still being made', ur: 'ابھی تیار ہو رہا ہے' },
  tqFlowDoneWaitBody: {
    en: 'About a minute. The quiz will arrive in your chat with the message to forward.',
    ur: 'تقریباً ایک منٹ۔ quiz آگے بھیجنے والے پیغام کے ساتھ آپ کی chat میں آ جائے گا۔',
  },

  // Snackbar errors — the endpoint returns the CURRENT screen with these, so a
  // fault is never a dead end.
  tqFlowErrPickAction: { en: 'Pick one of the options first.', ur: 'پہلے کوئی ایک آپشن منتخب کریں۔' },
  tqFlowErrNotYours: { en: 'That lesson could not be found.', ur: 'وہ سبق نہیں مل سکا۔' },
  tqFlowErrGeneric: { en: 'Something went wrong — try again.', ur: 'کچھ غلط ہو گیا — دوبارہ کوشش کریں۔' },
  // The lookup itself failed (not an unknown teacher): retry copy, both ≤ 60 code points.
  tqFlowErrLookup: { en: 'Could not load your lessons just now. Please tap again.', ur: 'ابھی آپ کے اسباق نہیں کھل سکے۔ دوبارہ tap کریں۔' },

  // ─── quiz chrome read by CHILDREN, in the quiz language ─────────────────
  // The share-link chain was English-only; a child taking an Urdu quiz now
  // reads Urdu around the questions too. A child is "آپ" with respectful
  // plural verbs — never a gendered guess.
  vqGreeting: {
    en: '👋 Assalam o Alaikum!\n\n*{teacher}* has sent you a quiz on *{topic}*.',
    ur: '\u200F👋 السلام علیکم!\n\n*{teacher}* نے آپ کو *{topic}* پر quiz بھیجا ہے۔',
  },
  // PLAN_R5 §1 D8 — a teacher opening her own class link (a self-test),
  // not a child. Chat body, no code-point cap. "test run" stays in Latin
  // letters in the Urdu line (an English technical term, no established
  // Urdu equivalent in this catalog).
  vqSelfTestStart: {
    en: 'This is your own test run — it won’t show up in your class report. Here goes!',
    ur: '\u200Fیہ آپ کا اپنا test run ہے — یہ آپ کی کلاس رپورٹ میں شامل نہیں ہوگا۔ چلیں شروع کریں!',
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

  // ─── the child's scorecard image ────────────────────────────────────────
  // These are painted INTO a 540x400 card, not sent as a message, so they are
  // held to a badge's width rather than a message's. The vqTier* lines above
  // stay the caption's full sentence; these are the two or three words that
  // fit on the card itself. Both sets say the same thing, so a child hears one
  // voice whether she reads the picture or the text under it.
  vqScorecardEyebrow: { en: 'QUIZ COMPLETE', ur: 'کوئز مکمل' },
  vqBadgeMastered: { en: 'Brilliant!', ur: 'زبردست!' },
  vqBadgeDeveloping: { en: 'Nicely done', ur: 'بہت اچھا' },
  vqBadgeNeedsPractice: { en: 'Good effort', ur: 'اچھی کوشش' },

  // The report's one "nothing to report" branch: the link was never opened.
  // Sent instead of the PDF, in the teacher's own language.
  // Under a QUESTION CARD (the whole question drawn as one picture because of
  // notation or long options), the buttons are letters; this is the body line.
  vqCardAsk: {
    en: 'The question is in the picture above. Tap {letters}.',
    ur: '\u200Fسوال اوپر تصویر میں ہے۔ {letters} دبائیں۔',
  },
  // The letters a QUESTION CARD offers are never fixed at three — a card can
  // carry 2 or 4 options, and the copy has to name exactly the buttons sent
  // (round 5). letterListLabel() builds "A, B or C" from these two pieces;
  // both are language data, not layout — Urdu's list comma is `،`, not `,`,
  // and its "or" is `یا`.
  vqLetterSep: { en: ', ', ur: '، ' },
  vqLetterOr: { en: 'or', ur: 'یا' },
  // The question card's OWN footer, painted into the image itself.
  vqCardTapBelow: { en: 'Tap {letters} below', ur: 'نیچے {letters} دبائیں' },
  // ─── "select all that apply" questions (PLAN_R5 D4) ─────────────────────
  // A question with two or three correct options is delivered as a Flow with a
  // CheckboxGroup. Every string a child reads on that path lives here, in both
  // languages, because the Flow ASSET is one per WABA and cannot be re-rendered
  // per language — the only way an Urdu quiz reads as Urdu is if the sender
  // supplies the copy as screen data (whatsapp-flows skill, rule 12).
  //
  // Caps that bind these: the Flow CTA button is 20 code points, a Flow Footer
  // label 35, a CheckboxGroup label ~30, and the interactive message footer 60.
  // Measured in CODE POINTS, which is what Meta counts and what an Urdu string
  // makes differ from `.length`.
  vqMultiSelectAll: { en: 'Select all that apply.', ur: 'سب درست جواب چنیں۔' },
  vqMultiCardFoot: {
    en: 'Open the form below and tick every right answer.',
    ur: 'نیچے فارم کھولیں اور ہر درست جواب پر نشان لگائیں۔',
  },
  // The Flow's CTA button (20 code points) and its submit Footer (35).
  vqMultiCta: { en: 'Answer', ur: 'جواب دیں' },
  vqMultiSubmit: { en: 'Send answer', ur: 'جواب بھیجیں' },
  // Says that the set has more than one member WITHOUT saying how many — the
  // count is the answer key. Same reason the Flow's max-selected-items is the
  // option count and not the size of the key.
  vqMultiFooter: { en: 'More than one answer is right.', ur: 'ایک سے زیادہ جواب درست ہیں۔' },
  // The verdict's opening sentence — WITHOUT a marker. D2's ✅/❌ is applied by
  // video-quiz-render.withVerdictMark(), which is also the only thing that knows
  // when the marker needs a right-to-left mark after it. Two places prepending
  // an emoji is how a child ends up reading "✅ ✅".
  // These are the fallbacks for a question whose author wrote no correct-answer
  // feedback; when she did, her sentence is used and marked instead.
  vqMultiRight: { en: 'Correct! The full answer is {right}.', ur: 'درست! پورا جواب یہ ہے: {right}۔' },
  vqMultiWrong: { en: 'Not quite — the full answer is {right}.', ur: 'بالکل نہیں — پورا جواب یہ ہے: {right}۔' },
  // Urdu deliberately uses the listing form ("these are right too") rather than
  // a literal translation of "you missed": every natural Urdu verb for missing
  // agrees in gender/number with the thing missed, which is unknown here and is
  // sometimes one option and sometimes two.
  vqMultiMissed: { en: 'You missed {missed}.', ur: 'یہ بھی درست ہیں: {missed}۔' },
  vqMultiExtra: { en: '{extra} does not belong here.', ur: '\u200F{extra} اس میں شامل نہیں۔' },
  // Joins the members of an answer set for a child to read.
  vqMultiJoin: { en: ' and ', ur: ' اور ' },
  // The degraded path: no Flow is configured on this WABA, so the question is
  // asked as an ordinary single-select picker. It says plainly that more than
  // one answer is right rather than pretending the question changed.
  vqMultiFallbackAsk: {
    en: 'More than one answer is right — tap the one you are most sure of.',
    ur: 'ایک سے زیادہ جواب درست ہیں — جس پر آپ کو سب سے زیادہ یقین ہے وہ دبائیں۔',
  },

  vqReportNoOne: {
    en: 'No one has opened your quiz on \u201c{topic}\u201d yet. The link stays live for 30 days \u2014 worth a nudge in the class group.',
    ur: '\u200Fآپ کے quiz «{topic}» کو ابھی تک کسی نے نہیں کھولا۔ link 30 دن تک چلتا رہے گا — class group میں ایک بار پھر یاد دہانی کرا دیں۔',
  },
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
  // Sections are a closed set (A–O, seeded in the sections table). The helper text is where a teacher learns
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
  /**
   * The roster TEXT ran out of room. A DIFFERENT truncation from
   * `classEditHintCapped`, which is about the removal checkboxes — the two have
   * to be tellable apart, or a coach cannot know which children are missing.
   * A bare "… +4" was the field report from a coach on 2026-09-08: a number
   * with no sentence around it reads as breakage.
   * Urdu is gender-neutral: the verb agrees with بچے, never with the reader.
   */
  classRosterOverflow: {
    en: '… {hidden} more children are on this roll but are not shown here: '
      + 'the list is too long for one screen.',
    ur: '… {hidden} مزید بچے اس فہرست میں شامل ہیں لیکن یہاں نہیں دکھائے جا سکتے: '
      + 'فہرست ایک اسکرین کے لیے بہت لمبی ہے۔',
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
 * Transcript quiz, round 2 — the lesson label the offer and the hand-off are
 * built from. Kept as one block at the end of the catalog so the three
 * round-2 workstreams can each append without colliding.
 *
 * These four are FRAGMENTS, not messages: lessonLabel() composes one of them
 * and the result is substituted into {lesson}. The topic arrives already
 * wrapped in a first-strong isolate, so an Urdu topic inside an English
 * sentence (or the reverse) cannot drag the punctuation around it.
 */
const TRANSCRIPT_QUIZ_R2_STRINGS = {
  // The quiz language is the teacher's to choose. The two button titles come from the
  // language registry (اردو / English), not from here — a language names itself
  // the same way in both catalogs, and the registry is what the /language and
  // /settings pickers already render.
  tqAskLanguage: {
    en: 'Which language should the quiz be in?\n\nUrdu — English terms stay in English letters (fraction, numerator).\nEnglish — the whole quiz in English.\n\nTap one.',
    ur: '\u200Fquiz کس زبان میں ہو؟\n\nاردو — English اصطلاحات انگریزی حروف میں (fraction، numerator)۔\nEnglish — پورا quiz انگریزی میں۔\n\nایک کو tap کریں۔',
  },
  tqLessonOnSubject: { en: '{subject} lesson on {topic}', ur: '\u200F{subject} کا سبق — {topic}' },
  tqLessonNoTopic:   { en: '{subject} lesson',            ur: '\u200F{subject} کا سبق' },
  tqLessonOnTopic:   { en: 'lesson on {topic}',           ur: 'سبق — {topic}' },
  tqLessonPlain:     { en: 'lesson',                      ur: 'سبق' },
};

Object.assign(UX_STRINGS, TRANSCRIPT_QUIZ_R2_STRINGS);

/**
 * the student tutor persona (a child who reaches the bot outside
 * a quiz session, e.g. via a forwarded share link). Two strings, both with a
 * real call site in `_getStudentTutorPrompt` (openai.service.js): the redirect
 * line is copy the child can actually read, so it lives in the catalog like
 * any other teacher/child-facing string rather than being typed inline.
 */
const STUDENT_TUTOR_STRINGS = {
  // The model-failure apology, child-shaped. Not a button/header, so no
  // code-point cap applies, but kept short on purpose.
  studentChatError: {
    en: 'Oops, something went wrong on my end. Please try asking again!',
    ur: 'معذرت، کچھ گڑبڑ ہو گئی۔ براہِ کرم دوبارہ پوچھیں!',
  },
  // The exact sentence the student prompt tells the model to use when a
  // message drifts off schoolwork — deliberately "a grown-up", not an
  // enumerated list, so it never has to name a teacher.
  studentOffTopicHint: {
    en: "Let's stay with your schoolwork — for anything else, ask a grown-up.",
    ur: 'آئیں سکول کے کام پر توجہ رکھیں — کسی اور بات کے لیے کسی بڑے سے پوچھیں۔',
  },
};

Object.assign(UX_STRINGS, STUDENT_TUTOR_STRINGS);

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
  LP612_ETA,
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
