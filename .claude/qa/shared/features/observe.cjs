// @mock-lane — mock-capable driver (uses the mock API, not the browser DOM). Its presence enrols this feature in the mock lane; E2E_MOCK_FEATURES is derived from this marker, so there is no hardcoded list.
/* observe.feature — mock-lane driver.
 *
 * observe is a COACH/leader feature, capability-gated on OBSERVE_MEWAKA_FLOW_ID and driven through the
 * OBSERVE_VISIT_FLOW_ID data_exchange Flow. The mock stack runs the visit Flow with the SANDBOX bot's
 * observe flags (local-stack.sh: OBSERVE_SCHEDULING_UI, _STAGE_SCREENS, _OBS_ACTION, _FRAMEWORK=fico,
 * _CAPTURE_GATES_ENABLED, _TEACHER_NOTIFY_ENABLED) — the committed Flow fixture IS that scheduling Flow.
 *
 * THE ROSTER (2026-10-06). The visit picker used to open on an EMPTY school dropdown, blocking 30 ids.
 * Two causes, both in the harness: (1) without OBSERVE_SCHEDULING_UI the handler answered INIT with the
 * legacy NavigationList's data.items while the fixture's SELECT_SCHOOL is a Dropdown fed by data.options
 * (observe-visit-flow.handler.js:39, :735); (2) api.setRoster wrote `E2E-OBS-<driver>` + leader_teachers,
 * but the product finds the school by the EMIS after the last ':' of school_ext_id and the teachers as
 * USERS at that school (patch-resolver.service.js:245, :250). The seed now writes `niete:E2EOBS<driver>`
 * and two persistent fixture teacher users (Ayesha: Urdu, Bilal: English); api.resetObserve() clears the
 * coach's earlier test observations + visits so the same fixture audio is analysed afresh each run.
 *
 * DRIVEN:
 *  · role gate: OBS20 · OBS02 · OBS01 · OBS32 · OBS21 (gate OFF via stack-control.restart)
 *  · scheduling: OBS03 school → teacher → brief · OBS05 save + chat ack · OBS62/63 the teacher's notice
 *    templates (read from her own mock outbox) · OBS19 · OBS04 menu counts
 *  · the chain on Bilal: recording → capture gates (answered No) → FICO form OBS07 → edit + submit OBS08
 *    → Later + /observe OBS14 → Debrief now OBS09, twice OBS15 → too-short OBS27 → respectful debrief
 *    OBS10 → Send report OBS11 / OBS18 / OBS12 (OBS31 when the total is readable) → same audio again
 *    OBS37 / OBS38 (coach Urdu)
 *  · the cancel chain on Ayesha: cancel → old buttons OBS29 → same audio again OBS39 → form → debrief:
 *    the already-coached debrief OBS40 / OBS41, the too-short one re-sent OBS42, the harmful one OBS23
 *  · unbound captures: OBS06 · OBS35 · OBS25 · OBS36 · OBS34 · OBS33
 *  · /school card (local database only — two global switches): OBS73 one school by EMIS · OBS74 My schools · OBS75 switch off
 * The debrief recordings are SYNTHETIC (fixtures/…/media/debrief, text-to-speech of a written script,
 * make-debrief-fixtures.cjs); the bot transcribes and judges them like any recording.
 *
 * BLOCKED, each with its evidence in the row: OBS13 (no refresh_on_back in the FICO Flow), OBS16, OBS17,
 * OBS22 (an unknown number gets an account before the gate), OBS24, OBS26/28/65/66 (no fault injection), OBS30,
 * OBS64's second half.
 *
 * Copy grounded in observe-strings.js (en) + observe-command.handler.js; screens confirmed by live probe. */
const V = (c, ev) => [c ? 'PASS' : 'FAIL', ev];
const B = (reason) => ['BLOCKED', { reason }];
const FAULT    = B('needs an injected DB-write / report-send / report-narrative failure; the mock Graph API refuses only an unreachable media link and the cassette faults script vendor answers, so neither a failed session insert nor a refused delivery can be caused here.');

const DENIED = /school leaders|field officers|I'm here for you/i;                                 // S.role_denied
const ENTRY  = /plan your visit|Plan my visit|Welcome to \/observe|how it works|record the lesson|Ready!|send me the recording/i;
const CAPTURED = /Got your recording|Whose observation is this|Pick the teacher/i;                // observe capture prompt
const COACHING = /analyze your teaching|Step \d\/5|Transcribing your classroom|feedback on your OWN/i; // the WRONG lane
const MEDIA = require('path').resolve(__dirname, '..', '..', 'fixtures', 'whatsapp', 'niete', 'media');

// Switch the coach's language through /language — the one writer, which also refreshes the bot's language
// cache. A direct users.preferred_language write left the bot answering from its cache: OBS38 switched to
// Urdu, the switch back to English never reached the bot, and every later scenario read Urdu replies
// against English patterns (run 20261006-1946: OBS06/25/35/36 and the runner's "Classroom Coaching" tap).
// Retried: a late message from the previous step can arrive as the /language reply, and then the picker has
// no rows to tap (run 20261006-2205: RUNNER "no list row titled اردو (rows=null)").
const setLang = async (api, row) => {
  let last = null;
  for (let i = 0; i < 3; i++) {
    try {
      await api.resetFlow(); await api.freshReset();
      const r = await api.sendWait('/language');
      const opener = (r.btns || []).find((b) => /Languages|زبانیں/.test(b));
      if (!opener) throw new Error('no language picker in the /language reply: ' + String(r.txt || '').slice(0, 80));
      await api.openList(opener);
      await api.pickRowAndWait(row);
      await api.resetFlow();
      return true;
    } catch (e) { last = e; await new Promise((res) => setTimeout(res, 3000)); }
  }
  throw last;
};

