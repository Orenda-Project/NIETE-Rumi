'use strict';
/**
 * LP-born quiz — pass 1, the DIGEST, read from the LESSON PLAN.
 *
 * The transcript digest (`transcript-quiz-digest.service.js`) reads what a
 * teacher actually said in class. This one reads the SLIDE SCRIPT of the exact
 * lesson version the teacher was served — the authored source the rendered PDF
 * was built from, resolved by (lesson_id, version_stamp, content_hash) so the
 * quiz can never be written from a lesson the teacher did not get (PLAN_R8 D13).
 *
 * It returns the SAME SHAPE as the transcript digest, through the same
 * `normaliseDigest()`. That is not tidiness: the author prompt, the validator,
 * the teacher PDF, the hand-off and the class report's objectives all read that
 * shape and nothing else, so a second shape would mean a second copy of every
 * one of them.
 *
 * THREE THINGS IT MUST NOT FORWARD, each one a red-team finding:
 *
 *  1. `wrap.exitOptions` (PLAN_R8 §8 row 27). The exit MCQ is the one question
 *     this class has already been asked and answered at the end of the period.
 *     A quiz that reuses it measures who remembers the last five minutes.
 *  2. Gendered prose. The plans are authored with a teacher gender
 *     (`meta.teacherGender`) and their prose says "She says…", "ask her". The
 *     teacher's gender is not a fact this system holds — it is a guess, and a
 *     guess printed on that teacher's own document is exactly what the pipeline
 *     spends three gates removing downstream. It is cheaper to never carry it.
 *  3. `meta.teacherGender` itself, for the same reason.
 *
 * What it DOES carry is the planned lesson: the goal and its SLO, the Bloom
 * level, the key fact, the worked example, the misconception the plan warns
 * about (which seeds the distractors), the independent-practice prompts as
 * SHAPE, and the wrap-up key facts.
 */

const { completeJson } = require('./transcript-quiz-llm');
const { normaliseDigest } = require('./transcript-quiz-digest.service');
const { canonicalSubject, LANG_NAME } = require('./transcript-quiz-language');
const { logEvent } = require('../../utils/structured-logger');
const { LP_V8 } = require('./quiz-sources');

/** Bloom verb → the three levels the whole quiz pipeline speaks. */
const BLOOM_LEVEL = {
  remember: 'recall',
  recall: 'recall',
  knowledge: 'recall',
  identify: 'recall',
  understand: 'understand',
  comprehend: 'understand',
  explain: 'understand',
  apply: 'apply',
  analyse: 'apply',
  analyze: 'apply',
  evaluate: 'apply',
  create: 'apply',
};

/** @returns {'recall'|'understand'|'apply'} */
function levelFromBloom(bloom) {
  return BLOOM_LEVEL[String(bloom || '').trim().toLowerCase()] || 'understand';
}

/**
 * Take the teacher's gender out of a sentence without taking the sentence out.
 *
 * "She says the ones column reached thirteen" → "The teacher says …";
 * "ask her whether six and seven reach ten"   → "ask them whether …";
 * "his class"                                  → "their class".
 *
 * Objective `her` ("ask her") and possessive `her` ("her class") are the same
 * word, so one of the two readings is always slightly off; `their`/`them` is
 * the reading that stays grammatical in both, which is why the map is not
 * "the teacher" for every form.
 */
const PRONOUN = {
  she: 'the teacher',
  he: 'the teacher',
  her: 'their',
  hers: 'theirs',
  his: 'their',
  him: 'them',
  herself: 'themselves',
  himself: 'themselves',
};
const PRONOUN_RE = /\b(she|he|hers|her|his|him|herself|himself)\b/gi;

