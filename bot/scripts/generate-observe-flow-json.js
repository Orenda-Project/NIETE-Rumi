#!/usr/bin/env node
/**
 * FEAT-053 bd-18 — generate docs/flows/observe-mewaka-flow.json from the
 * MEWAKA framework module (single source of truth: 6 domains, 25 indicators,
 * 0-3 scale, bilingual). Regenerate + re-upload whenever the framework changes:
 *
 *   node scripts/generate-observe-flow-json.js
 *
 * Design (deployment plan §4 + whatsapp-flows skill):
 * - Pure data_exchange flow (registration precedent, bd-720): INIT returns the
 *   first domain screen's prefill; every "Continue" data_exchange returns the
 *   next screen's prefill. Forward-only routing (bd-1248).
 * - Per indicator: RadioButtonsGroup r_<id> (0-3, Swahili labels) +
 *   TextArea ev_<id> (evidence) + TextArea imp_<id> (what to improve).
 *   Field names use underscores (A1.1 → A1_1) — dots are not valid names.
 * - Worst screen (B, 8 indicators) ≈ 26 components — under Meta's 50 cap.
 */

const fs = require('fs');
const path = require('path');
// FEAT-093 bd-52: pack-driven — OBSERVE_FRAMEWORK=hots node scripts/generate-observe-flow-json.js
// writes docs/flows/observe-hots-flow.json (5 screens, bilingual ur/en static
// labels — a published Flow is one document, so static labels are bilingual
// while all dynamic prefill content follows the officer's locked language).
const { getObservePack } = require('../shared/services/observe/observe-framework.js');
const PACK = getObservePack();
const mewaka = require('../shared/services/coaching/frameworks/mewaka-framework.js');

const domains = PACK.domains;
const DOMAIN_ORDER = PACK.domainOrder;

// Per-pack static labels. A published Flow is ONE document, so hots gets
// short bilingual ur/en labels; mewaka keeps its Swahili labels verbatim.
const L = PACK.key === 'hots' ? {
  scale: [
    { id: '0', title: '0 · نظر نہیں آیا · Absent' },
    { id: '1', title: '1 · کبھی کبھار · Rare' },
    { id: '2', title: '2 · کافی · Enough' },
    { id: '3', title: '3 · بھرپور · Strong' },
  ],
  evidence: 'ثبوت · Evidence',
  evidenceHelp: (id) => `${id} — جو نظر آیا · what was seen`,
  improve: 'بہتری · Improve',
  improveHelp: (id) => `${id} — کیا بہتر ہو · to improve`,
  body: (i, n) => `حصہ ${i}/${n} — اسکور اور رائے جانچیں، جو مناسب لگے بدلیں · review & edit, part ${i}/${n}`,
  // bd-61: titles/footers/SUCCESS were mewaka hardcodes — PK's live flow
  // showed "MEWAKA undefined · 1/6", Kiswahili buttons, and an "Asante" end.
  screenTitle: (d, i, n) => `HOTS جائزہ ${i}/${n}`,
  next: 'آگے · Next',
  submit: 'جمع کریں · Submit',
  success: {
    title: 'شکریہ',
    heading: 'شکریہ! ✅',
    body: 'آپ کا HOTS جائزہ محفوظ ہو گیا ہے۔ اگلا قدم میں آپ کو نیچے بھیجوں گی۔',
    done: 'مکمل · Done',
  },
} : PACK.key === 'fico' ? {
  // FEAT-102 — ICT/NIETE FICO, English officer-facing, 1-4 scale (from the pack).
  scale: PACK.scaleOptions,
  evidence: 'Evidence',
  evidenceHelp: (id) => `${id} — what was seen`,
  improve: 'To improve',
  improveHelp: (id) => `${id} — to improve`,
  body: (i, n) => `Part ${i}/${n} — review the score & note, edit as you see fit`,
  screenTitle: (d, i, n) => `FICO Review ${i}/${n}`,
  next: 'Next',
  submit: 'Submit observation',
  success: {
    title: 'Thank you',
    heading: 'Thank you! ✅',
    body: 'Your FICO observation has been saved. I will send you the next step below.',
    done: 'Done',
  },
} : {
  scale: [
    { id: '0', title: '0 · Haikuonekana kabisa' },
    { id: '1', title: '1 · Mara chache' },
    { id: '2', title: '2 · Vya kutosha' },
    { id: '3', title: '3 · Sana' },
  ],
  evidence: 'Ushahidi',
  evidenceHelp: (id) => `${id} — kilichoonekana`,
  improve: 'Kuboresha',
  improveHelp: (id) => `${id} — la kuboresha`,
  body: null,   // mewaka keeps its original per-domain body below
  // mewaka labels verbatim — regen must stay byte-identical for TZ
  screenTitle: (d, i, n) => `MEWAKA ${d.key} · ${i}/6`,
  next: 'Endelea',
  submit: 'Wasilisha uchunguzi',
  success: {
    title: 'Asante',
    heading: 'Asante! ✅',
    body: 'Uchunguzi wako wa MEWAKA umehifadhiwa. Nitakutumia hatua inayofuata hapa chini.',
    done: 'Maliza',
  },
};
const SCREEN_LETTERS = 'ABCDEF';
const fid = (id) => String(id).replace(/\./g, '_');   // A1.1 → A1_1; ints pass through
const screenId = (key) => `DOMAIN_${domains[key].key || SCREEN_LETTERS[DOMAIN_ORDER.indexOf(key)]}`;

