// bd-snkn32.40 — how often does a grades 1–5 "Make my own" get refused, before and after the soft rules moved into
// code (lp-own-fit)? Runs the REAL make (loadK5 → book text → rewriteK5 on the live model) on real sandbox days, the
// worker's own steps, outside the queue. Sandbox only. Usage, from the repo root, with the sandbox bot's env:
//   railway run -p 0aef0655-1f90-4aab-9cca-e4daec46f2b4 -e sandbox -s bot node docs/lp612/make-my-own-g1-5/fit-measure/measure.js before
//   … measure.js after      (replays each day's round-1 reply from results-before.json; pays only for new rounds)
// "after" is a paired measurement: the prompt did not change, so round 1 is the same sample; only the gate and the
// repair round differ. Writes results-<mode>.json beside this file
// (REPLAY=0 → results-after-live.json). Spend stops at CAP dollars.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../../../..');
const { loadK5 } = require(path.join(root, 'bot/shared/services/lp-k5-own-source'));
const { rewriteK5 } = require(path.join(root, 'bot/shared/services/lp-k5-own-author'));
const { bookTextFor } = require(path.join(root, 'bot/shared/services/lp-own-book'));
const catalog = require(path.join(root, 'bot/data/lp_catalog.json'));

const MODE = process.argv[2];
const WANT = Number(process.env.DAYS || 36);
const CAP = Number(process.env.CAP || (MODE === 'before' ? 22 : 8));
const CONC = 4;
// REPLAY=0: "after" pays for its own round 1 too (an independent sample, same days and classes).
const REPLAY = process.env.REPLAY !== '0';
// OUT=<name> writes results-<name>.json (bd-snkn32.44 re-measure: OUT=after-44, the same replay against the new gate).
const OUT = process.env.OUT || (MODE === 'after' && !REPLAY ? 'after-live' : MODE);
if (!['before', 'after'].includes(MODE)) throw new Error('mode: before | after');

// A fixed, seeded draw: 3 candidate days per grade × subject (English, Urdu, Maths), the same draw every run.
let seed = 4040;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
function candidates() {
  const out = [];
  for (let g = 1; g <= 5; g++) {
    for (const subj of ['english', 'urdu', 'math']) {
      const book = catalog.books.find((b) => !b.opt_in && Number(b.grade) === g && b.subject_key === subj);
      const days = book.chapters.flatMap((c) => c.lessons).filter((l) => !['assessment', 'revision'].includes(l.lp_type));
      for (let i = 0; i < 4; i++) out.push(days[Math.floor(rnd() * days.length)].lesson_id);
    }
  }
  return [...new Set(out)];
}

const SIZES = ['up30', '31_50', '51_70', 'over70'];
const RES = [['textbook'], ['textbook', 'board'], ['textbook', 'board', 'objects'], ['textbook', 'charts']];
const LEVELS = ['behind', 'on_track', 'ahead', 'mixed'];
const answersFor = (i, subject) => {
  const ways = subject === 'math' ? ['cpa', 'games', 'tarl'] : ['phonics', 'story', 'tarl', 'games'];
  return { size: SIZES[i % 4], resources: RES[Math.floor(i / 4) % 4], level: LEVELS[(i + Math.floor(i / 4)) % 4], way: ways[i % ways.length], note: '' };
};

let spent = 0;
const before = MODE === 'after' ? JSON.parse(fs.readFileSync(path.join(__dirname, 'results-before.json'), 'utf8')) : null;
// APPEND=1 (before only): keep the days already in results-before.json and run the rest of the draw.
const had = MODE === 'before' && process.env.APPEND === '1' ? JSON.parse(fs.readFileSync(path.join(__dirname, 'results-before.json'), 'utf8')).days : [];

/** The live client, recording each call's reply and cost; in "after", round 1 is the recorded reply. */
function recorder(rec, replayFirst) {
  const live = require(path.join(root, 'bot/shared/services/llm-client')).getClient();
  return { chat: { completions: { create: async (req) => {
    const n = rec.calls.length;
    if (replayFirst && n === 0) {
      rec.calls.push({ replayed: true, cost: replayFirst.cost });
      return { choices: [{ message: { content: replayFirst.content } }] };
    }
    if (spent >= CAP) throw new Error('budget cap reached');
    const res = await live.chat.completions.create(req);
    const cost = Number((res.usage && res.usage.cost) || 0);
    spent += cost;
    rec.calls.push({ content: (res.choices && res.choices[0] && res.choices[0].message.content) || '', cost, tokens: res.usage && { in: res.usage.prompt_tokens, out: res.usage.completion_tokens }, model: res.model });
    return res;
  } } } };
}