function degender(text) {
  const s = String(text == null ? '' : text);
  if (!s) return '';
  return s.replace(PRONOUN_RE, (m) => {
    const to = PRONOUN[m.toLowerCase()];
    // Keep the writer's capitalisation: a replacement at the head of a sentence
    // must not lower-case it.
    return m[0] === m[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to;
  });
}

const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * The ONE field picker. Everything the model or the author is ever shown comes
 * from here, so "we never forward the exit options" is a property of one
 * function rather than a promise repeated in two prompts.
 */
function carry(slideScript) {
  const ss = slideScript && typeof slideScript === 'object' ? slideScript : {};
  const meta = ss.meta || {};
  const iDo = ss.iDo || {};
  const youDo = ss.youDo || {};
  const wrap = ss.wrap || {};
  const worked = iDo.worked || null;
  const mis = iDo.misconception || null;
  return {
    meta: {
      grade: meta.grade ?? null,
      subject: meta.subject ?? null,
      topic: degender(meta.topic),
      chapter: degender(meta.chapterTitle),
      minutes: meta.minutes ?? meta.durationMin ?? null,
      slo_descriptions: arr(meta.sloDescriptions).map(degender).filter(Boolean),
      // meta.teacherGender is deliberately absent. So is meta.sourceFile — an
      // absolute path on somebody's laptop, and this repo is public.
    },
    goal: degender(ss.goal),
    slo_full: degender(ss.sloFull),
    slo_code: String(ss.sloCode || '').trim(),
    bloom: String(ss.bloom || '').trim(),
    key_fact: degender(iDo.keyFact),
    worked: worked ? {
      problem: degender(worked.problem),
      work: arr(worked.work).map(degender).filter(Boolean),
      answer: degender(worked.answer),
      // worked.diagram is ASCII column-sum art with its own row-mark legend.
      // It reads as noise in a prompt and the drawing engine draws better.
    } : null,
    misconception: mis ? {
      slip: degender(mis.slip), why: degender(mis.why), fix: degender(mis.fix),
    } : null,
    // PROMPTS ONLY — never the answers, and never as questions to reuse.
    practice_prompts: arr(youDo.problems).map((p) => degender(p && p.prompt)).filter(Boolean),
    key_facts: arr(wrap.keyFacts).map(degender).filter(Boolean),
  };
}

/** Is there enough of a plan here to write anything from? */
function isUsable(slideScript) {
  const c = carry(slideScript);
  return Boolean(c.goal || c.slo_full || c.key_fact || c.practice_prompts.length || c.key_facts.length);
}

/**
 * The block the AUTHOR pass reads where a transcript quiz reads the passages
 * around each SLO's evidence. Same picker, so the same three things are absent.
 * @returns {string}
 */
function lessonExcerpts(slideScript) {
  const c = carry(slideScript);
  const lines = [];
  const push = (label, value) => { if (value) lines.push(`${label}: ${value}`); };
  push('LESSON', [c.meta.topic, c.meta.chapter].filter(Boolean).join(' — '));
  push('WHAT THE CLASS WAS TO LEARN', c.goal);
  push('THE OBJECTIVE IN FULL', c.slo_full);
  if (c.slo_code) push('OBJECTIVE CODE', c.slo_code);
  if (c.bloom) push('THE LEVEL THE LESSON WAS PITCHED AT', c.bloom);
  c.meta.slo_descriptions.forEach((d) => push('WRITTEN FOR THE CLASS AS', d));
  push('THE KEY FACT THE LESSON TURNS ON', c.key_fact);
  if (c.worked && (c.worked.problem || c.worked.work.length)) {
    lines.push('THE WORKED EXAMPLE THE CLASS WAS SHOWN:');
    if (c.worked.problem) lines.push(`  ${c.worked.problem}`);
    c.worked.work.forEach((w) => lines.push(`  ${w}`));
    if (c.worked.answer) lines.push(`  ${c.worked.answer}`);
  }
  if (c.misconception) {
    lines.push('THE MISTAKE THIS LESSON EXPECTS CHILDREN TO MAKE (gold for distractors):');
    if (c.misconception.slip) lines.push(`  what they do: ${c.misconception.slip}`);
    if (c.misconception.why) lines.push(`  why: ${c.misconception.why}`);
    if (c.misconception.fix) lines.push(`  what fixes it: ${c.misconception.fix}`);
  }
  if (c.practice_prompts.length) {
    lines.push('WHAT THE CLASS PRACTISED ON THEIR OWN — the SHAPE of the work, never questions to copy:');
    c.practice_prompts.forEach((p) => lines.push(`  ${p}`));
  }
  if (c.key_facts.length) {
    lines.push('WHAT THE LESSON ENDED ON:');
    c.key_facts.forEach((k) => lines.push(`  ${k}`));
  }
  return lines.join('\n');
}

function buildLpDigestPrompt({ slideScript, language, grade, subject }) {
  const c = carry(slideScript);
  return `You are reading the LESSON PLAN a teacher in a Pakistani government school was given and taught from today. Your job is to write a faithful DIGEST of what that lesson set out to teach — nothing more, nothing less. This digest will be used to write a short quiz for the children who sat in that lesson, so anything you invent will be tested on children who never met it.

WHAT YOU KNOW ABOUT THIS LESSON:
- grade (from the curriculum catalog, trust it over your own reading): ${grade || c.meta.grade || 'unknown'}
- subject (from the catalog): ${subject || c.meta.subject || 'unknown'}
- the quiz will be written in: ${LANG_NAME[language] || 'the lesson’s own language'}

RULES
- Use ONLY the lesson below. If there is too little of it to say what was taught, say so via confidence < 0.5.
- "slos" = the specific learning objectives THIS lesson set out to teach, 2-6 of them, each with a short verbatim quote from the plan as its evidence and the level the plan pitched it at: "recall" (name/repeat/identify), "understand" (explain/compare/give own example), "apply" (solve/use in a new case). The plan's own level is "${c.bloom || 'understand'}" — no objective may be tagged ABOVE it.
- Every SLO carries "statement_en" (the objective in English) and "statement_ur" (the same objective in Urdu script, English technical terms in English letters). The teacher may ask for the quiz in either language and the document must read in one language only.
- "topic_as_taught" = the topic label as the plan names it. ENGLISH TECHNICAL TERMS ARE WRITTEN IN ENGLISH LETTERS, never transliterated into Urdu script: write "column method", "numerator", "photosynthesis" — not "کالم میتھڈ". "topic" = a clean short label in English.
- "subject" must be one of: urdu | english | maths | science | sst | genk | islamiat | other.
- "grade_band": "1-2" | "3-5" | "6-8" | "9-10".
- "key_terms": up to 8 terms the lesson teaches; "term" is the canonical form, "as_spoken" is how the plan words it for the class.
- "examples_used": the concrete examples, numbers, objects and stories THIS plan uses — the worked example and the practice work. These are the material of the quiz: a child should recognise their own lesson in it.
- "misconceptions_surfaced": the mistake this plan expects children to make, and why. This is what the quiz's wrong options are built from, so write it as the mistaken THINKING, not as an instruction to the teacher.
- THE PRACTICE PROMPTS BELOW ARE SHAPE, NOT QUESTIONS. Never copy one of them, or its numbers, into anything you write — a child who did that exact sum in the period is being asked to remember an answer, not to use the idea. Write about the same skill with different material.
- THE TEACHER HAS NO GENDER. Never write "she", "he", "her", "his" or "him" about the teacher in any field — say "the teacher". In Urdu use no gendered word for the teacher and no gendered verb form about the teacher; a verb that agrees with the object ("استاد نے سبق پڑھایا") says nothing about the teacher and is what to write. Never guess a child's gender either.
- Religious content (Islamiyat / سیرت): write sacred names and honorifics exactly and in Urdu/Arabic script (اللہ، نبی کریم ﷺ، رضی اللہ عنہ) — never transliterated, never dropped.

Return ONLY this JSON object:
{
  "topic": "", "topic_as_taught": "", "subject": "urdu|english|maths|science|sst|genk|islamiat|other", "subject_conflict": false,
  "grade_band": "", "language_of_instruction": "", "confidence": 0.0,
  "slos": [ { "id": "S1", "statement": "", "statement_en": "", "statement_ur": "", "evidence_quote": "", "taught_level": "recall|understand|apply" } ],
  "key_terms": [ { "term": "", "as_spoken": "" } ],
  "examples_used": [ "" ],
  "misconceptions_surfaced": [ "" ]
}

THE LESSON PLAN:
${lessonExcerpts(slideScript)}`;
}

/**
 * Run the digest for ONE served lesson.
 *
 * @param {object}  args
 * @param {object}  args.slideScript  the slide script of the exact served version
 * @param {string}  args.language     the quiz language already settled on the row
 * @param {string|number} [args.grade]   the catalog grade (authoritative)
 * @param {string}  [args.subject]    the catalog subject
 * @returns {Promise<{digest:object, grade:string|null, gradeSource:'catalog', lpHint:null,
 *                    model:string, costUsd:number|null, latencyMs:number}>}
 *   The same envelope `transcript-quiz-digest.service.run()` returns, so the
 *   generate step spreads one or the other without a second branch.
 */
async function run({ slideScript, language = null, grade = null, subject = null }) {
  if (!isUsable(slideScript)) {
    // Loudly, and before the LLM call: an empty digest authored into a quiz is
    // eight questions about nothing, and the teacher would be the one to find out.
    throw new Error('lp digest: the slide script carries no lesson to digest');
  }
  const prompt = buildLpDigestPrompt({ slideScript, language, grade, subject });
  const {
    json, model, costUsd, latencyMs,
  } = await completeJson({ prompt, label: 'lp_quiz.digest' });

  const digest = normaliseDigest(json, { storedSubject: subject });
  const bloomLevel = levelFromBloom(slideScript && slideScript.bloom);

  // The plan's Bloom level is the ceiling, and it is a FACT about the lesson —
  // not something the model may raise. The author prompt and the validator both
  // read per-SLO taught_level, so the clamp happens here, once.
  const RANK = { recall: 0, understand: 1, apply: 2 };
  digest.taught_level = bloomLevel;
  digest.slos = digest.slos.map((s) => (
    RANK[s.taught_level] > RANK[bloomLevel] ? { ...s, taught_level: bloomLevel } : s
  ));

  // The misconception is SEEDED from the plan, not hoped for from the model:
  // it is what every wrong option is built from, and on this path it is the one
  // piece of the lesson we know for certain.
  const c = carry(slideScript);
  if (c.misconception) {
    const seeded = [c.misconception.slip, c.misconception.why].filter(Boolean);
    const already = new Set(digest.misconceptions_surfaced.map((m) => String(m).trim()));
    digest.misconceptions_surfaced = [
      ...seeded.filter((m) => !already.has(m.trim())),
      ...digest.misconceptions_surfaced,
    ].slice(0, 8);
  }
  if (!digest.subject || digest.subject === 'other') digest.subject = canonicalSubject(subject);

  const resolvedGrade = grade != null && String(grade).trim() ? String(grade).trim() : null;

  logEvent('transcript_quiz.digest_done', {
    quiz_source: LP_V8,
    lessonId: (slideScript && slideScript.meta && slideScript.meta.lessonId) || null,
    model,
    costUsd,
    latencyMs,
    subject: digest.subject,
    slos: digest.slos.length,
    confidence: digest.confidence,
    taughtLevel: bloomLevel,
    grade: resolvedGrade,
    gradeSource: 'catalog',
  });

  return {
    digest,
    grade: resolvedGrade,
    gradeSource: 'catalog',
    lpHint: null,
    model,
    costUsd,
    latencyMs,
  };
}

module.exports = {
  run, lessonExcerpts, buildLpDigestPrompt, carry, degender, levelFromBloom, isUsable,
};
