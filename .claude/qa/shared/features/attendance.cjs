// @mock-lane — mock-capable driver (uses the mock API, not the browser DOM). Its presence enrols this feature in the mock lane; E2E_MOCK_FEATURES is derived from this marker, so there is no hardcoded list.
/* attendance.feature — 38 @e2e scenarios, ATT01–ATT38, all @wip @draft (bd-q8wt5e.5.1).
 *
 * The spec was written from the code of 2026-08-04, and attendance has been rebuilt since. Today
 * (attendance-router.service.js + attendance-entry.service.js + attendance-marking-endpoint.js):
 *
 *   "attendance" (or hazri / حاضری / roll call / /attendance)
 *     teacher, no class        → the class manager Flow (/class owns class creation)
 *     teacher, ≥1 class        → "How would you like to mark it?" [Mark by tapping] [Mark by voice note]
 *     principal, no own class  → the same question, naming TEACHER attendance
 *     principal WITH a class   → the same question naming no register, then [My teachers] [My class]
 *   tap   → ONE marking Flow: CLASS (teacher) or STAFF_DATE (principal) → DATE → MARK (tick absent)
 *           → LEAVE (tick on leave; no leave TYPE any more, bd-2729) → CONFIRM → SAVED, and the
 *           monthly register arrives in the chat as a document
 *   voice → the wait is armed; the note is transcribed + extracted and the Flow opens on REVIEW with the
 *           named people pre-ticked; nothing is written until CONFIRM
 *
 * So the driver drives each scenario's INTENT through what the product does now, and records a FAIL
 * (evidence.specDrift) where a scenario's Then describes behaviour that no longer exists — those are spec
 * findings for gherkin-spec-sync, not bot bugs. Nothing is promoted: promotion needs a live run.
 *
 * WORLD. Everything is seeded into THIS RUN'S OWN local database through PostgREST (db-target.cjs), and
 * only there: on a shared database every scenario that needs a seed is BLOCKED. A school with three
 * teachers, an empty school, and two classes on the driver (Grade 4 A: 3 students; Grade 5 B: 2).
 * The driver's role, school and active classes are switched per scenario; feature-runner restores
 * role/language after the run and the database is thrown away with it.
 *
 * VENDORS. ATT07/ATT08 script the transcription and the name extraction (stack-control.faults): the
 * lane holds no recorded answer for a roll call, and recording one needs live vendors. What they prove
 * is the pipeline around the model — the wait, the roster match, the REVIEW pre-ticks, the save — not
 * the model's understanding; that is why ATT26 (the model reading "everyone except") stays BLOCKED.
 */
const fs = require('fs');
const path = require('path');
const ENGINE = path.join(__dirname, '..', '..', 'engine', 'bin');   // the shared engine, linked in at .claude/qa/engine
const { dbCreds } = require(path.join(ENGINE, 'db-target.cjs'));
const MEDIA = path.resolve(__dirname, '..', '..', 'fixtures', 'whatsapp', 'niete', 'media');

const V = (c, ev) => [c ? 'PASS' : 'FAIL', ev];
const BLOCKED = (reason, ev = {}) => ['BLOCKED', { reason, ...ev }];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));   // a real wait: "nothing else arrives" must be waited out
const clip = (s, n = 160) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// The Flow ids the lane's bot runs with — the committed local-lane.env (the staging ids of the stored fixtures).
function laneFlowIds() {
  const out = {};
  try {
    for (const ln of fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'local-lane.env'), 'utf8').split('\n')) {
      const m = /^([A-Z_]+_FLOW_ID)=(.*)$/.exec(ln.trim());
      if (m) out[m[1]] = m[2].trim();
    }
  } catch (_) { /* no file: flow-id checks fall back to the card's own header */ }
  return out;
}

