'use strict';

/**
 * bd-ra8xu.50 — "Plan my visit": the lesson's class, grade and subject on three short Flow screens (operator 13 Nov
 * ~13:35-13:38), instead of the two chat lists visit.js sends after Start (/observe) or after the period (/observe2).
 *
 *   CLASS     Primary (grades 1-5, FICO form) · Middle (6-8, FDE's own tool) · High (9-12, FICO form)
 *   GRADE     only the grades of that class
 *   SUBJECT   Middle only (the subject picks FDE's tool; grades 1-5 and 9-12 are FICO lessons whatever the subject)
 *   SUCCESS   closed by the endpoint; the completion carries the same tap id the chat lists send ("o612:…"), so
 *             visit.handleTap does the rest exactly as for a list tap (the visit's nonce / form checks included).
 *
 * The shared Plan my visit Flow (observe-visit-v2.json) is not touched: this is its own Flow, sent only where the
 * chat lists were sent, i.e. only to a coach with obs612_coach on, and only when OBS612_LESSON_FLOW_ID is set
 * (otherwise the chat lists, as before). flow_token = <coachUserId>:o612lesson:<kind>:<ref> (kind 'o' /observe, ref the
 * visit's nonce; 'f' /observe2, ref the form id). Every word on the screens is endpoint data in the coach's language.
 */

const O = require('../../coaching/frameworks/obs612');
const { obs612Strings } = require('./strings');

const FLOW_ID_ENV = 'OBS612_LESSON_FLOW_ID';
const TOKEN_MARKER = 'o612lesson';
const TOKEN_RX = /^([0-9a-fA-F-]{8,64}):o612lesson:([of]):([A-Za-z0-9-]{1,64})$/;
const TITLE = 'Plan my visit · وزٹ پلان';

const BANDS = {
  primary: O.GRADES.filter((g) => g <= O.PRIMARY_MAX_GRADE),
  middle: O.FDE_GRADES.slice(),
  high: O.GRADES.filter((g) => g > Math.max(...O.FDE_GRADES)),
};
const BAND_KEYS = Object.keys(BANDS);

const lessonToken = (userId, kind, ref) => `${userId}:${TOKEN_MARKER}:${kind}:${ref}`;
function parseToken(token) {
  const m = TOKEN_RX.exec(String(token || ''));
  return m ? { userId: m[1], kind: m[2], ref: m[3] } : null;
}

const bandOf = (grade) => BAND_KEYS.find((b) => BANDS[b].includes(Number(grade))) || null;

/** The tap id the chat lists send for this choice: the one handleTap understands. */
function tapFor(t, grade, subject) {
  const g = Number(grade);
  if (BANDS.primary.includes(g)) return `o612:g:${t.kind}:${t.ref}:${g}`;
  if (BANDS.high.includes(g)) return `o612:g:${t.kind}:${t.ref}:${g}`;
  if (BANDS.middle.includes(g) && O.normSubject(subject)) return `o612:s:${t.kind}:${t.ref}:${g}:${O.normSubject(subject)}`;
  return null;
}

// ── screens' data ─────────────────────────────────────────────────────────────

function classData(s, teacherName) {
  return {
    heading: s.lf_class_heading(teacherName),
    note: s.lf_class_note,
    lbl: s.lf_class_label,
    options: BAND_KEYS.map((b) => ({ id: b, title: s.lf_bands[b].title, description: s.lf_bands[b].description })),
    next_label: s.lf_continue,
  };
}

function gradeData(s, band) {
  return {
    heading: s.lf_grade_heading,
    band_name: s.lf_bands[band].title,
    lbl: s.lf_grade_label,
    options: BANDS[band].map((g) => ({ id: String(g), title: s.grade_row(g) })),
    next_label: band === 'middle' ? s.lf_continue : s.lf_start,
  };
}

function subjectData(s, grade) {
  return {
    heading: s.lf_subject_heading,
    grade_name: s.grade_row(grade),
    lbl: s.lf_subject_label,
    options: O.SUBJECTS.map((sub) => ({
      id: sub.key,
      title: s.subjects[sub.key] || sub.label,
      ...(sub.key === 'science' ? { description: s.science_desc } : {}),
    })),
    next_label: s.lf_start,
    grade: String(grade),
  };
}

const closeWith = (tap) => ({
  screen: 'SUCCESS',
  data: { extension_message_response: { params: { obs612_lesson: 'named', tap } } },
});

/**
 * The endpoint (routes/flow-endpoint.routes.js /obs612-lesson). `deps.userLang(userId)` → 'en' | 'ur' and
 * `deps.teacherName(t)` → the visit's teacher name or null; both may fail (English, no name). Never throws.
 */
