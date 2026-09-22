#!/usr/bin/env node
'use strict';
/**
 * Does the generator actually deliver the count she asked for, PER TYPE?
 *
 *     node scripts/assessment/eval-per-type-counts.js --out <dir> [--cases 6] [--concurrency 3]
 *
 * bd-60175 let a teacher name a number against each question type instead of one
 * total we divided evenly. That is only worth shipping if the number survives
 * the model: a screen that collects "10 MCQs and 2 Brief Answers" and returns
 * six of each has moved the lie rather than fixed it.
 *
 * So every case here asks for a DELIBERATELY UNEVEN split — the shape the old
 * even-spread could never produce, and therefore the shape that proves the
 * counts travelled. A run that passes under `withCounts()`'s old arithmetic is
 * a run that proves nothing.
 *
 * It calls the same two services the worker calls (BookContent, Generation) with
 * the same arguments, then counts what came back per type and compares it to
 * what was asked. Nothing is inserted, uploaded or sent.
 *
 * Per case it writes <out>/<bookId>-<label>/: spec.json, user.txt, exam.json,
 * result.json. At the end, <out>/summary.json + a table on stdout.
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config();
const REF = (process.env.SUPABASE_URL || '').match(/https:\/\/([a-z]+)\./)?.[1];
const EXPECT_REF = process.env.EVAL_EXPECT_SUPABASE_REF || 'ihzciabopbttygxxgrkm';
if (REF !== EXPECT_REF) {
  console.error(`refusing: SUPABASE_URL points at ${REF}, expected ${EXPECT_REF} (set EVAL_EXPECT_SUPABASE_REF to override)`);
  process.exit(78);
}

const BookContent = require('../../bot/shared/services/assessment/book-content.service');
const Generation = require('../../bot/shared/services/assessment/assessment-generation.service');
const QuestionTypes = require('../../bot/shared/services/assessment/question-types');
const { summariseCounts } = require('./eval-plan');

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const OUT = arg('out');
const CONCURRENCY = Number(arg('concurrency', 3));
const LIMIT = Number(arg('cases', 6));
if (!OUT) { console.error('--out <dir> is required'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

/**
 * The cases. Each is a real (grade, subject) we hold a book for, and each asks
 * for a split no even spread could produce.
 *
 * `unseen` only: `both` hands half the paper to the book's own exercises and
 * re-spreads the types over what is left, so the number she typed is no longer
 * the number the model is asked for. That is by design (planCounts), and
 * measuring it here would be measuring the halving, not the counts.
 */
const CASES = [
  { grade: 4, subject: 'science',  types: [['MCQs', 8], ['Brief Answers', 2]] },
  { grade: 5, subject: 'english',  types: [['MCQs', 7], ['Fill in the Blanks', 3], ['Word Meanings', 2]] },
  { grade: 3, subject: 'maths',    types: [['MCQs', 9], ['Short Questions', 2]] },
  { grade: 5, subject: 'science',  types: [['True/False', 6], ['MCQs', 4], ['Mind Map', 1]] },
  { grade: 4, subject: 'english',  types: [['Fill in the Blanks', 8], ['MCQs', 3]] },
  { grade: 5, subject: 'maths',    types: [['MCQs', 10], ['Word Problems', 2]] },
  { grade: 4, subject: 'islamiat', types: [['MCQs', 7], ['Short Questions', 3]] },
  { grade: 3, subject: 'english',  types: [['MCQs', 6], ['Missing Letters', 4], ['Word Meanings', 2]] },
];

function specFor(c, chapterNumber) {
  const questionTypes = c.types.map(([id, count]) => ({
    id, count, category: QuestionTypes.categoryOf(id, c.subject, c.grade),
  }));
  return {
    label: `g${c.grade}-${c.subject}`,
    grade: c.grade,
    subject: c.subject,
    chapterNumber,
    contentSource: 'unseen',
    // What the endpoint does now: the size of the paper is the SUM of her
    // boxes, never a number typed separately from them.
    questionCount: questionTypes.reduce((s, t) => s + t.count, 0),
    questionTypes,
    includeAnswerKey: false,
  };
}

function write(dir, name, data) {
  fs.writeFileSync(path.join(dir, name), typeof data === 'string' ? data : JSON.stringify(data, null, 1));
}

/**
 * Count what came back for one type, tolerating the names the model returns.
 *
 * The tree's keys are the type ids we asked for, but a model will occasionally
 * return "MCQ" for "MCQs" or differ in case or spacing. Matching loosely here
 * makes the eval measure the COUNT rather than the model's spelling — a
 * near-miss key would otherwise read as a total miss and overstate the failure.
 */
function deliveredFor(counts, typeId) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '');
  const want = norm(typeId);
  let n = 0;
  for (const [k, v] of Object.entries(counts.unseen || {})) {
    const got = norm(k);
    if (got === want || got === `${want}s` || `${got}s` === want) n += v;
  }
  return n;
}

