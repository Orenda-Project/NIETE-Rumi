/**
 * FEAT-053 bd-22 — the debrief-guide builder (pure layer).
 *
 * Turns the observer's OWN edited analysis (v2) into a 6-step conversation
 * guide the FO reads — and keeps visible — while talking with the teacher
 * and recording the debrief (D24/D25: one WhatsApp text message, no Flow).
 *
 * The script structure and every gate below come from the P2 research pass —
 * Observe Build/DEBRIEF_GUIDE_DESIGN.md §3 (provenance per rule in §1/§8):
 *   · 6 steps: intent → evidence-praise → question+silence → ONE improvement
 *     → if-then commitment → agree the return
 *   · production 6-move grammar alignment (AFFIRM/ANCHOR/FOCUS/TRY-THIS/
 *     LEVER/COMMIT — _buildMewakaVoiceDebriefPrompt)
 *   · missioncomms gates (verbatim, #missioncomms 2026-05-20): no leading
 *     questions, no closed yes/no, judge the MOVES never the teacher,
 *     ≤~35 words per question
 *   · World Bank TZ CPD: never the "could you have done better" form
 *   · Aloyce: "takriban dakika N" — NEVER "karibu dakika N" (reads "welcome")
 *   · score-free: the number is noise (±3-mark band), never a verdict
 */

const GUIDE_CHAR_BUDGET = 1600;
// bd-62: Urdu (and English) guides run structurally longer than Swahili —
// the ur LLM output blew the 1600 cap on every attempt, silently forcing the
// fallback for ALL PK debriefs. sw keeps its original budget untouched.
const GUIDE_CHAR_BUDGET_BY_LANG = { sw: 1600, ur: 2200, en: 2200 };
const guideBudget = (language) => GUIDE_CHAR_BUDGET_BY_LANG[language] || GUIDE_CHAR_BUDGET;
const STEP_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];

// bd-23: only high-confidence subject flags reach the guide — precision over
// recall; a false "the teacher got the content wrong" poisons trust (D8).
const SUBJECT_FLAG_MIN_CONFIDENCE = 0.7;

function _highConfidenceSubjectFlags(analysis) {
  const flags = (analysis && analysis.subject_accuracy) || [];
  if (!Array.isArray(flags)) return [];
  return flags.filter(
    (f) => f && f.quote && f.correct_idea
      && Number(f.confidence) >= SUBJECT_FLAG_MIN_CONFIDENCE,
  );
}

// ── Score redaction ────────────────────────────────────────────────────
// The guide builder must never even SEE the marks — remove scores from the
// data block so no prompt-following failure can leak them.
function _redactScores(analysis) {
  if (!analysis || typeof analysis !== 'object') return {};
  const clone = JSON.parse(JSON.stringify(analysis));
  delete clone.scores;
  // Review fixes: performance_band is a score-derived verdict label (no
  // digit regex would catch it downstream); observer_edit_summary carries
  // edit counts; observer_debrief is bd-28 machinery — none belong in the
  // guide prompt.
  delete clone.performance_band;
  delete clone.observer_edit_summary;
  delete clone.observer_debrief;
  // bd-23: subject flags enter the prompt ONLY via the confidence-filtered
  // block below — never raw (low-confidence flags must not leak through).
  delete clone.subject_accuracy;
  if (clone.domains && typeof clone.domains === 'object') {
    for (const dom of Object.values(clone.domains)) {
      if (!dom || typeof dom !== 'object') continue;
      delete dom.domain_score;
      delete dom.domain_max;
      delete dom.area_score;
      delete dom.area_max;
      if (Array.isArray(dom.indicators)) {
        for (const ind of dom.indicators) delete ind.score;
      }
    }
  }
  return clone;
}

// ── Prompt ─────────────────────────────────────────────────────────────

