#!/usr/bin/env node
'use strict';
/**
 * Child test (bd-s1oo0.5) — offline evaluation of the L5 scoring pipeline.
 *
 * Runs the REAL pipeline (scoreBlock: Soniox → windows → Gemini / SpeechAce →
 * ai_marks) on the L8 fixtures and compares every field with its key:
 *
 *   real/<child>/{urdu,english,maths}.ogg + key.json   composites cut from the May 2026 study
 *   synthetic/<child>/…                                scripted audio, exact keys
 *   strips/*.jpg + *.key.json                          dirty written-maths photos
 *
 * Nothing is written to any database (an in-memory store stands in for L3's) and
 * no child audio, photo or name enters this repo: the fixtures folder and the
 * output folder are passed on the command line and live outside git.
 *
 *   node scripts/child-test/eval-scoring.js --fixtures <dir> --out <dir> --env <root .env> --soniox-env <file>
 *        [--only real|synthetic|strips] [--limit N] [--concurrency 4] [--item-bank <json>]
 *
 * Model replies are cached per (fixture, block) in <out>/cache so a re-run costs nothing.
 */

const fs = require('fs');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
}

function loadEnv(file, map) {
  if (!file || !fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const [, k, raw] = m;
    const v = raw.replace(/^["']|["']$/g, '');
    for (const [from, to] of Object.entries(map)) if (k === from && !process.env[to]) process.env[to] = v;
  }
}

const FIX = arg('fixtures');
const OUT = arg('out');
if (!FIX || !OUT) { console.error('usage: --fixtures <dir> --out <dir> [--env <.env>] [--soniox-env <.env>]'); process.exit(2); }
loadEnv(arg('env'), { NIETE_STAGING_OPENROUTER_API_KEY: 'OPENROUTER_API_KEY', SPEECHACE_API_KEY: 'SPEECHACE_API_KEY', SPEECHACE_ENDPOINT: 'SPEECHACE_ENDPOINT' });
loadEnv(arg('soniox-env'), { SONIOX_API_KEY: 'SONIOX_API_KEY' });
process.env.LLM_PROVIDER = 'openrouter';
// The bot's config refuses to load without Supabase settings. Point it at an address nothing
// listens on: the evaluation never touches a database, and if anything tried, it would fail.
process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'offline-eval-no-db';
for (const k of ['OPENROUTER_API_KEY', 'SONIOX_API_KEY']) if (!process.env[k]) { console.error(`${k} not set`); process.exit(2); }

const BOT = path.join(__dirname, '..', '..', 'bot', 'shared', 'services', 'child-test', 'scoring');
const { scoreBlock } = require(path.join(BOT, 'index.js'));
const { scoreStrip } = require(path.join(BOT, 'maths-photo.js'));

const ONLY = arg('only', 'real,synthetic,strips').split(',');
const LIMIT = Number(arg('limit', '1000'));
const CONC = Number(arg('concurrency', '4'));
const BANK = JSON.parse(fs.readFileSync(arg('item-bank', path.join(FIX, '..', 'content', 'item-bank.v1.json')), 'utf8'));
fs.mkdirSync(path.join(OUT, 'cache'), { recursive: true });

// ---- May 2026 items the bank does not have (English made-up words) --------------
const MAY_PW_ENG = ['maz', 'zaj', 'ver', 'lut', 'eaf', 'sno', 'mov', 'vod'];

function realSpec(key, block) {
  // L8 re-keyed the composites to the bank (story + questions of the child's grade, Form A, whose
  // first 60 words are the May passage). What the May test had and the bank does not stays May:
  // English made-up words (pw_eng) and quick sums (blfl level 1).
  const base = JSON.parse(JSON.stringify(BANK.grades[String(key.grade)].forms[key.form || 'A'][block]));
  const k = key.blocks[block] || {};
  if (block === 'maths') {
    const qs = (k.maths && k.maths.quick_sums && k.maths.quick_sums.items) || [];
    base.quick_sums = qs.map((lab, i) => {
      const m = /(\d+)\s*([+-])\s*(\d+)\s*=\s*(\d+)/.exec(lab) || [];
      return { id: `may-blfl1-${i + 1}`, prompt: `${m[1]} ${m[2]} ${m[3]}`, answer: Number(m[4]) };
    });
    base.written = []; base.word_problem = null;   // from the strip photo, evaluated on fixtures/strips
    return base;
  }
  if (block === 'english') base.nonwords = MAY_PW_ENG.map((t, i) => ({ id: `may-pw_eng-${i + 1}`, text: t, sounds: t.split('') }));
  if (block === 'urdu') { base.first_sounds = []; base.nonwords = []; }
  return base;
}

// Synthetic fixtures were scripted by L8 from its own provisional items (ids syn-*).
const SYN = (() => { try { return JSON.parse(fs.readFileSync(path.join(FIX, '_build', 'synth_items.json'), 'utf8')); } catch (_) { return null; } })();
const toks = (t) => String(t || '').split(/\s+/).map((w) => w.replace(/[۔،.,!?؟:;"'()]/g, '')).filter(Boolean);

function synthSpec(key, block) {
  // L8 re-keys its synthetic fixtures against the bank once item-bank.v1.json lands (ids u3A-…);
  // only the provisional ones (ids syn-…) need L8's own items.
  const k = key.blocks && key.blocks[block];
  const firstId = k && ((k.questions || [])[0] || (k.nonwords || [])[0] || ((k.maths || {}).numbers || [])[0] || {}).id;
  if (!SYN || !String(firstId || '').startsWith('syn-')) return BANK.grades[String(key.grade)].forms[key.form || 'A'][block];
  const g5 = Number(key.grade) === 5;
  if (block === 'maths') {
    const m = SYN.maths;
    const nums = (g5 ? m.numbers_g5 : m.numbers_g3) || [];
    const sums = (g5 ? m.quick_sums_g5 : m.quick_sums_g3) || [];
    const ev = (p) => { const [a, op, b] = p.split(/\s+/); return op === '+' ? Number(a) + Number(b) : Number(a) - Number(b); };
    return {
      numbers: nums.map(([v], i) => ({ id: `syn-m${key.grade}-n${i + 1}`, value: v })),
      quick_sums: sums.map((p, i) => ({ id: `syn-m${key.grade}-qs${i + 1}`, prompt: p, answer: ev(p) })),
      written: [], word_problem: null,
    };
  }
  const L = SYN[block];
  const text = g5 ? `${L.story_g3} ${L.story_g5_continuation}` : L.story_g3;
  return {
    story: { id: `syn-${block}-story`, text, tokens: toks(text) },
    questions: (L.questions || []).map((q) => ({ id: q.id, prompt: q.prompt, accept: [q.right], reject: [q.wrong], rubric: '' })),
    first_sounds: (L.first_sounds || []).map((f) => ({ id: f.id, word: f.word, sound: f.sound })),
    nonwords: (L.nonwords || []).map((n) => ({ id: n.id, text: n.text, sounds: [...n.text] })),
    fallback: L.fallback ? { letters: L.fallback.letters, words: L.fallback.words } : null,
  };
}

// The synthetic coach speaks a fixed intro line before each section (CR-4): pass them as section cues.
function synthCue() {
  if (BANK.cue.urdu.questions || !SYN || !SYN.coach) return BANK.cue;   // the bank now carries section cues (CR-4)
  const c = SYN.coach;
  return {
    urdu: { ...BANK.cue.urdu, questions: c.questions_intro, first_sounds: c.first_sounds_intro, nonwords: c.nonwords_intro },
    english: { ...BANK.cue.english, questions: c.english_questions_intro, nonwords: c.english_nonwords_intro },
    maths: { ...BANK.cue.maths, numbers: c.numbers_intro, quick_sums: c.quick_sums_intro },
  };
}

// ---- in-memory store (L3 API shape) ----------------------------------------------
function memStore(row) {
  const out = { saved: null, statuses: [] };
  return {
    out,
    getBlock: async () => ({ ok: true, block: row }),
    setAiStatus: async (r) => { out.statuses.push(r); return { ok: true }; },
    saveAiMarks: async (r) => { out.saved = r; return { ok: true, block: { ...row, ai_marks: r.aiMarks } }; },
  };
}

const copyToTemp = (file, ext) => {
  const p = path.join(require('os').tmpdir(), `ctev-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`);
  fs.copyFileSync(file, p);
  return Promise.resolve(p);
};

async function runBlock({ id, dir, block, grade, form, spec, photo, cue }) {
  const cacheFile = path.join(OUT, 'cache', `${id}__${block}.json`);
  if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  const audio = path.join(dir, `${block}.ogg`);
  const row = { id: `${id}-${block}`, block, audio_r2_key: fs.existsSync(audio) ? audio : null, photo_r2_key: photo || null, ai_marks: null };
  const store = memStore(row);
  const itemBank = { getForm: () => ({ [block]: spec }), cue: cue || BANK.cue, version: BANK.version };
  const t0 = Date.now();
  const res = await scoreBlock({ sessionId: id, block, grade, form, force: true }, { store, itemBank, fetchMedia: copyToTemp });
  const rec = { id, block, res, wall_s: (Date.now() - t0) / 1000, aiMarks: store.out.saved && store.out.saved.aiMarks, transcript: store.out.saved && store.out.saved.transcript, statuses: store.out.statuses };
  fs.writeFileSync(cacheFile, JSON.stringify(rec));
  return rec;
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i; i += 1; try { out[k] = await fn(items[k]); } catch (e) { out[k] = { error: e.message }; } }
  }));
  return out;
}

// ---- comparisons --------------------------------------------------------------------
function storyRow(rec, keyStory, kind) {
  const ai = rec.aiMarks && rec.aiMarks.story;
  if (!keyStory) return null;
  const row = { id: rec.id, block: rec.block, kind, key_quality: keyStory.key_quality || 'exact', key_correct: keyStory.words_correct, key_attempted: keyStory.words_attempted,
    ai_correct: ai ? ai.words_correct : null, ai_attempted: ai ? ai.words_attempted : null, ai_conf: ai ? ai.confidence : null,
    flags: rec.aiMarks ? rec.aiMarks.protocol_flags : [], status: rec.res && rec.res.aiStatus, reason: rec.res && rec.res.reason,
    align_correct: null };
  if (ai) {
    const keyWrong = new Set((keyStory.flagged || []).map((f) => f.idx));
    const reach = Math.min(ai.words_attempted, keyStory.words_attempted);
    const aiWrong = new Set(ai.flagged.map((f) => f.idx));
    let tp = 0; let fp = 0; let fn = 0; let tpChip = 0; let fpChip = 0;
    for (let i = 0; i < reach; i += 1) {
      const a = aiWrong.has(i); const k = keyWrong.has(i);
      if (a && k) tp += 1; else if (a && !k) fp += 1; else if (!a && k) fn += 1;
      const chip = ai.flagged.find((f) => f.idx === i);
      if (chip && chip.confidence >= 0.6) { if (k) tpChip += 1; else fpChip += 1; }
    }
    Object.assign(row, { tp, fp, fn, tpChip, fpChip });
  }
  return row;
}

function itemRows(rec, keyItems, field, kind) {
  const ai = rec.aiMarks ? (field === 'numbers' ? (rec.aiMarks.maths || {}).numbers : rec.aiMarks[field]) : null;
  if (!keyItems || !keyItems.length || !ai) return [];
  const byId = new Map(ai.map((x) => [x.id, x]));
  return keyItems.filter((k) => k.verdict != null).map((k) => {
    const a = byId.get(k.id);
    return { id: rec.id, block: rec.block, field, kind, item: k.id, key: k.verdict === 'none' ? 'wrong' : k.verdict, ai: a ? (a.verdict === 'none' ? 'wrong' : a.verdict) : 'missing', conf: a ? a.confidence : null };
  });
}

function stats(pairs) {
  // pairs: [{ai, key}] numeric
  const d = pairs.filter((p) => Number.isFinite(p.ai) && Number.isFinite(p.key));
  if (!d.length) return { n: 0 };
  const diff = d.map((p) => p.ai - p.key);
  const mean = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
  const ma = mean(d.map((p) => p.ai)); const mk = mean(d.map((p) => p.key));
  const cov = mean(d.map((p) => (p.ai - ma) * (p.key - mk)));
  const sa = Math.sqrt(mean(d.map((p) => (p.ai - ma) ** 2))); const sk = Math.sqrt(mean(d.map((p) => (p.key - mk) ** 2)));
  return {
    n: d.length, r: sa && sk ? Math.round((cov / (sa * sk)) * 100) / 100 : null,
    mae: Math.round(mean(diff.map(Math.abs)) * 10) / 10, bias: Math.round(mean(diff) * 10) / 10,
    exact: Math.round(100 * d.filter((p) => p.ai === p.key).length / d.length),
    within1: Math.round(100 * diff.filter((x) => Math.abs(x) <= 1).length / d.length),
    within3: Math.round(100 * diff.filter((x) => Math.abs(x) <= 3).length / d.length),
    within5: Math.round(100 * diff.filter((x) => Math.abs(x) <= 5).length / d.length),
  };
}

function agreement(rows) {
  const d = rows.filter((r) => r.ai !== 'missing');
  if (!d.length) return { n: 0, missing: rows.length };
  return { n: d.length, missing: rows.length - d.length, agree: Math.round(100 * d.filter((r) => r.ai === r.key).length / d.length) };
}

async function main() {
  const results = { started: new Date().toISOString(), real: [], synthetic: [], strips: [] };

  for (const kind of ['real', 'synthetic']) {
    if (!ONLY.includes(kind)) continue;
    const root = path.join(FIX, kind);
    if (!fs.existsSync(root)) continue;
    const kids = fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, 'key.json'))).slice(0, LIMIT);
    const jobs = [];
    for (const id of kids) {
      const key = JSON.parse(fs.readFileSync(path.join(root, id, 'key.json'), 'utf8'));
      if (key.usable_for_accuracy === false) continue;
      for (const block of ['urdu', 'english', 'maths']) {
        if (!fs.existsSync(path.join(root, id, `${block}.ogg`))) continue;
        const spec = kind === 'real' ? realSpec(key, block) : synthSpec(key, block);
        jobs.push({ id, dir: path.join(root, id), block, grade: key.grade, form: key.form || 'A', spec, key, cue: kind === 'synthetic' ? synthCue() : BANK.cue });
      }
    }
    console.log(`${kind}: ${jobs.length} block notes`);
    const recs = await pool(jobs, CONC, async (j) => {
      const rec = await runBlock(j);
      process.stdout.write(`  ${j.id.slice(0, 11)} ${j.block.padEnd(7)} ${rec.res && rec.res.aiStatus} ${rec.wall_s.toFixed(0)}s $${((rec.aiMarks && rec.aiMarks.meta.cost_usd) || 0).toFixed(4)}\n`);
      return { ...rec, key: j.key };
    });
    results[kind] = recs;
  }

  if (ONLY.includes('strips')) {
    const sdir = path.join(FIX, 'strips');
    const files = fs.existsSync(sdir) ? fs.readdirSync(sdir).filter((f) => f.endsWith('.key.json')).slice(0, LIMIT) : [];
    console.log(`strips: ${files.length}`);
    results.strips = await pool(files, CONC, async (kf) => {
      const key = JSON.parse(fs.readFileSync(path.join(sdir, kf), 'utf8'));
      const cacheFile = path.join(OUT, 'cache', `${key.strip_id}__strip.json`);
      if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      const img = path.join(sdir, `${key.strip_id}.jpg`);
      // L8's provisional strips (rendered before L2's strip landed) print the code as m<grade><form>
      const spec = { strip_code: /L2 strip not yet landed/.test(key.source || '') ? `m${key.grade}${key.form}` : undefined, written: key.written.map((w) => ({ id: w.id, prompt: w.prompt, answer: w.answer })), word_problem: key.word_problem ? { id: key.word_problem.id, prompt_en: (BANK.grades[String(key.grade)].forms[key.form].maths.word_problem || {}).prompt_en, answer: key.word_problem.answer } : null };
      const calls = []; const t0 = Date.now();
      const r = await scoreStrip({ spec, grade: key.grade, form: key.form, image: fs.readFileSync(img), calls });
      const rec = { id: key.strip_id, difficulty: key.difficulty, r, calls, wall_s: (Date.now() - t0) / 1000, key };
      fs.writeFileSync(cacheFile, JSON.stringify(rec));
      process.stdout.write(`  ${key.strip_id} d${key.difficulty} ${r.ok ? 'ok' : r.error} ${rec.wall_s.toFixed(0)}s\n`);
      return rec;
    });
  }

  // ---- summarise --------------------------------------------------------------------
  const summary = { story: {}, items: {}, quick_sums: {}, strips: {}, fallback: {}, cost: {}, latency: {}, status: {} };
  const storyRows = []; const items = []; const qsPairs = []; const fbPairs = [];
  for (const kind of ['real', 'synthetic']) {
    for (const rec of results[kind] || []) {
      if (!rec || rec.error) continue;
      const kb = rec.key.blocks[rec.block] || {};
      summary.status[rec.res.aiStatus] = (summary.status[rec.res.aiStatus] || 0) + 1;
      if (rec.block !== 'maths') {
        const s = storyRow(rec, kb.story, kind); if (s) storyRows.push(s);
        items.push(...itemRows(rec, kb.questions, 'questions', kind), ...itemRows(rec, kb.nonwords, 'nonwords', kind), ...itemRows(rec, kb.first_sounds, 'first_sounds', kind));
        if (kb.fallback && rec.aiMarks && rec.aiMarks.fallback) {
          fbPairs.push({ ai: rec.aiMarks.fallback.letters.correct, key: kb.fallback.letters.correct, f: 'letters' }, { ai: rec.aiMarks.fallback.words.correct, key: kb.fallback.words.correct, f: 'words' });
        }
      } else {
        const km = kb.maths || {};
        if (km.quick_sums && rec.aiMarks && rec.aiMarks.maths && rec.aiMarks.maths.quick_sums) qsPairs.push({ ai: rec.aiMarks.maths.quick_sums.correct, key: km.quick_sums.correct, aiAtt: rec.aiMarks.maths.quick_sums.attempted, keyAtt: km.quick_sums.attempted, kind });
        items.push(...itemRows(rec, km.numbers && km.numbers.filter((n) => !String(n.id).startsWith('may-')), 'numbers', kind));
      }
    }
  }
  for (const lang of ['urdu', 'english']) {
    for (const kind of ['real', 'synthetic']) {
      const rows = storyRows.filter((r) => r.block === lang && r.kind === kind);
      if (!rows.length) continue;
      const exact = rows.filter((r) => r.key_quality === 'exact');
      const tp = rows.reduce((a, r) => a + (r.tp || 0), 0); const fp = rows.reduce((a, r) => a + (r.fp || 0), 0); const fn = rows.reduce((a, r) => a + (r.fn || 0), 0);
      const tpc = rows.reduce((a, r) => a + (r.tpChip || 0), 0); const fpc = rows.reduce((a, r) => a + (r.fpChip || 0), 0);
      summary.story[`${lang}.${kind}`] = {
        all: stats(rows.map((r) => ({ ai: r.ai_correct, key: r.key_correct }))),
        exact_keys: stats(exact.map((r) => ({ ai: r.ai_correct, key: r.key_correct }))),
        attempted: stats(rows.map((r) => ({ ai: r.ai_attempted, key: r.key_attempted }))),
        confident: stats(rows.filter((r) => r.ai_conf >= 0.7).map((r) => ({ ai: r.ai_correct, key: r.key_correct }))),
        per_word: { precision: tp + fp ? Math.round(100 * tp / (tp + fp)) / 100 : null, recall: tp + fn ? Math.round(100 * tp / (tp + fn)) / 100 : null, chip_precision_at_bar: tpc + fpc ? Math.round(100 * tpc / (tpc + fpc)) / 100 : null, chips_at_bar: tpc + fpc },
        flags: rows.reduce((a, r) => { (r.flags || []).forEach((f) => { a[f] = (a[f] || 0) + 1; }); return a; }, {}),
        no_story: rows.filter((r) => r.ai_correct == null).length,
      };
    }
  }
  for (const field of ['questions', 'nonwords', 'first_sounds', 'numbers']) {
    for (const kind of ['real', 'synthetic']) {
      const rows = items.filter((r) => r.field === field && r.kind === kind);
      if (rows.length) summary.items[`${field}.${kind}`] = { ...agreement(rows), confident: agreement(rows.filter((r) => (r.conf || 0) >= 0.7)) };
    }
  }
  for (const kind of ['real', 'synthetic']) {
    const q = qsPairs.filter((p) => p.kind === kind);
    if (q.length) summary.quick_sums[kind] = { correct: stats(q.map((p) => ({ ai: p.ai, key: p.key }))), attempted: stats(q.map((p) => ({ ai: p.aiAtt, key: p.keyAtt }))) };
  }
  summary.fallback = { letters: stats(fbPairs.filter((p) => p.f === 'letters')), words: stats(fbPairs.filter((p) => p.f === 'words')) };

  const strip = (results.strips || []).filter((s) => s && s.r && s.r.ok);
  const sRows = [];
  for (const s of strip) {
    const exp = s.key.ai_marks_expected;
    for (const w of exp.written) {
      const a = s.r.part.written.find((x) => x.id === w.id) || {};
      sRows.push({ d: s.difficulty, key: w.verdict, ai: a.verdict, keyRead: w.read_answer, aiRead: a.read_answer, conf: a.confidence, legible: s.key.legible_expected });
    }
    if (exp.word_problem && s.r.part.word_problem) sRows.push({ d: s.difficulty, key: exp.word_problem.verdict, ai: s.r.part.word_problem.photo_verdict, keyRead: exp.word_problem.read_answer, aiRead: s.r.part.word_problem.read_answer, conf: s.r.part.word_problem.confidence, wp: true });
  }
  const byD = {};
  for (const r of sRows) { (byD[r.d] = byD[r.d] || []).push(r); }
  const sAgree = (rs) => ({ n: rs.length, verdict_agree: rs.length ? Math.round(100 * rs.filter((r) => r.ai === r.key).length / rs.length) : null, read_exact: rs.length ? Math.round(100 * rs.filter((r) => String(r.aiRead || '') === String(r.keyRead || '')).length / rs.length) : null,
    confident_n: rs.filter((r) => r.conf >= 0.75).length, confident_agree: rs.filter((r) => r.conf >= 0.75).length ? Math.round(100 * rs.filter((r) => r.conf >= 0.75 && r.ai === r.key).length / rs.filter((r) => r.conf >= 0.75).length) : null });
  summary.strips = { all: sAgree(sRows), by_difficulty: Object.fromEntries(Object.entries(byD).map(([d, rs]) => [d, sAgree(rs)])), form_code_ok: strip.filter((s) => s.r.formCodeOk === true).length, form_code_read: strip.filter((s) => s.r.formCode).length, failed: (results.strips || []).filter((s) => !s || !s.r || !s.r.ok).length,
    cost_per_strip: strip.length ? Math.round(10000 * strip.reduce((a, s) => a + s.calls.reduce((b, c) => b + (c.cost || 0), 0), 0) / strip.length) / 10000 : null,
    seconds_per_strip: strip.length ? Math.round(10 * strip.reduce((a, s) => a + s.wall_s, 0) / strip.length) / 10 : null };

  // cost + latency per block and per child
  for (const kind of ['real', 'synthetic']) {
    const recs = (results[kind] || []).filter((r) => r && r.aiMarks);
    if (!recs.length) continue;
    const byBlock = {};
    for (const r of recs) (byBlock[r.block] = byBlock[r.block] || []).push(r);
    summary.cost[kind] = {}; summary.latency[kind] = {};
    for (const [b, rs] of Object.entries(byBlock)) {
      const costs = rs.map((r) => r.aiMarks.meta.cost_usd); const secs = rs.map((r) => r.wall_s).sort((a, c) => a - c);
      const byJob = {};
      rs.forEach((r) => r.aiMarks.meta.calls.forEach((c) => { byJob[c.job] = (byJob[c.job] || 0) + (c.cost || 0); }));
      summary.cost[kind][b] = { mean_usd: Math.round(10000 * costs.reduce((a, x) => a + x, 0) / costs.length) / 10000, by_job_mean_usd: Object.fromEntries(Object.entries(byJob).map(([j, v]) => [j, Math.round(10000 * v / rs.length) / 10000])) };
      summary.latency[kind][b] = { median_s: secs[Math.floor(secs.length / 2)], p90_s: secs[Math.floor(secs.length * 0.9)], max_s: secs[secs.length - 1] };
    }
  }

  fs.writeFileSync(path.join(OUT, 'eval_results.json'), JSON.stringify({ summary, storyRows, items, qsPairs, strips: sRows }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
