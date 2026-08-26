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

// bd-2220 — we do NOT store a teacher's gender, so any third-person pronoun is
// the model guessing from a name or a voice. It guessed differently in different
// sentences, and teachers saw themselves called "he" in one line and "she" in the
// next (Qurat + Mubashar, ICT, 2026-07-21). The fix is not to guess better: the
// report is written TO the teacher, so second person is both correct and
// inherently genderless. Applies to every language — English had no pronoun
// guidance at all, which is where the alternation was most visible.
const PRONOUN_RULE = `
ADDRESS THE TEACHER DIRECTLY — NEVER IN THIRD PERSON (mandatory):
- Write TO her, as "you". Never refer to the teacher as "he", "she", "him", "her",
  "the teacher", or by name in the third person. We do not know her gender and
  must never guess it.
- WRONG: "The teacher asked good questions. She then moved on."
- RIGHT: "You asked good questions, then moved on."
- Third-person pronouns are fine for STUDENTS and for people quoted in the lesson.`;

function langRules(language) {
  if (language === 'ur') {
    return `WRITE every string value in URDU (Nastaliq), warm and natural — EXCEPT keep her real quotes verbatim in the language actually spoken, and EXCEPT the code-switched English terms below.

GENDER-NEUTRAL (teachers are men AND women — mandatory):
- Describe what she DID in PAST TENSE with نے (gender-neutral): "آپ نے جوڑا / آپ نے ماڈل کیا".
- NEVER feminine present-habitual stems ("کرتی ہیں / دیتی ہیں").
- Instructions use the RESPECTFUL آپ-imperative (کریں، دیں، پوچھیں) — never the intimate تم (کرو، دو).

CODE-SWITCH: keep pedagogical/technical/subject terms in ENGLISH (Latin letters) inline — never transliterate into Nastaliq (write "open-ended questions" not "کھلے سوال"; "scaffolding" not "اسکفولڈنگ"; "phonics", "context", "model" stay English).

KEEP CONCEPT NAMES IN ENGLISH — do NOT translate the pedagogical concept names in "strength_name", "horizon_title", the moment titles, or any section/framework label. Write them in natural English exactly as a teacher would say them. Concretely: write "Warm Questions" NOT "واضح گرم سوالات"; "Classroom" NOT "جماعتی پڑھائی"; "open-ended questions" NOT "کھلے اور سیدھے سوالات"; "Peer and Self Assessment" NOT a literal Urdu translation; "High-Leverage Practice" stays English. The warm PROSE around them (strength_note, horizon_note) is Urdu; the concept NAME stays English.

MOMENTS MUST BE SPECIFIC — every moment needs a real, meaningful detail or quote. Never a single vague word (e.g. "سادہ") that means nothing on its own.
${PRONOUN_RULE}`;
  }
  if (language === 'ar') {
    return `WRITE every string value in MODERN STANDARD ARABIC, warm and natural — EXCEPT keep her real quotes verbatim in the language actually spoken, and keep pedagogical/technical terms in ENGLISH (Latin letters) inline (open-ended questions, scaffolding, phonics). Use gender-neutral phrasing (verbal nouns / impersonal constructions) rather than gendered second-person verb forms.
${PRONOUN_RULE}`;
  }
  if (language === 'sw') {
    return `WRITE every string value in warm, natural KISWAHILI — EXCEPT keep her real quotes VERBATIM in the language actually spoken (Kiswahili stays Kiswahili, English stays English; never translate a quote).

Kiswahili is naturally gender-neutral — address her as "wewe"/"u-". Keep it warm and specific, never clinical.

CODE-SWITCH like a real Tanzanian teacher: keep pedagogical/technical terms in ENGLISH (Latin letters) inline rather than inventing Swahili calques — "formative assessment", "open-ended questions", "scaffolding", "think-pair-share", "group work", "gallery walk", "feedback". The connecting Kiswahili words stay Kiswahili.

${KISWAHILI_STYLE}
${PRONOUN_RULE}`;
  }
  return `Write every string value in warm, specific English.\n${PRONOUN_RULE}`;
}