function buildGuidePrompt(v2Analysis, options = {}) {
  const { language = 'sw', previousFocus = null, teacherContext = '' } = options;
  const data = _redactScores(v2Analysis);

  // FEAT-093 bd-53: ur/en officers get the language-parametric prompt; the
  // Swahili prompt below stays byte-identical (Tanzania untouched). Same
  // 6-step structure, same score-redaction, same JSON contract, same rules.
  if (language === 'ur' || language === 'en') {
    const langName = language === 'ur' ? 'Urdu (اردو)' : 'English';
    const prevBlock = previousFocus
      ? `\nPREVIOUS VISIT (cross-session closure): last time the focus was "${previousFocus.title_sw || previousFocus.title || ''}" — the try was "${previousFocus.try_this_tomorrow_sw || previousFocus.try_this_tomorrow || ''}". Step 2 MUST open by returning to that commitment ("Last time you said you would try…") before any new praise — the teacher should see their journey.\n`
      : '';
    return `You are Rumi, preparing a school officer for their debrief conversation with a teacher they just observed. Build a SHORT 6-step conversation guide from the observation data below (scores have been deliberately removed — the guide must NEVER contain or imply a number, score or percentage).

The 6 steps, in order: (1) open with intent, (2) praise ONE real moment with its evidence — quote the teacher's own words where possible, (3) ask ONE reflective question then STAY SILENT 30–60 seconds, (4) offer exactly ONE improvement framed as a teaching MOVE (never about the person), (5) invite the teacher to say an if-then commitment in their OWN words, (6) agree a return day.
${prevBlock}
Rules: warm, specific, anchored ONLY to real moments in the data — if the data doesn't clearly support a step, keep it generic rather than inventing a moment. Write ALL text in ${langName}. Keep it SHORT: the whole guide, rendered, must stay under ${guideBudget(language)} characters — tight lines, no filler.

Return JSON EXACTLY: { "intro": "<one opening line to the officer>", "steps": [ { "n": 1, "title": "<short title>", "body": "<short instruction to the officer>", "say_this": "<word-for-word example to say>" }, ... 6 steps ... ], "outro": "<closing line: no number to hand over — one true praise and one try>" }

OBSERVATION DATA (scores removed):
${JSON.stringify(data)}
${teacherContext}`;
  }

  const previousBlock = previousFocus
    ? `\nZIARA ILIYOPITA (PREVIOUS VISIT — cross-session closure):
Lengo la mara ya mwisho lilikuwa: "${previousFocus.title_sw || previousFocus.title || ''}" — jaribio: "${previousFocus.try_this_tomorrow_sw || previousFocus.try_this_tomorrow || ''}".
Hatua ya 2 IANZE kwa kurejea ahadi hiyo ("Mara ya mwisho ulisema utajaribu…") kabla ya sifa mpya — mwalimu aone safari yake.\n`
    : '';

  // bd-23: subject-knowledge joint-check — high-confidence flags only.
  const subjectFlags = _highConfidenceSubjectFlags(v2Analysis);
  const subjectBlock = subjectFlags.length
    ? `\nUSAHIHI WA MAUDHUI (subject_accuracy — jumuisha NDANI ya hatua ya 4, kama nyongeza fupi):
${subjectFlags.map((f) => `- Kauli: "${f.quote}" → wazo sahihi: ${f.correct_idea}`).join('\n')}
Iwasilishwe kama KUFIKIRI PAMOJA (sense-making together), kamwe si masahihisho wala lawama (never an accusation) — si mtihani (not a test) kwa mwalimu. Umbo: "Wakati fulani somo lilisema '…'. Inafaa kulithibitisha pamoja: [wazo sahihi]. Unaonaje?" Hili HALIINGII kamwe kwenye chochote kinachomfikia mwalimu kwa maandishi.\n`
    : '';

  const languageNote = language === 'sw'
    ? 'Andika KILA KITU kwa Kiswahili sanifu cha Tanzania.'
    : 'Write scaffold text (title, body, intro, outro) in English; keep every say_this line in Swahili (it is what the officer literally says to the teacher), followed by a short English gloss in brackets.';

  return `Wewe ni mkocha mwandamizi wa walimu Tanzania. Mwandalie AFISA WA UWANDANI (field officer) mwongozo wa mazungumzo ya kujenga (debrief) na mwalimu aliyemtembelea darasani. Afisa ataisoma ujumbe huu wakati ANAZUNGUMZA na mwalimu — kila hatua iwe fupi, ya kweli, na yenye ushahidi.

DATA YA UCHUNGUZI (toleo la afisa mwenyewe baada ya kuhariri — v2; alama zimeondolewa kwa makusudi):
${JSON.stringify(data, null, 2)}
${teacherContext ? `\nMUKTADHA: ${teacherContext}\n` : ''}${previousBlock}${subjectBlock}
MUUNDO WA HATUA 6 — fuata kabisa:
  1. FUNGUA KWA NIA — mshukuru mwalimu kwa kukukaribisha; tamka nia: "kwa ajili ya watoto, tusaidiane" — ubia (partnership), si ukaguzi.
  2. SIFA YENYE USHAHIDI — jambo MOJA la kweli alilofanya vizuri, likinukuu wakati mahususi kutoka kwenye data (AFFIRM + ANCHOR). Nukuu ushahidi neno-kwa-neno.
  3. SWALI, KISHA SUBIRA — swali MOJA la kutafakari, wazi (si la ndiyo/hapana), lisilohukumu; kisha mwambie afisa: SUBIRI KIMYA sekunde 30–60. Ukimya ndiko suluhisho lilipo. Anza na tathmini ya mwalimu mwenyewe ("Wewe mwenyewe, unaonaje…").
  4. JAMBO MOJA — eneo MOJA tu la kuboresha (kutoka focus_area), likiwa na ushahidi wake + jaribio moja madhubuti la kesho (try_this_tomorrow). Litolewe kama MWALIKO ("Vipi kesho ukijaribu…"), si amri.
  5. AHADI YA KAMA–BASI — mwalimu aseme mpango KWA MANENO YAKE, umbo la kama-basi: "Kesho, wakati [kitendo], nita[hatua]" (cue + hatua inayoonekana + muda).
  6. PANGA KUREJEA — kubalianeni lini mtaangalia pamoja tena — ukuaji, si ukaguzi.

KANUNI (kila moja ni LAZIMA):
- Maswali yote: wazi, ≤ maneno 35, hayamhukumu MWALIMU — yazungumzie HATUA (the moves), si mtu.
- Kamwe usitumie umbo "ungeweza kufanya nini vizuri zaidi?" ("what could you have done better?") — Tanzania linasomeka kama lawama, si msaada.
- Eneo la kuboresha ni MOJA tu (ONE) — kamwe si orodha.
- HAKUNA alama, namba za ufaulu, asilimia, au score popote — mwongozo hauna namba ya kumpa mwalimu.
- Ukirejea dakika ya somo, sema "takriban dakika 8" — KAMWE si "karibu dakika 8" (inasomeka kama karibu/welcome).
- Nukuu ushahidi neno-kwa-neno kutoka kwenye data — usimtungie mwalimu maneno.
- Sauti: joto, heshima, rafiki mwandamizi — feedback ni zawadi.

${languageNote}

TOA JSON yenye muundo huu HASA:
{ "intro": "<mstari 1 wa utangulizi kwa afisa>", "steps": [ { "n": 1, "title": "<kichwa kifupi>", "body": "<maelekezo mafupi kwa afisa>", "say_this": "<mfano wa kusema, neno-kwa-neno>" }, ... hatua 6 ... ], "outro": "<mstari wa kufunga: hakuna namba ya kumpa — sifa moja ya kweli na jaribio moja>" }
Urefu wote ukishaandikwa usizidi herufi ${GUIDE_CHAR_BUDGET}.`;
}

