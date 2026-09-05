'use strict';
/**
 * Transcript quiz — pass 1, the DIGEST.
 *
 * Reads the coaching transcript (never the coaching analysis, scores or
 * framework — that is the whole point of the feature) and writes a faithful
 * record of what was actually taught: the topic as the teacher named it, the
 * subject, the SLOs she actually covered with a verbatim evidence quote and
 * the level she pitched each at, the examples she used, the confusions that
 * surfaced. The author pass writes the quiz from THIS, so anything invented
 * here would be tested on children who never heard it.
 *
 * GRADE. Never stored on a coaching session, so it is resolved in code, in
 * this order (measured on prod, 2026-09-05): the teacher's profile
 * (users.grades_taught[0], set for 88%), then the grade on her same- or
 * previous-day lesson-plan download whose subject matches (+15%), then the
 * digest's own inference from the transcript. The grade pitches difficulty
 * only — nothing a teacher or child reads ever names it, so she can forward
 * the quiz to whichever group she taught.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { completeJson } = require('./transcript-quiz-llm');
const { canonicalSubject, fixTransliterations, isTransliteratedEnglishPhrase } = require('./transcript-quiz-language');

const MAX_TRANSCRIPT_CHARS = 60000;   // p90 is 26k; a runaway transcript is cut, not refused

function buildDigestPrompt({ transcript, transcriptLanguage, storedTopic, storedSubject, hints = {}, lpHint = null }) {
  const hintLine = lpHint
    ? `- lesson plan she downloaded that day (a HINT of what was planned, not proof of what was taught): grade ${lpHint.grade || '?'}, ${lpHint.subject || '?'}, chapter "${lpHint.chapter_title || '?'}"`
    : '- no lesson plan download that day';
  return `You are reading the transcript of ONE real classroom lesson taught in a Pakistani government school. Your job is to write a faithful DIGEST of what was actually taught — nothing more, nothing less. This digest will be used to write a short quiz for the children who sat in this lesson, so anything you invent will be tested on children who never heard it.

STORED HINTS (from an earlier pass; confirm or correct them, never contradict the subject silently — set "subject_conflict": true if you disagree):
- stored_topic: ${storedTopic || 'unknown'}
- stored_subject: ${storedSubject || 'unknown'}
- transcript_language (detected): ${transcriptLanguage || 'unknown'}
- teacher profile hints (may be stale): grade ${hints.grade || '?'}, subject ${hints.subject || '?'}, grades_taught ${JSON.stringify(hints.grades_taught || [])}, subjects_taught ${JSON.stringify(hints.subjects_taught || [])}
${hintLine}

RULES
- Use ONLY the transcript. If the transcript is too thin or garbled to identify what was taught, say so via confidence < 0.5.
- "slos" = the specific learning objectives the teacher ACTUALLY taught, 2–6 of them, each with a short verbatim evidence quote from the transcript (in its original language) and the level the teacher pitched it at: "recall" (name/repeat/identify), "understand" (explain/compare/give own example), "apply" (solve/use in a new case). Write each SLO statement in the lesson's own language (Urdu in Urdu script for an Urdu lesson). In an Urdu statement, English technical terms stay in English letters (the same rule as topic_as_taught).
- "topic_as_taught" = the topic label the way the teacher named it in class, in the lesson's own language (Urdu in Urdu script, never Roman Urdu). ENGLISH TECHNICAL TERMS ARE WRITTEN IN ENGLISH LETTERS, never transliterated into Urdu script: write "Proper Fraction", "numerator", "photosynthesis" — not "پروپر فیکشن", "نیومریٹر". A transcript that spells such a term in Urdu letters is the speech-to-text's doing; you write the term itself. For Urdu, Islamiyat, Social Studies and General Knowledge lessons the label is Urdu (with any English term in English letters). "topic" = a clean short label in English.
- "subject" must be one of: urdu | english | maths | science | sst | genk | islamiat | other.
- "grade_band" from content difficulty and any grade mentioned: "1-2" | "3-5" | "6-8" | "9-10".
- "language_of_instruction": "ur" | "en" | "mixed".
- "key_terms": up to 8 terms; "term" is the canonical form (English technical terms in English letters), "as_spoken" is how the teacher said it.
- "examples_used": the concrete examples, objects, numbers, sentences or stories the teacher used (these are gold for quiz questions and feedback).
- "misconceptions_surfaced": student errors or confusions that actually appeared in the lesson, if any.
- Religious content (Islamiyat / سیرت): write sacred names and honorifics exactly as spoken and in Urdu/Arabic script (اللہ، نبی کریم ﷺ، رضی اللہ عنہ) — never transliterated, never dropped.
- Gender-neutral: never guess the teacher's or a child's gender in any statement.

Return ONLY this JSON object:
{
  "topic": "", "topic_as_taught": "", "subject": "urdu|english|maths|science|sst|genk|islamiat|other", "subject_conflict": false,
  "grade_band": "", "language_of_instruction": "", "confidence": 0.0,
  "slos": [ { "id": "S1", "statement": "", "evidence_quote": "", "taught_level": "recall|understand|apply" } ],
  "key_terms": [ { "term": "", "as_spoken": "" } ],
  "examples_used": [ "" ],
  "misconceptions_surfaced": [ "" ]
}

TRANSCRIPT:
${String(transcript || '').slice(0, MAX_TRANSCRIPT_CHARS)}`;
}

/** Coerce the model's JSON into the shape the rest of the pipeline trusts. */
function normaliseDigest(raw, { storedSubject } = {}) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const slos = Array.isArray(d.slos) ? d.slos : [];
  const topic = String(d.topic || '').trim();
  const rawAsTaught = String(d.topic_as_taught || d.topic || '').trim();
  // A whole English phrase in Urdu letters ("اسٹرکچر آف این ایٹم") is not a term
  // the fixer's table can ever hold, and rewriting half of it is worse than not
  // rewriting it at all. The clean English label is sitting right there in
  // `topic`, so use it and record that we did.
  const transliteratedPhrase = Boolean(topic) && isTransliteratedEnglishPhrase(rawAsTaught);
  const out = {
    topic,
    // The goal lines and the as-taught topic are printed on the teacher's PDF
    // and the report; a transliterated term there ('فیکشن') contradicts every
    // question under it. What was SPOKEN (key_terms.as_spoken) stays as spoken.
    topic_as_taught: transliteratedPhrase ? topic : fixTransliterations(rawAsTaught),
    topic_transliteration_fixed: transliteratedPhrase || undefined,
    subject: canonicalSubject(d.subject) !== 'other' ? canonicalSubject(d.subject) : canonicalSubject(storedSubject),
    subject_conflict: Boolean(d.subject_conflict),
    grade_band: String(d.grade_band || '').trim() || null,
    language_of_instruction: ['ur', 'en', 'mixed'].includes(d.language_of_instruction) ? d.language_of_instruction : 'unknown',
    confidence: Number.isFinite(Number(d.confidence)) ? Number(d.confidence) : 0,
    slos: slos.filter((s) => s && (s.statement || s.id)).slice(0, 6).map((s, i) => ({
      id: String(s.id || `S${i + 1}`).trim(),
      statement: fixTransliterations(String(s.statement || '').trim()),
      evidence_quote: String(s.evidence_quote || '').trim(),
      taught_level: ['recall', 'understand', 'apply'].includes(s.taught_level) ? s.taught_level : 'understand',
    })),
    key_terms: (Array.isArray(d.key_terms) ? d.key_terms : []).slice(0, 8).map((k) => (
      typeof k === 'string' ? { term: k, as_spoken: k } : { term: String(k?.term || ''), as_spoken: String(k?.as_spoken || k?.term || '') }
    )),
    examples_used: (Array.isArray(d.examples_used) ? d.examples_used : []).map(String).filter(Boolean).slice(0, 12),
    misconceptions_surfaced: (Array.isArray(d.misconceptions_surfaced) ? d.misconceptions_surfaced : []).map(String).filter(Boolean).slice(0, 8),
  };
  // Re-number SLO ids so the author's slo_id tags are unambiguous.
  out.slos = out.slos.map((s, i) => ({ ...s, id: `S${i + 1}` }));
  return out;
}

