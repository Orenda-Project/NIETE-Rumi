#!/usr/bin/env node
'use strict';
/**
 * Board-pattern papers made on a developer's machine, without the queue, the
 * paper row or the upload: the generator, the layout, both renderers and the
 * PDF step exactly as the worker runs them, and the files written to a folder.
 *
 * Dev-only. It exists so reviewers can read real papers before a branch is
 * deployed. It READS the books (and the model settings) and never writes a
 * row: every request to the database that is not a GET is refused here, before
 * it leaves the process, and the database's project ref is checked against
 * --expect-ref before the first call.
 *
 *   node bot/scripts/fde-gen-local.js --env <file> --expect-ref <ref> --out <dir> \
 *     --job maths:full:1 --job maths:chapters:4:3 --job science:chapters:5:2,3 [--parallel 3] [--max-cost 0.9]
 *
 * A job is <subject>:full:<n> (the pattern's own syllabus) or
 * <subject>:chapters:<n>:<c1,c2,...> (those chapters, as the app sends them).
 * Each paper lands in <out>/<subject>/<full|chapters>_<n>/:
 *   request.json  exam_json.json  paper.pdf  scheme.pdf  timing.json  log.txt
 * and, when the paper is refused, error.json in place of the files it never got.
 */

const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

const PATTERN = 'fde_g5_2027';
const GRADE = 5;

function parseArgs(argv) {
  const out = { jobs: [], parallel: 3, maxCost: 0.9 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--env') out.env = next();
    else if (a === '--expect-ref') out.expectRef = next();
    else if (a === '--out') out.out = next();
    else if (a === '--job') out.jobs.push(next());
    else if (a === '--parallel') out.parallel = Math.max(1, Number(next()) || 1);
    else if (a === '--max-cost') out.maxCost = Number(next());
    else throw new Error(`unknown argument ${a}`);
  }
  if (!out.env || !out.expectRef || !out.out || !out.jobs.length) {
    throw new Error('usage: --env <file> --expect-ref <ref> --out <dir> --job <spec> [--job …]');
  }
  return out;
}

function parseJob(spec) {
  const [subject, kind, n, chapters] = spec.split(':');
  if (!subject || !['full', 'chapters'].includes(kind) || !n) throw new Error(`bad job ${spec}`);
  const picked = kind === 'chapters' ? String(chapters || '').split(',').map(Number).filter(Number.isFinite) : [];
  if (kind === 'chapters' && !picked.length) throw new Error(`job ${spec} names no chapters`);
  return { spec, subject, kind, n: Number(n), picked };
}

/** KEY=value lines into process.env; values never printed. */
function loadEnv(file) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
}

function projectRef(url) {
  try { return new URL(url).hostname.split('.')[0]; } catch { return null; }
}

/** The database is read here, never written: refuse anything but GET/HEAD to it. */
function guardDatabaseWrites(dbHost) {
  const base = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    let host = null;
    try { host = new URL(url).hostname; } catch { /* not a URL we judge */ }
    if (host === dbHost && method !== 'GET' && method !== 'HEAD') {
      return Promise.reject(new Error(`fde-gen-local refuses ${method} to the database (${new URL(url).pathname})`));
    }
    return base(input, init);
  };
}

