// @mock-lane — mock-capable driver (uses the mock API, not the browser DOM). Its presence enrols this feature in the mock lane; E2E_MOCK_FEATURES is derived from this marker, so there is no hardcoded list.
/* observe.feature — mock-lane driver.
 *
 * observe is a COACH/leader feature, capability-gated on OBSERVE_MEWAKA_FLOW_ID
 * (observe-gate.js:62, checked before role/user). The mock baseline (local-stack.sh)
 * sets that var truthy so /observe reaches the role gate — which is what lets this
 * driver test the REAL thing: a coach is let in, a teacher is denied. Verified safe
 * for the menu role tests (M14–M19): the "Observe a Teacher" row is gated on
 * canObserve(role) in role-features.js, NOT on this var.
 *
 * OBSERVE_VISIT_FLOW_ID is deliberately left UNSET, so the coach entry degrades to
 * the TEXT capture-prompt (drivable) instead of the visit-picker Flow (BLOCKED).
 *
 * DRIVEN (role gate + entry, all text): OBS20 teacher-denied · OBS02 coach onboarding
 *   · OBS01 coach entry opens · OBS32 menu "Observe a Teacher" row delegates to /observe.
 * BLOCKED, with an honest reason:
 *   FLOW  — a WhatsApp Flow screen (visit picker, FICO form, scheduling); not rendered here.
 *   AUDIO — needs a captured recording.
 *   STATE — needs a captured/pending/analysed observation state the audio+Flow path produces.
 *   FAULT — needs an injected DB/send failure.
 *   OFF   — needs the capability gate OFF; the mock baseline runs it ON to exercise the
 *           coach path. Override OBSERVE_MEWAKA_FLOW_ID= to drive the OFF fall-through.
 *
 * Copy grounded in observe-strings.js (en) + observe-command.handler.js. */
const V = (c, ev) => [c ? 'PASS' : 'FAIL', ev];
const B = (reason) => ['BLOCKED', { reason }];
const FLOW  = B('WhatsApp Flow screen — the mock lane does not render Flows (BLOCKED by design)');
const AUDIO = B('audio recording capture — not exercisable on the mock lane');
const STATE = B('requires a captured-observation / pending-debrief / completed-analysis state that only the audio+Flow path produces — not reachable on the mock lane');
const FAULT = B('requires an injected DB-write / report-send fault the mock lane does not provide');
const OFF   = B('needs the capability gate OFF; the mock baseline sets OBSERVE_MEWAKA_FLOW_ID ON to exercise the coach path. Drive the OFF fall-through with: OBSERVE_MEWAKA_FLOW_ID= bash commit-e2e.sh …');

const DENIED = /school leaders|field officers|I'm here for you/i;                       // S.role_denied
const ENTRY  = /plan your visit|Plan my visit|Welcome to \/observe|how it works|record the lesson|Ready!|pre-filled FICO|send me the recording/i; // visit-plan entry OR onboarding OR capture_prompt

