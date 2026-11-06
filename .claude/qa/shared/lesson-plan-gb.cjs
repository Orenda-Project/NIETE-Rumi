'use strict';
/* lesson-plan-gb.cjs — lesson-plan L13/L14/L15: the Gilgit-Baltistan lane (bd-rj6w0n.14.9).
 *
 * LP_GB_K5_ENABLED is a process switch and the GB lane keys on users.region, so these run on the local lane
 * only (E2E_ENV=local), where the bot, the worker and the database are the run's own:
 *   baseline  the ICT driver's grade list with the switch off (today)
 *   switch on (restart bot + worker) → L14: an ICT teacher's grades and Grade 6 PDF are unchanged
 *   seed (lp_gb_seed.py: region → Gilgit-Baltistan, one ready Grade 3 English nbf_snc card) → L13
 *   switch off (restart) → L15: the same GB teacher gets today's menu and Grade 6 PDF
 *   ALWAYS: region and seeded rows restored, switch back off — whatever threw.
 * A switch or seed that cannot be set is BLOCKED (we learned nothing about the product), never FAIL.
 * Tested by test_lesson_plan_gb.js.
 */
const path = require('path');

const NAMES = {
  L13: 'A Gilgit-Baltistan teacher gets her own grades 1-5 books, and a ready one delivers her plan\'s link',
  L14: 'With the Gilgit-Baltistan switch on, an ICT teacher\'s lesson plans are exactly as before',
  L15: 'With the Gilgit-Baltistan switch off, a Gilgit-Baltistan teacher gets today\'s lesson plans',
};
const SOON = 'gb_soon_';
const CHROME = /^(Back|Close|Powered by|Tap to open|Lesson Plans|📘)/i;
const GB_GRADES = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5'];

/** The grade picker's 'Grade N' rows, in number order. */
function gradesOf(probe) {
  const g = ((probe && probe.items) || []).map((i) => String(i.text || '').split('\n')[0].trim())
    .filter((t) => /^Grade \d+$/.test(t));
  return [...new Set(g)].sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
}

/** A subject screen: titles of the books that open, and the keys of the Coming Soon rows. */
function shelfOf(probe) {
  const nav = ((probe && probe.items) || []).filter((i) => i.kind === 'nav' && !CHROME.test(String(i.text || '')));
  return { open: nav.filter((i) => !String(i.id || '').startsWith(SOON)).map((i) => i.text),
           soon: nav.filter((i) => String(i.id || '').startsWith(SOON)).map((i) => String(i.id).slice(SOON.length)) };
}

