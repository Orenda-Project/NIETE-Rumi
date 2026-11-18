'use strict';

/**
 * bd-pni007 — the FDE (obs612) coach form as ONE WhatsApp Flow for FDE's three tools, built from the rubric data
 * (frameworks/obs612). The generator (bot/scripts/generate-obs612-flow-json.js) writes it to
 * bot/docs/flows/obs612-flow.json; the endpoint (routes/obs612-endpoint.js) reads the same screen list, so the
 * fields a screen posts and the fields the endpoint saves and checks are one list.
 *
 *   General form       GEN_ENV → GEN_DELIVERY → GEN_MANAGEMENT → GEN_COMMAND → GEN_ASSESSMENT → GEN_WORK
 *                      one screen per FDE section: Yes/No per item, an optional comment box; the last adds the
 *                      required feedback line.
 *   Maths & Science    MSCI_OVERVIEW → MSCI_BEFORE → MSCI_DURING_ONE → MSCI_DURING_TWO → MSCI_AFTER → MSCI_PLAN
 *                      (one tool for Maths and for Science.) bd-ra8xu.53, Rifat 13 Nov: an overview of the parts opens
 *                      the form; each indicator's FDE text and each level's FDE text stand in full ABOVE its radios
 *                      (inside the radio group WhatsApp cut them short), the radios read Level 0-3; an optional
 *                      Observations box; then the 5-student check and FDE's development-plan table (Annexure G p.14:
 *                      one row, an optional second). Every screen after the overview says how to go back.
 *   English & Urdu     ENUR_CONTEXT → ENUR_INTRO_TWO → ENUR_TWO_B → ENUR_TWO_C | ENUR_TWO_D → ENUR_TWO_E → … _G →
 *                      ENUR_INTRO_THREE → ENUR_THREE_A … _D → ENUR_INTRO_FOUR → ENUR_FOUR_A … _D → ENUR_FIVE → ENUR_SIX →
 *                      ENUR_SEVEN → ENUR_FEEDBACK
 *                      Operator 13 Nov: one part per screen (B, C, D …), a no-input screen opening each section that has
 *                      parts (Sections 2, 3, 4), the section's name as a small line above each part's heading. The
 *                      visit's sheet picks Section 2's C (English) or D (Urdu). Section 7 is computed from the coach's
 *                      scores and shown read-only (the total, each part's, FDE's 108-point score and its band).
 *   NOTICE             a refused form (not this coach's, not an FDE form, already submitted): what and why.
 *   DONE               the one terminal screen.
 *
 * Meta's rules this follows (whatsapp-flows skill, tests/setup/flow-screen-contract.test.js):
 *   - INIT may only answer with a screen that has no route in: each tool's first screen, or NOTICE. So a reopened
 *     form starts at its first screen, every screen pre-filled from the saved draft.
 *   - Routes are forward only (a route back is refused at publish). Every form screen may also go to DONE, so a form
 *     sealed or refused while open can still close. A Submit with something missing stays on the last screen and
 *     says where it is; the coach goes back with the header arrow.
 *   - Screen ids are letters and underscores only. Labels: radio 30, text and dropdown 20, helper 80, option title
 *     30, descriptions 300, TextArea 600, 50 components a screen. Meta requires a radio label (validated 13 Nov) and
 *     most of FDE's items are longer than 30, so an item's label is FDE's own number for it ("1", "2" …; never
 *     "Item") and FDE's item text sits right under it in the group's description, word for word.
 *   - init-values only on the Form, and never on a number input (Meta takes a number there and a visit may have
 *     none to give): Class Size is not pre-filled, and a blank one never clears what was saved.
 * Every screen carries a small caption with ${data.rubric_label} ('FDE v1': framework and version only).
 */

const O = require('../../coaching/frameworks/obs612');

const FLOW_VERSION = '7.0';
const DATA_API_VERSION = '3.0';
const TEXTAREA_MAX = 600;
const TEXTINPUT_MAX = 80;

