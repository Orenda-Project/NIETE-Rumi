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

// The one Urdu address rule every prompt that speaks TO a teacher or coach carries.
const { URDU_ADDRESS_RULE, URDU_THIRD_PERSON_RULE } = require('../../config/gender-neutral-address');

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
  // bd-b3pop: the grading's runs, spread and photo readings are telemetry, never guide material.
  const clone = require('../coaching/fidelity/fidelity-telemetry').stripFidelityTelemetry(JSON.parse(JSON.stringify(analysis)));
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

// ── Plain words, never codes (ur/en) ───────────────────────────────────
// The model copies the snake_case keys it is shown: notes on sandbox labelled their strengths "clear_objective:" and
// "story_connection:". The ur/en data block is therefore shown with plain-word keys ("student engagement", "focus
// area") and plain-word enum values ("not done"), and any key-shaped word still in the notes is made plain before the
// coach sees it. The Swahili prompt is untouched.
const CODE_WORD = /\b[a-z]+(?:_[a-z0-9]+)+\b/g;
const plainWord = (w) => w.replace(/_/g, ' ');

function _plainKeys(value) {
  if (Array.isArray(value)) return value.map(_plainKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[plainWord(k)] = _plainKeys(v);
    return out;
  }
  if (typeof value === 'string' && /^[a-z]+(?:_[a-z0-9]+)+$/.test(value)) return plainWord(value);
  return value;
}

function _plainText(s) {
  if (typeof s !== 'string') return s;
  return s.replace(CODE_WORD, (m, at) => {
    const w = plainWord(m);
    return at === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  });
}

/**
 * Key-shaped words ("clear_objective") left in the model's notes, as plain words ("Clear objective"). Only the
 * rubric-shaped notes (ur/en); any other shape is returned as it came.
 */
