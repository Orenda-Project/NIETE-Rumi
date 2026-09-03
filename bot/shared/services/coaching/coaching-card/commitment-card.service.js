/**
 * Commitment Card Service.
 *
 * Generates the coaching-card CONTENT from the teacher's own reflective
 * conversation: her Q3 forward-commitment fused with ONE specific, lesson-rooted
 * action, via gpt-5-mini. Runs at report time (after the reflective conversation),
 * where `conversation_state.questions[2].answer` exists.
 *
 * Decisions baked in:
 *   - content = Q3 commitment + LLM action (not the rule-based focus tip)
 *   - language = determineOutputLanguage (passed in as `outputLanguage`)
 *   - gender-neutral — Urdu uses the RESPECTFUL آپ-imperative (کریں), never تم (کرو)
 *   - code-switch — pedagogical terms stay English inline (ur/sw/ar)
 *   - safe fallback — Q3 absent / LLM fails → rule-based prioritized-action card
 *
 * Returns { commitment, action, highlights[], lesson_label, language, _source } | null.
 */

const GPT5MiniService = require('../../gpt5-mini.service');
const { logToFile } = require('../../../utils/logger');
const { generatePrioritizedAction } = require('./prioritized-action.service');
const { simplifyPedagogyJargon } = require('../pedagogy-jargon');
const { resolveTarget, resolveIndicator } = require('../target-resolver');
const { tooSimilar, countBarFor, rubricAsk } = require('../uptake-loop.service');

/**
 * bd-2373: gloss any coach-jargon that slipped into the visible text so the
 * teacher can parse it ("scaffolding" → "scaffolding (step-by-step support)").
 * Applied to both the LLM and rule-based paths at their single return seam.
 */
function finalizeCard(card) {
  if (!card) return card;
  const lang = card.language || 'en';
  // bd-1t1wz (26-Aug audit): this path had only prompt-side code-switch rules,
  // and 22 of 22 transliteration leaks found across 200 prod sessions were in
  // commitment/action text (ورژن، فیڈبیک، چیلنجنگ…). Run the same deterministic
  // net the narrative pass uses — the regexes only match Arabic-script forms,
  // so en/sw text passes through untouched.
  const { fixCodeswitch } = require('../report-v2/narrative.service');
  if (typeof card.commitment === 'string') card.commitment = fixCodeswitch(simplifyPedagogyJargon(card.commitment, lang));
  if (typeof card.action === 'string') card.action = fixCodeswitch(simplifyPedagogyJargon(card.action, lang));
  if (card.action_spec && typeof card.action_spec === 'object') {
    for (const k of ['cue', 'move', 'model_line']) {
      if (typeof card.action_spec[k] === 'string') card.action_spec[k] = fixCodeswitch(simplifyPedagogyJargon(card.action_spec[k], lang));
    }
  }
  return card;
}

// ─── Feedback-uptake loop: the card knows the attempt and changes shape ──
//
// "It must not all sound the same." The same target, a different angle each
// attempt — the ladder is the record's `angle`; these are the shapes.
const ANGLE_INSTRUCTION = {
  tell: 'TELL — state the move plainly and the number to reach (the bar below). This is the first time she hears it; make the unit unmistakable.',
  cue: 'CUE — the SAME move, opened by an if-then on a moment she will recognise from THIS lesson: "Next class, when <a cue from this transcript>, <the move>". The cue must be real, from this lesson.',
  show: 'SHOW — give her one sentence to say, scripted from what she already said or nearly said in this lesson (adapt a real line), then the move. Put that sentence in model_line.',
  shrink: 'SHRINK — the smallest countable unit of this indicator: ONE <unit> in ONE named place in the lesson (e.g. the first wrong answer of the practice task). Make it almost impossible to miss.',
  hand_over: 'SHRINK — the smallest countable unit of this indicator: ONE <unit> in ONE named place in the lesson. Her coach will also pick this up with her in person; say so in one warm clause, never as a failure.',
};

function describeBar(bar) {
  return Object.entries(bar || {}).map(([k, v]) => `${k.replace(/_/g, ' ')} ≥ ${v}`).join(', ') || 'the rubric\'s rung-2 bar';
}

/**
 * Which indicator this card is about. With the loop on, the sticky loop
 * target (validated against THIS analysis) — except on a bridge lesson, where
 * the target does not apply and the card coaches this lesson's own indicator.
 * Without the loop, the scorer's validated focus_area.
 */