exports.run = async ({ api, rec }) => {
  await api.resetFlow();

  // Send /observe as `role`, optionally seeding preferences first, and collect EVERY message
  // (onboard + capture-prompt land as two). freshReset()→sendWait()→fresh() gives the whole burst.
  const observeAs = async (role, prefs) => {
    await api.setRole(role);
    if (prefs !== undefined) await api.setUser({ preferences: prefs });
    await api.freshReset();
    const last = await api.sendWait('/observe', 120000);
    const rest = await api.fresh();
    const txt = [last && last.txt, ...rest.map((m) => m.txt)].filter(Boolean).join('\n');
    return { ok: !!(last && last.ok), txt };
  };

  // OBS20 — a TEACHER is denied (and pointed back to the menu), unaffected.
  let s = Date.now();
  const r20 = await observeAs('teacher');
  rec('OBS20', '/observe from a teacher account is denied (and the teacher is unaffected)',
      ...V(r20.ok && DENIED.test(r20.txt) && !ENTRY.test(r20.txt),
        { denied: DENIED.test(r20.txt), reply: r20.txt.slice(0, 160) }), Date.now() - s);

  // OBS02 — a COACH's FIRST /observe shows the one-time onboarding (seed not-onboarded).
  s = Date.now();
  const r02 = await observeAs('coach', { observe_onboarded: false });
  rec('OBS02', 'First-ever /observe shows the one-time onboarding',
      ...V(r02.ok && !DENIED.test(r02.txt) && /Welcome to \/observe|how it works/i.test(r02.txt),
        { onboarding: /Welcome to \/observe/i.test(r02.txt), reply: r02.txt.slice(0, 200) }), Date.now() - s);

  // OBS01 — a COACH is let in: /observe opens the entry (now onboarded → text capture-prompt), NOT denied.
  s = Date.now();
  const r01 = await observeAs('coach');
  rec('OBS01', "A leader's /observe opens the capture/visit entry point",
      ...V(r01.ok && !DENIED.test(r01.txt) && ENTRY.test(r01.txt),
        { notDenied: !DENIED.test(r01.txt), entryOpened: ENTRY.test(r01.txt), reply: r01.txt.slice(0, 200) }), Date.now() - s);

  // OBS32 — the "Observe a Teacher" menu row (coach) delegates to the SAME /observe entry.
  s = Date.now();
  await api.setRole('coach');
  await api.freshReset();
  const tap = await api.injectList('menu_observe', 'Observe a Teacher');
  const rest32 = await api.fresh();
  const txt32 = [tap && tap.txt, ...rest32.map((m) => m.txt)].filter(Boolean).join('\n');
  rec('OBS32', 'The Observe a Teacher menu row opens the same /observe entry',
      ...V(!!(tap && tap.ok) && !DENIED.test(txt32) && ENTRY.test(txt32),
        { reply: txt32.slice(0, 200) }), Date.now() - s);

  // ── BLOCKED, with honest reasons (see header) ──
  rec('OBS21', '/observe is inert when the observation Flow is not configured', ...OFF, 0);
  rec('OBS03', 'The visit picker walks school → teacher → brief', ...FLOW, 0);
  rec('OBS04', 'The scheduling menu shows live pending-debrief and upcoming counts', ...FLOW, 0);
  rec('OBS05', 'A leader schedules a future observation visit', ...FLOW, 0);
  rec('OBS06', "A leader's recording is captured without a Yes/No confirmation", ...AUDIO, 0);
  rec('OBS07', 'When analysis is ready the editable FICO form opens pre-filled', ...FLOW, 0);
  rec('OBS08', 'The observer edits ratings then submits the FICO form', ...FLOW, 0);
  rec('OBS09', '"Debrief now" delivers the 6-step debrief guide', ...STATE, 0);
  rec('OBS10', 'A respectful debrief recording yields two wins and one improvement', ...AUDIO, 0);
  rec('OBS11', 'The observer sends the finished report to the teacher', ...STATE, 0);
  rec('OBS12', 'The FICO report to the teacher carries no score and no accusatory verdicts', ...STATE, 0);
  rec('OBS13', 'BACK on a FICO domain screen re-serves it without losing edits', ...FLOW, 0);
  rec('OBS14', 'A pending debrief is offered the next time the leader opens /observe', ...STATE, 0);
  rec('OBS15', 'Tapping "Debrief now" twice re-sends the same guide, no new analysis', ...STATE, 0);
  rec('OBS16', "A leader with no saved roster is asked for the teacher's name and number", ...STATE, 0);
  rec('OBS17', 'The teacher picker paginates when a school has many teachers', ...FLOW, 0);
  rec('OBS18', 'A report send outside the 24h window goes via an approved template', ...STATE, 0);
  rec('OBS19', 'A scheduled visit cannot be cancelled from the WhatsApp Flow', ...FLOW, 0);
  rec('OBS22', '/observe before an account exists reports no account', ...STATE, 0);
  rec('OBS23', 'A harmful debrief is gated — a concern, never praise, no card', ...STATE, 0);
  rec('OBS24', 'The FICO form refuses a session that is not the observer\'s own', ...FLOW, 0);
  rec('OBS25', "A leader's long audio with no active state never starts teacher coaching", ...AUDIO, 0);
  rec('OBS26', 'A capture whose DB write fails reports a capture failure, not "no account"', ...FAULT, 0);
  rec('OBS27', 'A too-short debrief recording is refused and stays pending', ...AUDIO, 0);
  rec('OBS28', 'A failed report send is surfaced to the coach with a retry', ...FAULT, 0);
  rec('OBS29', 'A cancelled observation stays cancelled whichever old button is tapped', ...STATE, 0);
  rec('OBS30', "Reopening a cancelled observation's form names the real reason, once", ...STATE, 0);
  rec('OBS31', 'The FICO report total reflects the real 148-point maximum', ...STATE, 0);
  rec('OBS33', "A principal's OWN lesson recording reaches Digital Coach, not the binding list", ...AUDIO, 0);
  rec('OBS34', 'A principal who HAS started an observation still captures it as an observation', ...AUDIO, 0);
  rec('OBS35', 'A leader recording with nothing declared is still asked whose it is', ...AUDIO, 0);
  rec('OBS36', 'A coach never reaches her own Digital Coach, even after tapping an old DC row', ...STATE, 0);
};
