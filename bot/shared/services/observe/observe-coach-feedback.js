/**
 * FEAT-053 bd-28 — coach-the-coach feedback (pure layer).
 *
 * After the FO records the real debrief conversation, this layer turns the
 * transcript into developmental feedback FOR THE OFFICER: two wins + one try
 * (the prototype's approved card shape), scored internally against the
 * D27 officer rubric — 7 observable conversation behaviours traced to
 * Silverleaf's own words (coaching-hat-not-supervisor-hat, affirm-first with
 * real evidence, ONE customized issue) + the missioncomms gates + the
 * sense-making stance (silence, teacher's own judgment first).
 *
 * HARD RULE (D23/D27): the officer NEVER sees a score, rating, or rubric
 * internals — the rubric booleans persist only for the A/B study readout.
 */

const MIN_TRANSCRIPT_CHARS = 150;

// D27 — the 7 observable behaviours. Key order is the report order.
const RUBRIC_KEYS = [
  'opened_with_specific_praise', // a genuine, specific strength (not generic)
  'anchored_in_real_moment',     // feedback tied to a moment from THIS lesson
  'asked_and_waited',            // reflective question + space (teacher talk follows)
  'one_improvement_only',        // ONE improvement, no punch-list
  'moves_not_teacher',           // talked about the moves, never verdicts on the person
  'elicited_if_then',            // teacher's OWN if-then commitment, not dictated
  'righting_reflex_held',        // didn't lecture, take over, or answer own questions
  'disparaged_teacher',          // bd-30: belittled/insulted/judged the teacher as a person
];

/**
 * bd-30 — THE HARM GATE.
 *
 * Sabeena role-played an abusive officer ("your class was very bad", "you don't
 * know how to teach at all", "your class is filthy") and Rumi came back with
 * WIN: "Named concrete classroom evidence" — quoting the insult. It praised an
 * officer for mistreating a teacher.
 *
 * The rubric had ALREADY judged it correctly (moves_not_teacher=false). The bug
 * was that the feedback shape REQUIRED exactly 2 wins, so the model had to
 * manufacture praise and the only concrete material was the abuse.
 *
 * Wins are never mandatory. When the officer disparaged the teacher we owe them
 * honesty, not a compliment sandwich — and we owe the teacher never to have that
 * behaviour reinforced.
 */
function isHarmfulDebrief(rubric) {
  if (!rubric) return false;
  return rubric.disparaged_teacher === true || rubric.moves_not_teacher === false;
}

const RUBRIC_DEFINITIONS_SW = {
  disparaged_teacher: 'ALIMDHALILISHA mwalimu — matusi, dharau, au hukumu juu ya utu wake ("hujui kufundisha", "darasa lako ni chafu")',
  opened_with_specific_praise: 'Alifungua kwa sifa MAHUSUSI ya kweli (si sifa ya jumla)',
  anchored_in_real_moment: 'Alirejea wakati halisi wa somo hili (mwalimu anaweza kuukumbuka)',
  asked_and_waited: 'Aliuliza swali la kutafakari KISHA akasubiri — mwalimu alipata nafasi ya kuongea',
  one_improvement_only: 'Alitoa eneo MOJA tu la kuboresha — si orodha',
  moves_not_teacher: 'Alizungumzia HATUA za kufundisha, si hukumu juu ya mwalimu ("wewe ni…")',
  elicited_if_then: 'Mwalimu mwenyewe alisema ahadi yake (umbo la kama–basi), haikuamriwa',
  righting_reflex_held: 'Hakutoa hotuba, hakujibu maswali yake mwenyewe, hakuchukua mazungumzo',
};

/**
 * The analysis prompt. Consumes the debrief transcript, the guide the FO was
 * given, and (when available) diarization segments for timestamped evidence.
 */
const PROMPT_LANG_NAMES = { ur: 'Urdu (اردو)', en: 'English' };

/**
 * FEAT-093 bd-53 — the language-parametric coach-feedback prompt for markets
 * whose officers are locked to ur/en. The Swahili prompt below is UNTOUCHED
 * (Tanzania byte-identical). Every rule carries over 1:1: the officer rubric,
 * the HARM GATE (wins empty + honest concern when the officer disparaged the
 * teacher or made it personal), never-a-score, second person, the optional
 * value, and the exact same JSON contract.
 */