// ── Validation (programmatic gates, not prompt hopes) ─────────────────

const SCORE_PATTERNS = [
  /\d+\s*\/\s*\d+/,        // 40/75
  /\d+\s*%/,               // 53%
  /asilimia\s*\d+/i,       // asilimia 53
  /alama\s+\d+/i,          // alama 40
  /\bscore\s*[:\s]\s*\d+/i,
];

function _allGuideText(guide) {
  const parts = [guide.intro || '', guide.outro || ''];
  for (const s of guide.steps || []) {
    parts.push(s.title || '', s.body || '', s.say_this || '');
  }
  return parts.join('\n');
}

function validateGuide(guide, S, language = 'sw') {
  if (!guide || !Array.isArray(guide.steps) || guide.steps.length !== 6) {
    throw new Error('guide must have exactly 6 steps');
  }
  for (const s of guide.steps) {
    if (!s.title || !s.say_this) throw new Error('guide steps need title + say_this');
  }
  const text = _allGuideText(guide);
  for (const rx of SCORE_PATTERNS) {
    if (rx.test(text)) throw new Error(`guide leaks a score (${rx})`);
  }
  const rendered = renderGuideMessage(guide, S);
  const budget = guideBudget(language);
  if (rendered.length > budget) {
    throw new Error(`guide over budget/length: ${rendered.length} > ${budget}`);
  }
  return true;
}