// The running stack's own .env (<RUN_DIR>/src/.env; dotenv keeps the FIRST value of a key), or null off the mock stack.
const stackEnv = () => {
  try {
    const fs = require('fs'); const path = require('path');
    const dir = require(path.join(__dirname, '..', '..', 'engine', 'bin', 'stack-control.cjs')).runDir();
    if (!dir) return null;
    const env = {};
    for (const line of fs.readFileSync(path.join(dir, 'src', '.env'), 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return env;
  } catch (_) { return null; }
};

// Where an app link (a cta_url's /go/<token>) lands, read the way /go reads it: the token decoded with the bot's OWN
// key (the run's src/.env; dotenv keeps the FIRST value of a key), then the School card target mapped to its page.
// null when there is no stack to read (no RUN_DIR) or the token does not verify.
const landingOfLink = (url) => {
  try {
    const fs = require('fs'); const path = require('path');
    const dir = require(path.join(__dirname, '..', '..', 'engine', 'bin', 'stack-control.cjs')).runDir();
    if (!dir || !url) return null;
    const src = path.join(dir, 'src');
    const env = {};
    for (const line of fs.readFileSync(path.join(src, '.env'), 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    const keep = { INTERNAL_API_KEY: process.env.INTERNAL_API_KEY, SUPABASE_URL: process.env.SUPABASE_URL };
    process.env.INTERNAL_API_KEY = env.INTERNAL_API_KEY || ''; process.env.SUPABASE_URL = env.SUPABASE_URL || '';
    try {
      const p = require(path.join(src, 'bot/shared/services/app-login-link.js')).verifyAppLink(String(url).split('/go/')[1] || '');
      if (!p) return null;
      return { feature: p.f, page: require(path.join(src, 'bot/shared/services/coach-school-target.js')).coachSchoolPathFor(p.f) };
    } finally {
      for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  } catch (_) { return null; }
};

exports.run = async ({ api, rec, want = () => true }) => {
  await api.resetFlow();
  let s;

  const observeAs = async (role, prefs) => {
    await api.setRole(role);
    if (prefs !== undefined) await api.setUser({ preferences: prefs });
    await api.freshReset();
    const last = await api.sendWait('/observe', 120000);
    const rest = await api.fresh();
    const txt = [last && last.txt, ...rest.map((m) => m.txt)].filter(Boolean).join('\n');
    return { ok: !!(last && last.ok), txt };
  };

  if (want('OBS20')) {
    // ── role gate (text) ──
    s = Date.now();
    const r20 = await observeAs('teacher');
    rec('OBS20', '/observe from a teacher account is denied (and the teacher is unaffected)',
        ...V(r20.ok && DENIED.test(r20.txt) && !ENTRY.test(r20.txt), { reply: r20.txt.slice(0, 160) }), Date.now() - s);
  }

  if (want('OBS02')) {
    s = Date.now();
    const r02 = await observeAs('coach', { observe_onboarded: false });
    rec('OBS02', 'First-ever /observe shows the one-time onboarding',
        ...V(r02.ok && !DENIED.test(r02.txt) && /Welcome to \/observe|how it works/i.test(r02.txt),
          { reply: r02.txt.slice(0, 180) }), Date.now() - s);
  }

  if (want('OBS01')) {
    s = Date.now();
    const r01 = await observeAs('coach');
    rec('OBS01', "A leader's /observe opens the capture/visit entry point",
        ...V(r01.ok && !DENIED.test(r01.txt) && ENTRY.test(r01.txt), { reply: r01.txt.slice(0, 180) }), Date.now() - s);
  }

  if (want('OBS32')) {
    s = Date.now();
    await api.setRole('coach'); await api.freshReset();
    const tap = await api.injectList('menu_observe', 'Observe a Teacher');
    const txt32 = [tap && tap.txt, ...(await api.fresh()).map((m) => m.txt)].filter(Boolean).join('\n');
    rec('OBS32', 'The Observe a Teacher menu row opens the same /observe entry',
        ...V(!!(tap && tap.ok) && !DENIED.test(txt32) && ENTRY.test(txt32), { reply: txt32.slice(0, 180) }), Date.now() - s);
  }

  // ═══════════════ the visit Flow, scheduling and the full observation chain ═══════════════
  // Every id below records exactly once. A step that fails leaves the ids downstream of it recorded
  // BLOCKED with the step that stopped them (`notReached`), never silently absent.
  const done = new Set();
  const verdictOf = {};   // id → PASS | FAIL | BLOCKED, for a scenario judged on others' results (OBS84)
  const R = (id, name, verdict, ms = 0) => { if (done.has(id)) return; done.add(id); verdictOf[id] = verdict[0]; rec(id, name, verdict[0], verdict[1], ms); };
  const NAMES = {
    OBS03: 'The visit picker walks school → teacher → brief',
    OBS04: 'The scheduling menu shows live pending-debrief and upcoming counts',
    OBS05: 'A leader schedules a future observation visit',
    OBS07: 'When analysis is ready the editable FICO form opens pre-filled',
    OBS08: 'The observer edits ratings then submits the FICO form',
    OBS09: '"Debrief now" delivers the 6-step debrief guide',
    OBS10: 'A respectful debrief recording yields two wins and one improvement',
    OBS11: 'The observer sends the finished report to the teacher',
    OBS12: 'The FICO report to the teacher carries no score and no accusatory verdicts',
    OBS13: 'BACK on a FICO domain screen re-serves it without losing edits',
    OBS14: 'A pending debrief is offered the next time the leader opens /observe',
    OBS15: 'Tapping "Debrief now" twice re-sends the same guide, no new analysis',
    OBS16: "A leader with no saved roster is asked for the teacher's name and number",
    OBS17: 'The teacher picker paginates when a school has many teachers',
    OBS18: 'A report send outside the 24h window goes via an approved template',
    OBS19: 'A scheduled visit can be moved or cancelled from the WhatsApp Flow',
    OBS23: 'A harmful debrief is gated — a concern, never praise, no card',
    OBS24: "The FICO form refuses a session that is not the observer's own",
    OBS27: 'A too-short debrief recording is refused and stays pending',
    OBS29: 'A cancelled observation stays cancelled whichever old button is tapped',
    OBS30: "Reopening a cancelled observation's form names the real reason, once",
    OBS31: 'The FICO report total reflects the real 148-point maximum',
    OBS37: 'A classroom recording the coach already had analysed is not analysed again',
    OBS38: "The already-analysed reply is in the coach's own language, not the teacher's",
    OBS39: 'A recording whose earlier observation was cancelled is analysed normally',
    OBS40: 'A debrief recording the coach was already coached on is not analysed again',
    OBS41: "The debrief already-analysed reply is in the coach's own language",
    OBS42: 'A debrief recording that was never coached is analysed normally when re-sent',
    OBS62: 'The teacher gets the date and time on WhatsApp when a coach books her visit',
    OBS63: 'Moving or cancelling a visit tells the teacher',
    OBS64: 'Re-saving a visit unchanged, or a teacher with no number, sends nothing',
    OBS84: 'A WhatsApp /observe observation is unchanged',
    OBS97: "/observe's Start asks for the recording and says a recorder-app file goes as a Document",
    OBS99: 'The send confirm names the teacher the report is going to',
  };
  const rr = (id, cond, ev, ms = 0) => R(id, NAMES[id], V(cond, ev), ms);
  const rb = (id, reason, ev) => R(id, NAMES[id], ['BLOCKED', { reason, ...(ev || {}) }], 0);
  const notReached = (ids, why) => { for (const id of ids) if (!done.has(id)) rb(id, 'not reached: ' + why); };

  const SCHED = ['OBS03', 'OBS04', 'OBS05', 'OBS19', 'OBS62', 'OBS63', 'OBS64'];
  const CHAIN = ['OBS07', 'OBS08', 'OBS09', 'OBS10', 'OBS11', 'OBS12', 'OBS14', 'OBS15', 'OBS18', 'OBS27', 'OBS31',
    'OBS37', 'OBS38', 'OBS40', 'OBS41', 'OBS42', 'OBS84', 'OBS99'];
  const CANCEL = ['OBS23', 'OBS29', 'OBS30', 'OBS39'];
  const isFlow = (m) => !!(m && m.raw && m.raw.interactive && m.raw.interactive.type === 'flow');
  const isForm = (m) => isFlow(m) && /FICO/i.test(m.txt || '');
  const brief = (m) => ({ txt: (m.txt || '').slice(0, 500), btns: m.btns, img: m.img || undefined, doc: m.doc || undefined,
    flow: isFlow(m) || undefined, template: m.template || undefined, list: m.list ? m.list.rows.map((r) => r.title) : undefined });
  const UR = /[؀-ۿ]/;
  const isGate = (m) => (m.btns || []).includes('No') && /photo|lesson plan/i.test(m.txt || '');
  // Upload a classroom recording and keep the WHOLE reply group, not only its last message. The observe path
  // sends its photo gate right after the capture ack (bd-9hzdn parity port: "observe path — coach photo gate
  // sent"); on the mock lane the cassette transcribes instantly, so the gate lands ~150 ms after the ack, inside
  // upload()'s settle window, and becomes up.txt. A freshReset() after the upload then threw the gate away
  // unanswered, the analysis waited on it for ever and no FICO form came (run 20261126-2322: 16 BLOCKED,
  // OBS34/OBS29/OBS39 FAIL). freshReset BEFORE the upload, then read the group back with fresh().
  const uploadAll = async (file) => {
    await api.freshReset();
    const up = await api.upload(file, 'Audio', 180000);
    const got = await api.fresh();
    const batch = got.length ? got : [{ txt: up.txt || '', btns: up.btns || [] }];
    return { up, batch, txt: batch.map((x) => x.txt || '').join('\n'),
      ack: batch.find((x) => (x.btns || []).some((b) => /cancel/i.test(b))) || null, gate: batch.find(isGate) || null };
  };
  // Poll the chat until `stop(msg)` or the deadline. Photo / lesson-plan prompts of the capture gates
  // are answered "No" on the way when `answer` is set, so an analysis runs without fixture photos.
  const collect = async (ms, stop, answer = false) => {
    const seen = []; const t0 = Date.now(); let hit = null;
    while (Date.now() - t0 < ms) {
      for (const m of await api.fresh()) {
        seen.push(m);
        if (stop && !hit && stop(m)) hit = m;
        if (answer && isGate(m)) { await api.freshReset(); await api.tapAndWait('No', 60000); }
      }
      if (hit) return { hit, seen };
      await new Promise((r) => setTimeout(r, 2500));
    }
    return { hit, seen };
  };
  const visitMenu = async () => {
    api.closeFlow(); await api.resetFlow(); await api.freshReset();
    await api.sendWait('/observe', 120000);
    const op = await api.openFlow('.');
    return { op, p: op && op.ok ? await api.flowProbe() : { text: '', items: [] } };
  };
  const toBrief = async (schoolName, teacher) => {
    const steps = [];
    steps.push(await api.flowClick('Schedule new observation', { settleMs: 2500 }));
    const pSchool = await api.flowProbe();
    steps.push(await api.flowPick(schoolName)); steps.push(await api.flowClick('Continue', { settleMs: 2500 }));
    const pTeacher = await api.flowProbe();
    steps.push(await api.flowPick(teacher)); steps.push(await api.flowClick('Continue', { settleMs: 3000 }));
    const pBrief = await api.flowProbe();
    return { pSchool, pTeacher, pBrief, errs: steps.filter((x) => x && x.ok === false).map((x) => x.err) };
  };
  // Start an observation of `teacher` from the visit Flow, upload `audio`, answer the capture gates,
  // and return the FICO form card (or null) with everything the chat said on the way.
  const observeAndAnalyse = async (schoolName, teacher, audio) => {
    const m = await visitMenu();
    if (!m.op || !m.op.ok) return { err: 'visit Flow did not open: ' + (m.op && m.op.err) };
    const b = await toBrief(schoolName, teacher);
    if (b.errs.length) return { err: 'walk to the brief failed: ' + b.errs.join(', ') };
    await api.flowClick('Record the lesson now', { settleMs: 2500 });
    await api.flowClick('Start observation', { settleMs: 3000 });
    const armed = await api.flowComplete(60000);
    const U = await uploadAll(MEDIA + '/' + audio);
    const up = U.up;
    // The refusal for a re-sent recording comes AFTER the "got the recording" ack, and in the coach's language:
    // stop on it in either language rather than waiting the full ten minutes for a form (run 20261006-2011, OBS38).
    const REFUSED = /already been analy|پہلے ہی کیا جا چکا/;
    let got = { hit: null, seen: [] };
    if (!REFUSED.test(U.txt)) {
      // the photo gate already in the upload's reply group is answered here; later gates inside collect()
      if (U.gate) { await api.freshReset(); await api.tapAndWait('No', 60000); }
      got = await collect(600000, (x) => isForm(x) || REFUSED.test(x.txt || ''), true);
    }
    return { armed: (armed.txt || '').slice(0, 600), upload: { txt: U.txt.slice(0, 300), btns: up.btns, raw: up },
      form: got.hit && isForm(got.hit) ? got.hit : null, seen: got.seen.map(brief) };
  };
  // Open the FICO form card, optionally edit the first rating + evidence on the first scored screen,
  // and submit. Returns the screens seen, whether evidence was pre-filled, and the bot's answer.
  const submitForm = async (formMsg, { edit = false } = {}) => {
    const fo = await api.openFlow('.', { from: formMsg });
    if (!fo.ok) return { err: 'form did not open: ' + fo.err };
    const screens = []; let prefilled = false; let edited = null;
    let p = await api.flowProbe();
    for (let i = 0; i < 10 && p.screen && p.screen !== 'SUCCESS'; i++) {
      const inputs = (p.items || []).filter((x) => x.kind === 'input');
      if (inputs.some((x) => /Evidence/i.test(x.text) && x.value)) prefilled = true;
      screens.push({ screen: p.screen, title: (p.text || '').split('\n').slice(0, 3).join(' · '), filledEvidence: inputs.filter((x) => /Evidence/i.test(x.text) && x.value).length });
      if (edit && !edited && inputs.length) {
        const pk = await api.flowPick('1 · Developing');
        const ty = await api.flowType('E2E: observer edited this evidence note.', { field: 'Evidence' });
        edited = { screen: p.screen, pick: pk.ok ? pk.picked : pk.err, type: ty.ok ? 'ok' : ty.err };
      }
      const f = (p.items || []).find((x) => x.kind === 'footer');
      if (!f) break;
      const c = await api.flowClick(f.text, { settleMs: 3000 });
      if (c && c.ok === false) return { err: 'form step failed: ' + c.err, screens };
      p = await api.flowProbe();
    }
    const success = (p.text || '').slice(0, 200);
    await api.freshReset();
    if (p.screen === 'SUCCESS') await api.flowClick('Done', { settleMs: 2000 });
    const ack = await collect(90000, (m) => (m.btns || []).includes('Debrief now'));
    return { screens, prefilled, edited, success, ack: ack.hit, seen: ack.seen.map(brief) };
  };

  if (want(...SCHED, ...CHAIN, ...CANCEL, 'OBS97')) {
    s = Date.now();
    await api.setRole('coach');
    // Ayesha reads Urdu and Bilal English, the coach English: the notice must follow the TEACHER.
    const seed = await api.setRoster({ langs: ['ur', 'en'] });
    const reset = seed && seed.ok ? await api.resetObserve() : null;
    const [T1, T2] = (seed && seed.teachers) || [];
    if (!seed || !seed.ok || !reset || !reset.ok) {
      notReached([...SCHED, ...CHAIN, ...CANCEL, 'OBS97'], 'the fixture roster could not be seeded: ' + JSON.stringify({ seed, reset }).slice(0, 200));
    } else {
      const teacherApi = (t) => api.as(t.phone);
      const tA = teacherApi(T1); await tA.fresh();   // drain: notices from earlier runs are not this run's
      const tB = teacherApi(T2); await tB.fresh();

      // ── OBS03 · school → teacher → brief ──
      if (want(...SCHED)) {
        const m = await visitMenu();
        const b = m.op && m.op.ok ? await toBrief(seed.schoolName, 'Ayesha Khan') : null;
        rr('OBS03', !!b && !b.errs.length && b.pSchool.screen === 'SELECT_SCHOOL' && b.pSchool.text.includes(seed.schoolName)
            && b.pTeacher.screen === 'SELECT_TEACHER' && /Ayesha Khan/.test(b.pTeacher.text) && /Bilal Ahmed/.test(b.pTeacher.text)
            && b.pBrief.screen === 'BRIEF_SCHEDULE' && /Ayesha Khan/.test(b.pBrief.text) && b.pBrief.text.includes(seed.schoolName),
          { menu: (m.p.text || '').slice(0, 200), school: b && b.pSchool.text.slice(0, 160), teacher: b && b.pTeacher.text.slice(0, 200),
            brief: b && b.pBrief.text.slice(0, 260), errs: b && b.errs }, Date.now() - s);

        // ── OBS05 + OBS62 · save a visit; the coach is told in chat, the teacher by template ──
        if (b && b.pBrief.screen === 'BRIEF_SCHEDULE' && want('OBS04', 'OBS05', 'OBS19', 'OBS62', 'OBS63', 'OBS64')) {
          s = Date.now();
          const d = new Date(Date.now() + 86400000); while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
          const ymd = d.toISOString().slice(0, 10);
          await api.flowClick('Pick date & time', { settleMs: 2500 });
          await api.flowType(ymd, { field: 'Observation date' });
          await api.flowPick('08:30', { exact: true });
          await api.flowClick('Save schedule', { settleMs: 3000 });
          const conf = await api.flowProbe();
          await api.freshReset();
          await api.flowClick("I'm done for now", { settleMs: 2500 });
          await api.flowPick("I'm done for now", { exact: true }); await api.flowClick('Continue', { settleMs: 3000 });
          const fc = await api.flowComplete(30000);
          const ack = /Observation scheduled/i.test(fc.txt || '') ? { hit: fc } : await collect(20000, (x) => /Observation scheduled/i.test(x.txt || ''));
          rr('OBS05', /Ayesha Khan.*08:30.*E2E Observe School/s.test(conf.text || '')
              && !!ack.hit && /Observation scheduled for \*?Ayesha Khan.*08:30.*\/observe/s.test(ack.hit.txt || ''),
            { flowConfirm: (conf.text || '').slice(0, 200), chat: ack.hit && ack.hit.txt, date: ymd }, Date.now() - s);
          const n1 = await collect(15000, (x) => !!x.template);
          const tA1 = (await tA.fresh()).filter((x) => x.template);
          const t62 = tA1.find((x) => x.template.name === 'observation_visit_scheduled');
          const P = (t62 && t62.template.params) || [];
          rr('OBS62', !!t62 && /^ur/.test(t62.template.language || '') && /Ayesha/.test(P[0] || '') && (P[2] || '').includes(seed.schoolName)
              && !!P[3] && !!P[4] && UR.test(P[3] + P[4]),
            { template: t62 && t62.template, coachSawTemplate: !!n1.hit, note: 'teacher Urdu, coach English: the notice follows the teacher' });

          // ── OBS64 (path 1) · the picker again: same teacher, same date, same slot → saveSchedule ──
          await tA.fresh();
          await visitMenu();
          const bA = await toBrief(seed.schoolName, 'Ayesha Khan');
          await api.flowClick('Pick date & time', { settleMs: 2500 });
          await api.flowType(ymd, { field: 'Observation date' }); await api.flowPick('08:30', { exact: true });
          const sv1 = await api.flowClick('Save schedule', { settleMs: 3000 });
          await new Promise((r) => setTimeout(r, 4000));
          const viaPicker = (await tA.fresh()).filter((x) => x.template).map((x) => x.template.name);
          // ── OBS64 (path 2) · My schedule → the visit → Change the date or time → same values ──
          const mv = await visitMenu();
          await api.flowClick('My schedule', { settleMs: 2500 });
          await api.flowPick('Ayesha Khan'); await api.flowClick('Continue', { settleMs: 2500 });
          const act = await api.flowProbe();
          // ── OBS19 · the spec says a scheduled visit has NO cancel; with OBSERVE_OBS_ACTION on (sandbox) it does ──
          // Inverted 2026-10-06: the spec recorded a UX gap (no cancel, verified on PROD 2026-08-04). bd-88krt's
          // VISIT_ACTION screen (OBSERVE_OBS_ACTION, on in sandbox) closed it: run / change the date or time / cancel.
          rr('OBS19', act.screen === 'VISIT_ACTION' && /Cancel this visit/i.test(act.text || '') && /Change the date or time/i.test(act.text || ''),
            { screen: act.screen, offered: (act.items || []).filter((x) => x.kind === 'option').map((x) => x.text),
              note: 'the spec (verified on PROD 2026-08-04) predates bd-88krt: with OBSERVE_OBS_ACTION=true, as on the sandbox bot, VISIT_ACTION offers run / change / cancel. A FAIL here means the spec is stale, not the product broken.' });
          let resave = null;
          if (act.screen === 'VISIT_ACTION') {
            await api.flowPick('Change the date or time'); await api.flowClick('Continue', { settleMs: 2500 });
            const ed = await api.flowProbe();
            await api.flowType(ymd, { field: 'Observation date' }); await api.flowPick('08:30', { exact: true });
            const f = (ed.items || []).find((x) => x.kind === 'footer');
            const sv = f ? await api.flowClick(f.text, { settleMs: 3000 }) : { ok: false, err: 'no footer on ' + ed.screen };
            const after = await api.flowProbe();
            await new Promise((r) => setTimeout(r, 4000));
            const tA2 = (await tA.fresh()).filter((x) => x.template);
            resave = { editScreen: ed.screen, save: sv.ok ? 'ok' : sv.err, after: (after.text || '').slice(0, 160), teacherMsgs: tA2.map((x) => x.template.name) };
            rr('OBS64', viaPicker.length === 0 && tA2.length === 0,
              { viaPicker: { errs: bA.errs, save: sv1 && sv1.ok ? 'ok' : sv1 && sv1.err, teacherGot: viaPicker },
                viaChangeDateOrTime: resave,
                finding: tA2.length ? 'the "Change the date or time" path (observe-schedule.service.js rescheduleById, :209-226) sends observation_visit_rescheduled even when the date and slot are unchanged; saveSchedule guards this (:105-107) and rescheduleById does not' : undefined,
                notDriven: 'the second half (a hand-added teacher with no WhatsApp number) needs a number-less teacher, and the coach patch is derived from users rows, which always carry a phone (patch-resolver.service.js:250)' });
            // ── OBS63 · move it, then cancel it: the teacher hears both ──
            api.closeFlow(); await visitMenu();
            await api.flowClick('My schedule', { settleMs: 2500 }); await api.flowPick('Ayesha Khan'); await api.flowClick('Continue', { settleMs: 2500 });
            await api.flowPick('Change the date or time'); await api.flowClick('Continue', { settleMs: 2500 });
            const ed2 = await api.flowProbe();
            await api.flowType(ymd, { field: 'Observation date' }); await api.flowPick('10:00', { exact: true });
            const f2 = (ed2.items || []).find((x) => x.kind === 'footer'); if (f2) await api.flowClick(f2.text, { settleMs: 3000 });
            await new Promise((r) => setTimeout(r, 4000));
            const moved = (await tA.fresh()).filter((x) => x.template);
            api.closeFlow(); await visitMenu();
            await api.flowClick('My schedule', { settleMs: 2500 }); await api.flowPick('Ayesha Khan'); await api.flowClick('Continue', { settleMs: 2500 });
            await api.flowPick('Cancel this visit'); const cx = await api.flowClick('Continue', { settleMs: 3000 });
            const cxScreen = await api.flowProbe();
            const cf = (cxScreen.items || []).find((x) => x.kind === 'footer' && /cancel|yes|confirm/i.test(x.text));
            if (cf) await api.flowClick(cf.text, { settleMs: 3000 });
            await new Promise((r) => setTimeout(r, 4000));
            const cancelled = (await tA.fresh()).filter((x) => x.template);
            const mv63 = moved.find((x) => x.template.name === 'observation_visit_rescheduled');
            const cx63 = cancelled.find((x) => x.template.name === 'observation_visit_cancelled');
            rr('OBS63', !!mv63 && (mv63.template.params || []).some((p) => /10[:٫]?00|۱۰/.test(p)) && !!cx63,
              { moved: moved.map((x) => x.template), cancelled: cancelled.map((x) => x.template), cancelStep: cx && cx.ok ? 'ok' : cx && cx.err,
                cancelScreen: (cxScreen.text || '').slice(0, 160) });
          }
          notReached(['OBS19', 'OBS63', 'OBS64'], 'My schedule → the visit did not reach VISIT_ACTION');
        }
        notReached(['OBS05', 'OBS62'], 'the walk did not reach the brief');
      }

      // ── OBS97 · Start in the brief: the capture prompt names the teacher and says a recorder-app file goes as a
      //    Document (observe-strings buildVisitCapturePrompt: withName + sendAsDocument). For an ICT coach with FDE's
      //    grade 6-12 tools on (bd-pni007) the class is asked first; "Grade 1-5" keeps the FICO path. Nothing is
      //    uploaded: the armed visit is cleared by resetObserve before the chain. ──
      if (want('OBS97')) {
        s = Date.now();
        const m = await visitMenu();
        const b = m.op && m.op.ok ? await toBrief(seed.schoolName, 'Bilal Ahmed') : { errs: ['visit Flow did not open'] };
        if (b.errs.length) rb('OBS97', 'walk to the brief failed: ' + b.errs.join(', '));
        else {
          await api.flowClick('Record the lesson now', { settleMs: 2500 });
          await api.freshReset();
          await api.flowClick('Start observation', { settleMs: 3000 });
          const fc = await api.flowComplete(60000);
          const PROMPT = /record it and send me the audio/i;
          const isClass = (x) => !!(x && x.list && x.list.rows.some((r) => r.title === 'Grade 1-5'));
          const seen = [fc];
          let c = PROMPT.test(fc.txt || '') ? { hit: fc, seen: [] } : await collect(30000, (x) => PROMPT.test(x.txt || '') || isClass(x));
          seen.push(...c.seen);
          const cls = (c.hit && isClass(c.hit)) ? c.hit : (!c.hit ? seen.find(isClass) : null);
          let classAsked = null;
          if (cls) {
            const row = cls.list.rows.find((r) => r.title === 'Grade 1-5');
            classAsked = (cls.txt || '').slice(0, 160);
            await api.freshReset(); await api.tapId('list', row.id, row.title);
            c = await collect(30000, (x) => PROMPT.test(x.txt || ''));
            seen.push(...c.seen);
          }
          const ar = (c.hit && c.hit.txt) || '';
          rr('OBS97', /You're observing \*?Bilal Ahmed/.test(ar) && PROMPT.test(ar)
              && /recorder app goes as a \*?Document\*? \(📎 → \*?Document\*?\), not as audio/.test(ar) && /WhatsApp refuses audio over 16 MB/.test(ar),
            { prompt: ar, classAsked, seen: seen.filter(Boolean).map(brief) }, Date.now() - s);
          api.closeFlow(); await api.resetFlow(); await api.resetObserve();
        }
      }

      // ── the observation chain on Bilal (English) ──
      let form1 = null;
      let guideSent;   // OBS84: did "Debrief now" put a guide in the chat at all (its CONTENT is OBS09's question)
      if (want(...CHAIN, 'OBS04')) {
        s = Date.now();
        const o = await observeAndAnalyse(seed.schoolName, 'Bilal Ahmed', 'hameeda_16min.m4a');
        form1 = o.form;
        if (!form1) notReached(CHAIN, 'no FICO form arrived after the recording: ' + JSON.stringify({ err: o.err, upload: o.upload && o.upload.txt, seen: o.seen }).slice(0, 400));
        else {
          const sub = await submitForm(form1, { edit: true });
          rr('OBS07', !sub.err && sub.prefilled && sub.screens.length >= 3,
            { formCard: brief(form1), screens: sub.screens, err: sub.err }, Date.now() - s);
          const a = sub.ack;
          const at = (a && a.txt) || '';
          rr('OBS08', !!a && !!sub.edited && /saved/i.test(at) && at.search(/saved/i) < at.search(/debrief/i)
              && (a.btns || []).includes('Debrief now') && (a.btns || []).some((x) => /later/i.test(x)),
            { edited: sub.edited, success: sub.success, ack: a && brief(a), err: sub.err });
          if (!a) notReached(CHAIN, 'the form submit drew no Debrief now / Later message');
          else {
            // ── OBS14 · "Later", then /observe offers the pending debrief first ──
            await api.freshReset(); const later = await api.tapAndWait((a.btns || []).find((x) => /later/i.test(x)), 60000);
            await api.freshReset(); await api.resetFlow();
            const ob = await api.sendWait('/observe', 120000);
            const obMore = await collect(8000, null);
            const first = [ob, ...obMore.seen].filter((x) => x && (x.txt || x.list));
            const visitCard = first.find(isFlow);
            let firstRow = null; let menuText = '';
            if (visitCard) {
              const fo = await api.openFlow('.', { from: visitCard });
              if (fo.ok) { const pm = await api.flowProbe(); menuText = pm.text || ''; firstRow = ((pm.items || []).find((x) => x.kind === 'nav') || {}).text || null; }
              api.closeFlow(); await api.resetFlow();
            }
            // Offered BEFORE a new observation: the stage rows (Complete the form, Complete debriefs) sit above
            // "Schedule new observation"; "Complete the form" may come first when unfinished forms exist.
            const iDeb = menuText.search(/Complete debriefs\n\d+ pending/), iNew = menuText.search(/Schedule new observation/);
            rr('OBS14', iDeb >= 0 && (iNew < 0 || iDeb < iNew),
              { later: (later.txt || '').slice(0, 200), replies: first.map(brief), firstRow, menu: menuText.slice(0, 300),
                note: 'with OBSERVE_SCHEDULING_UI on, /observe opens the visit Flow and the pending debrief is its FIRST menu row (stage rows, bd-tju8f), ahead of scheduling a new observation' });
            // ── OBS04 · the menu counts: a pending debrief and the upcoming visit ──
            if (want('OBS04')) {
              const mm = await visitMenu();
              const t = mm.p.text || '';
              rr('OBS04', /Complete debriefs\n\d+ pending/.test(t) && /My schedule\n(\d+ upcoming|Nothing scheduled)/.test(t) && /Schedule new observation\nPick a school and teacher/.test(t),
                { menu: t.slice(0, 400), note: 'stage rows show only when their count is above zero (bd-tju8f); the upcoming count is whatever the scheduling block left' });
              api.closeFlow(); await api.resetFlow();
            }
            // ── OBS09 + OBS15 · "Debrief now" sends the guide; a second tap re-sends the stored one ──
            await api.freshReset();
            const g1 = await api.tapAndWait('Debrief now', 120000);
            guideSent = !!g1.ok && String(g1.txt || '').trim().length > 40;
            const g1more = await collect(15000, null);
            const g1msgs = g1more.seen.filter((x) => x.txt);   // includes the tap's own reply
            const paras = (g1.txt || '').trim().split(/\n\s*\n/);
            const steps = paras.filter((x) => /^(🌱|💪|📋|❓|🔒)/u.test(x.trim())).length;
            const lastPara = paras.slice(-2).join(' ');
            rr('OBS09', !!g1.ok && steps >= 6 && /record your whole conversation|voice recorder/i.test(lastPara) && g1msgs.length <= 1
                && !/\b\d{1,3}\s*\/\s*(?:148|104|4)\b|\b\d{1,3}\s*%/.test(g1.txt || ''),
              { messages: Math.max(1, g1msgs.length), steps, lastParagraph: lastPara.slice(0, 200), guide: (g1.txt || '').slice(0, 600) });
            await api.freshReset();
            const g2 = await api.tapAndWait('Debrief now', 120000);
            const g2more = await collect(15000, null);
            rr('OBS15', !!g2.ok && (g2.txt || '') === (g1.txt || '') && g2more.seen.filter((x) => x.txt).length <= 1,
              { sameGuide: (g2.txt || '') === (g1.txt || ''), extraMessages: g2more.seen.map(brief),
                note: 'no new LLM call is proven by replay-strict: a second guide generation would need its own cassette' });

            // ── OBS27 · a too-short debrief is refused and stays pending ──
            await api.freshReset();
            const sh = await api.upload(MEDIA + '/lp_request_voice.ogg', 'Audio', 180000);
            const shMore = await collect(60000, (x) => /longer|too short|record a bit more|a bit more/i.test(x.txt || ''));
            const shTxt = [sh.txt, ...shMore.seen.map((x) => x.txt)].filter(Boolean).join('\n');
            rr('OBS27', /longer|too short|a bit more/i.test(shTxt) && !/two wins|What went well/i.test(shTxt), { replies: shTxt.slice(0, 500) });

            // ── OBS10 · the respectful debrief: two wins + one try, praise as the card caption ──
            await api.freshReset();
            const dr = await api.upload(MEDIA + '/debrief/debrief_respectful.ogg', 'Audio', 180000);
            const fb = await collect(480000, (x) => !!x.img);
            const fbAll = [dr, ...fb.seen];
            const card = fb.hit;
            const fbTxt = fbAll.map((x) => x.txt || '').join('\n');
            rr('OBS10', !!card && (card.txt || '').length > 20 && !/\b\d{1,3}\s*\/\s*\d{1,3}\b|\b\d{1,3}\s*%/.test(fbTxt),
              { card: card && brief(card), messages: fbAll.map(brief), note: 'structure judged from the card + text; the two-wins/one-try split is rendered INTO the card image' });

            // ── OBS40 + OBS41 + OBS42 need a SECOND pending debrief — taken from the cancel chain below ──
            // ── OBS11 + OBS18 + OBS12 + OBS31 · send the report ──
            await api.freshReset();
            const after10 = fb.seen.concat(await collect(20000, null).then((x) => x.seen));
            const sendBtn = after10.map((x) => (x.btns || []).find((b) => /send/i.test(b))).find(Boolean);
            let sent = null;
            if (sendBtn) {
              await api.freshReset();
              const s1 = await api.tapAndWait(sendBtn, 120000);
              const s1more = await collect(120000, (x) => (x.btns || []).some((b) => /send now/i.test(b)) || !!(x.list && x.list.rows.length));
              let preview = s1more.hit;
              // The report arrives as an image message FOLLOWED by the "Above is the exact report…" text that
              // carries Send now; judge the image on the batch, not on the button message (run 20261006-1946).
              let previewBatch = s1more.seen;
              if (preview && preview.list && !(preview.btns || []).some((b) => /send now/i.test(b))) {
                const row = preview.list.rows.find((r) => /Bilal/.test(r.title));
                if (row) { await api.freshReset(); await api.pickRowAndWait(row.title, 120000); const c2 = await collect(180000, (x) => (x.btns || []).some((b) => /send now/i.test(b))); preview = c2.hit; previewBatch = c2.seen; }
              }
              // ── OBS99 · the confirm above Send now names the teacher, her number and (when on file) her school ──
              if (preview) {
                const plain = String(preview.txt || '').replace(/[\u2066-\u2069]/g, '');
                const who = (await api.rows('users', { phone_number: T2.phone })) || {};
                const onFile = who.ok && who.rows && who.rows[0] ? (who.rows[0].school_name || null) : undefined;
                const schoolOk = onFile === undefined ? true : onFile ? plain.includes('🏫 School: ' + onFile) : !/🏫 School:/.test(plain);
                const b3 = preview.btns || [];
                rr('OBS99', new RegExp('📨 To: Bilal Ahmed[^\\n]*\\(\\+?' + T2.phone + '\\)').test(plain) && schoolOk
                    && ['Send now', 'Someone else', 'Cancel'].every((x) => b3.includes(x)),
                  { confirm: plain.slice(0, 400), btns: b3, schoolOnFile: onFile === undefined ? 'not read (' + (who.notChecked || who.error || 'no row') + ')' : onFile,
                    notDriven: '"Someone else" and "Cancel" are not tapped here: this preview goes on to Send now (OBS11). "Someone else" is OBS159.' });
              }
              let delivered = null; let outcome = null;
              if (preview) {
                await api.freshReset();
                const sn = await api.tapAndWait((preview.btns || []).find((b) => /send now/i.test(b)), 180000);
                outcome = await collect(180000, (x) => /sent|deliver/i.test(x.txt || ''));
                await new Promise((r) => setTimeout(r, 5000));
                delivered = await tB.fresh();
                sent = { tap: (s1.txt || '').slice(0, 200), preview: brief(preview), sendNow: brief(sn), outcome: outcome.seen.map(brief), teacherGot: delivered.map(brief) };
              } else sent = { tap: (s1.txt || '').slice(0, 200), seen: s1more.seen.map(brief), err: 'no preview with a Send now button' };
              const tmpl = (delivered || []).find((x) => x.template);
              const img = (delivered || []).find((x) => x.img);
              rr('OBS18', !!tmpl, { teacherGot: sent.teacherGot, note: 'the fixture teacher never messaged the bot, so her 24h window is closed: the report must go as an approved template' });
              rr('OBS11', !!preview && (previewBatch || []).some((x) => x.img) && !!(delivered && delivered.length) && !!outcome && outcome.seen.some((x) => /sent|deliver/i.test(x.txt || '')),
                { ...sent, note: 'the teacher copy is checked in the teacher outbox; outside the 24h window it is a template (OBS18), so "one image" is asserted on the coach preview' });
              const teacherText = (delivered || []).map((x) => (x.txt || '') + ' ' + ((x.template && x.template.params) || []).join(' ')).join('\n');
              rr('OBS12', !!(delivered && delivered.length) && !/\b\d{1,3}\s*\/\s*(?:148|104)\b|\bscore\b|\b\d{1,3}\s*%/i.test(teacherText)
                  && !/poor|failed|bad teacher|useless/i.test(teacherText),
                { teacherText: teacherText.slice(0, 600) });
              const previewText = ((preview && preview.txt) || '') + ' ' + JSON.stringify((sent && sent.outcome) || '');
              const max = (previewText.match(/\/\s*(148|104)\b/) || [])[1];
              if (max) rr('OBS31', max === '148', { found: '/' + max, preview: previewText.slice(0, 400) });
              else rb('OBS31', 'the report total is rendered INTO the report image; the preview caption carries no "x / max" to read, and the mock lane does not OCR images', { preview: (preview && preview.txt || '').slice(0, 300) });
            }
            notReached(['OBS11', 'OBS12', 'OBS18', 'OBS31'], 'no "Send report" button after the debrief feedback: ' + JSON.stringify(after10.map(brief)).slice(0, 300));

            // ── OBS37 + OBS38 · the same classroom audio again: refused, in the COACH's language ──
            await setLang(api, 'اردو');
            await api.freshReset();
            const d1 = await observeAndAnalyse(seed.schoolName, 'Bilal Ahmed', 'hameeda_16min.m4a');
            const dupTxt = [(d1.upload && d1.upload.txt) || '', ...((d1.seen || []).map((x) => (x && x.txt) || ''))].join('\n');
            await new Promise((r) => setTimeout(r, 8000));
            const noForm = !(await api.fresh()).some(isForm);
            rr('OBS38', /اس کلاس روم ریکارڈنگ کا تجزیہ پہلے ہی کیا جا چکا ہے/.test(dupTxt),
              { reply: dupTxt, coach: 'ur', teacher: 'en (Bilal)' });
            await setLang(api, 'English');
            await api.freshReset();
            const d2 = await observeAndAnalyse(seed.schoolName, 'Bilal Ahmed', 'hameeda_16min.m4a');
            const dup2 = [(d2.upload && d2.upload.txt) || '', ...((d2.seen || []).map((x) => (x && x.txt) || ''))].join('\n');
            await new Promise((r) => setTimeout(r, 8000));
            rr('OBS37', /This classroom recording has already been analyzed\. Please submit a new recording\./.test(dup2) && noForm && !(await api.fresh()).some(isForm),
              { reply: dup2, noNewForm: noForm });
          }
        }
      }

      // ── OBS84 · the portal-observation pilot leaves a WhatsApp /observe observation as it was: the review form, the
      //    debrief, the feedback card and the send all still happen on WhatsApp. The bot reads no switch for it (only the
      //    portal reads app_settings.portal_coach_observation; a portal row is told apart by its R2 key), so the check is
      //    the WhatsApp chain itself, judged on the steps above. ──
      if (want('OBS84')) {
        // the guide is judged on arriving, not on its wording: OBS09's step count is the open spec question bd-q8wt5e.23
        const steps = { form: 'OBS07', submit: 'OBS08', feedbackCard: 'OBS10', send: 'OBS11' };
        const got = Object.fromEntries(Object.entries(steps).map(([k, id]) => [k, id + ' ' + (verdictOf[id] || 'not run')]));
        got.guideOnWhatsApp = guideSent === undefined ? 'not run' : guideSent;
        const vs = [...Object.values(steps).map((id) => verdictOf[id]), guideSent === undefined ? 'BLOCKED' : guideSent ? 'PASS' : 'FAIL'];
        if (vs.every((v) => v === 'PASS')) rr('OBS84', true, { steps: got });
        else if (vs.some((v) => v === 'FAIL')) rr('OBS84', false, { steps: got });
        else rb('OBS84', 'judged on the WhatsApp chain, and a step of it did not run', { steps: got });
      }

      // ── the cancel chain on Ayesha (Urdu): cancel, old buttons, the old form, then re-send ──
      if (want(...CANCEL, 'OBS40', 'OBS41', 'OBS42')) {
        s = Date.now();
        const m = await visitMenu();
        const b = m.op && m.op.ok ? await toBrief(seed.schoolName, 'Ayesha Khan') : { errs: ['visit Flow did not open'] };
        if (b.errs.length) notReached([...CANCEL, 'OBS40', 'OBS41', 'OBS42'], 'walk to the brief failed: ' + b.errs.join(', '));
        else {
          await api.flowClick('Record the lesson now', { settleMs: 2500 }); await api.flowClick('Start observation', { settleMs: 3000 });
          await api.flowComplete(60000);
          const U = await uploadAll(MEDIA + '/hameeda_11min.m4a');
          // collect the gate prompts WITHOUT answering, so their buttons are the old buttons OBS29 taps
          // (the photo gate is often already in the upload's reply group — see uploadAll)
          const gates = U.gate ? { seen: [] } : await collect(120000, (x) => (x.btns || []).includes('Yes') && /photo/i.test(x.txt || ''));
          const oldBtns = [];
          for (const x of [...U.batch, ...gates.seen]) {
            const raw = x.raw && x.raw.interactive;
            for (const bt of ((raw && raw.action && raw.action.buttons) || [])) oldBtns.push({ id: bt.reply.id, title: bt.reply.title });
          }
          const cancelBtn = ((U.ack && U.ack.btns) || U.up.btns || []).find((x) => /cancel/i.test(x));
          await api.freshReset();
          const cx0 = cancelBtn ? await api.tapAndWait(cancelBtn, 60000) : { ok: false, txt: '', btns: [] };
          const yes = (cx0.btns || []).find((x) => /yes/i.test(x));
          await api.freshReset();
          const cx = yes ? await api.tapAndWait(yes, 60000) : { ok: false, txt: '' };
          const cxMore = await collect(15000, null);
          const cxTxt = [cx0.txt, cx.txt, ...cxMore.seen.map((x) => x.txt)].filter(Boolean).join('\n');
          // ── OBS29 · every old button after the cancel says it was cancelled, and advances nothing ──
          const taps = [];
          for (const bt of oldBtns.filter((x) => !/cancel|okay/i.test(x.title))) {
            await api.freshReset(); await api.tapId('button', bt.id, bt.title);
            const r = await collect(20000, (x) => !!x.txt);
            taps.push({ tapped: bt.title, reply: r.hit ? (r.hit.txt || '').slice(0, 200) : null });
          }
          const flowAfter = (await collect(20000, isForm)).hit;
          rr('OBS29', taps.length > 0 && taps.every((t) => t.reply && /cancel/i.test(t.reply)) && !flowAfter,
            { cancel: cxTxt.slice(0, 300), taps, formAfterCancel: !!flowAfter });
          rb('OBS30', 'needs a FICO form that was SENT before the cancel; the cancel here lands while the gate prompts are open, before any form exists. A form-then-cancel needs the cancel button on a message after the form, which the flow does not offer (the only cancel is on the capture ack).',
            { cancel: cxTxt.slice(0, 200) });
          // ── OBS39 · the same recording after a cancel is analysed normally ──
          await api.freshReset();
          const again = await observeAndAnalyse(seed.schoolName, 'Ayesha Khan', 'hameeda_11min.m4a');
          const aTxt = (again.upload && again.upload.txt) || '';
          rr('OBS39', /Got the recording|listening now/i.test(aTxt) && !/already been analy/i.test(aTxt) && !!again.form,
            { reply: aTxt.slice(0, 200), formArrived: !!again.form, err: again.err });
          if (!again.form) notReached(['OBS23', 'OBS40', 'OBS41', 'OBS42'], 'no FICO form for the second observation');
          else {
            const sub2 = await submitForm(again.form);
            if (!sub2.ack) notReached(['OBS23', 'OBS40', 'OBS41', 'OBS42'], 'the second form drew no Debrief now message');
            else {
              await api.freshReset(); await api.tapAndWait('Debrief now', 120000);
              // ── OBS41 + OBS40 · the already-coached respectful debrief, sent for THIS observation ──
              await setLang(api, 'اردو');
              await api.freshReset();
              const dd = await api.upload(MEDIA + '/debrief/debrief_respectful.ogg', 'Audio', 120000);
              const ddMore = await collect(30000, null);
              const ddTxt = [dd.txt, ...ddMore.seen.map((x) => x.txt)].filter(Boolean).join('\n');
              rr('OBS41', /اس ڈی بریف ریکارڈنگ کا تجزیہ پہلے ہی کیا جا چکا ہے/.test(ddTxt), { reply: ddTxt.slice(0, 300) });
              await setLang(api, 'English');
              await api.freshReset();
              const dd2 = await api.upload(MEDIA + '/debrief/debrief_respectful.ogg', 'Audio', 120000);
              const dd2More = await collect(30000, null);
              const dd2Txt = [dd2.txt, ...dd2More.seen.map((x) => x.txt)].filter(Boolean).join('\n');
              rr('OBS40', /This debrief recording has already been analyzed\./.test(dd2Txt) && !dd2More.seen.some((x) => x.img),
                { reply: dd2Txt.slice(0, 300), card: dd2More.seen.some((x) => x.img) });
              // ── OBS42 · the too-short recording (never coached) is analysed normally when re-sent ──
              await api.freshReset();
              const rs = await api.upload(MEDIA + '/lp_request_voice.ogg', 'Audio', 120000);
              const rsMore = await collect(60000, (x) => /longer|too short|a bit more/i.test(x.txt || ''));
              const rsTxt = [rs.txt, ...rsMore.seen.map((x) => x.txt)].filter(Boolean).join('\n');
              rr('OBS42', !/already been analy/i.test(rsTxt) && rsTxt.length > 0, { reply: rsTxt.slice(0, 300),
                note: 'it is judged again (too short again), not refused as already analysed' });
              // ── OBS23 · the harmful debrief: a concern, no praise, no card ──
              await api.freshReset();
              const hd = await api.upload(MEDIA + '/debrief/debrief_harmful.ogg', 'Audio', 180000);
              // the concern's heading is observe-strings coach_concern_title (en / ur / sw); the older words stay as a fallback
              const CONCERN = /Something worth naming|کھل کر کہنے کی بات|Jambo la kuzungumza kwa uwazi|concern|respect|harm|careful/i;
              const hdMore = await collect(300000, (x) => CONCERN.test(x.txt || '') && !/Got|listening/i.test(x.txt || ''));
              await new Promise((r) => setTimeout(r, 15000));
              const hdTail = (await api.fresh());
              const hdAll = [hd, ...hdMore.seen, ...hdTail];
              rr('OBS23', !!hdMore.hit && !hdAll.some((x) => x.img) && !/well done|great job|two wins|What went well/i.test(hdAll.map((x) => x.txt || '').join('\n')),
                { messages: hdAll.map(brief) });
            }
          }
        }
      }
    }
  }

  // ── not drivable here, each with the evidence that says why ──
  rb('OBS13', 'the published FICO Flow sets no refresh_on_back on any screen (fixtures/flows/OBSERVE_MEWAKA_FLOW_ID.json: DOMAIN_B/C/D/F), so WhatsApp handles BACK on the phone and never calls the endpoint; the endpoint re-serve from the Redis edit buffer this scenario describes cannot be triggered by any client');
  rb('OBS16', "needs a send with an EMPTY roster: the report send asks for the teacher only when the observation is unbound and the coach's legacy users.preferences.observe_teachers is empty; this driver's coach has a fixture roster, and an unbound observation would have to be carried through form + debrief first");
  rb('OBS17', 'needs a school with more than 18 teachers; the fixture roster seeds two, and seeding 19+ persistent teacher users per driver into the shared sandbox users table was judged not worth the pollution');
  rb('OBS24', "needs a FICO form token naming ANOTHER leader's session; the emulator only opens the token the bot sent this driver, and minting one for another coach's observation would mean fabricating a session for a second leader");
  notReached([...SCHED, ...CHAIN, ...CANCEL, 'OBS97'], 'not selected or an earlier step stopped');

  // ── unbound captures: each starts from a clean slate (resetObserve), so the duplicate guard never
  //    mistakes one scenario's fixture upload for another's ──
  const LONG = 'hameeda_15min_alt.m4a';
  if (want('OBS06', 'OBS35', 'OBS25', 'OBS148')) {
    s = Date.now();
    await api.setRole('coach'); await api.resetObserve(); await api.resetFlow(); await api.freshReset();
    const up = await api.upload(MEDIA + '/' + LONG, 'Audio', 180000);
    const upTxt = up.txt || '';
    const noYesNo = !(up.btns || []).some((b) => /Yes,?\s*Analyze/i.test(b));
    rec('OBS06', "A leader's recording is captured without a Yes/No confirmation",
        ...V(up.ok && CAPTURED.test(upTxt) && noYesNo,
          { captured: CAPTURED.test(upTxt), noYesNo, reply: upTxt.slice(0, 160), btns: (up.btns || []).slice(0, 4) }), Date.now() - s);
    rec('OBS35', 'A leader recording with nothing declared is still asked whose it is',
        ...V(up.ok && /Whose observation is this|Pick the teacher/i.test(upTxt),
          { reply: upTxt.slice(0, 160) }), 0);
    rec('OBS25', "A leader's long audio with no active state never starts teacher coaching",
        ...V(up.ok && CAPTURED.test(upTxt) && !COACHING.test(upTxt),
          { wentToObserve: CAPTURED.test(upTxt), notCoaching: !COACHING.test(upTxt), reply: upTxt.slice(0, 160) }), 0);
    // OBS148: this coach has only ever run classic /observe (the chain above, or nothing), so record-first
    // (observe2/capture-link.js holdRecording, "💾 Saved: your … recording") must NOT take the recording.
    const rest148 = await api.fresh();
    const all148 = [upTxt, ...rest148.map((m) => m.txt || '')].join('\n');
    rec('OBS148', 'Record first is for /observe2 coaches; a coach on classic /observe still gets "whose observation is this?"',
        ...V(up.ok && /Whose observation is this/i.test(all148) && !/Saved: your .*recording, as one visit/i.test(all148),
          { reply: all148.slice(0, 300), btns: (up.btns || []).slice(0, 6), list: rest148.filter((m) => m.list).map((m) => m.list.rows.map((r) => r.title)),
            notDriven: 'no visit is booked at this point, so "scheduled teachers at the top" is not ordered here (OBS35 / the chain cover the list)' }), 0);
  }

  if (want('OBS36')) {
    // A coach taps an old "Classroom Coaching" row (refused), then sends a long recording: it is an observation.
    s = Date.now();
    await api.setRole('coach'); await api.resetObserve(); await api.resetFlow(); await api.freshReset();
    const tap = await api.injectList('menu_coaching', 'Classroom Coaching');
    const up = await api.upload(MEDIA + '/' + LONG, 'Audio', 180000);
    rec('OBS36', 'A coach never reaches her own Digital Coach, even after tapping an old DC row',
        ...V(up.ok && /Whose observation is this/i.test(up.txt || '') && !COACHING.test(up.txt || ''),
          { tapReply: (tap.txt || '').slice(0, 160), reply: (up.txt || '').slice(0, 200) }), Date.now() - s);
  }

  if (want('OBS34')) {
    // A principal who started an observation and picked a teacher: her recording is that OBSERVATION.
    s = Date.now();
    await api.setRole('principal');
    const seed = await api.setRoster({ langs: ['ur', 'en'] }); await api.resetObserve();
    let ev = { seed: seed && seed.ok };
    let ok = false;
    if (seed && seed.ok) {
      api.closeFlow(); await api.resetFlow(); await api.freshReset();
      await api.sendWait('/observe', 120000);
      const op = await api.openFlow('Plan my visit|plan your visit|Observe|Open');
      if (op && op.ok) {
        await api.flowClick('Schedule new observation', { settleMs: 2500 });
        await api.flowPick(seed.schoolName); await api.flowClick('Continue', { settleMs: 2500 });
        await api.flowPick('Bilal Ahmed'); await api.flowClick('Continue', { settleMs: 3000 });
        await api.flowClick('Record the lesson now', { settleMs: 2500 }); await api.flowClick('Start observation', { settleMs: 3000 });
        const armed = await api.flowComplete(60000);
        // the whole reply group: the capture ack is followed by the observe path's photo gate (see uploadAll)
        const U = await uploadAll(MEDIA + '/' + LONG);
        ok = /observing \*?Bilal/i.test(armed.txt || '') && /Got the recording|FICO/i.test(U.txt) && !COACHING.test(U.txt) && !/Whose observation/i.test(U.txt);
        ev = { ...ev, armed: (armed.txt || '').slice(0, 160), reply: U.txt.slice(0, 300) };
      } else ev.err = 'visit Flow did not open: ' + (op && op.err);
    }
    rec('OBS34', 'A principal who HAS started an observation still captures it as an observation', ...V(ok, ev), Date.now() - s);
    api.closeFlow(); await api.resetFlow();
  }

  if (want('OBS33')) {
    // A principal's OWN lesson via /menu → Classroom Coaching: Digital Coach, never the binding list.
    s = Date.now();
    await api.setRole('principal'); await api.resetObserve(); await api.resetFlow(); await api.freshReset();
    // OBS34 just left an analysis in flight, and the in-flight guard also counts the principal's OWN coaching
    // sessions, which resetObserve does not touch: the upload drew "I'm still analysing your previous recording"
    // (run 20261006-2306). Clear them the way coaching-ext does.
    try { api.db('cancel-stuck'); api.db('reset-history'); } catch (_) {}
    await api.sendWait('/menu');
    await api.openList('See what I do');
    const dc = await api.pickRowAndWait('Classroom Coaching');
    const up = await api.upload(MEDIA + '/' + LONG, 'Audio', 180000);
    const more = (await api.fresh()).map((m) => m.txt || '').join('\n');
    const all = [up.txt || '', more].join('\n');
    rec('OBS33', "A principal's OWN lesson recording reaches Digital Coach, not the binding list",
        ...V(up.ok && !/Whose observation is this/i.test(all) && !/You're observing/i.test(all) && (COACHING.test(all) || (up.btns || []).some((b) => /Yes,?\s*Analyze/i.test(b))),
          { dcPrompt: (dc.txt || '').slice(0, 160), reply: (up.txt || '').slice(0, 200), btns: up.btns }), Date.now() - s);
    await api.resetFlow();
  }

  // ── OBS100 / OBS101 · a principal's SECOND recording after her own lesson went to Classroom Coaching ──
  //    COACHING_RECORDING_ENDS_WAIT (default on): the first recording ends the six-hour Classroom Coaching wait, so the
  //    second is asked "whose"; off, the wait stands and the second goes to her own coaching again. Switched with
  //    stack-control.restart, as OBS21 switches its gate.
  if (want('OBS100', 'OBS101')) {
    const N100 = "A principal's second recording after their own lesson was coached is asked whose it is";
    const N101 = "With COACHING_RECORDING_ENDS_WAIT off a principal's second recording goes straight to their own coaching again";
    const twoRecordings = async () => {
      await api.setRole('principal'); await api.resetObserve(); await api.resetFlow(); await api.freshReset();
      try { api.db('cancel-stuck'); api.db('reset-history'); } catch (_) {}
      await api.sendWait('/menu'); await api.openList('See what I do');
      const dc = await api.pickRowAndWait('Classroom Coaching');
      await api.freshReset();
      const up1 = await api.upload(MEDIA + '/' + LONG, 'Audio', 180000);
      const yes = (up1.btns || []).find((b) => /Yes,?\s*Analy[sz]e/i.test(b));
      let yesTap = null;
      if (yes) { await api.freshReset(); yesTap = await api.tapAndWait(yes, 60000); }
      const first = [up1.txt || '', (yesTap && yesTap.txt) || '', ...(await api.fresh()).map((m) => m.txt || '')].join('\n');
      // the first analysis is still in flight; the in-flight guard would answer the second upload "still analysing"
      // whatever the wait said, so it is cleared the way OBS33 clears it before the second recording
      await new Promise((r) => setTimeout(r, 5000));
      try { api.db('cancel-stuck'); } catch (_) {}
      await api.freshReset();
      const up2 = await api.upload(MEDIA + '/hameeda_16min.m4a', 'Audio', 180000);
      const more2 = await api.fresh();
      const second = [up2.txt || '', ...more2.map((m) => m.txt || '')].join('\n');
      const choices = [...(up2.btns || []), ...more2.flatMap((m) => [...(m.btns || []), ...(m.list ? m.list.rows.map((r) => r.title) : [])])];
      return { dc: (dc.txt || '').slice(0, 120), firstWentToCoaching: COACHING.test(first) || !!yes, first: first.slice(0, 200),
        second: second.slice(0, 300), choices, asked: /Whose observation is this/i.test(second),
        own: COACHING.test(second) || (up2.btns || []).some((b) => /Yes,?\s*Analy[sz]e/i.test(b)) };
    };
    if (want('OBS100')) {
      s = Date.now();
      const t = await twoRecordings();
      rec('OBS100', N100, ...(t.firstWentToCoaching
        ? V(t.asked && t.choices.some((c) => /My own lesson/i.test(c)), t)
        : ['BLOCKED', { reason: 'the first recording did not go to Classroom Coaching, so the precondition never held', ...t }]), Date.now() - s);
    }
    if (want('OBS101')) {
      s = Date.now();
      let stack = null; try { stack = require(require('path').join(__dirname, '..', '..', 'engine', 'bin', 'stack-control.cjs')); } catch (_) {}
      if (!stack || !stack.runDir || !stack.runDir()) rec('OBS101', N101, 'BLOCKED', { reason: 'no RUN_DIR: COACHING_RECORDING_ENDS_WAIT is switched by stack-control.restart, which needs the mock stack' }, 0);
      else {
        const off = await stack.restart('bot', { COACHING_RECORDING_ENDS_WAIT: 'off' });
        let t = null;
        try { if (off && off.ok) t = await twoRecordings(); } finally { await stack.restart('bot', {}); }
        rec('OBS101', N101, ...(!off || !off.ok ? ['BLOCKED', { reason: 'stack-control.restart(bot) failed: ' + JSON.stringify(off).slice(0, 160) }]
          : !t.firstWentToCoaching ? ['BLOCKED', { reason: 'the first recording did not go to Classroom Coaching, so the precondition never held', ...t }]
            : V(!t.asked && t.own, t)), Date.now() - s);
      }
    }
    await api.resetFlow();
  }

  if (want('OBS21')) {
    // The capability gate OFF: restart the bot without OBSERVE_MEWAKA_FLOW_ID, send /observe, restore.
    s = Date.now();
    let stack = null; try { stack = require(require('path').join(__dirname, '..', '..', 'engine', 'bin', 'stack-control.cjs')); } catch (_) {}
    if (!stack || !stack.runDir || !stack.runDir()) {
      rec('OBS21', '/observe is inert when the observation Flow is not configured', 'BLOCKED', { reason: 'no RUN_DIR: the gate is switched by stack-control.restart, which needs the mock stack' }, 0);
    } else {
      await api.setRole('coach');
      const off = await stack.restart('bot', { OBSERVE_MEWAKA_FLOW_ID: '' });
      let r = { txt: '' };
      if (off && off.ok) { api.resetConversation(); await api.freshReset(); r = await api.sendWait('/observe', 120000); }
      const on = await stack.restart('bot', {});
      rec('OBS21', '/observe is inert when the observation Flow is not configured',
          ...(off && off.ok
            ? V(!!r.ok && !!(r.txt || '').trim() && !DENIED.test(r.txt || '') && !ENTRY.test(r.txt || '') && !/Plan my visit/.test((r.btns || []).join(' ')),
                { reply: (r.txt || '').slice(0, 200), btns: r.btns, restored: !!(on && on.ok) })
            : ['BLOCKED', { reason: 'stack-control.restart(bot) failed: ' + JSON.stringify(off).slice(0, 160) }]), Date.now() - s);
    }
  }

  // ── /school card: the School card's WhatsApp door (OBS73-75). Its switch (portal_coach_school_card) and the coach
  //    app's (portal_coach_v2) are GLOBAL app_settings rows, so they are flipped only where api.setAppSetting allows it:
  //    the run's own local database. The coach's school is the driver's seeded roster school (EMIS E2EOBS<driver>). ──
  if (want('OBS73', 'OBS74', 'OBS75')) {
    const SC_ONE = /School card for \*(.+?)\* is ready\./;
    const SC_SCHOOLS = /Pick a school in My schools to see its card\./;
    const SC_ANY = /School card for|Pick a school in My schools|سکول کارڈ تیار ہے|میرے سکول میں سے/;
    // One turn: the items it sent, the Open buttons among them, and where each button's link lands (read the way
    // /go reads it, with the bot's own key from the run's .env).
    const turn = async (text) => {
      await api.resetFlow(); await api.freshReset();
      const r = await api.sendWait(text, 120000);
      const items = await api.fresh();
      const ctas = items.map((i) => i.cta).filter((c) => c && c.url);
      return { r, items, ctas, land: ctas[0] ? landingOfLink(ctas[0].url) : null,
        txt: items.map((i) => i.txt || '').join('\n'), lists: items.filter((i) => i.list || /flow/i.test(String(i.type || ''))).length };
    };
    const shape = (t) => ({ sends: t.items.length, button: t.ctas[0] ? t.ctas[0].text : null, lists: t.lists,
      link: t.ctas[0] ? t.ctas[0].url.replace(/\/go\/.*/, '/go/<token>') : null, landing: t.land, reply: t.txt.slice(0, 160) });
    s = Date.now();
    await api.setRole('coach');
    const seed = await api.setRoster({});
    const emis = seed && seed.ok ? String(seed.schoolExtId || '').split(':').pop() : null;
    let flip = !emis ? { ok: false, err: 'roster seed failed: ' + JSON.stringify(seed).slice(0, 120) }
      : (typeof api.setAppSetting === 'function' ? await api.setAppSetting('portal_coach_school_card', true) : { ok: false, err: 'GLOBAL_SWITCH: this lane cannot flip app_settings' });
    if (flip.ok) flip = await api.setAppSetting('portal_coach_v2', true);
    if (!flip.ok) {
      const why = { reason: 'needs portal_coach_school_card and portal_coach_v2 turned on, both GLOBAL app_settings rows: flipped only on the run\'s own local database (E2E_LOCAL_DB=1). Covered by tests/app-redirect/app-link-coach-school-card*.test.js (red-first). ' + String(flip.err || '').slice(0, 120) };
      rec('OBS73', 'A coach on the School card gets one Open button for the school she names by EMIS', 'BLOCKED', why, 0);
      rec('OBS74', 'A coach who names none of her schools gets one Open button for My schools', 'BLOCKED', why, 0);
      rec('OBS75', 'With the School card off, "/school card" is answered exactly as any other message', 'BLOCKED', why, 0);
    } else {
      try {
        if (want('OBS73')) {
          const t = await turn('/school card ' + emis);
          const m = SC_ONE.exec(t.txt);
          rec('OBS73', 'A coach on the School card gets one Open button for the school she names by EMIS',
              ...V(t.r.ok && t.items.length === 1 && t.ctas.length === 1 && t.ctas[0].text === 'Open' && t.lists === 0
                && !!m && m[1] === seed.schoolName && !!t.land && t.land.page === '/portal/coach/school/' + emis,
                { emis, school: seed.schoolName, ...shape(t) }), Date.now() - s);
        }
        if (want('OBS74')) {
          s = Date.now();
          const none = await turn('/school card zzqx wvut');
          const bare = await turn('/school card');
          const ok1 = (t) => t.r.ok && t.items.length === 1 && t.ctas.length === 1 && t.ctas[0].text === 'Open' && t.lists === 0
            && SC_SCHOOLS.test(t.txt) && !!t.land && t.land.page === '/portal/coach/people';
          rec('OBS74', 'A coach who names none of her schools gets one Open button for My schools',
              ...V(ok1(none) && ok1(bare), { noMatch: shape(none), noQuery: shape(bare) }), Date.now() - s);
        }
        if (want('OBS75')) {
          s = Date.now();
          await api.setAppSetting('portal_coach_school_card', false);
          const t = await turn('/school card ' + emis);
          rec('OBS75', 'With the School card off, "/school card" is answered exactly as any other message',
              ...V(t.r.ok && t.ctas.length === 0 && !SC_ANY.test(t.txt) && t.txt.trim().length > 0, { emis, ...shape(t) }), Date.now() - s);
        }
      } finally {
        await api.restoreAppSettings();
      }
    }
    await api.resetFlow();
  }

  // ── /observe2 (OBS105-OBS110, OBS161, OBS162). FEATURE_GATES.observe2 needs OBSERVE2_FIELD_FORM_FLOW_ID,
  //    OBSERVE2_CHECK_FLOW_ID and OBSERVE_VISIT_FLOW_ID; the lane sets only the last, so /observe2 is plain text here
  //    (OBS162) until the bot is restarted with the two ids. Placeholders are enough for what is driven below: the
  //    planner is the /observe visit Flow (stored), the period list is a chat list, and the live form is a Flow
  //    MESSAGE the mock Graph API accepts whatever its id. Opening the field form or the check needs their stored
  //    FLOW_JSON, which the lane does not have (see OBSERVE2_FLOW below). ──
  const ctaOf = (m) => { const a = m && m.raw && m.raw.interactive && m.raw.interactive.action; return (a && a.parameters && a.parameters.flow_cta) || ((m && m.btns) || [])[0] || null; };
  const O2N = {
    OBS105: "A coach's /observe2 opens the visit planner",
    OBS106: 'A visit scheduled from /observe2 points back to /observe2',
    OBS107: 'After Start, the coach chooses the period length',
    OBS108: 'A Friday period of 25 minutes runs the form to minute 25',
    OBS109: 'A period button sent before the list still opens the form',
    OBS110: 'The period button sends the live form with the steps before the lesson',
    OBS161: "A teacher's /observe2 is refused",
  };
  if (want('OBS162')) {
    s = Date.now();
    await api.setRole('coach'); api.closeFlow(); await api.resetFlow(); await api.freshReset();
    const r = await api.sendWait('/observe2', 120000);
    const items = await api.fresh();
    const txt = items.map((m) => m.txt || '').join('\n') || (r.txt || '');
    rec('OBS162', '/observe2 is plain text where its Flows are not configured',
        ...V(!!r.ok && !!txt.trim() && !items.some(isFlow) && !/plan the \/observe2 visit|for coaches and school leaders|How long is this period/i.test(txt),
          { reply: txt.slice(0, 240), flows: items.filter(isFlow).length, lane: 'OBSERVE2_FIELD_FORM_FLOW_ID / OBSERVE2_CHECK_FLOW_ID unset (local-lane.env)' }), Date.now() - s);
  }
  if (want(...Object.keys(O2N))) {
    const o2 = (id, verdict, ms = 0) => rec(id, O2N[id], verdict[0], verdict[1], ms);
    const o2b = (ids, reason) => { for (const id of ids) if (want(id)) o2(id, ['BLOCKED', { reason }]); };
    let stack = null; try { stack = require(require('path').join(__dirname, '..', '..', 'engine', 'bin', 'stack-control.cjs')); } catch (_) {}
    if (!stack || !stack.runDir || !stack.runDir()) o2b(Object.keys(O2N), 'no RUN_DIR: /observe2 is switched on by stack-control.restart, which needs the mock stack');
    else {
      const on = await stack.restart('bot', { OBSERVE2_FIELD_FORM_FLOW_ID: 'e2e-observe2-form', OBSERVE2_CHECK_FLOW_ID: 'e2e-observe2-check' });
      try {
        if (!on || !on.ok) o2b(Object.keys(O2N), 'stack-control.restart(bot) with the /observe2 Flow ids failed: ' + JSON.stringify(on).slice(0, 160));
        else {
          if (want('OBS161')) {
            s = Date.now();
            await api.setRole('teacher'); api.closeFlow(); await api.resetFlow(); await api.freshReset();
            const r = await api.sendWait('/observe2', 120000);
            const items = await api.fresh();
            const txt = items.map((m) => m.txt || '').join('\n') || (r.txt || '');
            o2('OBS161', V(/\/observe2 is for coaches and school leaders\./.test(txt) && !items.some(isFlow), { reply: txt.slice(0, 200), flows: items.filter(isFlow).length }), Date.now() - s);
          }
          await api.setRole('coach');
          const seed = await api.setRoster({ langs: ['ur', 'en'] });
          if (!seed || !seed.ok) o2b(['OBS105', 'OBS106', 'OBS107', 'OBS108', 'OBS109', 'OBS110'], 'the fixture roster could not be seeded: ' + JSON.stringify(seed).slice(0, 160));
          else {
            await api.resetObserve();
            const planner = async () => {
              api.closeFlow(); await api.resetFlow(); await api.freshReset();
              await api.sendWait('/observe2', 120000);
              const items = await api.fresh();
              return { card: items.find(isFlow) || null, items };
            };
            s = Date.now();
            const p1 = await planner();
            if (want('OBS105')) {
              o2('OBS105', V(!!p1.card && /Let's plan the \/observe2 visit\. Pick a school, then a teacher\./.test(p1.card.txt || '') && ctaOf(p1.card) === 'Plan my visit',
                { card: p1.card ? { txt: p1.card.txt, cta: ctaOf(p1.card) } : null, replies: p1.items.map(brief) }), Date.now() - s);
            }
            // ── OBS106 · schedule a visit from the /observe2 planner: the chat ack names /observe2 ──
            if (want('OBS106')) {
              s = Date.now();
              const op = p1.card ? await api.openFlow('.', { from: p1.card }) : { ok: false, err: 'no planner card' };
              const b = op.ok ? await toBrief(seed.schoolName, 'Ayesha Khan') : { errs: ['planner did not open: ' + op.err] };
              let ack = null; let conf = null;
              if (!b.errs.length) {
                const d = new Date(Date.now() + 2 * 86400000); while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
                await api.flowClick('Pick date & time', { settleMs: 2500 });
                await api.flowType(d.toISOString().slice(0, 10), { field: 'Observation date' });
                await api.flowPick('09:00', { exact: true });
                await api.flowClick('Save schedule', { settleMs: 3000 });
                conf = await api.flowProbe();
                await api.freshReset();
                await api.flowClick("I'm done for now", { settleMs: 2500 });
                await api.flowPick("I'm done for now", { exact: true }); await api.flowClick('Continue', { settleMs: 3000 });
                const fc = await api.flowComplete(30000);
                ack = /Observation scheduled/i.test(fc.txt || '') ? fc : (await collect(20000, (x) => /Observation scheduled/i.test(x.txt || ''))).hit;
              }
              o2('OBS106', V(!!ack && /Observation scheduled for \*?Ayesha Khan/.test(ack.txt || '') && /Tap \/observe2 anytime to see your schedule/.test(ack.txt || ''),
                { errs: b.errs, flowConfirm: conf && (conf.text || '').slice(0, 160), chat: ack && ack.txt }), Date.now() - s);
              api.closeFlow(); await api.resetObserve();
            }
            // ── OBS107-OBS110 · Start from the /observe2 brief: the period list, then the live form per period ──
            if (want('OBS107', 'OBS108', 'OBS109', 'OBS110')) {
              s = Date.now();
              const p2 = want('OBS106') || !p1.card ? await planner() : p1;
              const op = p2.card ? await api.openFlow('.', { from: p2.card }) : { ok: false, err: 'no planner card' };
              const b = op.ok ? await toBrief(seed.schoolName, 'Bilal Ahmed') : { errs: ['planner did not open: ' + op.err] };
              if (b.errs.length) o2b(['OBS107', 'OBS108', 'OBS109', 'OBS110'], 'walk to the /observe2 brief failed: ' + b.errs.join(', '));
              else {
                await api.flowClick('Record the lesson now', { settleMs: 2500 });
                await api.freshReset();
                await api.flowClick('Start observation', { settleMs: 3000 });
                const fc = await api.flowComplete(60000);
                const got = await collect(30000, (x) => !!x.list);
                const all = [fc, ...got.seen].filter((x) => x && (x.txt || x.list));
                const listMsg = got.hit;
                const rows = listMsg ? listMsg.list.rows : [];
                const allTxt = all.map((x) => x.txt || '').join('\n');
                o2('OBS107', V(!!listMsg && /You're observing \*?Bilal Ahmed[^*]*\*?\. How long is this period\?/.test(listMsg.txt || '')
                    && JSON.stringify(rows.map((r) => r.title)) === JSON.stringify(['25 minutes', '30 minutes', '35 minutes', '40 minutes'])
                    && !/record it and send me the audio/i.test(allTxt),
                  { ask: listMsg && listMsg.txt, rows: rows.map((r) => r.title), others: all.map(brief) }), Date.now() - s);
                const rowId = (m) => (rows.find((r) => r.title === m + ' minutes') || {}).id;
                // the live form for a period: its body and the "Open the form" Flow message
                // bd-pni007: with FDE's grade 6-12 tools on for an ICT coach (obs612_coach / FICO-S, on for every coach on
                // the lane) the class is asked once, before any form. "Grade 1-5" keeps the FICO live form these
                // scenarios are about; the class question is recorded in the evidence, it is not what they test.
                let classAsked = null;
                const liveForm = async (tap) => {
                  await api.freshReset(); await tap();
                  const isLive = (x) => isFlow(x) && /^Before the lesson starts:/.test(x.txt || '');
                  let c = await collect(30000, (x) => isLive(x) || !!(x.list && x.list.rows.some((r) => r.title === 'Grade 1-5')));
                  const seen = c.seen.map(brief);
                  if (c.hit && !isLive(c.hit)) {
                    const row = c.hit.list.rows.find((r) => r.title === 'Grade 1-5');
                    classAsked = (c.hit.txt || '').slice(0, 160);
                    await api.freshReset(); await api.tapId('list', row.id, row.title);
                    c = await collect(30000, isLive);
                    seen.push(...c.seen.map(brief));
                  }
                  return { form: c.hit, seen, classAsked };
                };
                const minuteOk = (f, n) => !!f && ctaOf(f) === 'Open the form' && new RegExp('until minute ' + n + '\\.').test(f.txt || '');
                if (want('OBS108')) {
                  s = Date.now();
                  const r = rowId(25) ? await liveForm(() => api.tapId('list', rowId(25), '25 minutes')) : { form: null, seen: [], err: 'no "25 minutes" row' };
                  o2('OBS108', V(minuteOk(r.form, 25), { form: r.form && { txt: r.form.txt, cta: ctaOf(r.form) }, seen: r.seen, classAsked: r.classAsked, err: r.err }), Date.now() - s);
                }
                if (want('OBS109')) {
                  // the older message's three reply BUTTONS carried the same obs2_period:<form>:<minutes> ids the rows carry
                  s = Date.now();
                  const r = rowId(30) ? await liveForm(() => api.tapId('button', rowId(30), '30 minutes')) : { form: null, seen: [], err: 'no "30 minutes" row' };
                  o2('OBS109', V(minuteOk(r.form, 30), { tapped: 'button ' + rowId(30), form: r.form && { txt: r.form.txt, cta: ctaOf(r.form) }, seen: r.seen, classAsked: r.classAsked, err: r.err }), Date.now() - s);
                }
                if (want('OBS110')) {
                  s = Date.now();
                  const r = rowId(40) ? await liveForm(() => api.tapId('list', rowId(40), '40 minutes')) : { form: null, seen: [], err: 'no "40 minutes" row' };
                  const t = (r.form && r.form.txt) || '';
                  o2('OBS110', V(minuteOk(r.form, 40) && /voice recorder app\*? \(not WhatsApp\)/.test(t)
                      && /keeps recording while you take photos; a WhatsApp voice note stops when the camera opens/.test(t)
                      && /Part 1 is up to and including guided practice: save it when the children start independent practice/.test(t)
                      && /Upload saved photos/.test(t) && /Take photos with the phone's camera/.test(t)
                      && /send the recording here as a \*?Document\*? \(📎 → \*?Document\*?\), not as audio\.?$/.test(t.trim()),
                    { form: t, cta: r.form && ctaOf(r.form), seen: r.seen, classAsked: r.classAsked, err: r.err }), Date.now() - s);
                }
              }
              api.closeFlow();
            }
          }
        }
      } finally {
        await stack.restart('bot', {});
        await api.resetFlow();
      }
    }
  }

  // ── Edit a teacher from the portal (OBS86-OBS90). The coach app's Save is a call to the bot's
  //    POST /api/internal/observe/teacher-edit (internal-api.routes.js, run as the coach), and every outcome the
  //    scenarios name — saved, cooldown with the hours left, free / shell / taken, not_found — is in its answer and in
  //    the database. The lane runs no portal, so the call is made here with the bot's own key, and the screen is the
  //    answer the portal prints (TAKEN heading, hoursRemaining); the portal's own copy lines are noted, not judged.
  //    Ayesha is edited; her name, role and number are put back at the end (setRoster + a move back). ──
  const EDIT_N = {
    OBS86: 'A coach renames a teacher, sets her teaching levels and her role from the portal',
    OBS87: 'Teaching level is Primary, Middle or High, and cannot change twice within 48 hours',
    OBS88: "A teacher's new number is checked before it is changed",
    OBS89: 'A number that belongs to a teacher with history is refused',
    OBS90: "A teacher outside the coach's patch cannot be edited",
  };
  if (want(...Object.keys(EDIT_N))) {
    const recE = (id, verdict) => { if (want(id)) rec(id, EDIT_N[id], verdict[0], verdict[1], Date.now() - s); };
    const blockAll = (reason) => { for (const id of Object.keys(EDIT_N)) recE(id, ['BLOCKED', { reason }]); };
    s = Date.now();
    const env = stackEnv();
    let stack = null; try { stack = require(require('path').join(__dirname, '..', '..', 'engine', 'bin', 'stack-control.cjs')); } catch (_) {}
    const ports = stack && stack.ports ? stack.ports() : null;
    const botUrl = process.env.E2E_BOT_URL || (ports && ports.bot ? 'http://127.0.0.1:' + ports.bot : null);
    const key = env && env.INTERNAL_API_KEY;
    const post = async (path, body) => {
      try {
        const r = await fetch(botUrl + '/api/internal/observe/' + path, { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': key }, body: JSON.stringify(body) });
        return { status: r.status, body: await r.json().catch(() => null) };
      } catch (e) { return { status: 0, err: String(e.message).slice(0, 120) }; }
    };
    const rowsOf = async (t, f) => { const r = await api.rows(t, f); return r && r.ok ? r.rows : null; };
    await api.setRole('coach');
    const seed = await api.setRoster({ langs: ['ur', 'en'] });
    const ls = seed && seed.ok ? await rowsOf('leader_schools', { school_ext_id: seed.schoolExtId }) : null;
    const leaderId = ls && ls[0] ? ls[0].leader_user_id : null;
    const [T1, T2] = (seed && seed.teachers) || [];
    const ay = T1 ? ((await rowsOf('users', { phone_number: T1.phone })) || [])[0] : null;
    if (!botUrl || !key) blockAll('no running stack to call: the bot URL (E2E_BOT_URL) or its INTERNAL_API_KEY (<RUN_DIR>/src/.env) is missing');
    else if (!leaderId || !ay) blockAll('the run\'s own database could not be read for the coach and her fixture teacher (api.rows reads only the local lane database): ' + JSON.stringify({ seed: seed && seed.ok, leaderId: !!leaderId, teacher: !!ay }));
    else {
      const sx = seed.schoolExtId;
      const E = (edit, value, o = {}) => post('teacher-edit', { leaderUserId: leaderId, schoolExtId: o.school || sx, userId: o.user || ay.id, edit, value });
      const me = async () => ((await rowsOf('users', { id: ay.id })) || [])[0] || {};
      const audits = async (action) => ((await rowsOf('leader_roster_audit', { actor_user_id: leaderId, action })) || []).filter((r) => r.teacher_ext_id === ay.id).length;
      const lvl = (u) => JSON.stringify(u.teacher_level || null);
      const home = T1.phone;
      try {
        // ── OBS86 · name, levels, role saved as WhatsApp's Edit a teacher saves them, each with its audit row ──
        const a0 = { name: await audits('edit_name'), level: await audits('edit_level'), role: await audits('edit_role') };
        // the planner tidies a typed name (teacher-edit.service _cleanName) exactly as WhatsApp's Edit a teacher does,
        // so the saved name is compared with what it answered, and with what was typed regardless of case
        const nm = await E('name', 'Ayesha Siddiqui');
        const lv = await E('level', ['PRIMARY', 'MIDDLE']);
        const rl = await E('role', 'principal');
        const u86 = await me();
        const a1 = { name: await audits('edit_name'), level: await audits('edit_level'), role: await audits('edit_role') };
        recE('OBS86', V(nm.status === 200 && nm.body.outcome === 'saved' && lv.status === 200 && lv.body.outcome === 'saved' && rl.status === 200 && rl.body.outcome === 'saved'
            && u86.name === nm.body.name && /^ayesha siddiqui$/i.test(u86.name || '') && u86.role === 'principal' && /PRIMARY/.test(lvl(u86)) && /MIDDLE/.test(lvl(u86)) && !/HIGH/.test(lvl(u86))
            && a1.name === a0.name + 1 && a1.level === a0.level + 1 && a1.role === a0.role + 1,
          { name: nm, level: lv, role: rl, saved: { name: u86.name, role: u86.role, teacher_level: u86.teacher_level }, audit: { before: a0, after: a1 },
            notDriven: 'the portal\'s "a principal can observe teachers" line is the coach app\'s own copy, which this lane does not render' }));
        // put her name and role back (a principal is not in the coach's teacher patch); her levels stay (cooldown)
        await api.setRoster({ langs: ['ur', 'en'] });

        // ── OBS87 · only Primary / Middle / High; a second change inside 48 hours is refused with the hours left ──
        let first = lv.status === 200 && lv.body.outcome === 'saved' ? lv : await E('level', ['HIGH']);
        const early = await E('level', ['EARLY_YEARS']);
        const again = await E('level', ['HIGH']);
        const u87 = await me();
        recE('OBS87', V(first.status === 200 && early.status === 400 && early.body.reason === 'empty_selection'
            && again.status === 409 && again.body.reason === 'cooldown' && again.body.hoursRemaining >= 47 && again.body.hoursRemaining <= 48 && !/HIGH/.test(lvl(u87)),
          { first: first.body, earlyYears: early, secondInside48h: again, levelAfter: u87.teacher_level,
            notDriven: 'which boxes the screen offers is the coach app\'s; here the bot\'s planner is shown to take only PRIMARY/MIDDLE/HIGH (an early-years band alone is an empty selection)' }));

        // ── OBS88 · check first (nothing changes), then the move: visits follow, a no-history account is retired ──
        if (want('OBS88')) {
          const shellPhone = '92398' + home.slice(-7);
          const shellApi = api.as(shellPhone);
          await shellApi.sendWait('/language', 60000).catch(() => null);   // any first message makes the account
          const shell = ((await rowsOf('users', { phone_number: shellPhone })) || [])[0] || null;
          const visitsBefore = ((await rowsOf('observation_schedules', { teacher_ext_id: home })) || []).length;
          const ck = await E('phone_check', shellPhone);
          const unchanged = (await me()).phone_number === home;
          const mv = await E('phone', shellPhone);
          const u88 = await me();
          const visitsOld = ((await rowsOf('observation_schedules', { teacher_ext_id: home })) || []).length;
          const visitsNew = ((await rowsOf('observation_schedules', { teacher_ext_id: shellPhone })) || []).length;
          const retired = shell ? ((await rowsOf('users', { id: shell.id })) || [])[0] || null : null;
          const back = await E('phone', home);
          recE('OBS88', V(!!shell && ck.status === 200 && ck.body.outcome === 'shell' && unchanged
              && mv.status === 200 && mv.body.outcome === 'moved' && u88.phone_number === shellPhone
              && visitsOld === 0 && visitsNew >= visitsBefore
              && !!retired && retired.phone_number === 'merged:' + shell.id && !!retired.deleted_at,
            { check: ck, unchangedAfterCheck: unchanged, move: mv, phoneAfter: u88.phone_number, visits: { before: visitsBefore, oldNumberAfter: visitsOld, newNumberAfter: visitsNew },
              shell: shell ? { id: shell.id, after: retired && { phone_number: retired.phone_number, deleted_at: retired.deleted_at } } : 'the first message did not create an account on ' + shellPhone,
              movedBack: back.status === 200 ? back.body.outcome : back }));
        }

        // ── OBS89 · a number whose account has coaching history is refused, at the check and at the commit ──
        if (want('OBS89')) {
          const cands = [];
          if (T2) { const b = ((await rowsOf('users', { phone_number: T2.phone })) || [])[0]; if (b) cands.push(b); }
          const coach = ((await rowsOf('users', { id: leaderId })) || [])[0]; if (coach) cands.push(coach);
          let target = null;
          for (const c of cands) { if (((await rowsOf('coaching_sessions', { user_id: c.id })) || []).length) { target = c; break; } }
          if (!target) recE('OBS89', ['BLOCKED', { reason: 'no account on the lane has history to collide with: neither Bilal nor the coach owns a coaching_sessions row (the chain above records Bilal\'s; run it with OBS89)' }]);
          else {
            const e0 = await audits('edit_phone_escalated');
            const ck = await E('phone_check', target.phone_number);
            const cm = await E('phone', target.phone_number);
            const e1 = await audits('edit_phone_escalated');
            const u89 = await me();
            recE('OBS89', V(ck.status === 409 && ck.body.reason === 'taken' && ck.body.heading === 'Please wait while we fix your data'
                && cm.status === 409 && cm.body.reason === 'taken' && u89.phone_number === home && e1 >= e0 + 1,
              { against: target.id === leaderId ? 'the coach (owner of unbound captures)' : 'Bilal (observed in the chain)', check: ck, commit: cm,
                phoneAfter: u89.phone_number === home ? 'unchanged' : u89.phone_number, escalatedAudit: { before: e0, after: e1 } }));
          }
        }

        // ── OBS90 · outside her patch: another school, or a person not at her school ──
        if (want('OBS90')) {
          const before = (await me()).name;
          const otherSchool = await E('name', 'Not Allowed (E2E)', { school: 'niete:E2EOBSNOTMINE' });
          const notHers = await E('name', 'Not Allowed (E2E)', { user: leaderId });
          const after = (await me()).name;
          const coachAfter = (((await rowsOf('users', { id: leaderId })) || [])[0] || {}).name;
          recE('OBS90', V(otherSchool.status === 404 && otherSchool.body.reason === 'not_found' && notHers.status === 404 && notHers.body.reason === 'not_found'
              && after === before && coachAfter !== 'Not Allowed (E2E)',
            { otherSchool, personNotAtHerSchool: notHers, nameUnchanged: after === before }));
        }
      } finally {
        const now = await me();
        if (now.phone_number && now.phone_number !== home) await E('phone', home);
        await api.setRoster({ langs: ['ur', 'en'] });
      }
    }
  }

  // ── OBS77-OBS162 that this lane cannot drive, each with what stops it (bd-q8wt5e.6.2). Grouped by the one thing
  //    missing, so adding that thing to the lane names every scenario it unblocks. ──
  const PORTAL = 'the step is taken in the coach app (portal-observe.service through the portal\'s own server), and the mock lane starts the bot, its worker and the mock Graph API only: no portal server or page runs (PORTAL_URL in local-lane.env points at a dev portal nobody starts), so a portal recording, draft, talk, report send or plan upload cannot be made here.';
  const CALENDAR = 'the coach\'s invite is a Google Calendar event (observe-calendar.service: OBSERVE_CALENDAR_ENABLED + her coach_directory work_email). The lane sets neither and has no Calendar mock, so "one invite / moved / removed" cannot be observed; and the booking is made on the portal, which the lane does not run.';
  const OBSERVE2_FLOW = 'needs the /observe2 field form or its "Check the moments" Flow OPENED: the emulator plays a Flow from its stored FLOW_JSON (.claude/qa/fixtures/flows/manifest.json), and the lane has no copy of OBSERVE2_FIELD_FORM_FLOW_ID or OBSERVE2_CHECK_FLOW_ID (local-lane.env sets neither). Adding them is a lane change (the flows manifest + local-lane.env), outside this driver. OBS105-OBS110 drive everything before the form opens.';
  const OBSERVE2_SEALED = 'needs an /observe2 visit sealed or recorded into: the seal is the field form\'s "Seal and send", inside a Flow the lane cannot open (' + 'no stored OBSERVE2_FIELD_FORM_FLOW_ID / OBSERVE2_CHECK_FLOW_ID), and the moments and the brief are model calls on an /observe2 transcript that have no recorded cassette (the lane makes no live paid calls).';
  const LP_LIST = 'needs the lesson-plan step with plans listed for the observed teacher: the fixture teachers have no lesson plans and no Make my own plan, and the lane has no seed for one (the coaching_db/training_db tools seed the DRIVER\'s own rows only), so the capture gates are answered "No" and no plan list is ever sent.';
  // the id is a literal first argument on purpose: check-scenario-coverage.py reads recorded ids from the source
  const nb = (id, name, reason) => { if (want(id)) rec(id, name, 'BLOCKED', { reason }, 0); };
  nb('OBS77', 'A visit booked on the portal sends the coach the same invite and the teacher the same message as one booked in WhatsApp', CALENDAR + ' The teacher half is the same announce WhatsApp uses, driven by OBS62.');
  nb('OBS78', 'Moving or cancelling a portal visit updates the invite and tells the teacher, as WhatsApp does', CALENDAR + ' The teacher half is OBS63\'s announce.');
  nb('OBS79', 'A portal visit booked or moved into the past sends nothing', 'the past-date booking is the portal\'s booking screen, and the invite it must not send is a Google Calendar event: ' + CALENDAR);
  nb('OBS80', 'A lesson sent from the portal becomes a bound /observe observation', PORTAL);
  nb('OBS81', 'The draft of a portal observation is checked in the portal, not in a WhatsApp form', PORTAL);
  nb('OBS82', "The talk with the teacher and the coach's own feedback happen in the portal", PORTAL);
  nb('OBS83', "The teacher's report is previewed and sent from the portal and reaches her WhatsApp", PORTAL);
  nb('OBS85', 'A failed portal observation is shown in the portal, not announced on WhatsApp', PORTAL + ' It also needs a transcription or analysis fault on a portal row.');
  nb('OBS91', "A coach attaches the teacher's own plan as a file and sees what became of it", PORTAL);
  nb('OBS92', "A file that is not a lesson plan, or cannot be read, shows Couldn't read and messages no one", PORTAL);
  nb('OBS93', 'The plan picker refuses what the reader cannot open', PORTAL + ' The refusal is the coach app\'s file picker.');
  nb('OBS94', 'A coach sends the observation with a plan the teacher made herself', PORTAL);
  nb('OBS95', 'A coach on WhatsApp picks the plan the teacher made with Make my own', LP_LIST);
  nb('OBS96', 'A plan that finishes being read while the analysis runs still scores the lesson-plan part', PORTAL + ' It also needs the plan reader and the analysis to finish in a set order, which the lane cannot hold.');
  nb('OBS98', 'Every Section B move on the form says why the grader rated it that way', 'Section B\'s per-move lines exist only when a lesson plan was graded (observe-draft.service composeEditableFidelity returns null without lesson_plan status ok), and the chain answers the lesson-plan gate "No": ' + LP_LIST);
  nb('OBS102', "In Urdu, the observe messages never guess the coach's or the teacher's gender", 'needs the whole chain with the COACH in Urdu (register, start, debrief, send). The analysis, debrief-guide and coach-feedback prompts carry the coach\'s language, and the lane has cassettes only for the English coach\'s calls; an Urdu run would miss them and the lane makes no live paid calls. The Urdu strings are unit-pinned (tests/language/urdu-gender-neutral-copy.test.js).');
  nb('OBS103', "Picking the teacher's lesson plan from the list asks me to confirm before it is used", LP_LIST);
  nb('OBS104', 'Changing the lesson plan links nothing and returns to the lesson-plan list', LP_LIST);
  nb('OBS111', 'Part 1 refuses a number that cannot be right', OBSERVE2_FLOW);
  nb('OBS112', 'A form reopened after Part 1 continues with Part 2', OBSERVE2_FLOW);
  nb('OBS113', 'Part 1 is up to and including guided practice, and Part 2 is independent practice and the wrap-up', OBSERVE2_FLOW);
  nb('OBS114', 'With work of their own, Part 2 asks what the teacher did and what children did when stuck', OBSERVE2_FLOW);
  nb('OBS115', "The teacher's checking moves during independent practice reach the levels they evidence", OBSERVE2_FLOW);
  nb('OBS116', 'Part 1 asks what materials were used, and they are named, not scored', OBSERVE2_FLOW);
  nb('OBS117', "Part 2 asks what the children's work showed: repeating, or reasoning", OBSERVE2_FLOW);
  nb('OBS118', 'The check and the brief group the thinking indicators as "Thinking"', OBSERVE2_FLOW);
  nb('OBS119', 'A form opened before the parts changed keeps its own Part 2', OBSERVE2_FLOW);
  nb('OBS120', 'A reopened form shows the notes I typed', OBSERVE2_FLOW);
  nb('OBS121', 'Going back to Part 1 does not empty Part 2', OBSERVE2_FLOW);
  nb('OBS122', "After Part 2 the coach picks the lesson plan from the teacher's own plans", OBSERVE2_FLOW);
  nb('OBS123', 'A plan the teacher read in the app yesterday is in "Which plan?"', OBSERVE2_FLOW);
  nb('OBS124', "A plan the bot didn't give the teacher is added in the form as photos, a file, or typed text", OBSERVE2_FLOW);
  nb('OBS125', 'An added plan is read and its steps checked after the recording, as /observe does', OBSERVE2_SEALED);
  nb('OBS126', "A PDF of the teacher's own Rumi plan is graded from that plan's own steps", OBSERVE2_SEALED);
  nb('OBS127', "An added plan that can't be read, or has no lesson steps, is named as such, with what to do next", OBSERVE2_SEALED);
  nb('OBS128', 'No lesson plan goes on to the photos, then the seal', OBSERVE2_FLOW);
  nb('OBS129', 'Classroom photos are taken now, or uploaded from the ones already on the phone', OBSERVE2_FLOW);
  nb('OBS130', 'Sealing locks the record and the chat says what to do with the recording', OBSERVE2_FLOW);
  nb('OBS131', 'The coach picks one thing to work on first, up to two more, and can pick the plan\'s steps', OBSERVE2_FLOW);
  nb('OBS132', 'The same thing cannot be picked twice', OBSERVE2_FLOW);
  nb('OBS133', 'The check keeps all three picks, and the brief and the report follow the first', OBSERVE2_SEALED);
  nb('OBS134', '"Work on first" offers the coaching focus areas coaches asked for, and says what each choice means', OBSERVE2_FLOW);
  nb('OBS135', "A coaching focus area carries through the check, the brief and the teacher's report", OBSERVE2_SEALED);
  nb('OBS136', 'A check opened on the older Flow keeps a sealed coaching focus area it cannot show', OBSERVE2_FLOW);
  nb('OBS137', 'The recording joins the sealed record and its moments come back to check', OBSERVE2_SEALED);
  nb('OBS138', "Every moment's words are in the recording, at the minute they were said", OBSERVE2_SEALED);
  nb('OBS139', 'A recording sent while the form waits for it always reaches the form, never general chat', OBSERVE2_SEALED);
  nb('OBS140', 'A recording that was already analysed is refused and the form keeps waiting', OBSERVE2_SEALED);
  nb('OBS141', 'A recording sent before the seal waits for it, and the plan attached afterwards is checked', OBSERVE2_SEALED);
  nb('OBS142', 'Record first: a lesson recording sent with no form open is saved as its own visit', 'needs "my latest observation was an /observe2 visit": ' + OBSERVE2_SEALED);
  nb('OBS143', 'The teacher is not on "Which teacher did you observe?": the coach types the name', 'the "Which teacher did you observe?" list is record-first\'s (OBS142): ' + OBSERVE2_SEALED);
  nb('OBS144', 'A typed name that fits more than one teacher, or none', 'the "Someone else" typed-name wait follows record-first\'s list (OBS142): ' + OBSERVE2_SEALED + ' It also needs two fixture teachers sharing a first name.');
  nb('OBS145', 'A command typed while the bot waits for a name is not taken as a name', 'the typed-name wait follows record-first\'s "Someone else" (OBS142): ' + OBSERVE2_SEALED);
  nb('OBS146', 'Record first: two lessons back to back, each saved and named on its own', 'needs "my latest observation was an /observe2 visit": ' + OBSERVE2_SEALED);
  nb('OBS147', 'Record first: the form is filled later, from the saved message or "Complete the form"', OBSERVE2_SEALED);
  nb('OBS149', 'With a picked plan, the check shows each step of the plan pre-rated from the recording', OBSERVE2_SEALED);
  nb('OBS150', 'Each moment is evidence about the teaching, and says why it was picked', OBSERVE2_SEALED);
  nb('OBS151', 'A part of the lesson with no moment says so, never a blank question', OBSERVE2_SEALED);
  nb('OBS152', 'The check pre-fills every level and Submit asks about the debrief, as /observe does', OBSERVE2_SEALED);
  nb('OBS153', "The visit ends as /observe's does: the debrief recording, the coach card, the teacher's report", OBSERVE2_SEALED);
  nb('OBS154', 'The brief carries every note I typed, by part', OBSERVE2_SEALED);
  nb('OBS155', 'My notes come with the "Record sealed" message, before I talk with the teacher', OBSERVE2_FLOW);
  nb('OBS156', 'With no notes typed, the "Record sealed" message is unchanged', OBSERVE2_FLOW);
  nb('OBS157', 'The check\'s "Work on first" screen shows my notes, read-only, above the picks', OBSERVE2_FLOW);
  nb('OBS158', "The teacher's report names the thing I picked to work on first", OBSERVE2_SEALED);
  nb('OBS159', 'Choosing someone else after the report preview shows a new preview for that teacher', 'tapping "Someone else" and picking Ayesha generates a second report preview in HER language (Urdu); that preview\'s model calls have no recorded cassette and the lane makes no live paid calls. The confirm\'s three buttons are checked by OBS99.');
  nb('OBS160', 'When WhatsApp refuses the list of my teachers, I am asked to type the details instead', 'needs Meta to refuse an interactive list twice (500 #131000): the mock Graph API refuses only an unreachable media link, and stack-control.faults scripts vendor (model) answers, not Graph API sends.');

  // ── BLOCKED, each with the evidence that says why ──
  rec('OBS22', '/observe before an account exists reports no account', 'BLOCKED', { reason:
    'unreachable from any client: text-message.handler.js:494-509 calls getOrCreateUser before the observe gate, which CREATES the account for an unknown number, so the gate sees user=null only when that lookup throws (a database outage). deny_no_user is an outage path, and the harness has no DB fault injection.' }, 0);
  rec('OBS26', 'A capture whose DB write fails reports a capture failure, not "no account"', ...FAULT, 0);
  rec('OBS28', 'A failed report send is surfaced to the coach with a retry', ...FAULT, 0);
  // bd-trksw9: both need the report narrative to fail twice; the cassette answers it, it cannot fault it.
  rec('OBS65', 'A report whose written feedback cannot be generated is held, and the coach is offered Regenerate', ...FAULT, 0);
  rec('OBS66', 'Tapping "Regenerate report" rebuilds the same observation\'s report preview', ...FAULT, 0);

  // bd-qmahx1: placeholders for #3317's video-recommendation scenarios (bd-gzfdu9), so the coverage gate sees them.
  rec('OBS71', 'The observed teacher gets the clip after the report the coach sent', 'BLOCKED', { reason: 'no driver yet: the video-recommendation scenarios were added in #3317 (bd-gzfdu9) as @wip @draft Gherkin without driver code; this placeholder only makes them visible in every run, it is not coverage' }, 0);
  rec('OBS72', 'No clip when the report went only as an invite or to the review number', 'BLOCKED', { reason: 'no driver yet: the video-recommendation scenarios were added in #3317 (bd-gzfdu9) as @wip @draft Gherkin without driver code; this placeholder only makes them visible in every run, it is not coverage' }, 0);

  // bd-apnnh2.11: placeholder so the coverage gate sees the merged-account scenario. It is not coverage.
  rec('OBS76', 'A teacher whose old account was merged appears once in my teacher list', 'BLOCKED', { reason: 'no driver yet: needs a merged-account fixture in the mock seed (two users rows for one teacher at a coach\'s school, one retired by a fold: deleted_at set, phone merged:<id>). The mock lane could not run on the machine that wrote this, so an implementation could not be verified. Unit-pinned by tests/observe/bd-apnnh2.11-patch-skips-retired.test.js' }, 0);
};