function buildCoachFeedbackPromptI18n(transcript, options = {}, lang = 'ur') {
  const langName = PROMPT_LANG_NAMES[lang] || 'English';
  return `You are Rumi, a warm coaching mentor for school leaders. An education officer (${options.foName || 'the officer'}) recorded their REAL debrief conversation with a teacher after observing a lesson. Read the transcript and coach THE OFFICER on how they coached.

SPEAK DIRECTLY TO THE OFFICER, in the SECOND PERSON ("you said…", "you asked…") — NEVER narrate them in the third person. Write ALL user-facing text in ${langName}.

First, silently judge the rubric (true/false each, internal only — never shown):
${RUBRIC_KEYS.map((k) => `- ${k}`).join('\n')}

THE HARD RULES (breaking any of these harms a real teacher):
1. If the officer DISPARAGED the teacher (insults, humiliation, "you don't know how to teach", "your class is filthy") or made it about the PERSON instead of the teaching moves — that is a HARMFUL debrief: "wins" MUST be an empty list, "praise_line" MUST be null, and "concern" MUST be filled honestly (what_happened + why it costs the teacher's trust + what to do instead). NEVER manufacture praise for cruelty.
2. If the debrief was respectful: exactly 2 wins, each quoting the officer's OWN words as evidence, plus ONE thing to try. "concern" is null.
6. "try" is a COACHING move for the officer's NEXT DEBRIEF — how they ask, wait, listen, sequence praise, or elicit the teacher's own commitment (e.g. "hold the silence after your question", "let the teacher say the plan in her own words"). It is NEVER classroom-teaching advice (pair work, seating, lesson activities — that belongs on the TEACHER's report, not on this card). "evidence" = the moment in THIS debrief that shows why (quote the officer's own words); "instead" = what to do differently in the next conversation.
3. NEVER include any number, score, percentage or grade about the officer.
4. If nothing clearly matches a field, use null/[] honestly — NEVER invent (a fabricated quote destroys the trust this tool runs on).
5. "value": the ONE value the officer's coaching most embodied — "imani" | "heshima" | "usikivu" | "ukuaji" | "ushirikiano" — or null if none is clearly visible. NEVER force one.

Return JSON with EXACTLY this structure:
{ "praise_line": "..." (or null if harmful), "wins": [ { "behaviour": "...", "evidence": "..." } ] (or [] if harmful), "concern": { "what_happened": "...", "why_it_matters": "...", "instead": "..." } (or null if not harmful), "try": { "move": "...", "evidence": "...", "instead": "..." }, "value": "imani"|"heshima"|"usikivu"|"ukuaji"|"ushirikiano"|null, "rubric": { ${RUBRIC_KEYS.map((k) => `"${k}": true/false`).join(', ')} } }

TRANSCRIPT OF THE OFFICER'S DEBRIEF:
${transcript}`;
}

