// @mock-lane — mock-capable driver (uses the mock API, not the browser DOM). Its presence enrols this feature in the mock lane; E2E_MOCK_FEATURES is derived from this marker, so there is no hardcoded list.
/* status.feature — 8 @e2e scenarios (4 added 2026-09-08, PR #801 sync, bd-q25il).
 *
 * SURFACE CONTRACT since PR #801 (2026-09-08):
 *   nothing running  -> a plain chat reply "Nothing's running right now. Send /menu to start
 *                       something." (Urdu variant for Urdu accounts), on EVERY environment, and
 *                       NO Flow card. Before the fix an empty store bought the teacher a Flow that
 *                       flashed open and shut and a silent chat.
 *   something running -> per environment: the Flow card "What's running / … / Powered by NIETE"
 *                       + CTA "Open status" where STATUS_FLOW_ID is set (staging), else the text
 *                       list "Running for you:". The listing lives INSIDE the Flow on staging.
 * A menu glance is not work: /status straight after /menu must still be the idle reply.
 *
 * In-flight work is set up on the mock lane itself (2026-10-06): a coaching analysis for STA01, plus
 * an in-progress training quiz for STA04; STA06 switches the driver to Urdu and back; STA08 makes it
 * a principal mid-attendance. Every seed is cleared before the feature ends.
 */
const V = (c, ev) => [c ? 'PASS' : 'FAIL', ev];
const RUNNING  = /Running for you:/i;
const IDLE     = /Nothing's running right now|کچھ نہیں چل رہا/i;
const CARD     = /What's running|Open status/i;
const CTA      = 'Open status|کھولیں';

const pickLang = async (api, row) => {
  const r = await api.sendWait('/language');
  await api.openList((r.btns || []).find((b) => /Languages|زبانیں/.test(b)) || 'Languages');
  const p = await api.pickRowAndWait(row);
  return Object.assign({}, p, { txt: (p && p.txt) || '' });
};
const canSeed = (api) => !!(api.caps && api.caps.method === 'mock' && api.caps.upload);
const MEDIA = require('path').resolve(__dirname, '..', '..', 'fixtures', 'whatsapp', 'niete', 'media');
const { dbCreds } = require(require('path').join(__dirname, '..', '..', 'engine', 'bin', 'db-target.cjs'));   // the shared engine, linked in at .claude/qa/engine (scripts/qa/link-engine.sh)
const ITEM_CHROME = /^(Open status|Back|Close|Powered by|Done)/i;

