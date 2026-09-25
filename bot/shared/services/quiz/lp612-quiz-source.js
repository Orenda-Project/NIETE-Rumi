'use strict';
/**
 * A Grades 6-12 lesson plan as the SOURCE of a quiz — the lp612 counterpart of
 * lp-asset-source.store (K-5).
 *
 * WHERE THE LESSON LIVES. A 6-12 lesson is written at request time and never
 * stored as rows: the worker keeps the exact `lp_doc` that made each PDF beside
 * it in R2, `lp612/{template_version}/{lang}/{segment_id}.lp.json`
 * (lp612-author.worker.js, "KEEP THE DOCUMENT THAT MADE THE PDF"; the key is
 * Serving.docKeyFor). A quiz carries that version triple in
 * `quizzes.meta.lessons[0]` = {segment_id, lang, template_version, …}, so the
 * document read is EXACT: the one the teacher holds, never "the newest render
 * of this lesson". A missing object is no source (the quiz fails
 * `source_missing`); any other R2 failure THROWS, so the job is redelivered
 * rather than the teacher being told, for good, that the plan could not be
 * opened (the K-5 store's rule).
 *
 * WHY AN ADAPTER AND NOT A SECOND PROMPT. The K-5 LP-born quiz reads a lesson
 * plan through ONE picker, lp-quiz-digest.carry(), over the slide-script shape
 * — and the author, the validator, the key check, the teacher PDF and the
 * class report all read what that path produces. So a 6-12 lesson is mapped
 * onto the same slide-script fields and joins the same path:
 *
 *   objectives.outcome           → goal
 *   slo.text_verbatim / .code    → sloFull / sloCode
 *   slo.cognitive_level K/U/A    → bloom remember / understand / apply
 *   objectives.items[].text      → meta.sloDescriptions
 *   development key_points       → iDo.keyFact (the first) + wrap.keyFacts (all)
 *   worked_example               → iDo.worked {problem, work, answer}
 *   faded_example                → weDo.modelled {problem, work, answer}
 *   practice items               → youDo.problems [{prompt, answer}]
 *   keywords                     → hook.keyWords [{term, def}]
 *   page2.mistakes + flagged
 *   watch_out blocks             → iDo.misconception (the first) + misconceptions (the rest)
 *   exit_ticket + exam_bank MCQs → wrap.exitOptions
 *   homework + homework_key      → wrap.homework [{prompt, answer}]
 *
 * THE ANSWERS NEVER REACH THE AUTHOR. Practice answers, the exit ticket, the
 * homework key and the exam bank are the 6-12 analogue of the K-5 exit MCQ
 * (PLAN_R8 §8 row 27): carry() reads prompts only and never reads exitOptions
 * or homework, so they reach the author nowhere; the KEY CHECK reads them, as
 * it reads a K-5 plan's, to hold each key against the lesson's own answers.
 * page2.model_answers are not mapped at all.
 *
 * Pure except resolveLessonDoc's one R2 read.
 */

const { logToFile } = require('../../utils/logger');

/** FBISE cognitive level → the Bloom word levelFromBloom() maps to recall / understand / apply. */
const LEVEL_BLOOM = { K: 'remember', U: 'understand', A: 'apply' };

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (v == null ? '' : String(v).trim());

function docKey({ segment_id: segmentId, lang, template_version: tv }) {
  // The ONE definition of the key (Serving.docKeyFor), so this reader and the
  // worker that writes the object cannot disagree about where it lives.
  const Serving = require('../lp612-serving.service');
  return Serving.docKeyFor(segmentId, lang, tv);
}

/** Every block of every section, in order, with the section it came from. */
function blocks(doc) {
  return arr(doc && doc.sections).flatMap((s) => arr(s && s.blocks).map((b) => ({ ...b, _section: s.id })));
}

/** A misconception in the slide-script shape; `null` when there is no slip in it. */
function mistake(slip, fix = '') {
  const s = str(slip);
  return s ? { slip: s, why: '', fix: str(fix) } : null;
}

/**
 * lp_doc → the slide-script fields the LP digest and the key check read. Pure.
 *
 * @param {object} doc   the stored lp_doc
 * @param {{lang?:string}} [opts] the language the lesson was DELIVERED in
 * @returns {object} slide-script-shaped lesson
 */