function plainCodeNames(guide) {
  if (!guide || !Array.isArray(guide.conversation)) return guide;
  const w = guide.work_on_first;
  return {
    ...guide,
    intro: _plainText(guide.intro),
    outro: _plainText(guide.outro),
    went_well: Array.isArray(guide.went_well) ? guide.went_well.map(_plainText) : guide.went_well,
    work_on_first: w && typeof w === 'object'
      ? Object.fromEntries(Object.entries(w).map(([k, v]) => [k, _plainText(v)])) : w,
    moment: guide.moment && typeof guide.moment === 'object' ? { ...guide.moment, text: _plainText(guide.moment.text) } : guide.moment,
    conversation: guide.conversation.map(_plainText),
  };
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
      ? `\nPREVIOUS VISIT (cross-session closure): last time the focus was "${previousFocus.title_sw || previousFocus.title || ''}" — the try was "${previousFocus.try_this_tomorrow_sw || previousFocus.try_this_tomorrow || ''}". Conversation line 1 MUST open by returning to that commitment ("Last time you said you would try…") before the new praise — the teacher should see their journey.\n`
      : '';
    return `You are the NIETE Teaching Assistant, preparing a school officer for their debrief conversation with a teacher they just observed. Build SHORT debrief notes from the observation data below (scores have been deliberately removed — the notes must NEVER contain or imply a number, score or percentage).

After the debrief, the officer's conversation is judged against a coaching rubric. These notes teach that rubric by example, so the officer knows beforehand what a good debrief does. THE SHAPE — four parts:
  1. "went_well" — ONE or TWO things that went well, never more: each a short label in plain ${langName} words, a colon, then what the teacher actually did, from the data. A label is never a code, a key or a word_with_underscores: write "Clear aim", never "clear_objective".
  2. "work_on_first" — exactly ONE thing to improve, framed as a teaching MOVE: "title" (a few words), "seen" (what the officer saw, from the data), "next_step" (one concrete move for next time; it is for the officer to know, not to say). The step must fit the moment's "answer": if it is "wrong", the step is to correct it kindly (thank the student, give the right answer or a hint, ask again); if "partly right", build on the right part; never build on a wrong answer as if it were right.
  3. "moment" — ONE real moment from the lesson to bring up, tied to work_on_first: "text" says what happened at that moment: the question asked, the student's answer and what the teacher did (quoted from the data where possible), not just a name. "answer": your own judgement of the student's answer at that moment, against the subject facts: "right", "partly right" or "wrong" (null when there is no answer to judge). The teacher's reaction is not the judgement: praise does not make an answer right (a wrong name, date or fact can still get «شاباش»). When it is "wrong", "text" must say so plainly and give the right answer when the fact is certain, and the step must correct it kindly. "time": the time of that moment (such as "17:25") ONLY if that exact time is in the data, otherwise null — never invent a time. If the data holds no clear moment, "moment" is null.
  4. "conversation" — what the officer can say, exactly 6 lines, in this order (the rubric):
     1. specific praise — open with one specific, real thing from this lesson, never a generic "well done".
     2. the real moment — name the moment from part 3 so the teacher knows exactly which one.
     3. ask, then wait — ONE open, reflective question about that moment; the officer then waits in silence for the answer.
     4. one improvement — name only the AREA from part 2 (e.g. "what to do when a student's answer is wrong"), never the step itself: the teacher names the step in line 5.
     5. the teacher names the step — an open question so the TEACHER says their own next step; the officer never supplies it.
     6. rehearse aloud — ask the teacher to say or do that step now, exactly as they will in class.
     Each line is only the words the officer says. No stage directions such as "(wait)": the app adds those.
${prevBlock}
Rules on every line: talk less — one or two short sentences, so the teacher does most of the talking; about the teaching moves, never about the teacher as a person; questions open, never yes/no, never leading, never "could you have done better". Plain words only: never a code, a key or a word_with_underscores from the data. Warm, specific, anchored ONLY to real moments in the data — if the data doesn't clearly support something, keep it general rather than inventing it. Write ALL text in ${langName}. Keep it SHORT: the whole notes, rendered, must stay under ${guideBudget(language)} characters — tight lines, no filler.
GENDER (mandatory): the officer AND the teacher may each be a man or a woman (مرد بھی ہو سکتے ہیں اور خاتون بھی) — never assume. Every "conversation" line is spoken TO the teacher, and every other line TO the officer, so all of them must be gender-neutral. ${URDU_ADDRESS_RULE} ${URDU_THIRD_PERSON_RULE}

Return JSON EXACTLY: { "intro": "<one short opening line to the officer>", "went_well": ["<label: what the teacher did>", "<optional second>"], "work_on_first": { "title": "<a few words>", "seen": "<what you saw>", "next_step": "<one move for next time>" }, "moment": { "time": "<the time from the data, or null>", "text": "<the moment>", "answer": "right"|"partly right"|"wrong"|null }, "conversation": ["<1 specific praise>", "<2 the real moment>", "<3 the open question>", "<4 the one improvement>", "<5 the question that lets the teacher name the step>", "<6 the ask to rehearse it aloud>"], "outro": "<one short closing line: no number to hand over>" }

OBSERVATION DATA (scores removed):
${JSON.stringify(_plainKeys(data))}
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
  const parts = [guide.intro || '', guide.outro || '', guide.reflection_question || ''];
  for (const s of guide.steps || []) {
    parts.push(s.title || '', s.body || '', s.say_this || '');
  }
  // bd-y7jr8: the score gate must see the new shape too, or a leaked number
  // would sail straight through the sections.
  const sec = guide.sections || {};
  for (const key of Object.keys(sec)) {
    const v = sec[key] || {};
    parts.push(v.title || '', v.body || '', v.say_this || '');
  }
  // The rubric-shaped notes (ur/en): every field the coach reads goes through the same gate.
  if (Array.isArray(guide.went_well)) parts.push(...guide.went_well.map((x) => String(x || '')));
  const w = guide.work_on_first || {};
  parts.push(w.title || '', w.seen || '', w.next_step || '', w.recall || '');
  const m = guide.moment || {};
  parts.push(m.text || '');
  if (Array.isArray(guide.conversation)) parts.push(...guide.conversation.map((x) => String(x || '')));
  return parts.join('\n');
}

// The 3+1 shape (Strengths / Growth / Action + one question) ur/en guides were written in before the
// rubric-shaped notes. Guides stored in it are still rendered; the model is no longer asked for it.
const GUIDE_SECTIONS = ['strengths', 'growth', 'action'];

// The six conversation lines of the ur/en notes, in the order of the coach-debrief rubric the coach is
// judged against afterwards. The wait cues are added here, by position, never by the model.
const CONVERSATION_STEPS = ['praise', 'moment', 'ask_wait', 'one_improvement', 'teacher_names', 'rehearse'];
const CONVERSATION_CUES = { ask_wait: 'guide_cue_wait', teacher_names: 'guide_cue_name_it', rehearse: 'guide_cue_rehearse' };

const _filled = (x) => typeof x === 'string' && x.trim().length > 0;

function _validateRubricShape(guide) {
  const conv = guide && guide.conversation;
  if (!Array.isArray(conv)) throw new Error('guide needs a conversation of six lines');
  if (conv.length !== CONVERSATION_STEPS.length) {
    throw new Error(`guide conversation must be six lines (got ${conv.length})`);
  }
  conv.forEach((line, i) => {
    if (!_filled(line)) throw new Error(`guide conversation line ${i + 1} is empty`);
  });
  const ww = guide.went_well;
  if (!Array.isArray(ww) || ww.length < 1 || ww.length > 2 || !ww.every(_filled)) {
    throw new Error('guide went_well must hold one or two items');
  }
  const w = guide.work_on_first;
  if (!w || !_filled(w.title) || !_filled(w.next_step)) {
    throw new Error('guide work_on_first needs title + next_step');
  }
  if (guide.moment != null && !_filled(guide.moment.text)) {
    throw new Error('guide moment needs text (or null)');
  }
}

function validateGuide(guide, S, language = 'sw') {
  // ur/en: the rubric-shaped notes (went well / work on first / a moment / six conversation lines).
  // sw (Tanzania) keeps the original 6-step script byte-for-byte — changing a live market's guide is
  // not in scope here.
  if (language === 'ur' || language === 'en') {
    _validateRubricShape(guide);
  } else {
    if (!guide || !Array.isArray(guide.steps) || guide.steps.length !== 6) {
      throw new Error('guide must have exactly 6 steps');
    }
    for (const s of guide.steps) {
      if (!s.title || !s.say_this) throw new Error('guide steps need title + say_this');
    }
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

const SECTION_EMOJI = { strengths: '💪', growth: '🌱', action: '📋' };

// One string from the coach's language pack, with the English pack as the floor (a guide rendered
// without S, or with a pack that predates a label, still reads).
function _label(S, key) {
  if (S && S[key]) return S[key];
  const { observeStrings } = require('./observe-strings');
  return observeStrings('en')[key] || '';
}

function _renderRubricShape(guide, S, lines) {
  lines.push(`💪 *${_label(S, 'guide_went_well_label')}*`);
  for (const item of guide.went_well || []) lines.push(`• ${item}`);
  lines.push('');

  const w = guide.work_on_first || {};
  lines.push(`🎯 *${_label(S, 'guide_work_on_label')}: ${w.title || ''}*`);
  if (_filled(w.seen)) lines.push(`${_label(S, 'guide_seen_label')} ${w.seen}`);
  if (_filled(w.next_step)) lines.push(`${_label(S, 'guide_next_label')} ${w.next_step}`);
  if (_filled(w.recall)) lines.push(w.recall.trim());
  lines.push('');

  const m = guide.moment;
  if (m && _filled(m.text)) {
    const time = _filled(m.time) ? ` (${m.time.trim()})` : '';
    const judged = m.answer === 'wrong' ? `: ${_label(S, 'guide_moment_wrong_label')}`
      : m.answer === 'partly right' ? `: ${_label(S, 'guide_moment_partly_label')}` : '';
    lines.push(`📍 *${_label(S, 'guide_moment_label')}${time}${judged}*`, m.text, '');
  }

  lines.push(`🗣 *${_label(S, 'guide_conversation_label')}*`);
  (guide.conversation || []).forEach((line, i) => {
    const cueKey = CONVERSATION_CUES[CONVERSATION_STEPS[i]];
    const cue = cueKey ? ` _${_label(S, cueKey)}_` : '';
    lines.push(`${i + 1}. "${String(line).trim()}"${cue}`);
  });
  lines.push('');
}

function renderGuideMessage(guide, S) {
  // A guide written whole (the /observe2 brief) is sent as written.
  if (guide && typeof guide.text === 'string' && guide.text) return guide.text;
  const lines = [`🌱 ${guide.intro || ''}`.trim(), ''];

  // The rubric-shaped notes (ur/en, current).
  if (Array.isArray(guide.conversation)) {
    _renderRubricShape(guide, S, lines);
    lines.push(`🔒 ${guide.outro || ''}`.trim());
    return lines.join('\n').trim();
  }

  // bd-y7jr8 — the 3+1 shape (guides stored before the rubric-shaped notes). Three headings she reads out, then the question
  // she ends on, so the teacher says the commitment in her own words.
  if (guide.sections) {
    for (const key of GUIDE_SECTIONS) {
      const sec = guide.sections[key];
      if (!sec) continue;
      lines.push(`${SECTION_EMOJI[key]} *${sec.title}*`);
      if (sec.body) lines.push(sec.body);
      if (sec.say_this) lines.push(`_"${sec.say_this}"_`);
      lines.push('');
    }
    if (guide.reflection_question) {
      lines.push(`❓ *${(S && S.guide_reflect_label) || 'Ask this last'}*`);
      lines.push(`_"${guide.reflection_question}"_`);
      lines.push('');
    }
  } else {
    guide.steps.forEach((s, i) => {
      lines.push(`${STEP_EMOJI[i]} *${s.title}*`);
      if (s.body) lines.push(s.body);
      if (s.say_this) lines.push(`_"${s.say_this}"_`);
      lines.push('');
    });
  }

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
  // It speaks the same rubric-shaped notes as the model: went well, work on
  // first, six conversation lines in rubric order (no moment: no model, no
  // moment to quote). The intros are unchanged, so a fallback stays countable.
  const seen = _cleanField(focus.rationale_sw || focus.rationale, '', 200);
  const praise = _cleanField(strength.evidence_sw || strength.evidence, '', 120);
  if (language === 'ur') {
    return {
      intro: 'استاد سے گفتگو کا خاکہ — تقریباً 15 منٹ۔ پہلے خوبیاں، بہتری کی صرف ایک بات۔',
      went_well: [strengthEvidence],
      work_on_first: {
        title: focusTitle,
        ...(seen ? { seen } : {}),
        next_step: tryThis,
      },
      moment: null,
      conversation: [
        `شکریہ کہ آپ نے مجھے کلاس میں آنے دیا۔ مجھے یہ بہت اچھا لگا: ${praise || strengthEvidence}`,
        `آئیں سبق کے ایک لمحے کو ساتھ دیکھیں: ${focusTitle}۔`,
        lever,
        `اگر ہم صرف ایک چیز پر کام کریں: ${focusTitle}۔`,
        'اگلی بار کیا مختلف کرنا ہے؟ اپنے الفاظ میں بتائیں۔',
        'یہ قدم ابھی مجھے کہہ کر دکھائیں، بالکل ویسے جیسے کلاس میں کہنا ہے۔',
      ],
      outro: 'استاد کو کوئی نمبر نہیں دینا — بس ایک سچی تعریف اور آزمانے کی ایک بات۔ 💛',
    };
  }

  return {
    intro: 'Your conversation guide — about 15 minutes. Strengths first, ONE move.',
    went_well: [strengthEvidence],
    work_on_first: {
      title: focusTitle,
      ...(seen ? { seen } : {}),
      next_step: tryThis,
    },
    moment: null,
    conversation: [
      `Thank you for having me in your classroom. I really liked this: ${praise || strengthEvidence}`,
      `Let's look together at one moment in the lesson: ${focusTitle}.`,
      lever,
      `If we work on just one thing: ${focusTitle}.`,
      'Next time, what will you do differently? Say it in your own words.',
      'Say it to me now, exactly as you will say it in class.',
    ],
    outro: 'No number to hand over — one true strength and one move to try together. 💛',
  };
}