async function handleRequest(decrypted, deps = {}) {
  const { action, flow_token: flowToken, data = {} } = decrypted || {};
  const t = parseToken(flowToken);
  if (!t) return { data: { error: { message: 'This choice is from an older visit. Send /observe again.' } } };
  let lang = 'en';
  try { lang = deps.userLang ? await deps.userLang(t.userId) : 'en'; } catch (_) { lang = 'en'; }
  const s = obs612Strings(lang);
  if (action === 'INIT') {
    let name = null;
    try { name = deps.teacherName ? await deps.teacherName(t) : null; } catch (_) { name = null; }
    return { screen: 'CLASS', data: classData(s, name) };
  }
  if (action === 'BACK') return { screen: 'CLASS', data: classData(s, null) };
  if (action !== 'data_exchange') return { data: { error: { message: 'Unsupported action' } } };
  const step = String(data.step || '');
  if (step === 'class') {
    const band = BAND_KEYS.includes(data.band) ? data.band : null;
    if (!band) return { screen: 'CLASS', data: classData(s, null) };
    return { screen: 'GRADE', data: gradeData(s, band) };
  }
  if (step === 'grade') {
    const g = Number(data.grade);
    const band = bandOf(g);
    if (!band) return { screen: 'CLASS', data: classData(s, null) };
    if (band === 'middle') return { screen: 'SUBJECT', data: subjectData(s, g) };
    return closeWith(tapFor(t, g, null));
  }
  if (step === 'subject') {
    const tap = tapFor(t, data.grade, data.subject);
    if (!tap) return { screen: 'CLASS', data: classData(s, null) };
    return closeWith(tap);
  }
  return { screen: 'CLASS', data: classData(s, null) };
}

// ── Flow JSON ─────────────────────────────────────────────────────────────────

const str = (example) => ({ type: 'string', __example__: example });
const optionsDecl = (example) => ({
  type: 'array',
  items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' } } },
  __example__: example,
});

function radioScreen(id, { caption, fieldName, payload, extra = {} }) {
  const s = obs612Strings('en');
  const children = [
    ...(caption ? [{ type: 'TextCaption', text: `\${data.${caption}}` }] : []),
    { type: 'TextHeading', text: '${data.heading}' },
    ...(id === 'CLASS' ? [{ type: 'TextBody', text: '${data.note}' }] : []),
    { type: 'RadioButtonsGroup', name: fieldName, label: '${data.lbl}', required: true, 'data-source': '${data.options}' },
    { type: 'Footer', label: '${data.next_label}', 'on-click-action': { name: 'data_exchange', payload } },
  ];
  const ex = id === 'CLASS' ? classData(s, 'Ms Nadia') : id === 'GRADE' ? gradeData(s, 'middle') : subjectData(s, 7);
  const data = {
    heading: str(ex.heading),
    lbl: str(ex.lbl),
    options: optionsDecl(ex.options),
    next_label: str(ex.next_label),
    ...(id === 'CLASS' ? { note: str(ex.note) } : {}),
    ...(caption ? { [caption]: str(ex[caption]) } : {}),
    ...extra,
  };
  return {
    id,
    title: TITLE,
    data,
    layout: { type: 'SingleColumnLayout', children: [{ type: 'Form', name: `${id.toLowerCase()}_form`, children }] },
  };
}

function buildFlow() {
  const screens = [
    radioScreen('CLASS', { fieldName: 'band', payload: { step: 'class', band: '${form.band}' } }),
    radioScreen('GRADE', { caption: 'band_name', fieldName: 'grade', payload: { step: 'grade', grade: '${form.grade}' } }),
    radioScreen('SUBJECT', {
      caption: 'grade_name', fieldName: 'subject', payload: { step: 'subject', grade: '${data.grade}', subject: '${form.subject}' },
      extra: { grade: str('7') },
    }),
    {
      id: 'SUCCESS',
      title: TITLE,
      terminal: true,
      success: true,
      data: {
        extension_message_response: {
          type: 'object',
          properties: { params: { type: 'object', properties: { obs612_lesson: { type: 'string' }, tap: { type: 'string' } } } },
          __example__: { params: { obs612_lesson: 'named', tap: 'o612:s:o:abc123:7:science' } },
        },
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          { type: 'TextBody', text: '✅' },
          { type: 'Footer', label: 'Done', 'on-click-action': { name: 'complete', payload: { obs612_lesson: 'named' } } },
        ],
      },
    },
  ];
  return {
    version: '7.0',
    data_api_version: '3.0',
    routing_model: { CLASS: ['GRADE'], GRADE: ['SUBJECT', 'SUCCESS'], SUBJECT: ['SUCCESS'], SUCCESS: [] },
    screens,
  };
}

module.exports = {
  FLOW_ID_ENV, TOKEN_MARKER, BANDS, TITLE,
  lessonToken, parseToken, bandOf, tapFor, handleRequest, buildFlow,
};