// ── Render ─────────────────────────────────────────────────────────────

function renderGuideMessage(guide, S) {
  const lines = [`🌱 ${guide.intro || ''}`.trim(), ''];
  guide.steps.forEach((s, i) => {
    lines.push(`${STEP_EMOJI[i]} *${s.title}*`);
    if (s.body) lines.push(s.body);
    if (s.say_this) lines.push(`_"${s.say_this}"_`);
    lines.push('');
  });
  lines.push(`🔒 ${guide.outro || ''}`.trim());
  return lines.join('\n').trim();
}

// ── Deterministic fallback (no LLM) ────────────────────────────────────
// Partial upstream output must never leave the FO guideless mid-visit —
// same defensive stance as _buildMewakaVoiceDebriefPrompt's placeholders.

// Interpolated v2 fields are model-authored text copied from a live
// classroom transcript — they can carry digits or even score-shaped
// fragments ("wanafunzi 40", a quoted "alama 3"). Sanitize so the fallback
// passes the same gates the LLM path is validated against (review fix).
function _cleanField(value, fallbackText, max = 220) {
  let s = String(value || '').trim();
  if (!s) return fallbackText;
  for (const rx of SCORE_PATTERNS) s = s.replace(new RegExp(rx.source, `${rx.flags}g`), '');
  s = s.replace(/\s{2,}/g, ' ').trim();
  if (s.length > max) s = `${s.slice(0, max - 1)}…`;
  return s || fallbackText;
}