// Deterministic code-switch safety net for RTL (LLMs are ~90% consistent). Maps known
// Urdu transliterations of pedagogical terms back to English. Mirrors the explorer +
// commitment-card normalizers.
const TRANSLIT_FIX = [
  [/سائلنٹ\s*لیٹرز?/g, 'silent letters'],
  [/کنٹیکسٹ/g, 'context'],
  [/اسکی?فولڈنگ/g, 'scaffolding'],
  [/فونکس/g, 'phonics'],
  [/کھلے\s*(?:اور\s*سیدھے\s*)?سوالات?|اوپن\s*اینڈڈ\s*سوالات?/g, 'open-ended questions'],
  [/گائیڈڈ\s*پریکٹس/g, 'guided practice'],
  // bd-2415 (row 15): literal Urdu translations of pedagogical/section terms the
  // LLM produced despite the code-switch rule — normalize back to English.
  [/جماعتی\s*پڑھائی/g, 'classroom'],
  [/(?:واضح\s*)?گرم\s*سوالات?/g, 'warm questions'],
  [/پیر\s*اور\s*سیلف\s*اسسمنٹ/g, 'peer and self assessment'],
  // bd-1t1wz (26-Aug audit of 200 prod sessions): every transliteration that
  // escaped the net — all of them in the commitment/action text, which had no
  // deterministic net at all — plus two bad literal translations the operator
  // sighted in the field. Order matters: plural before singular.
  [/ورژنز/g, 'versions'],
  [/ورژن/g, 'version'],
  [/فیڈ\s*بیک/g, 'feedback'],
  [/چیلنجنگ/g, 'challenging'],
  [/ماڈلنگ/g, 'modeling'],
  [/پریکٹس/g, 'practice'],
  [/ریئل\s*لائف/g, 'real-life'],
  [/ون\s*بائی\s*ون/g, 'one-by-one'],
  [/ویٹ\s*ٹائم/g, 'wait time'],
  [/انتظار\s*کا\s*وقت/g, 'wait time'],
  [/گرم\s*(?:الفاظ|جملے)/g, 'warm words'],
  [/کھلے\s*جوابات/g, 'open-ended questions'],
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
  // bd-1t1wz: per-domain "why" diagnosis lines get the same RTL code-switch net
  // (ports the main bot's bd-43483 normalize).
  if (c.domain_whys && typeof c.domain_whys === 'object') {
    for (const k of Object.keys(c.domain_whys)) c.domain_whys[k] = fixCodeswitch(c.domain_whys[k]);
  }
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

  // bd-1t1wz (ports the main bot's bd-43483, "every domain explains itself"):
  // ask for a one-line PAST-TENSE diagnosis per FICO section — why the score
  // landed where it did and what was missing for full marks — for BOTH en and
  // ur reports. Fed the per-domain scores + weakest indicators so each line is
  // grounded in what was actually scored, never invented.
  //
  // Evidence preference: the COACH-EDITED text first (the observe review form
  // writes evidence_sw / improvement_sw via applyObserverEdits, and on an
  // observe session this call runs AFTER those edits persist — so the coach's
  // corrections ARE the grounding) → evidence_summary → evidence.
  const isFico = (a.framework || '').toLowerCase() === 'fico';
  const FICO_DOMAIN_LABELS = {
    lesson_plan_fidelity: 'Lesson Plan Fidelity',
    high_leverage_practices: 'High-Leverage Practices',
    student_engagement: 'Student Engagement',
    teacher_subject_knowledge: 'Teacher Subject Knowledge',
  };
  const domainScoresBlock = (isFico && a.domains && typeof a.domains === 'object')
    ? Object.keys(FICO_DOMAIN_LABELS).filter((k) => a.domains[k]).map((k) => {
        const d = a.domains[k];
        // Section B may be DERIVED from the measured LP-fidelity engine (P4.1/D27):
        // ground its "why" in the actual missed moves, not the legacy proxy indicators.
        if (k === 'lesson_plan_fidelity' && d.fidelity_derived) {
          const missed = ((a.lp_fidelity && a.lp_fidelity.moves) || [])
            .filter((m) => m.verdict === 'not_done' || m.verdict === 'partial')
            .slice(0, 3).map((m) => `"${String(m.text || '').slice(0, 90)}" (${m.verdict})`);
          return `- ${k} (${FICO_DOMAIN_LABELS[k]}): ${d.domain_score}/${d.domain_max} — MEASURED from her lesson plan: ${d.fidelity_pct}% of prescribed moves executed.${missed.length ? ` Moves missed or partial: ${missed.join('; ')}` : ''}`;
        }
        const lows = (d.indicators || []).slice().sort((x, y) => (x.score || 0) - (y.score || 0)).slice(0, 2)
          .map((i) => `${i.id} scored ${i.score}/4 — ${String(i.evidence_sw || i.evidence_summary || i.evidence || '').slice(0, 160)}${i.improvement_sw ? ` | to improve: ${String(i.improvement_sw).slice(0, 120)}` : ''}`);
        return `- ${k} (${FICO_DOMAIN_LABELS[k]}): ${d.domain_score}/${d.domain_max}${lows.length ? `. Lowest indicators: ${lows.join(' | ')}` : ''}`;
      }).join('\n')
    : '';

  return `You are the NIETE Teaching Assistant, a warm, perceptive instructional coach. Below is the FULL TRANSCRIPT of a real lesson by ${teacherName} plus its ${fw} rubric analysis. Write the words for a CELEBRATION report that makes this teacher feel truly SEEN — not graded like a medical report.

Use the TRANSCRIPT as source of truth. Find what is UNIQUELY hers — a signature move, how she talks to children, how she connects ideas — and ground every claim in something she actually did. Tie it to the ${fw} lens (clarity, student involvement, questioning, classroom management) honestly, but lead with humanity. Address her as "you".

NEVER emit rubric IDs, snake_case tokens, or programmatic identifiers as prose. If the analysis mentions an indicator like "step_by_step" or "guided_practice", write it out naturally ("step by step", "guided practice"). If it mentions "1.2 Fidelity to LP Steps", say "lesson-plan fidelity", not "1.2". The teacher never sees the raw rubric shape.

PLAIN LANGUAGE — avoid coach-jargon the teacher wouldn't use herself: "scaffolding", "extension", "differentiation", "formative assessment", "higher-order thinking", "metacognition", "gradual release". Especially in "horizon_note", describe the concrete move in plain words (e.g. "break the task into small steps", "a harder task for early finishers") rather than the jargon label.

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
 "score_framing":"one warm sentence framing overall ${pct}% as a stage in a journey, not a verdict."${isFico ? `,
 "domain_whys":{ ${Object.keys(FICO_DOMAIN_LABELS).map((k) => `"${k}":"..."`).join(', ')} }` : ''}
}
moments: EXACTLY 3, the best real moments. Do NOT invent quotes — use real lines from the transcript.
${isFico ? `
domain_whys: ONE sentence per domain, in the report language, in the PAST TENSE, with NO instruction verb (no "try", "should", "could", "کریں", "چاہیے") — pure diagnosis, not advice; the single next-step lives elsewhere. Follow this EXACT two-clause skeleton (bd-43497, the locked reference):
  EN: "This is strong/developing because <one concrete classroom moment> — it's not full marks because <one clear, concrete missing thing>."
  UR: «یہ اسکور اچھا/بہتر ہے کیونکہ <کلاس کا ایک ٹھوس لمحہ> — مکمل نمبر اس لیے نہیں کیونکہ <ایک واضح، ٹھوس کمی>۔»
- ONE sentence, never a paragraph. ALWAYS name ONE concrete missing element in the second clause; never end vague. If (and only if) the domain scored the full max, drop the second clause and just state what made it strong.
- Ground every claim in the DOMAIN SCORES data below or the transcript — NEVER invent an activity or moment that is not there, and NEVER contradict the recorded evidence (on observed lessons it is the observer's own corrected record).
- LANGUAGE PURITY (bd-43497 R5): write the WHOLE line in the report language and, for Urdu, in Urdu SCRIPT — these diagnosis lines must read as clean, single-language prose (no sprinkled English pedagogy terms here, unlike the concept names elsewhere).
DOMAIN SCORES (diagnose each):
${domainScoresBlock}` : ''}

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
    // bd-1t1wz: keep domain_whys a flat {domainKey: non-empty string} map —
    // drop anything else so the template only ever sees renderable lines.
    if (narrative.domain_whys && typeof narrative.domain_whys === 'object') {
      for (const k of Object.keys(narrative.domain_whys)) {
        if (typeof narrative.domain_whys[k] !== 'string' || !narrative.domain_whys[k].trim()) {
          delete narrative.domain_whys[k];
        }
      }
    } else {
      delete narrative.domain_whys;
    }
    narrative._language = language;
    return narrative;
  } catch (err) {
    logToFile('❌ generateReportNarrative failed', { error: err.message, framework: analysis?.framework, language });
    return null;
  }
}

module.exports = { generateReportNarrative, buildPrompt, LANG_NAME, fixCodeswitch };
