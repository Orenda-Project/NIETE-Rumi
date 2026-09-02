#!/usr/bin/env node
'use strict';
/**
 * Run the assessment generator over every ICT book and keep everything: the
 * pages it was given, the exact prompts, the model's JSON, the rendered paper.
 *
 *     node scripts/assessment/eval-run.js --out <dir> [--only 1171,1172] [--concurrency 3] [--plan-only]
 *
 * Reads the same tables the bot reads (textbooks / textbook_toc /
 * textbook_pages on whatever SUPABASE_URL the .env points at) and calls the
 * same three services the worker calls — BookContent, Generation, Renderer —
 * in the same order with the same arguments. It does NOT insert request or
 * paper rows, upload to R2, or send anything on WhatsApp: it is the pipeline
 * with the delivery cut off, so the output can be read instead of received.
 *
 * Per exam it writes <out>/<bookId>-<label>/:
 *   spec.json        what was asked (grade, subject, chapter, types, counts)
 *   pages.json       the pages that were loaded, printed + pdf index each
 *   content.txt      the text the model saw, exactly as assembled
 *   system.txt       the system prompt
 *   user.txt         the user prompt
 *   exam.json        the model's JSON, after stripImageKeys
 *   result.json      counts asked vs delivered, tokens, timing, or the error
 *   paper.html       the rendered paper
 *   paper.pdf        the same, through Chromium
 */

const fs = require('fs');
const path = require('path');

// Refuse to run against anything but the database the operator expects.
// (dotenv lives in bot/'s dependencies, not the repo root's.)
require(require.resolve('dotenv', { paths: [path.join(__dirname, '../../bot')] })).config();
const REF = (process.env.SUPABASE_URL || '').match(/https:\/\/([a-z]+)\./)?.[1];
const EXPECT_REF = process.env.EVAL_EXPECT_SUPABASE_REF || 'rpqkekcfvumypldbejhp';
if (REF !== EXPECT_REF) {
  console.error(`refusing: SUPABASE_URL points at ${REF}, expected ${EXPECT_REF} (set EVAL_EXPECT_SUPABASE_REF to override)`);
  process.exit(78);
}

const supabase = require('../../bot/shared/config/supabase');
const BookContent = require('../../bot/shared/services/assessment/book-content.service');
const Generation = require('../../bot/shared/services/assessment/assessment-generation.service');
const Renderer = require('../../bot/shared/services/assessment/assessment-paper.renderer');
const { htmlToPdf, closeBrowser } = require('../../bot/shared/utils/html-to-pdf');
const { examSpecs, summariseCounts } = require('./eval-plan');

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const OUT = arg('out');
const ONLY = arg('only') ? String(arg('only')).split(',').map((s) => s.trim()) : null;
const CONCURRENCY = Number(arg('concurrency', 3));
const PLAN_ONLY = !!arg('plan-only');
if (!OUT) { console.error('--out <dir> is required'); process.exit(2); }

// (grade, subject) -> Taleemabad book id, the same map the importer uses, so an
// exam folder is named after the book it came from.
const BOOK_IDS = {
  'english:1': 1171, 'english:2': 1172, 'english:3': 1173, 'english:4': 1163, 'english:5': 1168,
  'urdu:1': 1169, 'urdu:2': 1175, 'urdu:3': 1160, 'urdu:4': 1170, 'urdu:5': 1174,
  'maths:1': 1159, 'maths:2': 1165, 'maths:3': 1161, 'maths:4': 1164, 'maths:5': 1167,
  'islamiat:1': 1096, 'islamiat:2': 1097, 'islamiat:3': 1098, 'islamiat:4': 1099, 'islamiat:5': 1100,
  'science:4': 1166, 'science:5': 1162,
  'general_knowledge:1': 1058, 'general_knowledge:2': 1063, 'general_knowledge:3': 1037,
  'social_studies:4': 1034, 'social_studies:5': 1062,
};

async function books() {
  const { data: tbs, error } = await supabase.from('textbooks')
    .select('id, grade, subject, filename, pdf_page_offset, total_pages')
    .eq('curriculum', 'ict').order('subject').order('grade');
  if (error) throw error;
  const out = [];
  for (const t of tbs) {
    const { data: toc } = await supabase.from('textbook_toc')
      .select('chapter_number, chapter_title, page_start, page_end')
      .eq('textbook_id', t.id).order('chapter_number');
    out.push({
      ...t,
      bookId: BOOK_IDS[`${t.subject}:${t.grade}`],
      chapters: (toc || []).map((c) => ({ n: c.chapter_number, title: c.chapter_title, start: c.page_start, end: c.page_end })),
    });
  }
  return out;
}

function write(dir, name, data) {
  fs.writeFileSync(path.join(dir, name), typeof data === 'string' ? data : JSON.stringify(data, null, 1));
}

