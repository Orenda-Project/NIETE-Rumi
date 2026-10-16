#!/usr/bin/env node
'use strict';
/**
 * count: web_quiz_next_offer — what the ranked Next tile can offer the smallest-served children, read-only.
 *
 *   node scripts/web-quiz/counts/web_quiz_next_offer.js olvritwoqujtjvwfulbh [--child <uuid> ...]
 *
 * Builds the slot's candidates through the bot's own modules (the hub's per-child reads, Jugnu's corner, the "on its
 * way" check), with the switch forced ON in-process (nothing in app_settings is changed), and ranks them for the home
 * in every arm. Nothing is written: the per-child state and the next_set line are never touched (rank() is pure).
 *
 * The children: two brand-new children nobody has seen (a random id with no rows: no class, no quiz, nothing played) —
 * an English grade-2 child and an Urdu grade-1 child, the two smallest-served homes — plus any --child ids given.
 * Per child, per kind: all (built) / eligible(OFF) (today's single lantern pick) / eligible(ON) (what the slot may
 * offer), then the chosen Next in each arm. Never a name, a phone or a raw id on stdout (a child is "new-en-g2" or
 * "child-<n>").
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; refuses unless the ref on argv is the sandbox's and SUPABASE_URL
 * carries it ("REFUSED: not sandbox"). Exit 0; 1 = a child has NO eligible candidate (the home would be empty);
 * 2 = refused or usage.
 */
const crypto = require('crypto');
const path = require('path');

const SANDBOX_REF = 'olvritwoqujtjvwfulbh';
const KINDS = ['story', 'game', 'quiz', 'video', 'storybook', 'invite', 'sticker'];

/** The eligibility rule of the slot (web-quiz-next-offer.js rank), as counts. Pure. */
function eligibleOf(list, { ctx = 'home', hasRoot = false } = {}) {
  const weak = ctx === 'after_read_weak' || ctx === 'after_read_tried';
  return list.filter((c) => c && KINDS.includes(c.kind) && c.id && typeof c.href === 'string' && c.href && c.title
    && !c.on_its_way && !(c.kind === 'video' && c.needs_root && !hasRoot) && !(weak && c.read_aloud));
}

/** One child's table: per kind all / eligible(OFF) / eligible(ON), and the chosen Next per arm. Pure but for rank(). */
function tableFor(label, list, { hasRoot = false, rank, weights, seed = label, now = new Date().toISOString() } = {}) {
  const on = eligibleOf(list, { hasRoot });
  const lantern = list.filter((c) => c.lantern);
  const rows = KINDS.map((k) => ({
    kind: k, all: list.filter((c) => c.kind === k).length, off: lantern.filter((c) => c.kind === k).length, on: on.filter((c) => c.kind === k).length,
  }));
  const chosen = {};
  for (const arm of ['rank', 'rand', 'ctrl']) {
    const r = rank('home', list, { arm, seed, now, monthOpens: 5, resumeToday: false, streak: null, has_root: hasRoot }, weights);
    chosen[arm] = r ? { kind: r.next.kind, id: r.next.id, rank_src: r.next.rank_src, title: r.next.title } : null;
  }
  return { child: label, rows, eligible_on: on.length, chosen };
}

function print(io, t) {
  io.stdout.write(`\n${t.child}  (eligible ON: ${t.eligible_on})\n`);
  io.stdout.write('  kind       all  eligible(OFF)  eligible(ON)\n');
  t.rows.forEach((r) => io.stdout.write(`  ${r.kind.padEnd(10)} ${String(r.all).padStart(3)}  ${String(r.off).padStart(13)}  ${String(r.on).padStart(12)}\n`));
  Object.entries(t.chosen).forEach(([arm, c]) => io.stdout.write(`  Next (${arm}): ${c ? `${c.kind} ${c.id} [${c.rank_src}] "${c.title}"` : 'NONE'}\n`));
}