function cardTarget(analysis, loop) {
  if (loop && loop.state && loop.state.target && loop.state.target.indicator && !loop.state.bridge) {
    const t = resolveIndicator(analysis, loop.state.target.indicator);
    if (t) return t;
  }
  return resolveTarget(analysis);
}

function loopBlock(loop, target, langName) {
  if (!loop || !loop.state || !target) return '';
  const st = loop.state;
  const attempt = Number(st.attempt) || 1;
  const angle = ANGLE_INSTRUCTION[st.angle] ? st.angle : 'tell';
  const bar = countBarFor(target.indicator) || {};
  const prior = loop.prior || null;
  const bridge = st.bridge && prior && prior.target
    ? `\nBRIDGE LESSON: the open target ${prior.target.indicator} "${prior.target.name || prior.target.indicator}" does not apply to this lesson's subject, so THE TARGET above is a one-lesson bridge. End "action" with one short clause that ${prior.target.name || prior.target.indicator} returns in the next lesson where it applies.`
    : '';
  const priorLine = prior && prior.action
    ? `\nPRIOR ACTION FOR THIS TARGET (do NOT reuse this framing, its cue, or its example — a different way in): "${String(prior.action).replace(/\s+/g, ' ').trim()}"${prior.action_spec && prior.action_spec.model_line ? ` (its model line: "${prior.action_spec.model_line}")` : ''}`
    : '';
  return `
ATTEMPT ${attempt} · ANGLE "${angle}": ${ANGLE_INSTRUCTION[angle]}${bridge}
THE BAR the rubric sets for ${target.indicator} at rung 2: ${describeBar(bar)}.${priorLine}
Return ALSO "action_spec": {"cue": "<the if-then moment from this lesson, or empty>", "move": "<the ONE move, max 15 words>", "count_target": ${JSON.stringify(bar)}, "model_line": "<one sentence she can say, in ${langName}, or empty>"}.
`;
}

/** Three moves in one is not one move: numbered/bulleted lists or more than three sentences. */
function looksLikeManyMoves(text) {
  const s = String(text || '');
  const markers = (s.match(/(?:^|\s)(?:[1-9][.)]|[•\-–])\s/g) || []).length;
  if (markers >= 2) return true;
  const sentences = s.split(/[.!?۔]+\s+/).filter((x) => x.trim().length > 3).length;
  return sentences > 3;
}