// ── the run's own database (local only) ─────────────────────────────────────────────────────────────
function makeDb() {
  const { url, key, kind } = dbCreds();
  if (kind !== 'local' || !url || !key) return null;   // never seed a shared database
  const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const q = async (method, p, body) => {
    const r = await fetch(`${url}/rest/v1/${p}`, { method, headers: { ...H, Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text();
    let j = null; try { j = t ? JSON.parse(t) : null; } catch (_) { /* not JSON */ }
    return { ok: r.ok, status: r.status, rows: Array.isArray(j) ? j : (j ? [j] : []), err: r.ok ? null : clip(t, 200) };
  };
  return { get: (p) => q('GET', p), post: (t, b) => q('POST', t, b), patch: (p, b) => q('PATCH', p, b), del: (p) => q('DELETE', p) };
}
class SeedError extends Error {}
const must = (r, what) => { if (!r.ok) throw new SeedError(`${what} failed (${r.status}): ${r.err}`); return r.rows; };

/** The fixed world every scenario draws on. Idempotent: rerunning on the same run's DB reuses its rows. */
async function seedWorld(db, drv) {
  const [me] = must(await db.get(`users?select=id,role,school_id,name&phone_number=eq.${drv}`), 'read driver');
  if (!me) throw new SeedError('driver user not found for ' + drv);
  const school = async (emis, name) => {
    const [have] = must(await db.get(`schools?select=id,name&emis=eq.${emis}`), 'read school');
    return have || must(await db.post('schools', { name, emis }), 'insert school')[0];
  };
  const S = await school(`E2EATT${drv}`, `E2E Attendance School ${drv.slice(-4)}`);
  const EMPTY = await school(`E2EATT0${drv}`, `E2E Empty School ${drv.slice(-4)}`);
  const TEACHERS = [['Ayesha Khan (E2E)', 1], ['Bilal Ahmed (E2E)', 2], ['Sana Tariq (E2E)', 3]];
  const teachers = [];
  for (const [name, n] of TEACHERS) {
    const phone = '92398' + drv.slice(-6) + n;
    const row = { name, role: 'teacher', school_id: S.id };
    const [have] = must(await db.get(`users?select=id&phone_number=eq.${phone}`), 'read teacher');
    const u = have ? (await db.patch(`users?phone_number=eq.${phone}`, row), have) : must(await db.post('users', { ...row, phone_number: phone }), 'insert teacher')[0];
    teachers.push({ id: u.id, name, phone });
  }
  const list = async (className, section, kids) => {
    const [have] = must(await db.get(`student_lists?select=id&user_id=eq.${me.id}&class_name=eq.${encodeURIComponent(className)}`), 'read class');
    const l = have || must(await db.post('student_lists', { user_id: me.id, class_name: className, section, academic_year: '2026-27', student_count: kids.length, is_active: true }), 'insert class')[0];
    const already = must(await db.get(`students?select=id,student_name&list_id=eq.${l.id}`), 'read students');
    if (!already.length) must(await db.post('students', kids.map((k, i) => ({ list_id: l.id, roll_number: i + 1, student_name: k, is_active: true, status: 'active' }))), 'insert students');
    const students = must(await db.get(`students?select=id,student_name,roll_number&list_id=eq.${l.id}&order=roll_number`), 'read students');
    return { id: l.id, label: `${className} ${section}`, className, students };
  };
  const A = await list('Grade 4', 'A', ['Aleeha Khan', 'Bilal Raza', 'Sara Noor']);
  const B = await list('Grade 5', 'B', ['Usman Ali', 'Zara Ahmed']);
  return { me, S, EMPTY, teachers, A, B, school0: me.school_id };
}

/** Region today (the endpoint's own clock, Asia/Karachi), minus n days, as YYYY-MM-DD. */
function day(n = 0) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.REGION_TIME_ZONE || 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

exports.run = async ({ api, rec, want = () => true }) => {
  const t = () => Date.now();
  const ALL = Array.from({ length: 38 }, (_, i) => 'ATT' + String(i + 1).padStart(2, '0'));
  const NAMES = {
    ATT01: 'A teacher saying "attendance" enters the student-marking flow',
    ATT02: 'A teacher with no classes is sent the class-setup Flow',
    ATT03: 'A teacher with exactly one class goes straight to the marking method',
    ATT04: 'A teacher with several classes is asked which class',
    ATT05: '"Everyone present" produces the monthly register',
    ATT06: 'Tap-to-mark marks the absentees and delivers the register',
    ATT07: 'A voice roll-call is transcribed into an attendance draft',
    ATT08: 'Confirming the verification delivers the register',
    ATT09: '/add-class opens the class-setup Flow even when classes exist',
    ATT10: 'Saving in the class manager (/class) is answered by its own screen, not the /menu catch-all',
    ATT11: 'A second paste that overlaps a longer paste on the same class still enrols every child',
    ATT12: 'A paste that could not be added is named on the saved screen, never "nothing changed"',
    ATT13: '/edit-class opens the roster editor',
    ATT14: 'A principal without student classes marks teacher attendance',
    ATT15: 'A principal marks everyone present',
    ATT16: 'A principal marks specific teachers absent',
    ATT17: 'A principal marks a teacher on leave and picks the leave type',
    ATT18: 'Confirming persists teacher attendance (one upsert per teacher)',
    ATT19: 'WhatsApp and the web Portal show the same teacher presence',
    ATT20: 'Roman-Urdu and Urdu attendance keywords all trigger',
    ATT21: 'A principal who also owns a class is asked tap-or-voice WITHOUT a register named',
    ATT22: 'Answering tap-or-voice then asks WHICH register',
    ATT23: 'Choosing "My class" opens the student register for the principal',
    ATT24: 'The role fork tolerates casing and whitespace',
    ATT25: 'A teacher can resume a recent unfinished attendance session',
    ATT26: 'Voice roll-call understands "everyone except" phrasing',
    ATT27: 'Recording the same class/date/session twice is caught',
    ATT28: 'Two registers with the same file name, delivered at once, each reach their own school',
    ATT29: '"Edit" at verification returns to marking',
    ATT30: 'A teacher whose old account was merged appears once on my staff register',
    ATT31: 'Text sent while awaiting a voice roll-call is redirected',
    ATT32: 'Tap marking falls back to text when the marking Flow is unset',
    ATT33: 'A class deleted mid-flow is reported, not silently dropped',
    ATT34: 'A principal with no school on file is told setup is needed',
    ATT35: 'A principal whose school has no teachers is told there is nothing to mark',
    ATT36: 'An out-of-range teacher number is rejected, not misapplied',
    ATT37: 'A principal is never silently marked into the student flow',
    ATT38: 'A class-register button tapped after the class is gone falls back to staff',
  };
  const done = new Set();
  const R = (id, verdict, ev, ms) => { done.add(id); rec(id, NAMES[id], verdict, ev, ms); };
  const R2 = (id, pair, ms) => R(id, pair[0], pair[1], ms);

  // ── scenarios this lane cannot drive, whatever the seed ─────────────────────────────────────────────
  // One literal call per id, so check-scenario-coverage.py sees each one recorded.
  const cannot = (id, reason) => { if (want(id)) R(id, 'BLOCKED', { reason }, 0); };
  const CANNOT = {
    ATT11: 'needs two devices saving overlapping pastes into one class at the same moment; the lane drives one emulated '
         + 'Flow at a time. The proof is jest: tests/classes/add-students-long-race.test.js',
    ATT12: 'needs an enrolment that fails part-way (a roll clash past every retry); nothing on the lane can force that '
         + 'inside the class-manager save. The proof is jest: tests/classes/roster-add-failure-named.test.js',
    ATT19: '@out-of-band: the web Portal does not run on the mock lane, so its presence numbers cannot be read beside '
         + "WhatsApp's. The proof is jest: teacher-attendance-convergence.test.js",
    ATT26: 'the "everyone except" reading is the extraction MODEL\'s; the lane holds no recorded answer for it '
         + '(replay-strict) and scripting the model\'s answer would only assert the script. Needs a recorded cassette (live vendors)',
    ATT28: 'needs two principals at different schools saving in the same second so their same-named registers race on '
         + 'disk; the lane cannot time two deliveries that closely. The proof is jest: '
         + 'tests/attendance/register-delivery-temp-race.test.js',
  };
  cannot('ATT11', CANNOT.ATT11); cannot('ATT12', CANNOT.ATT12); cannot('ATT19', CANNOT.ATT19);
  cannot('ATT26', CANNOT.ATT26); cannot('ATT28', CANNOT.ATT28);

  const db = makeDb();
  const drv = String(api.driver || process.env.E2E_DRIVER || '');
  if (!db || !(api.caps && api.caps.method === 'mock')) {
    const reason = !db ? 'no local run database (E2E_ENV=local): every remaining scenario seeds classes, schools and '
                       + 'teachers, which is only ever done on the run\'s own database'
                       : 'not the mock lane: the Flow screens are driven through the emulator';
    for (const id of ALL) if (!done.has(id) && want(id)) R(id, 'BLOCKED', { reason }, 0);
    return;
  }

  let W;
  try { W = await seedWorld(db, drv); }
  catch (e) {
    for (const id of ALL) if (!done.has(id) && want(id)) R(id, 'BLOCKED', { reason: 'seed failed: ' + clip(e.message, 200) }, 0);
    return;
  }
  const FIDS = laneFlowIds();
  let SC = null; try { SC = require(path.join(ENGINE, 'stack-control.cjs')); } catch (_) { /* no levers: their scenarios BLOCK */ }

  // ── primitives ──────────────────────────────────────────────────────────────────────────────────────
  /** The driver as `role`, at `school`, with exactly these classes active. Clears attendance state. */
  async function as(role, school, lists = []) {
    const ids = new Set(lists.map((l) => l.id));
    for (const l of [W.A, W.B]) await db.patch(`student_lists?id=eq.${l.id}`, { is_active: ids.has(l.id), user_id: W.me.id });
    const u = await api.setUser({ role, school_id: school ? school.id : null, conversation_state: null, conversation_state_expires_at: null });
    if (!u.ok) throw new SeedError('setUser failed: ' + JSON.stringify(u));
    await api.resetFlow();
  }
  async function say(text) {
    await api.freshReset();
    const r = await api.sendWait(text, 60000);
    const items = await api.fresh();
    return { r, items, txt: items.map((i) => i.txt).filter(Boolean).join('\n'), btns: items.flatMap((i) => i.btns || []) };
  }
  async function tap(label) {
    await api.freshReset();
    const r = await api.tapAndWait(label, 60000);
    const items = await api.fresh();
    return { r, items, txt: items.map((i) => i.txt).filter(Boolean).join('\n'), btns: items.flatMap((i) => i.btns || []) };
  }
  const flowCard = (items) => [...(items || [])].reverse().find((i) => i.raw && i.raw.interactive && i.raw.interactive.type === 'flow') || null;
  const cardInfo = (c) => {
    if (!c) return null;
    const ia = c.raw.interactive, p = (ia.action && ia.action.parameters) || {};
    return { flowId: p.flow_id, token: p.flow_token, header: ia.header && ia.header.text, body: ia.body && ia.body.text, cta: p.flow_cta };
  };
  const flowName = (id) => Object.keys(FIDS).find((k) => FIDS[k] === String(id)) || String(id);
  const scr = () => { const f = api.flow(); return f && f.isOpen() ? f.probe() : { screen: null, text: '', items: [] }; };
  const opts = (name) => scr().items.filter((i) => i.kind === 'option' && (!name || i.name === name));
  async function open(card) {
    const r = await api.openFlow('.', { from: card });
    return { ...r, screen: scr().screen, text: scr().text };
  }
  async function next(label = 'Continue') {
    const r = await api.flowClick(label);
    return { ...r, screen: scr().screen, text: scr().text };
  }
  const setDate = (d) => api.flowType(d, { field: 'register_date' });
  const tick = (name) => api.flowPick(name);
  /** Wait for the register document that follows a SAVED screen. */
  async function awaitDoc(ms = 45000) {
    const end = t() + ms; const seen = [];
    while (t() < end) {
      for (const m of await api.fresh()) { seen.push(m); if (m.doc || (m.media && /sheet|xlsx|excel/i.test(JSON.stringify(m.media)))) return { doc: m, seen }; }
      await wait(1000);
    }
    return { doc: null, seen };
  }
  /** Everything that arrives in `ms`, waited out in full (for "and nothing else"). */
  async function quiet(ms = 8000) { await wait(ms); return api.fresh(); }
  /** The teacher's tap path, up to the open Flow (the CLASS screen). */
  async function openTeacherRegister() {
    await say('attendance');
    const t1 = await tap('Mark by tapping');
    const c = cardInfo(flowCard(t1.items));
    if (!c) return { ok: false, err: 'no marking Flow card after "Mark by tapping"', reply: clip(t1.txt) };
    const o = await open(flowCard(t1.items));
    return { ok: o.ok, err: o.err, card: c, screen: o.screen };
  }
  /** The principal's tap path, up to the open Flow (STAFF_DATE). */
  async function openStaffRegister() {
    const a = await say('attendance');
    const t1 = await tap('Mark by tapping');
    const card = flowCard(t1.items);
    if (!card) return { ok: false, err: 'no marking Flow card after "Mark by tapping"', ask: clip(a.txt), reply: clip(t1.txt), btns: t1.btns };
    const o = await open(card);
    return { ok: o.ok, err: o.err, card: cardInfo(card), screen: o.screen, ask: clip(a.txt) };
  }
  const rows = async (p) => (await db.get(p)).rows;
  const guard = async (ids, fn) => {
    if (!ids.some((id) => want(id))) return;
    const s = t();
    try { await fn(s); }
    catch (e) {
      const blocked = e instanceof SeedError;
      for (const id of ids) if (!done.has(id) && want(id)) {
        R(id, blocked ? 'BLOCKED' : 'FAIL', blocked ? { reason: 'seed: ' + clip(e.message, 200) }
          : { error: clip(e.message, 300), screen: scr().screen, note: 'the step the scenario needs did not happen (thrown while driving)' }, t() - s);
      }
    } finally {
      try { api.closeFlow(); } catch (_) { /* nothing open */ }
    }
  };

  // ══════════════════════ TEACHER — student marking ══════════════════════

  await guard(['ATT01', 'ATT03'], async (s) => {
    await as('teacher', W.S, [W.A]);
    const r = await say('attendance');
    const asks = r.btns.includes('Mark by tapping') && r.btns.includes('Mark by voice note');
    const ev = { reply: clip(r.txt), buttons: r.btns };
    if (want('ATT01')) R2('ATT01', V(asks && /class attendance/i.test(r.txt),
      { ...ev, note: 'today the student flow starts with the method question; the Flow then picks class and date' }), t() - s);
    if (want('ATT03')) R2('ATT03', V(asks && !/which class/i.test(r.txt),
      { ...ev, note: 'one class: no class picker in chat; "everyone present" is now an untouched MARK screen (ATT05), not a third option' }), t() - s);
  });

  await guard(['ATT02'], async (s) => {
    await as('teacher', W.S, []);
    const r = await say('attendance');
    const c = cardInfo(flowCard(r.items));
    const name = c && flowName(c.flowId);
    R2('ATT02', V(!!c && /CLASS_MANAGER|ATTENDANCE_SETUP/.test(name),
      { flow: name, header: c && c.header, body: c && clip(c.body), reply: clip(r.txt),
        note: 'class creation moved from the attendance setup Flow to the class manager (bd-2724); its header is not "Class Setup"' }), t() - s);
  });

  await guard(['ATT04'], async (s) => {
    await as('teacher', W.S, [W.A, W.B]);
    const o = await openTeacherRegister();
    if (!o.ok) return R2('ATT04', V(false, o), t() - s);
    const classes = opts().map((i) => i.title);
    const both = classes.some((x) => /Grade 4/.test(x)) && classes.some((x) => /Grade 5/.test(x));
    await tick('Grade 5');
    const n = await next();
    R2('ATT04', V(o.screen === 'CLASS' && both && n.screen === 'DATE' && /Grade 5/.test(n.text),
      { screen: o.screen, classes, picked: 'Grade 5', then: n.screen, heading: clip(n.text, 80),
        note: 'the class is picked on the Flow\'s CLASS screen by tapping; typed "by number or by name" no longer exists' }), t() - s);
  });

  // ATT05 everyone present → register; ATT27 the same class + date again is caught, never duplicated.
  const D05 = day(1);
  await guard(['ATT05', 'ATT27'], async (s) => {
    await as('teacher', W.S, [W.A]);
    const o = await openTeacherRegister();
    if (!o.ok) throw new Error(o.err);
    await tick('Grade 4'); await next();
    await setDate(D05); const m = await next();
    const l = await next();            // MARK: nobody ticked
    const c = await next();            // LEAVE: nobody ticked
    await api.freshReset();
    const sv = await next('Save attendance');
    const d = await awaitDoc();
    const sess = await rows(`attendance_sessions?select=id,present_count,absent_count&list_id=eq.${W.A.id}&session_date=eq.${D05}`);
    if (want('ATT05')) R2('ATT05', V(sv.screen === 'SAVED' && /3 present · 0 absent/.test(sv.text) && !!d.doc && sess.length === 1,
      { mark: clip(m.text, 60), leave: clip(l.text, 40), confirm: clip(c.text, 60), saved: clip(sv.text, 120),
        register: d.doc ? { txt: clip(d.doc.txt, 60), media: d.doc.media } : null, sessions: sess }), t() - s);

    if (want('ATT27')) {
      const s27 = t();
      api.closeFlow(); await api.resetFlow();
      await as('teacher', W.S, [W.A]);
      const o2 = await openTeacherRegister();
      if (!o2.ok) throw new Error(o2.err);
      await tick('Grade 4'); await next(); await setDate(D05); await next(); await next();
      const c2 = await next();
      const warned = /Already marked for/.test(c2.text) && /Saving replaces it/.test(c2.text);
      const sv2 = await next('Save attendance');
      const again = await rows(`attendance_sessions?select=id&list_id=eq.${W.A.id}&session_date=eq.${D05}`);
      R2('ATT27', V(warned && again.length === 1,
        { confirm: clip(c2.text, 220), saved: clip(sv2.text, 120), sessionsForDay: again.length,
          note: 'caught on the CONFIRM screen (named earlier tallies + "Saving replaces it"), then replaced — never duplicated' }), t() - s27);
    }
  });

  // ATT06 tap absentees → register, and nothing in the chat after the Flow closes.
  await guard(['ATT06'], async (s) => {
    const D = day(2);
    await as('teacher', W.S, [W.A]);
    const o = await openTeacherRegister();
    if (!o.ok) throw new Error(o.err);
    await tick('Grade 4'); await next(); await setDate(D); await next();
    await tick('Bilal Raza');
    const l = await next(); const c = await next();
    await api.freshReset();
    const sv = await next('Save attendance');
    const d = await awaitDoc();
    await api.freshReset();
    const fin = await api.flowClick('Done');
    const after = await quiet(8000);
    const catchAll = after.filter((m) => /Thanks for your response|Type \/menu to see/i.test(m.txt || ''));
    const sess = await rows(`attendance_sessions?select=absent_count,present_count&list_id=eq.${W.A.id}&session_date=eq.${D}`);
    R2('ATT06', V(/1 marked absent/.test(l.text) && /Absent: Bilal Raza/.test(c.text) && sv.screen === 'SAVED' && !!d.doc && fin.ok && !catchAll.length
      && sess.length === 1 && sess[0].absent_count === 1,
      { leave: clip(l.text, 40), confirm: clip(c.text, 100), saved: clip(sv.text, 100), register: !!d.doc,
        completed: fin.ok, afterClose: after.map((m) => clip(m.txt, 80)), catchAll: catchAll.length, session: sess[0] }), t() - s);
  });

  // ATT07 voice → draft on REVIEW; ATT08 confirming it delivers the register. Vendors scripted (see header).
  await guard(['ATT07', 'ATT08'], async (s) => {
    if (!SC || !SC.runDir()) { for (const id of ['ATT07', 'ATT08']) if (want(id)) R(id, 'BLOCKED', { reason: 'no RUN_DIR: the scripted transcription needs stack-control.faults' }, 0); return; }
    await as('teacher', W.S, [W.A]);
    await say('attendance');
    const v = await tap('Mark by voice note');
    const armed = /voice note naming the students/i.test(v.txt);
    const spoken = 'Aleeha aur Bilal ghair hazir hain';
    SC.faults([
      { kind: 'asr', match: '/./', times: 1, value: { text: spoken, language: 'ur' } },
      { kind: 'llm', match: 'recorded a voice note taking attendance', times: 1,
        content: JSON.stringify({ people: [{ name: 'Aleeha Khan', status: 'absent' }, { name: 'Bilal Raza', status: 'absent' }] }) },
    ]);
    await api.freshReset();
    const up = await api.upload(path.join(MEDIA, 'lp_request_voice.ogg'), 'Audio', 120000);
    const items = await api.fresh();
    const card = flowCard(items);
    const left = SC.faultsLeft(); SC.clearFaults();
    const ci = cardInfo(card);
    let review = null, pre = [];
    if (card) {
      const o = await open(card);
      review = o;
      pre = opts('absent').filter((i) => i.selected).map((i) => i.title);
    }
    const named = ['Aleeha Khan', 'Bilal Raza'].every((n) => pre.some((p) => p.includes(n))) && pre.length === 2;
    if (want('ATT07')) R2('ATT07', V(armed && !!ci && /I heard 2 names/.test(ci.body || '') && review && review.screen === 'REVIEW' && named,
      { armedPrompt: clip(v.txt, 100), card: ci && { body: ci.body, cta: ci.cta, token: ci.token && ci.token.replace(/^[^:]+/, '<uid>') },
        review: review && clip(review.text, 160), preTicked: pre, uploadReply: clip(up.txt, 80), faultsUnspent: left.length,
        vendors: 'scripted: transcription "' + spoken + '" + extraction (the pipeline around the model is what is under test)' }), t() - s);
    if (want('ATT08')) {
      const s8 = t();
      if (!review || review.screen !== 'REVIEW') { R('ATT08', 'BLOCKED', { reason: 'no REVIEW screen to confirm (ATT07 did not reach it)' }, 0); return; }
      const D = day(3);
      await setDate(D);
      const l = await next(); const c = await next();
      await api.freshReset();
      const sv = await next('Save attendance');
      const d = await awaitDoc();
      const sess = await rows(`attendance_sessions?select=absent_count,present_count&list_id=eq.${W.A.id}&session_date=eq.${D}`);
      R2('ATT08', V(sv.screen === 'SAVED' && !!d.doc && sess.length === 1 && sess[0].absent_count === 2,
        { leave: clip(l.text, 40), confirm: clip(c.text, 100), saved: clip(sv.text, 100), register: !!d.doc, session: sess[0],
          note: 'verification is the REVIEW → CONFIRM screens with "Save attendance"; a typed "yes" no longer exists' }), t() - s8);
    }
  });

  await guard(['ATT09'], async (s) => {
    await as('teacher', W.S, [W.A, W.B]);
    const r = await say('add class');
    const c = cardInfo(flowCard(r.items));
    const name = c && flowName(c.flowId);
    R2('ATT09', V(!!c && /CLASS_MANAGER|ATTENDANCE_SETUP/.test(name),
      { flow: name, header: c && c.header, reply: clip(r.txt), note: '"add class" opens the class manager (class-command.js ADD); there is no separate "Add New Class" setup Flow now' }), t() - s);
  });

  await guard(['ATT13'], async (s) => {
    await as('teacher', W.S, [W.A]);
    const r = await say('edit class');
    const c = cardInfo(flowCard(r.items));
    const name = c && flowName(c.flowId);
    R2('ATT13', V(!!c && /EDIT_CLASS|CLASS_MANAGER/.test(name),
      { flow: name, reply: clip(r.txt, 200), buttons: r.btns,
        specDrift: c ? null : 'no "edit class" trigger exists any more (edit-class-trigger.js is gone; class-command.js matches /class, "my classes", "add a class"); the roster is edited inside /class' }), t() - s);
  });

  // ══════════════════════ PRINCIPAL — teacher marking ══════════════════════

  // ATT14 roster shown · ATT15 everyone present → verify · ATT16 2 and 3 absent → verify
  // ATT17 leave (and its type) · ATT18 confirm persists one row per teacher · ATT37 never the student flow
  const D14 = day(4);
  const p37 = {};
  await guard(['ATT14', 'ATT15', 'ATT16', 'ATT17', 'ATT18', 'ATT37'], async (s) => {
    await as('principal', W.S, []);
    const o = await openStaffRegister();
    p37.noClass = { ask: o.ask, token: o.card && o.card.token && o.card.token.replace(/^[^:]+/, '<uid>') };
    if (!o.ok) throw new Error(o.err + ' ' + JSON.stringify(o).slice(0, 200));
    await setDate(D14);
    const m = await next();
    const listed = opts('absent').map((i) => i.title);
    const all3 = W.teachers.every((x) => listed.some((r) => r.includes(x.name)));
    if (want('ATT14')) R2('ATT14', V(/teacher attendance/i.test(o.ask) && o.screen === 'STAFF_DATE' && m.screen === 'MARK' && all3 && listed.length === 3,
      { ask: o.ask, firstScreen: o.screen, mark: clip(m.text, 100), roster: listed,
        note: 'the roster is the Flow\'s MARK screen (tick who is away), not a numbered chat list' }), t() - s);

    if (want('ATT15')) {
      const s15 = t();
      const l = await next(); const c = await next();
      R2('ATT15', V(/Nobody marked absent/.test(l.text) && c.screen === 'CONFIRM' && /3 present · 0 absent · 0 on leave/.test(c.text),
        { leave: clip(l.text, 40), confirm: clip(c.text, 100), note: '"all" is now an untouched MARK screen; CONFIRM is the verify step' }), t() - s15);
    }

    if (want('ATT16')) {
      const s16 = t();
      api.closeFlow();
      const o2 = await openStaffRegister();
      if (!o2.ok) throw new Error(o2.err);
      await setDate(D14); await next();
      await tick(W.teachers[1].name); await tick(W.teachers[2].name);
      const l = await next(); const c = await next();
      R2('ATT16', V(/2 marked absent/.test(l.text) && /Absent: .*Bilal Ahmed.*Sana Tariq|Absent: .*Sana Tariq.*Bilal Ahmed/.test(c.text) && /1 present · 2 absent/.test(c.text),
        { ticked: [W.teachers[1].name, W.teachers[2].name], leave: clip(l.text, 40), confirm: clip(c.text, 160) }), t() - s16);
    }

    if (want('ATT17', 'ATT18')) {
      const s17 = t();
      api.closeFlow();
      const o3 = await openStaffRegister();
      if (!o3.ok) throw new Error(o3.err);
      await setDate(D14); await next(); await next();   // MARK: nobody absent
      await tick(W.teachers[2].name);
      const c = await next();
      const askedType = /casual|sick|official/i.test(c.text) || opts().some((i) => /casual|sick|official/i.test(i.title));
      if (want('ATT17')) R2('ATT17', V(askedType,
        { leaveTicked: W.teachers[2].name, next: c.screen, confirm: clip(c.text, 140),
          specDrift: askedType ? null : 'the leave TYPE step was removed on purpose (bd-2729: Present / Absent / Leave only; leave_type is written NULL); the teacher is recorded on leave without a type' }), t() - s17);
      if (want('ATT18')) {
        const s18 = t();
        const sv = await next('Save attendance');
        const recs = await rows(`teacher_attendance_records?select=teacher_id,status&school_id=eq.${W.S.id}&date=eq.${D14}`);
        const ids = recs.map((r) => r.teacher_id);
        const one = ids.length === 3 && new Set(ids).size === 3 && W.teachers.every((x) => ids.includes(x.id));
        const sana = recs.find((r) => r.teacher_id === W.teachers[2].id);
        R2('ATT18', V(sv.screen === 'SAVED' && /Saved · 2 present · 0 absent · 1 on leave/.test(sv.text) && one && sana && sana.status === 'leave',
          { saved: clip(sv.text, 100), records: recs.map((r) => r.status), oneRowPerTeacher: one }), t() - s18);
      }
    }
  });

  await guard(['ATT20'], async (s) => {
    await as('teacher', W.S, [W.A]);
    const out = {};
    for (const kw of ['hazri', 'حاضری', 'roll call', '/attendance']) {
      const r = await say(kw);
      out[kw] = r.btns.includes('Mark by tapping') && r.btns.includes('Mark by voice note') ? 'method question' : clip(r.txt, 80);
    }
    R2('ATT20', V(Object.values(out).every((x) => x === 'method question'), { replies: out }), t() - s);
  });

  // ATT21 no register named · ATT22 then which register · ATT23 "My class" → the class picker Flow
  await guard(['ATT21', 'ATT22', 'ATT23', 'ATT37'], async (s) => {
    await as('principal', W.S, [W.A]);
    const a = await say('attendance');
    const neutral = a.btns.includes('Mark by tapping') && !/teacher|class attendance/i.test(a.txt);
    if (want('ATT21')) R2('ATT21', V(neutral, { ask: clip(a.txt), buttons: a.btns }), t() - s);
    const s22 = t();
    const q = await tap('Mark by tapping');
    const asksRegister = q.btns.includes('My teachers') && q.btns.includes('My class') && !flowCard(q.items);
    p37.withClass = { ask: clip(a.txt, 80), afterTap: clip(q.txt, 80), buttons: q.btns, flowCard: !!flowCard(q.items) };
    if (want('ATT22')) R2('ATT22', V(asksRegister, { reply: clip(q.txt), buttons: q.btns }), t() - s22);
    if (want('ATT23')) {
      const s23 = t();
      const m = await tap('My class');
      const card = flowCard(m.items); const ci = cardInfo(card);
      const o = card ? await open(card) : { ok: false };
      R2('ATT23', V(!!ci && /:student$/.test(ci.token || '') && o.screen === 'CLASS' && opts().some((i) => /Grade 4/.test(i.title)),
        { token: ci && ci.token && ci.token.replace(/^[^:]+/, '<uid>'), flow: ci && flowName(ci.flowId), screen: o.screen, classes: opts().map((i) => i.title) }), t() - s23);
    }
  });

  await guard(['ATT24'], async (s) => {
    const r = await db.patch(`users?phone_number=eq.${drv}`, { role: ' PRINCIPAL ' });
    if (r.ok) {
      // The store took it — then the fork must still read it as a principal.
      await api.setUser({ school_id: W.S.id, conversation_state: null });
      const a = await say('attendance');
      R2('ATT24', V(/teacher attendance/i.test(a.txt), { stored: ' PRINCIPAL ', ask: clip(a.txt) }), t() - s);
    } else {
      R2('ATT24', BLOCKED('the precondition cannot exist: users_role_check only admits teacher | principal | coach | unregistered, '
        + 'so a padded/mixed-case role is refused at write. (The router compares role === \'principal\' exactly, so the '
        + 'tolerance this scenario describes is not in the code either — moot while the constraint holds.)',
        { write: r.status, err: r.err }), t() - s);
    }
    await api.setUser({ role: 'teacher' });
  });

  await guard(['ATT25'], async (s) => {
    await as('teacher', W.S, [W.A]);
    await say('attendance');
    await tap('Mark by tapping');      // started, then left
    const again = await say('attendance');
    const offers = /resume|continue where|start (again|fresh|over)/i.test(again.txt) || again.btns.some((b) => /resume|continue|fresh|new/i.test(b));
    R2('ATT25', V(offers, { reply: clip(again.txt), buttons: again.btns,
      specDrift: offers ? null : 'there is no session recovery any more: "attendance" asks the method question again; the marking Flow keeps its own state for 30 min' }), t() - s);
  });

  await guard(['ATT29'], async (s) => {
    await as('principal', W.S, []);
    const o = await openStaffRegister();
    if (!o.ok) throw new Error(o.err);
    await setDate(day(5)); await next(); await tick(W.teachers[0].name); await next();
    const c = await next();
    const r = await say('edit');
    const back = !!flowCard(r.items) || /mark|register|absent/i.test(r.txt);
    R2('ATT29', V(c.screen === 'CONFIRM' && back, { confirm: clip(c.text, 80), reply: clip(r.txt, 200), buttons: r.btns,
      specDrift: back ? null : 'verification is the Flow\'s CONFIRM screen; there is no typed "edit" step (going back is the client\'s back arrow, which the emulator does not render)' }), t() - s);
  });

  await guard(['ATT30'], async (s) => {
    const ay = W.teachers[0];
    const [old] = must(await db.get(`users?select=id&phone_number=eq.merged:${ay.id}`), 'read merged');
    if (!old) must(await db.post('users', { name: ay.name, role: 'teacher', school_id: W.S.id, phone_number: `merged:${ay.id}`, deleted_at: new Date().toISOString(), merged_into: ay.id }), 'insert merged account');
    const [oldRow] = must(await db.get(`users?select=id&phone_number=eq.merged:${ay.id}`), 'read merged');
    await as('principal', W.S, []);
    const o = await openStaffRegister();
    if (!o.ok) throw new Error(o.err);
    const D = day(6);
    await setDate(D); await next();
    const listed = opts('absent').map((i) => i.title).filter((x) => x.includes(ay.name));
    await next(); await next();
    const sv = await next('Save attendance');
    const recs = await rows(`teacher_attendance_records?select=teacher_id&school_id=eq.${W.S.id}&date=eq.${D}`);
    const onCurrent = recs.filter((r) => r.teacher_id === ay.id).length, onRetired = recs.filter((r) => r.teacher_id === oldRow.id).length;
    R2('ATT30', V(listed.length === 1 && sv.screen === 'SAVED' && onCurrent === 1 && onRetired === 0,
      { onRegister: listed, saved: clip(sv.text, 80), rowsCurrent: onCurrent, rowsRetired: onRetired }), t() - s);
  });

  await guard(['ATT31'], async (s) => {
    await as('principal', W.S, []);
    await say('attendance');
    const v = await tap('Mark by voice note');
    const armed = /voice note naming the teachers/i.test(v.txt);
    const r = await say('Ayesha is absent today');
    const redirected = /voice note/i.test(r.txt) && (/\b2\b|tap/i.test(r.txt));
    R2('ATT31', V(armed && redirected, { armedPrompt: clip(v.txt, 100), reply: clip(r.txt, 200),
      specDrift: redirected ? null : 'text is not intercepted while the voice wait is armed (only voice-message.handler reads it); the message goes on to the general handlers and the wait stays armed' }), t() - s);
    await api.setUser({ conversation_state: null, conversation_state_expires_at: null });
  });

  await guard(['ATT33'], async (s) => {
    await as('teacher', W.S, [W.A]);
    const o = await openTeacherRegister();
    if (!o.ok) throw new Error(o.err);
    const D = day(7);
    await tick('Grade 4'); await next(); await setDate(D);
    const m = await next();
    // The class is deleted while the register is open — exactly as StudentListService.softDeleteList does it:
    // its students first, then the list (both soft).
    await db.patch(`students?list_id=eq.${W.A.id}`, { is_active: false });
    await db.patch(`student_lists?id=eq.${W.A.id}`, { is_active: false });
    const l = await next(); const c = l.screen === 'LEAVE' ? await next() : l;
    const sv = c.screen === 'CONFIRM' ? await next('Save attendance') : c;
    const sess = await rows(`attendance_sessions?select=id&list_id=eq.${W.A.id}&session_date=eq.${D}`);
    const told = /no longer|deleted|removed|not found|does not exist/i.test([l.text, c.text, sv.text].join(' '));
    R2('ATT33', V(told && !sess.length, { mark: clip(m.text, 60), afterDelete: [l.screen, c.screen, sv.screen], saved: clip(sv.text, 120),
      sessionsWritten: sess.length,
      specDrift: told ? null : (sess.length ? null : 'not silently saved — but the Flow says the class has no students rather than that it no longer exists'),
      finding: !sess.length ? null : 'the register was saved against a class deleted mid-Flow' }), t() - s);
    await db.patch(`students?list_id=eq.${W.A.id}`, { is_active: true });
    await db.patch(`student_lists?id=eq.${W.A.id}`, { is_active: true });
  });

  await guard(['ATT34'], async (s) => {
    await as('principal', null, []);
    const r = await say('attendance');
    R2('ATT34', V(/not linked to a school|school/i.test(r.txt) && !r.btns.includes('Mark by tapping'), { reply: clip(r.txt, 200), buttons: r.btns }), t() - s);
  });

  await guard(['ATT35'], async (s) => {
    await as('principal', W.EMPTY, []);
    const o = await openStaffRegister();
    if (!o.ok) throw new Error(o.err);
    await setDate(day(1));
    const m = await next();
    // An empty roster still carries one placeholder option (rosterPayload's NO_ROSTER_OPTION); no TEACHER is offered.
    R2('ATT35', V(m.screen === 'MARK' && /No teachers listed for your school yet/.test(m.text) && !opts('absent').some((i) => /\(E2E\)/.test(i.title)),
      { screen: m.screen, text: clip(m.text, 160), note: 'reported on the Flow\'s MARK screen, before anything can be saved' }), t() - s);
  });

  await guard(['ATT36'], async (s) => {
    await as('principal', W.S, []);
    const o = await openStaffRegister();
    if (!o.ok) throw new Error(o.err);
    await setDate(day(8)); await next();
    // A teacher number that is not on the roster — the closest thing to "99" a Flow can carry is a stale/forged id.
    const forged = await api.flowRaw({ screen: 'MARK', absent: ['00000000-0000-4000-8000-000000000099'] });
    const res = forged && forged.res;
    const heading = res && res.data && res.data.heading;
    const dropped = res && res.screen === 'LEAVE' && /Nobody marked absent/.test(heading || '');
    const surfaced = res && res.screen === 'MARK' && /not on|range|invalid|could not/i.test(JSON.stringify(res.data || {}));
    R2('ATT36', V(surfaced, { answeredScreen: res && res.screen, heading, droppedSilently: dropped,
      specDrift: surfaced ? null : (dropped ? 'not misapplied (the id is dropped against the roster), but no error is surfaced and nothing is re-asked; typed indices no longer exist' : null) }), t() - s);
  });

  await guard(['ATT38', 'ATT37'], async (s) => {
    await as('principal', W.S, [W.A]);
    await say('attendance');
    const q = await tap('Mark by tapping');
    if (!q.btns.includes('My class')) throw new Error('no "My class" button: ' + clip(q.txt));
    // The class is handed to another teacher while the button sits on the handset.
    await db.patch(`student_lists?id=eq.${W.A.id}`, { user_id: W.teachers[0].id });
    const m = await tap('My class');
    const ci = cardInfo(flowCard(m.items));
    p37.handedOver = { token: ci && ci.token && ci.token.replace(/^[^:]+/, '<uid>') };
    if (want('ATT38')) R2('ATT38', V(!!ci && /:teacher:/.test(ci.token || ''), { token: p37.handedOver.token, flow: ci && flowName(ci.flowId), reply: clip(m.txt, 100) }), t() - s);
    await db.patch(`student_lists?id=eq.${W.A.id}`, { user_id: W.me.id });
  });

  if (want('ATT37')) {
    // The invariant, from every principal path driven above: never a student register without "My class".
    const okNoClass = p37.noClass && /:teacher:/.test(p37.noClass.token || '');
    const okWithClass = p37.withClass && p37.withClass.buttons.includes('My class') && !p37.withClass.flowCard;
    const okHanded = !p37.handedOver || /:teacher:/.test(p37.handedOver.token || '');
    R2('ATT37', (p37.noClass || p37.withClass)
      ? V(okNoClass && okWithClass && okHanded, { noClass: p37.noClass, withClass: p37.withClass, handedOver: p37.handedOver })
      : BLOCKED('no principal path was driven (ATT14/ATT21 did not run)'), 0);
  }

  await guard(['ATT10'], async (s) => {
    await as('teacher', W.S, [W.A]);
    const r = await say('/class');
    const card = flowCard(r.items);
    if (!card) throw new Error('no class manager Flow card: ' + clip(r.txt));
    const o = await open(card);
    const path_ = [o.screen]; const picks = [];
    // Add a class: the first option of every required picker, a name list for the roster, then Save.
    for (let i = 0; i < 8 && scr().screen && scr().screen !== 'SAVED'; i++) {
      const p = scr();
      if (p.screen === 'CLASSES') { const add = p.items.find((x) => x.kind === 'option' && /add/i.test(x.title)); await tick(add ? add.title : p.items.find((x) => x.kind === 'option').title); }
      else {
        const names = [...new Set(p.items.filter((x) => x.kind === 'option').map((x) => x.name))];
        const PREFER = { grade: /Grade 3/, section: /^B$/ };
        for (const n of names) {
          // No subject: the lane's seed carries no subject vocabulary (seed-tables.txt), so any subject is
          // refused as unknown_subject and the class is created without its teacher. Subjects are optional.
          if (/^remove/.test(n) || n === 'subjects') continue;
          const ofField = p.items.filter((x) => x.kind === 'option' && x.name === n && !x.disabled);
          const pick = ofField.find((x) => PREFER[n] && PREFER[n].test(x.title)) || ofField[0];
          if (pick) { api.flow().pick(pick.title, { exact: true }); picks.push(`${n}=${pick.title}`); }
        }
        const add = p.items.find((x) => x.kind === 'input' && x.name === 'add');
        if (add) await api.flowType('Hina Rauf\nKamran Ali', { field: 'add' });
      }
      const footer = scr().items.find((x) => x.kind === 'footer');
      const n = await next(footer ? footer.text : 'Continue');
      path_.push(n.ok ? (n.screen || 'closed') : `${n.screen}!${n.err}${n.seen ? ' seen=' + JSON.stringify(n.seen).slice(0, 120) : ''}`);
      if (!n.ok) break;
    }
    const saved = scr();
    await api.freshReset();
    const fin = saved.screen === 'SAVED' ? await api.flowClick(saved.items.find((x) => x.kind === 'footer').text) : { ok: false };
    const after = await quiet(8000);
    const catchAll = after.filter((m) => /Thanks for your response|Type \/menu to see/i.test(m.txt || ''));
    R2('ATT10', V(saved.screen === 'SAVED' && fin.ok && !catchAll.length,
      { path: path_, picks, saved: clip(saved.text, 160), completed: fin.ok, afterClose: after.map((m) => clip(m.txt, 80)), catchAll: catchAll.length }), t() - s);
  });

  // Last: it restarts the bot with the marking Flow unset, then puts it back.
  await guard(['ATT32'], async (s) => {
    if (!SC || !SC.runDir()) return R('ATT32', 'BLOCKED', { reason: 'no RUN_DIR: unsetting ATTENDANCE_MARKING_FLOW_ID needs stack-control.restart' }, 0);
    const off = await SC.restart('bot', { ATTENDANCE_MARKING_FLOW_ID: '' });
    if (!off.ok) return R('ATT32', 'BLOCKED', { reason: 'stack-control.restart(bot) failed', off: clip(JSON.stringify(off), 200) }, t() - s);
    try {
      await as('teacher', W.S, [W.A]);
      await say('attendance');
      const r = await tap('Mark by tapping');
      const text = !flowCard(r.items) && !!r.txt;
      const voice = /voice/i.test(r.txt);
      R2('ATT32', V(text && voice, { reply: clip(r.txt, 200), textFallback: text,
        specDrift: text && !voice ? 'it falls back to text ("not available on this number"), but does not point the teacher at voice' : null }), t() - s);
    } finally { await SC.restart('bot', {}); }
  });

  // Put the driver back as the harness found it (role/language are restored by feature-runner too).
  try { await as('teacher', W.school0 ? { id: W.school0 } : null, []); } catch (_) { /* the run database is dropped anyway */ }
  for (const id of ALL) if (!done.has(id) && want(id)) R(id, 'BLOCKED', { reason: 'the driver did not reach this scenario (an earlier block skipped it)' }, 0);
};
