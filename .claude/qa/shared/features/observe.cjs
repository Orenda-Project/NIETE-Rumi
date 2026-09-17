// @mock-lane — mock-capable driver (uses the mock API, not the browser DOM). Its presence enrols this feature in the mock lane; E2E_MOCK_FEATURES is derived from this marker, so there is no hardcoded list.
/* observe.feature — mock-lane driver.
 *
 * WHAT RUNS HERE, AND WHY MOST OF IT CANNOT.
 * observe is capability-gated on OBSERVE_MEWAKA_FLOW_ID (observe-gate.js:62 —
 * evaluated BEFORE role/user). That env var is UNSET on the mock runtime
 * (keys/niete-local.env carries no OBSERVE_* keys), so `/observe` returns
 * {match:false} for EVERY user and falls through to normal handling. That is the
 * dark-safe default — and it is exactly what OBS21 asserts, so OBS21 is the one
 * scenario genuinely reachable on this lane, and it is DRIVEN.
 *
 * Everything else records BLOCKED, for one of three honest reasons:
 *   FLOW  — the scenario lives inside a WhatsApp Flow screen (visit picker, FICO
 *           form, scheduling). The mock lane does not render Flows by design.
 *   AUDIO — the scenario needs a captured recording; the mock lane cannot supply one.
 *   GATE  — the scenario needs the capability gate ON (role denial, entry, onboard,
 *           capture). Turning it on requires a dedicated observe env baseline
 *           (OBSERVE_MEWAKA_FLOW_ID + OBSERVE_VISIT_FLOW_ID + a flow-emulator
 *           manifest). Setting it globally would also change the menu role tests
 *           (M14–M19), so it is a scoped follow-up, not slipped in here.
 *   STATE — needs a captured-observation / pending-debrief / completed-analysis
 *           state that only the AUDIO+FLOW path produces.
 *   FAULT — needs an injected DB/send failure the mock lane does not offer.
 *
 * Assertions were grounded by reading observe-gate.js and observe-command.handler.js
 * (no invented copy). */
const V = (c, ev) => [c ? 'PASS' : 'FAIL', ev];
const B = (reason) => ['BLOCKED', { reason }];
const FLOW  = B('WhatsApp Flow screen — the mock lane does not render Flows (BLOCKED by design)');
const AUDIO = B('audio recording capture — not exercisable on the mock lane');
const GATE  = B('OBSERVE_MEWAKA_FLOW_ID (observe capability gate) is unset on the mock runtime, so /observe falls through for everyone — the dark-safe default OBS21 verifies. Reaching this needs a dedicated observe env baseline (gate + OBSERVE_VISIT_FLOW_ID + flow-emulator manifest): a scoped follow-up (would also alter the menu role tests if set globally)');
const STATE = B('requires a captured-observation / pending-debrief / completed-analysis state that only the audio+Flow path produces — not reachable on the mock lane');
const FAULT = B('requires an injected DB-write / report-send fault the mock lane does not provide');

exports.run = async ({ api, rec }) => {
  await api.resetFlow();
  const head = (t) => (t || '').split('\n')[0];
  const isObserveEntry = (r) =>
    /plan your visit|Plan my visit|دورہ چنیں|منصوبہ بندی/i.test((r.txt || '') + ' ' + (r.btns || []).join(' '));

  // ── OBS21 — DRIVEN: capability gate OFF → /observe falls through, handled as normal ──
  // observe-gate.js:62 — with OBSERVE_MEWAKA_FLOW_ID unset (the mock runtime's state),
  // evaluateObserveTrigger returns {match:false}; the observe handler declines and the
  // message is handled normally. The invariant: /observe does NOT open the observation
  // product. This is the dark-safe capability gate — a P2 negative worth pinning.
  const t0 = Date.now();
  const r21 = await api.sendWait('/observe', 120000);
  rec('OBS21', '/observe is inert when the observation Flow is not configured',
      ...V(r21.ok && !isObserveEntry(r21),
        { fellThrough: !isObserveEntry(r21), reply: (r21.txt || '').slice(0, 140), header: head(r21.txt) }),
      Date.now() - t0);

  // ── everything below: BLOCKED, with the honest reason (see file header) ──
  rec('OBS01', "A leader's /observe opens the capture/visit entry point", ...GATE, 0);
  rec('OBS02', 'First-ever /observe shows the one-time onboarding', ...GATE, 0);
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
  rec('OBS16', "A leader with no saved roster is asked for the teacher's name and number", ...GATE, 0);
  rec('OBS17', 'The teacher picker paginates when a school has many teachers', ...FLOW, 0);
  rec('OBS18', 'A report send outside the 24h window goes via an approved template', ...STATE, 0);
  rec('OBS19', 'A scheduled visit cannot be cancelled from the WhatsApp Flow', ...FLOW, 0);
  rec('OBS20', '/observe from a teacher account is denied (and the teacher is unaffected)', ...GATE, 0);
  rec('OBS22', '/observe before an account exists reports no account', ...GATE, 0);
  rec('OBS23', 'A harmful debrief is gated — a concern, never praise, no card', ...STATE, 0);
  rec('OBS24', 'The FICO form refuses a session that is not the observer\'s own', ...FLOW, 0);
  rec('OBS25', "A leader's long audio with no active state never starts teacher coaching", ...AUDIO, 0);
  rec('OBS26', 'A capture whose DB write fails reports a capture failure, not "no account"', ...FAULT, 0);
  rec('OBS27', 'A too-short debrief recording is refused and stays pending', ...AUDIO, 0);
  rec('OBS28', 'A failed report send is surfaced to the coach with a retry', ...FAULT, 0);
  rec('OBS29', 'A cancelled observation stays cancelled whichever old button is tapped', ...STATE, 0);
  rec('OBS30', "Reopening a cancelled observation's form names the real reason, once", ...STATE, 0);
  rec('OBS31', 'The FICO report total reflects the real 148-point maximum', ...STATE, 0);
  rec('OBS32', 'The Observe a Teacher menu row opens the same /observe entry', ...GATE, 0);
  rec('OBS33', "A principal's OWN lesson recording reaches Digital Coach, not the binding list", ...AUDIO, 0);
  rec('OBS34', 'A principal who HAS started an observation still captures it as an observation', ...AUDIO, 0);
  rec('OBS35', 'A leader recording with nothing declared is still asked whose it is', ...AUDIO, 0);
  rec('OBS36', 'A coach never reaches her own Digital Coach, even after tapping an old DC row', ...STATE, 0);
};