async function one(lessonId, i) {
  const day = await loadK5(lessonId);
  if (!day) return null;
  const prior = before && before.days.find((d) => d.lessonId === lessonId);
  if (before && (!prior || !prior.calls[0] || !prior.calls[0].content)) return null;
  const answers = prior ? prior.answers : answersFor(i, day.subject); // the same class as the "before" run
  const pg = day.pages || {};
  const bookText = await bookTextFor({ grade: day.grade, subject: day.subject, from: pg.start, to: pg.end }).catch(() => null);
  const rec = { lessonId, grade: day.grade, subject: day.subject, lang: day.lang, period: (day.script.meta || {}).minutes || null, answers, calls: [], refusals: [], fit: [] };
  const log = (m, x) => {
    if (/refused/.test(m)) rec.refusals.push(x);
    else if (/soft|fix|warn/i.test(m)) rec.fit.push(x);
  };
  const t0 = Date.now();
  try {
    const out = await rewriteK5({ script: day.script, answers, lang: day.lang, grade: day.grade, subject: day.subject, dayPages: day.pages || null, bookText, client: recorder(rec, REPLAY && prior && prior.calls[0]), log });
    Object.assign(rec, { ok: !!out, rounds: out ? out.rounds : null, fixes: (out && out.fixes) || [], warnings: (out && out.warnings) || [] });
  } catch (e) {
    Object.assign(rec, { ok: false, error: e.message });
  }
  rec.ms = Date.now() - t0;
  console.log(JSON.stringify({ lessonId, size: answers.size, ok: rec.ok, rounds: rec.rounds, calls: rec.calls.length, spent: spent.toFixed(2), error: rec.error }));
  return rec;
}

function summary(days) {
  const run = days.filter((d) => !d.error || d.ok);
  const n = run.length;
  const r1 = run.filter((d) => d.refusals.some((x) => x.round === 1)).length;
  const failed = run.filter((d) => !d.ok).length;
  const reasons = {};
  run.forEach((d) => d.refusals.forEach((x) => (x.reasons || []).forEach((r) => {
    const k = r.replace(/\(".*?"\)/g, '').replace(/\d+/g, 'N').slice(0, 70);
    reasons[`r${x.round}: ${k}`] = (reasons[`r${x.round}: ${k}`] || 0) + 1;
  })));
  const fixed = run.filter((d) => (d.fixes || []).length).length;
  const warned = run.filter((d) => (d.warnings || []).length).length;
  const fixKinds = {};
  run.forEach((d) => [...(d.fixes || []), ...(d.warnings || [])].forEach((f) => {
    const k = f.replace(/\d+/g, 'N').replace(/\(".*?"\)/g, '').slice(0, 50); fixKinds[k] = (fixKinds[k] || 0) + 1;
  }));
  const paid = run.reduce((a, d) => a + d.calls.length, 0);
  const cost = run.reduce((a, d) => a + d.calls.reduce((b, c) => b + (c.cost || 0), 0), 0);
  return {
    days: n, refusedAfterRound1: r1, refusedAfterRound2: failed, refusalRateRound1: +(r1 / n).toFixed(3), failRate: +(failed / n).toFixed(3),
    modelCalls: paid, costUSD: +cost.toFixed(2), costPerDay: +(cost / n).toFixed(3), daysWithSoftFixes: fixed, daysWithWarnings: warned,
    fixKinds, reasons, errors: days.filter((d) => d.error && !d.ok).map((d) => `${d.lessonId}: ${d.error}`),
  };
}

(async () => {
  const all = before ? before.days.map((d) => d.lessonId) : candidates();
  const ids = all.filter((id) => !had.some((d) => d.lessonId === id));
  const days = [];
  let next = 0;
  async function worker() {
    while (next < ids.length && days.length + had.length < WANT && spent < CAP) {
      const i = next++;
      const r = await one(ids[i], all.indexOf(ids[i])).catch((e) => ({ lessonId: ids[i], ok: false, error: e.message, calls: [], refusals: [] }));
      if (r) days.push(r);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  days.unshift(...had);
  const s = summary(days);
  fs.writeFileSync(path.join(__dirname, `results-${OUT}.json`), JSON.stringify({ mode: OUT, at: new Date().toISOString(), summary: s, days }, null, 1));
  console.log(JSON.stringify(s, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