// FDE's own headings that the rubric data does not carry (Annexure G pp.15 and 17), word for word.
const ENUR_SECTION_1 = 'Section 1: Context & Pre-Observation';
const ENUR_SECTION_7 = 'Section 7: Overall Evaluation';
const ENUR_SECTION_8 = 'Section 8: Qualitative Feedback';
// FDE's Section 7 bands, as printed (on its 108-point score).
const ENUR_BANDS_LINE = `FDE's bands: ${O.TOOLS.enur.bands.map((b) => `${b.printed_range} ${b.label}`).join(' · ')}`;

const opt = (id, title, description) => ({ id, title, ...(description ? { description } : {}) });
const YES_NO = O.TOOLS.gen.scale.options.map((t) => opt(t.toLowerCase(), t));
const POINTS = O.TOOLS.enur.scale.labels.map((l, i) => opt(String(i + 1), `${i + 1} · ${l}`));
const LEVEL_LABELS = O.TOOLS.msci.scale.labels;
const levelOptions = (texts) => LEVEL_LABELS.map((l, i) => opt(String(i), l, texts[i]));
// A teacher goal is a level to reach: Level 1-3.
const GOALS = [1, 2, 3].map((n) => opt(String(n), LEVEL_LABELS[n]));
const AREAS = O.TOOLS.msci.indicators.map((i) => opt(i.key, O.SHORT.msci[i.key], i.text));
const ctxDef = (key) => O.TOOLS.enur.context.find((c) => c.key === key);
const ctxOptions = (key) => ctxDef(key).options.map((t) => opt(t, t));

// ── fields ────────────────────────────────────────────────────────────────────
// input: radio | dropdown | textarea | textinput | number. `answer` marks a scored item (always required), checked
// with the rubric's own normAnswer. `prefill: false` only for the number input.

const item = (name, answer, label, description, options) => ({
  name, input: 'radio', answer, label, description, options, required: true, prefill: true,
});
const textarea = (name, label, required, helper) => ({ name, input: 'textarea', label, required, helper, max: TEXTAREA_MAX, prefill: true });
const textinput = (name, label, required, helper) => ({ name, input: 'textinput', label, required, helper, max: TEXTINPUT_MAX, prefill: true });
const dropdown = (name, label, required, options) => ({ name, input: 'dropdown', label, required, options, prefill: true });
const number = (name, label) => ({ name, input: 'number', label, required: false, prefill: false });

// A screen is a list of parts, in order: { caption }, { heading }, { sub }, { text } (fixed words), { body: dataKey,
// example } (words the endpoint fills), or { field }.

// ── General form ──────────────────────────────────────────────────────────────

const GEN_SECTIONS = O.TOOLS.gen.sections;
const GEN_SCREENS = GEN_SECTIONS.map((s, i) => {
  const last = i === GEN_SECTIONS.length - 1;
  return {
    id: `GEN_${s.key.toUpperCase()}`,
    tool: 'gen',
    title: `Part ${i + 1} of ${GEN_SECTIONS.length}`,
    footer: last ? 'Submit' : 'Next',
    parts: [
      { heading: s.title },
      ...s.items.map((it) => ({ field: item(it.key, 'yes_no', String(it.n), it.text, YES_NO) })),
      { field: textarea(`comment_${s.key}`, 'Comments', false) },
      ...(last ? [{ sub: 'Feedback for the teacher' }, { field: textarea('fb_line', 'Feedback', true, 'Strengths and one thing to work on') }] : []),
    ],
  };
});

// ── Maths & Science ───────────────────────────────────────────────────────────