function buildFallbackGuide(v2Analysis, options = {}) {
  const { language = 'sw' } = options;
  const a = v2Analysis || {};
  const strength = (Array.isArray(a.strengths) && a.strengths[0]) || {};
  const focus = a.focus_area_sw || a.focus_area || {};

  const strengthEvidence = _cleanField(
    strength.evidence_sw || strength.evidence,
    language === 'sw' ? 'jambo moja zuri uliloliona darasani' : 'one good thing you saw in the classroom');
  const focusTitle = _cleanField(
    focus.title_sw || focus.title,
    language === 'sw' ? 'eneo moja la kuboresha' : 'one area to improve', 120);
  const tryThis = _cleanField(
    focus.try_this_tomorrow_sw || focus.try_this_tomorrow,
    language === 'sw' ? 'jaribio moja madhubuti kwa somo la kesho' : 'one concrete move for tomorrow');
  const LEVER_DEFAULT = {
    sw: 'Wewe mwenyewe, unaonaje somo lilikwendaje?',
    ur: 'آپ کو خود کیا لگا، سبق کیسا رہا؟',
    en: 'In your own view, how did the lesson go?',
  };
  const lever = _cleanField(
    focus.lever_question_sw || focus.lever_question,
    LEVER_DEFAULT[language] || LEVER_DEFAULT.sw, 160);

  if (language === 'sw') {
    return {
      intro: 'Mwongozo wa mazungumzo yako na mwalimu — dakika 15 hivi. Sifa kwanza, jambo MOJA.',
      steps: [
        { n: 1, title: 'Fungua kwa nia', body: 'Mshukuru kwa kukukaribisha darasani.', say_this: 'Asante kwa kunikaribisha — lengo langu ni tusaidiane kwa ajili ya watoto.' },
        { n: 2, title: 'Sifa yenye ushahidi', body: 'Taja jambo moja la kweli uliloliona.', say_this: `Nilipenda hili: ${strengthEvidence}` },
        { n: 3, title: 'Swali, kisha subira', body: 'Uliza, kisha subiri kimya sekunde 30–60 — usijaze ukimya.', say_this: lever },
        { n: 4, title: 'Jambo MOJA', body: `Eneo moja tu: ${focusTitle}. Litoe kama mwaliko.`, say_this: `Vipi kesho ukijaribu hili: ${tryThis}` },
        { n: 5, title: 'Ahadi ya kama–basi', body: 'Mwalimu aseme mpango kwa maneno yake mwenyewe.', say_this: 'Kesho, wakati gani hasa utajaribu hili? Sema kwa maneno yako.' },
        { n: 6, title: 'Panga kurejea', body: 'Kubalianeni siku ya kuangalia pamoja.', say_this: 'Tukutane tena wiki hii tuone pamoja — siku gani inakufaa?' },
      ],
      outro: 'Hakuna namba ya kumpa mwalimu — sifa moja ya kweli na jaribio moja tu. 💛',
    };
  }

  // bd-62: the non-sw fallback used to carry Kiswahili say_this lines — built
  // for TZ's English-locked officers, but served to PK officers too. Each
  // language now gets a natively-written scaffold; the teacher-facing lines
  // are in the officer's locked language (PK officers debrief in Urdu/English).
  if (language === 'ur') {
    return {
      intro: 'استاد سے گفتگو کا خاکہ — تقریباً 15 منٹ۔ پہلے تعریف، بہتری کی صرف ایک بات۔',
      steps: [
        { n: 1, title: 'نیت سے آغاز', body: 'کلاس میں خوش آمدید کہنے پر شکریہ ادا کریں۔', say_this: 'شکریہ کہ آپ نے مجھے کلاس میں آنے دیا — میرا مقصد ہے کہ ہم بچوں کے لیے مل کر کام کریں۔' },
        { n: 2, title: 'ثبوت کے ساتھ تعریف', body: 'سبق کا ایک حقیقی لمحہ نام لے کر سراہیں۔', say_this: `مجھے یہ بہت اچھا لگا: ${strengthEvidence}` },
        { n: 3, title: 'سوال، پھر خاموشی', body: 'ایک کھلا سوال پوچھیں، پھر 30–60 سیکنڈ خاموش رہیں۔', say_this: lever },
        { n: 4, title: 'صرف ایک بات', body: `صرف ایک شعبہ: ${focusTitle}۔ دعوت کے انداز میں پیش کریں۔`, say_this: `کیسا رہے اگر کل آپ یہ آزمائیں: ${tryThis}` },
        { n: 5, title: 'اگر–تو عزم', body: 'استاد اپنا منصوبہ اپنے الفاظ میں کہیں۔', say_this: 'کل، بالکل کس وقت یہ آزمائیں گے؟ اپنے الفاظ میں بتائیں۔' },
        { n: 6, title: 'واپسی طے کریں', body: 'مل کر طے کریں کہ دوبارہ کب دیکھیں گے۔', say_this: 'اسی ہفتے پھر ملتے ہیں، ساتھ دیکھیں گے — کون سا دن مناسب رہے گا؟' },
      ],
      outro: 'استاد کو کوئی نمبر نہیں دینا — بس ایک سچی تعریف اور آزمانے کی ایک بات۔ 💛',
    };
  }

  return {
    intro: 'Your conversation guide — about 15 minutes. Strengths first, ONE move.',
    steps: [
      { n: 1, title: 'Open with intent', body: 'Thank the teacher for welcoming you into the classroom.', say_this: 'Thank you for having me — my goal is that we help each other, for the children.' },
      { n: 2, title: 'Praise with evidence', body: 'Name one real thing you saw.', say_this: `I loved this moment: ${strengthEvidence}` },
      { n: 3, title: 'Ask, then wait', body: 'Ask one open question, then hold the silence 30–60 seconds.', say_this: lever },
      { n: 4, title: 'ONE thing', body: `Just one area: ${focusTitle}. Offer it as an invitation.`, say_this: `How about trying this tomorrow: ${tryThis}` },
      { n: 5, title: 'If-then commitment', body: 'Let the teacher say the plan in their own words.', say_this: 'Tomorrow, exactly when will you try this? Say it in your own words.' },
      { n: 6, title: 'Agree the return', body: 'Agree together when you will look at it again.', say_this: 'Let\'s meet again this week and look together — which day suits you?' },
    ],
    outro: 'No number to hand over — one true strength and one move to try together. 💛',
  };
}

module.exports = {
  GUIDE_CHAR_BUDGET,
  SUBJECT_FLAG_MIN_CONFIDENCE,
  buildGuidePrompt,
  validateGuide,
  renderGuideMessage,
  buildFallbackGuide,
};
