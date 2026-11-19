'use strict';
/* niete_lp_whatsapp_off_case.cjs — the step lesson-plan L13/L14 take (bd-96f69c.8): set lp_whatsapp_pdf_off to a list of
 * programmes ("ict", "gb"), send /lp, and report what came back. The driver teacher is ICT (not a GB teacher).
 * api.setAppSetting only flips the run's own database (E2E_LOCAL_DB=1) and refuses a shared one: then { ran: false }.
 * The switch is put back whatever happens. */
const GO_LINK = /\/go\/[A-Za-z0-9_-]{40,}$/;

exports.sendLpWithPdfOff = async (api, programmes, CARD) => {
  if (!api || typeof api.setAppSetting !== 'function') return { ran: false, reason: 'GLOBAL_SWITCH: this lane cannot flip app_settings' };
  const flip = await api.setAppSetting('lp_whatsapp_pdf_off', programmes);
  if (!flip || !flip.ok) return { ran: false, reason: (flip && flip.err) || 'GLOBAL_SWITCH' };
  try {
    if (typeof api.resetRedirectNotice === 'function') await api.resetRedirectNotice();
    await api.resetFlow();
    if (api.freshReset) await api.freshReset();
    const t0 = Date.now(), r = await api.sendWait('/lp', 60000);
    const items = api.fresh ? await api.fresh() : [];
    const cta = items.map((i) => i.cta).find((c) => c && c.url) || null;
    return { ran: true, ms: Date.now() - t0, value: {
      programmes, appLink: !!(cta && GO_LINK.test(cta.url)), card: CARD.test(r.txt || '') && (r.btns || []).length > 0,
      messages: r.freshIds, pdf: items.some((i) => i.document || i.type === 'document'), reply: String(r.txt || '').slice(0, 160) } };
  } finally {
    await api.restoreAppSettings();
    await api.resetFlow();
  }
};