// The model's judgement of the student's answer at the moment, kept only as one of three plain values.
const MOMENT_ANSWERS = { right: 'right', 'partly right': 'partly right', wrong: 'wrong' };

/**
 * The moment's "answer" (the model's own judgement of the student's answer, against the subject facts) as one of
 * "right", "partly right" or "wrong", else null. Notes without a moment, and other shapes, are returned as they came.
 */
function normaliseMomentAnswer(guide) {
  const m = guide && guide.moment;
  if (!m || typeof m !== 'object') return guide;
  const word = typeof m.answer === 'string' ? m.answer.trim().toLowerCase().replace(/[_-]+/g, ' ') : '';
  return { ...guide, moment: { ...m, answer: MOMENT_ANSWERS[word] || null } };
}

/**
 * A moment's time stays only when the observation data holds it, word for word: the model is told
 * never to invent one, and this is the check that it did not. Other guide shapes pass through.
 *
 * @param {object} guide        the guide as the model returned it
 * @param {object} v2Analysis   the analysis the guide was written from
 * @returns {object} the guide, with moment.time null when the data has no such time
 */
function groundMomentTime(guide, v2Analysis) {
  const m = guide && guide.moment;
  if (!m || !_filled(m.time)) return guide;
  const seenIn = JSON.stringify(_redactScores(v2Analysis));
  if (seenIn.includes(m.time.trim())) return guide;
  return { ...guide, moment: { ...m, time: null } };
}

module.exports = {
  GUIDE_SECTIONS,
  CONVERSATION_STEPS,
  groundMomentTime,
  plainCodeNames,
  normaliseMomentAnswer,
  GUIDE_CHAR_BUDGET,
  SUBJECT_FLAG_MIN_CONFIDENCE,
  buildGuidePrompt,
  validateGuide,
  renderGuideMessage,
  buildFallbackGuide,
};
