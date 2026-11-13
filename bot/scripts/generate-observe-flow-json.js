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
// bd-ra8xu.38: OBSERVE_RUBRIC=fico17_v6 OBSERVE_FRAMEWORK=fico writes docs/flows/observe-fico17_v6-flow.json,
// the review Flow for /observe visits stamped v6. Without it the output is exactly what it was.
const PACK = getObservePack(process.env.OBSERVE_RUBRIC === 'fico17_v6' ? { framework: 'fico17_v6' } : undefined);
const IS_V6 = PACK.key === 'fico17_v6';
const FICO_FAMILY = PACK.key === 'fico' || IS_V6;
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
} : IS_V6 ? {
  // bd-ra8xu.38 — FICO17 v6. Section B keeps V3's labels; the rest are built by v6Screens below.
  scale: PACK.scaleOptions,
  evidence: 'Evidence',
  evidenceHelp: (id) => `${id} — what was seen`,
  improve: 'To improve',
  improveHelp: (id) => `${id} — to improve`,
  body: (i, n) => `Part ${i}/${n} — review the score & note, edit as you see fit`,
  // 13 Nov: one title on all 21 screens; where the coach is shows in each screen's own caption.
  screenTitle: () => 'FICO17 review · جائزہ',
  next: 'Next',
  submit: 'Submit observation',
  success: {
    title: 'Thank you',
    heading: 'Thank you! ✅',
    body: 'Your FICO17 observation has been saved. I will send you the next step below.',
    done: 'Done',
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
// bd-5n1a2: per-move fidelity slots on Section B — MUST equal MAX_MOVE_SLOTS in
// observe-draft.service.js (the endpoint serves exactly this many mv_k keys).
// Literal, not a require: observe-draft pulls config/supabase which exits(78)
// without env, and this script runs locally. Parity is locked by a test.
const MAX_MOVE_SLOTS = 12;
// bd-5n1a2: Meta caps RadioButtonsGroup labels at 30 chars; a raw slice cut
// "Activation of Prior Knowl" mid-word (operator screenshot, 2026-08-21).
// Clip at a word boundary — the full name is in `description` regardless.
function clipLabel(s, n) {
  const str = String(s || '');
  if (str.length <= n) return str;
  const cut = str.slice(0, n - 1);
  const sp = cut.lastIndexOf(' ');
  // any space past the "B4 — " id prefix beats a mid-word cut
  return (sp > 5 ? cut.slice(0, sp) : cut).replace(/[\s—·-]+$/, '') + '…';
}
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
  const payload = { _screen: screenId(key) };
  const data = {
    ...(idx === 0 ? { scored_with: { type: 'string', __example__: 'FICO V3' } } : {}),
    scale: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } } },
      __example__: L.scale,
    },
  };

  // bd-c5zs1 (v4, supersedes the v3 read-only blocks): the legacy B1-B10
  // indicator groups are RETIRED from this screen — parity with the teacher
  // flow (D27), where measured fidelity replaced them. Per prescribed move the
  // coach sees the plan's action (read-only) and EDITS the verdict + evidence;
  // the endpoint re-runs the fidelity scorer on the corrected verdicts, so
  // Section B is the coach-corrected measurement. Prefill is env-gated on
  // OBSERVE_FICO_FLOW_HAS_FIDELITY='editable', flipped with the republish.
  if (key === 'lesson_plan_fidelity' && FICO_FAMILY) {
    const fidelityChildren = [
      { type: 'TextSubheading', text: 'Measured lesson-plan fidelity', visible: '${data.has_fidelity}' },
      { type: 'TextBody', text: '${data.fid_header}', visible: '${data.has_fidelity}' },
      { type: 'TextBody', text: '${data.fid_fallback}', visible: '${data.no_fidelity}' },
    ];
    data.has_fidelity = { type: 'boolean', __example__: true };
    data.no_fidelity = { type: 'boolean', __example__: false };
    data.fid_header = {
      type: 'string',
      __example__: 'Measured lesson-plan fidelity: 46% (LOW) · 9 counted moves\nChange any rating you disagree with.',
    };
    data.fid_fallback = { type: 'string', __example__: '' };
    data.fid_scale = {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } } },
      __example__: [
        { id: 'executed', title: '✓ Executed — full credit' },
        { id: 'not_done', title: '✗ Not done — no credit' },
      ],
    };
    for (let k = 1; k <= MAX_MOVE_SLOTS; k++) {
      fidelityChildren.push({ type: 'TextBody', text: `\${data.mv_${k}}`, visible: `\${data.mv_${k}_v}` });
      fidelityChildren.push({
        type: 'RadioButtonsGroup',
        name: `fid_r_${k}`,
        label: `Rating — move ${k}`,
        required: false,
        visible: `\${data.mv_${k}_v}`,
        'data-source': '${data.fid_scale}',
      });
      fidelityChildren.push({
        type: 'TextArea',
        name: `fid_e_${k}`,
        label: 'Evidence',
        'helper-text': `Move ${k} — what was seen`,
        required: false,
        visible: `\${data.mv_${k}_v}`,
      });
      data[`mv_${k}`] = { type: 'string', __example__: `${k}/9 · Warm-up — Plan: Read the word problem aloud` };
      data[`mv_${k}_v`] = { type: 'boolean', __example__: k === 1 };
      data[`fr_${k}`] = { type: 'string', __example__: 'executed' };
      data[`fe_${k}`] = { type: 'string', __example__: '[02:10] Teacher reads it twice' };
      initValues[`fid_r_${k}`] = `\${data.fr_${k}}`;
      initValues[`fid_e_${k}`] = `\${data.fe_${k}}`;
      payload[`fid_r_${k}`] = `\${form.fid_r_${k}}`;
      payload[`fid_e_${k}`] = `\${form.fid_e_${k}}`;
    }
    children.unshift(...fidelityChildren);
  }
  // bd-c5zs1: on the fico fidelity screen the legacy B1-B10 indicator groups
  // are RETIRED — the per-move editable measurement above replaces them, same
  // as the teacher flow (D27). Every other screen keeps its indicators.
  const retiredIndicators = key === 'lesson_plan_fidelity' && FICO_FAMILY;
  for (const ind of retiredIndicators ? [] : d.indicators) {
    const f = fid(ind.id);
    children.push({
      type: 'RadioButtonsGroup',
      name: `r_${f}`,
      // fico gets the word-boundary clip; mewaka/hots keep the raw slice so
      // their regenerated JSON stays byte-identical (TZ/PK published assets).
      label: PACK.key === 'fico'
        ? clipLabel(`${ind.id} — ${ind.text_sw || ind.name}`, 30)
        : `${ind.id} — ${ind.text_sw || ind.name}`.slice(0, 30),
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

  // bd-ra8xu.43: the session's stored rubric, one small caption atop the first screen (filled by the endpoint), added
  // after every other child so nothing later can move it.
  if (idx === 0) children.unshift({ type: 'TextCaption', text: '${data.scored_with}' });
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

// ── FICO17 v6 coach form, one indicator per screen (operator 13 Nov) ─────────
// DOMAIN_B, then per section a no-input intro and one screen per indicator (observe-fico17-v6.js SCREENS). Every
// word on these screens is ${data.*} from the endpoint in the coach's language (English, or the Urdu draft), and the
// level choices are the endpoint's too (the level name, the rubric sheet's text under it; no N/A, no Couldn't tell).
const V6_STR = (example) => ({ type: 'string', __example__: example });
const V6_TITLE = 'FICO17 review · جائزہ';

function v6IntroScreen(letter) {
  const id = `INTRO_${letter}`;
  return {
    id,
    title: V6_TITLE,
    data: {
      heading: V6_STR('Section C · What the teacher does'),
      count_line: V6_STR('8 indicators, one per screen.'),
      list: V6_STR('C1  Quality of Questions Asked by the Teacher\nC3  Who got to answer  (room)'),
      note: V6_STR('Rumi has set the level for 5 of them from the recording: check each one.'),
      next_label: V6_STR('Start Section C'),
    },
    layout: {
      type: 'SingleColumnLayout',
      children: [
        { type: 'TextHeading', text: '${data.heading}' },
        { type: 'TextBody', text: '${data.count_line}' },
        { type: 'TextBody', text: '${data.list}' },
        { type: 'TextBody', text: '${data.note}' },
        { type: 'Footer', label: '${data.next_label}', 'on-click-action': { name: 'data_exchange', payload: { _screen: id } } },
      ],
    },
  };
}

function v6IndicatorScreen(code) {
  const v6 = require('../shared/services/coaching/frameworks/fico17-v6');
  const O6 = require('../shared/services/observe/observe-fico17-v6');
  const id = O6.screenOf(code);
  const meta = v6.indicator(code);
  const combined = v6.isCombined(code);
  const data = {
    progress: V6_STR('Section C · 1 of 8'),
    heading: V6_STR(`${code} · ${meta.name}`),
    definition: V6_STR(meta.definition),
    err_v: { type: 'boolean', __example__: false },
    err_note: V6_STR('Please fix these before you go on:\n• Choose a level.'),
    opts: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' } } }, __example__: v6.coachLevelOptions(code, 'en') },
    lbl_level: V6_STR(combined ? 'Level · you choose' : 'Level'),
    next_label: V6_STR('Next'),
    init: { type: 'object', __example__: combined ? { [`why_${code}`]: '' } : { [`r_${code}`]: '2', [`ev_${code}`]: '', [`imp_${code}`]: '', [`chg_${code}`]: '' } },
  };
  const kids = [
    { type: 'TextCaption', text: '${data.progress}' },
    { type: 'TextHeading', text: '${data.heading}' },
    { type: 'TextBody', text: '${data.definition}' },
    { type: 'TextBody', text: '${data.err_note}', visible: '${data.err_v}' },
  ];
  const payload = { _screen: id, [`r_${code}`]: `\${form.r_${code}}` };
  if (combined) {
    Object.assign(data, {
      from_rec: V6_STR('From the recording'),
      evidence: V6_STR('05:10  "Ali, what do you think?"'),
      coach_adds: V6_STR(`Coach adds: ${meta.coach_adds}`),
      lbl_why: V6_STR('Why this level'),
      help_why: V6_STR('At least 20 characters: what you saw in the room.'),
    });
    kids.push(
      { type: 'TextSubheading', text: '${data.from_rec}' },
      { type: 'TextBody', text: '${data.evidence}' },
      { type: 'TextBody', text: '${data.coach_adds}' },
      { type: 'RadioButtonsGroup', name: `r_${code}`, label: '${data.lbl_level}', required: true, 'data-source': '${data.opts}' },
      { type: 'TextArea', name: `why_${code}`, label: '${data.lbl_why}', required: true, 'max-length': 600, 'helper-text': '${data.help_why}' },
    );
    payload[`why_${code}`] = `\${form.why_${code}}`;
  } else {
    Object.assign(data, {
      rumi_note: V6_STR('Rumi chose Developing from the recording. Change it if you saw something different.'),
      lbl_ev: V6_STR('Evidence'),
      help_ev: V6_STR('What Rumi heard; edit if needed'),
      lbl_imp: V6_STR('To improve'),
      help_imp: V6_STR('What the teacher could do next time'),
      lbl_chg: V6_STR('Why you changed'),
      help_chg: V6_STR("Only if you changed Rumi's level (20+ characters)."),
    });
    kids.push(
      { type: 'TextBody', text: '${data.rumi_note}' },
      { type: 'RadioButtonsGroup', name: `r_${code}`, label: '${data.lbl_level}', required: true, 'data-source': '${data.opts}' },
      { type: 'TextArea', name: `ev_${code}`, label: '${data.lbl_ev}', required: false, 'max-length': 600, 'helper-text': '${data.help_ev}' },
      { type: 'TextArea', name: `imp_${code}`, label: '${data.lbl_imp}', required: false, 'max-length': 600, 'helper-text': '${data.help_imp}' },
      { type: 'TextArea', name: `chg_${code}`, label: '${data.lbl_chg}', required: false, 'max-length': 600, 'helper-text': '${data.help_chg}' },
    );
    for (const f of ['ev', 'imp', 'chg']) payload[`${f}_${code}`] = `\${form.${f}_${code}}`;
  }
  kids.push({ type: 'Footer', label: '${data.next_label}', 'on-click-action': { name: 'data_exchange', payload } });
  return {
    id,
    title: V6_TITLE,
    data,
    layout: {
      type: 'SingleColumnLayout',
      children: [{ type: 'Form', name: `form_${code}`, 'init-values': '${data.init}', children: kids }],
    },
  };
}

function v6Screens() {
  const O6 = require('../shared/services/observe/observe-fico17-v6');
  return O6.SCREENS.map((id) => {
    if (id === 'DOMAIN_B') return domainScreen('lesson_plan_fidelity', 0);
    const info = O6.screenInfo(id);
    return info.kind === 'intro' ? v6IntroScreen(info.letter) : v6IndicatorScreen(info.code);
  });
}

const screens = IS_V6
  ? v6Screens()
  : DOMAIN_ORDER.map((k, i) => domainScreen(k, i));
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
if (IS_V6) {
  const ids = screens.map((s) => s.id);
  ids.forEach((id, i) => { routing_model[id] = [i < ids.length - 1 ? ids[i + 1] : 'SUCCESS']; });
} else {
  DOMAIN_ORDER.forEach((k, i) => {
    routing_model[screenId(k)] = [i < DOMAIN_ORDER.length - 1 ? screenId(DOMAIN_ORDER[i + 1]) : 'SUCCESS'];
  });
}
routing_model.SUCCESS = [];

// v6 (13 Nov): Flow JSON 7.0, as the FDE form already live on this deployment (Footer outside a Form on the intros).
const flow = { version: IS_V6 ? '7.0' : '6.3', data_api_version: '3.0', routing_model, screens };

const out = path.join(__dirname, `../docs/flows/observe-${PACK.key}-flow.json`);
fs.writeFileSync(out, JSON.stringify(flow, null, 2) + '\n');
const worst = Math.max(...screens.map(s => JSON.stringify(s).split('"type"').length - 1));
console.log(`✓ wrote ${out}`);
console.log(`  screens: ${screens.length} | worst-screen component-ish count: ${worst}`);

module.exports = { fid, DOMAIN_ORDER, MAX_MOVE_SLOTS, clipLabel };