function buildCoachFeedbackPrompt(transcript, options = {}) {
  const { guide = null, diarization = null, language = 'sw' } = options;

  const rubricBlock = RUBRIC_KEYS
    .map((k) => `  - "${k}": ${RUBRIC_DEFINITIONS_SW[k]}`)
    .join('\n');

  const guideBlock = guide
    ? `\nMWONGOZO ALIOPEWA AFISA KABLA YA MAZUNGUMZO (kulinganisha alichoambiwa na alichofanya):\n${JSON.stringify(guide, null, 2)}\n`
    : '';

  const diarizationBlock = diarization && Array.isArray(diarization.segments) && diarization.segments.length
    ? `\nVIPANDE VYA SAUTI (diarization, start_ms = mwanzo wa kipande kwa milisekunde — tumia kutaja "takriban dakika X"):\n${JSON.stringify(diarization.segments.slice(0, 200), null, 1)}\n`
    : '';

  const languageNote = language === 'sw'
    ? 'Andika maoni yote kwa Kiswahili sanifu, isipokuwa nukuu za ushahidi — zibaki neno-kwa-neno kama zilivyosemwa.'
    : 'Write the feedback in English; keep evidence quotes verbatim in the language actually spoken.';

  return `Wewe ni mkocha wa wakocha (coach-the-coach) Tanzania — unamsaidia AFISA WA UWANDANI kukua kama mkocha wa walimu. Umepokea rekodi ya mazungumzo yake halisi ya debrief na mwalimu. Kazi yako: maoni ya KUJENGA kwa afisa — kamwe si tathmini.

NAKALA YA MAZUNGUMZO YA DEBRIEF (afisa ↔ mwalimu):
${transcript}
${guideBlock}${diarizationBlock}
TATHMINI YA NDANI (haitaonyeshwa kwa afisa — kwa utafiti tu). Kwa kila kipengele, jibu true/false kwa ushahidi:
${rubricBlock}

═══ HATUA YA KWANZA — KIZUIZI CHA MADHARA (THE HARM GATE) ═══
Kwanza kabisa, jiulize: JE, AFISA ALIMDHALILISHA MWALIMU?
Dalili: matusi; dharau; hukumu juu ya UTU wake ("hujui kufundisha", "darasa lako ni chafu",
"somo lako lilikuwa baya sana"); kumkatiza kila mara; kumlaumu mbele ya wanafunzi.

KAMA NDIYO (disparaged_teacher = true):
  • USITOE "wins" HATA MMOJA. wins = [] (orodha tupu). Hii ni AMRI.
  • KAMWE usinukuu tusi kama kitu kizuri. Kumpongeza afisa kwa "kuwa mahususi"
    alipomtukana mwalimu ni kumtia moyo kuendelea kumdhuru. Ni marufuku kabisa.
  • USITOE praise_line. Iache tupu.
  • BADALA YAKE jaza "concern" (kwa upendo lakini kwa ukweli):
      - what_happened: mwambie AFISA moja kwa moja lililotokea ("Ulifungua mazungumzo kwa…"), ukinukuu maneno yake halisi.
      - why_it_matters: mwalimu anayeshambuliwa hujifunga; imani inavunjika; ukocha unakufa.
      - instead: angeweza kusema nini badala yake — eleza TUKIO, si mtu.
  • Endelea kutoa "try" — hatua moja ya kubadilisha.
  • Sauti: si ya kumhukumu afisa. Ni ya mwenzake anayemjali na anayemwambia ukweli.

KAMA HAPANA (mazungumzo yalikuwa ya heshima):
  • praise_line: pongezi MOJA ya joto, mahususi, kutoka kwenye rekodi.
  • wins: hatua MBILI (two) alizofanya vizuri — behaviour + evidence (nukuu halisi).
  • concern: iache tupu (null).
  • try: HATUA MOJA YA UKOCHA kwa DEBRIEF IJAYO — jinsi afisa anavyouliza, anavyosubiri
    kimya, anavyosikiliza, au anavyomwachia mwalimu kutamka ahadi yake mwenyewe (mf.
    "shikilia ukimya baada ya swali lako", "mwache mwalimu aseme mpango kwa maneno yake").
    KAMWE si ushauri wa ufundishaji darasani (kazi za jozi, mpangilio wa madawati, shughuli
    za somo — hayo yako kwenye ripoti ya MWALIMU, si kadi hii). move, evidence (nukuu ya
    afisa kutoka debrief HII; ukitaja dakika sema "takriban dakika X", KAMWE si "karibu
    dakika X"), instead (kama CHAGUO, si amri — la kufanya tofauti mazungumzo yajayo).

KANUNI (zote):
- ONGEA NA AFISA MOJA KWA MOJA, kwa NAFSI YA PILI (second person): "ulisema", "ulifanya", "ulimpokea" — KAMWE si kusimulia kwa nafsi ya tatu ("afisa alifanya", "afisa alisema"). Hii ni barua KWA afisa, si ripoti juu yake. Inahusu KILA sehemu: praise_line, wins, concern (what_happened/why_it_matters/instead), na try.
- KAMWE hakuna alama, namba, asilimia, au score juu ya afisa — popote.
- Ushahidi ni nukuu halisi kutoka kwenye nakala — usitunge.
- Zungumzia HATUA, si utu wa afisa.
- Usitengeneze sifa za uongo ili tu kujaza nafasi. Sifa isiyo ya kweli ni hatari kuliko ukimya.

${languageNote}

TOA JSON yenye muundo huu HASA:
{ "praise_line": "..." (au null kama kuna madhara), "wins": [ { "behaviour": "...", "evidence": "..." } ] (au [] kama kuna madhara), "concern": { "what_happened": "...", "why_it_matters": "...", "instead": "..." } (au null kama hakuna madhara), "try": { "move": "...", "evidence": "...", "instead": "..." }, "value": "imani" | "heshima" | "usikivu" | "ukuaji" | "ushirikiano" | null (THAMANI MOJA ambayo ukocha wa afisa uliidhihirisha zaidi — kama hakuna inayodhihirika kwa uwazi, value = null; KAMWE usibuni), "rubric": { ${RUBRIC_KEYS.map((k) => `"${k}": true/false`).join(', ')} } }`;
}

// ── Validation (programmatic gates) ────────────────────────────────────

const SCORE_PATTERNS = [
  /\d+\s*\/\s*\d+/,
  /\d+\s*%/,
  /asilimia\s*\d+/i,
  /alama\s+\d+/i,
  /\bscore\s*[:\s]\s*\d+/i,
];

function _allFeedbackText(fb) {
  const parts = [fb.praise_line || ''];
  for (const w of fb.wins || []) parts.push(w.behaviour || '', w.evidence || '');
  if (fb.concern) {
    parts.push(fb.concern.what_happened || '', fb.concern.why_it_matters || '', fb.concern.instead || '');
  }
  if (fb.try) parts.push(fb.try.move || '', fb.try.evidence || '', fb.try.instead || '');
  return parts.join('\n');
}

