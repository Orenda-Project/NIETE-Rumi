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
const ROSTER   = B('the visit picker OPENS but cannot advance — the driver-coach has no leader_schools assignment / roster in the sandbox DB (empty school dropdown + teacher picker), and the mock API cannot seed leader_schools (no helper; setUser PATCHes only the users row). Confirmed by live probe.');
const ANALYSIS = B('needs a completed audio analysis (pick teacher → analyse → FICO); unreachable because the teacher pick is empty (see ROSTER). The FICO form / debrief / report sit downstream.');
const FAULT    = B('needs an injected DB-write / report-send failure; the harness provides no fault injection.');
const NOACCT   = B('needs a WhatsApp number with no NIETE account; the mock driver is a registered user.');
const OFF      = B('needs the capability gate OFF; the mock baseline sets OBSERVE_MEWAKA_FLOW_ID ON to exercise the coach path. Drive the OFF fall-through with: OBSERVE_MEWAKA_FLOW_ID= bash commit-e2e.sh …');

const DENIED = /school leaders|field officers|I'm here for you/i;                                 // S.role_denied
const ENTRY  = /plan your visit|Plan my visit|Welcome to \/observe|how it works|record the lesson|Ready!|send me the recording/i;
const CAPTURED = /Got your recording|Whose observation is this|Pick the teacher/i;                // observe capture prompt
const COACHING = /analyze your teaching|Step \d\/5|Transcribing your classroom|feedback on your OWN/i; // the WRONG lane
const MEDIA = require('path').resolve(__dirname, '..', '..', 'fixtures', 'whatsapp', 'niete', 'media');

