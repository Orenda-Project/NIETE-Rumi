/* reset-state — leave the driver account with nothing in flight, through the product's own surface:
 * /status → Open status → "Stop: …" for every in-flight item. Used between features so a state left by
 * one feature (menu M03 leaves coaching AWAITING_CLASSROOM_AUDIO, which swallows free text for 6h) does
 * not contaminate the next feature's free-text verdicts (L04/T15/STA03 on 2026-09-02). */
exports.run = async ({ api, rec, sleep }) => {
  const t = Date.now();
  await api.resetFlow();
  const st = await api.sendWait('/status');
  // Since PR #801 (2026-09-08) an EMPTY store is answered in the chat — "Nothing's running right
  // now…" / "اس وقت کچھ نہیں چل رہا" — and no Flow card is sent. That is the state this routine
  // exists to reach, so it is a pass, not a missing card. Only when something IS running does the
  // Flow (the one surface that can stop it) appear.
  const IDLE = /Nothing's running right now|کچھ نہیں چل رہا/i;
  if (IDLE.test(st.txt || '')) {
    rec('RESET', 'nothing left in flight on the driver', 'INFO',
        { card: (st.txt || '').slice(0, 60), opened: false, nothingInFlight: true, stopped: [] }, Date.now() - t);
    return;
  }
  const op = await api.openFlow('Open status|کھولیں');
  const stopped = [];
  if (op.ok) {
    for (let i = 0; i < 4; i++) {
      const p = await api.flowProbe();
      const stop = (p.items || []).find(x => /^Stop/i.test(x.text || '') && !x.disabled);
      if (!stop) break;
      // The screen is a radio list ("Continue: X" / "Stop: X") with a "Continue" submit, then a
      // confirm screen with "Yes, stop it" (driven live 2026-09-01 19:47). Select, submit, confirm.
      // flowClick matches by lower-cased SUBSTRING (exact:true for whole-text) — not regex.
      const r = await api.flowClick('stop: ', { settleMs: 1200 });
      const sub = await api.flowClick('Continue', { exact: true, settleMs: 2500 });
      const yes = await api.flowClick('yes, stop it', { settleMs: 3000 });
      stopped.push({ clicked: stop.text, selected: !!(r && r.ok), submitted: !!(sub && sub.ok), confirmed: !!(yes && yes.ok) });
      if (!(yes && yes.ok)) break;
    }
  }
  const after = op.ok ? await api.flowProbe() : { text: '' };
  await api.resetFlow();
  rec('RESET', 'nothing left in flight on the driver', op.ok ? 'INFO' : 'BLOCKED',
      { card: (st.txt || '').slice(0, 60), opened: op.ok, err: op.err, stopped, after: (after.text || '').slice(0, 200) }, Date.now() - t);
};