/** The candidates the hub would build for this child (the hub's own reads; the switch forced on in-process). */
async function candidatesFor(childId, { lang, grade, synthetic }) {
  const Q = path.join(__dirname, '..', '..', '..', 'bot', 'shared', 'services', 'quiz');
  const Hub = require(path.join(Q, 'web-quiz-hub'));
  const Play = require(path.join(Q, 'web-quiz-hub-play'));
  const S = require(path.join(Q, 'web-quiz-next-offer-sources'));
  const T = require(path.join(Q, 'web-quiz-token'));
  const P = Hub._parts;
  const known = synthetic ? { row: { id: childId, student_name: '', self_reported_class: String(grade), list_id: null, is_active: true }, list: null } : null;
  const ctx = await P.kidContext(childId, known);
  if (!ctx) return null;
  const { history } = ctx;
  const g = ctx.grade || (grade ? String(grade) : null);
  const l = lang || require(path.join(Q, 'student-quiz.service')).childLanguage(history) || 'en';
  const token = T.signHub([childId]);
  const flags = await Hub.flags();
  const out = { kid: P.kidChip(childId), lang: l, teacher: null, again: [], lib: null, challenge: null };
  if (flags.homeButton) out.nav_home = true;
  out.teacher = await P.teacherCard({ id: childId }, ctx.list, history, g);
  out.again = P.againOf(history, childId, out.teacher && out.teacher.code);
  out.last = P.lastOf(history, childId);
  if (out.last && out.teacher && out.teacher.code === out.last.code) out.teacher = null;
  if (out.last) out.again = out.again.filter((a) => a.code !== out.last.code);
  if (flags.library) out.lib = { href: `/lib/${token}?kid=${out.kid}&l=${l}` };
  try { out.recs = await P.recsFor(childId, history, g); } catch (_) { out.recs = []; }
  const Challenge = require(path.join(Q, 'web-quiz-challenge'));
  const form = flags.challenge ? (synthetic ? await Challenge.formForChild(Number(g) || null) : await P.challengeForm(childId)) : null;
  if (form) out.challenge = { on: true };
  const collect = {};
  await Play.playFor({ chosenId: childId, last: out.last, lang: l, now: new Date().toISOString(), challenge: out.challenge, grade: g, stopsOf: () => P.trailStops(form), collect });
  const prep = await S.hubPrep({ out, token, history, lang: l, chosenId: childId, grade: g, stopsOf: () => collect.trail || [] });
  const p = prep || { rows: await S.quizIdsOf([], {}), books: [], onItsWay: await S.onItsWayOf(childId, childId, collect.trail, l, g), sw: { watch: false } };
  const list = S.candidatesOf({ out, token, history, collect: { ...collect, onItsWay: p.onItsWay }, lang: l, ...p.rows, subjectArt: P.subjectArtOf, extra: p.books, watch: Boolean(p.sw && p.sw.watch) });
  return { list, hasRoot: S.hasRootOf(history) };
}

async function main({ argv = process.argv.slice(2), env = process.env, io = process } = {}) {
  const say = (s) => io.stderr.write(`${s}\n`);
  if (argv[0] !== SANDBOX_REF || !String(env.SUPABASE_URL || '').includes(SANDBOX_REF) || !env.SUPABASE_SERVICE_ROLE_KEY) {
    say('REFUSED: not sandbox (usage: web_quiz_next_offer.js olvritwoqujtjvwfulbh [--child <uuid> ...], with the sandbox SUPABASE_URL and key)');
    return 2;
  }
  if (!env.WEB_QUIZ_TOKEN_SECRET) env.WEB_QUIZ_TOKEN_SECRET = crypto.randomBytes(24).toString('hex');   // links only; never printed
  const NO = require(path.join(__dirname, '..', '..', '..', 'bot', 'shared', 'services', 'quiz', 'web-quiz-next-offer'));
  // the switch forced ON in this process only: the module's own settings read answers "on" with the stored weights
  const real = NO.switches;
  NO.switches = async (...a) => ({ ...(await real(...a)), on: true });
  const children = [
    { label: 'new-en-g2 (no class, nothing played)', id: crypto.randomUUID(), lang: 'en', grade: 2, synthetic: true },
    { label: 'new-ur-g1 (no class, nothing played)', id: crypto.randomUUID(), lang: 'ur', grade: 1, synthetic: true },
  ];
  argv.forEach((a, i) => { if (a === '--child' && argv[i + 1]) children.push({ label: `child-${children.length - 1}`, id: argv[i + 1], synthetic: false }); });
  const sw = await NO.switches();
  let empty = 0;
  for (const c of children) {
    let got = null;
    try { got = await candidatesFor(c.id, c); } catch (e) { say(`${c.label}: could not build (${String(e && e.message).slice(0, 120)})`); }
    if (!got) { io.stdout.write(`\n${c.label}: no child context\n`); empty += 1; continue; }
    const t = tableFor(c.label, got.list, { hasRoot: got.hasRoot, rank: NO.rank, weights: sw.weights });
    print(io, t);
    if (!t.eligible_on) empty += 1;
  }
  io.stdout.write(`\nscores table: ${sw.weights && sw.weights.v}\n`);
  return empty ? 1 : 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code), (e) => { process.stderr.write(`${e && e.stack ? e.stack : e}\n`); process.exit(2); });
}

module.exports = { main, eligibleOf, tableFor, SANDBOX_REF };
