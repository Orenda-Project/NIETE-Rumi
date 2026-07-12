/**
 * Coaching Report v2 — Celebration Narrative pass.
 *
 * The ONE new generation step the hero report needs. Reads the transcript (source of
 * truth) + scores + the v12 reflective_corpus + the teacher's strengths/growth, and
 * emits the celebration copy that makes a teacher feel SEEN. Modeled on
 * `extractReflectiveCorpus` — a separate, purpose-built pass; the SCORING prompt
 * (analyzePedagogy) is NOT touched.
 *
 * Deliberately does NOT produce `try_next` — the report's "one thing to try next" is
 * the COMMITMENT-CARD action (single source of next-step truth).
 *
 * Output (stored at analysis_data.report_narrative):
 *   { topic, affirmation, identity, moments:[{title,quote,why}×3],
 *     strength_name, strength_note, horizon_title, horizon_note,
 *     journey_note, score_framing }
 *
 * Language: en/sw LTR, ur/ar RTL. Gender-neutral + code-switch pedagogical terms to
 * English inline (same rules as the commitment card), plus a deterministic
 * transliteration normalizer for RTL. Quotes are kept verbatim in the spoken language.
 */

const GPT5MiniService = require('../../gpt5-mini.service');
const { logToFile } = require('../../../utils/logger');
const { KISWAHILI_STYLE } = require('../kiswahili-style');

const LANG_NAME = { en: 'English', ur: 'Urdu', ar: 'Arabic', sw: 'Kiswahili' };
const RTL_LANGS = new Set(['ur', 'ar']);

function langRules(language) {
  if (language === 'ur') {
    return `WRITE every string value in URDU (Nastaliq), warm and natural — EXCEPT keep her real quotes verbatim in the language actually spoken, and EXCEPT the code-switched English terms below.

GENDER-NEUTRAL (teachers are men AND women — mandatory):
- Describe what she DID in PAST TENSE with نے (gender-neutral): "آپ نے جوڑا / آپ نے ماڈل کیا".
- NEVER feminine present-habitual stems ("کرتی ہیں / دیتی ہیں").
- Instructions use the RESPECTFUL آپ-imperative (کریں، دیں، پوچھیں) — never the intimate تم (کرو، دو).

CODE-SWITCH: keep pedagogical/technical/subject terms in ENGLISH (Latin letters) inline — never transliterate into Nastaliq (write "open-ended questions" not "کھلے سوال"; "scaffolding" not "اسکفولڈنگ"; "phonics", "context", "model" stay English).`;
  }
  if (language === 'ar') {
    return `WRITE every string value in MODERN STANDARD ARABIC, warm and natural — EXCEPT keep her real quotes verbatim in the language actually spoken, and keep pedagogical/technical terms in ENGLISH (Latin letters) inline (open-ended questions, scaffolding, phonics). Use gender-neutral phrasing (verbal nouns / impersonal constructions) rather than gendered second-person verb forms.`;
  }
  if (language === 'sw') {
    return `WRITE every string value in warm, natural KISWAHILI — EXCEPT keep her real quotes VERBATIM in the language actually spoken (Kiswahili stays Kiswahili, English stays English; never translate a quote).

Kiswahili is naturally gender-neutral — address her as "wewe"/"u-". Keep it warm and specific, never clinical.

CODE-SWITCH like a real Tanzanian teacher: keep pedagogical/technical terms in ENGLISH (Latin letters) inline rather than inventing Swahili calques — "formative assessment", "open-ended questions", "scaffolding", "think-pair-share", "group work", "gallery walk", "feedback". The connecting Kiswahili words stay Kiswahili.

${KISWAHILI_STYLE}`;
  }
  return 'Write every string value in warm, specific English.';
}