const MSCI_SPLIT = [
  { id: 'MSCI_BEFORE', keys: ['i1'] },
  { id: 'MSCI_DURING_ONE', keys: ['i2', 'i3', 'i4', 'i5'] },
  { id: 'MSCI_DURING_TWO', keys: ['i6', 'i7', 'i8', 'i9'] },
  { id: 'MSCI_AFTER', keys: ['i10', 'i11'] },
];
const indicator = (key) => O.TOOLS.msci.indicators.find((i) => i.key === key);
const MSCI_COUNT = MSCI_SPLIT.length + 2; // the overview, the four indicator parts, the student check and plan
const DP_COLUMNS = O.TOOLS.msci.development_plan.columns; // Development area, Current level, Teacher goal, Action plan for the teacher
// bd-ra8xu.53 — FDE's words in full above the radios (a radio group cuts long text). The field keeps FDE's words
// (the portal and every other reader use them); `textAbove` tells the Flow to leave them out of the radio group.
const levelBlock = (levels) => levels.map((l, n) => `${LEVEL_LABELS[n]}: ${l}`).join('\n');
// Meta routes forward only: going back is the header arrow (whatsapp-flows; refused at publish otherwise).
const BACK_HINT = 'To change an earlier part, tap ← at the top. Your answers stay.';
const DP_SOURCE = `FDE's table at the end of this tool (Annexure G, p.14): ${DP_COLUMNS.join(' · ')}.`;
function msciOverview() {
  const lines = [`FDE's tool for Maths and Science (${O.TOOLS.msci.fde_ref}), in ${MSCI_COUNT - 1} parts:`];
  MSCI_SPLIT.forEach((sp, i) => {
    lines.push('', `Part ${i + 2} · ${indicator(sp.keys[0]).stage}`);
    for (const k of sp.keys) lines.push(`${indicator(k).n}. ${O.SHORT.msci[k]}`);
  });
  lines.push('', `Part ${MSCI_COUNT} · ${O.TOOLS.msci.student_check.title} (5 students) and the development plan: ${DP_COLUMNS.join(', ')}`);
  lines.push('', 'Each indicator is scored Level 0 to Level 3, in FDE\'s words.');
  return lines.join('\n');
}
const msciIndicatorParts = (k) => {
  const ind = indicator(k);
  return [
    { sub: `${ind.n}. ${O.SHORT.msci[k]}` },
    { text: ind.text },
    { text: levelBlock(ind.levels) },
    { field: { ...item(k, 'level', O.SHORT.msci[k], ind.text, levelOptions(ind.levels)), textAbove: true } },
    { field: textarea(`obs_${k}`, 'Observations', false) },
  ];
};

const MSCI_SCREENS = [
  {
    id: 'MSCI_OVERVIEW',
    tool: 'msci',
    title: `Part 1 of ${MSCI_COUNT}`,
    footer: 'Start',
    parts: [{ heading: O.TOOLS.msci.title }, { text: msciOverview() }],
  },
  ...MSCI_SPLIT.map((s, i) => ({
    id: s.id,
    tool: 'msci',
    title: `Part ${i + 2} of ${MSCI_COUNT}`,
    footer: 'Next',
    parts: [
      { caption: BACK_HINT },
      { heading: indicator(s.keys[0]).stage },
      ...s.keys.flatMap(msciIndicatorParts),
    ],
  })),
  {
    id: 'MSCI_PLAN',
    tool: 'msci',
    title: `Part ${MSCI_COUNT} of ${MSCI_COUNT}`,
    footer: 'Submit',
    parts: [
      { caption: BACK_HINT },
      { heading: O.TOOLS.msci.student_check.title },
      { text: O.TOOLS.msci.student_check.instruction },
      { text: levelBlock(O.TOOLS.msci.student_check.levels) },
      {
        field: {
          ...item(O.TOOLS.msci.student_check.key, 'level', O.SHORT.msci.students, O.TOOLS.msci.student_check.instruction,
            levelOptions(O.TOOLS.msci.student_check.levels)),
          textAbove: true,
        },
      },
      { field: textarea('comment_students', 'Observations', false) },
      { sub: 'Development plan' },
      { caption: DP_SOURCE },
      { body: 'levels_line', example: `${DP_COLUMNS[1]}, as you scored each indicator:\n1. ${O.SHORT.msci.i1}: Level 2\n3. ${O.SHORT.msci.i3}: Level 1` },
      { field: dropdown('dp_area', DP_COLUMNS[0], true, AREAS) },
      { field: dropdown('dp_goal', DP_COLUMNS[2], true, GOALS) },
      { field: textarea('dp_action', 'Action plan', true, DP_COLUMNS[3]) },
      { sub: 'A second area (optional)' },
      { field: dropdown('dp_area_2', DP_COLUMNS[0], false, AREAS) },
      { field: dropdown('dp_goal_2', DP_COLUMNS[2], false, GOALS) },
      { field: textarea('dp_action_2', 'Action plan', false, DP_COLUMNS[3]) },
    ],
  },
];