/**
 * The lesson plan she downloaded the same or previous day for this subject,
 * if any: a HINT of what was planned. The quiz tests what was taught.
 */
async function lpHintFor({ userId, sessionCreatedAt, subject }) {
  if (!userId || !sessionCreatedAt) return null;
  try {
    const at = new Date(sessionCreatedAt);
    const from = new Date(at.getTime() - 36 * 60 * 60 * 1000).toISOString();
    const to = new Date(at.getTime() + 6 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('niete_lp_downloads')
      .select('lesson_id, grade, subject, chapter_number, segment_index, created_at')
      .eq('user_id', userId)
      .gte('created_at', from)
      .lte('created_at', to)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error || !data || !data.length) return null;
    const canon = canonicalSubject(subject);
    const match = data.find((r) => canonicalSubject(r.subject) === canon) || (canon === 'other' ? data[0] : null);
    if (!match) return null;
    let chapterTitle = null;
    if (match.lesson_id) {
      const { data: cat } = await supabase
        .from('lesson_plan_catalog')
        .select('chapter_title, grade, subject')
        .eq('id', match.lesson_id)
        .maybeSingle();
      chapterTitle = cat?.chapter_title || null;
    }
    return {
      grade: match.grade ? String(match.grade) : null,
      subject: match.subject || null,
      chapter_title: chapterTitle,
      lesson_id: match.lesson_id || null,
      chapter_number: match.chapter_number ?? null,
      segment_index: match.segment_index ?? null,
    };
  } catch (err) {
    logToFile('⚠️ transcript quiz: lp hint lookup failed (non-fatal)', { userId, error: err.message });
    return null;
  }
}