/** The same count the worker records: one `/Type /Page` object per page. */
function pdfPageCount(buffer) {
  const n = (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  return n > 0 ? n : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv(args.env);
  const ref = projectRef(process.env.SUPABASE_URL);
  if (ref !== args.expectRef) {
    console.error(`refusing: the database ref is ${ref}, not ${args.expectRef}`);
    process.exit(2);
  }
  // No log shipping from a developer's machine.
  delete process.env.AXIOM_TOKEN;
  delete process.env.AXIOM_API_TOKEN;
  guardDatabaseWrites(new URL(process.env.SUPABASE_URL).hostname);
  console.log(`database ref ${ref} (reads only)`);

  // Every log line the generator writes goes to the paper it belongs to. The
  // logger is wrapped before the generator is loaded, which destructures it.
  const ctx = new AsyncLocalStorage();
  const logger = require('../shared/utils/logger');
  const original = logger.logToFile;
  logger.logToFile = (message, data = null, level = 'info') => {
    const store = ctx.getStore();
    if (store) store.lines.push(`${new Date().toISOString()} ${level} ${message}${data ? ` ${JSON.stringify(data)}` : ''}`);
    return original(message, data, level);
  };

  // Every model reply is kept beside the paper (raw.json), so a refused paper
  // can still be read and a good one can become a recorded test fixture.
  const llm = require('../shared/services/llm-client');
  const getClient = llm.getClient;
  llm.getClient = (...a) => {
    const client = getClient(...a);
    const create = client.chat.completions.create.bind(client.chat.completions);
    const wrapped = async (body, opts) => {
      const user = ((body.messages || []).find((m) => m.role === 'user') || {}).content || '';
      const section = (String(user).match(/\*\*SECTION ([A-Z0-9]+)\*\*/) || [])[1] || null;
      const began = Date.now();
      const store = ctx.getStore();
      try {
        const res = await create(body, opts);
        if (store) {
          store.raw.push({
            section, model: body.model, max_tokens: body.max_tokens, elapsedMs: Date.now() - began,
            finish_reason: res?.choices?.[0]?.finish_reason || null, usage: res?.usage || null,
            content: res?.choices?.[0]?.message?.content || '',
          });
        }
        return res;
      } catch (err) {
        if (store) store.raw.push({ section, model: body.model, elapsedMs: Date.now() - began, error: err.message });
        throw err;
      }
    };
    return { ...client, chat: { ...client.chat, completions: { ...client.chat.completions, create: wrapped } } };
  };

  const Generation = require('../shared/services/assessment/assessment-generation.service');
  const Renderer = require('../shared/services/assessment/assessment-paper.renderer');
  const FdeRenderer = require('../shared/services/assessment/assessment-paper-fde.renderer');
  const Browse = require('../shared/services/assessment/assessment-browse.service');
  const { htmlToPdf, closeBrowser } = require('../shared/utils/html-to-pdf');
  const { SUBJECT_LABEL } = require('../shared/services/assessment/assessment-vocabulary');

  const jobs = args.jobs.map(parseJob);
  // One browser for the whole run, one render at a time.
  let renderChain = Promise.resolve();
  const renderSerial = (fn) => {
    const run = renderChain.then(fn, fn);
    renderChain = run.catch(() => {});
    return run;
  };
  const failures = {};
  const results = [];

  async function one(job) {
    const dir = path.join(args.out, job.subject, `${job.kind}_${job.n}`);
    fs.mkdirSync(dir, { recursive: true });
    const lines = [];
    const raw = [];
    const write = (name, body) => fs.writeFileSync(path.join(dir, name), body);
    return ctx.run({ lines, raw }, async () => {
      const began = Date.now();
      let scope = null;
      let pageRanges = null;
      if (job.kind === 'full') {
        scope = { kind: 'fde', chapters: null, pages: null };
      } else {
        const listed = await Browse.listChapters(GRADE, job.subject);
        const spans = job.picked
          .map((n) => listed.find((c) => c.chapter_number === n))
          .filter((c) => c && c.page_start != null && c.page_end != null)
          .map((c) => `${c.page_start}-${c.page_end}`);
        pageRanges = spans.join(', ') || null;
        scope = { kind: 'chapters', chapters: job.picked, pages: pageRanges };
      }
      const request = { grade: GRADE, subject: job.subject, pattern: PATTERN, scope, pageRanges, job: job.spec };
      write('request.json', JSON.stringify(request, null, 2));

      let generated;
      try {
        generated = await Generation.generatePatternExam({
          grade: GRADE, subject: job.subject, pattern: PATTERN, scope,
          pageRanges, chapterNumber: job.picked.length === 1 ? job.picked[0] : null,
        });
      } catch (err) {
        const error = { code: err.code || 'ERROR', message: err.message, extra: err.extra || err.details || null, elapsedMs: Date.now() - began };
        Object.keys(err).forEach((k) => { if (!(k in error) && k !== 'stack') error[k] = err[k]; });
        write('error.json', JSON.stringify(error, null, 2));
        write('raw.json', JSON.stringify(raw, null, 2));
        write('log.txt', lines.join('\n'));
        failures[job.subject] = (failures[job.subject] || 0) + 1;
        return { job: job.spec, ok: false, code: error.code, elapsedMs: error.elapsedMs };
      }
      const genMs = Date.now() - began;

      const files = await renderSerial(async () => {
        let examJson = generated.examJson;
        const paperHtml = Renderer.renderPaper({
          examJson, grade: GRADE, subject: job.subject, schoolName: null,
          pageReference: generated.pageReference, chapterTitle: null, answerLines: true,
        });
        const paper = await htmlToPdf(paperHtml, { pdfOptions: FdeRenderer.pdfOptions(examJson, 'paper') });
        const paperPages = pdfPageCount(paper);
        let framePages = null;
        try {
          const found = await FdeRenderer.framePages(paper);
          if (found && Object.keys(found).length) framePages = found;
        } catch (err) {
          lines.push(`frame pages unreadable: ${err.message}`);
        }
        examJson = { ...examJson, _layout: { ...examJson._layout, pages: paperPages == null ? null : { paper: paperPages, scheme: null }, ...(framePages ? { frame_pages: framePages } : {}) } };
        // The worker's own file name (orchestrator fileName): the scheme's box prints it.
        const label = (SUBJECT_LABEL[job.subject] || job.subject).replace(/[^A-Za-z0-9]/g, '');
        const paperFileName = `Grade${GRADE}_${label}_FDE.pdf`;
        const schemeHtml = Renderer.renderAnswerKey({
          examJson, grade: GRADE, subject: job.subject, schoolName: null,
          pageReference: generated.pageReference, chapterTitle: null, paperFileName,
        });
        const scheme = await htmlToPdf(schemeHtml, { pdfOptions: FdeRenderer.pdfOptions(examJson, 'scheme') });
        examJson = { ...examJson, _layout: { ...examJson._layout, pages: { paper: paperPages, scheme: pdfPageCount(scheme) } } };
        return { examJson, paper, scheme, paperHtml, schemeHtml };
      });

      write('paper.pdf', files.paper);
      write('scheme.pdf', files.scheme);
      write('paper.html', files.paperHtml);
      write('scheme.html', files.schemeHtml);
      write('exam_json.json', JSON.stringify(files.examJson, null, 2));
      const cost = generated.sections.reduce((s, x) => (x.usage && x.usage.cost != null ? s + Number(x.usage.cost) : s), 0);
      const timing = {
        job: job.spec,
        model: generated.tokenData && generated.tokenData.model,
        generateMs: genMs,
        totalMs: Date.now() - began,
        tokens: generated.tokenData,
        costUsd: Number(cost.toFixed(4)),
        sections: generated.sections,
        pages: files.examJson._layout.pages,
        questionCount: generated.questionCount,
        totalMarks: FdeRenderer.totalMarks(files.examJson),
        layout: generated.layout,
      };
      write('timing.json', JSON.stringify(timing, null, 2));
      write('raw.json', JSON.stringify(raw, null, 2));
      write('log.txt', lines.join('\n'));
      return { job: job.spec, ok: true, elapsedMs: timing.totalMs, costUsd: timing.costUsd, pages: timing.pages };
    });
  }

  // A pool of `parallel` papers in flight; a subject that has failed twice is not tried again,
  // and a paper over the cost ceiling stops the run.
  const queue = jobs.slice();
  let stop = null;
  async function worker() {
    while (queue.length && !stop) {
      const job = queue.shift();
      if ((failures[job.subject] || 0) >= 2) {
        results.push({ job: job.spec, ok: false, code: 'SKIPPED_AFTER_TWO_FAILURES' });
        continue;
      }
      let r;
      try {
        r = await one(job);
      } catch (err) {
        failures[job.subject] = (failures[job.subject] || 0) + 1;
        r = { job: job.spec, ok: false, code: err.code || 'HARNESS_ERROR', message: err.message };
      }
      results.push(r);
      console.log(JSON.stringify(r));
      fs.appendFileSync(path.join(args.out, 'runs.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...r })}\n`);
      if (r.ok && Number.isFinite(args.maxCost) && r.costUsd > args.maxCost) stop = `${job.spec} cost $${r.costUsd}`;
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(args.parallel, jobs.length) }, worker));
  } finally {
    await closeBrowser().catch(() => {});
  }
  if (stop) console.log(`STOPPED: ${stop} is over the ceiling`);
  console.log(`DONE ${results.filter((r) => r.ok).length}/${jobs.length}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
