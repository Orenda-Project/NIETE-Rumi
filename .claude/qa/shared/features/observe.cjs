// @mock-lane — mock-capable driver (uses the mock API, not the browser DOM). Its presence enrols this feature in the mock lane; E2E_MOCK_FEATURES is derived from this marker, so there is no hardcoded list.
/* observe.feature — mock-lane driver.
 *
 * observe is a COACH/leader feature, capability-gated on OBSERVE_MEWAKA_FLOW_ID and driven through the
 * OBSERVE_VISIT_FLOW_ID data_exchange Flow (both real ids live in keys/niete-local.env and are mirrored
 * as fallbacks in local-stack.sh; they match the committed flow fixtures, so the emulator opens them).
 *
 * DRIVEN on the mock lane:
 *  · role gate (text): OBS20 teacher DENIED · OBS02 coach onboarding · OBS01 coach entry · OBS32 menu row
 *  · visit Flow (emulator): OBS03 the visit picker OPENS to school selection
 *  · audio (fixture upload): OBS06 recording captured without a Yes/No · OBS35 asked whose it is
 *    · OBS25 a leader's long audio goes to OBSERVE capture, never teacher coaching
 *
 * BLOCKED, each with a VERIFIED reason (confirmed by exploratory drive / code, not assumed):
 *  ROSTER — the visit picker opens, but school→teacher→brief cannot ADVANCE: the driver-coach has no
 *           leader_schools assignment / roster in the sandbox DB, so the school dropdown + teacher picker
 *           are empty and Continue/"Pick the teacher" are no-ops. There is no seed helper, and the mock
 *           API only PATCHes the users row (not leader_schools), so this state can't be created here.
 *  ANALYSIS — needs a COMPLETED audio analysis (pick a teacher → analyse → FICO form). Unreachable
 *           because the teacher pick is empty (see ROSTER); the FICO form / debrief / report all sit
 *           downstream of it.
 *  FAULT  — needs an injected DB-write / report-send failure; the harness has no fault injection.
 *  NOACCT — needs a WhatsApp number with no NIETE account; the driver is a registered user.
 *  OFF    — needs the capability gate OFF; the mock baseline runs it ON. Override OBSERVE_MEWAKA_FLOW_ID= .
 *
 * Copy grounded in observe-strings.js (en) + observe-command.handler.js; screens confirmed by live probe. */
const V = (c, ev) => [c ? 'PASS' : 'FAIL', ev];
const B = (reason) => ['BLOCKED', { reason }];
const ROSTER   = B('the visit picker OPENS but cannot advance to school→teacher→brief. api.setRoster() DOES seed a dedicated E2E school + teachers + leader_schools row (verified queryable by the driver uid, and torn down by the harness — no pollution), but the visit Flow still renders an EMPTY school dropdown: listSchools returns nothing for the flow_token userId, so the seed does not surface in-Flow (a flow_token / lazy schools-data_exchange nuance, not yet root-caused). Until that is fixed the walk cannot proceed.');
const ANALYSIS = B('needs a completed audio analysis (pick teacher → analyse → FICO); the teacher pick is gated by the same in-Flow empty-roster issue as ROSTER. The FICO form / debrief / report sit downstream of it.');
const FAULT    = B('needs an injected DB-write / report-send failure; the harness provides no fault injection.');
const NOACCT   = B('needs a WhatsApp number with no NIETE account; the mock driver is a registered user.');
const OFF      = B('needs the capability gate OFF; the mock baseline sets OBSERVE_MEWAKA_FLOW_ID ON to exercise the coach path. Drive the OFF fall-through with: OBSERVE_MEWAKA_FLOW_ID= bash commit-e2e.sh …');

