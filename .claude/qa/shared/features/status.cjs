/* status.feature — 4 @e2e scenarios.
 *
 * SURFACE CHANGE (observed live 2026-09-01): the spec describes a TEXT reply beginning
 * "Running for you:". The build now answers /status with a Flow card —
 *   "What's running / See everything you have in flight — and stop any of it. /
 *    Powered by NIETE"  + CTA "Open status"
 * — so the listing lives inside the Flow, not in the message body. Asserting the old
 * template only proves the template is gone; it says nothing about whether the feature
 * works. So: assert the BEHAVIOUR through the Flow, and record the divergence separately
 * as its own finding for whoever owns the spec.
 *
 * Ordering: run AFTER coaching, which leaves an analysis in flight for STA01/STA04.
 */
const V = (c, ev) => [c ? 'PASS' : 'FAIL', ev];
const RUNNING  = /Running for you:/i;
const IDLE     = /Nothing's running right now|کچھ نہیں چل رہا/i;
const CARD     = /What's running|Open status/i;
const CTA      = 'Open status|کھولیں';

const surfaceOf = txt => CARD.test(txt) ? 'flow-card'
                       : RUNNING.test(txt) ? 'running-template'
                       : IDLE.test(txt) ? 'idle-template' : 'neither';

exports.run = async ({ api, rec }) => {
  const t = () => Date.now();
  let s;
  await api.resetFlow();

  s = t();
  await api.sendWait('/menu');                       // settle before the first measured send
  const st = await api.sendWait('/status');
  const txt = st.txt || '';
  const surface = surfaceOf(txt);

  // The divergence itself, recorded once, as a finding rather than buried in a FAIL.
  rec('STA-surface', 'The /status surface matches the documented contract',
      ...V(surface === 'running-template' || surface === 'idle-template',
           { observedSurface: surface,
             documented: '"Running for you:" text template (spec) ',
             actual: txt.slice(0, 180),
             impact: surface === 'flow-card'
               ? 'the in-flight listing moved INSIDE a Flow; the spec and any text-matching '
               + 'assertion are stale. Not a defect on its face — needs a spec decision.' : null }), t() - s);

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
  rec('STA01', "/status lists the teacher's in-flight work",
      ...(items.length
          ? V(true, { via, count: items.length, flowClaimedCount, items: items.slice(0, 8) })
          : idle
            ? ['BLOCKED', { via, reason: 'nothing was in flight, so there is no listing to assert — the '
                                       + 'idle answer is correct but proves nothing about listing',
                            screen: (flowText || txt).slice(0, 200) }]
            : ['BLOCKED', { via, reason: 'could not read a listing from the status surface',
                            screen: (flowText || txt).slice(0, 200) }]), t() - s);

  // STA02 — case-insensitive + tolerates trailing text: same SURFACE either way.
  s = t();
  await api.resetFlow();
  const loud = await api.sendWait('/STATUS now');
  const loudSurface = surfaceOf(loud.txt || '');
  rec('STA02', '/status is case-insensitive and tolerates trailing text',
      ...V(loudSurface !== 'neither' && loudSurface === surface,
           { lower: surface, upper: loudSurface,
             note: 'compares the surface each produces, not a fixed template — the surface is a Flow card on this build',
             reply: (loud.txt || '').slice(0, 160) }), t() - s);

  // STA03 — a bare "status" must NOT open the status surface (shape, never wording)
  s = t();
  const bare = await api.sendWait('status');
  const bareSurface = surfaceOf(bare.txt || '');
  rec('STA03', 'A bare "status" (no slash) does not open the status surface',
      ...V(bareSurface === 'neither',
           { observedSurface: bareSurface, reply: (bare.txt || '').slice(0, 180) }), t() - s);

  // STA04 — more than one kind of work at once. The chrome lane relies on ordering (coaching leaves an
  // analysis in flight). The mock lane can SET UP the precondition on its sandbox driver: start a coaching
  // analysis (classroom recording → Yes, Analyze; it parks on the photo prompt, in flight) and open /menu
  // (a resumable flow) — two different kinds — then read the Flow again.
  s = t();
  let seeded = null;
  if ((flowClaimedCount || items.length) <= 1 && api.caps && api.caps.method === 'mock' && api.caps.upload) {
    const MEDIA = require('path').resolve(__dirname, '..', '..', 'fixtures', 'whatsapp', 'niete', 'media');
    const fs = require('fs');
    const rec16 = fs.readdirSync(MEDIA).find((f) => /classroom|16|hameeda_full|lesson/i.test(f) && !/short/i.test(f) && /\.(m4a|mp3|ogg|mp4)$/i.test(f));
    if (rec16) {
      await api.resetFlow();
      const up = await api.upload(require('path').join(MEDIA, rec16), 'Document', 180000);
      if ((up.btns || []).some((b) => /Yes, Analyze/i.test(b))) await api.tapAndWait('Yes, Analyze', 120000);
      await api.sendWait('/menu');
      await api.sendWait('/status');
      const op2 = await api.openFlow(CTA);
      if (op2.ok) {
        const p2 = await api.flowProbe();
        const claimed2 = /You have (\d+) things? running/i.exec(p2.text || '');
        flowClaimedCount = claimed2 ? Number(claimed2[1]) : flowClaimedCount;
        items = (p2.items || []).map(i => (i.text || '').trim()).filter(Boolean).filter(x => !/^(Open status|Back|Close|Powered by|Done)/i.test(x)).filter((v, k, a) => a.indexOf(v) === k);
        seeded = { via: 'mock precondition: coaching analysis + /menu', upload: (up.txt || '').slice(0, 80), claimed: flowClaimedCount };
      } else seeded = { err: op2.err };
      api.closeFlow();
    } else seeded = { err: 'no classroom recording fixture under ' + MEDIA };
  }
  rec('STA04', '/status lists multiple concurrent items',
      ...((flowClaimedCount || items.length) > 1
          ? V(true, { count: items.length, flowClaimedCount, items: items.slice(0, 8), seeded })
          : ['BLOCKED', { seeded, reason: items.length === 1
                ? 'only one item was in flight; this needs two kinds at once (e.g. a coaching analysis AND a lesson plan)'
                : 'nothing was in flight for this account', observed: items }]), t() - s);
};