// ── English & Urdu ────────────────────────────────────────────────────────────

const enurSection = (key) => O.TOOLS.enur.sections.find((s) => s.key === key);
const NUMBER_WORDS = { 2: 'TWO', 3: 'THREE', 4: 'FOUR', 5: 'FIVE', 6: 'SIX' };
// FDE prints "Section 2: A. Teacher Practices" (its parts are B-G); shown as "Section 2: Teacher Practices".
const sectionLine = (s) => String(s).replace(/^(Section \d+:)\s*A\.\s*/, '$1 ');
const sectionNo = (s) => Number((/^Section (\d+)/.exec(s.section) || [])[1]);
const partLetter = (s) => (/^([A-Z])\./.exec(s.title) || [])[1] || null;

// Every scored part, in FDE's order, grouped by its section. A section with lettered parts (2, 3, 4) gets an intro
// screen and one screen per part; a section that is one block (5, 6) is one screen.
const ENUR_GROUPS = [];
for (const s of O.TOOLS.enur.sections) {
  const n = sectionNo(s);
  let g = ENUR_GROUPS.find((x) => x.n === n);
  if (!g) { g = { n, line: sectionLine(s.section), parts: [] }; ENUR_GROUPS.push(g); }
  g.parts.push(s);
}

function enurPartScreen(g, s) {
  const lettered = Boolean(partLetter(s)) && g.parts.length > 1;
  const id = lettered ? `ENUR_${NUMBER_WORDS[g.n]}_${partLetter(s)}` : `ENUR_${NUMBER_WORDS[g.n]}`;
  return {
    id,
    tool: 'enur',
    sheet: s.sheets.length === 1 ? s.sheets[0] : null,
    footer: 'Next',
    parts: [
      ...(lettered ? [{ caption: g.line }, { heading: s.title }] : [{ heading: g.line }]),
      ...s.items.map((it) => ({ field: item(it.key, 'points', String(it.n), it.text, POINTS) })),
    ],
  };
}

function enurIntroScreen(g) {
  return {
    id: `ENUR_INTRO_${NUMBER_WORDS[g.n]}`,
    tool: 'enur',
    sheet: null,
    footer: `Start Section ${g.n}`,
    intro: true,
    group: g.n,
    parts: [{ heading: g.line }, { body: 'parts_line', example: g.parts.map((s) => s.title).join('\n') }],
  };
}

const ENUR_ITEM_SCREENS = ENUR_GROUPS.flatMap((g) => (g.parts.length > 1 ? [enurIntroScreen(g)] : []).concat(g.parts.map((s) => enurPartScreen(g, s))));

const FEEDBACK_LABEL = { strengths: 'Strengths', areas: 'Areas to improve', recommendations: 'Recommendations', timeline: 'Timeline' };