/** Her plan as a link: the seeded title, a Grade 3 line in either language, the seeded hosted card's URL; no PDF. */
function isCardLink(msg, seed) {
  const t = String((msg && msg.txt) || '');
  if (!msg || msg.pdf || msg.doc) return false;
  return t.includes(seed.title) && /(Grade|جماعت) 3/.test(t) && new RegExp('https?://\\S+/' + seed.r2_key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(t);
}

const isSoonRefusal = (m) => /coming soon|جلد آ رہے/i.test(String(m || ''));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The real lane: scenario bodies driven through the mock API. */
function liveDeps({ api, waitFresh, openLP }) {
  const SC = require(path.join(__dirname, '..', 'engine', 'bin', 'stack-control.cjs'));
  const lastJson = (s) => { const l = String(s || '').trim().split('\n').reverse().find((x) => x.trim().startsWith('{')); return l ? JSON.parse(l) : {}; };
  const open = async () => { await api.resetFlow(); await api.freshReset(); await api.sendWait('/lp'); const op = await openLP(); return { op, first: op.ok ? await api.flowProbe() : { items: [] } }; };
  const errOf = (r) => (r && r.ok && r.res && r.res.data && r.res.data.error && r.res.data.error.message) || '';

  // Walk the Flow: fixed picks, then the first pickable row on each later screen, until it closes.
  const walk = async (picks) => {
    const trail = []; const ids = [];
    for (const fixed of picks) {
      const pr = await api.flowProbe();
      if (!pr.screen && !pr.text) break;
      (pr.items || []).forEach((i) => ids.push(String(i.id || '')));
      const pickable = (pr.items || []).filter((i) => i.text && !i.disabled && !CHROME.test(i.text.trim()));
      const label = fixed || (pickable[0] && pickable[0].text.split('\n')[0].trim());
      const c = label ? await api.flowClick(label, { settleMs: 3000 }) : { ok: false, err: 'NOTHING_TO_PICK' };
      trail.push({ screen: pr.screen, offered: pickable.slice(0, 6).map((i) => i.text.split('\n')[0]), picked: label, ok: !!c.ok });
      if (!c.ok) break;
    }
    api.closeFlow();
    return { trail, soonSeen: ids.some((id) => id.startsWith(SOON)) };
  };
  const fname = (x) => (x && x.media && x.media.filename) || '';
  const g6Pdf = async () => {
    const w = await walk(['Grade 6', 'Computer Science', null, null, null]);
    const r = await waitFresh((x) => (x.pdf || x.doc) && /grade[_\s-]*6.*\.pdf/i.test(fname(x)), 150000, 2000);
    return { ok: r.ok, file: r.ok ? fname(r.hit).slice(0, 130) : null, waitedMs: r.waitedMs, ...w };
  };
  const ictLike = async (base) => {
    const { op, first } = await open();
    if (!op.ok) return ['BLOCKED', { harness: op.err }];
    const grades = gradesOf(first); const pdf = await g6Pdf();
    return [same(grades, base) && pdf.ok && !pdf.soonSeen ? 'PASS' : 'FAIL', { grades, baseline: base, pdf }];
  };

  return {
    lane: () => (process.env.E2E_ENV === 'local' ? 'local' : (process.env.E2E_ENV || 'unknown')),
    driverId: () => lastJson(api.db('driver-user').out).id,
    seed: (cmd, args) => lastJson(require('child_process').execFileSync('python3', [path.join(__dirname, 'lp_gb_seed.py'), cmd, ...args], { encoding: 'utf8', timeout: 60000 })),
    restart: (proc, env) => SC.restart(proc, env),
    scenarios: {
      baseline: async () => { const { op, first } = await open(); api.closeFlow(); return op.ok ? gradesOf(first) : null; },
      L14: ictLike,
      L15: ictLike,
      L13: async (seed) => {
        const { op, first } = await open();
        if (!op.ok) return ['BLOCKED', { harness: op.err }];
        const grades = gradesOf(first);
        const g3 = await api.flowClick('Grade 3', { settleMs: 3000 });
        const shelf = shelfOf(await api.flowProbe());
        const tap = { step: 'lp612_gb_soon', grade: '3', subject: shelf.soon[0] || 'urdu' };
        const refusal = errOf(await api.flowRaw(tap));
        const w = g3.ok && shelf.open.includes('English') ? await walk(['English', null, null, null]) : { trail: [] };
        const r = await waitFresh((x) => isCardLink(x, seed) || x.pdf || x.doc, 90000, 2000);
        const card = r.ok && isCardLink(r.hit, seed);
        const pdf = !!(r.seen || []).some((x) => x.pdf || x.doc);
        const ok = same(grades, GB_GRADES) && same(shelf.open, ['English']) && shelf.soon.length >= 1
          && isSoonRefusal(refusal) && card && !pdf;
        return [ok ? 'PASS' : 'FAIL', { grades, shelf, tap, refusal: refusal.slice(0, 120), card, pdf,
          message: r.ok ? String(r.hit.txt || '').slice(0, 200) : r.last, trail: w.trail }];
      },
    },
  };
}

async function runGb({ rec, want = () => true, deps, ...live }) {
  const ids = ['L14', 'L13', 'L15'].filter((i) => want(i));
  if (!ids.length) return;
  const d = deps || liveDeps(live);
  const t0 = Date.now(); const done = new Set();
  const put = (id, verdict, ev) => { if (!done.has(id) && ids.includes(id)) { done.add(id); rec(id, NAMES[id], verdict, ev, Date.now() - t0); } };
  const blockRest = (ev) => ['L14', 'L13', 'L15'].forEach((id) => put(id, 'BLOCKED', ev));
  const run = async (id, ...a) => { try { const [v, ev] = await d.scenarios[id](...a); put(id, v, ev); } catch (e) { put(id, 'BLOCKED', { harness: String(e && e.message || e).slice(0, 200) }); } };
  const flip = async (on) => { const v = on ? 'true' : 'false'; const b = await d.restart('bot', { LP_GB_K5_ENABLED: v }); const w = await d.restart('worker', { LP_GB_K5_ENABLED: v }); return { ok: !!(b && b.ok && w && w.ok), bot: b, worker: w }; };

  if (d.lane() !== 'local') return blockRest({ reason: 'LP_GB_K5_ENABLED and users.region can only be set on the local lane (E2E_ENV=local), where the bot and database are the run\'s own' });
  let uid = null; let seeded = null;
  try {
    const base = await d.scenarios.baseline();
    const on = await flip(true);
    if (!on.ok) return blockRest({ reason: 'could not restart the bot/worker with LP_GB_K5_ENABLED=true', restart: on });
    if (ids.includes('L14')) await run('L14', base);
    if (!ids.includes('L13') && !ids.includes('L15')) return;
    try { uid = d.driverId(); seeded = d.seed('seed', ['--user-id', String(uid)]); } catch (e) {
      return blockRest({ reason: 'could not seed the GB driver in the run database', err: String(e && e.message || e).slice(0, 200) });
    }
    if (ids.includes('L13')) await run('L13', seeded);
    if (ids.includes('L15')) {
      const off = await flip(false);
      if (!off.ok) return blockRest({ reason: 'could not restart with LP_GB_K5_ENABLED=false', restart: off });
      await run('L15', base);
    }
  } finally {
    if (uid) { try { d.seed('restore', ['--user-id', String(uid), '--region', (seeded && seeded.prev_region) || '']); } catch (_) { /* recorded by the next run's seed */ } }
    await flip(false);
  }
}

module.exports = { runGb, gradesOf, shelfOf, isCardLink, isSoonRefusal, NAMES };