async function runOne(book, spec) {
  const dir = path.join(OUT, `${book.bookId}-${spec.label}`);
  fs.mkdirSync(dir, { recursive: true });
  const { grade, subject } = book;
  const startedAt = Date.now();
  write(dir, 'spec.json', {
    bookId: book.bookId, textbookId: book.id, title: book.filename, grade, subject,
    pdfPageOffset: book.pdf_page_offset, ...spec,
  });

  const result = { bookId: book.bookId, label: spec.label, grade, subject, chapterNumber: spec.chapterNumber };
  try {
    const source = await BookContent.loadChapterContent({ grade, subject, chapterNumber: spec.chapterNumber });
    const { data: pageRows } = await supabase.from('textbook_pages')
      .select('textbook_page_number, pdf_page_index, content_length')
      .eq('textbook_id', book.id).in('textbook_page_number', source.pagesFound)
      .order('textbook_page_number');
    write(dir, 'pages.json', {
      pageReference: source.pageReference, chapterTitle: source.chapterTitle,
      pagesFound: source.pagesFound, pages: pageRows || [],
    });
    write(dir, 'content.txt', source.content);

    const promptArgs = {
      grade, subject, pageContent: source.content, pageReference: source.pageReference,
      contentSource: spec.contentSource, questionTypes: spec.questionTypes,
    };
    write(dir, 'system.txt', Generation.buildSystemPrompt({ subject, includeAnswerKey: spec.includeAnswerKey }));
    write(dir, 'user.txt', Generation.buildUserPrompt(promptArgs));
    if (PLAN_ONLY) { result.status = 'planned'; result.contentChars = source.content.length; write(dir, 'result.json', result); return result; }

    let generated; let attempts = 0; let lastErr;
    while (attempts < 2 && !generated) {
      attempts += 1;
      try {
        generated = await Generation.generateExam({ ...promptArgs, includeAnswerKey: spec.includeAnswerKey });
      } catch (err) {
        lastErr = err;
        if (!['MODEL_UNAVAILABLE', 'BAD_JSON'].includes(err.code)) break;
      }
    }
    if (!generated) throw lastErr;
    write(dir, 'exam.json', generated.examJson);

    const html = Renderer.renderPaper({
      examJson: generated.examJson, grade, subject, schoolName: null,
      pageReference: source.pageReference, chapterTitle: source.chapterTitle || null,
      includeAnswerKey: spec.includeAnswerKey, answerLines: spec.answerLines,
    });
    write(dir, 'paper.html', html);
    let pdfOk = false;
    try {
      const buffer = await htmlToPdf(html, { timeout: 90000 });
      fs.writeFileSync(path.join(dir, 'paper.pdf'), buffer);
      pdfOk = true;
    } catch (err) { result.renderError = err.message; }

    const counts = summariseCounts(generated.examJson);
    const questions = Renderer.collectQuestions ? Renderer.collectQuestions(generated.examJson) : [];
    Object.assign(result, {
      status: 'ok', attempts, chapterTitle: source.chapterTitle, pageReference: source.pageReference,
      pagesLoaded: source.pagesFound.length, contentChars: source.content.length,
      asked: { total: spec.questionCount, types: spec.questionTypes.map((t) => ({ id: t.id, count: t.count, category: t.category })) },
      delivered: counts, questionCount: generated.questionCount,
      totalMarks: Renderer.totalMarks ? Renderer.totalMarks(questions) : null,
      tokens: generated.tokenData, elapsedMs: generated.elapsedMs, pdfOk,
    });
  } catch (err) {
    Object.assign(result, { status: 'failed', code: err.code || 'UNKNOWN', error: err.message });
  }
  result.wallMs = Date.now() - startedAt;
  write(dir, 'result.json', result);
  return result;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const all = await books();
  const jobs = [];
  for (const b of all) {
    if (!b.bookId) { console.error(`no book id for ${b.subject} ${b.grade}`); continue; }
    if (ONLY && !ONLY.includes(String(b.bookId))) continue;
    for (const spec of examSpecs({ grade: b.grade, subject: b.subject, chapters: b.chapters })) jobs.push([b, spec]);
  }
  console.log(`${jobs.length} exams over ${new Set(jobs.map((j) => j[0].bookId)).size} books -> ${OUT}`);
  const results = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const [b, spec] = jobs[next++];
      const r = await runOne(b, spec);
      results.push(r);
      const tag = `${b.bookId}-${spec.label} G${b.grade} ${b.subject} ch${spec.chapterNumber}`;
      if (r.status === 'ok') console.log(`ok    ${tag}  asked ${r.asked.total} got ${r.delivered.total} (seen ${r.delivered.seenTotal} / unseen ${r.delivered.unseenTotal})  ${Math.round(r.elapsedMs / 1000)}s  pdf=${r.pdfOk}`);
      else console.log(`${r.status.padEnd(5)} ${tag}  ${r.code || ''} ${r.error || ''}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  results.sort((a, b) => String(a.subject).localeCompare(b.subject) || a.grade - b.grade || a.label.localeCompare(b.label));
  write(OUT, 'results.json', results);
  const ok = results.filter((r) => r.status === 'ok').length;
  console.log(`done: ${ok}/${results.length} ok`);
  try { if (closeBrowser) await closeBrowser(); } catch {}
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