function validateCoachFeedback(fb) {
  // bd-44: the value is OPTIONAL decoration (D36) — normalize, never reject.
  {
    const { normalizeCoachValue } = require('./observe-coach-card');
    fb.value = normalizeCoachValue(fb.value);
  }
  if (!fb) throw new Error('feedback missing');

  // Rubric first — the harm gate is derived from it, so it must be complete.
  if (!fb.rubric || typeof fb.rubric !== 'object') throw new Error('rubric missing');
  for (const key of RUBRIC_KEYS) {
    if (typeof fb.rubric[key] !== 'boolean') {
      throw new Error(`rubric incomplete: ${key} must be judged true/false`);
    }
  }

  const harmful = isHarmfulDebrief(fb.rubric);

  if (harmful) {
    // bd-30: the officer mistreated the teacher. We do NOT congratulate that —
    // not with a manufactured "win", not with a warm opener wrapped round it.
    // This is a programmatic gate, not a prompt we hope the model obeys.
    if (Array.isArray(fb.wins) && fb.wins.length > 0) {
      throw new Error(
        'harmful debrief: wins must be EMPTY — never praise an officer for mistreating a teacher');
    }
    if (fb.praise_line) {
      throw new Error('harmful debrief: no celebratory praise_line — lead with the concern');
    }
    const c = fb.concern;
    if (!c || !c.what_happened || !c.why_it_matters || !c.instead) {
      throw new Error(
        'harmful debrief: concern required (what_happened + why_it_matters + instead)');
    }
  } else {
    if (!fb.praise_line) throw new Error('feedback needs a praise_line');
    if (!Array.isArray(fb.wins) || fb.wins.length !== 2) {
      throw new Error('feedback needs exactly 2 wins');
    }
    for (const w of fb.wins) {
      if (!w.behaviour || !w.evidence) throw new Error('each of the 2 wins needs behaviour + evidence');
    }
  }

  if (!fb.try || !fb.try.move || !fb.try.evidence) {
    throw new Error('feedback needs one try with move + evidence');
  }

  const text = _allFeedbackText(fb);
  for (const rx of SCORE_PATTERNS) {
    if (rx.test(text)) throw new Error(`feedback leaks a score on the officer (${rx})`);
  }
  return true;
}

// ── Render — the prototype's shape: warm praise bubble, then the card ──

function renderCoachFeedbackMessages(fb, S) {
  // bd-30 — the harmful path. No celebration card, no ✓ ticks, no manufactured
  // praise. An honest, warm concern that names what happened, says why it costs
  // the teacher's trust, and gives the move. Still never a score on the officer.
  if (isHarmfulDebrief(fb.rubric)) {
    const c = fb.concern || {};
    let hard = [
      `💬 *${S.coach_concern_title}*`,
      '',
      c.what_happened || '',
      '',
      c.why_it_matters || '',
      '',
      `🎯 *${S.coach_card_try_label}: ${fb.try.move}*`,
      c.instead || fb.try.instead || '',
      '',
      S.coach_concern_closing,
    ].filter((line, i, arr) => !(line === '' && arr[i - 1] === '')).join('\n').trim();
    if (hard.length > 4096) hard = `${Array.from(hard).slice(0, 4000).join('')}…`;
    return [S.coach_concern_opener, hard];
  }

  const praise = fb.praise_line;

  const winLines = fb.wins
    .map((w) => `✓ *${w.behaviour}*\n_"${w.evidence}"_`)
    .join('\n\n');

  let card = [
    `🌟 *${S.coach_card_title}*`,
    '',
    winLines,
    '',
    `🎯 *${S.coach_card_try_label}: ${fb.try.move}*`,
    fb.try.evidence,
    fb.try.instead || '',
    '',
    S.coach_card_closing,
  ].filter((line, i, arr) => !(line === '' && arr[i - 1] === '')).join('\n').trim();

  // WhatsApp hard cap is 4096 chars and sendMessage fails silently past it
  // (returns false, never throws) — truncate ONLY when genuinely over the cap,
  // and slice on code POINTS not UTF-16 units so an emoji surrogate pair can
  // never be split into a lone surrogate (which Meta may reject → SQS retry
  // loop). Re-verify fix.
  const WA_CAP = 4096;
  if (card.length > WA_CAP) {
    const closing = `\n…\n${S.coach_card_closing}`;
    const budget = WA_CAP - closing.length;
    const points = Array.from(card);            // code points, surrogate-safe
    let kept = '';
    for (const ch of points) {
      if (kept.length + ch.length > budget) break;
      kept += ch;
    }
    card = kept + closing;
  }

  return [praise, card];
}

module.exports = {
  buildCoachFeedbackPromptI18n,
  MIN_TRANSCRIPT_CHARS,
  RUBRIC_KEYS,
  isHarmfulDebrief,
  buildCoachFeedbackPrompt,
  validateCoachFeedback,
  renderCoachFeedbackMessages,
};