/** Read the /status Flow listing: { claimed, items, surface, err }. */
async function readListing(api) {
  const st = await api.sendWait('/status');
  // Other work in flight talks too: a lesson plan being prepared sends its board text, and that can
  // land before the /status answer. Wait for the status surface itself rather than the first reply.
  for (let waited = 0; surfaceOf(st.txt || '') === 'neither' && waited < 20000; waited += 1000) {
    const hit = (await api.fresh()).find((m) => surfaceOf(m.txt || '') !== 'neither');
    if (hit) { st.txt = hit.txt; st.btns = hit.btns || []; break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const surface = surfaceOf(st.txt || '');
  if (surface !== 'flow-card') {
    return { claimed: null, surface, reply: (st.txt || '').slice(0, 160),
             items: surface === 'running-template' ? (st.txt || '').split('\n').slice(1).map((x) => x.trim()).filter(Boolean) : [] };
  }
  const op = await api.openFlow(CTA);
  if (!op.ok) return { claimed: null, surface, items: [], err: op.err };
  const p = await api.flowProbe();
  const m = /You have (\d+) things? running/i.exec(p.text || '');
  const items = (p.items || []).map((i) => (i.text || '').trim()).filter(Boolean)
    .filter((x) => !ITEM_CHROME.test(x)).filter((v, k, a) => a.indexOf(v) === k);
  api.closeFlow();
  return { claimed: m ? Number(m[1]) : null, surface, items };
}

/** Start a coaching analysis that is really in flight. The audio-hash cache (bd-7beiz) answers a
 *  recording this account already had analysed with the old report and starts NOTHING, so first
 *  archive the driver's own past sessions — the same clean slate coaching-ext.cjs uses. */
async function seedCoaching(api) {
  try { api.db('cancel-stuck'); api.db('reset-history'); } catch (_) {}
  await api.resetFlow();
  const up = await api.upload(require('path').join(MEDIA, 'hameeda_16min.m4a'), 'Audio', 180000);
  let yes = null;
  if ((up.btns || []).some((b) => /Yes, Analyze/i.test(b))) yes = await api.tapAndWait('Yes, Analyze', 120000);
  return { upload: (up.txt || '').slice(0, 80), started: (yes && yes.txt || '').slice(0, 100) };
}

/** A teacher part-way through a training quiz — a second, durable kind of work. A lesson plan cannot
 *  be it: the bot answers one teacher's messages in order, so /status is read only after the plan is
 *  delivered (run 20261006-1552). Training is listed from training_assessment_attempts, so seed one
 *  in-progress attempt on the driver's own sandbox account; clear-training-inflight removes it. */
function seedTraining(api) {
  const r = api.db('seed-training-inflight');
  return { ok: !!(r && r.ok), out: String((r && (r.out || r.err)) || '').trim().split('\n').pop().slice(0, 120) };
}

const surfaceOf = txt => CARD.test(txt) ? 'flow-card'
                       : RUNNING.test(txt) ? 'running-template'
                       : IDLE.test(txt) ? 'idle-template' : 'neither';

/** The Urdu idle answer, as the bot sends it: /menu sits inside U+2066…U+2069 (LRI/PDI) so the slash command
 *  reads left-to-right in Urdu; a regex written without the isolates never matched (STA06, bd-yuur1a). */
const isUrduIdleReply = (t) => /اس وقت کچھ نہیں چل رہا/.test(t || '') && /کچھ شروع کرنے کے لیے \u2066?\/menu\u2069? بھیجیں/.test(t || '');
exports.isUrduIdleReply = isUrduIdleReply;

exports.run = async ({ api, rec, sleep = async (ms) => new Promise((r) => setTimeout(r, ms)), want = () => true }) => {
  const t = () => Date.now();
  let s;
  await api.resetFlow();

  s = t();
  await api.sendWait('/menu');                       // settle before the first measured send
  const st = await api.sendWait('/status');
  const txt = st.txt || '';
  const surface = surfaceOf(txt);

  // The divergence itself, recorded once, as a finding rather than buried in a FAIL.
  // Idle -> text on every env. Running -> Flow card (staging) or text list (prod). Anything
  // else — including a Flow card for an EMPTY store, the pre-PR-#801 defect — is off-contract.
  rec('STA-surface', 'The /status surface matches the documented contract',
      ...V(surface !== 'neither',
           { observedSurface: surface,
             documented: 'idle -> chat text; running -> Flow card (STATUS_FLOW_ID set) or "Running for you:" list',
             actual: txt.slice(0, 180) }), t() - s);

  // STA01 — does it actually list in-flight work, wherever that listing lives?
  s = t();
  let items = [], via = surface, flowText = '', flowClaimedCount = null;
  if (surface === 'flow-card') {
    // Same retry-through-reset the LP and training drivers use: the first open after a
    // burst of cards times out, while the identical open succeeds straight after a reset.
    // Without it STA01 reported FLOW_NEVER_OPENED on a Flow that opens fine by hand.
    let op = await api.openFlow(CTA);
    if (!op.ok) {
      await api.resetFlow();
      await api.sendWait('/status');
      op = await api.openFlow(CTA);
      op.retried = true;
    }
    if (op.ok) {
      const p = await api.flowProbe();
      flowText = p.text || '';
      const claimed = /You have (\d+) things? running/i.exec(flowText);
      if (claimed) flowClaimedCount = Number(claimed[1]);
      items = (p.items || []).map(i => (i.text || '').trim())
        .filter(Boolean).filter(x => !/^(Open status|Back|Close|Powered by)/i.test(x))
        .filter((v, k, a) => a.indexOf(v) === k);
      via = 'flow';
    } else via = 'flow-would-not-open:' + op.err;
    api.closeFlow();
  } else if (surface === 'running-template') {
    items = txt.split('\n').slice(1).map(x => x.trim()).filter(Boolean);
  }
  const idle = IDLE.test(txt) || /nothing/i.test(flowText);
  // Nothing in flight on a lane that can start real work: STA01 is asserted after the seed below.
  const deferSTA01 = !items.length && canSeed(api) && want('STA01');
  if (!deferSTA01) rec('STA01', "/status lists the teacher's in-flight work",
      ...(items.length
          ? V(true, { via, count: items.length, flowClaimedCount, items: items.slice(0, 8) })
          : idle
            ? ['BLOCKED', { via, reason: 'nothing was in flight, so there is no listing to assert — the '
                                       + 'idle answer is correct but proves nothing about listing',
                            screen: (flowText || txt).slice(0, 200) }]
            : ['BLOCKED', { via, reason: 'could not read a listing from the status surface',
                            screen: (flowText || txt).slice(0, 200) }]), t() - s);

  if (want('STA02')) {
    // STA02 — case-insensitive + tolerates trailing text: same SURFACE either way.
    s = t();
    await api.resetFlow();
    const loud = await api.sendWait('/STATUS now');
    const loudSurface = surfaceOf(loud.txt || '');
    rec('STA02', '/status is case-insensitive and tolerates trailing text',
        ...V(loudSurface !== 'neither' && loudSurface === surface,
             { lower: surface, upper: loudSurface,
               note: 'compares the surface each produces, not a fixed template — idle text or a Flow card depending on state/env',
               reply: (loud.txt || '').slice(0, 160) }), t() - s);
  }

  if (want('STA03')) {
    // STA03 — a bare "status" must NOT open the status surface (shape, never wording)
    s = t();
    // A bare "status" falls through to open chat, whose prompt carries the conversation history.
    // Clear it first, as menu and language do, or the cassette key follows whatever came before
    // (7 history messages on one run, 10 on the next, same driver: a replay miss every time).
    api.resetConversation();
    const bare = await api.sendWait('status');
    const bareSurface = surfaceOf(bare.txt || '');
    rec('STA03', 'A bare "status" (no slash) does not open the status surface',
        ...V(bareSurface === 'neither',
             { observedSurface: bareSurface, reply: (bare.txt || '').slice(0, 180) }), t() - s);
  }

  if (want('STA07')) {
    // STA07 — the FIRST /status above came straight after /menu. A glance is not work: with
    // nothing else in flight the answer must be the idle text, never a card claiming "1 thing".
    s = t();
    const menuListed = items.some(x => /^menu$|\bmenu\b/i.test(x)) || /You have 1 thing running/i.test(flowText);
    rec('STA07', 'Opening the menu is a glance, not work — /status right after /menu still says nothing is running',
        ...(surface === 'idle-template' && !menuListed
            ? V(true, { reply: txt.slice(0, 160) })
            : items.length && !menuListed
              ? ['BLOCKED', { reason: 'real work was in flight (' + items.length + ' item(s)), so the idle answer is not '
                                     + 'expected; the menu itself was NOT listed, which is the rule under test', items: items.slice(0, 5) }]
              : V(false, { observedSurface: surface, menuListed, reply: (flowText || txt).slice(0, 200),
                           note: 'a Flow card / "1 thing running" for a menu glance is the PR #801 defect' })), t() - s);
  }

  if (want('STA05', 'STA06')) {
    // STA05 — nothing running: the answer is words in the chat, and no Flow card, on every env.
    s = t();
    await api.resetFlow();
    const idleReply = await api.sendWait('/status');
    const idleTxt = idleReply.txt || '';
    const idleSurface = surfaceOf(idleTxt);
    const EN_IDLE = /Nothing's running right now\. Send \/menu to start something\./;
    const UR_IDLE = /اس وقت کچھ نہیں چل رہا/;
    rec('STA05', '/status with nothing running answers in the chat and does not open the Flow',
        ...(idleSurface === 'idle-template'
            ? V(EN_IDLE.test(idleTxt) || UR_IDLE.test(idleTxt), { reply: idleTxt.slice(0, 160), copyExact: EN_IDLE.test(idleTxt) || UR_IDLE.test(idleTxt) })
            : (items.length || flowClaimedCount)
              ? ['BLOCKED', { reason: 'something was in flight for this account, so "nothing running" cannot be observed', items: items.slice(0, 5) }]
              : V(false, { observedSurface: idleSurface, reply: idleTxt.slice(0, 200),
                           note: idleSurface === 'flow-card' ? 'Flow card for an empty store = the pre-PR-#801 behaviour; is the fix deployed here?' : null })), t() - s);

    // STA06 — the idle answer in the teacher's language. Language is locked per account, so on
    // the shared English driver this is a state BLOCK, not a failure.
    s = t();
    rec('STA06', 'The nothing-running answer is in the teacher\'s language',
        ...(UR_IDLE.test(idleTxt)
            ? V(isUrduIdleReply(idleTxt), { reply: idleTxt.slice(0, 160) })
            : idleSurface === 'idle-template'
              ? await (async () => {
                  // The driver is English: switch it to Urdu through /language (the one writer), read
                  // the idle answer, switch back. feature-runner also restores the language after the run.
                  const toUr = await pickLang(api, 'اردو');
                  await api.resetFlow();
                  const ur = await api.sendWait('/status');
                  const urTxt = ur.txt || '';
                  await pickLang(api, 'English');
                  return V(isUrduIdleReply(urTxt),
                           { switchedToUrdu: (toUr.txt || '').slice(0, 60), reply: urTxt.slice(0, 160) });
                })()
              : ['BLOCKED', { reason: 'no idle reply observed to check the language of', observedSurface: idleSurface }]), t() - s);
  }

  if (want('STA08')) {
    // STA08 — a flow outside the resumable set is named in words, never by its internal id. A principal's
    // /attendance opens the "tap or voice?" question and parks the conversation on `attendance_method`,
    // which conversation-resume's TASK_LABEL does not name, so /status must de-snake it. Role switching is
    // a harness capability (api.setRole); feature-runner restores the driver's role after the run.
    s = t();
    const roleOk = api.setRole ? (await api.setRole('principal')).ok : false;
    if (!roleOk) {
      rec('STA08', 'An in-flight item is named in plain words, never as an internal identifier', 'BLOCKED',
          { reason: 'this lane cannot switch the driver to a principal (api.setRole)' }, t() - s);
    } else {
      // A principal with no school is told so and nothing starts. Link the driver to the dedicated E2E
      // school api.setRoster seeds (removed by feature-runner's finally) and put the original back after.
      const SB = { ...dbCreds(), drv: process.env.E2E_DRIVER };   // sandbox, or this run's local DB (db-target.cjs)
      const H = SB.key ? { apikey: SB.key, Authorization: `Bearer ${SB.key}`, 'Content-Type': 'application/json' } : null;
      const getJson = async (q) => { try { const r = await fetch(`${SB.url}/rest/v1/${q}`, { headers: H }); return r.ok ? r.json() : []; } catch (_) { return []; } };
      const [me8] = H ? await getJson(`users?select=school_id&phone_number=eq.${SB.drv}`) : [];
      const roster = H ? await api.setRoster() : { ok: false };
      const [sch] = roster.ok ? await getJson(`schools?select=id&emis=eq.E2EOBS${SB.drv}`) : [];
      if (sch) await api.setUser({ school_id: sch.id });
      await api.resetFlow();
      const att = await api.sendWait('/attendance');
      const l8 = await readListing(api);
      const shown = [l8.reply || '', ...(l8.items || [])].join('\n');
      const ids = shown.match(/\b[a-z]+_[a-z_]+\b/g) || [];
      const named = (l8.items || []).some((x) => /attendance/i.test(x));
      rec('STA08', 'An in-flight item is named in plain words, never as an internal identifier',
          ...(named || ids.length
              ? V(named && ids.length === 0, { items: l8.items, claimed: l8.claimed, identifiers: ids, attendanceReply: (att.txt || '').slice(0, 100) })
              : ['BLOCKED', { reason: 'the principal\'s /attendance left nothing in flight to name', listing: l8, attendanceReply: (att.txt || '').slice(0, 160) }]),
          t() - s);
      await api.resetFlow();
      if (sch) await api.setUser({ school_id: (me8 && me8.school_id) || null });
      await api.clearRoster();
      await api.setRole('teacher');
    }
  }

  if (want('STA01', 'STA04') && (deferSTA01 || (want('STA04') && (flowClaimedCount || items.length) <= 1 && canSeed(api)))) {
    // Real work in flight, set up on the driver's own sandbox account: a coaching analysis (STA01),
    // then a Grade 6 lesson plan on top of it — two different kinds at once (STA04). /menu does not
    // count: a glance is not work (STA07).
    s = t();
    const coaching = await seedCoaching(api);
    await sleep(3000);
    const one = await readListing(api);
    if (deferSTA01) {
      rec('STA01', "/status lists the teacher's in-flight work",
          ...((one.claimed || one.items.length)
              ? V(true, { via: 'mock: seeded coaching analysis', claimed: one.claimed, items: one.items.slice(0, 8), coaching })
              : ['BLOCKED', { reason: 'the seeded coaching analysis was not in flight when /status was read', listing: one, coaching }]), t() - s);
    }
    if (want('STA04')) {
      s = t();
      const training = seedTraining(api);
      const two = await readListing(api);
      const n = two.claimed || two.items.length;
      rec('STA04', '/status lists multiple concurrent items',
          ...(n > 1
              ? V(true, { count: two.items.length, claimed: two.claimed, items: two.items.slice(0, 8), seeded: { coaching, training } })
              : ['BLOCKED', { reason: n === 1 ? 'only one item was in flight when /status was read'
                                              : 'nothing was in flight when /status was read', listing: two, seeded: { coaching, training } }]), t() - s);
    }
    // Leave nothing running for the next feature: an analysis parked mid-pipeline answers free text
    // with its own nudge (lesson-plan.cjs L04's history).
    try { api.db('cancel-stuck'); api.db('clear-training-inflight'); } catch (_) {}
    await api.resetFlow();
  } else if (want('STA04')) {
    rec('STA04', '/status lists multiple concurrent items',
        ...((flowClaimedCount || items.length) > 1
            ? V(true, { count: items.length, flowClaimedCount, items: items.slice(0, 8) })
            : ['BLOCKED', { reason: 'nothing was in flight, and this lane cannot start work (no upload)', observed: items }]), 0);
  }

  await runSeeded({ api, rec, sleep, want });
};

// ── STA09–STA16 (bd-q8wt5e.6.3): training and 6-12 lesson plans in flight, seeded straight into the run's own
//    database (teacher-state.service.js listActiveResources reads training_assessment_attempts and
//    niete_lp612_renders). Every row seeded here is removed before the next scenario.
const RENDER_SEG = 'grade_6_computer_science.c01.p006-006';   // in the lane seed (supabase/baseline/seed-keep.json)
const TRAINING_ROW = /Teacher training/i;
const QUESTION_OF = /question \d+ of \d+/i;

/** PostgREST on the run's own database, or null off it (a seed here must never reach a shared database). */
function localDb() {
  const { url, key, kind } = dbCreds();
  if (!url || !key || kind !== 'local') return null;
  const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const call = async (method, p, body) => {
    const r = await fetch(`${url}/rest/v1/${p}`, { method, headers: { ...H, Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${method} ${p.split('?')[0]} ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
    return j;
  };
  return { get: (p) => call('GET', p), post: (t, b) => call('POST', t, b), patch: (p, b) => call('PATCH', p, b), del: (p) => call('DELETE', p) };
}

async function runSeeded({ api, rec, sleep, want }) {
  const ids = ['STA09', 'STA10', 'STA11', 'STA12', 'STA13', 'STA14', 'STA15', 'STA16'];
  if (!ids.some((id) => want(id))) return;
  const t = () => Date.now();
  let s;
  const NAMES = {
    STA09: 'A training quiz in progress is reported as running, in the chat',
    STA10: 'Alongside stoppable work, the training quiz is shown but not offered as a row',
    STA11: 'A training quiz I have already finished is not reported as running',
    STA12: 'A 6-12 lesson plan being prepared is reported as running',
    STA13: 'A lesson plan that has already arrived is not reported as running',
    STA14: 'A lesson plan another teacher is waiting on is never reported as mine',
    STA15: 'A teacher who stops answering the reflection questions gets ONE reminder, not one per worker',
    STA16: 'A stuck portal observation is retried and failed without a WhatsApp message to the coach',
  };
  const R = (id, ...v) => { if (want(id)) rec(id, NAMES[id], ...v); };

  // Not drivable on this lane, with the reason.
  R('STA15', 'BLOCKED', { reason: '@wip @draft, and the race it guards needs 2+ sqs-worker copies sweeping together with '
    + 'COACHING_REMINDER_MINUTES=2; the mock lane runs ONE worker, where it passes either way (the spec says so). '
    + 'Unit: the conditional-claim tests of stale-session.worker.js' }, 0);
  R('STA16', 'BLOCKED', { reason: 'the recovery sweep (stale-session.worker.js) runs on its own timer inside the worker and '
    + 'has no trigger this lane can call, and "shows as stopped in the portal" needs the portal, which the mock '
    + 'lane does not run' }, 0);

  const db = localDb();
  if (!db) {
    for (const id of ['STA09', 'STA10', 'STA11', 'STA12', 'STA13', 'STA14']) {
      R(id, 'BLOCKED', { reason: 'seeds rows into training_assessment_attempts / niete_lp612_renders: only on the run\'s own local database (E2E_LOCAL_DB=1)' }, 0);
    }
    return;
  }
  const drv = process.env.E2E_DRIVER;
  const [me] = await db.get(`users?select=id&phone_number=eq.${drv}`);
  if (!me) { for (const id of ['STA09', 'STA10', 'STA11', 'STA12', 'STA13', 'STA14']) R(id, 'BLOCKED', { reason: 'driver user not found on the run database' }, 0); return; }
  const clean = async () => {
    try { api.db('cancel-stuck'); api.db('clear-training-inflight'); } catch (_) {}
    // anything else stoppable left in the conversation store (the /status Flow's own Stop, as lesson-plan.cjs does)
    try { await require('./reset-state.cjs').run({ api, rec: () => {}, sleep }); } catch (_) {}
    try { await db.del(`training_assessment_attempts?user_id=eq.${me.id}`); } catch (_) {}
    try { await db.del(`niete_lp612_renders?segment_id=eq.${RENDER_SEG}`); } catch (_) {}
    await api.resetFlow();
  };
  /** One in-progress training attempt (question 3 of N) through the tool's own seed; `done` then finishes it the way
   *  a completed attempt reads (status passed, completed_at set; last_activity_at is kept, as the spec says). */
  const seedAttempt = async (done) => {
    const r = api.db('seed-training-inflight');
    if (!r || !r.ok) throw new Error('seed-training-inflight: ' + ((r && r.err) || 'failed'));
    if (done) await db.patch(`training_assessment_attempts?user_id=eq.${me.id}&status=eq.in_progress`,
      { status: 'passed', completed_at: new Date().toISOString(), score: 1, is_passed: true });
    return r;
  };
  const seedRender = async (status, waiterId) => {
    const [seg] = await db.get(`niete_lp612_segments?select=segment_id,menu_title&segment_id=eq.${RENDER_SEG}`);
    const now = new Date().toISOString();
    const [r] = await db.post('niete_lp612_renders', {
      segment_id: RENDER_SEG, lang: 'en', template_version: 'qa-status-seed', status,
      waiters: [{ user_id: waiterId }], requested_by: waiterId === me.id ? me.id : null, started_at: now,
      ...(status === 'ready' ? { completed_at: now, r2_key: 'qa/status-seed.pdf' } : {}) });
    return { render: r, title: seg && seg.menu_title };
  };
  /** /status in the chat: the reply text and whether a "What's running" card came instead. */
  const ask = async () => {
    await api.resetFlow();
    const st = await api.sendWait('/status');
    let txt = st.txt || '';
    for (let w = 0; surfaceOf(txt) === 'neither' && w < 15000; w += 1000) {
      const hit = (await api.fresh()).find((m) => surfaceOf(m.txt || '') !== 'neither');
      if (hit) { txt = hit.txt; break; }
      await sleep(1000);
    }
    const out = { txt, surface: surfaceOf(txt), card: CARD.test(txt) };
    if (out.card) {   // say what was listed, so a card is never an unexplained FAIL
      const op = await api.openFlow(CTA);
      if (op.ok) { const p = await api.flowProbe(); out.listed = (p.text || '').slice(0, 300); api.closeFlow(); }
    }
    return out;
  };
  const step = async (id, fn) => {
    if (!want(id)) return;
    s = t();
    try { await clean(); R(id, ...(await fn()), t() - s); } catch (e) { R(id, 'FAIL', { err: String(e.message || e).slice(0, 200) }, t() - s); }
  };

  await step('STA09', async () => {
    await seedAttempt(false);
    const a = await ask();
    return V(a.surface === 'running-template' && TRAINING_ROW.test(a.txt) && QUESTION_OF.test(a.txt) && !a.card,
      { surface: a.surface, namesTraining: TRAINING_ROW.test(a.txt), questionOf: (a.txt.match(QUESTION_OF) || [null])[0], card: a.card, reply: a.txt.slice(0, 200) });
  });

  await step('STA10', async () => {
    await seedAttempt(false);
    const coaching = await seedCoaching(api);   // an analysis in flight: a live conversation state, stoppable
    await sleep(3000);
    const l = await readListing(api);
    if (l.surface !== 'flow-card') {
      return ['BLOCKED', { reason: 'the seeded coaching session was not in flight when /status was read, so there was no stoppable work beside the quiz', listing: l, coaching }];
    }
    const rows = l.items.filter((x) => !/^You have|^•/.test(x));
    const trainingRow = rows.some((x) => TRAINING_ROW.test(x));
    // the summary bullets are part of the screen text; read it again for them
    return V((l.claimed || 0) >= 2 && rows.length > 0 && !trainingRow,
      { claimed: l.claimed, rows: rows.slice(0, 8), trainingOfferedAsRow: trainingRow, coaching });
  });

  await step('STA11', async () => {
    await seedAttempt(true);
    const a = await ask();
    return V(a.surface === 'idle-template' && !TRAINING_ROW.test(a.txt), { surface: a.surface, reply: a.txt.slice(0, 160) });
  });

  await step('STA12', async () => {
    const { title } = await seedRender('authoring', me.id);
    const a = await ask();
    const named = title ? a.txt.includes(title.slice(0, 40)) : /Lesson plan/i.test(a.txt);
    return V(a.surface === 'running-template' && /Lesson plan/i.test(a.txt) && named && !a.card,
      { surface: a.surface, menuTitle: title, named, card: a.card, reply: a.txt.slice(0, 200), listed: a.listed,
        noStopRow: 'a text reply offers no row; the card (where rows live) did not come' });
  });

  await step('STA13', async () => {
    await seedRender('ready', me.id);
    const a = await ask();
    return V(a.surface === 'idle-template', { surface: a.surface, reply: a.txt.slice(0, 160), listed: a.listed });
  });

  await step('STA14', async () => {
    const other = '00000000-0000-4000-8000-0000000051a1';   // another teacher's id: only the waiters list names her
    const { title } = await seedRender('authoring', other);
    const a = await ask();
    const leaked = !!(title && a.txt.includes(title.slice(0, 40)));
    return V(a.surface === 'idle-template' && !leaked, { surface: a.surface, otherLessonNamed: leaked, reply: a.txt.slice(0, 160), listed: a.listed });
  });

  await clean();
}