function toSlideScript(doc, { lang = null } = {}) {
  const d = doc && typeof doc === 'object' ? doc : {};
  const prov = d.provenance || {};
  const slo = d.slo || {};
  const objectives = d.objectives || {};
  const all = blocks(d);
  const firstOf = (type) => all.find((b) => b.type === type) || null;

  const keyPoints = all.filter((b) => b.type === 'key_points' && b._section !== 'homework')
    .flatMap((b) => arr(b.items).map(str)).filter(Boolean);
  const boardLines = all.filter((b) => b.type === 'board' && b._section === 'conclusion')
    .flatMap((b) => str(b.text).split('\n').map(str)).filter(Boolean);

  const worked = firstOf('worked_example');
  const faded = firstOf('faded_example');
  const practice = all.filter((b) => b.type === 'practice').flatMap((b) => arr(b.items));

  const mistakes = [
    ...arr(d.page2 && d.page2.mistakes).map((m) => mistake(m && m.pupil_says, m && m.you_ask)),
    ...all.filter((b) => b.type === 'watch_out' && b.misconception === true).map((b) => mistake(b.text)),
  ].filter(Boolean);

  const sections = arr(d.sections);
  const exitTicket = sections.flatMap((s) => arr(s && s.exit_ticket));
  const examMcq = arr(d.page2 && d.page2.exam_bank && d.page2.exam_bank.mcq);
  const homeworkItems = sections.flatMap((s) => arr(s && s.homework && s.homework.items));
  const homeworkKey = new Map(arr(d.page2 && d.page2.homework_key).map((h) => [h && h.ref, h && h.answer]));

  return {
    meta: {
      grade: prov.grade ?? null,
      subject: prov.subject ?? null,
      topic: str(prov.topic),
      chapterTitle: str(prov.chapter_title),
      minutes: d.period_minutes ?? null,
      sloDescriptions: arr(objectives.items).map((i) => str(i && i.text)).filter(Boolean),
      language: lang,
      lessonId: null,          // a 6-12 segment is not a K-5 catalog lesson
    },
    goal: str(objectives.outcome),
    sloFull: str(slo.text_verbatim),
    sloCode: str(slo.code),
    bloom: LEVEL_BLOOM[str(slo.cognitive_level).toUpperCase()] || 'understand',
    hook: {
      keyWords: all.filter((b) => b.type === 'keywords').flatMap((b) => arr(b.items))
        .map((w) => ({ term: str(w && w.word), def: str(w && w.meaning) })).filter((w) => w.term && w.def),
    },
    iDo: {
      keyFact: keyPoints[0] || '',
      worked: worked ? { problem: str(worked.prompt), work: arr(worked.steps).map(str).filter(Boolean), answer: str(worked.result || worked.answer) } : null,
      misconception: mistakes[0] || null,
    },
    weDo: {
      modelled: faded ? { problem: str(faded.prompt), work: arr(faded.steps).map(str).filter(Boolean), answer: str(faded.answer || faded.result) } : null,
    },
    youDo: {
      problems: practice.map((p) => ({ prompt: str(p && p.q), answer: str(p && p.a) })).filter((p) => p.prompt),
    },
    misconceptions: mistakes.slice(1),
    wrap: {
      keyFacts: [...keyPoints, ...boardLines],
      exitOptions: [
        ...exitTicket.map((x) => ({ prompt: str(x && x.q), answer: str(x && x.a) })),
        ...examMcq.map((m) => ({ prompt: str(m && m.q), choices: arr(m && m.options).map(str), answer: str(m && m.answer) })),
      ].filter((x) => x.prompt),
      homework: homeworkItems.map((h) => ({ prompt: str(h && h.text), answer: str(homeworkKey.get(h && h.ref)) }))
        .filter((h) => h.prompt),
    },
  };
}

/** Is this S3/R2 error the object simply not being there? */
function isMissing(err) {
  const e = err || {};
  const status = e.$metadata && e.$metadata.httpStatusCode;
  return e.name === 'NoSuchKey' || e.Code === 'NoSuchKey' || e.name === 'NotFound' || status === 404;
}

/**
 * The stored document for ONE delivered 6-12 lesson, exact version.
 *
 * @param {{segment_id:string, lang:string, template_version:string}} lesson `quizzes.meta.lessons[0]`
 * @returns {Promise<object|null>} the lp_doc, or null when there is none for that version
 * @throws on any R2 failure other than a missing object
 */
async function resolveLessonDoc(lesson) {
  const l = lesson || {};
  if (!l.segment_id || !l.lang || !l.template_version) return null;
  const key = docKey(l);
  let buf;
  try {
    const { downloadFromR2 } = require('../../storage/r2');
    buf = await downloadFromR2(key);
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
  let doc;
  try {
    doc = JSON.parse(Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf));
  } catch (err) {
    logToFile('❌ lp612 quiz: the stored lesson document will not parse', { key, error: err.message }, 'error');
    return null;
  }
  // The reader's own floor (Serving.readStoredDoc): an object with no sections is not a lesson.
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !Array.isArray(doc.sections)) {
    logToFile('❌ lp612 quiz: the stored object is not a lesson document', { key }, 'error');
    return null;
  }
  return doc;
}

/** The delivered lesson, adapted — or null when there is no document for that exact version. */
async function resolveSlideScript(lesson) {
  const doc = await resolveLessonDoc(lesson);
  return doc ? toSlideScript(doc, { lang: lesson.lang }) : null;
}

module.exports = {
  toSlideScript, resolveLessonDoc, resolveSlideScript, LEVEL_BLOOM,
};