// Deterministic code-switch safety net for RTL (LLMs are ~90% consistent). Maps known
// Urdu transliterations of pedagogical terms back to English. Mirrors the explorer +
// commitment-card normalizers.
const TRANSLIT_FIX = [
  [/سائلنٹ\s*لیٹرز?/g, 'silent letters'],
  [/کنٹیکسٹ/g, 'context'],
  [/اسکی?فولڈنگ/g, 'scaffolding'],
  [/فونکس/g, 'phonics'],
  [/کھلے\s*سوالات?|اوپن\s*اینڈڈ\s*سوالات?/g, 'open-ended questions'],
  [/گائیڈڈ\s*پریکٹس/g, 'guided practice'],
];

function fixCodeswitch(s) {
  if (typeof s !== 'string') return s;
  return TRANSLIT_FIX.reduce((acc, [re, en]) => acc.replace(re, en), s);
}

function normalize(c, language) {
  if (!RTL_LANGS.has(language)) return c;
  for (const k of ['affirmation', 'identity', 'strength_name', 'strength_note', 'horizon_title', 'horizon_note', 'journey_note', 'score_framing', 'topic']) {
    if (c[k]) c[k] = fixCodeswitch(c[k]);
  }
  (c.moments || []).forEach((m) => { m.title = fixCodeswitch(m.title); m.why = fixCodeswitch(m.why); });
  return c;
}

// Resolve the domain with the lowest score/max ratio via the framework's score
// adapter. Framework-agnostic — returns { name, score, max, pct } or null when
// the analysis lacks domain data (e.g. legacy OECD "goals" shape). The narrative
// prompt uses this as the primary horizon focus so the "next horizon" naturally
// names the area with the biggest lift available, rather than growth_opportunities[0]
// which is prompt-emit-order-dependent (often arbitrary).
function pickWeakestDomain(analysis) {
  try {
    const { getScoreAdapter } = require('./score-adapters/dispatch');
    const framework = String((analysis && analysis.framework) || 'oecd').toLowerCase();
    const groups = getScoreAdapter(framework)(analysis || {});
    const valid = (groups || []).filter((g) => g && (g.max || 0) > 0);
    if (!valid.length) return null;
    const sorted = valid.slice().sort((a, b) => (a.pct || 0) - (b.pct || 0));
    return sorted[0];
  } catch (_e) {
    return null;
  }
}