const ENUR_SEVEN = {
  id: 'ENUR_SEVEN',
  tool: 'enur',
  sheet: null,
  footer: 'Next',
  readOnly: true,
  parts: [
    { heading: ENUR_SECTION_7 },
    { body: 'seven_lines', example: 'Total: 85 of 156\nOn FDE\'s 108-point scale: 58.8\nRating: Developing (3)\n\nSection 2: Teacher Practices\nB. Lesson Planning & Objectives: 6 of 12' },
    { caption: ENUR_BANDS_LINE },
  ],
};

const ENUR_SCREENS = [
  {
    id: 'ENUR_CONTEXT',
    tool: 'enur',
    footer: 'Next',
    parts: [
      { heading: ENUR_SECTION_1 },
      { body: 'ctx_lines', example: 'School: IMCG F-7/2\nObserver: Amna\nTeacher: Rabia\nGrade/Class: 7' },
      { field: dropdown('ctx_5', ctxDef('ctx_5').label, true, ctxOptions('ctx_5')) },
      { field: textinput('ctx_6', ctxDef('ctx_6').label, true) },
      { field: dropdown('ctx_7', ctxDef('ctx_7').label, true, ctxOptions('ctx_7')) },
      { field: number('ctx_8', ctxDef('ctx_8').label) },
      { field: textarea('ctx_9', 'Prior learning', false, ctxDef('ctx_9').label) },
    ],
  },
  ...ENUR_ITEM_SCREENS,
  ENUR_SEVEN,
  {
    id: 'ENUR_FEEDBACK',
    tool: 'enur',
    footer: 'Submit',
    parts: [
      { heading: ENUR_SECTION_8 },
      ...O.TOOLS.enur.feedback.map((f) => {
        const label = FEEDBACK_LABEL[f.key];
        return { field: textarea(`fb_${f.key}`, label, true, label === f.label ? undefined : f.label) };
      }),
    ],
  },
];
// "Part i of n" on the path a lesson walks (English and Urdu are the same length: C and D share a place).
const ENUR_PATH_EN = ENUR_SCREENS.filter((x) => !x.sheet || x.sheet === 'en');
for (const x of ENUR_SCREENS) {
  const i = x.sheet === 'ur' ? ENUR_PATH_EN.findIndex((y) => y.sheet === 'en') : ENUR_PATH_EN.indexOf(x);
  x.title = `Part ${i + 1} of ${ENUR_PATH_EN.length}`;
}

const FORM_SCREENS = [...GEN_SCREENS, ...MSCI_SCREENS, ...ENUR_SCREENS];

/** An English & Urdu intro screen's list: the part titles of its section on this lesson's path (C or D by language). */
function introPartTitles(id, sheet) {
  const intro = ENUR_ITEM_SCREENS.find((x) => x.id === id && x.intro);
  if (!intro) return [];
  const g = ENUR_GROUPS.find((x) => x.n === intro.group);
  const sh = O.normSheet(sheet);
  return g.parts.filter((s) => s.sheets.includes(sh)).map((s) => s.title);
}

/** Section 7's lines: the total, FDE's 108-point score and its band, then every part's score under its section. */
function sevenLines(r) {
  if (!r) return '';
  const out = [
    `Total: ${r.total} of ${r.max} (${r.pct}%)`,
    `On FDE's 108-point scale: ${r.score_108}`,
    `Rating: ${r.band ? `${r.band.label} (${r.band.rating})` : '—'}`,
  ];
  let shown = null;
  for (const sec of r.sections || []) {
    const line = sectionLine(sec.section);
    const lettered = Boolean(partLetter(sec)) && (ENUR_GROUPS.find((g) => g.line === line) || { parts: [] }).parts.length > 1;
    if (lettered) {
      if (line !== shown) { out.push('', line); shown = line; }
      out.push(`${sec.title}: ${sec.score} of ${sec.max}`);
    } else {
      out.push('', `${line}: ${sec.score} of ${sec.max}`);
      shown = null;
    }
  }
  return out.join('\n');
}
const BY_ID = Object.fromEntries(FORM_SCREENS.map((s) => [s.id, s]));

