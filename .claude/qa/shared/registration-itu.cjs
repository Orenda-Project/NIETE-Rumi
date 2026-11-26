'use strict';
/* registration-itu.cjs — the mock-lane drivers for registration.feature R24–R29, "Is this you?" (bd-apnnh2.6.8).
 *
 * WHY A FRESH NUMBER PER SCENARIO. The question is only ever put to a FIRST-TIME registrant whose account her own
 * first message made (is-this-you.js madeByFirstMessage), and the bot caches the shared driver's registration at
 * stack start (registration.cjs line 1). So each scenario is its own new phone (api.as), never the driver: the bot
 * makes her row on her first message, exactly as for a real teacher. Run-scoped, so the local database only.
 *
 * WHAT IS SEEDED, on the run's own database only: the QA school (niete_registration_db.py seed-school), one "other
 * account" per scenario with her name at that school (a distinct name each, so no scenario sees two matches), and
 * the per-account switch registration_is_this_you_enabled = [her user ids] (api.setAppSetting, put back at the end).
 *
 * WHICH FORM. The lane's stored REGISTRATION_FLOW_ID is v5.1, the form published on the id the lane uses. v6 (with
 * IS_THIS_YOU) is stored beside it as flow id `e2e-registration-v6` (fixtures/flows/manifest.json); R24–R28 open the
 * bot's own card, same flow token, on that copy. R29 opens it on v5.1 — "a session opened on the previous form".
 *
 * DATA CHECKS (bd-5b3u70.8, the data E2E strategy). Around each Finish the scenario's own two accounts (her new one
 * and the "other account") are its cast; a snapshot of the watched tables (.claude/qa/config/data-keys.json) is taken
 * just before she answers, and after it the two rules run: no teacher's account outside the cast is added, changed or
 * removed, and no number has two accounts. A violation fails the scenario; a database that is not the run's own
 * reads NOT CHECKED in the evidence and never decides the verdict.
 *
 * SIGNED REQUESTS. A Yes is acted on only when Meta's signature on the Flow request verifies (webhook-signature.js).
 * The lane's bot carries a placeholder WHATSAPP_APP_SECRET (config/local-lane.env); signedFetch signs the emulator's
 * endpoint requests with it, the way Meta signs with the app secret.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ITU_KEY = 'registration_is_this_you_enabled';
const SEARCH_EMIS = '215';                 // the QA school (niete_registration_db.py QA_SCHOOL)
const SCHOOL_TITLE = 'IMSG G-7/3-2';
const V6_FLOW_ID = 'e2e-registration-v6';
const ANSWER = { yes: 'Yes, it’s mine', no: 'No, it’s someone else’s', not_sure: 'I’m not sure' };
const LINKED = 'This number is now linked to your existing account.';
const CHECKED = 'I’ve asked for that account to be checked. If it’s yours, it will be linked to this number.';
const GREET = /registering|all set|portal|شکریہ/i;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Phones derived from the driver, so two machines' slots never share one. Tester n, and her "other account"
 *  ending in 47 (the digits the question shows). Twelve digits, like the driver. */
function phonesFor(driver, n) {
  const d = String(driver).replace(/\D+/g, '');
  return { me: '92397' + d.slice(-6) + String(n), other: '92396' + d.slice(-4) + String(n) + '47' };
}