const DENIED = /school leaders|field officers|I'm here for you/i;                                 // S.role_denied
const ENTRY  = /plan your visit|Plan my visit|Welcome to \/observe|how it works|record the lesson|Ready!|send me the recording/i;
const CAPTURED = /Got your recording|Whose observation is this|Pick the teacher/i;                // observe capture prompt
const COACHING = /analyze your teaching|Step \d\/5|Transcribing your classroom|feedback on your OWN/i; // the WRONG lane
const MEDIA = require('path').resolve(__dirname, '..', '..', 'fixtures', 'whatsapp', 'niete', 'media');

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
  const R = (id, name, verdict, ms = 0) => { if (done.has(id)) return; done.add(id); rec(id, name, verdict[0], verdict[1], ms); };
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
    OBS19: 'A scheduled visit cannot be cancelled from the WhatsApp Flow',
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
  };
  const rr = (id, cond, ev, ms = 0) => R(id, NAMES[id], V(cond, ev), ms);
  const rb = (id, reason, ev) => R(id, NAMES[id], ['BLOCKED', { reason, ...(ev || {}) }], 0);
  const notReached = (ids, why) => { for (const id of ids) if (!done.has(id)) rb(id, 'not reached: ' + why); };

  const SCHED = ['OBS03', 'OBS04', 'OBS05', 'OBS19', 'OBS62', 'OBS63', 'OBS64'];
  const CHAIN = ['OBS07', 'OBS08', 'OBS09', 'OBS10', 'OBS11', 'OBS12', 'OBS14', 'OBS15', 'OBS18', 'OBS27', 'OBS31',
    'OBS37', 'OBS38', 'OBS40', 'OBS41', 'OBS42'];
  const CANCEL = ['OBS23', 'OBS29', 'OBS30', 'OBS39'];
  const isFlow = (m) => !!(m && m.raw && m.raw.interactive && m.raw.interactive.type === 'flow');
  const brief = (m) => ({ txt: (m.txt || '').slice(0, 500), btns: m.btns, img: m.img || undefined, doc: m.doc || undefined,
    flow: isFlow(m) || undefined, template: m.template || undefined, list: m.list ? m.list.rows.map((r) => r.title) : undefined });
  const UR = /[؀-ۿ]/;
  // Poll the chat until `stop(msg)` or the deadline. Photo / lesson-plan prompts of the capture gates
  // are answered "No" on the way when `answer` is set, so an analysis runs without fixture photos.
  const collect = async (ms, stop, answer = false) => {
    const seen = []; const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      for (const m of await api.fresh()) {
        seen.push(m);
        if (stop && stop(m)) return { hit: m, seen };
        if (answer && (m.btns || []).includes('No') && /photo|lesson plan/i.test(m.txt || '')) { await api.freshReset(); await api.tapAndWait('No', 60000); }
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
    return { hit: null, seen };
  };
  const visitMenu = async () => {
    api.closeFlow(); await api.resetFlow(); await api.freshReset();
    await api.sendWait('/observe', 120000);
    const op = await api.openFlow('Plan my visit|plan your visit|Observe|Open');
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
    const up = await api.upload(MEDIA + '/' + audio, 'Audio', 180000);
    await api.freshReset();
    const got = /already been analy/i.test(up.txt || '') ? { hit: null, seen: [] } : await collect(600000, isFlow, true);
    return { armed: (armed.txt || '').slice(0, 200), upload: { txt: (up.txt || '').slice(0, 300), btns: up.btns, raw: up },
      form: got.hit, seen: got.seen.map(brief) };
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

  if (want(...SCHED, ...CHAIN, ...CANCEL)) {
    s = Date.now();
    await api.setRole('coach');
    // Ayesha reads Urdu and Bilal English, the coach English: the notice must follow the TEACHER.
    const seed = await api.setRoster({ langs: ['ur', 'en'] });
    const reset = seed && seed.ok ? await api.resetObserve() : null;
    const [T1, T2] = (seed && seed.teachers) || [];
    if (!seed || !seed.ok || !reset || !reset.ok) {
      notReached([...SCHED, ...CHAIN, ...CANCEL], 'the fixture roster could not be seeded: ' + JSON.stringify({ seed, reset }).slice(0, 200));
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
          await api.flowPick("I'm done for now", { exact: true }); await api.flowClick('Continue', { settleMs: 3000 });
          const ack = await collect(30000, (x) => /Observation scheduled/i.test(x.txt || ''));
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

          // ── OBS64 · re-saving the same visit unchanged sends nothing ──
          const mv = await visitMenu();
          await api.flowClick('My schedule', { settleMs: 2500 });
          await api.flowPick('Ayesha Khan'); await api.flowClick('Continue', { settleMs: 2500 });
          const act = await api.flowProbe();
          // ── OBS19 · the spec says a scheduled visit has NO cancel; with OBSERVE_OBS_ACTION on (sandbox) it does ──
          rr('OBS19', act.screen && !/Cancel this visit/i.test(act.text || ''),
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
            rb('OBS64', 'half driven: an unchanged re-save sent the teacher ' + (tA2.length ? tA2.length + ' message(s)' : 'nothing')
              + '. The second half needs a teacher with no WhatsApp number, and the coach patch is derived from users rows (patch-resolver.service.js:250), which always carry a phone — no number-less teacher can be booked here.',
              { resave });
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

      // ── the observation chain on Bilal (English) ──
      let form1 = null;
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
            const offer = first.find((x) => /debrief/i.test((x.txt || '') + JSON.stringify(x.list || '')));
            rr('OBS14', !!offer && first.indexOf(offer) === 0,
              { later: (later.txt || '').slice(0, 200), replies: first.map(brief) });
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
            const g1more = await collect(15000, null);
            const guide1 = [g1, ...g1more.seen].map((x) => x.txt || '').filter(Boolean).join('\n---\n');
            const steps = (guide1.match(/^\s*(?:\*?\d[.)]|[1-6]️⃣)/gm) || []).length;
            const lastPara = (g1.txt || '').trim().split(/\n\s*\n/).pop() || '';
            rr('OBS09', !!g1.ok && steps >= 6 && /record/i.test(lastPara) && g1more.seen.filter((x) => x.txt).length === 0
                && !/\b\d{1,3}\s*\/\s*(?:148|104|4)\b|\b\d{1,3}\s*%/.test(g1.txt || ''),
              { messages: 1 + g1more.seen.filter((x) => x.txt).length, steps, lastParagraph: lastPara.slice(0, 200), guide: (g1.txt || '').slice(0, 600) });
            await api.freshReset();
            const g2 = await api.tapAndWait('Debrief now', 120000);
            const g2more = await collect(15000, null);
            rr('OBS15', !!g2.ok && (g2.txt || '') === (g1.txt || '') && g2more.seen.filter((x) => x.txt).length === 0,
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
              if (preview && preview.list && !(preview.btns || []).some((b) => /send now/i.test(b))) {
                const row = preview.list.rows.find((r) => /Bilal/.test(r.title));
                if (row) { await api.freshReset(); await api.pickRowAndWait(row.title, 120000); preview = (await collect(180000, (x) => (x.btns || []).some((b) => /send now/i.test(b)))).hit; }
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
              rr('OBS11', !!preview && !!preview.img && !!(delivered && delivered.length) && !!outcome && outcome.seen.some((x) => /sent|deliver/i.test(x.txt || '')),
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
            await api.setUser({ preferred_language: 'ur', language_locked: true });
            await api.freshReset();
            const d1 = await observeAndAnalyse(seed.schoolName, 'Bilal Ahmed', 'hameeda_16min.m4a');
            const dupTxt = (d1.upload && d1.upload.txt) || '';
            await new Promise((r) => setTimeout(r, 8000));
            const noForm = !(await api.fresh()).some(isFlow);
            rr('OBS38', /اس کلاس روم ریکارڈنگ کا تجزیہ پہلے ہی کیا جا چکا ہے/.test(dupTxt),
              { reply: dupTxt, coach: 'ur', teacher: 'en (Bilal)' });
            await api.setUser({ preferred_language: 'en', language_locked: true });
            await api.freshReset();
            const d2 = await observeAndAnalyse(seed.schoolName, 'Bilal Ahmed', 'hameeda_16min.m4a');
            const dup2 = (d2.upload && d2.upload.txt) || '';
            await new Promise((r) => setTimeout(r, 8000));
            rr('OBS37', /This classroom recording has already been analyzed\. Please submit a new recording\./.test(dup2) && noForm && !(await api.fresh()).some(isFlow),
              { reply: dup2, noNewForm: noForm });
          }
        }
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
          const up = await api.upload(MEDIA + '/hameeda_11min.m4a', 'Audio', 180000);
          await api.freshReset();
          // collect the gate prompts WITHOUT answering, so their buttons are the old buttons OBS29 taps
          const gates = await collect(120000, (x) => (x.btns || []).includes('Yes') && /photo/i.test(x.txt || ''));
          const oldBtns = [];
          for (const x of [up.raw ? up.raw : null, ...gates.seen].filter(Boolean)) {
            const raw = x.raw && x.raw.interactive;
            for (const bt of ((raw && raw.action && raw.action.buttons) || [])) oldBtns.push({ id: bt.reply.id, title: bt.reply.title });
          }
          const cancelBtn = (up.btns || []).find((x) => /cancel/i.test(x));
          await api.freshReset();
          const cx = cancelBtn ? await api.tapAndWait(cancelBtn, 60000) : { ok: false, txt: '' };
          const cxMore = await collect(15000, null);
          const cxTxt = [cx.txt, ...cxMore.seen.map((x) => x.txt)].filter(Boolean).join('\n');
          // ── OBS29 · every old button after the cancel says it was cancelled, and advances nothing ──
          const taps = [];
          for (const bt of oldBtns.filter((x) => !/cancel|okay/i.test(x.title))) {
            await api.freshReset(); await api.tapId('button', bt.id, bt.title);
            const r = await collect(20000, (x) => !!x.txt);
            taps.push({ tapped: bt.title, reply: r.hit ? (r.hit.txt || '').slice(0, 200) : null });
          }
          const flowAfter = (await collect(20000, isFlow)).hit;
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
              await api.setUser({ preferred_language: 'ur', language_locked: true });
              await api.freshReset();
              const dd = await api.upload(MEDIA + '/debrief/debrief_respectful.ogg', 'Audio', 120000);
              const ddMore = await collect(30000, null);
              const ddTxt = [dd.txt, ...ddMore.seen.map((x) => x.txt)].filter(Boolean).join('\n');
              rr('OBS41', /اس ڈی بریف ریکارڈنگ کا تجزیہ پہلے ہی کیا جا چکا ہے/.test(ddTxt), { reply: ddTxt.slice(0, 300) });
              await api.setUser({ preferred_language: 'en', language_locked: true });
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
              const hdMore = await collect(300000, (x) => /concern|respect|harm|careful/i.test(x.txt || '') && !/Got|listening/i.test(x.txt || ''));
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
  notReached([...SCHED, ...CHAIN, ...CANCEL], 'not selected or an earlier step stopped');

  // ── unbound captures: each starts from a clean slate (resetObserve), so the duplicate guard never
  //    mistakes one scenario's fixture upload for another's ──
  const LONG = 'hameeda_15min_alt.m4a';
  if (want('OBS06', 'OBS35', 'OBS25')) {
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
        const up = await api.upload(MEDIA + '/' + LONG, 'Audio', 180000);
        ok = /observing \*?Bilal/i.test(armed.txt || '') && /Got the recording|FICO/i.test(up.txt || '') && !COACHING.test(up.txt || '') && !/Whose observation/i.test(up.txt || '');
        ev = { ...ev, armed: (armed.txt || '').slice(0, 160), reply: (up.txt || '').slice(0, 200) };
      } else ev.err = 'visit Flow did not open: ' + (op && op.err);
    }
    rec('OBS34', 'A principal who HAS started an observation still captures it as an observation', ...V(ok, ev), Date.now() - s);
    api.closeFlow(); await api.resetFlow();
  }

  if (want('OBS33')) {
    // A principal's OWN lesson via /menu → Classroom Coaching: Digital Coach, never the binding list.
    s = Date.now();
    await api.setRole('principal'); await api.resetObserve(); await api.resetFlow(); await api.freshReset();
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

  if (want('OBS21')) {
    // The capability gate OFF: restart the bot without OBSERVE_MEWAKA_FLOW_ID, send /observe, restore.
    s = Date.now();
    let stack = null; try { stack = require('../stack-control.cjs'); } catch (_) {}
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

  // ── BLOCKED, each with the evidence that says why ──
  rec('OBS22', '/observe before an account exists reports no account', 'BLOCKED', { reason:
    'unreachable from any client: text-message.handler.js:494-509 calls getOrCreateUser before the observe gate, which CREATES the account for an unknown number, so the gate sees user=null only when that lookup throws (a database outage). deny_no_user is an outage path, and the harness has no DB fault injection.' }, 0);
  rec('OBS26', 'A capture whose DB write fails reports a capture failure, not "no account"', ...FAULT, 0);
  rec('OBS28', 'A failed report send is surfaced to the coach with a retry', ...FAULT, 0);
};
