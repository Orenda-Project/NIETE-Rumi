#!/usr/bin/env node
/**
 * bd-60131 — I-SAPS CRQ marker eval.
 *
 * Runs a golden set of CRQ answers through two markers and records what each
 * awards, so the marks can be compared with the hand grades:
 *
 *   live    the production path, byte for byte: capstone-delivery's
 *           scoreAnswer(question, answer, 10). It sees the question and the
 *           answer and a generic "specific, practical" instruction. It never
 *           sees the I-SAPS rubric or model answer — the seeder extracted both
 *           and stored neither (training_questions has no column for them).
 *
 *   rubric  the same model and temperature, handed the printed rubric and the
 *           I-SAPS "possible answer" as notes on key components, asked for a
 *           mark per criterion. This is what doc §4.3 describes: AI marking
 *           "based on the rubrics and notes on key components of a correct
 *           answer". A proposal, not production.
 *
 * The golden set (answers + per-criterion hand grades + the rubrics and model
 * answers themselves) is exam-confidential and lives OUTSIDE the repo. This
 * script takes its path. Nothing here writes to a database.
 *
 * Usage:
 *   node scripts/training/isaps-crq-eval.js --golden <golden_set.json> --out <results.jsonl>
 *        [--runs 3] [--variants live,rubric] [--concurrency 5] [--model openai/gpt-4o]
 *        [--env .env.sandbox] [--ids S1,S2,M1-1] [--limit N]
 *
 * Output is JSONL, one record per (answer, variant, run), appended as it goes,
 * so an interrupted run resumes without re-spending on finished calls.
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = { runs: 1, variants: 'live,rubric', concurrency: 4, env: '.env.sandbox' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { out[key] = true; continue; }
    out[key] = next; i += 1;
  }
  return out;
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.golden || !args.out) {
    console.error('usage: --golden <golden_set.json> --out <results.jsonl> [--runs N] [--variants live,rubric] [--model id]');
    process.exit(2);
  }
  require('dotenv').config({ path: path.resolve(args.env), quiet: true });
  if (args.model) process.env.LLM_MODEL = args.model;
  // An eval is not bot traffic. The bot's structured logger ships every
  // api.cost.incurred event to Axiom when these are set, and the smoke run
  // put seven eval rows into the sandbox dataset before this was noticed.
  delete process.env.AXIOM_TOKEN;
  delete process.env.AXIOM_DATASET;
  // The same logger replaces console.error with a JSON writer; progress lines
  // go straight to the stream so they stay readable.
  const say = (line) => process.stderr.write(`${line}\n`);

  // Required after dotenv so the client reads the same env the bot would.
  const Capstone = require('../../bot/shared/services/training/capstone-delivery.service');
  const llm = require('../../bot/shared/services/llm-client');
  const lib = require('./isaps-crq-eval.lib');

  const model = llm.getDefaultModel();
  const runs = Number(args.runs) || 1;
  const variants = String(args.variants).split(',').map((s) => s.trim()).filter(Boolean);
  const concurrency = Number(args.concurrency) || 4;

  let entries = JSON.parse(fs.readFileSync(args.golden, 'utf8'));
  if (args.ids) {
    const want = new Set(String(args.ids).split(',').map((s) => s.trim()));
    entries = entries.filter((e) => want.has(e.id));
  }
  if (args.limit) entries = entries.slice(0, Number(args.limit));

  const done = new Set(readJsonl(args.out).map((r) => `${r.id}|${r.variant}|${r.run}`));
  const jobs = [];
  for (const entry of entries) {
    for (const variant of variants) {
      for (let run = 1; run <= runs; run += 1) {
        if (!done.has(`${entry.id}|${variant}|${run}`)) jobs.push({ entry, variant, run });
      }
    }
  }
  say(`model=${model} entries=${entries.length} variants=${variants.join('+')} runs=${runs} jobs=${jobs.length} (skipping ${done.size} already done)`);

  const outStream = fs.createWriteStream(args.out, { flags: 'a' });
  const append = (rec) => outStream.write(`${JSON.stringify(rec)}\n`);

  async function scoreLive(entry) {
    // Exactly what quiz-delivery calls when a CRQ answer arrives (bd-60128).
    const { score, feedback } = await Capstone.scoreAnswer({ question_text: entry.prompt }, entry.answer_text, entry.total_marks);
    return { score, feedback, criteria: null, usage: null, parse_ok: true, raw: null };
  }

  async function scoreRubric(entry) {
    const client = llm.getClient();
    const maxima = lib.criterionMaxima(entry.rubric, entry.total_marks);
    const messages = lib.buildRubricMarkerMessages({
      prompt: entry.prompt, rubric: entry.rubric, modelAnswer: entry.model_answer,
      answer: entry.answer_text, totalMarks: entry.total_marks, maxima,
    });
    const response = await client.chat.completions.create({
      model, temperature: 0, max_tokens: 900, response_format: { type: 'json_object' }, messages,
    });
    const raw = response.choices?.[0]?.message?.content || '';
    const parsed = lib.parseMarkerReply(raw, maxima);
    return {
      score: parsed.total, feedback: parsed.feedback, criteria: parsed.criteria, parse_ok: parsed.ok,
      usage: response.usage || null, raw,
    };
  }

  let completed = 0;
  async function runJob(job) {
    const { entry, variant, run } = job;
    const t0 = Date.now();
    let result;
    let error = null;
    for (let attempt = 1; attempt <= 2 && !result; attempt += 1) {
      try {
        result = variant === 'live' ? await scoreLive(entry) : await scoreRubric(entry);
      } catch (e) {
        error = String(e?.message || e).slice(0, 300);
        if (attempt === 2) result = { score: null, feedback: null, criteria: null, usage: null, parse_ok: false, raw: null };
      }
    }
    const rec = {
      id: entry.id, kind: entry.kind, module: entry.module, item_no: entry.item_no, variant, run, model,
      golden_total: entry.golden_total, golden_criteria: entry.criteria.map((c) => c.golden),
      ...result, error, latency_ms: Date.now() - t0, at: new Date().toISOString(),
    };
    append(rec);
    completed += 1;
    const delta = rec.score === null ? 'ERR' : (rec.score - entry.golden_total >= 0 ? '+' : '') + (rec.score - entry.golden_total);
    say(`[${completed}/${jobs.length}] ${entry.id.padEnd(6)} ${variant.padEnd(6)} run${run} score=${rec.score ?? 'ERR'} golden=${entry.golden_total} (${delta}) ${rec.latency_ms}ms${error ? ` error=${error}` : ''}`);
  }

  // Small worker pool: the marker is one HTTP call per job, nothing shared.
  const queue = [...jobs];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) await runJob(queue.shift());
  });
  await Promise.all(workers);
  await new Promise((resolve) => outStream.end(resolve));
  say('done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