// ── paths ─────────────────────────────────────────────────────────────────────

/** The screens a visit's form walks, in order. */
function pathFor(tool, sheet) {
  if (tool === 'gen') return GEN_SCREENS.map((s) => s.id);
  if (tool === 'msci') return MSCI_SCREENS.map((s) => s.id);
  if (tool === 'enur') {
    const sh = O.normSheet(sheet);
    return ENUR_SCREENS.filter((s) => !s.sheet || s.sheet === sh).map((s) => s.id);
  }
  return [];
}

/** Each tool's first screen: the screen INIT answers with. */
function firstScreenOf(tool) {
  return pathFor(tool, null)[0] || null;
}

/** The next screen on the sheet's path, or null when this is the Submit screen. */
function nextOf(screenId, sheet) {
  const s = BY_ID[screenId];
  if (!s) return null;
  const ids = pathFor(s.tool, sheet);
  const i = ids.indexOf(screenId);
  return i >= 0 && i < ids.length - 1 ? ids[i + 1] : null;
}

const screenById = (id) => BY_ID[id] || null;
/** The fields a form screen posts, in screen order (what the endpoint saves and checks). */
const fieldsOf = (id) => (BY_ID[id] ? BY_ID[id].parts.filter((p) => p.field).map((p) => p.field) : []);
/** The read-only text blocks a screen shows from the endpoint ({ body: dataKey }). */
const bodiesOf = (id) => (BY_ID[id] ? BY_ID[id].parts.filter((p) => p.body).map((p) => p.body) : []);
const initKey = (name) => `init_${name}`;

// ── Flow JSON ─────────────────────────────────────────────────────────────────

const str = (example) => ({ type: 'string', __example__: example });
const CAPTION = { type: 'TextCaption', text: '${data.rubric_label}' };

function component(f) {
  if (f.input === 'radio') {
    if (f.textAbove) { // bd-ra8xu.53 — FDE's words stand above the group; the group carries the levels only
      const options = f.options.map((o) => ({ id: o.id, title: o.title }));
      return { type: 'RadioButtonsGroup', name: f.name, label: f.label, required: f.required, 'data-source': options };
    }
    return { type: 'RadioButtonsGroup', name: f.name, label: f.label, description: f.description, required: f.required, 'data-source': f.options };
  }
  if (f.input === 'dropdown') return { type: 'Dropdown', name: f.name, label: f.label, required: f.required, 'data-source': f.options };
  if (f.input === 'number') return { type: 'TextInput', name: f.name, label: f.label, 'input-type': 'number', required: false };
  const base = f.input === 'textarea'
    ? { type: 'TextArea', name: f.name, label: f.label, required: f.required, 'max-length': f.max }
    : { type: 'TextInput', name: f.name, label: f.label, 'input-type': 'text', required: f.required };
  return f.helper ? { ...base, 'helper-text': f.helper } : base;
}

function initExample(f) {
  if (f.options) return f.options[0].id;
  return '';
}

