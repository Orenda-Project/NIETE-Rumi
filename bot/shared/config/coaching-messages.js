/**
 * Coaching System Messages — i18n catalog
 *
 * Centralises every system message the coaching pipeline sends to teachers
 * over WhatsApp, so translations can be added per-locale without hunting
 * across the pipeline's service files. English-fallback when a locale's
 * translation is absent.
 *
 * Supported language codes come from the registry (`config/languages.js`) — this
 * file no longer keeps its own list. For this deployment that is en + ur.
 *
 * Adding a translation:
 *   1. Find the message key below
 *   2. Replace the `// TODO: translate to <lang>` placeholder with the
 *      localised string. Keep the SAME emoji placement and `${var}`
 *      template positions.
 *   3. Run `node tests/run.js tests/setup/no-hardcoded-coaching-strings.test.js`
 *      — the ratchet asserts every message has a key for every offered language.
 *
 * Adding a new message:
 *   1. Add a new key here via `en(...)`, which fills every offered language
 *      with the TODO marker until a translation lands.
 *   2. Call `getCoachingMessage('<your.key>', languageCode)` at the
 *      emit site. The ratchet test below catches any
 *      `WhatsAppService.sendMessage(..., '<English literal>')` in
 *      `bot/shared/services/coaching/` so this catalog stays the
 *      single source of truth.
 *
 * Why placeholders are English (not empty):
 *   We never want a missing translation to silently send a blank
 *   message. Falling back to English keeps the feature working until
 *   the translation lands.
 */

// Derived from the language registry rather than restated. This was a
// ten-code array — the second-largest of the competing language lists the audit
// found — and every non-English value in the catalog below is still the TODO
// sentinel, so all ten codes already fell back to English. Narrowing it to the
// deployment's offer is therefore structural, not behavioural: nothing a teacher
// receives changes, and the list can no longer disagree with the pickers.
const { LANGUAGE_OFFER } = require('./languages');

const SUPPORTED_LANGUAGES = [...LANGUAGE_OFFER];

// Sentinel — every non-`en` value below starts here as a placeholder.
// Translations replace these in-place; the helper falls back to `en`
// for any value that still equals the sentinel string.
const TODO = '__TODO_TRANSLATE__';

function en(text) {
  return Object.fromEntries(SUPPORTED_LANGUAGES.map((code) => [code, code === 'en' ? text : TODO]));
}