/** Profile → LP download → digest band. Returns { grade, source }. */
function resolveGrade({ user, lpHint, digest }) {
  const taught = Array.isArray(user?.grades_taught) ? user.grades_taught.filter(Boolean) : [];
  if (taught.length) return { grade: String(taught[0]), source: 'profile' };
  if (user?.grade) return { grade: String(user.grade), source: 'profile' };
  if (lpHint?.grade) return { grade: String(lpHint.grade), source: 'lp_download' };
  if (digest?.grade_band) return { grade: String(digest.grade_band), source: 'digest' };
  return { grade: null, source: 'none' };
}

/**
 * Run the digest for one coaching session.
 * @param {object} args
 * @param {object} args.session   coaching_sessions row (transcript_text, transcript_language, analysis_data, created_at, user_id)
 * @param {object} [args.user]    users row (grades_taught, subjects_taught, grade, subject)
 */
async function run({ session, user = null }) {
  const storedTopic = session?.analysis_data?.topic || null;
  const storedSubject = session?.analysis_data?.subject || user?.subject || null;
  const lpHint = await lpHintFor({ userId: session.user_id, sessionCreatedAt: session.created_at, subject: storedSubject });

  const prompt = buildDigestPrompt({
    transcript: session.transcript_text,
    transcriptLanguage: session.transcript_language,
    storedTopic, storedSubject,
    hints: {
      grade: user?.grade, subject: user?.subject,
      grades_taught: user?.grades_taught, subjects_taught: user?.subjects_taught,
    },
    lpHint,
  });
  const { json, model, costUsd, latencyMs } = await completeJson({ prompt, label: 'transcript_quiz.digest' });
  const digest = normaliseDigest(json, { storedSubject });
  const { grade, source } = resolveGrade({ user, lpHint, digest });

  logEvent('transcript_quiz.digest_done', {
    coachingSessionId: session.id, model, costUsd, latencyMs,
    subject: digest.subject, slos: digest.slos.length, confidence: digest.confidence,
    language: digest.language_of_instruction, grade, gradeSource: source, hadLpHint: Boolean(lpHint),
  });
  return { digest, grade, gradeSource: source, lpHint, model, costUsd, latencyMs };
}

module.exports = { run, buildDigestPrompt, normaliseDigest, resolveGrade, lpHintFor, MAX_TRANSCRIPT_CHARS };
