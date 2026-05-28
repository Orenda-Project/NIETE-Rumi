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

function buildPrompt(lang, analysis, q3) {
  const langName = LANG_NAME[lang] || 'English';
  const strengths = (analysis.strengths || []).map((s) => s.title || s.analysis || s).slice(0, 3);
  const growth = (analysis.growth_opportunities || []).map((g) => ({
    area: g.area || g.title,
    observation: g.observation || '',
    strategy: (g.strategies || [])[0] || g.rationale || '',
  }));

  return `You are Rumi, a warm teacher coach. Below is a REAL coaching session. Produce a short "commitment card" the teacher receives on WhatsApp after our reflective conversation.

WRITE ALL THREE TEXT FIELDS (commitment, action, lesson_label) IN ${langName.toUpperCase()} — this teacher's lesson and our whole conversation were in ${langName}. Natural, warm, native ${langName}.

GENDER-NEUTRAL — teachers are BOTH men and women. NEVER use gendered second-person verb forms. ${GENDER_RULE[lang] || GENDER_RULE.en}

CODE-SWITCH LIKE A REAL TEACHER TEXTS. Pedagogical / technical / subject-matter terms MUST appear in ENGLISH (Latin letters) inline — NEVER translate them into ${langName} and NEVER transliterate them into ${langName} script. Teachers SAY these in English even mid-sentence: open-ended questions, conjunction, paragraph, pair reading, Think-Pair-Share, wait time, objective, model, fractions, percentage, group work, peer feedback.
${CODESWITCH_RULE[lang] || CODESWITCH_RULE.en}

The card has TWO parts:
1. "commitment" — a single warm sentence (max ~18 words) in the teacher's OWN spirit, reflecting back what SHE values, drawn from her Q3 answer (her forward-looking reflection). Address her as "you"/"we". No honorifics, no name inside it.
2. "action" — ONE specific, concrete thing to try in her NEXT class. It MUST be rooted in THIS exact lesson AND fuse her own value (from her Q3 answer + strengths) with the single highest-leverage growth area. Phrase it as an implementation intention anchored to next class ("Next class, when [trigger], [do X]") — but respect the gender-neutral rule above (imperative, not a gendered "you will"). Max ~32 words. Vivid and classroom-specific — name the actual materials/concept from THIS lesson. NOT generic.

Also return "highlights": an array of 2–4 short ${langName} keyword phrases that appear verbatim in "action" (concrete nouns) to visually emphasise. And "lesson_label": a 2–4 word ${langName} subject·topic label.

Session (framework: ${(analysis.framework || 'oecd').toUpperCase()}):
- Her strengths: ${strengths.join(' | ') || '(none captured)'}
- Growth areas: ${growth.map((g) => `${g.area} — ${g.observation} Strategy: ${g.strategy}`).join(' || ') || '(none)'}
- Q3 question we asked her: ${q3.question || '(n/a)'}
- Her Q3 answer (in ${langName}): "${String(q3.answer).slice(0, 400)}"

Return STRICT JSON only: {"commitment":"...","action":"...","lesson_label":"...","highlights":["...","..."]}`;
}

/** Map the rule-based prioritized-action output into the commitment-card shape. */
async function fallbackCard(analysis, teacherName, priorAction, lang) {
  const pa = await generatePrioritizedAction(analysis, teacherName, priorAction);
  if (!pa) return null;
  return {
    commitment: pa.action,   // the rule-based focus becomes the headline
    action: pa.example,      // the concrete example becomes the action box
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
  const { teacherName = 'Teacher', priorAction = null } = opts;
  const lang = (outputLanguage || 'en').slice(0, 2);
  if (!analysis) return null;

  const q3 = extractQ3(conversationState);
  if (!q3) {
    logToFile('Commitment card: no Q3 commitment → rule-based fallback', { framework: analysis.framework });
    return fallbackCard(analysis, teacherName, priorAction, lang);
  }

  try {
    const prompt = buildPrompt(lang, analysis, q3);
    const r = await GPT5MiniService.openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(r.choices[0].message.content);
    if (!parsed.commitment || !parsed.action) throw new Error('incomplete card JSON (no commitment/action)');
    return {
      commitment: String(parsed.commitment).trim(),
      action: String(parsed.action).trim(),
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights.filter(Boolean) : [],
      lesson_label: parsed.lesson_label ? String(parsed.lesson_label).trim() : '',
      language: lang,
      _source: 'llm',
    };
  } catch (e) {
    logToFile('Commitment card LLM failed → rule-based fallback', { error: e.message });
    return fallbackCard(analysis, teacherName, priorAction, lang);
  }
}

module.exports = { generateCommitmentCard, extractQ3, buildPrompt, LANG_NAME };