function formScreenJson(s) {
  const data = {
    rubric_label: str(O.LABEL),
    err_v: { type: 'boolean', __example__: false },
    err_note: str('Answer every item on this screen, then tap Next.'),
    error_messages: { type: 'object', __example__: {} },
  };
  const init = {};
  const payload = { screen: s.id };
  const children = [CAPTION];
  let errShown = false;
  const showErr = () => {
    if (!errShown) children.push({ type: 'TextBody', text: '${data.err_note}', visible: '${data.err_v}' });
    errShown = true;
  };
  for (const p of s.parts) {
    // A small line: the section a part belongs to, above the part's heading; FDE's bands under Section 7.
    if (p.caption) { children.push({ type: 'TextCaption', text: p.caption }); continue; }
    if (p.heading) { children.push({ type: 'TextHeading', text: p.heading }); showErr(); continue; }
    showErr();
    if (p.sub) children.push({ type: 'TextSubheading', text: p.sub });
    else if (p.text) children.push({ type: 'TextBody', text: p.text });
    else if (p.body) { children.push({ type: 'TextBody', text: `\${data.${p.body}}` }); data[p.body] = str(p.example); }
    else if (p.field) {
      const f = p.field;
      children.push(component(f));
      payload[f.name] = `\${form.${f.name}}`;
      if (f.prefill) {
        init[f.name] = `\${data.${initKey(f.name)}}`;
        data[initKey(f.name)] = str(initExample(f));
      }
    }
  }
  children.push({ type: 'Footer', label: s.footer, 'on-click-action': { name: 'data_exchange', payload } });
  return {
    id: s.id,
    title: s.title,
    data,
    layout: {
      type: 'SingleColumnLayout',
      children: [{
        type: 'Form',
        name: `${s.id.toLowerCase()}_form`,
        'init-values': init,
        'error-messages': '${data.error_messages}',
        children,
      }],
    },
  };
}

const NOTICE = {
  id: 'NOTICE',
  title: 'FDE form',
  data: {
    rubric_label: str(O.LABEL),
    notice_title: str('Already submitted'),
    notice_body: str('This form was submitted before. Nothing was changed.'),
  },
  layout: {
    type: 'SingleColumnLayout',
    children: [
      CAPTION,
      { type: 'TextHeading', text: '${data.notice_title}' },
      { type: 'TextBody', text: '${data.notice_body}' },
      { type: 'Footer', label: 'Close', 'on-click-action': { name: 'data_exchange', payload: { screen: 'NOTICE' } } },
    ],
  },
};

// Flat keys in the complete payload (the deployment's proven shape, see flow-screen-contract.test.js):
// { obs612: 'submitted' | 'already' | 'closed' | 'refused' | 'error', form_id }.
const DONE = {
  id: 'DONE',
  title: 'FDE form',
  terminal: true,
  success: true,
  data: {
    rubric_label: str(O.LABEL),
    done_title: str('Submitted'),
    done_body: str('Your FDE form is saved. Your summary follows in the chat.'),
    outcome: str('submitted'),
    form_id: str('00000000-0000-4000-8000-000000000000'),
  },
  layout: {
    type: 'SingleColumnLayout',
    children: [
      CAPTION,
      { type: 'TextHeading', text: '${data.done_title}' },
      { type: 'TextBody', text: '${data.done_body}' },
      { type: 'Footer', label: 'Done', 'on-click-action': { name: 'complete', payload: { obs612: '${data.outcome}', form_id: '${data.form_id}' } } },
    ],
  },
};

function buildFlow() {
  const screens = [...FORM_SCREENS.map(formScreenJson), NOTICE, DONE];
  const routing = {};
  for (const s of FORM_SCREENS) {
    const nexts = s.tool === 'enur'
      ? [...new Set(['en', 'ur'].map((sh) => (pathFor('enur', sh).includes(s.id) ? nextOf(s.id, sh) : null)).filter(Boolean))]
      : [nextOf(s.id, null)].filter(Boolean);
    routing[s.id] = [...nexts, 'DONE'];
  }
  routing.NOTICE = ['DONE'];
  routing.DONE = [];
  return { version: FLOW_VERSION, data_api_version: DATA_API_VERSION, routing_model: routing, screens };
}

module.exports = {
  introPartTitles,
  sevenLines,
  sectionLine,
  FLOW_VERSION,
  DATA_API_VERSION,
  TEXTAREA_MAX,
  TEXTINPUT_MAX,
  ENUR_SECTION_1,
  ENUR_SECTION_8,
  FORM_SCREENS,
  buildFlow,
  pathFor,
  firstScreenOf,
  nextOf,
  screenById,
  fieldsOf,
  bodiesOf,
  initKey,
};