/** The value of one KEY=value line in an env file's text, or ''. */
function envValue(text, key) {
  const m = String(text || '').match(new RegExp('^' + key + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

/** A fetch that adds Meta's X-Hub-Signature-256 to a Flow endpoint request (/api/flows/…), over the exact body. */
function signedFetch(secret, base) {
  return (url, init = {}) => {
    if (secret && /\/api\/flows\//.test(String(url)) && typeof init.body === 'string') {
      const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(init.body).digest('hex');
      init = { ...init, headers: { ...(init.headers || {}), 'X-Hub-Signature-256': sig } };
    }
    return base(url, init);
  };
}

/** The bot's registration card with its flow id swapped: the same card and token, played on another stored form. */
function cardOn(card, flowId) {
  const c = JSON.parse(JSON.stringify(card));
  c.raw.interactive.action.parameters.flow_id = flowId;
  return c;
}

/** Does the screen leak anything about the other account beyond its last two digits? */
function leaks(text, other) {
  const t = String(text || '');
  return [other.phone.slice(-4), other.phone.slice(0, 5), other.id].filter((x) => x && t.includes(x));
}

function makeItu({ api, sleep }) {
  const { dbCreds } = require(path.join(__dirname, '..', 'engine', 'bin', 'db-target.cjs'));
  const { url, key, kind } = dbCreds();
  const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const get = async (p) => { const r = await fetch(`${url}/rest/v1/${p}`, { headers: H }); return r.ok ? r.json() : []; };
  const post = async (table, body) => {
    const r = await fetch(`${url}/rest/v1/${table}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${table} insert ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
    return j[0];
  };
  const USER = 'id,name,phone_number,registration_completed,deleted_at,deleted_by,school_id,first_message_at,is_test_user';
  const user = async (q) => (await get(`users?select=${USER}&${q}`))[0] || null;
  let secret = '';
  try { secret = envValue(fs.readFileSync(path.join(__dirname, '..', 'config', 'local-lane.env'), 'utf8'), 'WHATSAPP_APP_SECRET'); } catch (_) { /* unsigned */ }
  const switchedOn = [];
  const made = [];   // accounts these scenarios made or seeded: unlinked from the QA school at the end
  let school = null;

  /** Why these cannot run here, or null. Only the run's own database may be seeded and switched. */
  function blocked() {
    if (!(api.caps && api.caps.method === 'mock')) return 'mock lane only: each scenario is a new number the lane makes';
    if (!api.caps.flows) return 'no stored Flows on this lane (E2E_FLOWS_DIR)';
    if (kind !== 'local' || !url) return 'needs the run\'s own local database (E2E_LOCAL_DB=1): it seeds accounts and a switch';
    if (!secret) return 'no WHATSAPP_APP_SECRET in .claude/qa/config/local-lane.env, so a Yes can never be verified';
    return null;
  }

  async function setUp() {
    api.db('seed-school');
    [school] = await get(`schools?select=id,name&emis=eq.${SEARCH_EMIS}&source_system=eq.qa_seed`);
    if (!school) throw new Error('the QA school was not seeded');
  }

  /** A new teacher: her first message makes her account and brings the registration card. Switch on for her. */
  async function newTeacher(n, name, { otherLastMessageDaysAgo = null, otherTraining = false } = {}) {
    const ph = phonesFor(process.env.E2E_DRIVER || (api.tenant && api.tenant.driver) || '0', n);
    const u = api.as(ph.me);
    await u.freshReset();
    await u.sendWait('/register');
    const card = (await u.fresh()).reverse().find((i) => i.raw && i.raw.interactive && i.raw.interactive.type === 'flow');
    const me = await user(`phone_number=eq.${ph.me}`);
    if (!me) throw new Error('her first message made no account');
    switchedOn.push(me.id);
    const sw = await api.setAppSetting(ITU_KEY, [...switchedOn]);
    if (!sw.ok) throw new Error('switch not set: ' + (sw.err || sw.status));
    const other = await post('users', {
      phone_number: ph.other, name, role: 'teacher', school_id: school.id, is_test_user: Boolean(me.is_test_user),
      ...(otherLastMessageDaysAgo != null ? { last_message_at: new Date(Date.now() - otherLastMessageDaysAgo * DAY_MS).toISOString() } : {}),
    });
    if (otherTraining) {
      const [mod] = await get('training_modules?select=id&order=id.asc&limit=1');
      if (!mod) throw new Error('no training module in the seed');
      await post('teacher_training_progress', { user_id: other.id, module_id: mod.id });
    }
    made.push(me.id, other.id);
    return { u, me, phone: ph.me, card, other: { id: other.id, phone: ph.other }, name };
  }

  /** Open the card on the form named (v6 copy or the stored v5.1), type her name, search, pick the school. */
  async function toAfterSchool(t, { v6 = true } = {}) {
    if (!t.card) return { ok: false, err: 'no registration card after her first message' };
    const orig = globalThis.fetch;
    globalThis.fetch = signedFetch(secret, orig);   // the emulator's transport keeps the fetch it is built with
    let op;
    try { op = await t.u.openFlow('Get started|شروع کریں', { from: v6 ? cardOn(t.card, V6_FLOW_ID) : t.card }); } finally { globalThis.fetch = orig; }
    if (!op.ok) return { ok: false, err: 'Flow did not open: ' + op.err };
    await t.u.flowType(t.name);
    await t.u.flowClick('English', { exact: true, settleMs: 300 });
    await t.u.flowClick('Next / آگے', { exact: true, settleMs: 1500 });
    await t.u.flowClick('Teacher', { exact: true, settleMs: 300 });
    await t.u.flowType(SEARCH_EMIS);
    await t.u.flowClick('Search', { exact: true, settleMs: 2000 });
    await t.u.flowClick(SCHOOL_TITLE, { exact: false, settleMs: 300 });
    await t.u.flowClick('Next', { exact: true, settleMs: 2000 });
    return { ok: true, ...(await t.u.flowProbe()) };
  }

  /** Answer (when asked), pick a grade and subject, Finish, and collect what the bot sends after it. */
  async function finish(t, answer) {
    const keys = api.dataKeys();
    const before = keys.ok ? await api.snapshot(keys.watch) : keys;
    if (answer) {
      await t.u.flowClick(ANSWER[answer], { exact: true, settleMs: 300 });
      await t.u.flowClick('Next', { exact: true, settleMs: 2000 });
    }
    const teaching = await t.u.flowProbe();
    await t.u.flowClick('Grade 2', { exact: true, settleMs: 300 });
    await t.u.flowClick('Urdu', { exact: true, settleMs: 300 });
    await t.u.flowClick('Finish', { exact: true, settleMs: 2500 });
    await t.u.flowClick('Done', { exact: true, settleMs: 1000 });
    t.u.closeFlow();
    const texts = [];
    const t0 = Date.now();
    let greetAt = 0;
    while (Date.now() - t0 < 90000 && !(greetAt && Date.now() - greetAt > 2500)) {
      for (const r of await t.u.fresh()) {
        if (r.txt) texts.push(r.txt);
        if (!greetAt && GREET.test(r.txt || '')) greetAt = Date.now();
      }
      await sleep(500);
    }
    const welcome = texts.join('\n');
    const greeting = texts.find((x) => GREET.test(x)) || '';
    const me = await user(`id=eq.${t.me.id}`);
    const other = await user(`id=eq.${t.other.id}`);
    const audit = await get(`leader_roster_audit?select=action,detail&actor_user_id=eq.${t.me.id}&order=created_at.desc`);
    const rules = before.ok ? await api.dataRules(keys.watch, [t.me.id, t.other.id], before.snap) : before;
    return { teachingScreen: teaching.screen, welcomed: Boolean(greetAt), greeting: greeting.trim(), welcome: welcome.slice(-400), me, other, audit,
      data: dataVerdict(rules) };
  }

  /** Put the switch back and take the QA school off every account made here, so purge-school can drop it and a
   *  later feature on this run's database never meets it. Best effort: the run's database is dropped anyway. */
  async function tearDown() {
    try { await api.restoreAppSettings(); } catch (_) { /* best effort */ }
    try {
      if (made.length) await fetch(`${url}/rest/v1/users?id=in.(${made.join(',')})`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ school_id: null }) });
      api.db('purge-school');
    } catch (_) { /* best effort */ }
  }

  return { blocked, setUp, newTeacher, toAfterSchool, finish, tearDown };
}

const V = (c, ev) => [c ? 'PASS' : 'FAIL', ev];

/** The data part of a scenario from api.dataRules' answer: ok unless a rule is broken. Off the run's own database it is
 *  NOT CHECKED, which never fails a scenario and never passes the data part either: the evidence says which. */
function dataVerdict(rules) {
  if (!rules || !rules.ok) return { ok: true, data: 'NOT CHECKED: ' + ((rules && rules.notChecked) || 'no answer') };
  return { ok: !rules.owner.length && !rules.duplicates.length, data: 'checked', owner: rules.owner, duplicates: rules.duplicates };
}
const kept = (f, t) => Boolean(f.me && f.other && f.me.phone_number === t.phone && !f.me.deleted_at && f.other.phone_number === t.other.phone);
const escalated = (f) => (f.audit.find((a) => a.action === 'edit_phone_escalated') || {}).detail || null;

/** R26's two rows: an answer that cannot be acted on safely. Returns [ok, evidence]. */
async function reviewRow(it, n, name, opts, answer, reason) {
  const t = await it.newTeacher(n, name, opts);
  const p = await it.toAfterSchool(t);
  if (p.screen !== 'IS_THIS_YOU') { t.u.closeFlow(); return [false, { asked: false, screen: p.screen, err: p.err }]; }
  const f = await it.finish(t, answer);
  const esc = escalated(f);
  const ok = Boolean(f.me && f.me.registration_completed) && kept(f, t) && f.greeting.endsWith(CHECKED)
    && Boolean(esc && esc.reason === reason) && f.data.ok;
  return [ok, { answer, completed: f.me && f.me.registration_completed, numbersKept: kept(f, t), escalation: esc && esc.reason,
    wantReason: reason, greetingEnd: f.greeting.slice(-120), data: f.data }];
}

const NAMES = {
  R23: 'A lesson-plan first message gets the catalogue alone; the registration Flow comes on a later turn',
  R24: 'A first-time registrant next to an unused account in her name is asked "Is this you?"',
  R25: 'Yes on an unused account links my number to it',
  R26: 'An answer that cannot be acted on safely asks for a check and moves nothing',
  R27: 'No keeps both accounts',
  R28: 'An account used in the last 30 days is never offered',
  R29: 'A session opened on the previous form finishes without the question',
};
const CHROME_LANE_IDS = ['R01', 'R02', 'R03', 'R05', 'R06', 'R07', 'R08', 'R09', 'R10', 'R11', 'R12', 'R13',
  'R14', 'R15', 'R16', 'R17', 'R18', 'R19', 'R20', 'R21', 'R22'];
/** On the mock lane the shared-driver scenarios are DEFERRED, with the reason (registration.cjs line 1). */
function deferChromeLane(rec, want) {
  for (const id of CHROME_LANE_IDS) if (want(id)) rec(id, 'chrome lane only', 'DEFERRED', { reason: 'the bot caches the shared driver\'s registration at stack start (registration.cjs line 1)' }, 0);
}

/** Drive R24–R29 (R23 is DEFERRED). Returns r(id): records that scenario's verdict, when `want` selected it. */
async function drive({ api, rec, sleep, want }) {
  const res = { R23: ['DEFERRED', { reason: 'not driven yet: needs a never-offered number and the lesson-plan catalogue turn; covered by tests/registration/front-door-invite.test.js' }, 0] };
  const r = (id) => { if (res[id] && want(id)) rec(id, NAMES[id], ...res[id]); };
  const ids = ['R24', 'R25', 'R26', 'R27', 'R28', 'R29'].filter((id) => want(id));
  if (!ids.length) return r;
  const it = makeItu({ api, sleep });
  const why = it.blocked();
  if (!why) { try { await it.setUp(); } catch (e) { res.setUpErr = String(e.message || e).slice(0, 200); } }
  if (why || res.setUpErr) { for (const id of ids) res[id] = ['BLOCKED', { reason: why || res.setUpErr }, 0]; return r; }
  const run = async (id, fn) => {
    if (!want(id)) return;
    const s = Date.now();
    try { res[id] = [...(await fn()), Date.now() - s]; } catch (e) { res[id] = ['FAIL', { err: String(e.message || e).slice(0, 200) }, Date.now() - s]; }
  };
  try {
    await run('R24', async () => {
      const t = await it.newTeacher(1, 'Sadia Noreen');
      const p = await it.toAfterSchool(t);
      t.u.closeFlow();
      const txt = p.text || '';
      const leaked = leaks(txt, t.other).concat(txt.includes('Noreen') ? ['surname'] : []);
      return V(p.screen === 'IS_THIS_YOU' && /Is this you\?/.test(txt) && txt.includes('Sadia') && txt.includes('IMSG G-7/3-2')
        && /ending in 47\b/.test(txt) && !leaked.length, { screen: p.screen, err: p.err, text: txt.slice(0, 320), leaked });
    });
    await run('R25', async () => {
      const t = await it.newTeacher(2, 'Hina Javed');
      const p = await it.toAfterSchool(t);
      if (p.screen !== 'IS_THIS_YOU') { t.u.closeFlow(); return V(false, { asked: false, screen: p.screen, err: p.err }); }
      const f = await it.finish(t, 'yes');
      const linked = Boolean(f.other && f.other.phone_number === t.phone && f.other.registration_completed === true);
      const retired = Boolean(f.me && f.me.deleted_by === 'registration_claim' && f.me.deleted_at && f.me.phone_number !== t.phone);
      const audited = f.audit.some((a) => a.action === 'edit_phone');
      return V(linked && retired && audited && f.greeting.endsWith(LINKED) && f.data.ok,
        { linked, retired, audited, greetingEnd: f.greeting.slice(-120), escalation: (escalated(f) || {}).reason || null, data: f.data });
    });
    await run('R26', async () => {
      const a = await reviewRow(it, 3, 'Rabia Aslam', {}, 'not_sure', 'not_sure');
      const b = await reviewRow(it, 4, 'Nadia Qureshi', { otherTraining: true }, 'yes', 'record_has_history');
      return V(a[0] && b[0], { unusedNotSure: a[1], trainingRecordYes: b[1] });
    });
    await run('R27', async () => {
      const t = await it.newTeacher(5, 'Samina Akhtar');
      const p = await it.toAfterSchool(t);
      if (p.screen !== 'IS_THIS_YOU') { t.u.closeFlow(); return V(false, { asked: false, screen: p.screen, err: p.err }); }
      const f = await it.finish(t, 'no');
      const untouched = kept(f, t) && f.other.registration_completed !== true && !f.audit.length;
      const usual = f.welcomed && !f.welcome.includes(LINKED) && !f.welcome.includes(CHECKED);
      return V(Boolean(f.me && f.me.registration_completed) && untouched && usual && f.data.ok,
        { completed: f.me && f.me.registration_completed, untouched, usualWelcome: usual, audit: f.audit.map((x) => x.action), greetingEnd: f.greeting.slice(-120), data: f.data });
    });
    await run('R28', async () => {
      const t = await it.newTeacher(6, 'Farah Naz', { otherLastMessageDaysAgo: 3 });
      const p = await it.toAfterSchool(t);
      t.u.closeFlow();
      return V(p.screen === 'TEACHING' && !/Is this you/i.test(p.text || ''), { screen: p.screen, err: p.err, text: (p.text || '').slice(0, 160) });
    });
    await run('R29', async () => {
      const t = await it.newTeacher(7, 'Uzma Shah');
      const p = await it.toAfterSchool(t, { v6: false });
      if (p.screen !== 'TEACHING') { t.u.closeFlow(); return V(false, { screen: p.screen, err: p.err }); }
      const f = await it.finish(t, null);
      const asBefore = Boolean(f.me && f.me.registration_completed) && kept(f, t) && f.other.registration_completed !== true
        && f.welcomed && !f.welcome.includes(LINKED) && !f.welcome.includes(CHECKED);
      return V(asBefore && f.data.ok, { afterSchool: p.screen, completed: f.me && f.me.registration_completed, numbersKept: kept(f, t),
        greetingEnd: f.greeting.slice(-120), data: f.data });
    });
  } finally {
    await it.tearDown();
  }
  return r;
}

module.exports = { drive, deferChromeLane, dataVerdict, makeItu, phonesFor, envValue, signedFetch, cardOn, leaks, LINKED, CHECKED, ANSWER, V6_FLOW_ID };