async function runOne(c) {
  const dir = path.join(OUT, `g${c.grade}-${c.subject}`);
  fs.mkdirSync(dir, { recursive: true });
  const out = { grade: c.grade, subject: c.subject };
  try {
    const chapters = await BookContent.listChapters({ grade: c.grade, subject: c.subject });
    if (!chapters.length) throw new Error('no chapters for this book');
    const chapter = chapters[Math.min(1, chapters.length - 1)];
    const spec = specFor(c, chapter.chapterNumber);
    write(dir, 'spec.json', spec);

    const source = await BookContent.loadChapterContent({
      grade: c.grade, subject: c.subject, chapterNumber: spec.chapterNumber,
    });
    const promptArgs = {
      grade: c.grade, subject: c.subject,
      pageContent: source.content, pageReference: source.pageReference,
      contentSource: spec.contentSource,
      questionCount: spec.questionCount,
      questionTypes: spec.questionTypes,
    };
    write(dir, 'user.txt', Generation.buildUserPrompt(promptArgs));

    const generated = await Generation.generateExam({ ...promptArgs, includeAnswerKey: false });
    write(dir, 'exam.json', generated.examJson);

    const counts = summariseCounts(generated.examJson);
    const perType = spec.questionTypes.map((t) => {
      const delivered = deliveredFor(counts, t.id);
      return { id: t.id, asked: t.count, delivered, exact: delivered === t.count };
    });

    Object.assign(out, {
      status: 'ok',
      chapterNumber: spec.chapterNumber,
      askedTotal: spec.questionCount,
      deliveredTotal: counts.total,
      totalExact: counts.total === spec.questionCount,
      perType,
      typesExact: perType.filter((p) => p.exact).length,
      typesAsked: perType.length,
      // The question the even-split could never pass: are the counts DIFFERENT
      // from each other in the way she asked? A paper that is exact on every
      // type is necessarily uneven here, since every case asks unevenly.
      allExact: perType.every((p) => p.exact),
    });
  } catch (err) {
    Object.assign(out, { status: 'failed', error: err.message, code: err.code });
  }
  write(dir, 'result.json', out);
  const tag = out.status === 'ok'
    ? `${out.typesExact}/${out.typesAsked} types exact · total ${out.deliveredTotal}/${out.askedTotal}`
    : `FAILED ${out.error}`;
  console.log(`  ${out.grade} ${out.subject.padEnd(18)} ${tag}`);
  return out;
}

async function pool(items, n, fn) {
  const results = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const mine = i; i += 1;
      results[mine] = await fn(items[mine]);
    }
  }));
  return results;
}

async function main() {
  const cases = CASES.slice(0, LIMIT);
  console.log(`per-type count adherence — ${cases.length} cases, unseen only, uneven splits\n`);
  const results = await pool(cases, CONCURRENCY, runOne);

  const ok = results.filter((r) => r.status === 'ok');
  const typesAsked = ok.reduce((s, r) => s + r.typesAsked, 0);
  const typesExact = ok.reduce((s, r) => s + r.typesExact, 0);
  const papersAllExact = ok.filter((r) => r.allExact).length;
  const totalsExact = ok.filter((r) => r.totalExact).length;

  // How far off, when it is off — a type that misses by one is a different
  // product problem from a type that comes back empty.
  const drift = [];
  for (const r of ok) for (const p of r.perType) if (!p.exact) drift.push(p.delivered - p.asked);

  const summary = {
    cases: cases.length,
    ran: ok.length,
    failed: results.length - ok.length,
    typesAsked,
    typesExact,
    typeAccuracy: typesAsked ? +(typesExact / typesAsked).toFixed(3) : null,
    papersAllExact,
    paperAccuracy: ok.length ? +(papersAllExact / ok.length).toFixed(3) : null,
    totalsExact,
    drift: drift.length ? {
      n: drift.length,
      mean: +(drift.reduce((s, d) => s + d, 0) / drift.length).toFixed(2),
      worst: drift.reduce((w, d) => (Math.abs(d) > Math.abs(w) ? d : w), 0),
    } : null,
    results,
  };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));

  console.log(`\n  types exact   ${typesExact}/${typesAsked}  (${Math.round(100 * typesExact / (typesAsked || 1))}%)`);
  console.log(`  papers exact  ${papersAllExact}/${ok.length}`);
  console.log(`  totals exact  ${totalsExact}/${ok.length}`);
  if (summary.drift) console.log(`  drift         mean ${summary.drift.mean}, worst ${summary.drift.worst}`);
  if (summary.failed) console.log(`  failed        ${summary.failed}`);
  console.log(`\n  ${path.join(OUT, 'summary.json')}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