const COACHING_MESSAGES = {
  // Lesson-plan branch: teacher said NO lesson plan
  lessonPlan_skip: {
    ...en("No problem! I'll analyze your classroom audio without the lesson plan."),
    ur: 'کوئی بات نہیں! سبق کے منصوبے کے بغیر ہی کلاس روم آڈیو کا تجزیہ کیا جائے گا۔',
  },
  // Lesson-plan branch: teacher said yes but didn't send the document
  lessonPlan_request: {
    ...en("Great! Please send your lesson plan as a document (PDF, Word, or image).\n\nTap 📎 → Document to upload it."),
    ur: 'بہت خوب! اپنا سبق کا منصوبہ بطور دستاویز بھیجیں (PDF، Word یا تصویر)۔\n\nاپلوڈ کے لیے 📎 → Document پر ٹیپ کریں۔',
  },
  // Lesson-plan branch: a recent Taleemabad LP was linked from the selection list
  // (bd-wa5io — the fidelity pass scores against exactly this plan).
  lessonPlan_linked: {
    ...en("✅ Lesson plan linked! I'll compare your teaching against this plan in the analysis."),
    ur: '✅ سبق کا منصوبہ منسلک ہو گیا! تجزیے میں تدریس کا موازنہ اسی منصوبے سے کیا جائے گا۔',
  },
  // Lesson-plan branch: a late LP tap after the observer's review was submitted
  // (bd-2kxxa.4). The list stays in the chat; once the review is in, the linked
  // plan can no longer change — say so instead of a "linked" that changes nothing.
  lessonPlan_review_submitted: {
    ...en("This observation's review has already been submitted, so I can't change its lesson plan."),
    ur: 'اس مشاہدے کا جائزہ پہلے ہی جمع ہو چکا ہے، اس لیے اب اس کا سبق کا منصوبہ تبدیل نہیں کیا جا سکتا۔',
  },
  // Lesson-plan branch: document received, queued for processing
  lessonPlan_received: {
    ...en("📄 Lesson plan received! I'm processing it in the background and will weave it into your analysis."),
    ur: '📄 سبق کا منصوبہ موصول ہو گیا! اسے پس منظر میں پڑھا جا رہا ہے اور تجزیے میں شامل کر دیا جائے گا۔',
  },
  // Lesson-plan branch: the uploaded document doesn't look like a lesson plan
  // (e.g. a leave letter). We still analyse the recording; we just can't use
  // this file as a plan. (field report — Irum, ICT, DC-9.)
  lessonPlan_notLessonPlan: {
    ...en("📄 Thanks — but this file doesn't look like a lesson plan, so I won't reference it. I'll go ahead and analyse your classroom recording. If you meant to send a lesson plan, please resend it as a PDF, Word file, or clear page photos."),
    ur: '📄 شکریہ — مگر یہ فائل سبق کے منصوبے جیسی نہیں لگتی، اس لیے اس کا حوالہ نہیں دیا جائے گا۔ آپ کی کلاس روم ریکارڈنگ کا تجزیہ جاری رہے گا۔ اگر سبق کا منصوبہ بھیجنا تھا تو اسے دوبارہ بھیج دیں — PDF، Word فائل یا صفحات کی صاف تصویروں کی صورت میں۔',
  },
  // Lesson-plan branch: legacy ack
  lessonPlan_included: {
    ...en("✅ Lesson plan received! I'll include this in my analysis."),
    ur: '✅ سبق کا منصوبہ موصول ہو گیا! اسے تجزیے میں شامل کر لیا جائے گا۔',
  },
  // Recovery: teacher exited the coaching flow without sending audio
  exitedNoAudio: {
    ...en("No problem! If you'd like to analyze classroom audio in the future, just send me a recording."),
    ur: 'کوئی بات نہیں! آئندہ کبھی کلاس روم آڈیو کا تجزیہ کروانا ہو تو صرف ریکارڈنگ بھیج دیں۔',
  },
  // A new classroom recording arrived while an analysis is already running for
  // her — reassure, don't restart (field report — M. Salman, ICT, DC-5).
  // bd-0c80s: nothing re-queues a deferred recording — after the 30-minute
  // mid-flight window the ONLY path to a report is the teacher resending, so
  // the ack must say so instead of promising "no need to resend".
  // bd-h9gnk: the watchdog's loud failure — honest, and asks for a resend.
  coaching_analysisStalledFail: {
    ...en("😔 I'm sorry — something went wrong while analysing your classroom recording and I couldn't finish your report. Please send the recording again and I'll start fresh."),
    ur: '😔 معذرت — آپ کی کلاس ریکارڈنگ کے تجزیے میں مسئلہ آ گیا اور رپورٹ مکمل نہ ہو سکی۔ براہِ کرم ریکارڈنگ دوبارہ بھیجیں، میں نئے سرے سے تجزیہ کروں گی۔',
  },
  coaching_stillAnalysing: {
    ...en("⏳ I'm still analysing your previous recording. If your report hasn't arrived in 30 minutes, please send this recording again."),
    ur: '⏳ میں ابھی آپ کی پچھلی ریکارڈنگ کا تجزیہ کر رہی ہوں۔ اگر 30 منٹ میں رپورٹ نہ ملے تو براہِ کرم یہ ریکارڈنگ دوبارہ بھیج دیں۔',
  },
  // Step 1/5 — transcription kickoff.
  //
  // DC row 129 residue: this used to promise "30-60 seconds", and the
  // Urdu "تقریباً ایک منٹ" (about one minute). Both were wrong by more than an
  // order of magnitude, for every teacher who has ever seen this message:
  // CLASSROOM_AUDIO_THRESHOLD = 900 means nothing SHORTER than 15 minutes is
  // routed into this job, and sqs-worker.js measured 28 transcription runs in the
  // 880-990s band over nine days — which is why its visibility extension is now
  // unconditional at 1200s. The "Long Lesson Detected" warning that used to
  // follow was the only thing walking the promise back, and bd-di5ap correctly
  // removed it (it fired on 58% of sessions — an engineering threshold, not a
  // teacher-meaningful one). That left the promise standing alone, so it is
  // fixed here instead of being patched one message later.
  //
  // "up to 15 minutes" is the measured band, not a guess. The teacher is also
  // told she does not have to sit and watch — the pipeline messages her at every
  // step, and this is the longest silence in it.
  //
  // The step counter reads `مرحلہ ⁦1/5⁩` — standard digits, only the LABEL
  // translated. That is DC row 131, and it now applies to all five steps, so the
  // `۱ از ۵` form this comment used to defend is gone.
  //
  // The digits are wrapped in LRI (U+2066) … PDI (U+2069). `1/5` is a neutral
  // run with a neutral separator, and an RTL paragraph reorders such a run — the
  // same reason `coaching_confirmAudio` isolates its `{minutes}`. The isolate is
  // invisible in review and easy to drop on the next edit, so
  // bd-jbjrx-step-language.test.js asserts the pair on every one of the five.
  //
  // Keep the literal `N/5` intact: AnalysisProcessorService.sendProgressUpdate
  // renumbers a non-2 step by replacing `2/5`, which silently no-opped for the
  // whole life of the `۲ از ۵` form.
  step1_transcribing: {
    ...en("🔄 Step 1/5: Transcribing your classroom audio. For a full lesson this can take up to 15 minutes — no need to wait here, I'll message you as each step finishes."),
    ur: '🔄 مرحلہ ⁦1/5⁩: آپ کی کلاس روم آڈیو کو تحریر میں منتقل کیا جا رہا ہے۔ مکمل سبق کے لیے اس میں 15 منٹ تک لگ سکتے ہیں — یہیں انتظار کرنے کی ضرورت نہیں، ہر مرحلہ مکمل ہونے پر اطلاع دی جائے گی۔',
  },
  // Step 2/5 — pedagogy analysis kickoff (templated; `${step}` resolved by caller via interpolation OR by passing the number 2 when constant)
  step2_analyzing: {
    ...en("🔄 Step 2/5: Analyzing your teaching using research-based pedagogical frameworks..."),
    ur: '🔄 مرحلہ ⁦2/5⁩: تحقیق پر مبنی تدریسی فریم ورک کے ذریعے آپ کی تدریس کا تجزیہ کیا جا رہا ہے...',
  },
  // Step 3/5 — reflective conversation kickoff
  step3_reflecting: {
    ...en("🔄 Step 3/5: Let's reflect on your teaching together..."),
    ur: '🔄 مرحلہ ⁦3/5⁩: آئیے مل کر آپ کی تدریس پر غور کریں...',
  },
  // Step 4/5 — report generation kickoff
  step4_generatingReport: {
    ...en("🔄 Step 4/5: Generating your comprehensive observation report with visualizations..."),
    ur: '🔄 مرحلہ ⁦4/5⁩: خاکوں کے ساتھ آپ کی مکمل مشاہدہ رپورٹ تیار کی جا رہی ہے...',
  },
  // Step 5/5 — voice debrief generation kickoff
  step5_voiceDebrief: {
    ...en("🔄 Step 5/5: Creating your personalized voice debrief..."),
    ur: '🔄 مرحلہ ⁦5/5⁩: آپ کے لیے آواز میں خصوصی خلاصہ تیار کیا جا رہا ہے...',
  },
  // Final report delivery
  reportReady: {
    ...en("✅ Your Classroom Observation Report is ready! 📄"),
    ur: '✅ آپ کی کلاس روم مشاہدہ رپورٹ تیار ہے! 📄',
  },
  // bd-sk206 (feedback row 132): `voiceSummaryReady` — "🎤 Here's your personalized
  // voice summary:" — is GONE, not merely unused. Its Urdu restated step5_voiceDebrief
  // almost word for word (both "a summary … in audio", differing only in verb aspect at
  // the end of the sentence), so an Urdu teacher read Step 5 as the same message sent
  // twice. The audio now follows the Step 5/5 announcement with no caption in between.
  // Do not reinstate a caption here without re-reading that row: any second Step-5 line
  // has to be distinguishable from the announcement in URDU, at the FRONT of the string.
  // Reflective conversation graceful close. Urdu translation so the
  // fallback closer isn't voiced in English (gender-neutral — no addressee-gendered
  // verb). The primary closer is now the contextual acknowledgement (voiced).
  reflectionsThanks: { ...en("Thank you for your thoughtful reflections! 🙏"), ur: "آپ کے سوچ بھرے جوابات کا شکریہ! 🙏" },
  // Retry path: analysis still running when report is requested
  reportInProgress: {
    ...en("🔄 I'm still processing your classroom analysis. I'll share your report as soon as it's ready."),
    ur: '🔄 آپ کے کلاس روم تجزیے پر کام جاری ہے۔ رپورٹ تیار ہوتے ہی بھیج دی جائے گی۔',
  },
  // Voice debrief fallback when generation fails post-PDF
  voiceSummaryFallback: {
    ...en("Note: Voice summary could not be generated, but your written report is complete! You can review it in the PDF above. 📄"),
    ur: 'نوٹ: آواز کا خلاصہ تیار نہیں ہو سکا، مگر آپ کی تحریری رپورٹ مکمل ہے! اوپر دی گئی PDF میں اسے دیکھا جا سکتا ہے۔ 📄',
  },
  // There is deliberately NO post-transcription acknowledgement key here.
  //
  // bd-di5ap replaced the GPT-4o "encouraging message" with a fixed catalog
  // acknowledgement ("Transcription complete, {{name}}! You taught for N
  // minutes."). DC row 129 removed that too, by operator decision on 2026-09-20:
  // DC row 129 asked for the stretch between Step 1/5 and the photo prompt to
  // carry no extra messages at all, and an acknowledgement is still an extra
  // message. Transcription now runs straight into the photo prompt, which is
  // itself the teacher's signal that her audio arrived and was read.
  //
  // If a confirmation is ever wanted back here, it belongs in this catalog with
  // an `ur` variant from the start — the original defect was a model call with
  // no language instruction at all, and re-adding an English literal at the send
  // site would reopen it (the no-hardcoded-coaching-strings ratchet also refuses
  // that).
  // Agency follow-up: remind the teacher of their prior commitment.
  // {{action}} is substituted at the call site (kept distinct from
  // ${} JS interpolation so this string can be translated 1:1).
  priorActionReminder: {
    ...en('💡 *Quick reminder:* Last time, you committed to:\n\n_"{{action}}"_\n\nLet\'s see how it went in this session!'),
    ur: '💡 *مختصر یاد دہانی:* پچھلی بار آپ نے یہ عہد کیا تھا:\n\n_"{{action}}"_\n\nآئیے دیکھیں اس بار کیا ہوا!',
  },

  // ── The classroom-audio confirmation ──────────────────────────────────────
  // The most-sent message in the flow: every detected classroom recording is
  // followed by it. It was built from English literals inline, with no language
  // read anywhere on the path, on a deployment where almost every teacher reads
  // Urdu.
  //
  // `{minutes}` is interpolated at the call site (kept distinct from ${} JS
  // interpolation so the string can be translated 1:1). In the Urdu it is
  // wrapped in U+2066 … U+2069 — a bare digit run after an Urdu word gets
  // re-ordered by the bidi algorithm, and a catalog string isolates the
  // placeholder because the value's direction is unknowable at authoring time.
  //
  // Caps, in CODE POINTS: bodies 141 (en) / 120 (ur) of 1024; button titles
  // 12 (en) / 14 (ur) and 2 (en) / 4 (ur) of 20 — the button is the tightest
  // field there is, and a monolingual→bilingual edit is a length change first.
  coaching_confirmAudio: {
    ...en("I detected a {minutes}-minute audio recording.\n\nIs this classroom audio you'd like me to analyze using research-based pedagogical frameworks?"),
    ur: 'مجھے \u2066{minutes}\u2069 منٹ کی آڈیو ریکارڈنگ ملی ہے۔\n\nکیا یہ کلاس روم کی آڈیو ہے جس کا تجزیہ تدریسی فریم ورک کے مطابق کیا جائے؟',
  },
  coaching_confirmYes: { ...en('Yes, Analyze'), ur: 'جی، تجزیہ کریں' },
  coaching_confirmNo: { ...en('No'), ur: 'نہیں' },

  // ── The stale-session resume tap ──────────────────────────────────────────
  coaching_continueAllAnswered: {
    ...en('Great! All your reflections are recorded. Generating your coaching report now...'),
    ur: 'بہت خوب! آپ کے تمام جوابات محفوظ ہو گئے ہیں۔ کوچنگ رپورٹ اب تیار کی جا رہی ہے...',
  },
  coaching_sessionNotFound: {
    ...en('Sorry, I could not find that coaching session.'),
    ur: 'معذرت، وہ کوچنگ سیشن نہیں مل سکا۔',
  },
};

/**
 * Return the localised message for `key` in `languageCode`. Falls back
 * to English if the key isn't translated for that language (the
 * placeholder sentinel) or the language isn't supported.
 *
 * @param {string} key — one of the keys in COACHING_MESSAGES
 * @param {string} languageCode — e.g. 'en', 'ur', 'sw'
 * @returns {string}
 */
function getCoachingMessage(key, languageCode = 'en') {
  const entry = COACHING_MESSAGES[key];
  if (!entry) {
    throw new Error(`Unknown coaching message key: ${key}`);
  }
  const candidate = entry[languageCode];
  if (candidate && candidate !== TODO) return candidate;
  return entry.en;
}

module.exports = {
  COACHING_MESSAGES,
  SUPPORTED_LANGUAGES,
  TODO,
  getCoachingMessage,
};