function buildPrompt(analysis, { transcript, trend = [], language, teacherName }) {
  const a = analysis || {};
  const fw = (a.framework || 'hots').toUpperCase();
  const pct = Math.round(parseFloat(a.scores?.overall_percentage || 0));
  const sessionCount = trend.length || 1;
  const peak = trend.length ? Math.max(...trend.map((t) => Math.round(parseFloat(t.pct || 0)))) : pct;
  const corpus = a.reflective_corpus || {};
  const throughline = corpus.lesson_throughline_en || '';
  const corpusMoments = (corpus.significant_moments || []).slice(0, 5)
    .map((m) => `- ${m.what_happened || ''} (${m.significance_reason_en || ''})`).join('\n');
  const weakest = pickWeakestDomain(a);

  return `You are Rumi, a warm, perceptive instructional coach. Below is the FULL TRANSCRIPT of a real lesson by ${teacherName} plus its ${fw} rubric analysis. Write the words for a CELEBRATION report that makes this teacher feel truly SEEN — not graded like a medical report.

Use the TRANSCRIPT as source of truth. Find what is UNIQUELY hers — a signature move, how she talks to children, how she connects ideas — and ground every claim in something she actually did. Tie it to the ${fw} lens (clarity, student involvement, questioning, classroom management) honestly, but lead with humanity. Address her as "you".

NEVER emit rubric IDs, snake_case tokens, or programmatic identifiers as prose. If the analysis mentions an indicator like "step_by_step" or "guided_practice", write it out naturally ("step by step", "guided practice"). If it mentions "1.2 Fidelity to LP Steps", say "lesson-plan fidelity", not "1.2". The teacher never sees the raw rubric shape.

${langRules(language)}

Return STRICT JSON:
{
 "topic":"the lesson's topic in 2-4 words (in the report language)",
 "affirmation":"ONE short, true, specific hero sentence — what she did beautifully today. Not generic. Max 14 words.",
 "identity":"2-3 sentences: the signature of HER teaching, grounded in the transcript. Make her see herself.",
 "moments":[{"title":"3-5 word title","quote":"a SHORT real quote kept VERBATIM in the language actually spoken","why":"one warm sentence on why it mattered"}],
 "strength_name":"her #1 ${fw} strength, 2-4 warm words",
 "strength_note":"one sentence celebrating it, grounded in what she did",
 "horizon_title":"her growth edge framed as an exciting next horizon, 2-5 words",
 "horizon_note":"one warm sentence naming the growth area without making her feel deficient",
 "journey_note":"one sentence on her ${sessionCount}-session arc (peaked at ${peak}%, keeps showing up). Honest + encouraging.",
 "score_framing":"one warm sentence framing overall ${pct}% as a stage in a journey, not a verdict."
}
moments: EXACTLY 3, the best real moments. Do NOT invent quotes — use real lines from the transcript.

${throughline ? `THIS LESSON'S THROUGHLINE (from prior analysis): ${throughline}\n` : ''}${corpusMoments ? `MOMENTS ALREADY SURFACED (hints — prefer these, but pull the verbatim quote from the transcript):\n${corpusMoments}\n` : ''}LESSON TOPIC: ${a.topic || ''}
${fw} summary: ${(a.executive_summary_sw || a.executive_summary || '').slice(0, 700)}
Strengths: ${(a.strengths || []).map((s) => s.title_sw || s.title || s).filter(Boolean).join('; ')}
${weakest
  ? `MANDATORY horizon focus — the LOWEST-SCORING domain this lesson is "${weakest.name}" at ${weakest.score}/${weakest.max} (${weakest.pct}%). Your "horizon_title" (2-5 words) MUST name a concrete sub-skill inside "${weakest.name}" — nothing from any other domain. The "horizon_note" must reference "${weakest.name}" or one of its indicators. Do not fall back to a generic aspirational phrase.`
  : `Growth signals from rubric analysis: ${a.growth_opportunities?.[0]?.area_sw || a.growth_opportunities?.[0]?.area || ''} — ${(a.growth_opportunities?.[0]?.rationale_sw || a.growth_opportunities?.[0]?.rationale || '').slice(0, 250)}`}
TRANSCRIPT:
${String(transcript || '').slice(0, 11000)}`;
}

/**
 * Generate the celebration narrative.
 * @param {object} analysis - analysis_data (framework, scores, strengths, growth_opportunities, reflective_corpus, …)
 * @param {object} opts - { transcript, trend, language, teacherName }
 * @returns {Promise<object|null>} celebration JSON (no try_next), normalized; null on failure.
 */
async function generateReportNarrative(analysis, opts = {}) {
  const { transcript = '', trend = [], language = 'en', teacherName = 'Teacher' } = opts;
  try {
    const prompt = buildPrompt(analysis, { transcript, trend, language, teacherName });
    const response = await GPT5MiniService.openai.chat.completions.create({
      model: 'gpt-5-mini-2025-08-07',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(response.choices[0].message.content);
    const narrative = normalize(parsed, language);
    // The report's next-step is the COMMITMENT-CARD action, not a field of this pass.
    // Strip any try_next the model volunteered so there's one source of next-step truth.
    delete narrative.try_next;
    // Guard: exactly 3 moments, each with the fields the template reads.
    narrative.moments = (narrative.moments || []).slice(0, 3).map((m) => ({
      title: m.title || '', quote: m.quote || '', why: m.why || '',
    }));
    narrative._language = language;
    return narrative;
  } catch (err) {
    logToFile('❌ generateReportNarrative failed', { error: err.message, framework: analysis?.framework, language });
    return null;
  }
}

module.exports = { generateReportNarrative, buildPrompt, LANG_NAME };