function domainScreen(key, idx) {
  const d = domains[key];
  const isLast = idx === DOMAIN_ORDER.length - 1;
  const letter = d.key || SCREEN_LETTERS[idx];
  const children = [
    { type: 'TextHeading', text: `${letter}. ${d.displayName_sw || d.title}` },
    { type: 'TextBody', text: L.body
        ? L.body(idx + 1, DOMAIN_ORDER.length)
        : `${d.displayName || d.title_en} · sehemu ${idx + 1}/${DOMAIN_ORDER.length} — hakiki alama na maoni, badilisha unavyoona inafaa.` },
  ];
  const initValues = {};
  const data = {
    scale: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } } },
      __example__: L.scale,
    },
  };
  const payload = { _screen: screenId(key) };

  for (const ind of d.indicators) {
    const f = fid(ind.id);
    children.push({
      type: 'RadioButtonsGroup',
      name: `r_${f}`,
      label: `${ind.id} — ${ind.text_sw || ind.name}`.slice(0, 30),
      description: String(ind.text_sw || ind.name).slice(0, 300),
      required: false,
      'data-source': '${data.scale}',
    });
    children.push({
      type: 'TextArea',
      name: `ev_${f}`,
      label: L.evidence.slice(0, 20),
      'helper-text': L.evidenceHelp(ind.id).slice(0, 80),
      required: false,
    });
    children.push({
      type: 'TextArea',
      name: `imp_${f}`,
      label: L.improve.slice(0, 20),
      'helper-text': L.improveHelp(ind.id).slice(0, 80),
      required: false,
    });
    initValues[`r_${f}`] = `\${data.s_${f}}`;
    initValues[`ev_${f}`] = `\${data.e_${f}}`;
    initValues[`imp_${f}`] = `\${data.i_${f}}`;
    data[`s_${f}`] = { type: 'string', __example__: '2' };
    data[`e_${f}`] = { type: 'string', __example__: 'Ushahidi…' };
    data[`i_${f}`] = { type: 'string', __example__: 'Ushauri…' };
    payload[`r_${f}`] = `\${form.r_${f}}`;
    payload[`ev_${f}`] = `\${form.ev_${f}}`;
    payload[`imp_${f}`] = `\${form.imp_${f}}`;
  }

  children.push({
    type: 'Footer',
    label: isLast ? L.submit : L.next,
    'on-click-action': { name: 'data_exchange', payload },
  });

  return {
    id: screenId(key),
    title: L.screenTitle(d, idx + 1, DOMAIN_ORDER.length).slice(0, 30),
    data,
    layout: {
      type: 'SingleColumnLayout',
      children: [{ type: 'Form', name: `form_${letter}`, 'init-values': initValues, children }],
    },
  };
}

const screens = DOMAIN_ORDER.map((k, i) => domainScreen(k, i));
screens.push({
  id: 'SUCCESS',
  title: L.success.title,
  terminal: true,
  data: {
    session_id: { type: 'string', __example__: '00000000-0000-0000-0000-000000000000' },
  },
  layout: {
    type: 'SingleColumnLayout',
    children: [
      { type: 'TextHeading', text: L.success.heading },
      { type: 'TextBody', text: L.success.body },
      {
        type: 'Footer',
        label: L.success.done,
        'on-click-action': {
          name: 'complete',
          payload: { observe_action: 'submitted', session_id: '${data.session_id}' },
        },
      },
    ],
  },
});

// forward-only routing model (bd-1248)
const routing_model = {};
DOMAIN_ORDER.forEach((k, i) => {
  routing_model[screenId(k)] = [i < DOMAIN_ORDER.length - 1 ? screenId(DOMAIN_ORDER[i + 1]) : 'SUCCESS'];
});
routing_model.SUCCESS = [];

const flow = { version: '6.3', data_api_version: '3.0', routing_model, screens };

const out = path.join(__dirname, `../docs/flows/observe-${PACK.key}-flow.json`);
fs.writeFileSync(out, JSON.stringify(flow, null, 2) + '\n');
const worst = Math.max(...screens.map(s => JSON.stringify(s).split('"type"').length - 1));
console.log(`✓ wrote ${out}`);
console.log(`  screens: ${screens.length} | worst-screen component-ish count: ${worst}`);

module.exports = { fid, DOMAIN_ORDER };