/** The loop's structured action, validated: strings only, the bar always the rubric's. */
function normaliseSpec(raw, bar, action) {
  const spec = raw && typeof raw === 'object' ? raw : {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const same = spec.count_target && typeof spec.count_target === 'object'
    && Object.keys(bar).length === Object.keys(spec.count_target).length
    && Object.keys(bar).every((k) => Object.prototype.hasOwnProperty.call(spec.count_target, k));
  return {
    cue: str(spec.cue),
    move: str(spec.move) || String(action || '').trim(),
    count_target: same ? { ...bar } : { ...bar },
    model_line: str(spec.model_line),
  };
}

const MODEL = 'gpt-5-mini-2025-08-07';

const LANG_NAME = { sw: 'Kiswahili', ur: 'Urdu', en: 'English', ar: 'Arabic' };

// Per-language gender + code-switch guidance (mirrors the approved mock).
const GENDER_RULE = {
  ur: 'In Urdu the 2nd-person future (کریں گی / کریں گے, دیں گی) is gendered — DO NOT use it. Use the RESPECTFUL آپ-imperative (the -یں / -ائیں ending: کریں، دیں، آزمائیں، پوچھیں، رکھیں، لکھیں) which is both respectful AND gender-neutral. NEVER use the intimate تم-imperative (کرو، دو، پوچھو، لکھو) — it is disrespectful to a teacher.',
  ar: 'In Arabic the 2nd-person is gendered (تفعل masc / تفعلين fem). Avoid gendered 2nd-person by preferring the verbal noun / impersonal phrasing (e.g. "كتابة جملة"، "في الحصة القادمة: تقسيم الطلاب إلى أزواج"). Write respectfully and gender-neutrally.',
  sw: 'Swahili verbs are not gendered, so it is naturally neutral — just never add a gendered noun for the teacher.',
  en: 'English is gender-neutral; address as "you".',
};

const CODESWITCH_RULE = {
  ur: 'CONCRETE — get these right in BOTH the commitment AND the action: write "open-ended questions" NOT "کھلے سوال" and NOT "کھلے سوالات"; "conjunction" NOT "کنجنکشن"; "paragraph" NOT "پیراگراف"; "wait time" NOT "انتظار کا وقت". The connecting words (اگلی کلاس میں، جب، تو، دیں، لکھیں) stay Urdu; only the pedagogical TERM is English (Latin letters).',
  ar: 'CONCRETE — keep pedagogical/technical terms in English (Latin letters) inline: "open-ended questions", "conjunction", "paragraph", "pair reading", "wait time". The connecting Arabic words stay Arabic; only the pedagogical TERM is English. Do not transliterate them into Arabic script.',
  sw: 'CONCRETE — write "open-ended questions" NOT a Swahili paraphrase; "Think-Pair-Write" stays English. But established everyday Kiswahili words stay Kiswahili: mwangwi (echo), sentensi (sentence), ubao (board), wanafunzi (students).',
  en: 'Keep terms natural; no transliteration needed.',
};

/** A Q3 answer only counts as a commitment if she actually said something. */
function extractQ3(conversationState) {
  const qs = (conversationState && conversationState.questions) || [];
  if (!qs.length) return null;
  const q3 = qs.find((q) => String(q.question_number) === '3') || qs[qs.length - 1];
  if (!q3 || typeof q3.answer !== 'string' || q3.answer.trim().length < 3) return null;
  return q3;
}

/**
 * The scorer's ONE target, pinned into the prompt so the card's action is about
 * the same indicator the report's horizon names. Without it the LLM chose from
 * growth_opportunities (prompt-emit order) and the same report contradicted
 * itself. Null target → the prompt reads exactly as before.
 */
function targetBlock(target) {
  if (!target || !target.indicator) return '';
  const move = target.try ? ` The scorer's suggested move: "${target.try}".` : '';
  const why = target.rationale ? ` Why it is the next step: ${target.rationale}` : '';
  return `\nTHE TARGET (fixed — do NOT choose a different area): indicator ${target.indicator} "${target.name}".${why}${move} Your "action" is about THIS indicator only — ONE move, not a list of moves.\n`;
}

function buildPrompt(lang, analysis, q3, target = null, loop = null) {
  const langName = LANG_NAME[lang] || 'English';
  if (!target) target = cardTarget(analysis, loop);
  const strengths = (analysis.strengths || []).map((s) => s.title || s.analysis || s).slice(0, 3);
  const growth = (analysis.growth_opportunities || []).map((g) => ({
    area: g.area || g.title,
    observation: g.observation || '',
    strategy: (g.strategies || [])[0] || g.rationale || '',
  }));

  return `You are the NIETE Teaching Assistant, a warm teacher coach. Below is a REAL coaching session. Produce a short "commitment card" the teacher receives on WhatsApp after our reflective conversation.

WRITE ALL THREE TEXT FIELDS (commitment, action, lesson_label) IN ${langName.toUpperCase()} — this teacher's lesson and our whole conversation were in ${langName}. Natural, warm, native ${langName}.

GENDER-NEUTRAL — teachers are BOTH men and women. NEVER use gendered second-person verb forms. ${GENDER_RULE[lang] || GENDER_RULE.en}

CODE-SWITCH LIKE A REAL TEACHER TEXTS. Pedagogical / technical / subject-matter terms MUST appear in ENGLISH (Latin letters) inline — NEVER translate them into ${langName} and NEVER transliterate them into ${langName} script. Teachers SAY these in English even mid-sentence: open-ended questions, conjunction, paragraph, pair reading, Think-Pair-Share, wait time, objective, model, fractions, percentage, group work, peer feedback.
${CODESWITCH_RULE[lang] || CODESWITCH_RULE.en}

PLAIN LANGUAGE — the teacher must understand every word. Do NOT use coach-jargon she wouldn't say herself: "scaffolding", "extension", "differentiation", "formative assessment", "higher-order thinking", "metacognition", "gradual release". Describe the concrete move in plain words instead (e.g. instead of "scaffolding", write "break it into small steps"; instead of "an extension", write "a harder task for the ones who finish early").

The card has TWO parts:
1. "commitment" — a single warm sentence (max ~18 words) in the teacher's OWN spirit, reflecting back what SHE values, drawn from her Q3 answer (her forward-looking reflection). Address her as "you"/"we". No honorifics, no name inside it.
2. "action" — ONE specific, concrete thing to try in her NEXT class. It MUST be rooted in THIS exact lesson AND fuse her own value (from her Q3 answer + strengths) with ${target ? 'THE TARGET below' : 'the single highest-leverage growth area'}. Phrase it as an implementation intention anchored to next class ("Next class, when [trigger], [do X]") — but respect the gender-neutral rule above (imperative, not a gendered "you will"). Max ~32 words. Vivid and classroom-specific — name the actual materials/concept from THIS lesson. NOT generic.

Also return "highlights": an array of 2–4 short ${langName} keyword phrases that appear verbatim in "action" (concrete nouns) to visually emphasise. And "lesson_label": a 2–4 word ${langName} subject·topic label.

Session (framework: ${(analysis.framework || 'oecd').toUpperCase()}):${targetBlock(target)}${loopBlock(loop, target, langName)}
- Her strengths: ${strengths.join(' | ') || '(none captured)'}
- Growth areas: ${growth.map((g) => `${g.area} — ${g.observation} Strategy: ${g.strategy}`).join(' || ') || '(none)'}
- Q3 question we asked her: ${q3.question || '(n/a)'}
- Her Q3 answer (in ${langName}): "${String(q3.answer).slice(0, 400)}"

Return STRICT JSON only: {"commitment":"...","action":"...","lesson_label":"...","highlights":["...","..."]}`;
}

const ARABIC_SCRIPT = /[\u0600-\u06FF]/;
const RTL_LANGS = new Set(['ur', 'ar']);

/**
 * Does this text need a localisation pass to be read in `lang`? The scorer
 * writes focus_area in the language the STT labelled the lesson with, and the
 * card language is the teacher's preference — the two can disagree. Script is
 * the only signal we can check without a model: an Urdu/Arabic card needs
 * Arabic-script text, an English (or Latin-script) card must not carry it.
 */
function needsLocalisation(text, lang) {
  const hasArabic = ARABIC_SCRIPT.test(String(text || ''));
  return RTL_LANGS.has(lang) ? !hasArabic : hasArabic;
}

/**
 * One lightweight LLM pass that moves two visible strings into `lang`, keeping
 * pedagogical terms in English and the gender-neutral rule. Failure = the
 * original text is kept (a soft fallback: better the scorer's move in the
 * wrong script than the generic template).
 */
async function localisePair(commitment, action, lang) {
  try {
    const langName = LANG_NAME[lang] || 'the teacher\'s language';
    const codeSwitch = CODESWITCH_RULE[lang] || '';
    const genderRule = GENDER_RULE[lang] || '';
    const prompt = `Translate the following two teacher-coaching messages into ${langName}, warm and natural. Keep pedagogical/technical terms in ENGLISH (Latin letters) inline (e.g. "open-ended questions", "wait time", "scaffolding"). ${genderRule}\n\n${codeSwitch}\n\nReturn STRICT JSON: {"commitment":"...","action":"..."}.\n\nMESSAGES:\ncommitment: ${commitment}\naction: ${action}`;
    const r = await GPT5MiniService.openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(r.choices[0].message.content);
    return {
      commitment: parsed.commitment ? String(parsed.commitment).trim() : commitment,
      action: parsed.action ? String(parsed.action).trim() : action,
    };
  } catch (e) {
    logToFile('⚠️  Fallback card localisation failed — keeping source text', { error: e.message, lang });
    return { commitment, action };
  }
}

/**
 * No reflective answer (or the LLM card failed). The fallback of record is the
 * scorer's OWN move for its chosen indicator — focus_area.try_this_tomorrow —
 * which is specific, evidence-grounded and already in the lesson's language.
 * The rule template ("dedicate 5 minutes to X") is reached only when there is
 * no valid focus_area at all.
 */
async function fallbackCard(analysis, teacherName, priorAction, lang, loop = null) {
  const target = cardTarget(analysis, loop);
  if (target) {
    // The scorer's own move when it is about this target; with the loop on,
    // the rubric's own rung-2 ask for the target otherwise — never the generic
    // template while a real target exists.
    let source = null;
    let commitment = '';
    let action = '';
    if (target.try.trim().length >= 12) {
      source = 'focus_area';
      commitment = (target.title || target.name).trim();
      action = target.try.trim();
    } else if (loop) {
      const ask = rubricAsk(target.indicator);
      if (ask) { source = 'rubric'; commitment = target.name; action = ask; }
    }
    if (source) {
      if (needsLocalisation(action, lang)) {
        ({ commitment, action } = await localisePair(commitment, action, lang));
      }
      return {
        commitment,
        action,
        highlights: [],
        lesson_label: (analysis.framework || '').toUpperCase(),
        indicator: target.indicator,
        language: lang,
        ...(loop ? { action_spec: { cue: '', move: action, count_target: countBarFor(target.indicator) || {}, model_line: '' } } : {}),
        _source: source,
      };
    }
  }

  const pa = await generatePrioritizedAction(analysis, teacherName, priorAction);
  if (!pa) return null;

  // The rule-based path is authored in English. For non-English teachers,
  // localise the two visible fields so the card doesn't drop back into English.
  let commitment = pa.action;
  let action = pa.example;
  if (lang && lang !== 'en') {
    ({ commitment, action } = await localisePair(commitment, action, lang));
  }

  return {
    commitment,
    action,
    highlights: [],
    lesson_label: (analysis.framework || '').toUpperCase(),
    indicator: pa.indicator,
    language: lang,
    _source: 'fallback',
  };
}

/**
 * @param {object} analysis - enhancedAnalysis (framework + strengths + growth_opportunities)
 * @param {object} conversationState - coaching_sessions.conversation_state (has questions[])
 * @param {string} outputLanguage - language code (en/sw/ur/ar); falls back to en
 * @param {object} [opts] - { teacherName, priorAction }
 * @returns {Promise<object|null>}
 */
async function generateCommitmentCard(analysis, conversationState, outputLanguage = 'en', opts = {}) {
  const { teacherName = 'Teacher', priorAction = null, loop = null } = opts;
  const lang = (outputLanguage || 'en').slice(0, 2);
  if (!analysis) return null;

  const q3 = extractQ3(conversationState);
  if (!q3) {
    logToFile('Commitment card: no Q3 commitment → rule-based fallback', { framework: analysis.framework });
    return finalizeCard(await fallbackCard(analysis, teacherName, priorAction, lang, loop));
  }

  const target = cardTarget(analysis, loop);
  const bar = loop && target ? (countBarFor(target.indicator) || {}) : null;
  const ask = async (prompt) => {
    const r = await GPT5MiniService.openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(r.choices[0].message.content);
    if (!parsed.commitment || !parsed.action) throw new Error('incomplete card JSON (no commitment/action)');
    return parsed;
  };
  try {
    const prompt = buildPrompt(lang, analysis, q3, target, loop);
    let parsed = await ask(prompt);
    let similarToPrior = false;
    if (loop) {
      // Two guards, one regeneration at most: the action must be ONE move, and
      // it must not read like the prior action for the same target.
      const problems = (d) => ({
        many: looksLikeManyMoves(d.action),
        similar: !!(loop.prior && loop.prior.action && tooSimilar(loop.prior.action, d.action)),
      });
      const first = problems(parsed);
      if (first.many || first.similar) {
        const note = `\n\nREWRITE — your previous draft was rejected: ${first.many ? 'it contained more than ONE move (write exactly one); ' : ''}${first.similar ? 'it was too close to the prior action for this target (a different cue, a different example, a different shape); ' : ''}return a fresh "action" and "action_spec".`;
        logToFile('[uptake-loop] card draft regenerated once', { many: first.many, similar: first.similar });
        const second = await ask(prompt + note);
        const again = problems(second);
        if (first.many && again.many) {
          parsed = String(second.action).length < String(parsed.action).length ? second : parsed;
        } else {
          parsed = second;
        }
        similarToPrior = problems(parsed).similar;
      }
    }
    return finalizeCard({
      commitment: String(parsed.commitment).trim(),
      action: String(parsed.action).trim(),
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights.filter(Boolean) : [],
      lesson_label: parsed.lesson_label ? String(parsed.lesson_label).trim() : '',
      indicator: target ? target.indicator : undefined,
      language: lang,
      ...(loop && target ? { action_spec: normaliseSpec(parsed.action_spec, bar, parsed.action) } : {}),
      ...(similarToPrior ? { _similar_to_prior: true } : {}),
      _source: 'llm',
    });
  } catch (e) {
    logToFile('Commitment card LLM failed → rule-based fallback', { error: e.message });
    return finalizeCard(await fallbackCard(analysis, teacherName, priorAction, lang, loop));
  }
}

module.exports = { generateCommitmentCard, extractQ3, buildPrompt, needsLocalisation, looksLikeManyMoves, cardTarget, LANG_NAME };