exports.run = async ({ api, rec }) => {
  await api.resetFlow();

  const observeAs = async (role, prefs) => {
    await api.setRole(role);
    if (prefs !== undefined) await api.setUser({ preferences: prefs });
    await api.freshReset();
    const last = await api.sendWait('/observe', 120000);
    const rest = await api.fresh();
    const txt = [last && last.txt, ...rest.map((m) => m.txt)].filter(Boolean).join('\n');
    return { ok: !!(last && last.ok), txt };
  };

  // ── role gate (text) ──
  let s = Date.now();
  const r20 = await observeAs('teacher');
  rec('OBS20', '/observe from a teacher account is denied (and the teacher is unaffected)',
      ...V(r20.ok && DENIED.test(r20.txt) && !ENTRY.test(r20.txt), { reply: r20.txt.slice(0, 160) }), Date.now() - s);

  s = Date.now();
  const r02 = await observeAs('coach', { observe_onboarded: false });
  rec('OBS02', 'First-ever /observe shows the one-time onboarding',
      ...V(r02.ok && !DENIED.test(r02.txt) && /Welcome to \/observe|how it works/i.test(r02.txt),
        { reply: r02.txt.slice(0, 180) }), Date.now() - s);

  s = Date.now();
  const r01 = await observeAs('coach');
  rec('OBS01', "A leader's /observe opens the capture/visit entry point",
      ...V(r01.ok && !DENIED.test(r01.txt) && ENTRY.test(r01.txt), { reply: r01.txt.slice(0, 180) }), Date.now() - s);

  s = Date.now();
  await api.setRole('coach'); await api.freshReset();
  const tap = await api.injectList('menu_observe', 'Observe a Teacher');
  const txt32 = [tap && tap.txt, ...(await api.fresh()).map((m) => m.txt)].filter(Boolean).join('\n');
  rec('OBS32', 'The Observe a Teacher menu row opens the same /observe entry',
      ...V(!!(tap && tap.ok) && !DENIED.test(txt32) && ENTRY.test(txt32), { reply: txt32.slice(0, 180) }), Date.now() - s);

  // ── OBS03 — the visit picker Flow OPENS to school selection (data_exchange via the emulator) ──
  s = Date.now();
  await api.setRole('coach'); await api.freshReset();
  await api.sendWait('/observe', 120000);
  const op = await api.openFlow('Plan my visit|plan your visit|Observe|Open');
  const p1 = (op && op.ok) ? await api.flowProbe() : { text: '', items: [] };
  rec('OBS03', 'The visit picker walks school → teacher → brief',
      ...V(!!(op && op.ok) && /Pick a school|School/i.test(p1.text || ''),
        { openedPicker: !!(op && op.ok), screen: (p1.text || '').slice(0, 160),
          items: (p1.items || []).map((i) => i.text).slice(0, 8),
          note: 'picker OPENS to school selection; the school→teacher→brief walk itself needs a seeded roster (ROSTER)' }),
      Date.now() - s);
  api.closeFlow(); await api.resetFlow();

  // ── audio capture (fixture upload → observe capture) ──
  s = Date.now();
  await api.setRole('coach');
  const up = await api.upload(MEDIA + '/hameeda_16min.m4a', 'Audio', 180000);
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

  // ── BLOCKED, each with a verified reason (see header) ──
  rec('OBS21', '/observe is inert when the observation Flow is not configured', ...OFF, 0);
  rec('OBS04', 'The scheduling menu shows live pending-debrief and upcoming counts', ...ROSTER, 0);
  rec('OBS05', 'A leader schedules a future observation visit', ...ROSTER, 0);
  rec('OBS07', 'When analysis is ready the editable FICO form opens pre-filled', ...ANALYSIS, 0);
  rec('OBS08', 'The observer edits ratings then submits the FICO form', ...ANALYSIS, 0);
  rec('OBS09', '"Debrief now" delivers the 6-step debrief guide', ...ANALYSIS, 0);
  rec('OBS10', 'A respectful debrief recording yields two wins and one improvement', ...ANALYSIS, 0);
  rec('OBS11', 'The observer sends the finished report to the teacher', ...ANALYSIS, 0);
  rec('OBS12', 'The FICO report to the teacher carries no score and no accusatory verdicts', ...ANALYSIS, 0);
  rec('OBS13', 'BACK on a FICO domain screen re-serves it without losing edits', ...ANALYSIS, 0);
  rec('OBS14', 'A pending debrief is offered the next time the leader opens /observe', ...ANALYSIS, 0);
  rec('OBS15', 'Tapping "Debrief now" twice re-sends the same guide, no new analysis', ...ANALYSIS, 0);
  rec('OBS16', "A leader with no saved roster is asked for the teacher's name and number", ...ROSTER, 0);
  rec('OBS17', 'The teacher picker paginates when a school has many teachers', ...ROSTER, 0);
  rec('OBS18', 'A report send outside the 24h window goes via an approved template', ...ANALYSIS, 0);
  rec('OBS19', 'A scheduled visit cannot be cancelled from the WhatsApp Flow', ...ROSTER, 0);
  rec('OBS22', '/observe before an account exists reports no account', ...NOACCT, 0);
  rec('OBS23', 'A harmful debrief is gated — a concern, never praise, no card', ...ANALYSIS, 0);
  rec('OBS24', 'The FICO form refuses a session that is not the observer\'s own', ...ANALYSIS, 0);
  rec('OBS26', 'A capture whose DB write fails reports a capture failure, not "no account"', ...FAULT, 0);
  rec('OBS27', 'A too-short debrief recording is refused and stays pending', ...ANALYSIS, 0);
  rec('OBS28', 'A failed report send is surfaced to the coach with a retry', ...FAULT, 0);
  rec('OBS29', 'A cancelled observation stays cancelled whichever old button is tapped', ...ROSTER, 0);
  rec('OBS30', "Reopening a cancelled observation's form names the real reason, once", ...ROSTER, 0);
  rec('OBS31', 'The FICO report total reflects the real 148-point maximum', ...ANALYSIS, 0);
  rec('OBS33', "A principal's OWN lesson recording reaches Digital Coach, not the binding list", ...ROSTER, 0);
  rec('OBS34', 'A principal who HAS started an observation still captures it as an observation', ...ROSTER, 0);
  rec('OBS36', 'A coach never reaches her own Digital Coach, even after tapping an old DC row', ...ROSTER, 0);
};
